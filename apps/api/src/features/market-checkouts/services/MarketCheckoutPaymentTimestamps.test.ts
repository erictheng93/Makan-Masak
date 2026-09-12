import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  marketCheckoutPayments,
  marketCheckoutSessions,
  markets,
} from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import type { Env } from "../../../types/env";
import { MarketCheckoutPaymentReconciliationService } from "./MarketCheckoutPaymentReconciliationService";
import { MarketCheckoutPaymentWebhookService } from "./MarketCheckoutPaymentWebhookService";
import {
  mockMarketCheckoutProviderPaidWebhookPayload,
  signMockMarketCheckoutWebhook,
} from "../testing/mockMarketCheckoutProviderContract";

/**
 * Both writers settle a payment with
 * `sql`COALESCE(${column}, ${value})`` so that a replayed event cannot move a
 * timestamp that is already set. `completed_at_ms` and `failed_at_ms` are
 * `{ mode: "timestamp_ms" }` columns, and a value interpolated into a `sql`
 * fragment is bound with no encoder — drizzle only attaches the column's
 * encoder through the operator helpers and through a plain `.set()` value — so
 * passing a `Date` there reached D1 as an object and failed the whole UPDATE
 * with `D1_TYPE_ERROR` (#365, same root cause as the group-order statistics
 * subquery).
 *
 * The unit suites for both services drive them through a hand-rolled
 * `env.DB.prepare` stub whose `run()` resolves `{ meta: { changes: 1 } }`
 * whatever it is handed, so neither could observe a binding failure — which is
 * exactly how the same fault stayed invisible in #365. These run the two writes
 * against a real (in-memory, miniflare) D1 applied from `migrations_fresh`, in
 * the default unit project so they count toward the
 * `apps/api/src/features/**` coverage gate.
 */
describe("market checkout payment settlement timestamps against real D1", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  const CHECKOUT_ID = "checkout-1";
  const PAYMENT_ID = "market_pay_checkout-1";
  const WEBHOOK_SECRET = "market-secret";

  function createEnv(): Env {
    return {
      NODE_ENV: "test",
      JWT_SECRET: "test",
      API_VERSION: "v1",
      ENCRYPTION_KEY: "test",
      MARKET_CHECKOUT_WEBHOOK_SECRET: WEBHOOK_SECRET,
      DB: testDb.bindings.DB,
      CACHE_KV: testDb.bindings.CACHE_KV,
    } as unknown as Env;
  }

  async function seedPendingPayment(): Promise<void> {
    const created = new Date(Date.parse("2026-06-01T10:00:00.000Z"));

    const [market] = await testDb.drizzle
      .insert(markets)
      .values({
        id: "market-1",
        slug: `checkout-market-${crypto.randomUUID()}`,
        name: "測試夜市",
        type: "night_market",
        city: "台中市",
        district: "西屯區",
        address: "台中市西屯區文華路",
        latitude: 24.1764,
        longitude: 120.6466,
        platformFeeRateBps: 350,
        isActive: true,
        createdAt: created,
        updatedAt: created,
      })
      .returning();

    await testDb.drizzle.insert(marketCheckoutSessions).values({
      id: CHECKOUT_ID,
      marketId: market.id,
      marketSlug: market.slug,
      marketName: market.name,
      platformFeeRateBps: 350,
      status: "submitted",
      paymentStatus: "pending",
      subtotalCents: 24_000,
      childOrderCount: 2,
      paymentSummary: { status: "pending", totalAmountCents: 24_000 },
      createdAt: created,
      updatedAt: created,
    });

    await testDb.drizzle.insert(marketCheckoutPayments).values({
      paymentId: PAYMENT_ID,
      checkoutId: CHECKOUT_ID,
      marketId: market.id,
      provider: "stripe",
      splitMode: "provider_split",
      idempotencyKey: `market-checkout:${CHECKOUT_ID}`,
      status: "pending",
      amountCents: 24_000,
      paidAmountCents: 0,
      refundedAmountCents: 0,
      currency: "TWD",
      countryCode: "TW",
      providerTransactionId: "intent-market-checkout-1",
      providerPayload: { source: "market-checkouts" },
      createdAt: created,
      updatedAt: created,
      // The point of the COALESCE: these start empty and are claimed once.
      completedAt: null,
      failedAt: null,
    });
  }

  /**
   * Read the columns back raw rather than through Drizzle. The mapper would
   * hand back a `Date` for anything it could parse, which is the one thing
   * these assertions must not take on trust — a `_ms` column has to hold an
   * INTEGER, and production is not STRICT enough to refuse anything else.
   */
  async function storedTimestamps(): Promise<{
    status: string;
    updated_at_ms: unknown;
    completed_at_ms: unknown;
    failed_at_ms: unknown;
  }> {
    const row = await testDb.bindings.DB.prepare(
      `SELECT status, updated_at_ms, completed_at_ms, failed_at_ms
         FROM market_checkout_payments
        WHERE payment_id = ?`,
    )
      .bind(PAYMENT_ID)
      .first<{
        status: string;
        updated_at_ms: unknown;
        completed_at_ms: unknown;
        failed_at_ms: unknown;
      }>();
    if (!row) throw new Error("seeded payment row disappeared");
    return row;
  }

  describe("MarketCheckoutPaymentReconciliationService", () => {
    it("stamps completed_at_ms as integer milliseconds on a paid reconciliation", async () => {
      await seedPendingPayment();

      await new MarketCheckoutPaymentReconciliationService(
        createEnv(),
      ).reconcile(CHECKOUT_ID, {
        provider: "stripe",
        status: "paid",
        providerTransactionId: "intent-market-checkout-1",
        amountReceivedCents: 24_000,
        eventId: "evt-reconcile-1",
      });

      const row = await storedTimestamps();
      expect(row.status).toBe("paid");
      expect(typeof row.completed_at_ms).toBe("number");
      // `updated_at_ms` is written as a plain `.set()` value, so the mapper
      // already gets it right; pinning the two together says the COALESCE
      // stamped the same `now` rather than merely something numeric.
      expect(row.completed_at_ms).toBe(row.updated_at_ms);
      expect(row.failed_at_ms).toBeNull();
    });

    it("stamps failed_at_ms as integer milliseconds on a failed reconciliation", async () => {
      await seedPendingPayment();

      await new MarketCheckoutPaymentReconciliationService(
        createEnv(),
      ).reconcile(CHECKOUT_ID, {
        provider: "stripe",
        status: "failed",
        providerTransactionId: "intent-market-checkout-1",
        eventId: "evt-reconcile-2",
      });

      const row = await storedTimestamps();
      expect(row.status).toBe("failed");
      expect(typeof row.failed_at_ms).toBe("number");
      expect(row.failed_at_ms).toBe(row.updated_at_ms);
      expect(row.completed_at_ms).toBeNull();
    });

    it("keeps the first completed_at_ms when the same payment is reconciled again", async () => {
      await seedPendingPayment();

      const service = new MarketCheckoutPaymentReconciliationService(
        createEnv(),
      );
      const paid = {
        provider: "stripe",
        status: "paid" as const,
        providerTransactionId: "intent-market-checkout-1",
        amountReceivedCents: 24_000,
      };

      await service.reconcile(CHECKOUT_ID, { ...paid, eventId: "evt-first" });
      const first = await storedTimestamps();

      await service.reconcile(CHECKOUT_ID, { ...paid, eventId: "evt-second" });
      const second = await storedTimestamps();

      // That is what the COALESCE is for: the settlement instant is claimed
      // once, even though `updated_at_ms` moves on every replay.
      expect(second.completed_at_ms).toBe(first.completed_at_ms);
    });
  });

  describe("MarketCheckoutPaymentWebhookService", () => {
    it("stamps completed_at_ms as integer milliseconds on a paid webhook", async () => {
      await seedPendingPayment();

      const rawBody = JSON.stringify(
        mockMarketCheckoutProviderPaidWebhookPayload,
      );
      const result = await new MarketCheckoutPaymentWebhookService(
        createEnv(),
      ).handle(
        "stripe",
        rawBody,
        new Headers({
          "x-webhook-signature": await signMockMarketCheckoutWebhook(
            WEBHOOK_SECRET,
            rawBody,
          ),
        }),
      );

      expect(result).toMatchObject({
        duplicate: false,
        reconciled: true,
        status: "paid",
        checkoutId: CHECKOUT_ID,
        paymentId: PAYMENT_ID,
      });

      const row = await storedTimestamps();
      expect(row.status).toBe("paid");
      expect(typeof row.completed_at_ms).toBe("number");
      expect(row.completed_at_ms).toBe(row.updated_at_ms);
    });

    it("stamps failed_at_ms as integer milliseconds on a failed webhook", async () => {
      await seedPendingPayment();

      const rawBody = JSON.stringify({
        ...mockMarketCheckoutProviderPaidWebhookPayload,
        id: "evt-market-checkout-failed-1",
        type: "market_checkout.payment_failed",
        status: "failed",
      });
      const result = await new MarketCheckoutPaymentWebhookService(
        createEnv(),
      ).handle(
        "stripe",
        rawBody,
        new Headers({
          "x-webhook-signature": await signMockMarketCheckoutWebhook(
            WEBHOOK_SECRET,
            rawBody,
          ),
        }),
      );

      expect(result).toMatchObject({ reconciled: true, status: "failed" });

      const row = await storedTimestamps();
      expect(row.status).toBe("failed");
      expect(typeof row.failed_at_ms).toBe("number");
      expect(row.failed_at_ms).toBe(row.updated_at_ms);
      expect(row.completed_at_ms).toBeNull();
    });
  });
});
