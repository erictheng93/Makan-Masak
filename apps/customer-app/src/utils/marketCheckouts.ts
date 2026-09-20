import { storeGuestOrderToken } from "./guest-order-tokens";
import type { MarketCheckoutSummary } from "@/services/orderApi";
import type { MarketCheckoutResponse } from "@/services/orderApi";

const STORAGE_KEY = "makanmakan_recent_market_checkouts";
const TOKEN_STORAGE_KEY = "makanmakan_market_checkout_guest_tokens";
const MAX_RECENT_CHECKOUTS = 10;
const CHECKOUT_TTL_MS = 4 * 60 * 60 * 1000;

export interface StoredMarketCheckout {
  id: string;
  marketSlug: string;
  marketName: string;
  childOrderCount: number;
  totalAmount: number;
  paymentStatus:
    | "pending"
    | "partial_paid"
    | "paid"
    | "failed"
    | "refunded"
    | "partial_refunded";
  phoneLastDigits?: string;
  createdAt: string;
  updatedAt: number;
}

export function recordRecentMarketCheckout(
  checkout: MarketCheckoutSummary,
  phoneLastDigits?: string,
) {
  const existingCheckout = listRecentMarketCheckouts().find(
    (item) => item.id === checkout.id,
  );
  const storedCheckout: StoredMarketCheckout = {
    id: checkout.id,
    marketSlug: checkout.market.slug,
    marketName: checkout.market.name,
    childOrderCount: checkout.childOrders.length,
    totalAmount: checkout.subtotal,
    paymentStatus: checkout.payment?.status ?? "pending",
    phoneLastDigits: phoneLastDigits ?? existingCheckout?.phoneLastDigits,
    createdAt: checkout.createdAt,
    updatedAt: Date.now(),
  };

  const nextCheckouts = [
    storedCheckout,
    ...listRecentMarketCheckouts().filter(
      (item) => item.id !== storedCheckout.id,
    ),
  ].slice(0, MAX_RECENT_CHECKOUTS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCheckouts));
  } catch (error) {
    console.warn("保存最近市場訂單失敗:", error);
  }
}

export function recordMarketCheckoutGuestTokens(
  response: MarketCheckoutResponse,
) {
  for (const child of response.childOrders) {
    storeGuestOrderToken(child.order.id, child.guestToken, false);
  }
  const tokenRecords = readGuestTokenRecords();
  tokenRecords[response.checkout.id] = Object.fromEntries(
    response.childOrders.map((child) => [
      String(child.order.id),
      {
        restaurantId: child.restaurantId,
        guestToken: child.guestToken,
        tokenExpiresAt: child.tokenExpiresAt,
      },
    ]),
  );

  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenRecords));
  } catch (error) {
    console.warn("保存市場訂單訪客 token 失敗:", error);
  }
}

export function activateMarketCheckoutGuestToken(
  checkoutId: string,
  orderId: number,
) {
  const tokenRecord = readGuestTokenRecords()[checkoutId]?.[String(orderId)];
  if (!tokenRecord) return false;

  storeGuestOrderToken(orderId, tokenRecord.guestToken);
  return true;
}

/**
 * Any live guest token stored for this checkout.
 *
 * The API client puts one credential in `Authorization` — the customer JWT when
 * signed in, the guest token otherwise — so a signed-in shopper opening a
 * checkout they placed while signed out has no way to prove they hold it. The
 * market checkout endpoints accept this token in `X-Guest-Token` instead, which
 * does not collide with the JWT.
 */
export function getMarketCheckoutGuestToken(
  checkoutId: string,
): string | undefined {
  const tokenRecords = readGuestTokenRecords()[checkoutId];
  if (!tokenRecords) return undefined;

  const now = Date.now();
  return Object.values(tokenRecords).find(
    (record) => Date.parse(record.tokenExpiresAt) > now,
  )?.guestToken;
}

export function getRecentMarketCheckoutPhoneLastDigits(checkoutId: string) {
  return listRecentMarketCheckouts().find(
    (checkout) => checkout.id === checkoutId,
  )?.phoneLastDigits;
}

export function recordRecoveredMarketCheckoutGuestToken(input: {
  checkoutId: string;
  orderId: number;
  restaurantId: string;
  guestToken: string;
  tokenExpiresAt: string;
}) {
  const tokenRecords = readGuestTokenRecords();
  tokenRecords[input.checkoutId] = {
    ...(tokenRecords[input.checkoutId] ?? {}),
    [String(input.orderId)]: {
      restaurantId: input.restaurantId,
      guestToken: input.guestToken,
      tokenExpiresAt: input.tokenExpiresAt,
    },
  };

  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenRecords));
  storeGuestOrderToken(input.orderId, input.guestToken);
}

export function listRecentMarketCheckouts(): StoredMarketCheckout[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    const now = Date.now();
    const checkouts = parsed
      .filter(isStoredMarketCheckout)
      .filter((checkout) => now - checkout.updatedAt <= CHECKOUT_TTL_MS)
      .slice(0, MAX_RECENT_CHECKOUTS);

    if (checkouts.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checkouts));
    }

    return checkouts;
  } catch (error) {
    console.warn("讀取最近市場訂單失敗:", error);
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

type GuestTokenRecords = Record<
  string,
  Record<
    string,
    {
      restaurantId: string;
      guestToken: string;
      tokenExpiresAt: string;
    }
  >
>;

function readGuestTokenRecords(): GuestTokenRecords {
  try {
    const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      return {};
    }
    return parsed as GuestTokenRecords;
  } catch (error) {
    console.warn("讀取市場訂單訪客 token 失敗:", error);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    return {};
  }
}

function isStoredMarketCheckout(value: unknown): value is StoredMarketCheckout {
  if (!value || typeof value !== "object") return false;
  const checkout = value as Partial<StoredMarketCheckout>;
  return (
    typeof checkout.id === "string" &&
    typeof checkout.marketSlug === "string" &&
    typeof checkout.marketName === "string" &&
    typeof checkout.childOrderCount === "number" &&
    typeof checkout.totalAmount === "number" &&
    isPaymentStatus(checkout.paymentStatus) &&
    (checkout.phoneLastDigits === undefined ||
      typeof checkout.phoneLastDigits === "string") &&
    typeof checkout.createdAt === "string" &&
    typeof checkout.updatedAt === "number"
  );
}

function isPaymentStatus(
  value: unknown,
): value is StoredMarketCheckout["paymentStatus"] {
  return (
    value === "pending" ||
    value === "partial_paid" ||
    value === "paid" ||
    value === "failed" ||
    value === "refunded" ||
    value === "partial_refunded"
  );
}
