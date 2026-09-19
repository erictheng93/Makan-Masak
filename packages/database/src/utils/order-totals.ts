import {
  DEFAULT_CURRENCY,
  floorToCurrencyCents,
  normalizeCurrencyCode,
  roundToCurrencyCents,
  type CurrencyCode,
} from "@makanmasak/utils";
import { fromCents } from "./money";

/**
 * `restaurants.settings.currency` is a free-form JSON string, so it can hold
 * anything an older admin build wrote. An unknown or missing code falls back
 * to the platform default rather than reaching the rounding helpers, which
 * throw on an unsupported code.
 */
export function resolveRestaurantCurrency(value: unknown): CurrencyCode {
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
