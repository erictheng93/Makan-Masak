/**
 * Marketing broadcast vocabulary (issue #335, 商圈 Phase 4).
 *
 * Shared so the API, the admin dashboard's compose form and the customer
 * app's follow/preference screens all spell the same strings. Every one of
 * these is persisted verbatim in `marketing_broadcasts` /
 * `marketing_broadcast_recipients`, so changing a member is a migration, not
 * a rename.
 */

/** Who a broadcast is sent *as*. Also the rate-limit key's first half. */
export const MARKETING_BROADCAST_SCOPES = ["market", "restaurant"] as const;

export type MarketingBroadcastScope =
  (typeof MARKETING_BROADCAST_SCOPES)[number];

/**
 * What happened to one (broadcast, recipient) pair.
 *
 * Both `skipped_*` members exist so a follower who received nothing can be
 * told apart from a follower who was never eligible — the audit table is the
 * only place that distinction survives, because nothing is queued for retry.
 */
export const MARKETING_BROADCAST_RECIPIENT_STATUSES = [
  "delivered",
  "failed",
  "skipped_quiet_hours",
  "skipped_no_subscription",
] as const;

export type MarketingBroadcastRecipientStatus =
  (typeof MARKETING_BROADCAST_RECIPIENT_STATUSES)[number];

/** Per-scope send budget, counted from the audit table over a rolling window. */
export const MARKETING_BROADCAST_RATE_LIMITS: Record<
  MarketingBroadcastScope,
  { limit: number; windowMs: number }
> = {
  // A market speaks for every vendor in it, so its budget is the tighter one.
  market: { limit: 1, windowMs: 24 * 60 * 60 * 1000 },
  restaurant: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
};

/** Hard caps, enforced by zod at the boundary and by CHECK in the schema. */
export const MARKETING_BROADCAST_TITLE_MAX_LENGTH = 80;
export const MARKETING_BROADCAST_BODY_MAX_LENGTH = 300;

/** Minutes-from-midnight bounds for a quiet-hours boundary. */
export const QUIET_HOURS_MIN_MINUTE = 0;
export const QUIET_HOURS_MAX_MINUTE = 1439;
