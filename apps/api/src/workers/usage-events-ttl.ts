import { and, isNotNull, lt } from "drizzle-orm";
import { drizzle, usageEvents } from "@makanmasak/database";
import type { Env } from "../types/env";
import { deleteFoldedBucketsBefore } from "../shared/utils/usage-buckets";

export const USAGE_EVENTS_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nightly retention sweep for both metering tables.
 *
 * Retention is unchanged at 90 days for buckets as well as events — shortening
 * it is a business decision, not a side effect of changing where the counts
 * live (#333). Buckets are far cheaper to keep: one row per restaurant, meter
 * and hour rather than one per request.
 *
 * Both halves only ever delete rows that have already been folded into
 * `usage_meters`. An un-folded row still holds usage nobody has billed for, so
 * expiring it would discard revenue rather than discard history.
 */
export async function cleanupExpiredUsageEvents(
  env: Env,
  now = Date.now(),
  ttlDays = USAGE_EVENTS_TTL_DAYS,
) {
  const cutoff = now - ttlDays * DAY_MS;

  const eventResult = await drizzle(env.DB)
    .delete(usageEvents)
    .where(
      and(
        lt(usageEvents.occurredAt, new Date(cutoff)),
        isNotNull(usageEvents.aggregatedAt),
      ),
    );

  const deletedBuckets = await deleteFoldedBucketsBefore(env.DB, cutoff);

  return {
    deleted: eventResult.meta?.changes ?? 0,
    deletedBuckets,
    cutoff,
  };
}
