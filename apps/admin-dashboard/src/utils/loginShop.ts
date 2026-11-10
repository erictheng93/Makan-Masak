/**
 * Staff usernames are unique per restaurant, so staff sign in from their
 * shop's own link (/s/{slug}). The slug is remembered per device so logout and
 * session-expiry bounce back to that link rather than the shop-less /login.
 */
const STORAGE_KEY = "mm_admin_login_shop";

export const SHOP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

// Mirrors the API's reserved list; the server stays authoritative.
export const RESERVED_SHOP_SLUGS: readonly string[] = [
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
];

/** Accepts only well-formed slugs, so a tampered value never reaches a URL. */
export function parseShopSlug(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && SHOP_SLUG_PATTERN.test(raw) ? raw : null;
}

export function getRememberedShop(): string | null {
  try {
    return parseShopSlug(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function rememberShop(slug: unknown): void {
  const valid = parseShopSlug(slug);
  if (!valid) return;
  try {
    localStorage.setItem(STORAGE_KEY, valid);
  } catch {
    /* storage unavailable: the link still works, it just is not remembered */
  }
}

export function clearRememberedShop(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

export const loginPathFor = (slug: string | null | undefined): string =>
  slug ? `/s/${slug}` : "/login";

/** Where logout and session expiry should land on this device. */
export const currentLoginPath = (): string => loginPathFor(getRememberedShop());
