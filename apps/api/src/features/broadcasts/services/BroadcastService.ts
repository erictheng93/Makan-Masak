import { drizzle } from "drizzle-orm/d1";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  CustomerWebPushService,
  customerConsents,
  customerFavorites,
  customerNotificationPreferences,
  customerPushSubscriptions,
  isWebPushEnabled,
  marketingBroadcastRecipients,
  marketingBroadcasts,
  markets,
  PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES,
  businessTimezoneOffsetMinutes,
  restaurantMarketMemberships,
  restaurants,
} from "@makanmasak/database";
import {
  MARKETING_BROADCAST_RATE_LIMITS,
  type MarketingBroadcastRecipientStatus,
  type MarketingBroadcastScope,
} from "@makanmasak/shared-types";
import { generateUUID } from "@makanmasak/utils";
import { ApiError, notFound } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";
import type {
  BroadcastHistory,
  BroadcastHistoryItem,
  BroadcastResult,
  SendBroadcastCommand,
} from "../types";

/**
 * A subscription is dropped from every audience once it has failed this many
 * times in a row. Same threshold `CustomerWebPushService` applies to waiting
 * list pushes — one number, so a device that stops receiving one stops
 * receiving both.
 */
const MAX_SUBSCRIPTION_FAILURES = 3;

/**
 * D1 caps a statement at 100 bound parameters. Everything below that reads or
 * writes in chunks sized to stay under it: 50 ids for an `IN (...)`, 10 rows
 * for a multi-row insert of an 8-column table.
 */
const ID_CHUNK_SIZE = 50;
const INSERT_CHUNK_SIZE = 10;

/**
 * How many deliveries are in flight at once. Bounded because every delivery is
 * a fetch and a Worker has a finite subrequest budget per request; unbounded
 * `Promise.all` over a large audience would spend it in one burst.
 */
const DELIVERY_CONCURRENCY = 10;

const MINUTES_PER_DAY = 24 * 60;

interface AudienceRow {
  customerId: string;
  /** The favorite row that selected this customer. */
  targetType: string;
  targetId: string;
  consentId: string;
  followedOnly: number | null;
  quietHoursStartMin: number | null;
  quietHoursEndMin: number | null;
}

interface AudienceMember {
  customerId: string;
  consentId: string;
  /** True when the customer follows the sending scope itself. */
  directFollower: boolean;
  /** 1 (the default when no preference row exists) means direct follows only. */
  followedOnly: number;
  quietHoursStartMin: number | null;
  quietHoursEndMin: number | null;
}

interface SubscriptionRow {
  id: string;
  customerId: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

interface RecipientRow {
  id: string;
  broadcastId: string;
  customerId: string;
  subscriptionId: string | null;
  consentId: string | null;
  status: MarketingBroadcastRecipientStatus;
  errorCode: string | null;
  createdAt: Date;
}

/**
 * Minutes since local midnight for `nowMs` at a fixed UTC offset.
 *
 * Every timezone this platform books against has a fixed offset (see
 * `business-timezone.ts`), which is what makes this arithmetic rather than a
 * calendar lookup.
 */
export function localMinuteOfDay(nowMs: number, offsetMinutes: number): number {
  const localMinutes = Math.floor(nowMs / 60_000) + offsetMinutes;
  return ((localMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Is `nowMs` inside the recipient's quiet window, read in the timezone of the
 * sender?
 *
 * Three cases, and the wrapping one is the normal one: 23:00-07:00 is what a
 * person actually means by quiet hours, and it is the case a naive
 * `start <= m && m < end` gets backwards. A window whose bounds are equal is
 * zero-length, not a whole day — the way to silence everything is
 * `marketingEnabled = 0`, which says so.
 */
export function isWithinQuietHours(
  nowMs: number,
  offsetMinutes: number,
  startMin: number | null,
  endMin: number | null,
): boolean {
  if (startMin == null || endMin == null || startMin === endMin) return false;
  const minute = localMinuteOfDay(nowMs, offsetMinutes);
  return startMin < endMin
    ? minute >= startMin && minute < endMin
    : minute >= startMin || minute < endMin;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function toMs(value: Date | number | null): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : value;
}

/**
 * Marketing broadcasts to followers (#335, 商圈 Phase 4).
 *
 * The three rules that make this more than a loop over subscriptions:
 *
 *  1. The rate limit is counted from `marketing_broadcasts`, so the audit
 *     trail and the limiter are the same rows and cannot disagree.
 *  2. Consent is read at fan-out time, newest row wins, and the id of the row
 *     honoured is written onto every recipient — the dispute is answered from
 *     rows, not from logs.
 *  3. Quiet hours belong to the recipient but are evaluated in the timezone of
 *     the sender, because that is the clock the shop is thinking in when it
 *     presses send. (#290 records that analytics still buckets in UTC. Do not
 *     copy that here; the tests pin a time where the two disagree.)
 */
export class BroadcastService {
  private readonly db: ReturnType<typeof drizzle>;
  private readonly push: CustomerWebPushService;

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
    this.push = new CustomerWebPushService(env.DB as never, env as never);
  }

  // ────────────────────────────── public API ──────────────────────────────

  /**
   * Resolve the audience, spend the sender's budget, fan out, and return the
   * counts. The broadcast row is written before the first delivery so a crash
   * mid-send still shows up as a send that happened.
   */
  async send(command: SendBroadcastCommand): Promise<BroadcastResult> {
    const nowMs = command.nowMs ?? Date.now();
    const { scopeType, scopeId } = command;

    await this.assertScopeExists(scopeType, scopeId);
    await this.assertWithinRateLimit(scopeType, scopeId, nowMs);

    const offsetMinutes = await this.senderOffsetMinutes(scopeType, scopeId);
    const audience = await this.resolveAudience(command);

    const broadcastId = generateUUID();
    await this.db.insert(marketingBroadcasts).values({
      id: broadcastId,
      scopeType,
      scopeId,
      restaurantId: scopeType === "restaurant" ? scopeId : null,
      marketId: scopeType === "market" ? scopeId : null,
      sentBy: command.sentBy,
      title: command.title,
      body: command.body,
      url: command.url ?? null,
      audienceCount: audience.length,
      deliveredCount: 0,
      failedCount: 0,
      skippedCount: 0,
      createdAt: new Date(nowMs),
      completedAt: null,
    });

    const recipients = await this.fanOut({
      broadcastId,
      command,
      audience,
      offsetMinutes,
      nowMs,
    });

    const deliveredCount = recipients.filter(
      (row) => row.status === "delivered",
    ).length;
    const failedCount = recipients.filter(
      (row) => row.status === "failed",
    ).length;
    const skippedCount = recipients.length - deliveredCount - failedCount;

    await this.db
      .update(marketingBroadcasts)
      .set({
        deliveredCount,
        failedCount,
        skippedCount,
        completedAt: new Date(Date.now()),
      })
      .where(eq(marketingBroadcasts.id, broadcastId));

    return {
      id: broadcastId,
      audienceCount: audience.length,
      deliveredCount,
      failedCount,
      skippedCount,
    };
  }

  /** Paginated send history for one scope, newest first. */
  async listHistory(
    scopeType: MarketingBroadcastScope,
    scopeId: string,
    page: number,
    limit: number,
  ): Promise<BroadcastHistory> {
    const scopeFilter = and(
      eq(marketingBroadcasts.scopeType, scopeType),
      eq(marketingBroadcasts.scopeId, scopeId),
    );

    const [countRow] = await this.db
      .select({ total: sql<number>`COUNT(*)` })
      .from(marketingBroadcasts)
      .where(scopeFilter);
    const total = Number(countRow?.total ?? 0);

    const rows = await this.db
      .select({
        id: marketingBroadcasts.id,
        scopeType: marketingBroadcasts.scopeType,
        scopeId: marketingBroadcasts.scopeId,
        title: marketingBroadcasts.title,
        body: marketingBroadcasts.body,
        url: marketingBroadcasts.url,
        sentBy: marketingBroadcasts.sentBy,
        audienceCount: marketingBroadcasts.audienceCount,
        deliveredCount: marketingBroadcasts.deliveredCount,
        failedCount: marketingBroadcasts.failedCount,
        skippedCount: marketingBroadcasts.skippedCount,
        createdAt: marketingBroadcasts.createdAt,
        completedAt: marketingBroadcasts.completedAt,
      })
      .from(marketingBroadcasts)
      .where(scopeFilter)
      .orderBy(desc(marketingBroadcasts.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const broadcasts: BroadcastHistoryItem[] = rows.map((row) => ({
      id: row.id,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      title: row.title,
      body: row.body,
      url: row.url,
      sentBy: row.sentBy,
      audienceCount: row.audienceCount,
      deliveredCount: row.deliveredCount,
      failedCount: row.failedCount,
      skippedCount: row.skippedCount,
      createdAt: toMs(row.createdAt) ?? 0,
      completedAt: toMs(row.completedAt),
    }));

    return {
      broadcasts,
      pagination: {
        page,
        limit,
        total,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      },
    };
  }

  // ───────────────────────────── rate limiting ─────────────────────────────

  /**
   * Counted from the audit table rather than from KV. Two properties follow:
   * a rejected send leaves no row, and a row that exists was permitted — so
   * "how many did I send today" and "may I send now" read the same data.
   */
  private async assertWithinRateLimit(
    scopeType: MarketingBroadcastScope,
    scopeId: string,
    nowMs: number,
  ): Promise<void> {
    const { limit, windowMs } = MARKETING_BROADCAST_RATE_LIMITS[scopeType];

    const rows = await this.db
      .select({ createdAt: marketingBroadcasts.createdAt })
      .from(marketingBroadcasts)
      .where(
        and(
          eq(marketingBroadcasts.scopeType, scopeType),
          eq(marketingBroadcasts.scopeId, scopeId),
          gte(marketingBroadcasts.createdAt, new Date(nowMs - windowMs)),
        ),
      )
      .orderBy(asc(marketingBroadcasts.createdAt));

    if (rows.length < limit) return;

    // The send that has to age out of the window before a slot opens. With
    // `limit` sends in the window that is the oldest of them; if the window
    // somehow holds more (a limit lowered since), it is the one `limit` places
    // from the end.
    const blocking = rows[rows.length - limit];
    const retryAfterMs = Math.max(
      0,
      (toMs(blocking?.createdAt ?? null) ?? nowMs) + windowMs - nowMs,
    );

    throw new ApiError(
      "BROADCAST_RATE_LIMITED",
      "This sender has used its broadcast budget for now. Try again later.",
      429,
      { limit, windowMs, retryAfterMs },
    );
  }

  // ───────────────────────────── audience ─────────────────────────────

  /**
   * Followers ∩ latest marketing consent granted ∩ marketing not switched off.
   *
   * One statement rather than an id round trip per stage: `NOT EXISTS (a newer
   * consent row)` picks the newest consent per customer, which is what makes
   * "latest wins" a property of the query instead of of the order rows happen
   * to come back in. `followedOnly` is applied afterwards in memory because it
   * depends on which favorite row matched, and a customer may have two.
   */
  private async resolveAudience(
    command: SendBroadcastCommand,
  ): Promise<AudienceMember[]> {
    const { scopeType, scopeId } = command;
    const latest = alias(customerConsents, "latest_consent");
    const newer = alias(customerConsents, "newer_consent");

    const marketFollowersClause =
      scopeType === "restaurant" && command.includeMarketFollowers
        ? and(
            eq(customerFavorites.targetType, "market"),
            inArray(
              customerFavorites.targetId,
              this.db
                .select({ marketId: restaurantMarketMemberships.marketId })
                .from(restaurantMarketMemberships)
                .where(
                  and(
                    eq(restaurantMarketMemberships.restaurantId, scopeId),
                    isNull(restaurantMarketMemberships.leftAt),
                  ),
                ),
            ),
          )
        : undefined;

    const followsTarget = and(
      eq(customerFavorites.targetType, scopeType),
      eq(customerFavorites.targetId, scopeId),
    );

    const rows: AudienceRow[] = await this.db
      .select({
        customerId: customerFavorites.customerId,
        targetType: customerFavorites.targetType,
        targetId: customerFavorites.targetId,
        consentId: latest.id,
        followedOnly: customerNotificationPreferences.followedOnly,
        quietHoursStartMin: customerNotificationPreferences.quietHoursStartMin,
        quietHoursEndMin: customerNotificationPreferences.quietHoursEndMin,
      })
      .from(customerFavorites)
      .innerJoin(
        latest,
        and(
          eq(latest.customerId, customerFavorites.customerId),
          eq(latest.consentType, "marketing"),
          // The newest marketing consent row for this customer, and only it.
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(newer)
              .where(
                and(
                  eq(newer.customerId, customerFavorites.customerId),
                  eq(newer.consentType, "marketing"),
                  or(
                    sql`${newer.grantedAt} > ${latest.grantedAt}`,
                    and(
                      eq(newer.grantedAt, latest.grantedAt),
                      sql`${newer.id} > ${latest.id}`,
                    ),
                  ),
                ),
              ),
          ),
          // ...and that newest row has to be a live grant. An older granted
          // row behind a newer revocation must not resurrect the audience.
          eq(latest.granted, 1),
          isNull(latest.revokedAt),
        ),
      )
      .leftJoin(
        customerNotificationPreferences,
        eq(
          customerNotificationPreferences.customerId,
          customerFavorites.customerId,
        ),
      )
      .where(
        and(
          marketFollowersClause
            ? or(followsTarget, marketFollowersClause)
            : followsTarget,
          // A preference toggle is not a consent record; both must be true.
          // Absent row means nothing was said, which is not an objection.
          sql`COALESCE(${customerNotificationPreferences.marketingEnabled}, 1) = 1`,
        ),
      );

    return this.collapseAudience(rows, scopeType, scopeId);
  }

  /**
   * One row per customer. A customer who follows both the restaurant and its
   * market appears twice; the direct follow is the one that decides whether
   * `followedOnly` filters them out.
   */
  private collapseAudience(
    rows: AudienceRow[],
    scopeType: MarketingBroadcastScope,
    scopeId: string,
  ): AudienceMember[] {
    const byCustomer = new Map<string, AudienceMember>();

    for (const row of rows) {
      const direct = row.targetType === scopeType && row.targetId === scopeId;
      const existing = byCustomer.get(row.customerId);
      if (existing) {
        existing.directFollower = existing.directFollower || direct;
        continue;
      }
      byCustomer.set(row.customerId, {
        customerId: row.customerId,
        consentId: row.consentId,
        directFollower: direct,
        followedOnly: row.followedOnly ?? 1,
        quietHoursStartMin: row.quietHoursStartMin,
        quietHoursEndMin: row.quietHoursEndMin,
      });
    }

    // A direct follower is always in. Anyone reached only through the market
    // fan-in needs `followedOnly = 0`; the default of 1 means silence is "do
    // not include me".
    return [...byCustomer.values()].filter(
      (member) => member.directFollower || member.followedOnly === 0,
    );
  }

  private async loadSubscriptions(
    customerIds: string[],
  ): Promise<Map<string, SubscriptionRow[]>> {
    const byCustomer = new Map<string, SubscriptionRow[]>();

    for (const ids of chunk(customerIds, ID_CHUNK_SIZE)) {
      const rows = await this.db
        .select({
          id: customerPushSubscriptions.id,
          customerId: customerPushSubscriptions.customerId,
          endpoint: customerPushSubscriptions.endpoint,
          p256dhKey: customerPushSubscriptions.p256dhKey,
          authKey: customerPushSubscriptions.authKey,
        })
        .from(customerPushSubscriptions)
        .where(
          and(
            inArray(customerPushSubscriptions.customerId, ids),
            lt(
              customerPushSubscriptions.failureCount,
              MAX_SUBSCRIPTION_FAILURES,
            ),
          ),
        )
        .orderBy(asc(customerPushSubscriptions.id));

      for (const row of rows) {
        const list = byCustomer.get(row.customerId) ?? [];
        list.push(row);
        byCustomer.set(row.customerId, list);
      }
    }

    return byCustomer;
  }

  // ───────────────────────────── fan-out ─────────────────────────────

  private async fanOut(input: {
    broadcastId: string;
    command: SendBroadcastCommand;
    audience: AudienceMember[];
    offsetMinutes: number;
    nowMs: number;
  }): Promise<RecipientRow[]> {
    const { broadcastId, command, audience, offsetMinutes, nowMs } = input;
    if (audience.length === 0) return [];

    const subscriptions = await this.loadSubscriptions(
      audience.map((member) => member.customerId),
    );

    const recipients: RecipientRow[] = [];
    const deliveries: Array<{
      member: AudienceMember;
      subscription: SubscriptionRow;
    }> = [];

    for (const member of audience) {
      if (
        isWithinQuietHours(
          nowMs,
          offsetMinutes,
          member.quietHoursStartMin,
          member.quietHoursEndMin,
        )
      ) {
        recipients.push(
          this.recipientRow(broadcastId, member, null, "skipped_quiet_hours"),
        );
        continue;
      }

      const devices = subscriptions.get(member.customerId) ?? [];
      if (devices.length === 0) {
        recipients.push(
          this.recipientRow(
            broadcastId,
            member,
            null,
            "skipped_no_subscription",
          ),
        );
        continue;
      }

      for (const subscription of devices) {
        deliveries.push({ member, subscription });
      }
    }

    const payload = buildBroadcastPayload(command);
    const enabled = isWebPushEnabled(this.env as never);

    for (const batch of chunk(deliveries, DELIVERY_CONCURRENCY)) {
      const settled = await Promise.all(
        batch.map(async ({ member, subscription }) => {
          // Web push switched off platform-wide: the send is still audited,
          // as a failure with a reason, rather than silently reported as a
          // delivery to nobody.
          const result = enabled
            ? await this.push.deliverToSubscription(
                {
                  id: subscription.id,
                  endpoint: subscription.endpoint,
                  p256dhKey: subscription.p256dhKey,
                  authKey: subscription.authKey,
                },
                payload,
              )
            : { ok: false, status: 0 };

          return this.recipientRow(
            broadcastId,
            member,
            subscription.id,
            result.ok ? "delivered" : "failed",
            result.ok ? null : pushErrorCode(result.status),
          );
        }),
      );
      recipients.push(...settled);
    }

    await this.insertRecipients(recipients);
    return recipients;
  }

  private recipientRow(
    broadcastId: string,
    member: AudienceMember,
    subscriptionId: string | null,
    status: MarketingBroadcastRecipientStatus,
    errorCode: string | null = null,
  ): RecipientRow {
    return {
      id: generateUUID(),
      broadcastId,
      customerId: member.customerId,
      subscriptionId,
      consentId: member.consentId,
      status,
      errorCode,
      createdAt: new Date(),
    };
  }

  private async insertRecipients(rows: RecipientRow[]): Promise<void> {
    for (const batch of chunk(rows, INSERT_CHUNK_SIZE)) {
      await this.db.insert(marketingBroadcastRecipients).values(batch);
    }
  }

  // ───────────────────────────── scope lookups ─────────────────────────────

  private async assertScopeExists(
    scopeType: MarketingBroadcastScope,
    scopeId: string,
  ): Promise<void> {
    if (scopeType === "restaurant") {
      const [row] = await this.db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.id, scopeId))
        .limit(1);
      if (!row) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
      return;
    }

    const [row] = await this.db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.id, scopeId))
      .limit(1);
    if (!row) throw notFound("Market not found", "MARKET_NOT_FOUND");
  }

  /**
   * The clock quiet hours are read against.
   *
   * A restaurant keeps its books in `restaurants.timezone`. Markets have no
   * timezone column, so a market-scoped send uses the platform default — the
   * same constant every cross-tenant aggregate uses, spelled out here so it
   * reads as a decision rather than as an omission.
   */
  private async senderOffsetMinutes(
    scopeType: MarketingBroadcastScope,
    scopeId: string,
  ): Promise<number> {
    if (scopeType === "market") {
      return PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES;
    }

    const [row] = await this.db
      .select({ timezone: restaurants.timezone })
      .from(restaurants)
      .where(eq(restaurants.id, scopeId))
      .limit(1);

    return businessTimezoneOffsetMinutes(row?.timezone);
  }
}

/**
 * 404 and 410 both mean the browser threw the subscription away. They are kept
 * distinguishable from a transient 5xx so the audit can tell a dead device
 * from a bad afternoon at the push service.
 */
export function pushErrorCode(status: number): string {
  if (status === 404 || status === 410) return "PUSH_GONE";
  if (status === 0) return "PUSH_ERROR";
  return `PUSH_HTTP_${status}`;
}

export function buildBroadcastPayload(
  command: SendBroadcastCommand,
): Record<string, unknown> {
  return {
    type: "marketing_broadcast",
    title: command.title,
    body: command.body,
    url: command.url ?? null,
    scopeType: command.scopeType,
    scopeId: command.scopeId,
    tag: `broadcast-${command.scopeType}-${command.scopeId}`,
  };
}
