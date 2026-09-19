import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import {
  CreditTopupWebhookService,
  type CreditTopupWebhookResult,
} from "./CreditTopupWebhookService";
import { hmacSha256Hex } from "./CreditTopupService";

function env(overrides: Partial<Env> = {}) {
  return {
    DB: {},
    CACHE_KV: {},
    CREDIT_TOPUP_WEBHOOK_SECRET: "webhook-secret",
    ...overrides,
  } as Env;
}

function fakeTopupService(
  overrides: {
    confirmIntent?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    confirmIntent:
      overrides.confirmIntent ??
      vi.fn(async () => ({
        alreadyProcessed: false,
        credited: true,
        balanceAfterCents: 6500,
        intent: { id: "intent-1" },
      })),
  };
}

async function signedHeaders(
  body: string,
  options: {
    secret?: string;
    timestamp?: string;
    extra?: Record<string, string>;
  } = {},
) {
  const timestamp = options.timestamp ?? "2026-06-07T12:00:00.000Z";
  const signature = await hmacSha256Hex(
    options.secret ?? "webhook-secret",
    `${timestamp}.${body}`,
  );
  return new Headers({
    "x-credit-topup-signature": signature,
    "x-credit-topup-signature-timestamp": timestamp,
    ...options.extra,
  });
}

describe("CreditTopupWebhookService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("verifies signed paid callbacks, normalizes aliases, and maps confirmation results", async () => {
    const body = JSON.stringify({
      intent_id: "intent-1",
      provider_transaction_id: "txn-1",
      status: "succeeded",
      errorMessage: "ignored for paid",
    });
    const topupService = fakeTopupService();

    const result = (await new CreditTopupWebhookService(
      env(),
      topupService as never,
    ).handle(
      body,
      await signedHeaders(body),
    )) satisfies CreditTopupWebhookResult;

    expect(topupService.confirmIntent).toHaveBeenCalledWith({
      intentId: "intent-1",
      providerTransactionId: "txn-1",
      status: "paid",
      providerPayload: {
        intent_id: "intent-1",
        provider_transaction_id: "txn-1",
        status: "succeeded",
        errorMessage: "ignored for paid",
      },
      errorMessage: "ignored for paid",
    });
    expect(result).toEqual({
      duplicate: false,
      credited: true,
      intentId: "intent-1",
      status: "paid",
      balanceAfterCents: 6500,
    });
  });

  it.each([
    [{ amountCents: 150000 }, 150000],
    [{ amount_cents: 150000 }, 150000],
    [{ amountCents: "150000" }, undefined],
  ])(
    "passes the reported paid money (%o) through and surfaces a review hold",
    async (amountField, expectedCents) => {
      const body = JSON.stringify({
        intentId: "intent-1",
        status: "paid",
        currency: "TWD",
        ...amountField,
      });
      const topupService = fakeTopupService({
        confirmIntent: vi.fn(async () => ({
          alreadyProcessed: false,
          credited: false,
          intent: { id: "intent-1" },
          reviewRequired: true,
          reviewReason: "AMOUNT_MISMATCH",
        })),
      });

      const result = await new CreditTopupWebhookService(
        env(),
        topupService as never,
      ).handle(body, await signedHeaders(body));

      expect(topupService.confirmIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: "intent-1",
          status: "paid",
          paidAmountCents: expectedCents,
          paidCurrency: "TWD",
        }),
      );
      expect(result).toMatchObject({
        credited: false,
        reviewRequired: true,
        reviewReason: "AMOUNT_MISMATCH",
      });
    },
  );

  it("uses header identifiers, maps failed statuses, and reports duplicate deliveries", async () => {
    const body = JSON.stringify({ status: "cancelled", errorMessage: "bank" });
    const headers = await signedHeaders(body, {
      extra: {
        "x-credit-topup-intent-id": "intent-header",
        "x-provider-transaction-id": "txn-header",
      },
    });
    const topupService = fakeTopupService({
      confirmIntent: vi.fn(async () => ({
        alreadyProcessed: true,
        credited: false,
        balanceAfterCents: undefined,
        intent: { id: "intent-header" },
      })),
    });

    await expect(
      new CreditTopupWebhookService(env(), topupService as never).handle(
        body,
        headers,
      ),
    ).resolves.toEqual({
      duplicate: true,
      credited: false,
      intentId: "intent-header",
      status: "failed",
      balanceAfterCents: undefined,
    });
    expect(topupService.confirmIntent).toHaveBeenCalledWith({
      intentId: "intent-header",
      providerTransactionId: "txn-header",
      status: "failed",
      providerPayload: { status: "cancelled", errorMessage: "bank" },
      errorMessage: "bank",
    });
  });

  it("ignores callbacks with unrecognized statuses after signature validation", async () => {
    const body = JSON.stringify({ intentId: "intent-1", status: "processing" });
    const topupService = fakeTopupService();

    await expect(
      new CreditTopupWebhookService(env(), topupService as never).handle(
        body,
        await signedHeaders(body),
      ),
    ).resolves.toEqual({
      duplicate: false,
      credited: false,
      intentId: "intent-1",
    });
    expect(topupService.confirmIntent).not.toHaveBeenCalled();
  });

  it("rejects callbacks when the webhook secret or signature is missing", async () => {
    const body = JSON.stringify({ intentId: "intent-1", status: "paid" });

    await expect(
      new CreditTopupWebhookService(
        env({ CREDIT_TOPUP_WEBHOOK_SECRET: "" }),
      ).handle(body, new Headers()),
    ).rejects.toMatchObject({
      code: "CREDIT_TOPUP_WEBHOOK_SECRET_MISSING",
      status: 500,
    });

    await expect(
      new CreditTopupWebhookService(env()).handle(body, new Headers()),
    ).rejects.toMatchObject({
      code: "CREDIT_TOPUP_WEBHOOK_SIGNATURE_MISSING",
      status: 401,
    });
  });

  it("rejects invalid signatures before confirming intents", async () => {
    const body = JSON.stringify({ intentId: "intent-1", status: "paid" });
    const headers = await signedHeaders(body);
    headers.set("x-credit-topup-signature", "0".repeat(64));
    const topupService = fakeTopupService();

    await expect(
      new CreditTopupWebhookService(env(), topupService as never).handle(
        body,
        headers,
      ),
    ).rejects.toMatchObject({
      code: "CREDIT_TOPUP_WEBHOOK_SIGNATURE_INVALID",
      status: 401,
    });
    expect(topupService.confirmIntent).not.toHaveBeenCalled();
  });

  it("rejects stale, future, and malformed signed timestamps", async () => {
    const body = JSON.stringify({ intentId: "intent-1", status: "paid" });

    for (const timestamp of [
      "2026-06-07T11:54:59.999Z",
      "2026-06-07T12:05:00.001Z",
      "not-a-date",
    ]) {
      await expect(
        new CreditTopupWebhookService(env()).handle(
          body,
          await signedHeaders(body, { timestamp }),
        ),
      ).rejects.toMatchObject({
        code: "CREDIT_TOPUP_WEBHOOK_SIGNATURE_STALE",
        status: 401,
      });
    }
  });

  it("accepts the boundary timestamp skew covered by the signature", async () => {
    const body = JSON.stringify({ intentId: "intent-1", status: "completed" });
    const topupService = fakeTopupService();

    await expect(
      new CreditTopupWebhookService(env(), topupService as never).handle(
        body,
        await signedHeaders(body, { timestamp: "2026-06-07T11:55:00.000Z" }),
      ),
    ).resolves.toMatchObject({
      duplicate: false,
      credited: true,
      intentId: "intent-1",
      status: "paid",
    });
  });
});
