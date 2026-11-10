import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const LOGIN_ERROR_KEYS: Record<string, string> = {
  INVALID_CREDENTIALS: "login.invalidCredentials",
  ACCOUNT_LOCKED: "login.accountLocked",
  SHOP_REQUIRED: "login.shopRequired",
};

/**
 * Converts login transport errors into localized UI copy without exposing
 * diagnostic server messages to kitchen staff.
 */
export function resolveKitchenLoginError(
  error: unknown,
  translate: (key: string) => string,
): string {
  return resolveUserFacingError(error, translate, {
    codeKeys: LOGIN_ERROR_KEYS,
    // A 401 here is the password being rejected. Everywhere else it means the
    // session lapsed, and telling someone at the sign-in form to sign in again
    // is the one instruction they are already following.
    statusKeys: { 401: "login.invalidCredentials" },
    // Named rather than "an unknown error occurred": whatever else went wrong,
    // the reader knows they were trying to log in and what to try next.
    fallbackKey: "login.loginError",
  }).message;
}
