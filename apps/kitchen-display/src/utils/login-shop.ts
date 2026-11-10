const KEY = "mm_kitchen_login_shop";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

// Shared kitchen devices stay signed in; remembering the shop keeps the next
// sign-in (and any session-expiry redirect) on that shop's login link.
export function getRememberedShop(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && SLUG.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberShop(slug: string): void {
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    /* storage unavailable: login still works, just not remembered */
  }
}

export function clearRememberedShop(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function loginPath(): string {
  const slug = getRememberedShop();
  return slug ? `/s/${slug}` : "/login";
}

export function isLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/s/");
}
