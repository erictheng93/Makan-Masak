import {
  ApiError,
  DEFAULT_CURRENCY,
  floorToCurrencyCents,
  normalizeCurrencyCode,
  roundToCurrencyCents,
  type CurrencyCode,
} from "@makanmasak/utils";
import { fromCents } from "./money";

/**
 * Reading `restaurants.settings.currency`, which is a free-form JSON string
 * and so can hold anything an older admin build wrote (`"RM"`, `"NTD"`, an
 * empty string). There is **one** rule for what to do with an unsupported
 * value, and it is the same rule the api-side authority
 * (`apps/api/src/shared/utils/restaurant-currency.ts`) states:
 *
 * - **Money fails closed.** Anything that prices, charges, splits or discounts
 *   uses `requireRestaurantCurrency` and throws `RESTAURANT_CURRENCY_INVALID`.
 *   Defaulting to TWD there is what created the failure this pairs with: a
 *   restaurant set to `"RM"` took orders priced on the TWD step, and the
 *   payment side — which has always failed closed — then refused every one of
 *   them, so the orders were uncollectable and nothing said why. Refusing to
 *   write the order is strictly better than writing one nobody can pay.
 * - **Display falls back.** Read-only labelling uses
 *   `displayRestaurantCurrency`, because a 500 there would take down a
 *   cross-restaurant listing over one merchant's broken JSON, and a label
 *   cannot become a charge — the money paths above still refuse that
 *   restaurant.
 *
 * Unset (absent, null, empty) is not "invalid": it is the platform default,
 * TWD, which is the state of every restaurant created before the setting
 * existed. `settings.currency` is a zod enum on write, so an unsupported value
 * can only be a legacy row.
 */
export function requireRestaurantCurrency(
  value: unknown,
  restaurantId?: string,
): CurrencyCode {
  if (value === undefined || value === null) return DEFAULT_CURRENCY;
  if (typeof value === "string" && value.trim() === "") return DEFAULT_CURRENCY;

  const currency = normalizeCurrencyCode(value);
  if (!currency) {
    // The restaurant id goes in `details`, which the error handler logs but
    // strips from a 5xx response body — it names a merchant's broken
    // configuration, which the caller can neither read nor fix.
    throw new ApiError(
      "RESTAURANT_CURRENCY_INVALID",
      "Restaurant currency is not configured correctly",
      500,
      restaurantId ? { restaurantId } : undefined,
    );
  }
  return currency;
}

/** Lenient twin of {@link requireRestaurantCurrency}. Display only. */
export function displayRestaurantCurrency(value: unknown): CurrencyCode {
  return normalizeCurrencyCode(value) ?? DEFAULT_CURRENCY;
}

export interface OrderTotalsInput {
  currency: CurrencyCode;
  /** Sum of the line totals, exactly as stored. */
  subtotalCents: number;
  /** Fractional, 0.1 = 10%. Ignored when `taxAmountCents` is given. */
  taxRate?: number;
  /** Fractional, 0.1 = 10%. Ignored when `serviceChargeCents` is given. */
  serviceChargeRate?: number;
  /** An already-charged tax amount to keep as is instead of re-deriving it. */
  taxAmountCents?: number;
  /** An already-charged service charge to keep as is. */
  serviceChargeCents?: number;
  discountCents?: number;
  deliveryFeeCents?: number;
}

export interface OrderTotals {
  subtotalCents: number;
  taxAmountCents: number;
  serviceChargeCents: number;
  discountAmountCents: number;
  deliveryFeeCents: number;
  totalAmountCents: number;
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  discountAmount: number;
  deliveryFee: number;
  totalAmount: number;
}

/**
 * The order's money lines on the currency's real precision.
 *
 * - Tax and service charge are `subtotal x rate`, each rounded to the
 *   currency step as it is computed (TWD/VND: whole units, MYR: the sen), so
 *   the printed lines add up to the total.
 * - The delivery fee does not attract tax or service charge: it is carriage,
 *   not consumption (#295). Callers must pass the server's figure.
 * - Discount and delivery fee are configured amounts; they are floored to the
 *   step, so a legacy NT$12.50 is never charged or given away as NT$13.
 * - The subtotal is the one line kept as stored, because it has to equal the
 *   sum of the item lines. For a menu priced before precision was enforced
 *   (a TWD item at NT$12.50) it can be fractional, so the grand total is
 *   rounded to the step as well: a TWD total is always whole dollars going
 *   forward, and only such legacy orders can show lines that differ from the
 *   total by under one unit. For aligned input the final rounding is a no-op.
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const { currency, subtotalCents } = input;
  const taxAmountCents =
    input.taxAmountCents ??
    roundToCurrencyCents(subtotalCents * (input.taxRate ?? 0), currency);
  const serviceChargeCents =
    input.serviceChargeCents ??
    roundToCurrencyCents(
      subtotalCents * (input.serviceChargeRate ?? 0),
      currency,
    );
  const discountAmountCents = floorToCurrencyCents(
    input.discountCents ?? 0,
    currency,
  );
  const deliveryFeeCents = floorToCurrencyCents(
    input.deliveryFeeCents ?? 0,
    currency,
  );
  const totalAmountCents = roundToCurrencyCents(
    subtotalCents +
      taxAmountCents +
      serviceChargeCents +
      deliveryFeeCents -
      discountAmountCents,
    currency,
  );

  return {
    subtotalCents,
    taxAmountCents,
    serviceChargeCents,
    discountAmountCents,
    deliveryFeeCents,
    totalAmountCents,
    subtotal: fromCents(subtotalCents),
    taxAmount: fromCents(taxAmountCents),
    serviceCharge: fromCents(serviceChargeCents),
    discountAmount: fromCents(discountAmountCents),
    deliveryFee: fromCents(deliveryFeeCents),
    totalAmount: fromCents(totalAmountCents),
  };
}

/**
 * The rate to re-apply when an existing order's subtotal changes.
 *
 * Orders do not store their rates, and re-reading settings alone would let a
 * rate change after the order was placed silently reprice it. Recovering the
 * rate as `stored / subtotal` alone is no longer safe either once amounts are
 * rounded: 5% of NT$10 is stored as NT$1, which reads back as 10%. So the
 * configured rate wins whenever it reproduces what was stored (rounded, or —
 * for orders written before rounding — exact); otherwise the stored ratio is
 * the best evidence of what the order was charged. Either way the caller
 * rounds the result, so drift can shift an amount by a unit but can never
 * make it unaligned.
 */
export function recoverChargeRate(
  configuredRate: number | undefined,
  subtotalCents: number,
  storedCents: number,
  currency: CurrencyCode,
): number {
  if (subtotalCents <= 0) return 0;
  if (
    configuredRate !== undefined &&
    Number.isFinite(configuredRate) &&
    configuredRate > 0
  ) {
    const exact = subtotalCents * configuredRate;
    if (
      roundToCurrencyCents(exact, currency) === storedCents ||
      Math.round(exact) === storedCents
    ) {
      return configuredRate;
    }
  }
  return storedCents / subtotalCents;
}
