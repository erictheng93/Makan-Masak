/**
 * The platform's own order data can never be accepted as sent (unsupported
 * currency, currency mismatch, malformed amounts). Redelivering the same order
 * cannot fix it, so the webhook denies it on the platform and acknowledges the
 * event instead of returning 500 into an endless retry loop.
 */
export class PlatformOrderRejectedError extends Error {
  override name = "PlatformOrderRejectedError";
}
