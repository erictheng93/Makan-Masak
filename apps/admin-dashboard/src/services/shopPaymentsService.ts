/**
 * A shop's own e-wallet connections (Touch 'n Go eWallet, GrabPay).
 *
 * Mirrors `apps/api/src/features/shop-payments`. Note the asymmetry the API
 * enforces and this client makes visible: secrets go up inside `secret`, and
 * nothing ever comes back down — a stored connection reports `secretConfigured`
 * and `merchantIdMasked`, never the values themselves.
 */
import { api, unwrapApiPayload } from "@/services/api";

export type ShopPaymentProvider = "tng" | "grabpay";
export type ShopPaymentEnvironment = "sandbox" | "production";
export type ShopPaymentCredentialStatus = "connected" | "disabled";

/** Write-only. Present on requests, never on responses. */
export interface ShopWalletSecretInput {
  merchantKey?: string;
  clientSecret?: string;
  webhookSecret?: string;
}

export interface ShopPaymentCredential {
  id: string;
  restaurantId: string;
  provider: ShopPaymentProvider;
  status: ShopPaymentCredentialStatus;
  merchantIdMasked: string;
  displayName: string | null;
  environment: ShopPaymentEnvironment;
  config: { note?: string; returnUrl?: string };
  secretConfigured: boolean;
  secretUpdatedAtMs: number;
  connectedAtMs: number | null;
  disabledAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ShopPaymentCredentialList {
  credentials: ShopPaymentCredential[];
  supportedProviders: ShopPaymentProvider[];
}

export interface ConnectShopWalletInput {
  merchantId: string;
  displayName?: string | null;
  environment?: ShopPaymentEnvironment;
  secret: ShopWalletSecretInput;
}

export interface UpdateShopWalletInput {
  merchantId?: string;
  displayName?: string | null;
  environment?: ShopPaymentEnvironment;
  secret?: ShopWalletSecretInput;
  status?: ShopPaymentCredentialStatus;
}

export const shopPaymentsService = {
  async list(restaurantId: string): Promise<ShopPaymentCredentialList> {
    const response = await api.get<ShopPaymentCredentialList>(
      `/shop-payments/${restaurantId}`,
    );
    return unwrapApiPayload<ShopPaymentCredentialList>(response.data);
  },

  async connect(
    restaurantId: string,
    provider: ShopPaymentProvider,
    input: ConnectShopWalletInput,
  ): Promise<ShopPaymentCredential> {
    const response = await api.post<ShopPaymentCredential>(
      `/shop-payments/${restaurantId}/${provider}/connect`,
      input,
    );
    return unwrapApiPayload<ShopPaymentCredential>(response.data);
  },

  async update(
    restaurantId: string,
    provider: ShopPaymentProvider,
    input: UpdateShopWalletInput,
  ): Promise<ShopPaymentCredential> {
    const response = await api.put<ShopPaymentCredential>(
      `/shop-payments/${restaurantId}/${provider}`,
      input,
    );
    return unwrapApiPayload<ShopPaymentCredential>(response.data);
  },

  async disconnect(
    restaurantId: string,
    provider: ShopPaymentProvider,
  ): Promise<void> {
    await api.delete(`/shop-payments/${restaurantId}/${provider}`);
  },
};
