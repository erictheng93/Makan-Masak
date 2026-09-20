/** Guest credentials are order-scoped; the legacy key is only a fallback. */
const LEGACY_KEY = "guest_auth_token";

export function getGuestOrderToken(
  orderId: string | number,
  allowLegacy = true,
): string | null {
  return (
    localStorage.getItem(`${LEGACY_KEY}:${orderId}`) ??
    (allowLegacy ? localStorage.getItem(LEGACY_KEY) : null)
  );
}

export function storeGuestOrderToken(
  orderId: string | number,
  token: string,
  makeLatest = true,
): void {
  localStorage.setItem(`${LEGACY_KEY}:${orderId}`, token);
  if (makeLatest) localStorage.setItem(LEGACY_KEY, token);
}
