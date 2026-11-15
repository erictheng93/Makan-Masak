import {
  parseUserFacingError,
  resolveUserFacingError,
  type ErrorTranslator,
} from "@makanmasak/shared/utils/user-facing-error";

const QUOTA_EXCEEDED = "QUOTA_EXCEEDED";

/**
 * The 429 the API's quota gate answers with when a shop used up its plan for
 * the period. Generic "too many requests" copy is wrong for it: retrying never
 * helps, and the owner needs to know it is a plan limit. `details.meterKey`
 * says which limit; staff sees "orders" or "print", never the meter key.
 */
export function quotaExceededMessage(
  error: unknown,
  translate: ErrorTranslator,
): string | null {
  const parsed = parseUserFacingError(error);
  if (parsed.code !== QUOTA_EXCEEDED) return null;
  const details = (error as { response?: { data?: { error?: unknown } } })
    .response?.data?.error as { details?: { meterKey?: unknown } } | undefined;
  switch (details?.details?.meterKey) {
    case "orders.created":
      return translate("errors.quota.orders");
    case "print.jobs":
      return translate("errors.quota.print");
    case "ai.requests":
      return translate("errors.quota.ai");
    default:
      return translate("errors.quota.generic");
  }
}

/**
 * Resolves transport failures without ever exposing server diagnostic prose.
 * Callers retain their action-specific fallback for malformed legacy errors.
 */
export function resolveAdminUserFacingError(
  error: unknown,
  translate: ErrorTranslator,
  fallbackKey: string,
  options?: Parameters<typeof resolveUserFacingError>[2],
): string {
  const quota = quotaExceededMessage(error, translate);
  if (quota) return quota;
  const resolved = resolveUserFacingError(error, translate, options);
  return resolved.presentation === "unknown"
    ? translate(fallbackKey)
    : resolved.message;
}
