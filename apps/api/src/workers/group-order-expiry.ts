/**
 * Group Order Expiry Sweep
 *
 * Drives the three things a group order needs once nobody is looking at it:
 * a five-minute warning before it expires, auto-submit or cancel at expiry,
 * and recovery of a finalize claim whose isolate died mid-flight.
 *
 * Queries go through Drizzle rather than raw SQL. This worker runs unattended
 * and creates real orders, so a column or status rename has to fail at compile
 * time — a runtime failure here is one nobody is watching.
 */

import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, gt, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { groupActivityLogs, groupOrders } from "@makanmasak/database";
import type {
  GroupOrderFinalizeFailure,
  GroupOrderSettings,
} from "@makanmasak/shared-types";
import {
  EMPTY_GROUP_ORDER_ERROR,
  GroupOrdersService,
} from "../features/group-orders/services/GroupOrdersService";
import type { GroupOrderStatus } from "../features/group-orders/types";
import type { Env } from "../types/env";
import { RealtimeEventType } from "@makanmasak/shared-types";
import { broadcastGroupOrderEvent } from "../features/group-orders/services/group-order-broadcast";

export const GROUP_ORDER_EXPIRY_CRON = "*/5 * * * *";
export const GROUP_ORDER_EXPIRY_WARNING_MS = 5 * 60 * 1000;
export const GROUP_ORDER_FINALIZING_STALE_MS = 10 * 60 * 1000;

// Typed rather than inlined so an invalid status is a compile error here, the
// same way it is everywhere else that touches group_orders.status.
const ACTIVE: GroupOrderStatus = "active";
const CANCELLED: GroupOrderStatus = "cancelled";
const FINALIZING: GroupOrderStatus = "finalizing";
const FINALIZING_FAILED: GroupOrderStatus = "finalizing_failed";

/**
 * Written into `settings.finalizeFailure.code` when the sweep finds a claim
 * that died after the real order was created but before the split resolved.
 * Distinct from the split-level codes so an operator can tell "the split was
 * attempted and rejected" apart from "nobody ever got that far".
 */
export const ABANDONED_FINALIZE_CLAIM_CODE = "FINALIZE_CLAIM_ABANDONED";

export interface GroupOrderExpirySweepResult {
  finalized: number;
  cancelled: number;
  warned: number;
  /**
   * Claims that died after their real order was created and have been moved to
   * `finalizing_failed` so an operator can recover them. A non-zero value is
   * not an error, but it does mean money is outstanding on those groups.
   */
  awaitingRecovery: number;
  errors: string[];
}

export type GroupOrderSweepDb = ReturnType<typeof drizzle>;

interface SweepOptions {
  now?: Date;
  /** Injectable for tests; defaults to a Drizzle instance over `env.DB`. */
  db?: GroupOrderSweepDb;
  serviceFactory?: (env: Env) => Pick<GroupOrdersService, "finalizeGroupOrder">;
}

const sweepColumns = {
  id: groupOrders.id,
  restaurantId: groupOrders.restaurantId,
  shareCode: groupOrders.shareCode,
  expiresAt: groupOrders.expiresAt,
  settings: groupOrders.settings,
};

type SweepGroupOrder = {
  id: string;
  restaurantId: string;
  shareCode: string;
  expiresAt: Date;
  settings: GroupOrderSettings | null;
};

/**
 * `settings` is a JSON column, so Drizzle hands back an object. The guard is
 * for rows written before that was true, and for a blob that somehow decoded
 * to a non-object — neither should take down a sweep over every other group.
 */
function readSettings(
  settings: SweepGroupOrder["settings"],
): GroupOrderSettings {
  if (!settings || typeof settings !== "object") return {};
  return { ...settings };
}

async function cancelExpiredGroupOrder(
  db: GroupOrderSweepDb,
  groupOrder: SweepGroupOrder,
  now: Date,
): Promise<boolean> {
  // Conditional update: another sweep or the host may have moved this group on
  // since it was selected. `returning` is how we learn whether we won.
  const cancelled = await db
    .update(groupOrders)
    .set({ status: CANCELLED, updatedAt: now })
    .where(
      and(eq(groupOrders.id, groupOrder.id), eq(groupOrders.status, ACTIVE)),
    )
    .returning({ id: groupOrders.id });

  if (cancelled.length === 0) return false;

  await db.insert(groupActivityLogs).values({
    id: randomUUID(),
    groupOrderId: groupOrder.id,
    memberId: null,
    action: "group_expired",
    description: "Group order expired and was cancelled",
    metadata: { expiredAt: groupOrder.expiresAt.getTime() },
    createdAt: now,
  });

  return true;
}

/**
 * Move a finalize claim whose isolate died after the real order was created
 * into `finalizing_failed`.
 *
 * The bulk sweep at the end of `sweepExpiringGroupOrders` refuses these rows on
 * purpose: handing one back to a second finalizer would place a second order.
 * But refusing them is not the same as resolving them. Nothing else moves a
 * group out of `finalizing` — `finalizeGroupOrder` rejects a group that is
 * already `finalizing`, and `recoverFinalization` only accepts
 * `finalizing_failed` — so the group sits with a real order outstanding, no
 * split, nobody charged, and no action available to the restaurant. That is
 * precisely the condition `finalizing_failed` exists to name.
 *
 * The diagnostics carry the totals `finalizeGroupOrder` persisted onto the row
 * immediately before it split, so the recovery endpoint has the amounts it
 * needs to re-run. Nothing here is invented: it is read back from the columns
 * the finalizer wrote.
 */
async function demoteAbandonedFinalizeClaim(
  db: GroupOrderSweepDb,
  groupOrder: typeof groupOrders.$inferSelect,
  now: Date,
): Promise<boolean> {
  // The caller selects on masterOrderId being set, so this never fires. It is
  // here to narrow the type honestly: the alternative is defaulting to an
  // empty string, which would write a diagnostic record naming no order at
  // all and hand an operator a dead end to chase.
  const masterOrderId = groupOrder.masterOrderId;
  const lockedAt = groupOrder.lockedAt;
  if (!masterOrderId || !lockedAt) return false;

  const settings = readSettings(groupOrder.settings);

  // An abandoned *recovery* attempt already carries the original failure. Keep
  // it: `failedAt` is what the admin panel shows as the first failure, and
  // #231 asks specifically that a retry never overwrite it.
  const finalizeFailure: GroupOrderFinalizeFailure =
    settings.finalizeFailure ?? {
      code: ABANDONED_FINALIZE_CLAIM_CODE,
      masterOrderId,
      orderTotalCents: groupOrder.finalAmountCents ?? 0,
      serviceChargeCents: groupOrder.serviceChargeCents ?? 0,
      taxAmountCents: groupOrder.taxAmountCents ?? 0,
      splitError:
        "Finalization claim was abandoned after the order was created",
      failedAt: now.toISOString(),
    };

  // Conditional on the status we selected under: the owning isolate may have
  // woken up and finished between the read and this write.
  const demoted = await db
    .update(groupOrders)
    .set({
      status: FINALIZING_FAILED,
      settings: { ...settings, finalizeFailure },
      updatedAt: now,
    })
    .where(
      and(
        eq(groupOrders.id, groupOrder.id),
        eq(groupOrders.status, FINALIZING),
        eq(groupOrders.masterOrderId, masterOrderId),
        eq(groupOrders.lockedAt, lockedAt),
      ),
    )
    .returning({ id: groupOrders.id });

  if (demoted.length === 0) return false;

  await db.insert(groupActivityLogs).values({
    id: randomUUID(),
    groupOrderId: groupOrder.id,
    memberId: null,
    action: "finalize_claim_abandoned",
    description:
      "Finalization claim was abandoned after the order was created; awaiting recovery",
    metadata: {
      masterOrderId,
      reason: finalizeFailure.code,
    },
    createdAt: now,
  });

  return true;
}

async function invalidateGroupOrderCache(
  env: Env,
  groupOrder: SweepGroupOrder,
): Promise<void> {
  await env.CACHE_KV?.delete(`group_order:${groupOrder.id}`);
  await env.CACHE_KV?.delete(`group_order_summary:${groupOrder.id}`);
  await env.CACHE_KV?.delete(`share_code:${groupOrder.shareCode}`);
}

export async function sweepExpiringGroupOrders(
  env: Env,
  options: SweepOptions = {},
): Promise<GroupOrderExpirySweepResult> {
  const now = options.now ?? new Date();
  const warningCutoff = new Date(now.getTime() + GROUP_ORDER_EXPIRY_WARNING_MS);
  const staleBefore = new Date(now.getTime() - GROUP_ORDER_FINALIZING_STALE_MS);
  const db = options.db ?? drizzle(env.DB);
  const result: GroupOrderExpirySweepResult = {
    finalized: 0,
    cancelled: 0,
    warned: 0,
    awaitingRecovery: 0,
    errors: [],
  };

  const serviceFactory =
    options.serviceFactory ??
    ((sweepEnv: Env) => new GroupOrdersService(sweepEnv.DB, sweepEnv.CACHE_KV));

  const expiringSoon = (await db
    .select(sweepColumns)
    .from(groupOrders)
    .where(
      and(
        eq(groupOrders.status, ACTIVE),
        gt(groupOrders.expiresAt, now),
        lte(groupOrders.expiresAt, warningCutoff),
      ),
    )
    .limit(500)) as SweepGroupOrder[];

  for (const groupOrder of expiringSoon) {
    try {
      const settings = readSettings(groupOrder.settings);
      if (settings.expiryWarningSentAt) continue;

      await db
        .update(groupOrders)
        .set({
          settings: { ...settings, expiryWarningSentAt: now.toISOString() },
          updatedAt: now,
        })
        .where(
          and(
            eq(groupOrders.id, groupOrder.id),
            eq(groupOrders.status, ACTIVE),
          ),
        );
      result.warned++;
    } catch (error) {
      result.errors.push(`${groupOrder.id}: ${(error as Error).message}`);
    }
  }

  const expired = (await db
    .select(sweepColumns)
    .from(groupOrders)
    .where(and(eq(groupOrders.status, ACTIVE), lte(groupOrders.expiresAt, now)))
    .limit(500)) as SweepGroupOrder[];

  for (const groupOrder of expired) {
    try {
      const settings = readSettings(groupOrder.settings);
      if (settings.autoSubmitOnExpiry === false) {
        if (await cancelExpiredGroupOrder(db, groupOrder, now)) {
          await invalidateGroupOrderCache(env, groupOrder);
          result.cancelled++;
        }
        continue;
      }

      const finalizeResult = await serviceFactory(env).finalizeGroupOrder(
        groupOrder.id,
      );

      // An expired group with nothing in it was abandoned, not broken.
      // Finalization refuses it without touching its status, so left as an
      // error it stays `active` past its expiry and is re-selected by every
      // subsequent sweep — the same failure logged forever, and 500 rows of
      // sweep budget slowly filling with groups that can never succeed.
      if (
        !finalizeResult.success &&
        finalizeResult.error === EMPTY_GROUP_ORDER_ERROR
      ) {
        if (await cancelExpiredGroupOrder(db, groupOrder, now)) {
          await invalidateGroupOrderCache(env, groupOrder);
          result.cancelled++;
        }
        continue;
      }

      if (!finalizeResult.success) {
        result.errors.push(
          `${groupOrder.id}: ${
            finalizeResult.error ?? "Failed to finalize group order"
          }`,
        );
        continue;
      }
      result.finalized++;
      // Diners may still have the group page open when it auto-submits.
      await broadcastGroupOrderEvent(
        env,
        RealtimeEventType.GROUP_ORDER_COMPLETED,
        {
          groupOrderId: groupOrder.id,
          restaurantId: String(groupOrder.restaurantId),
          masterOrderId: finalizeResult.data?.masterOrderId,
        },
      );
    } catch (error) {
      result.errors.push(`${groupOrder.id}: ${(error as Error).message}`);
    }
  }

  // Recover claims whose isolate died between taking the mutex and releasing
  // it. Guarded on masterOrderId being null so a group whose real order was
  // already created is never handed back to a second finalizer.
  // `finalizing_failed` is deliberately out of scope — that is a terminal
  // state awaiting a human, not a stuck claim.
  await db
    .update(groupOrders)
    .set({ status: ACTIVE, lockedAt: null, updatedAt: now })
    .where(
      and(
        eq(groupOrders.status, FINALIZING),
        isNull(groupOrders.masterOrderId),
        isNotNull(groupOrders.lockedAt),
        lt(groupOrders.lockedAt, staleBefore),
      ),
    );

  // The other half of the same stuck claim: the order already exists, so the
  // sweep above must not touch it, but leaving it in `finalizing` strands it
  // where nothing can act on it. See demoteAbandonedFinalizeClaim.
  const abandonedClaims = await db
    .select()
    .from(groupOrders)
    .where(
      and(
        eq(groupOrders.status, FINALIZING),
        isNotNull(groupOrders.masterOrderId),
        isNotNull(groupOrders.lockedAt),
        lt(groupOrders.lockedAt, staleBefore),
      ),
    );

  for (const groupOrder of abandonedClaims) {
    try {
      if (await demoteAbandonedFinalizeClaim(db, groupOrder, now)) {
        await invalidateGroupOrderCache(env, groupOrder);
        result.awaitingRecovery++;
      }
    } catch (error) {
      result.errors.push(`${groupOrder.id}: ${(error as Error).message}`);
    }
  }

  return result;
}
