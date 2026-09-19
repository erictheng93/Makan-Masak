import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => mocks.db),
}));

import {
  createCreditTopupGateway,
  CreditTopupService,
  hmacSha256Hex,
  HttpCreditTopupGateway,
  type CreditTopupGateway,
} from "./CreditTopupService";
import {
  creditAccounts,
  creditCards,
  creditTopupIntents,
} from "@makanmasak/database";
import {
  createMutationFixtureDb,
  createSelectFixtureDb,
  type MutationFixtures,
  type SelectFixtures,
} from "@makanmasak/database/testing";

/**
 * Select fixtures are keyed by table, not by call order: `from(table)`
 * decides which queue a query draws from, so adding a query against one
 * table can no longer shift another table's results out from under it.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a fixture
 *   at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared. An
 *   unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing
 * falls back to `[]`/`null`; a silent empty/null result is what made the
 * previous positional queue so hard to trace back to its cause.
 *
 * `CreditTopupService` terminates its selects with `.get()` (single row, or
 * `undefined` when the fixture entry is `[]`) instead of awaiting the
 * builder directly — it consumes the next fixture queued for the table
 * passed to `from()` and takes index 0 of it.
 *
 * `createIntent` selects `from(creditCards)` and inner-joins `creditAccounts`
 * to read the account row in one query — that call still routes to
 * `creditCards` because joins never change the routing table, so
 * `creditAccounts` is never the `from()` target anywhere in this service and
 * stays out of `fixtureTables`. It is imported here only so the regression
 * test below has a real, unregistered table to demonstrate the
 * "<unknown table>" case. `creditTopupIntents` is both the only table
 * `getIntent`/`findIntent` select from and the table `createIntent`/
 * `confirmIntent` insert and update, so it is registered once and its read,
 * insert, and update queues are all kept apart.
 *
 * None of this service's selects are wrapped in try/catch — the one
 * try/catch, in `createIntent`, wraps only the gateway call and the update
 * that marks a failed intent, after the select already ran. A harness throw
 * from a missing/exhausted fixture therefore always surfaces as a rejected
 * promise here, with one exception: a missing fixture for that rollback
 * update would be reported as the gateway error instead of its own.
 */
const fixtureTables = {
  creditCards,
  creditTopupIntents,
};
type FixtureName = keyof typeof fixtureTables;

function mockSelectResults(fixtures: SelectFixtures<FixtureName> = {}) {
  const fixtureDb = createSelectFixtureDb(fixtureTables, fixtures);
  mocks.db.select.mockImplementation(fixtureDb.select);
}

/**
 * Writes are declared per table *and* operation. `creditTopupIntents` is both
 * inserted (createIntent) and updated (the gateway-failure rollback, the
 * provider-id patch, confirmIntent), and a single queue per table would let
 * the insert consume what the update declared.
 */
function mockMutationResults(fixtures: MutationFixtures<FixtureName> = {}) {
  const fixtureDb = createMutationFixtureDb(fixtureTables, fixtures);
  mocks.db.insert.mockImplementation(fixtureDb.insert);
  mocks.db.update.mockImplementation(fixtureDb.update);
  return fixtureDb;
}

function env(overrides: Partial<Env> = {}) {
  return {
    DB: {},
    CACHE_KV: {},
    ...overrides,
  } as Env;
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    accountId: "account-1",
    publicId: "card-public-1",
    provider: "credit_topup",
    providerTransactionId: "txn-1",
    amountCents: 1500,
    currency: "TWD",
    status: "pending",
    ledgerEntryId: null,
    providerPayload: null,
    errorMessage: null,
    expiresAtMs: new Date("2026-06-07T00:30:00.000Z"),
    paidAtMs: null,
    failedAtMs: null,
    createdAt: new Date("2026-06-07T00:00:00.000Z"),
    updatedAt: new Date("2026-06-07T00:00:00.000Z"),
    ...overrides,
  };
}

function creditService() {
  return {
    topup: vi.fn(async () => ({
      ledgerEntryId: "ledger-1",
      accountId: "account-1",
      balanceAfterCents: 6500,
    })),
  };
}

function gateway(overrides: Partial<CreditTopupGateway> = {}) {
  return {
    createCharge: vi.fn(async () => ({
      providerTransactionId: "txn-1",
      status: "requires_action" as const,
      nextAction: {
        type: "redirect" as const,
        redirectUrl: "https://pay.example.test/intent-1",
      },
    })),
    ...overrides,
  };
}

describe("CreditTopupService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("routes select fixtures by table and reports missing fixtures", async () => {
    mockMutationResults();
    const card = { id: "account-1", currency: "TWD", status: "active" };
    mockSelectResults({
      creditTopupIntents: [[intent()], [intent({ id: "intent-2" })]],
      creditCards: [[card]],
    });

    // Read in reverse declaration order: routing follows the table passed to
    // from(), not the execution order.
    await expect(mocks.db.select().from(creditCards).get()).resolves.toEqual(
      card,
    );
    await expect(
      mocks.db.select().from(creditTopupIntents).get(),
    ).resolves.toEqual(intent());
    await expect(
      mocks.db.select().from(creditTopupIntents).get(),
    ).resolves.toEqual(intent({ id: "intent-2" }));
    await expect(
      mocks.db.select().from(creditTopupIntents).get(),
    ).rejects.toThrow("No select fixtures remaining for creditTopupIntents");
    // creditAccounts is only ever inner-joined in this service (createIntent
    // selects from(creditCards)), never the from() target, so it stays out
    // of fixtureTables and reports <unknown table>.
    await expect(mocks.db.select().from(creditAccounts).get()).rejects.toThrow(
      "Missing select fixture for <unknown table>",
    );
  });

  it("creates an online top-up intent and stores provider metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const fakeGateway = gateway();
    const mutations = mockMutationResults({
      creditTopupIntents: {
        insert: [[intent({ providerTransactionId: null })]],
        // The provider transaction id is patched in once the charge succeeds.
        update: [[intent()]],
      },
    });
    mockSelectResults({
      creditCards: [[{ id: "account-1", currency: "TWD", status: "active" }]],
    });

    const result = await new CreditTopupService(
      env(),
      creditService() as never,
      fakeGateway,
    ).createIntent({
      publicId: "card-public-1",
      amountCents: 1500,
      currency: "TWD",
    });

    expect(result).toMatchObject({
      intent: { id: "intent-1", providerTransactionId: "txn-1" },
      nextAction: {
        type: "redirect",
        redirectUrl: "https://pay.example.test/intent-1",
      },
    });
    expect(mutations.inserted[0]).toMatchObject({
      accountId: "account-1",
      publicId: "card-public-1",
      provider: "credit_topup",
      amountCents: 1500,
      currency: "TWD",
      expiresAtMs: new Date("2026-06-07T00:30:00.000Z"),
    });
    expect(fakeGateway.createCharge).toHaveBeenCalledWith({
      intentId: "intent-1",
      publicId: "card-public-1",
      amountCents: 1500,
      amountMinor: 1500,
      currencyExponent: 2,
      currency: "TWD",
      idempotencyKey: "credit-topup:intent-1",
    });
    expect(mutations.updated.at(-1)).toMatchObject({
      providerTransactionId: "txn-1",
      updatedAt: expect.any(Date),
    });
    vi.useRealTimers();
  });

  it("rejects invalid create intent states and marks gateway failures", async () => {
    const mutations = mockMutationResults({
      creditTopupIntents: {
        insert: [[intent({ providerTransactionId: null })]],
        // The gateway failure marks the orphaned intent failed without
        // reading it back.
        update: [{ changes: 1 }],
      },
    });
    const service = new CreditTopupService(
      env(),
      creditService() as never,
      gateway(),
    );

    await expect(
      service.createIntent({
        publicId: "card-public-1",
        amountCents: 0,
        currency: "TWD",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    mockSelectResults({ creditCards: [[]] });
    await expect(
      service.createIntent({
        publicId: "missing",
        amountCents: 1000,
        currency: "TWD",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CARD_NOT_FOUND" });

    mockSelectResults({
      creditCards: [
        [{ id: "account-1", currency: "TWD", status: "suspended" }],
      ],
    });
    await expect(
      service.createIntent({
        publicId: "card-public-1",
        amountCents: 1000,
        currency: "TWD",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_ACCOUNT_INACTIVE" });

    mockSelectResults({
      creditCards: [[{ id: "account-1", currency: "MYR", status: "active" }]],
    });
    await expect(
      service.createIntent({
        publicId: "card-public-1",
        amountCents: 1000,
        currency: "TWD",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CURRENCY_MISMATCH" });

    const failingGateway = gateway({
      createCharge: vi.fn(async () => {
        throw new Error("gateway down");
      }),
    });
    mockSelectResults({
      creditCards: [[{ id: "account-1", currency: "TWD", status: "active" }]],
    });
    await expect(
      new CreditTopupService(
        env(),
        creditService() as never,
        failingGateway,
      ).createIntent({
        publicId: "card-public-1",
        amountCents: 1000,
        currency: "TWD",
      }),
    ).rejects.toThrow("gateway down");
    expect(mutations.updated.at(-1)).toMatchObject({
      status: "failed",
      errorMessage: "gateway down",
      updatedAt: expect.any(Date),
    });
  });

  it("confirms failed and paid intents while preserving idempotency", async () => {
    const fakeCreditService = creditService();
    mockMutationResults({
      creditTopupIntents: {
        update: [
          [intent({ status: "failed", errorMessage: "declined" })],
          [
            intent({
              status: "paid",
              ledgerEntryId: "ledger-1",
              paidAtMs: new Date("2026-06-07T00:01:00.000Z"),
            }),
          ],
        ],
      },
    });
    const service = new CreditTopupService(
      env(),
      fakeCreditService as never,
      gateway(),
    );

    mockSelectResults({ creditTopupIntents: [[intent()]] });
    await expect(
      service.confirmIntent({
        intentId: "intent-1",
        status: "failed",
        providerPayload: { event: "failed" },
        errorMessage: "declined",
      }),
    ).resolves.toMatchObject({
      intent: { status: "failed", errorMessage: "declined" },
      credited: false,
      alreadyProcessed: false,
    });

    mockSelectResults({ creditTopupIntents: [[intent()]] });
    await expect(
      service.confirmIntent({
        intentId: "intent-1",
        status: "paid",
        paidAmountCents: 1500,
        paidCurrency: "TWD",
        providerPayload: { event: "paid" },
      }),
    ).resolves.toMatchObject({
      intent: { status: "paid", ledgerEntryId: "ledger-1" },
      credited: true,
      alreadyProcessed: false,
      balanceAfterCents: 6500,
    });
    expect(fakeCreditService.topup).toHaveBeenCalledWith({
      publicId: "card-public-1",
      amountCents: 1500,
      currency: "TWD",
      idempotencyKey: "credit-topup:intent-1",
      sourceType: "topup",
      sourceId: "intent-1",
    });

    mockSelectResults({
      creditTopupIntents: [[intent({ status: "paid" })]],
    });
    await expect(
      service.confirmIntent({ intentId: "intent-1", status: "paid" }),
    ).resolves.toMatchObject({
      credited: false,
      alreadyProcessed: true,
    });

    mockSelectResults({
      creditTopupIntents: [[intent({ status: "expired" })]],
    });
    await expect(
      service.confirmIntent({ providerTransactionId: "txn-1", status: "paid" }),
    ).resolves.toMatchObject({
      credited: false,
      alreadyProcessed: true,
    });
  });

  it.each([
    [
      "underpaid",
      { paidAmountCents: 1400, paidCurrency: "TWD" },
      "AMOUNT_MISMATCH",
    ],
    [
      "in another currency",
      { paidAmountCents: 1500, paidCurrency: "MYR" },
      "CURRENCY_MISMATCH",
    ],
    ["without an amount", { paidCurrency: "TWD" }, "AMOUNT_MISSING"],
    ["without a currency", { paidAmountCents: 1500 }, "CURRENCY_MISSING"],
  ])(
    "does not credit a paid confirmation %s",
    async (_label, money, reason) => {
      const fakeCreditService = creditService();
      const run = vi.fn(async () => ({ meta: { changes: 1 } }));
      const bind = vi.fn(() => ({ run }));
      const prepare = vi.fn(() => ({ bind }));
      const mutations = mockMutationResults({
        creditTopupIntents: {
          update: [[intent({ errorCode: reason })]],
        },
      });
      mockSelectResults({ creditTopupIntents: [[intent()]] });

      const result = await new CreditTopupService(
        env({ DB: { prepare } as never }),
        fakeCreditService as never,
        gateway(),
      ).confirmIntent({
        intentId: "intent-1",
        status: "paid",
        providerPayload: { event: "paid" },
        ...money,
      });

      expect(result).toMatchObject({
        credited: false,
        alreadyProcessed: false,
        reviewRequired: true,
        reviewReason: reason,
      });
      expect(fakeCreditService.topup).not.toHaveBeenCalled();
      expect(mutations.updated.at(-1)).toMatchObject({
        errorCode: reason,
        errorMessage: expect.any(String),
      });
      expect(mutations.updated.at(-1)).not.toHaveProperty("status");
      expect(prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR IGNORE INTO payment_audit_log"),
      );
      expect(bind).toHaveBeenCalledWith(
        expect.any(String),
        null,
        "intent-1",
        null,
        "failure",
        "credit_topup",
        null,
        null,
        money.paidAmountCents ?? null,
        money.paidCurrency ?? null,
        expect.any(String),
        `CREDIT_TOPUP_${reason}`,
        expect.any(String),
        expect.any(Number),
      );
    },
  );

  it("refuses top-up amounts that are not whole currency units", async () => {
    mockMutationResults({});
    const fakeGateway = gateway();
    const service = new CreditTopupService(
      env(),
      creditService() as never,
      fakeGateway,
    );

    await expect(
      service.createIntent({
        publicId: "card-public-1",
        amountCents: 1550,
        currency: "TWD",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_AMOUNT_NOT_ALIGNED" });
    await expect(
      service.createIntent({
        publicId: "card-public-1",
        amountCents: 1500,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CURRENCY_UNSUPPORTED" });
    expect(fakeGateway.createCharge).not.toHaveBeenCalled();
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("guards confirmation identifiers and reads intents by id", async () => {
    mockMutationResults();
    const service = new CreditTopupService(
      env(),
      creditService() as never,
      gateway(),
    );

    await expect(
      service.confirmIntent({ status: "paid" }),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_IDENTIFIER_REQUIRED" });

    mockSelectResults({ creditTopupIntents: [[]] });
    await expect(
      service.confirmIntent({ intentId: "missing", status: "paid" }),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_INTENT_NOT_FOUND" });

    mockSelectResults({
      creditTopupIntents: [[intent({ providerTransactionId: "txn-real" })]],
    });
    await expect(
      service.confirmIntent({
        intentId: "intent-1",
        providerTransactionId: "txn-spoof",
        status: "paid",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_IDENTIFIER_MISMATCH" });

    mockSelectResults({ creditTopupIntents: [[intent()]] });
    await expect(service.getIntent("intent-1")).resolves.toMatchObject({
      id: "intent-1",
    });
  });
});

describe("Credit top-up gateway helpers", () => {
  it("returns an unconfigured gateway when no provider URL is set", async () => {
    await expect(
      createCreditTopupGateway(env()).createCharge({
        intentId: "intent-1",
        publicId: "card-public-1",
        amountCents: 1000,
        currency: "TWD",
        idempotencyKey: "credit-topup:intent-1",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_NOT_CONFIGURED" });
  });

  it("calls the injected fetch unbound, as workerd requires", async () => {
    function strictFetch(this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(
        new Response(JSON.stringify({ providerTransactionId: "txn-1" })),
      );
    }

    await expect(
      new HttpCreditTopupGateway(
        "https://pay.example.test/topups",
        undefined,
        undefined,
        strictFetch as unknown as typeof fetch,
      ).createCharge({
        intentId: "intent-1",
        publicId: "card-public-1",
        amountCents: 1000,
        amountMinor: 1000,
        currencyExponent: 2,
        currency: "TWD",
        idempotencyKey: "credit-topup:intent-1",
      }),
    ).resolves.toMatchObject({ providerTransactionId: "txn-1" });
  });

  it("posts signed HTTP charge requests and normalizes gateway responses", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          providerTransactionId: "txn-http",
          status: "unexpected",
          nextAction: {
            type: "client_secret",
            clientSecret: "secret-1",
          },
        }),
        { status: 200 },
      );
    });
    const gateway = new HttpCreditTopupGateway(
      "https://pay.example.test/topups",
      "bearer-token",
      "signing-secret",
      fetcher as never,
    );

    await expect(
      gateway.createCharge({
        intentId: "intent-1",
        publicId: "card-public-1",
        amountCents: 1000,
        currency: "TWD",
        idempotencyKey: "credit-topup:intent-1",
      }),
    ).resolves.toEqual({
      providerTransactionId: "txn-http",
      status: "pending",
      nextAction: { type: "client_secret", clientSecret: "secret-1" },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://pay.example.test/topups",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer bearer-token",
          "x-credit-topup-signature": expect.any(String),
          "x-credit-topup-signature-timestamp": expect.any(String),
        }),
        body: JSON.stringify({
          intentId: "intent-1",
          publicId: "card-public-1",
          amountCents: 1000,
          currency: "TWD",
          idempotencyKey: "credit-topup:intent-1",
        }),
      }),
    );
  });

  it("rejects failed or malformed HTTP gateway responses", async () => {
    await expect(
      new HttpCreditTopupGateway(
        "https://pay.example.test/topups",
        undefined,
        undefined,
        vi.fn(async () => new Response("nope", { status: 503 })) as never,
      ).createCharge({
        intentId: "intent-1",
        publicId: "card-public-1",
        amountCents: 1000,
        currency: "TWD",
        idempotencyKey: "credit-topup:intent-1",
      }),
    ).rejects.toThrow("Credit top-up gateway failed: 503");

    await expect(
      new HttpCreditTopupGateway(
        "https://pay.example.test/topups",
        undefined,
        undefined,
        vi.fn(
          async () => new Response(JSON.stringify({ status: "paid" })),
        ) as never,
      ).createCharge({
        intentId: "intent-1",
        publicId: "card-public-1",
        amountCents: 1000,
        currency: "TWD",
        idempotencyKey: "credit-topup:intent-1",
      }),
    ).rejects.toThrow("Credit top-up gateway response is invalid");
  });

  it("computes deterministic HMAC SHA-256 hex signatures", async () => {
    await expect(hmacSha256Hex("secret", "value")).resolves.toBe(
      "50e03ebe65be98bb8bf11ba2c892d54c079aca2b0d3b0162769c6d757a25434f",
    );
  });
});
