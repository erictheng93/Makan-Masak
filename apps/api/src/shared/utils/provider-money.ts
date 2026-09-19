/**
 * The money boundary between MakanMasak and external payment providers.
 *
 * Internally every amount is integer "cents" — major units × 100 — for every
 * currency, TWD and VND included (NT$250 = 25000, ₫100,000 = 10000000). No
 * provider uses that convention for all three currencies, so an amount must
 * never cross the boundary without going through this module:
 *
 * | provider  | TWD            | MYR          | VND            | source |
 * | --------- | -------------- | ------------ | -------------- | ------ |
 * | stripe    | minor (×1)     | minor (×1)   | whole dong ×100| docs.stripe.com/currencies — VND is zero-decimal; TWD is two-decimal for charges (payouts must be divisible by 100) |
 * | linepay   | whole NT$ ×100 | unsupported  | unsupported    | developers-pay.line.me/online-api-v3 — `amount` is a plain number of TWD (`"amount": 100, "currency": "TWD"`); currencies USD/TWD/THB |
 * | ecpay     | whole NT$ ×100 | unsupported  | unsupported    | ECPay AIO `TotalAmount`: 請帶整數，不可有小數點。僅限新台幣 |
 * | newebpay  | whole NT$ ×100 | unsupported  | unsupported    | NewebPay MPG `Amt`: pure-number TWD (SDK docs; the official manual is a PDF download) |
 * | (adapter) | internal cents | internal cents | internal cents | our own provider-adapter contract (docs/runbooks/market-checkout-provider-adapter-handoff.md) |
 *
 * The factor is "internal cents per provider unit". Any provider name that is
 * not a native gateway above is one of our HTTP adapters, which speak internal
 * cents by contract.
 */
import {
  currencyStepCents,
  normalizeCurrencyCode,
  type CurrencyCode,
} from "@makanmasak/utils";

export type NativePaymentProvider = "stripe" | "linepay" | "ecpay" | "newebpay";

export const PROVIDER_AMOUNT_FACTORS: Record<
  NativePaymentProvider,
  Partial<Record<CurrencyCode, number>>
> = {
  stripe: { TWD: 1, MYR: 1, VND: 100 },
  linepay: { TWD: 100 },
  ecpay: { TWD: 100 },
  newebpay: { TWD: 100 },
};

/**
 * ISO 4217 minor-unit exponents. TWD is listed with 2 minor units even though
 * no fractional coin circulates, so for TWD "ISO minor units" and internal
 * cents coincide; VND has 0, so its ISO minor unit is the whole dong.
 */
export const ISO_4217_EXPONENTS: Record<CurrencyCode, number> = {
  TWD: 2,
  MYR: 2,
  VND: 0,
};

export function isNativePaymentProvider(
  provider: string,
): provider is NativePaymentProvider {
  return Object.prototype.hasOwnProperty.call(
    PROVIDER_AMOUNT_FACTORS,
    provider.toLowerCase(),
  );
}

export type ProviderMoneyIssueCode =
  | "AMOUNT_MISSING"
  | "AMOUNT_NOT_INTEGER"
  | "CURRENCY_MISSING"
  | "CURRENCY_UNSUPPORTED"
  | "CURRENCY_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "AMOUNT_EXCEEDS_EXPECTED";

export interface ProviderMoneyIssue {
  code: ProviderMoneyIssueCode;
  message: string;
}

export type ProviderAmountConversion =
  | { ok: true; cents: number; currency: CurrencyCode }
  | { ok: false; issue: ProviderMoneyIssue };

/**
 * Convert an amount as a provider reported it into internal cents. Fails
 * (never guesses) when the amount is not an integer in the provider's unit or
 * the provider cannot settle that currency.
 */
export function providerAmountToCents(
  provider: string,
  currencyValue: unknown,
  amount: number,
): ProviderAmountConversion {
  const currency = normalizeCurrencyCode(currencyValue);
  if (!currency) {
    return {
      ok: false,
      issue: {
        code:
          currencyValue == null ? "CURRENCY_MISSING" : "CURRENCY_UNSUPPORTED",
        message:
          currencyValue == null
            ? "Provider amount has no currency"
            : `Currency ${String(currencyValue)} is not a supported checkout currency`,
      },
    };
  }
  if (!Number.isSafeInteger(amount)) {
    return {
      ok: false,
      issue: {
        code: "AMOUNT_NOT_INTEGER",
        message: `Provider amount ${String(amount)} is not an integer in the provider's unit`,
      },
    };
  }
  const factor = providerFactor(provider, currency);
  if (factor == null) {
    return {
      ok: false,
      issue: {
        code: "CURRENCY_UNSUPPORTED",
        message: `${provider} does not settle ${currency}`,
      },
    };
  }
  return { ok: true, cents: amount * factor, currency };
}

/** Inverse of providerAmountToCents, for amounts we send to a native gateway. */
export function centsToProviderAmount(
  provider: string,
  currency: CurrencyCode,
  cents: number,
): number {
  const factor = providerFactor(provider, currency);
  if (factor == null) {
    throw new Error(`${provider} does not settle ${currency}`);
  }
  if (!Number.isSafeInteger(cents) || cents % factor !== 0) {
    throw new Error(
      `${cents} cents is not a whole ${provider} amount in ${currency}`,
    );
  }
  return cents / factor;
}

/**
 * Internal cents → ISO 4217 minor units (TWD/MYR ×1, VND ÷100). Throws when
 * the amount is not on the currency's step: an adapter must never be asked to
 * charge NT$15.50 or ₫1,000.5.
 */
export function centsToIsoMinorUnits(
  cents: number,
  currency: CurrencyCode,
): number {
  assertCurrencyAlignedCents(cents, currency);
  return cents / 10 ** (2 - ISO_4217_EXPONENTS[currency]);
}

export function assertCurrencyAlignedCents(
  cents: number,
  currency: CurrencyCode,
): void {
  const step = currencyStepCents(currency);
  if (!Number.isSafeInteger(cents) || cents % step !== 0) {
    throw new Error(
      `Amount ${String(cents)} cents is not aligned to the ${currency} step of ${step} cents`,
    );
  }
}

/**
 * Compare what a provider says it collected against what the checkout row
 * expects. Returns the first problem, or null when amount and currency match
 * exactly. `mode: "at_most"` is for refunds (cumulative refunded amount may be
 * below the paid amount, never above it).
 */
export function verifyProviderMoney(input: {
  expectedCents: number;
  expectedCurrency: unknown;
  receivedCents: number | undefined;
  receivedCurrency: unknown;
  mode?: "exact" | "at_most";
}): ProviderMoneyIssue | null {
  const expectedCurrency = normalizeCurrencyCode(input.expectedCurrency);
  if (!expectedCurrency) {
    return {
      code: "CURRENCY_MISSING",
      message: "The stored payment has no supported currency to verify against",
    };
  }
  if (input.receivedCurrency == null || input.receivedCurrency === "") {
    return {
      code: "CURRENCY_MISSING",
      message: "Provider did not report a currency",
    };
  }
  const receivedCurrency = normalizeCurrencyCode(input.receivedCurrency);
  if (receivedCurrency !== expectedCurrency) {
    return {
      code: "CURRENCY_MISMATCH",
      message: `Provider reported ${String(input.receivedCurrency)}, payment is ${expectedCurrency}`,
    };
  }
  if (input.receivedCents === undefined) {
    return {
      code: "AMOUNT_MISSING",
      message: "Provider did not report an amount",
    };
  }
  if (!Number.isSafeInteger(input.receivedCents)) {
    return {
      code: "AMOUNT_NOT_INTEGER",
      message: `Provider amount ${String(input.receivedCents)} is not integer cents`,
    };
  }
  if ((input.mode ?? "exact") === "at_most") {
    if (input.receivedCents > input.expectedCents) {
      return {
        code: "AMOUNT_EXCEEDS_EXPECTED",
        message: `Provider reported ${input.receivedCents} cents, more than the ${input.expectedCents} cents paid`,
      };
    }
    return null;
  }
  if (input.receivedCents !== input.expectedCents) {
    return {
      code: "AMOUNT_MISMATCH",
      message: `Provider reported ${input.receivedCents} cents, payment expects ${input.expectedCents} cents`,
    };
  }
  return null;
}

function providerFactor(
  provider: string,
  currency: CurrencyCode,
): number | undefined {
  const normalized = provider.toLowerCase();
  if (!isNativePaymentProvider(normalized)) return 1;
  return PROVIDER_AMOUNT_FACTORS[normalized][currency];
}
