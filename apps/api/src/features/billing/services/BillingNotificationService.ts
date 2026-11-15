import {
  BILLING_NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DISPATCH_STATUSES,
  createEmailProvider,
  drizzle,
  restaurants,
  type MeterKey,
  type PlanTier,
  type BillingNotificationKind,
  type NotificationChannel,
  type NotificationDispatchStatus,
} from "@makanmasak/database";
import { generateUUID } from "@makanmasak/utils";
import { eq } from "drizzle-orm";
import type { Env } from "../../../types/env";

interface DispatchInput {
  restaurantId?: string | null;
  kind: BillingNotificationKind;
  dedupKey: string;
  channel: NotificationChannel;
  recipient?: string | null;
  subject?: string;
  text: string;
  payload?: Record<string, unknown>;
}

export interface DispatchResult {
  status: NotificationDispatchStatus;
  duplicate: boolean;
}

function encodePayload(payload: Record<string, unknown> | undefined) {
  return payload ? JSON.stringify(payload) : null;
}

export class BillingNotificationService {
  constructor(private readonly env: Env) {}

  async send(input: DispatchInput): Promise<DispatchResult> {
    const duplicate = await this.hasDispatch(input);
    if (duplicate) {
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_DUPLICATE,
        duplicate: true,
      };
    }

    if (input.channel === NOTIFICATION_CHANNELS.SLACK) {
      return await this.sendSlack(input);
    }

    return await this.sendEmail(input);
  }

  private async hasDispatch(input: DispatchInput) {
    const row = await this.env.DB.prepare(
      `SELECT id
         FROM notification_dispatch_log
        WHERE restaurant_id IS ?
          AND kind = ?
          AND dedup_key = ?
          AND channel = ?
        LIMIT 1`,
    )
      .bind(
        input.restaurantId ?? null,
        input.kind,
        input.dedupKey,
        input.channel,
      )
      .first<{ id: string }>();

    return Boolean(row);
  }

  private async sendSlack(input: DispatchInput): Promise<DispatchResult> {
    if (!this.env.SLACK_WEBHOOK_URL) {
      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
      );
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
        duplicate: false,
      };
    }

    try {
      const response = await fetch(this.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text }),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.status}`);
      }

      await this.record(input, NOTIFICATION_DISPATCH_STATUSES.SENT);
      return { status: NOTIFICATION_DISPATCH_STATUSES.SENT, duplicate: false };
    } catch (error) {
      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.FAILED,
        error instanceof Error ? error.message : String(error),
      );
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.FAILED,
        duplicate: false,
      };
    }
  }

  private async sendEmail(input: DispatchInput): Promise<DispatchResult> {
    const from =
      this.env.BILLING_EMAIL_FROM ??
      this.env.NOTIFICATION_FROM_EMAIL ??
      "notifications@makanmasak.com";
    const provider = createEmailProvider(this.env, from);
    if (!provider || !input.recipient) {
      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
      );
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
        duplicate: false,
      };
    }

    try {
      const result = await provider.sendEmail({
        to: input.recipient,
        subject: input.subject ?? "MakanMasak billing notification",
        text: input.text,
        html: `<pre>${input.text
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;")}</pre>`,
      });
      if (!result.success)
        throw new Error(result.error ?? "Email delivery failed");

      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.SENT,
        null,
        result.messageId ?? null,
      );
      return { status: NOTIFICATION_DISPATCH_STATUSES.SENT, duplicate: false };
    } catch (error) {
      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.FAILED,
        error instanceof Error ? error.message : String(error),
      );
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.FAILED,
        duplicate: false,
      };
    }
  }

  private async record(
    input: DispatchInput,
    status: NotificationDispatchStatus,
    errorMessage: string | null = null,
    providerMessageId: string | null = null,
  ) {
    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO notification_dispatch_log (
          id, restaurant_id, kind, dedup_key, channel, status, recipient,
          provider_message_id, error_message, payload, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        generateUUID(),
        input.restaurantId ?? null,
        input.kind,
        input.dedupKey,
        input.channel,
        status,
        input.recipient ?? null,
        providerMessageId,
        errorMessage,
        encodePayload(input.payload),
        Date.now(),
      )
      .run();
  }
}

interface TrialReminderRow {
  restaurant_id: string;
  restaurant_name: string;
  email: string | null;
  trial_ends_at_ms: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_ENDED_LOOKBACK_DAYS = 7;

function endingCopy(restaurantName: string, daysLeft: number) {
  const days = `${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  return {
    subject: `Your MakanMasak trial ends in ${days}`,
    text: `The MakanMasak trial for ${restaurantName} ends in ${days}.`,
  };
}

export class BillingReminderService {
  constructor(private readonly env: Env) {}

  /**
   * Windows are ranges on time-remaining, not exact 24h slots, so a skipped
   * cron run is caught up on the next one. Exactly-once comes from the
   * dispatch log (see the NOT EXISTS below), not from the window.
   */
  async sendTrialEndingReminders(now = Date.now()) {
    const trial3d = await this.sendTrialReminderWindow(
      now,
      now + 2 * DAY_MS,
      now + 4 * DAY_MS,
      BILLING_NOTIFICATION_KINDS.TRIAL_3D,
      endingCopy,
    );
    const trial1d = await this.sendTrialReminderWindow(
      now,
      now,
      now + 2 * DAY_MS,
      BILLING_NOTIFICATION_KINDS.TRIAL_1D,
      endingCopy,
    );
    // An expired trial keeps working (nag-only); this is only the notice that
    // it ended. The lookback keeps a long outage from mailing stale expiries.
    const trial0d = await this.sendTrialReminderWindow(
      now,
      now - TRIAL_ENDED_LOOKBACK_DAYS * DAY_MS,
      now,
      BILLING_NOTIFICATION_KINDS.TRIAL_0D,
      (name) => ({
        subject: "Your MakanMasak trial has ended",
        text: `The MakanMasak trial for ${name} has ended. Everything keeps working, but please choose a plan to support MakanMasak.`,
      }),
    );

    return {
      attempted: trial3d.attempted + trial1d.attempted + trial0d.attempted,
    };
  }

  /** Not-yet-notified trials whose end falls in [from, to). */
  private async sendTrialReminderWindow(
    now: number,
    from: number,
    to: number,
    kind: BillingNotificationKind,
    copy: (
      restaurantName: string,
      daysLeft: number,
    ) => { subject: string; text: string },
  ) {
    // Filtering already-notified rows in SQL matters: filtering in send() would
    // let the same 250 rows fill LIMIT every day and starve the rest.
    const rows = await this.env.DB.prepare(
      `SELECT s.restaurant_id, r.name AS restaurant_name, r.email,
              s.trial_ends_at_ms
         FROM shop_subscriptions s
         JOIN restaurants r ON r.id = s.restaurant_id
        WHERE s.is_active = 1
          AND s.plan_tier = 'trial'
          AND s.trial_ends_at_ms >= ?2
          AND s.trial_ends_at_ms < ?3
          AND NOT EXISTS (
            SELECT 1 FROM notification_dispatch_log d
             WHERE d.restaurant_id = s.restaurant_id
               AND d.kind = ?1
               AND d.dedup_key = ?1 || ':' || s.restaurant_id || ':' || s.trial_ends_at_ms
               AND d.channel = ?4)
        ORDER BY s.trial_ends_at_ms
        LIMIT 250`,
    )
      .bind(kind, from, to, NOTIFICATION_CHANNELS.EMAIL)
      .all<TrialReminderRow>();

    let attempted = 0;
    for (const row of rows.results ?? []) {
      attempted++;
      await new BillingNotificationService(this.env).send({
        restaurantId: row.restaurant_id,
        kind,
        dedupKey: `${kind}:${row.restaurant_id}:${row.trial_ends_at_ms}`,
        channel: NOTIFICATION_CHANNELS.EMAIL,
        recipient: row.email,
        ...copy(
          row.restaurant_name,
          Math.max(1, Math.ceil((row.trial_ends_at_ms - now) / DAY_MS)),
        ),
        payload: { trialEndsAt: row.trial_ends_at_ms },
      });
    }

    return { attempted };
  }
}

/** Name and billing email of a restaurant, for owner-facing billing mail. */
export async function restaurantContact(
  db: Env["DB"],
  restaurantId: string,
): Promise<{ name: string; email: string | null } | null> {
  const [row] = await drizzle(db)
    .select({ name: restaurants.name, email: restaurants.email })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return row ?? null;
}

const METER_LABELS: Record<MeterKey, string> = {
  "orders.created": "orders",
  "print.jobs": "receipt prints",
  "ai.requests": "AI requests",
  "api.requests": "API requests",
  "storage.bytes": "storage",
};

// English only, like every other billing email (trial reminders above).
export function quotaHardOwnerCopy(restaurantName: string, meterKey: MeterKey) {
  const what = METER_LABELS[meterKey] ?? meterKey;
  return {
    subject: `MakanMasak: ${restaurantName} has reached its ${what} limit`,
    text: `${restaurantName} has used all the ${what} included in its plan for this billing cycle. New ${what} are paused until the next cycle starts. You can upgrade your plan from the admin dashboard; an upgrade takes effect immediately.`,
  };
}

const formatDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function planChangeCopy(
  event: "applied" | "scheduled" | "cancelled",
  restaurantName: string,
  input: { fromTier: PlanTier; toTier: PlanTier; effectiveAt: number },
) {
  if (event === "applied") {
    return {
      subject: `Your MakanMasak plan is now ${input.toTier}`,
      text: `${restaurantName} moved from the ${input.fromTier} plan to the ${input.toTier} plan on ${formatDay(input.effectiveAt)} (UTC). A new billing cycle started then.`,
    };
  }
  if (event === "scheduled") {
    return {
      subject: `Your MakanMasak plan will change to ${input.toTier}`,
      text: `${restaurantName} will move from the ${input.fromTier} plan to the ${input.toTier} plan on ${formatDay(input.effectiveAt)} (UTC), at the end of the current billing cycle. Until then nothing changes. You can cancel this from the admin dashboard.`,
    };
  }
  return {
    subject: "Your MakanMasak plan change was cancelled",
    text: `The scheduled move of ${restaurantName} to the ${input.toTier} plan has been cancelled. ${restaurantName} stays on the ${input.fromTier} plan.`,
  };
}

export { BILLING_NOTIFICATION_KINDS, NOTIFICATION_CHANNELS };
