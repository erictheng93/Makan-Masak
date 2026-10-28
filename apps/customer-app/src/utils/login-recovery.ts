const first = (value: unknown): string => {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
};

/**
 * `/login?mode=otp&phone=...` is an explicit request to prove ownership of a
 * phone (waiting-list ticket / history recovery). The caller may already hold a
 * session — e.g. an OAuth-only account — and the recovery has to run anyway, so
 * neither the guest-only route guard nor LoginView may bounce them to /orders.
 * Verifying the OTP issues a session for the customer that owns the phone.
 */
export const isOtpRecoveryRequest = (query: Record<string, unknown>): boolean =>
  first(query.mode) === "otp" && first(query.phone).trim() !== "";

/** Only in-app absolute paths; "//host" and "/\host" are protocol-relative. */
export const safeRedirectPath = (value: string): string | null =>
  value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : null;
