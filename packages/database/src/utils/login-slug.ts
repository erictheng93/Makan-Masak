/** Shop code used in staff login URLs (`/s/{slug}`). Stored in restaurants.login_slug. */
export const LOGIN_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const RESERVED_LOGIN_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "login",
  "logout",
  "s",
  "www",
  "kitchen",
  "pos",
  "help",
  "support",
  "static",
  "assets",
  "dashboard",
  "settings",
  "auth",
  "signup",
  "register",
]);

export function normalizeLoginSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidLoginSlug(slug: string): boolean {
  return LOGIN_SLUG_PATTERN.test(slug) && !slug.includes("--");
}

/** Same derivation as migration 0041's backfill: `shop-` + last 8 hex of the id. */
export function loginSlugFromId(id: string): string {
  return `shop-${id.replace(/-/g, "").toLowerCase().slice(-8)}`;
}

/** Fallback when the id-derived slug is already taken. */
export function randomLoginSlug(): string {
  return `shop-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** True when a D1/SQLite error is the restaurants.login_slug unique index. */
export function isLoginSlugConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e: unknown = error; e && !seen.has(e); ) {
    seen.add(e);
    // Plain substring search, not a regex: `failed.*login_slug` backtracks
    // quadratically on a message that repeats the prefix (CodeQL js/polynomial-redos).
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
    const failed = msg.indexOf("unique constraint failed");
    if (
      msg.includes("restaurants_login_slug_unique") ||
      (failed !== -1 && msg.includes("login_slug", failed))
    ) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
