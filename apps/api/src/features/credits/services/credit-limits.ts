import { normalizeCurrencyCode, type CurrencyCode } from "@makanmasak/utils";
import type { Env } from "../../../types/env";
import { badRequest } from "../../../shared/utils/api-error";

/**
 * Stored-value controls are expressed in major units so values remain readable
 * when the system stores every currency as major units × 100 cents.
 */
export const CREDIT_LIMITS: Record<
  CurrencyCode,
  { pinThreshold: number; maxAmount: number }
> = {
  TWD: { pinThreshold: 200, maxAmount: 1_000_000 },
  MYR: { pinThreshold: 50, maxAmount: 30_000 },
  VND: { pinThreshold: 200_000, maxAmount: 300_000_000 },
};

const toCents = (major: number): number => major * 100;

const pinThresholdEnvValues = (
  env: Env,
): Record<CurrencyCode, string | undefined> => ({
  TWD: env.CREDIT_PIN_THRESHOLD_CENTS_TWD,
  MYR: env.CREDIT_PIN_THRESHOLD_CENTS_MYR,
  VND: env.CREDIT_PIN_THRESHOLD_CENTS_VND,
});

/** Return the per-transaction maximum in the internal cents representation. */
export const creditMaxAmountCents = (currency: CurrencyCode): number =>
  toCents(CREDIT_LIMITS[currency].maxAmount);

/**
 * Return the PIN threshold for one card currency. An invalid or absent override
 * falls back to that currency's product default rather than another currency's
 * threshold.
 */
export const creditPinThresholdCents = (
  env: Env,
  currency: CurrencyCode,
): number => {
  const configured = Number(pinThresholdEnvValues(env)[currency]);
  if (Number.isSafeInteger(configured) && configured >= 0) {
    return configured;
  }
  return toCents(CREDIT_LIMITS[currency].pinThreshold);
};

/**
 * Reject a credit issue, top-up, or spend that exceeds the product cap for its
 * actual card currency. Keep this outside request schemas because schemas only
 * see untrusted request fields, not the account's currency.
 */
export const assertCreditAmountWithinLimit = (
  amountCents: number,
  currencyValue: string,
): CurrencyCode => {
  const currency = normalizeCurrencyCode(currencyValue);
  if (!currency) {
    throw badRequest(
      "Credit currency is not supported",
      "CREDIT_CURRENCY_UNSUPPORTED",
    );
  }
  if (amountCents > creditMaxAmountCents(currency)) {
    throw badRequest(
      `Credit amount exceeds the ${currency} per-transaction limit of ${CREDIT_LIMITS[currency].maxAmount}`,
      "CREDIT_AMOUNT_EXCEEDS_LIMIT",
    );
  }
  return currency;
};
