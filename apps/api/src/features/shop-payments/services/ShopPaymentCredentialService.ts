/**
 * Read and write a shop's own e-wallet merchant connections.
 *
 * Two invariants this service exists to hold:
 *
 * 1. **Secrets go in and never come out.** `connect`/`update`/`get`/`list`
 *    all return `ShopPaymentCredentialView`, which has no field a secret can
 *    live in. The one door out is `loadGatewayCredentials`, named so that a
 *    call to it is visible in review, and used only by the adapter.
 * 2. **A connection matches the shop's currency.** The currency comes from
 *    the restaurant row (`resolveRestaurantCurrency`), never from the request,
 *    so a TWD shop cannot connect a wallet that settles MYR — the charge would
 *    otherwise be built from an amount in the wrong unit at the first order.
 */
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import {
  shopPaymentCredentials,
  SHOP_PAYMENT_CREDENTIAL_STATUS,
  SHOP_PAYMENT_ENVIRONMENTS,
} from "@makanmasak/database";
import { decrypt, encrypt, generateUUID } from "@makanmasak/utils";
import type { EncryptionOptions } from "@makanmasak/utils";
import type { Env } from "../../../types/env";
import { ApiError, notFound } from "../../../shared/utils/api-error";
import {
  encryptionSettings,
  SHOP_PAYMENT_CREDENTIALS_ENCRYPTION_SALT,
} from "../../../shared/utils/encryption";
import { resolveRestaurantCurrency } from "../../../shared/utils/restaurant-currency";
import {
  providerSupportsCurrency,
  maskMerchantId,
  SHOP_PAYMENT_PROVIDER_CURRENCIES,
  SHOP_WALLET_SECRET_FIELDS,
  type ShopPaymentCredentialConfig,
  type ShopPaymentCredentialView,
  type ShopPaymentEnvironment,
  type ShopPaymentProvider,
  type ShopWalletSecretPayload,
} from "../types";

export interface ConnectShopPaymentCredentialInput {
  merchantId: string;
  displayName?: string | null;
  environment?: ShopPaymentEnvironment;
  secret: ShopWalletSecretPayload;
  config?: ShopPaymentCredentialConfig;
}

export interface UpdateShopPaymentCredentialInput {
  merchantId?: string;
  displayName?: string | null;
  environment?: ShopPaymentEnvironment;
  /** Omitted leaves the stored secret alone; present replaces it wholesale. */
  secret?: ShopWalletSecretPayload;
  config?: ShopPaymentCredentialConfig;
  status?: "connected" | "disabled";
}

/** Decrypted credentials, for the adapter only. */
export interface ShopWalletGatewayCredentials {
  provider: ShopPaymentProvider;
  merchantId: string;
  environment: ShopPaymentEnvironment;
  secret: ShopWalletSecretPayload;
}

type CredentialRow = typeof shopPaymentCredentials.$inferSelect;

export class ShopPaymentCredentialService {
  private readonly db;
  private readonly encryptionKey: string;
  private readonly cipher: EncryptionOptions;

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
    const encryption = encryptionSettings(env);
    this.encryptionKey = encryption.key;
    this.cipher = {
      salt: SHOP_PAYMENT_CREDENTIALS_ENCRYPTION_SALT,
      requireStrongKey: encryption.requireStrongKey,
    };
  }

  async list(restaurantId: string): Promise<ShopPaymentCredentialView[]> {
    const rows = await this.db
      .select()
      .from(shopPaymentCredentials)
      .where(eq(shopPaymentCredentials.restaurantId, restaurantId))
      .all();
    return rows.map(toView);
  }

  async get(
    restaurantId: string,
    provider: ShopPaymentProvider,
  ): Promise<ShopPaymentCredentialView | null> {
    const row = await this.findRow(restaurantId, provider);
    return row ? toView(row) : null;
  }

  /**
   * Connect (or reconnect) a wallet. Idempotent by (restaurant, provider):
   * connecting again replaces the merchant account and the secret, which is
   * what an owner rotating a key expects the form to do.
   */
  async connect(
    restaurantId: string,
    provider: ShopPaymentProvider,
    input: ConnectShopPaymentCredentialInput,
    actorUserId?: string | null,
  ): Promise<ShopPaymentCredentialView> {
    await this.assertProviderSuitsRestaurant(restaurantId, provider);
    assertSecretNotEmpty(input.secret);

    const now = new Date();
    const encrypted = await this.encryptSecret(input.secret);
    const existing = await this.findRow(restaurantId, provider);

    const shared = {
      merchantId: input.merchantId.trim(),
      displayName: input.displayName?.trim() || null,
      environment: input.environment ?? SHOP_PAYMENT_ENVIRONMENTS.SANDBOX,
      secretPayloadEncrypted: encrypted,
      config: input.config ?? {},
      status: SHOP_PAYMENT_CREDENTIAL_STATUS.CONNECTED,
      secretUpdatedAt: now,
      connectedAt: now,
      disabledAt: null,
      updatedBy: actorUserId ?? null,
      updatedAt: now,
    };

    if (existing) {
      await this.db
        .update(shopPaymentCredentials)
        .set(shared)
        .where(eq(shopPaymentCredentials.id, existing.id));
    } else {
      await this.db.insert(shopPaymentCredentials).values({
        id: generateUUID(),
        restaurantId,
        provider,
        createdAt: now,
        ...shared,
      });
    }

    return this.requireView(restaurantId, provider);
  }

  async update(
    restaurantId: string,
    provider: ShopPaymentProvider,
    input: UpdateShopPaymentCredentialInput,
    actorUserId?: string | null,
  ): Promise<ShopPaymentCredentialView> {
    const existing = await this.findRow(restaurantId, provider);
    if (!existing) {
      throw notFound(
        "Payment provider is not connected",
        "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
      );
    }
    // Re-enabling a connection re-checks the currency: a shop may have changed
    // its currency setting since it connected.
    if (input.status === "connected" || input.merchantId !== undefined) {
      await this.assertProviderSuitsRestaurant(restaurantId, provider);
    }

    const now = new Date();
    const patch: Partial<typeof shopPaymentCredentials.$inferInsert> = {
      updatedBy: actorUserId ?? null,
      updatedAt: now,
    };
    if (input.merchantId !== undefined) {
      patch.merchantId = input.merchantId.trim();
    }
    if (input.displayName !== undefined) {
      patch.displayName = input.displayName?.trim() || null;
    }
    if (input.environment !== undefined) patch.environment = input.environment;
    if (input.config !== undefined) patch.config = input.config;
    if (input.secret !== undefined) {
      assertSecretNotEmpty(input.secret);
      patch.secretPayloadEncrypted = await this.encryptSecret(input.secret);
      patch.secretUpdatedAt = now;
    }
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.connectedAt =
        input.status === "connected" ? now : existing.connectedAt;
      patch.disabledAt = input.status === "disabled" ? now : null;
    }

    await this.db
      .update(shopPaymentCredentials)
      .set(patch)
      .where(eq(shopPaymentCredentials.id, existing.id));

    return this.requireView(restaurantId, provider);
  }

  /**
   * Disconnect by deleting the row — the ciphertext goes with it.
   *
   * Disabling (`update({ status: "disabled" })`) is the reversible option and
   * keeps the secret; "disconnect" in the UI means the shop wants us to stop
   * holding its key, so the row is removed rather than flagged.
   */
  async disconnect(
    restaurantId: string,
    provider: ShopPaymentProvider,
  ): Promise<void> {
    const existing = await this.findRow(restaurantId, provider);
    if (!existing) {
      throw notFound(
        "Payment provider is not connected",
        "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
      );
    }
    await this.db
      .delete(shopPaymentCredentials)
      .where(eq(shopPaymentCredentials.id, existing.id));
  }

  /**
   * The one path that decrypts. Only the wallet adapter calls it, and only to
   * build a request it is about to send to that wallet.
   *
   * Refuses a disabled connection: a row left behind after an owner turned the
   * wallet off must not be able to charge anyone.
   */
  async loadGatewayCredentials(
    restaurantId: string,
    provider: ShopPaymentProvider,
  ): Promise<ShopWalletGatewayCredentials> {
    const row = await this.findRow(restaurantId, provider);
    if (!row) {
      throw new ApiError(
        "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
        "This shop has not connected that payment provider",
        409,
        { provider },
      );
    }
    if (row.status !== SHOP_PAYMENT_CREDENTIAL_STATUS.CONNECTED) {
      throw new ApiError(
        "SHOP_PAYMENT_CREDENTIAL_DISABLED",
        "This shop's payment provider connection is disabled",
        409,
        { provider },
      );
    }

    return {
      provider,
      merchantId: row.merchantId,
      environment: row.environment,
      secret: await this.decryptSecret(row.secretPayloadEncrypted),
    };
  }

  /**
   * Fails with `SHOP_PAYMENT_PROVIDER_CURRENCY_UNSUPPORTED` when the shop is
   * not paid in a currency the wallet settles.
   */
  private async assertProviderSuitsRestaurant(
    restaurantId: string,
    provider: ShopPaymentProvider,
  ): Promise<void> {
    const currency = await resolveRestaurantCurrency(this.env.DB, restaurantId);
    if (providerSupportsCurrency(provider, currency)) return;
    throw new ApiError(
      "SHOP_PAYMENT_PROVIDER_CURRENCY_UNSUPPORTED",
      `${provider} cannot settle ${currency}`,
      400,
      {
        provider,
        restaurantCurrency: currency,
        supportedCurrencies: SHOP_PAYMENT_PROVIDER_CURRENCIES[provider],
      },
    );
  }

  private async requireView(
    restaurantId: string,
    provider: ShopPaymentProvider,
  ): Promise<ShopPaymentCredentialView> {
    const row = await this.findRow(restaurantId, provider);
    if (!row) {
      throw notFound(
        "Payment provider is not connected",
        "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
      );
    }
    return toView(row);
  }

  private findRow(restaurantId: string, provider: ShopPaymentProvider) {
    return this.db
      .select()
      .from(shopPaymentCredentials)
      .where(
        and(
          eq(shopPaymentCredentials.restaurantId, restaurantId),
          eq(shopPaymentCredentials.provider, provider),
        ),
      )
      .get();
  }

  private encryptSecret(secret: ShopWalletSecretPayload): Promise<string> {
    return encrypt(
      JSON.stringify(pickSecretFields(secret)),
      this.encryptionKey,
      this.cipher,
    );
  }

  private async decryptSecret(
    ciphertext: string,
  ): Promise<ShopWalletSecretPayload> {
    const plaintext = await decrypt(
      ciphertext,
      this.encryptionKey,
      this.cipher,
    );
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiError(
        "SHOP_PAYMENT_CREDENTIAL_CORRUPT",
        "Stored payment credentials could not be read",
        500,
      );
    }
    return pickSecretFields(parsed as ShopWalletSecretPayload);
  }
}

/**
 * Drop anything that is not a known secret field.
 *
 * On the way in this stops a caller smuggling extra keys into the ciphertext;
 * on the way out it stops a legacy or tampered payload widening what the
 * adapter sees.
 */
function pickSecretFields(
  secret: ShopWalletSecretPayload,
): ShopWalletSecretPayload {
  const picked: ShopWalletSecretPayload = {};
  for (const field of SHOP_WALLET_SECRET_FIELDS) {
    const value = secret[field];
    if (typeof value === "string" && value.length > 0) picked[field] = value;
  }
  return picked;
}

function assertSecretNotEmpty(secret: ShopWalletSecretPayload): void {
  if (Object.keys(pickSecretFields(secret)).length > 0) return;
  throw new ApiError(
    "SHOP_PAYMENT_CREDENTIAL_SECRET_REQUIRED",
    "At least one credential secret is required",
    400,
    { expectedFields: SHOP_WALLET_SECRET_FIELDS },
  );
}

/**
 * Row → response shape. The single place a stored row becomes something a
 * route may return, so "does any response carry a secret?" is answered by
 * reading this function.
 */
function toView(row: CredentialRow): ShopPaymentCredentialView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    provider: row.provider,
    status: row.status,
    merchantIdMasked: maskMerchantId(row.merchantId),
    displayName: row.displayName ?? null,
    environment: row.environment,
    config: row.config ?? {},
    secretConfigured: row.secretPayloadEncrypted.length > 0,
    secretUpdatedAtMs: row.secretUpdatedAt.getTime(),
    connectedAtMs: row.connectedAt?.getTime() ?? null,
    disabledAtMs: row.disabledAt?.getTime() ?? null,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
  };
}
