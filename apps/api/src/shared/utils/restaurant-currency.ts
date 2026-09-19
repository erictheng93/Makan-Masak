/**
 * Server-side authority for the currency of a restaurant's money.
 *
 * Every money column stores integer cents, and nothing in a cents value says
 * which currency it is in. The currency lives in `restaurants.settings.currency`
 * — a free-form JSON string — and before this module each payment path took it
 * from the request body instead, defaulting to "TWD" when the client sent
 * nothing. That let a TWD stored-value card (NT$100 = 10000 cents) settle a
 * RM100 MYR checkout, and recorded every MYR cashier payment as TWD.
 *
 * The rules here:
 *
 * - The restaurant's setting decides. A client-supplied currency or country is
 *   only ever compared against it (`assertClientCurrencyMatches`), never used.
 * - An unset setting (absent, null, empty) is the platform default, TWD — the
 *   state every restaurant created before the setting existed is in.
 * - A setting that is present but not a supported code fails closed with
 *   `RESTAURANT_CURRENCY_INVALID`. Treating "USD" (or an "NTD" typed into the
 *   JSON) as TWD would reintroduce exactly the silent reinterpretation this
 *   module exists to stop, so it is a 500: the merchant configuration is
 *   broken, the caller cannot fix it, and a 5xx releases the payment
 *   idempotency key so the same request can be retried once it is repaired.
 */
import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";
import { restaurants } from "@makanmasak/database";
import {
  DEFAULT_CURRENCY,
  normalizeCurrencyCode,
  type CurrencyCode,
} from "@makanmasak/utils";
import type { Env } from "../../types/env";
import { ApiError, badRequest, notFound } from "./api-error";

export type { CurrencyCode };
export type CurrencyCountryCode = "TW" | "MY" | "VN";

const COUNTRY_BY_CURRENCY: Record<CurrencyCode, CurrencyCountryCode> = {
  TWD: "TW",
  MYR: "MY",
  VND: "VN",
};

/**
 * The country a currency is settled in. Payment records carry a
 * `country_code` next to the currency (the market-checkout provider split and
 * `payment_transactions`); it is derived, never taken from the client, so the
 * two cannot disagree.
 */
export function countryForCurrency(
  currency: CurrencyCode,
): CurrencyCountryCode {
  return COUNTRY_BY_CURRENCY[currency];
}

function readSettingsObject(settings: unknown): Record<string, unknown> | null {
  if (settings == null) return null;
  if (typeof settings === "string") {
    // Legacy rows double-encoded the JSON column. An unparseable string has
    // no currency key to read, so it resolves like an absent setting.
    try {
      return readSettingsObject(JSON.parse(settings));
    } catch {
      return null;
    }
  }
  if (typeof settings !== "object" || Array.isArray(settings)) return null;
  return settings as Record<string, unknown>;
}

/**
 * Resolve a restaurant's currency from its `settings` JSON.
 *
 * Unset → `DEFAULT_CURRENCY`. Set to anything that is not a supported code →
 * throws `RESTAURANT_CURRENCY_INVALID` rather than defaulting.
 */
export function currencyFromRestaurantSettings(
  settings: unknown,
  restaurantId: string,
): CurrencyCode {
  const raw = readSettingsObject(settings)?.currency;
  if (raw === undefined || raw === null) return DEFAULT_CURRENCY;
  if (typeof raw === "string" && raw.trim() === "") return DEFAULT_CURRENCY;

  const currency = normalizeCurrencyCode(raw);
  if (!currency) {
    throw new ApiError(
      "RESTAURANT_CURRENCY_INVALID",
      "Restaurant currency is not configured correctly",
      500,
      { restaurantId },
    );
  }
  return currency;
}

/**
 * Lenient twin of `currencyFromRestaurantSettings`, for read-only listings
 * that label prices from many restaurants at once (discovery search, popular
 * dishes, service search, a customer's order history).
 *
 * An invalid setting falls back to `DEFAULT_CURRENCY` instead of throwing.
 * The strict variant fails closed because a payment would otherwise settle in
 * the wrong currency; here nothing is charged, and a 500 would take down a
 * whole cross-restaurant page over one merchant's broken JSON. The payment
 * paths still refuse that restaurant, so the fallback label can never become
 * a charge. Never use this where the result decides money.
 */
export function displayCurrencyFromRestaurantSettings(
  settings: unknown,
): CurrencyCode {
  return (
    normalizeCurrencyCode(readSettingsObject(settings)?.currency) ??
    DEFAULT_CURRENCY
  );
}

/** The currency a single restaurant is paid in. */
export async function resolveRestaurantCurrency(
  d1: Env["DB"],
  restaurantId: string,
): Promise<CurrencyCode> {
  const row = await drizzle(d1)
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .get();
  if (!row) {
    throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
  }
  return currencyFromRestaurantSettings(row.settings, restaurantId);
}

/**
 * The one currency a set of restaurants shares — a market checkout's vendors,
 * whose child orders are charged as a single sum. Vendors in different
 * currencies cannot be summed, so that is `MIXED_CURRENCY_CHECKOUT` (409).
 */
export async function resolveSharedRestaurantCurrency(
  d1: Env["DB"],
  restaurantIds: readonly string[],
): Promise<CurrencyCode> {
  const ids = [...new Set(restaurantIds)];
  if (ids.length === 0) {
    throw badRequest("At least one restaurant is required");
  }

  const rows = await drizzle(d1)
    .select({ id: restaurants.id, settings: restaurants.settings })
    .from(restaurants)
    .where(inArray(restaurants.id, ids))
    .all();
  if (rows.length !== ids.length) {
    throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
  }

  return sharedCurrency(
    rows.map((row) => ({
      restaurantId: row.id,
      currency: currencyFromRestaurantSettings(row.settings, row.id),
    })),
  );
}

/**
 * Reduce per-restaurant currencies to the single one they share, or throw
 * `MIXED_CURRENCY_CHECKOUT`. Exposed for callers that already hold the
 * restaurant rows (market checkout creation).
 */
export function sharedCurrency(
  entries: ReadonlyArray<{ restaurantId: string; currency: CurrencyCode }>,
): CurrencyCode {
  const first = entries[0];
  if (!first) {
    throw badRequest("At least one restaurant is required");
  }
  if (entries.some((entry) => entry.currency !== first.currency)) {
    throw new ApiError(
      "MIXED_CURRENCY_CHECKOUT",
      "All vendors in one checkout must use the same currency",
      409,
      {
        currencies: Object.fromEntries(
          entries.map((entry) => [entry.restaurantId, entry.currency]),
        ),
      },
    );
  }
  return first.currency;
}

/**
 * A client may still send `currency` / `country` (older app builds do). They
 * are checked, not trusted: absent is fine, different from the server's
 * answer is `CURRENCY_MISMATCH` (400) — the client is showing the customer a
 * price in a currency it will not be charged in.
 */
export function assertClientCurrencyMatches(
  serverCurrency: CurrencyCode,
  client: { currency?: string | null; country?: string | null },
): void {
  const expectedCountry = countryForCurrency(serverCurrency);
  const currencyDiffers =
    client.currency != null &&
    client.currency.trim().toUpperCase() !== serverCurrency;
  const countryDiffers =
    client.country != null &&
    client.country.trim().toUpperCase() !== expectedCountry;
  if (currencyDiffers || countryDiffers) {
    throw new ApiError(
      "CURRENCY_MISMATCH",
      "Requested currency does not match the restaurant currency",
      400,
      {
        expectedCurrency: serverCurrency,
        expectedCountry,
        ...(client.currency != null && { currency: client.currency }),
        ...(client.country != null && { country: client.country }),
      },
    );
  }
}

/**
 * Resolve the server currency and check the client's claim against it in one
 * step — the shape every payment entry point needs.
 */
export function resolveCurrencyForRequest(
  serverCurrency: CurrencyCode,
  client: { currency?: string | null; country?: string | null },
): { currency: CurrencyCode; country: CurrencyCountryCode } {
  assertClientCurrencyMatches(serverCurrency, client);
  return {
    currency: serverCurrency,
    country: countryForCurrency(serverCurrency),
  };
}
