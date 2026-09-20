/**
 * The vocabulary of per-shop e-wallet payment connections.
 *
 * One rule runs through every type here: a secret is something the shop gives
 * us, never something we give back. `ShopWalletSecretPayload` exists only
 * between the request body and the ciphertext, and between the ciphertext and
 * the gateway call. `ShopPaymentCredentialView` — the only shape any route
 * returns — has no field that can hold a secret byte.
 */
import {
  SHOP_PAYMENT_PROVIDERS,
  type ShopPaymentProvider,
  type ShopPaymentCredentialStatus,
  type ShopPaymentEnvironment,
  type ShopPaymentCredentialConfig,
} from "@makanmasak/database";
import type { CurrencyCode } from "@makanmasak/utils";

export type {
  ShopPaymentProvider,
  ShopPaymentCredentialStatus,
  ShopPaymentEnvironment,
  ShopPaymentCredentialConfig,
};

export const SHOP_PAYMENT_PROVIDER_VALUES = Object.values(
  SHOP_PAYMENT_PROVIDERS,
) as readonly ShopPaymentProvider[];

export function isShopPaymentProvider(
  value: unknown,
): value is ShopPaymentProvider {
  return (
    typeof value === "string" &&
    (SHOP_PAYMENT_PROVIDER_VALUES as readonly string[]).includes(value)
  );
}

/**
 * The currencies each wallet settles in.
 *
 * Single source of truth for "can this shop connect this wallet?". Both are
 * Malaysian consumer wallets and settle MYR only, so a TWD or VND shop is
 * refused at connect time rather than at the first charge — the money
 * conversion rules live next door in `shared/utils/provider-money.ts` and
 * agree with this table by construction (a provider with no factor for a
 * currency cannot convert an amount in it either).
 */
export const SHOP_PAYMENT_PROVIDER_CURRENCIES: Record<
  ShopPaymentProvider,
  readonly CurrencyCode[]
> = {
  tng: ["MYR"],
  grabpay: ["MYR"],
};

export function providerSupportsCurrency(
  provider: ShopPaymentProvider,
  currency: CurrencyCode,
): boolean {
  return SHOP_PAYMENT_PROVIDER_CURRENCIES[provider].includes(currency);
}

/**
 * The secret half of a connection. Encrypted at rest, decrypted only to build
 * a gateway call, and never present in any response, log line or error
 * message.
 *
 * Which fields a given wallet needs is the wallet's business; the adapter
 * validates what it requires. Storing the union keeps one ciphertext per
 * connection instead of a column per provider.
 */
export interface ShopWalletSecretPayload {
  /** The merchant's API/signing key. */
  merchantKey?: string;
  /** OAuth client secret, where the wallet uses one. */
  clientSecret?: string;
  /** Secret the wallet signs its callbacks with. */
  webhookSecret?: string;
}

export const SHOP_WALLET_SECRET_FIELDS = [
  "merchantKey",
  "clientSecret",
  "webhookSecret",
] as const satisfies readonly (keyof ShopWalletSecretPayload)[];

/**
 * What a route may return. There is no `secret*` field and no hint derived
 * from secret bytes — see `secretConfigured` below.
 */
export interface ShopPaymentCredentialView {
  id: string;
  restaurantId: string;
  provider: ShopPaymentProvider;
  status: ShopPaymentCredentialStatus;
  /** Masked for display; the full value is available to the owner on request. */
  merchantIdMasked: string;
  displayName: string | null;
  environment: ShopPaymentEnvironment;
  config: ShopPaymentCredentialConfig;
  /**
   * Whether a secret is stored — not what it contains, and not which of its
   * fields are set.
   *
   * A "last four characters" hint is the usual convention and is deliberately
   * not used here: it puts secret bytes into a GET response, a browser cache
   * and every log that records one, which is the thing the secret-storage rule
   * exists to prevent. Presence plus age is what the UI actually needs in
   * order to say "connected" and "rotate this".
   */
  secretConfigured: boolean;
  secretUpdatedAtMs: number;
  connectedAtMs: number | null;
  disabledAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

/**
 * Mask a merchant id for display: the last four characters, everything before
 * them replaced. Short ids are masked whole rather than revealed.
 */
export function maskMerchantId(merchantId: string): string {
  const trimmed = merchantId.trim();
  if (trimmed.length <= 4) return "•".repeat(Math.max(trimmed.length, 1));
  return `••••${trimmed.slice(-4)}`;
}
