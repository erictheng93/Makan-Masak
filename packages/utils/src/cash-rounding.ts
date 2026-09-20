/**
 * Cash rounding — Bank Negara Malaysia's "Rounding Mechanism".
 *
 * Malaysia withdrew the 1 sen and 2 sen coins in 2008, so a bill settled in
 * physical cash can only be collected in 5 sen steps: RM10.33 is handed over
 * as RM10.35, RM10.32 as RM10.30. Electronic settlement (card, e-wallet,
 * online gateway, stored-value credit) moves the exact figure and is not
 * rounded — that is the regulation, not a simplification of it.
 *
 * The order total never changes. Rounding is a property of the *payment*:
 * `payment_transactions.amount_cents` records what was actually collected and
 * `rounding_adjustment_cents` records `collected − order total`, a value in
 * −2..+2 sen. Reports keep reading the order total for revenue and read the
 * adjustment column for the rounding gain/loss.
 *
 * Two tables below carry the whole rule, so changing which methods round, or
 * adding a currency with a coin floor of its own, is a one-line change here
 * rather than a hunt for `method === "cash"` across services.
 */
import type { CurrencyCode } from "./currency";

/**
 * Payment methods that hand over physical notes and coins.
 *
 * Everything absent from this set settles electronically and therefore
 * collects the exact amount — card, digital_wallet, bank_transfer, every
 * gateway method, stored-value credits, and "split", whose legs are priced
 * individually and are not a single cash tender.
 */
const PHYSICAL_CASH_PAYMENT_METHODS: ReadonlySet<string> = new Set(["cash"]);

/**
 * Smallest coin still in circulation, in integer cents, for the currencies
 * whose cash step is coarser than the currency's own precision.
 *
 * Absent means "no cash rounding": TWD and VND already settle in whole major
 * units (`currencyStepCents` is 100 for both), so their adjustment is always
 * 0 — including for legacy totals that are themselves off-step, which must
 * stay payable at the figure they were priced at.
 */
const CASH_ROUNDING_STEP_CENTS: Partial<Record<CurrencyCode, number>> = {
  MYR: 5,
};

/** True when a payment in `method` is tendered in notes and coins. */
export const settlesInPhysicalCash = (
  method: string | null | undefined,
): boolean =>
  typeof method === "string" &&
  PHYSICAL_CASH_PAYMENT_METHODS.has(method.trim().toLowerCase());

/**
 * The cash-rounding step for a currency, in integer cents, or `null` when the
 * currency does not round cash (its coins already reach its full precision).
 */
export const cashStepCents = (currency: CurrencyCode): number | null =>
  CASH_ROUNDING_STEP_CENTS[currency] ?? null;

/**
 * The amount that can actually be collected in cash, in integer cents,
 * rounded half away from zero so a refund rounds the same way as the charge
 * it reverses.
 *
 *   cashRoundedCents(1033, "MYR") === 1035   // RM10.33 → RM10.35
 *   cashRoundedCents(1032, "MYR") === 1030
 *   cashRoundedCents(1035, "MYR") === 1035   // already on the step
 *   cashRoundedCents(17050, "TWD") === 17050 // TWD never rounds
 *
 * Non-cash payments must not go through this function — use
 * `collectableAmount`, which consults the payment method first.
 */
export const cashRoundedCents = (
  cents: number,
  currency: CurrencyCode,
): number => {
  if (!Number.isFinite(cents)) {
    throw new Error("Money amount must be finite");
  }
  const step = cashStepCents(currency);
  if (step === null) return cents;
  const sign = cents < 0 ? -1 : 1;
  // Round the quotient from a de-noised absolute value first, the way
  // roundToCurrencyCents does, so a caller that multiplied by a rate does not
  // land one sen out.
  const steps = Math.round(Math.round(Math.abs(cents) * 1e6) / 1e6 / step);
  const rounded = sign * steps * step;
  return rounded === 0 ? 0 : rounded;
};

/**
 * `collected − total`, in integer cents: 0 for a currency that does not round
 * cash, and −2..+2 sen for MYR.
 */
export const cashRoundingAdjustmentCents = (
  cents: number,
  currency: CurrencyCode,
): number => cashRoundedCents(cents, currency) - cents;

export interface CollectableAmount {
  /** What the payment actually collects, in integer cents. */
  collectableCents: number;
  /** `collectableCents − totalCents`; 0 for every electronic payment. */
  roundingAdjustmentCents: number;
}

/**
 * The single entry point services should use: given an order total, the
 * shop's currency and the method being tendered, say what may be collected
 * and what the rounding adjustment is.
 *
 * Both fields are 0-adjustment for anything that is not physical cash, so a
 * caller never needs to test the method itself.
 */
export const collectableAmount = (
  totalCents: number,
  options: { currency: CurrencyCode; paymentMethod: string | null | undefined },
): CollectableAmount => {
  if (!settlesInPhysicalCash(options.paymentMethod)) {
    return { collectableCents: totalCents, roundingAdjustmentCents: 0 };
  }
  const collectableCents = cashRoundedCents(totalCents, options.currency);
  return {
    collectableCents,
    roundingAdjustmentCents: collectableCents - totalCents,
  };
};
