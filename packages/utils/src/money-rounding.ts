/**
 * Discount arithmetic and input validation built on the currency-precision
 * primitives in `./currency`.
 *
 * One implementation on purpose: the server's coupon preview, coupon
 * redemption, order creation and the customer app's "you could save" hint all
 * used to carry their own copy of "percent of subtotal, then cap", and they
 * disagreed with each other (the customer app worked in major units, so
 * RM23.50 x 10% showed RM2.00 while the server charged RM2.35).
 */
import { badRequest } from "./api-error";
import {
  currencyStepCents,
  isCurrencyAlignedCents,
  roundToCurrencyCents,
  type CurrencyCode,
} from "./currency";

/**
 * The largest currency-aligned amount whose magnitude does not exceed
 * `cents` (truncates toward zero).
 *
 * For configured ceilings and fixed amounts stored before precision was
 * enforced — a legacy NT$12.50 cap must never let a discount reach NT$13, so
 * it counts as NT$12. Derived amounts use `roundToCurrencyCents` instead.
 */
export const floorToCurrencyCents = (
  cents: number,
  currency: CurrencyCode,
): number => {
  if (!Number.isFinite(cents)) {
    throw new Error("Money amount must be finite");
  }
  const step = currencyStepCents(currency);
  const truncated = Math.trunc(Math.round(cents * 1e6) / 1e6 / step) * step;
  return truncated === 0 ? 0 : truncated;
};

/**
 * `percent`% of `baseCents`, rounded to the currency's precision
 * (half away from zero). `percent` is on the 0–100 scale.
 *
 *   percentOfCents(15500, 15, "TWD") === 2300   // NT$23.25 → NT$23
 *   percentOfCents(2350, 10, "MYR") === 235     // RM2.35
 */
export const percentOfCents = (
  baseCents: number,
  percent: number,
  currency: CurrencyCode,
): number => roundToCurrencyCents((baseCents * percent) / 100, currency);

export interface DiscountRule {
  /** "percentage" applies `percent`; anything else is a fixed amount. */
  discountType: string;
  /** 0–100 scale; used when `discountType === "percentage"`. */
  percent?: number | null;
  /** Fixed discount in cents; used otherwise. */
  fixedCents?: number | null;
  /**
   * Ceiling for a percentage discount, in cents. Null means uncapped; 0 is a
   * real ceiling of zero (partnership plans accept it).
   */
  maxDiscountCents?: number | null;
}

/**
 * The discount a rule grants on `baseCents`, always on the currency's step.
 *
 * Order of operations (the decided business rule):
 *   1. percentage: round the percentage to the currency first;
 *   2. then apply the cap — floored to the currency step, so a legacy
 *      unaligned cap cannot produce an unaligned discount;
 *   3. never more than the base itself (also floored: a legacy fractional
 *      subtotal must not be discounted to a fractional remainder).
 * Fixed amounts are floored rather than rounded: rounding a stored NT$12.50
 * up would give away more than the merchant configured.
 */
export const computeDiscountCents = (
  rule: DiscountRule,
  baseCents: number,
  currency: CurrencyCode,
): number => {
  let discount =
    rule.discountType === "percentage"
      ? percentOfCents(baseCents, rule.percent ?? 0, currency)
      : floorToCurrencyCents(rule.fixedCents ?? 0, currency);

  if (rule.discountType === "percentage" && rule.maxDiscountCents != null) {
    discount = Math.min(
      discount,
      floorToCurrencyCents(rule.maxDiscountCents, currency),
    );
  }

  discount = Math.min(
    discount,
    floorToCurrencyCents(Math.max(baseCents, 0), currency),
  );
  return Math.max(0, discount);
};

/**
 * True when every amount is valid in every supported currency (a whole
 * major unit), so a caller can skip looking up which currency applies.
 */
export const isAlignedInEveryCurrency = (
  fields: readonly CurrencyPrecisionField[],
): boolean =>
  fields.every(
    (entry) =>
      entry.cents == null ||
      (Number.isInteger(entry.cents) && entry.cents % 100 === 0),
  );

export interface CurrencyPrecisionField {
  field: string;
  /** Integer cents as it would be stored; null/undefined is skipped. */
  cents: number | null | undefined;
}

/**
 * Reject money input finer than the currency allows (NT$12.50 for a TWD
 * restaurant) with a 400 `CURRENCY_PRECISION` listing every offending field.
 *
 * Validation belongs where the restaurant — and therefore the currency — is
 * known, which is the service layer, not a zod schema.
 */
export const assertCurrencyAlignedCents = (
  currency: CurrencyCode,
  fields: readonly CurrencyPrecisionField[],
): void => {
  const invalid = fields.filter(
    (entry): entry is { field: string; cents: number } =>
      entry.cents != null && !isCurrencyAlignedCents(entry.cents, currency),
  );
  if (invalid.length === 0) return;

  const stepCents = currencyStepCents(currency);
  throw badRequest(
    `Amounts in ${currency} must be multiples of ${stepCents / 100}`,
    "CURRENCY_PRECISION",
    {
      currency,
      stepCents,
      fields: invalid.map((entry) => ({
        field: entry.field,
        amount: entry.cents / 100,
      })),
    },
  );
};
