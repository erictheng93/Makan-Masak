/**
 * Real-D1 tests for online top-up (代幣線上儲值, Phase 2).
 *
 *   - createIntent → pending intent + provider next action
 *   - confirmIntent credits the balance once (idempotent on replay)
 *   - failed confirmation does not credit
 *   - webhook signature verification + duplicate-delivery handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  creditLedgerEntries,
  creditTopupIntents,
  paymentAuditLog,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import type { Env } from "../../types/env";
import { CreditService } from "../../features/credits/services/CreditService";
import {
  CreditTopupService,
  HttpCreditTopupGateway,
  hmacSha256Hex,
  type CreditTopupGateway,
  type CreditTopupGatewayInput,
} from "../../features/credits/services/CreditTopupService";
import { CreditTopupWebhookService } from "../../features/credits/services/CreditTopupWebhookService";

let testDb: TestDatabase;

const WEBHOOK_SECRET = "topup-webhook-secret";

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
    CREDIT_TOPUP_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...overrides,
  } as Env;
}

class FakeGateway implements CreditTopupGateway {
  async createCharge(input: CreditTopupGatewayInput) {
    return {
      providerTransactionId: `ptxn-${input.intentId}`,
      status: "pending" as const,
      nextAction: {
        type: "redirect" as const,
        redirectUrl: "https://pay.example/checkout",
      },
    };
  }
}

function topupService(env = buildEnv()): CreditTopupService {
  return new CreditTopupService(env, new CreditService(env), new FakeGateway());
}

async function issueCard(env = buildEnv()) {
  return new CreditService(env).issueCard({ currency: "TWD" });
}

async function balanceOf(publicId: string): Promise<number> {
  return (await new CreditService(buildEnv()).getBalance(publicId))
    .balanceCents;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
});

describe("CreditTopupService — intent lifecycle", () => {
  it("creates a pending intent with provider next action", async () => {
    const card = await issueCard();
    const { intent, nextAction } = await topupService().createIntent({
      publicId: card.publicId,
      amountCents: 5000,
      currency: "TWD",
    });

    expect(intent).toMatchObject({
      status: "pending",
      amountCents: 5000,
      currency: "TWD",
      providerTransactionId: `ptxn-${intent.id}`,
    });
    expect(nextAction).toMatchObject({ type: "redirect" });
    expect(await balanceOf(card.publicId)).toBe(0); // not credited yet
  });

  it("credits the balance on paid confirmation and is idempotent on replay", async () => {
    const card = await issueCard();
    const service = topupService();
    const { intent } = await service.createIntent({
      publicId: card.publicId,
      amountCents: 5000,
      currency: "TWD",
    });

    const first = await service.confirmIntent({
      intentId: intent.id,
      status: "paid",
      paidAmountCents: 5000,
      paidCurrency: "TWD",
    });
    expect(first).toMatchObject({ credited: true, balanceAfterCents: 5000 });
    expect(await balanceOf(card.publicId)).toBe(5000);

    const replay = await service.confirmIntent({
      intentId: intent.id,
      status: "paid",
      paidAmountCents: 5000,
      paidCurrency: "TWD",
    });
    expect(replay.alreadyProcessed).toBe(true);
    expect(await balanceOf(card.publicId)).toBe(5000); // credited once

    const topups = (
      await testDb.drizzle
        .select()
        .from(creditLedgerEntries)
        .where(eq(creditLedgerEntries.accountId, card.accountId))
        .all()
    ).filter((e) => e.entryType === "topup");
    expect(topups).toHaveLength(1);
  });

  it("does not credit when the payment fails", async () => {
    const card = await issueCard();
    const service = topupService();
    const { intent } = await service.createIntent({
      publicId: card.publicId,
      amountCents: 5000,
      currency: "TWD",
    });

    const result = await service.confirmIntent({
      intentId: intent.id,
      status: "failed",
      errorMessage: "card declined",
    });
    expect(result.credited).toBe(false);
    expect(result.intent.status).toBe("failed");
    expect(await balanceOf(card.publicId)).toBe(0);
  });

  it("rejects online top-up when no provider is configured", async () => {
    const card = await issueCard();
    // Default gateway (no CREDIT_TOPUP_PROVIDER_URL) is unconfigured.
    const service = new CreditTopupService(buildEnv());
    await expect(
      service.createIntent({
        publicId: card.publicId,
        amountCents: 5000,
        currency: "TWD",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_NOT_CONFIGURED" });
  });
});

describe("CreditTopupWebhookService — signature + idempotency", () => {
  async function signedHeaders(
    body: string,
    timestamp = new Date().toISOString(),
  ): Promise<Headers> {
    const signature = await hmacSha256Hex(
      WEBHOOK_SECRET,
      `${timestamp}.${body}`,
    );
    return new Headers({
      "content-type": "application/json",
      "x-credit-topup-signature": signature,
      "x-credit-topup-signature-timestamp": timestamp,
    });
  }

  it("credits the balance on a validly-signed paid webhook", async () => {
    const card = await issueCard();
    const { intent } = await topupService().createIntent({
      publicId: card.publicId,
      amountCents: 8000,
      currency: "TWD",
    });

    const body = JSON.stringify({
      intentId: intent.id,
      status: "paid",
      amountCents: 8000,
      currency: "TWD",
    });
    const result = await new CreditTopupWebhookService(buildEnv()).handle(
      body,
      await signedHeaders(body),
    );

    expect(result).toMatchObject({ credited: true, status: "paid" });
    expect(await balanceOf(card.publicId)).toBe(8000);
  });

  it("rejects an invalid signature", async () => {
    const card = await issueCard();
    const { intent } = await topupService().createIntent({
      publicId: card.publicId,
      amountCents: 8000,
      currency: "TWD",
    });

    const body = JSON.stringify({ intentId: intent.id, status: "paid" });
    const headers = new Headers({
      "x-credit-topup-signature": "deadbeef",
      "x-credit-topup-signature-timestamp": "2026-06-03T00:00:00.000Z",
    });

    await expect(
      new CreditTopupWebhookService(buildEnv()).handle(body, headers),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_WEBHOOK_SIGNATURE_INVALID" });
    expect(await balanceOf(card.publicId)).toBe(0);
  });

  it("rejects a stale (replayed) timestamp even with a valid signature", async () => {
    const card = await issueCard();
    const { intent } = await topupService().createIntent({
      publicId: card.publicId,
      amountCents: 8000,
      currency: "TWD",
    });

    const body = JSON.stringify({ intentId: intent.id, status: "paid" });
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    await expect(
      new CreditTopupWebhookService(buildEnv()).handle(
        body,
        await signedHeaders(body, stale),
      ),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_WEBHOOK_SIGNATURE_STALE" });
    expect(await balanceOf(card.publicId)).toBe(0);
  });

  it("rejects mismatched intent / provider-transaction identifiers", async () => {
    const card = await issueCard();
    const { intent } = await topupService().createIntent({
      publicId: card.publicId,
      amountCents: 8000,
      currency: "TWD",
    });

    await expect(
      topupService().confirmIntent({
        intentId: intent.id,
        providerTransactionId: "ptxn-someone-else",
        status: "paid",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_IDENTIFIER_MISMATCH" });
    expect(await balanceOf(card.publicId)).toBe(0);
  });

  it("is idempotent on duplicate webhook delivery", async () => {
    const card = await issueCard();
    const { intent } = await topupService().createIntent({
      publicId: card.publicId,
      amountCents: 8000,
      currency: "TWD",
    });

    const body = JSON.stringify({
      intentId: intent.id,
      status: "paid",
      amountCents: 8000,
      currency: "TWD",
    });
    const webhook = new CreditTopupWebhookService(buildEnv());

    const first = await webhook.handle(body, await signedHeaders(body));
    const second = await webhook.handle(body, await signedHeaders(body));

    expect(first.credited).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(await balanceOf(card.publicId)).toBe(8000); // credited once
  });
});

/**
 * The whole online top-up path against a fake provider at the HTTP boundary:
 * the core posts the charge to the provider URL (a stubbed fetch standing in
 * for the adapter), the adapter's signed webhook comes back, and only a
 * webhook whose amount and currency match the intent credits the balance.
 */
describe("online top-up through a fake HTTP provider", () => {
  async function startTopup(
    currency: "TWD" | "MYR" | "VND",
    amountCents: number,
  ) {
    const env = buildEnv();
    const card = await new CreditService(env).issueCard({ currency });
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return new Response(
        JSON.stringify({
          providerTransactionId: `fake-${String(body.intentId)}`,
          status: "requires_action",
          nextAction: { type: "redirect", redirectUrl: "https://fake.pay/x" },
        }),
      );
    }) as typeof fetch;
    const service = new CreditTopupService(
      env,
      new CreditService(env),
      new HttpCreditTopupGateway(
        "https://fake-provider.test/topups",
        undefined,
        undefined,
        fetcher,
      ),
    );
    const { intent } = await service.createIntent({
      publicId: card.publicId,
      amountCents,
      currency,
    });
    return { card, intent, requests };
  }

  async function deliver(body: Record<string, unknown>) {
    const raw = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    return new CreditTopupWebhookService(buildEnv()).handle(
      raw,
      new Headers({
        "content-type": "application/json",
        "x-credit-topup-signature": await hmacSha256Hex(
          WEBHOOK_SECRET,
          `${timestamp}.${raw}`,
        ),
        "x-credit-topup-signature-timestamp": timestamp,
      }),
    );
  }

  it.each([
    ["TWD", 50000, 50000, 2],
    ["MYR", 1250, 1250, 2],
    ["VND", 10000000, 100000, 0],
  ] as const)(
    "%s: sends ISO minor units, refuses an underpaid webhook, credits the exact one",
    async (currency, amountCents, amountMinor, currencyExponent) => {
      const { card, intent, requests } = await startTopup(
        currency,
        amountCents,
      );
      expect(requests).toEqual([
        expect.objectContaining({
          intentId: intent.id,
          amountCents,
          amountMinor,
          currencyExponent,
          currency,
        }),
      ]);

      const step = currency === "MYR" ? 1 : 100;
      const underpaid = await deliver({
        intentId: intent.id,
        providerTransactionId: `fake-${intent.id}`,
        status: "paid",
        amountCents: amountCents - step,
        currency,
      });
      expect(underpaid).toMatchObject({
        credited: false,
        reviewRequired: true,
        reviewReason: "AMOUNT_MISMATCH",
      });
      expect(await balanceOf(card.publicId)).toBe(0);
      const [held] = await testDb.drizzle
        .select()
        .from(creditTopupIntents)
        .where(eq(creditTopupIntents.id, intent.id));
      expect(held).toMatchObject({
        status: "pending",
        errorCode: "AMOUNT_MISMATCH",
      });
      const audit = await testDb.drizzle
        .select()
        .from(paymentAuditLog)
        .where(eq(paymentAuditLog.paymentTransactionId, intent.id));
      expect(audit).toEqual([
        expect.objectContaining({
          eventType: "failure",
          amount: amountCents - step,
          currency,
          errorCode: "CREDIT_TOPUP_AMOUNT_MISMATCH",
        }),
      ]);

      const paid = await deliver({
        intentId: intent.id,
        providerTransactionId: `fake-${intent.id}`,
        status: "paid",
        amountCents,
        currency,
      });
      expect(paid).toMatchObject({ credited: true, status: "paid" });
      expect(await balanceOf(card.publicId)).toBe(amountCents);
    },
  );

  it("does not credit a webhook paid in another currency", async () => {
    const { card, intent } = await startTopup("TWD", 50000);

    const result = await deliver({
      intentId: intent.id,
      status: "paid",
      amountCents: 50000,
      currency: "MYR",
    });

    expect(result).toMatchObject({
      credited: false,
      reviewReason: "CURRENCY_MISMATCH",
    });
    expect(await balanceOf(card.publicId)).toBe(0);
  });

  it("refuses to start a top-up that is not a whole currency amount", async () => {
    await expect(startTopup("TWD", 5050)).rejects.toMatchObject({
      code: "CREDIT_TOPUP_AMOUNT_NOT_ALIGNED",
    });
  });
});
