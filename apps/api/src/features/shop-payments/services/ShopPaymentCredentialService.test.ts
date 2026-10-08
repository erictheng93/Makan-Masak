/**
 * `ShopPaymentCredentialService` against a real (miniflare) D1 applied from
 * `migrations_fresh`.
 *
 * A mocked drizzle would happily accept a row that STRICT, the
 * `(restaurant_id, provider)` unique index and the restaurant guard trigger all
 * reject, and the thing under test here is precisely "what is stored, and in
 * what shape" — so the storage is real. This file lives in the default unit
 * project rather than beside the `*.real.integration.test.ts` suites because
 * that project contributes nothing to the `apps/api/src/features/**` coverage
 * gate (the reason `ReviewService.test.ts` gives, #286).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  markets,
  regionPolicies,
  shopPaymentCredentials,
} from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  buildSeedHelpers,
  type SeedHelpers,
} from "../../../__tests__/integration/helpers/seed-helper";
import type { Env } from "../../../types/env";
import { ApiError } from "../../../shared/utils/api-error";
import { ShopPaymentCredentialService } from "./ShopPaymentCredentialService";

const ENCRYPTION_KEY = "shop-wallet-test-encryption-key-0123456789";

/** The secret bytes no response, log or stored plaintext may contain. */
const MERCHANT_KEY = "tng-merchant-key-SHOULD-NEVER-LEAK";
const WEBHOOK_SECRET = "tng-webhook-secret-SHOULD-NEVER-LEAK";

describe("ShopPaymentCredentialService against real D1", () => {
  let testDb: TestDatabase;
  let seed: SeedHelpers;
  let env: Env;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    seed = buildSeedHelpers(testDb);
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    env = {
      DB: testDb.bindings.DB,
      NODE_ENV: "test",
      ENCRYPTION_KEY,
    } as unknown as Env;
  });

  const service = () => new ShopPaymentCredentialService(env);

  function myrShop(currency = "MYR") {
    return seed.restaurant({
      settings: { allowOnlineOrdering: true, allowGuestOrders: true, currency },
    });
  }

  function connectInput(overrides: Record<string, unknown> = {}) {
    return {
      merchantId: "TNG-MERCHANT-7788",
      displayName: "Jalan Alor stall",
      environment: "sandbox" as const,
      secret: { merchantKey: MERCHANT_KEY, webhookSecret: WEBHOOK_SECRET },
      ...overrides,
    };
  }

  describe("connect", () => {
    it("stores the secret encrypted and returns nothing that contains it", async () => {
      const shop = await myrShop();
      const view = await service().connect(shop.id, "tng", connectInput());

      expect(view).toEqual(
        expect.objectContaining({
          restaurantId: shop.id,
          provider: "tng",
          status: "connected",
          merchantIdMasked: "••••7788",
          displayName: "Jalan Alor stall",
          environment: "sandbox",
          secretConfigured: true,
        }),
      );
      // The whole response, not just the fields we thought to name.
      expect(JSON.stringify(view)).not.toContain(MERCHANT_KEY);
      expect(JSON.stringify(view)).not.toContain(WEBHOOK_SECRET);
      // The full merchant id is masked too, so a screenshot of the settings
      // page does not identify the merchant account.
      expect(JSON.stringify(view)).not.toContain("TNG-MERCHANT-7788");
    });

    it("writes ciphertext to the column, not the plaintext payload", async () => {
      const shop = await myrShop();
      await service().connect(shop.id, "tng", connectInput());

      const row = await testDb.drizzle
        .select()
        .from(shopPaymentCredentials)
        .where(eq(shopPaymentCredentials.restaurantId, shop.id))
        .get();

      expect(row?.secretPayloadEncrypted).toBeTruthy();
      expect(row?.secretPayloadEncrypted).not.toContain(MERCHANT_KEY);
      expect(row?.secretPayloadEncrypted).not.toContain(WEBHOOK_SECRET);
      // base64(iv):base64(ciphertext) — the AES-GCM shape from @makanmasak/utils.
      expect(row?.secretPayloadEncrypted).toMatch(/^[^:]+:[^:]+$/);
      // The non-secret JSON column holds no credential material.
      expect(JSON.stringify(row?.config ?? {})).not.toContain(MERCHANT_KEY);
    });

    it("refuses a wallet the shop's currency cannot settle", async () => {
      const twdShop = await myrShop("TWD");
      const error = await service()
        .connect(twdShop.id, "tng", connectInput())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(
        "SHOP_PAYMENT_PROVIDER_CURRENCY_UNSUPPORTED",
      );
      expect((error as ApiError).status).toBe(400);

      const rows = await service().list(twdShop.id);
      expect(rows).toHaveLength(0);
    });

    it("refuses a payload with no secret in it", async () => {
      const shop = await myrShop();
      const error = await service()
        .connect(shop.id, "grabpay", connectInput({ secret: {} }))
        .catch((e: unknown) => e);

      expect((error as ApiError).code).toBe(
        "SHOP_PAYMENT_CREDENTIAL_SECRET_REQUIRED",
      );
    });

    it("reconnecting rotates the secret in place rather than adding a row", async () => {
      const shop = await myrShop();
      const first = await service().connect(shop.id, "tng", connectInput());
      const second = await service().connect(
        shop.id,
        "tng",
        connectInput({
          merchantId: "TNG-MERCHANT-9900",
          secret: { merchantKey: "rotated-key" },
        }),
      );

      expect(second.id).toBe(first.id);
      expect(second.merchantIdMasked).toBe("••••9900");
      expect(await service().list(shop.id)).toHaveLength(1);

      const loaded = await service().loadGatewayCredentials(shop.id, "tng");
      expect(loaded.secret).toEqual({ merchantKey: "rotated-key" });
    });

    it("keeps each shop's wallets separate", async () => {
      const [shopA, shopB] = await Promise.all([myrShop(), myrShop()]);
      await service().connect(shopA.id, "tng", connectInput());
      await service().connect(
        shopB.id,
        "grabpay",
        connectInput({ merchantId: "GRAB-1111" }),
      );

      expect((await service().list(shopA.id)).map((c) => c.provider)).toEqual([
        "tng",
      ]);
      expect((await service().list(shopB.id)).map((c) => c.provider)).toEqual([
        "grabpay",
      ]);
      expect(await service().get(shopA.id, "grabpay")).toBeNull();
    });
  });

  describe("region payment policy", () => {
    async function allowOnly(
      scopeType: "country" | "market",
      scopeId: string,
      providers: string[],
    ) {
      await testDb.drizzle.insert(regionPolicies).values({
        scopeType,
        scopeId,
        policyKey: "payments.allowed_providers",
        value: JSON.stringify(providers),
      });
    }

    const myShopInMy = () =>
      seed.restaurant({
        countryCode: "MY",
        settings: {
          allowOnlineOrdering: true,
          allowGuestOrders: true,
          currency: "MYR",
        },
      });

    async function seedMarket() {
      const now = new Date();
      await testDb.drizzle.insert(markets).values({
        id: "m-policy",
        slug: "policy-market",
        name: "Policy Market",
        type: "night_market",
        city: "Kuala Lumpur",
        countryCode: "MY",
        district: "Bukit Bintang",
        address: "Jalan Alor",
        latitude: 3.14,
        longitude: 101.7,
        createdAt: now,
        updatedAt: now,
      } as never);
    }

    it("refuses to connect a provider the country does not allow", async () => {
      const shop = await myShopInMy();
      await allowOnly("country", "MY", ["tng"]);

      await expect(
        service().connect(shop.id, "grabpay", connectInput()),
      ).rejects.toMatchObject({
        code: "PAYMENT_PROVIDER_NOT_ALLOWED",
        status: 403,
      });
    });

    it("refuses to re-enable a connection the country no longer allows", async () => {
      const shop = await myShopInMy();
      await service().connect(shop.id, "grabpay", connectInput());
      await service().update(shop.id, "grabpay", { status: "disabled" });
      await allowOnly("country", "MY", ["tng"]);

      await expect(
        service().update(shop.id, "grabpay", { status: "connected" }),
      ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_NOT_ALLOWED" });
    });

    it("blocks a new charge the market excludes", async () => {
      const shop = await myShopInMy();
      await seedMarket();
      await allowOnly("market", "m-policy", ["tng"]);

      await expect(
        service().assertChargeAllowed(shop.id, "grabpay", "policy-market"),
      ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_NOT_ALLOWED" });
      await expect(
        service().assertChargeAllowed(shop.id, "tng", "policy-market"),
      ).resolves.toBeUndefined();
    });

    it("keeps loading credentials for refunds after the policy tightens", async () => {
      const shop = await myShopInMy();
      await service().connect(shop.id, "grabpay", connectInput());
      await allowOnly("country", "MY", ["tng"]);

      await expect(
        service().loadGatewayCredentials(shop.id, "grabpay"),
      ).resolves.toMatchObject({ provider: "grabpay" });
    });
  });

  describe("update", () => {
    it("leaves the stored secret alone when the patch omits it", async () => {
      const shop = await myrShop();
      await service().connect(shop.id, "tng", connectInput());
      const updated = await service().update(shop.id, "tng", {
        displayName: "Renamed stall",
      });

      expect(updated.displayName).toBe("Renamed stall");
      const loaded = await service().loadGatewayCredentials(shop.id, "tng");
      expect(loaded.secret.merchantKey).toBe(MERCHANT_KEY);
    });

    it("replaces the whole secret when one is supplied", async () => {
      const shop = await myrShop();
      const connected = await service().connect(shop.id, "tng", connectInput());
      const updated = await service().update(shop.id, "tng", {
        secret: { merchantKey: "only-this-now" },
      });

      // A rotation replaces rather than merges: the old webhook secret is gone.
      const loaded = await service().loadGatewayCredentials(shop.id, "tng");
      expect(loaded.secret).toEqual({ merchantKey: "only-this-now" });
      expect(updated.secretUpdatedAtMs).toBeGreaterThanOrEqual(
        connected.secretUpdatedAtMs,
      );
    });

    it("disabling stops the adapter from loading the credential", async () => {
      const shop = await myrShop();
      await service().connect(shop.id, "tng", connectInput());
      const disabled = await service().update(shop.id, "tng", {
        status: "disabled",
      });

      expect(disabled.status).toBe("disabled");
      expect(disabled.disabledAtMs).toEqual(expect.any(Number));

      const error = await service()
        .loadGatewayCredentials(shop.id, "tng")
        .catch((e: unknown) => e);
      expect((error as ApiError).code).toBe("SHOP_PAYMENT_CREDENTIAL_DISABLED");
    });

    it("re-enabling rechecks the currency the shop is paid in now", async () => {
      const shop = await myrShop();
      await service().connect(shop.id, "tng", connectInput());
      await service().update(shop.id, "tng", { status: "disabled" });

      // The owner switched the shop to TWD while the wallet was off.
      await testDb.bindings.DB.prepare(
        `UPDATE restaurants SET settings = ? WHERE id = ?`,
      )
        .bind(JSON.stringify({ currency: "TWD" }), shop.id)
        .run();

      const error = await service()
        .update(shop.id, "tng", { status: "connected" })
        .catch((e: unknown) => e);
      expect((error as ApiError).code).toBe(
        "SHOP_PAYMENT_PROVIDER_CURRENCY_UNSUPPORTED",
      );
    });

    it("404s for a provider this shop never connected", async () => {
      const shop = await myrShop();
      const error = await service()
        .update(shop.id, "grabpay", { displayName: "x" })
        .catch((e: unknown) => e);
      expect((error as ApiError).code).toBe(
        "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
      );
    });
  });

  describe("disconnect", () => {
    it("removes the row so the ciphertext is no longer held", async () => {
      const shop = await myrShop();
      await service().connect(shop.id, "tng", connectInput());
      await service().disconnect(shop.id, "tng");

      expect(await service().get(shop.id, "tng")).toBeNull();
      const row = await testDb.drizzle
        .select()
        .from(shopPaymentCredentials)
        .where(eq(shopPaymentCredentials.restaurantId, shop.id))
        .get();
      expect(row).toBeUndefined();
    });

    it("404s rather than silently succeeding on nothing", async () => {
      const shop = await myrShop();
      const error = await service()
        .disconnect(shop.id, "tng")
        .catch((e: unknown) => e);
      expect((error as ApiError).code).toBe(
        "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
      );
    });
  });

  describe("loadGatewayCredentials", () => {
    it("round-trips the secret through encryption", async () => {
      const shop = await myrShop();
      await service().connect(shop.id, "tng", connectInput());

      expect(await service().loadGatewayCredentials(shop.id, "tng")).toEqual({
        provider: "tng",
        merchantId: "TNG-MERCHANT-7788",
        environment: "sandbox",
        secret: { merchantKey: MERCHANT_KEY, webhookSecret: WEBHOOK_SECRET },
      });
    });

    it("refuses a wallet the shop has not connected", async () => {
      const shop = await myrShop();
      const error = await service()
        .loadGatewayCredentials(shop.id, "grabpay")
        .catch((e: unknown) => e);
      expect((error as ApiError).code).toBe(
        "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
      );
      expect((error as ApiError).status).toBe(409);
    });
  });
});
