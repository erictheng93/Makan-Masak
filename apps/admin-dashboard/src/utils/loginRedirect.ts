/**
 * Where to send a user back to after they re-authenticate.
 *
 * Production keeps the access token in memory only, so every reload leans on
 * restoreSession() succeeding. When it does not, the guard bounces to /login —
 * and the destination used to be dropped on the floor, because LoginView always
 * fell through to getDefaultRoute(). An admin refreshing /dashboard/monitoring
 * landed on /dashboard/platform instead of the page they were reading.
 */
export const LOGIN_PATH = "/login";
export const LOGIN_REDIRECT_QUERY = "redirect";
export const KITCHEN_DISPLAY_URL =
  import.meta.env.VITE_KITCHEN_DISPLAY_URL || "http://localhost:3002";

export function redirectToKitchenDisplay(
  url: string,
  location: Pick<Location, "replace"> = window.location,
): void {
  location.replace(url);
}

/**
 * Keep only same-origin, absolute-path targets.
 *
 * Anything else is dropped rather than repaired: a full URL, a protocol-relative
 * "//evil.com", or the "/\evil.com" variant browsers normalise to the same
 * thing. Sanitising by rewriting invites bypasses, so an unrecognised shape
 * simply falls back to the role's default route.
 */
export function sanitizeLoginRedirect(target: unknown): string | null {
  if (typeof target !== "string" || target.length === 0) return null;
  if (!target.startsWith("/")) return null;
  if (target.startsWith("//") || target.startsWith("/\\")) return null;

  // Bouncing back to the login page would just loop.
  const [path] = target.split(/[?#]/, 1);
  if (path === LOGIN_PATH) return null;

  return target;
}

/**
 * Reads the redirect target a guard stashed in the query string. Router query
 * values are `string | string[] | null`, hence the array unwrap.
 */
export function readLoginRedirect(value: unknown): string | null {
  const raw = Array.isArray(value)
    ? value.find((v) => typeof v === "string")
    : value;
  return sanitizeLoginRedirect(raw);
}

/**
 * The login route to navigate to, carrying `fullPath` so the user comes back.
 */
export function loginRouteFor(fullPath: string) {
  const redirect = sanitizeLoginRedirect(fullPath);
  return redirect
    ? { path: LOGIN_PATH, query: { [LOGIN_REDIRECT_QUERY]: redirect } }
    : { path: LOGIN_PATH };
}

/**
 * Same thing as a plain URL, for the axios auth-failure handler which owns a
 * `window.location` rather than a router.
 */
export function loginUrlFor(fullPath: string): string {
  const redirect = sanitizeLoginRedirect(fullPath);
  return redirect
    ? `${LOGIN_PATH}?${LOGIN_REDIRECT_QUERY}=${encodeURIComponent(redirect)}`
    : LOGIN_PATH;
}
