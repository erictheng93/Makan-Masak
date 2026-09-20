import { beforeEach, describe, expect, it, vi } from "vitest";

const bcryptHash = vi.hoisted(() => vi.fn());
const bcryptCompare = vi.hoisted(() => vi.fn());

vi.mock("bcryptjs", () => ({
  default: {
    hash: bcryptHash,
    compare: bcryptCompare,
  },
}));

import { CreditService } from "./CreditService";
import type { Env } from "../../../types/env";
import {
  creditAccounts,
  creditCards,
  creditLedgerEntries,
  creditTopupIntents,
} from "@makanmasak/database";
import {
  createMutationFixtureDb,
  createSelectFixtureDb,
  type MutationFixtures,
  type SelectFixtures,
} from "@makanmasak/database/testing";

const account = {
  id: "account-1",
  ownerCustomerId: null,
  currency: "TWD",
  balanceCents: 50000,
  status: "active",
  version: 1,
  expiresAtMs: new Date("2027-06-01T00:00:00.000Z"),
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

const card = {
  id: "card-1",
  accountId: "account-1",
  publicId: "public-1",
  secretHash: "hash:1234",
  status: "active",
  pinRetryCount: 0,
  lockedUntilMs: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

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
 * `CreditService` terminates its selects with `.get()` (single row, or
 * `undefined` when the fixture entry is `[]`) or `.all()` (the whole array)
 * instead of awaiting the builder directly. Both consume the next fixture
 * queued for the table passed to `from()` — `.get()` just takes index 0 of
 * it.
 *
 * `creditAccounts`, `creditCards`, and `creditLedgerEntries` are all read
 * directly somewhere in this service (`loadCardAndAccount`, `refund`,
 * `expireStaleAccounts`, `findBalanceLedgerDrift`, `listLedger`,
 * `listLedgerForExport`, `findLedgerByIdempotencyKey`), so all three are
 * registered below. `findBalanceLedgerDrift` left-joins `creditLedgerEntries`
 * but selects `from(creditAccounts)`, so that call still routes to
 * `creditAccounts` — joins never change the routing table.
 * `creditTopupIntents` belongs to `CreditTopupService`, not this file's
 * service, and is never selected here; it is imported only so the
 * regression test below has a real, unregistered table to demonstrate the
 * "<unknown table>" case.
 *
 * Neither this service's selects nor its mutations are wrapped in try/catch
 * on the read paths — the one try/catch, in `expireStaleAccounts`, wraps
 * only its per-account update/insert calls, after the select already ran.
 * A harness throw from a missing/exhausted select fixture therefore always
 * surfaces as a rejected promise here; no swallowing caveat applies.
 *
 * Write fixtures follow the same rules with one extra key — the operation —
 * because an account is both inserted and updated and the two must not share
 * a queue. The one caveat the reads do not have: `expireStaleAccounts`
 * catches per-account write failures on purpose, so a missing write fixture
 * inside that loop lands in `failures[]` rather than failing the test. Its
 * assertion checks the error message for that reason.
 */
const fixtureTables = {
  creditAccounts,
  creditCards,
  creditLedgerEntries,
};
type FixtureName = keyof typeof fixtureTables;

function createFakeDb() {
  const selectFn = vi.fn();
  const insertFn = vi.fn();
  const updateFn = vi.fn();
  const batchFn = vi.fn();
  const drizzleBatchFn = vi.fn(
    async (statements: unknown[]) => statements.map(() => []) as unknown[],
  );
  const prepareFn = vi.fn(() => ({
    bind: vi.fn(function bind(this: unknown) {
      return this;
    }),
  }));

  function mockSelectResults(fixtures: SelectFixtures<FixtureName> = {}) {
    const fixtureDb = createSelectFixtureDb(fixtureTables, fixtures);
    selectFn.mockImplementation(fixtureDb.select);
  }

  /**
   * Writes are declared like reads, with one extra key: the operation. An
   * account is both inserted and updated, and a single queue per table would
   * let `insert(creditAccounts)` eat the fixture meant for
   * `update(creditAccounts)`. Re-declaring replaces the queues and the payload
   * log, so a test that declares once at the top reads as the full list of
   * writes it expects.
   */
  function mockMutationResults(fixtures: MutationFixtures<FixtureName> = {}) {
    const fixtureDb = createMutationFixtureDb(fixtureTables, fixtures);
    insertFn.mockImplementation(fixtureDb.insert);
    updateFn.mockImplementation(fixtureDb.update);
    return fixtureDb;
  }

  function mockBatchResults(results: Array<unknown[] | Error>) {
    const queue = [...results];
    batchFn.mockImplementation(async () => {
      const result = queue.shift();
      if (result === undefined) throw new Error("No batch fixtures remaining");
      if (result instanceof Error) throw result;
      return result;
    });
  }

  const db = {
    select: selectFn,
    insert: insertFn,
    update: updateFn,
    batch: drizzleBatchFn,
  };

  return {
    db,
    rawDb: { batch: batchFn, prepare: prepareFn },
    mockSelectResults,
    mockMutationResults,
    mockBatchResults,
  };
}

function createService(options: Partial<Env> = {}) {
  const fake = createFakeDb();
  const service = new CreditService({
    DB: fake.rawDb,
    CACHE_KV: {},
    ...options,
  } as Env);
  (service as unknown as { db: unknown }).db = fake.db;
  return { service, ...fake };
}

describe("CreditService", () => {
  beforeEach(() => {
    bcryptHash.mockReset();
    bcryptHash.mockResolvedValue("hash:new-pin");
    bcryptCompare.mockReset();
    bcryptCompare.mockResolvedValue(true);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "card-public-id" as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  it("routes select fixtures by table and reports missing fixtures", async () => {
    const { db, mockSelectResults } = createService();
    mockSelectResults({
      creditAccounts: [[account], [{ ...account, id: "account-2" }]],
      creditCards: [[card]],
    });

    // Read in reverse declaration order: routing follows the table passed to
    // from(), not the execution order.
    await expect(db.select().from(creditCards).get()).resolves.toEqual(card);
    await expect(db.select().from(creditAccounts).get()).resolves.toEqual(
      account,
    );
    await expect(db.select().from(creditAccounts).get()).resolves.toEqual({
      ...account,
      id: "account-2",
    });
    await expect(db.select().from(creditAccounts).get()).rejects.toThrow(
      "No select fixtures remaining for creditAccounts",
    );
    // creditTopupIntents is selected by CreditTopupService, not
    // CreditService, so it stays out of fixtureTables here and reports
    // <unknown table>.
    await expect(db.select().from(creditTopupIntents).get()).rejects.toThrow(
      "Missing select fixture for <unknown table>",
    );
  });

  it("issues cards, audits opening balances, and rejects negative balances", async () => {
    const { service, mockMutationResults } = createService();
    const mutations = mockMutationResults({
      creditAccounts: { insert: [[{ ...account, balanceCents: 12000 }]] },
      creditCards: { insert: [[{ ...card, publicId: "card-public-id" }]] },
      // The opening-balance audit entry is written without being read back.
      creditLedgerEntries: { insert: [{ changes: 1 }] },
    });

    const result = await service.issueCard({
      currency: "TWD",
      ownerCustomerId: "customer-1",
      pin: "1234",
      initialBalanceCents: 12000,
    });

    expect(result).toEqual({
      cardId: expect.any(String),
      publicId: expect.any(String),
      accountId: expect.any(String),
      currency: "TWD",
    });
    expect(bcryptHash).toHaveBeenCalledWith("1234", 10);
    expect(mutations.inserted[0]).toMatchObject({
      ownerCustomerId: "customer-1",
      currency: "TWD",
      balanceCents: 12000,
    });
    expect(mutations.inserted[2]).toMatchObject({
      accountId: result.accountId,
      entryType: "adjust",
      amountCents: 12000,
      idempotencyKey: `credit-issue:${result.accountId}`,
    });

    await expect(
      service.issueCard({ currency: "TWD", initialBalanceCents: -1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses an opening balance or manual top-up off the currency step", async () => {
    // NT$100.50 can never be spent to zero: the payment providers refuse an
    // off-step charge and no gateway takes the stray 50 cents. Both ways of
    // creating a balance by hand have to refuse it the way
    // CreditTopupService.createIntent already refuses a gateway top-up.
    const { service, mockMutationResults, mockSelectResults } = createService();
    const mutations = mockMutationResults({});
    mockSelectResults({});

    await expect(
      service.issueCard({ currency: "TWD", initialBalanceCents: 10050 }),
    ).rejects.toMatchObject({ code: "CREDIT_BALANCE_NOT_ALIGNED" });

    await expect(
      service.topup({
        publicId: "public-1",
        amountCents: 10050,
        currency: "TWD",
        idempotencyKey: "topup-1",
        sourceType: "topup",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_TOPUP_AMOUNT_NOT_ALIGNED" });

    // Refused before anything is written or even looked up.
    expect(mutations.inserted).toEqual([]);
  });

  it("accepts a sen-precision MYR opening balance", async () => {
    // The rule is the currency's precision, not "whole hundreds": RM100.50 is
    // a real MYR amount and must still be issuable.
    const { service, mockMutationResults } = createService();
    const mutations = mockMutationResults({
      creditAccounts: {
        insert: [[{ ...account, currency: "MYR", balanceCents: 10050 }]],
      },
      creditCards: { insert: [[{ ...card, publicId: "card-public-id" }]] },
      creditLedgerEntries: { insert: [{ changes: 1 }] },
    });

    await expect(
      service.issueCard({ currency: "MYR", initialBalanceCents: 10050 }),
    ).resolves.toMatchObject({ currency: "MYR" });
    expect(mutations.inserted[0]).toMatchObject({
      currency: "MYR",
      balanceCents: 10050,
    });
  });

  it("returns balances and validates card/account lookup failures", async () => {
    const { service, mockSelectResults } = createService();
    mockSelectResults({ creditCards: [[card]], creditAccounts: [[account]] });

    await expect(service.getBalance("public-1")).resolves.toEqual({
      publicId: "public-1",
      accountId: "account-1",
      currency: "TWD",
      balanceCents: 50000,
      status: "active",
      cardStatus: "active",
      expiresAtMs: account.expiresAtMs.getTime(),
    });

    mockSelectResults({ creditCards: [[]] });
    await expect(service.getBalance("missing")).rejects.toMatchObject({
      code: "CREDIT_CARD_NOT_FOUND",
    });

    mockSelectResults({ creditCards: [[card]], creditAccounts: [[]] });
    await expect(service.getBalance("orphan")).rejects.toMatchObject({
      code: "CREDIT_ACCOUNT_NOT_FOUND",
    });
  });

  it("spends with replay, guard, PIN, and atomic ledger movement branches", async () => {
    const {
      service,
      mockSelectResults,
      mockMutationResults,
      mockBatchResults,
    } = createService({
      CREDIT_PIN_THRESHOLD_CENTS: "1000",
    } as Partial<Env>);
    const mutations = mockMutationResults({
      creditCards: { update: [{ changes: 1 }] }, // failed PIN bumps the retry count
    });
    mockBatchResults([
      [{ meta: { changes: 0 } }, { results: [] }],
      [
        { meta: { changes: 1 } },
        {
          results: [
            {
              id: "ledger-1",
              account_id: "account-1",
              balance_after_cents: 48000,
            },
          ],
        },
      ],
      new Error(
        "UNIQUE constraint failed: credit_ledger_entries.idempotency_key",
      ),
    ]);
    mockSelectResults({
      creditLedgerEntries: [
        [
          {
            id: "ledger-existing",
            accountId: "account-1",
            balanceAfterCents: 49000,
          },
        ],
      ],
    });
    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 1000,
        currency: "TWD",
        idempotencyKey: "spend-replay",
        sourceType: "checkout",
      }),
    ).resolves.toEqual({
      ledgerEntryId: "ledger-existing",
      accountId: "account-1",
      balanceAfterCents: 49000,
    });

    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 0,
        currency: "TWD",
        idempotencyKey: "bad",
        sourceType: "checkout",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditCards: [[card]],
      creditAccounts: [[{ ...account, status: "suspended" }]],
    });
    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 100,
        currency: "TWD",
        idempotencyKey: "inactive",
        sourceType: "checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_ACCOUNT_INACTIVE" });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditCards: [[card]],
      creditAccounts: [[{ ...account, currency: "MYR" }]],
    });
    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 100,
        currency: "TWD",
        idempotencyKey: "currency",
        sourceType: "checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CURRENCY_MISMATCH" });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditCards: [[card]],
      creditAccounts: [[account]],
    });
    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "missing-pin",
        sourceType: "checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_PIN_REQUIRED" });

    bcryptCompare.mockResolvedValueOnce(false);
    mockSelectResults({
      creditLedgerEntries: [[]],
      creditCards: [[card]],
      creditAccounts: [[account]],
    });
    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "bad-pin",
        sourceType: "checkout",
        pin: "0000",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_PIN_INVALID" });
    expect(mutations.updated.at(-1)).toMatchObject({ pinRetryCount: 1 });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditCards: [[card]],
      creditAccounts: [[account]],
    });
    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 60000,
        currency: "TWD",
        idempotencyKey: "overspend",
        sourceType: "checkout",
        pin: "1234",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditCards: [[card]],
      creditAccounts: [[account]],
    });
    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "spend-ok",
        sourceType: "checkout",
        sourceId: "checkout-1",
        marketCheckoutPaymentId: "pay-1",
        pin: "1234",
      }),
    ).resolves.toEqual({
      ledgerEntryId: "ledger-1",
      accountId: "account-1",
      balanceAfterCents: 48000,
    });

    mockSelectResults({
      creditLedgerEntries: [
        [],
        [
          {
            id: "ledger-canonical",
            accountId: "account-1",
            balanceAfterCents: 47000,
          },
        ],
      ],
      creditCards: [[card]],
      creditAccounts: [[account]],
    });
    await expect(
      service.spend({
        publicId: "public-1",
        amountCents: 3000,
        currency: "TWD",
        idempotencyKey: "spend-race",
        sourceType: "checkout",
        pin: "1234",
      }),
    ).resolves.toEqual({
      ledgerEntryId: "ledger-canonical",
      accountId: "account-1",
      balanceAfterCents: 47000,
    });
  });

  it("topups, refunds, and resolves refunds from original spend keys", async () => {
    const { service, mockSelectResults, mockBatchResults } = createService();
    mockBatchResults([
      [
        { meta: { changes: 1 } },
        {
          results: [
            {
              id: "topup-ledger",
              account_id: "account-1",
              balance_after_cents: 55000,
            },
          ],
        },
      ],
      [
        { meta: { changes: 1 } },
        {
          results: [
            {
              id: "refund-ledger",
              account_id: "account-1",
              balance_after_cents: 51000,
            },
          ],
        },
      ],
      [
        { meta: { changes: 1 } },
        {
          results: [
            {
              id: "refund-from-spend",
              account_id: "account-1",
              balance_after_cents: 50000,
            },
          ],
        },
      ],
    ]);

    mockSelectResults({
      creditLedgerEntries: [
        [
          {
            id: "topup-existing",
            accountId: "account-1",
            balanceAfterCents: 55000,
          },
        ],
      ],
    });
    await expect(
      service.topup({
        publicId: "public-1",
        amountCents: 5000,
        currency: "TWD",
        idempotencyKey: "topup-replay",
        sourceType: "topup",
      }),
    ).resolves.toMatchObject({ ledgerEntryId: "topup-existing" });

    await expect(
      service.topup({
        publicId: "public-1",
        amountCents: 0,
        currency: "TWD",
        idempotencyKey: "bad-topup",
        sourceType: "topup",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditCards: [[card]],
      creditAccounts: [[{ ...account, currency: "MYR" }]],
    });
    await expect(
      service.topup({
        publicId: "public-1",
        amountCents: 1000,
        currency: "TWD",
        idempotencyKey: "topup-currency",
        sourceType: "topup",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CURRENCY_MISMATCH" });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditCards: [[card]],
      creditAccounts: [[account]],
    });
    await expect(
      service.topup({
        publicId: "public-1",
        amountCents: 5000,
        currency: "TWD",
        idempotencyKey: "topup-ok",
        sourceType: "topup",
        sourceId: "cashier-1",
      }),
    ).resolves.toEqual({
      ledgerEntryId: "topup-ledger",
      accountId: "account-1",
      balanceAfterCents: 55000,
    });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditAccounts: [[]],
    });
    await expect(
      service.refund({
        accountId: "missing",
        amountCents: 100,
        currency: "TWD",
        idempotencyKey: "refund-missing",
        sourceType: "refund",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_ACCOUNT_NOT_FOUND" });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditAccounts: [[{ ...account, currency: "MYR" }]],
    });
    await expect(
      service.refund({
        accountId: "account-1",
        amountCents: 100,
        currency: "TWD",
        idempotencyKey: "refund-currency",
        sourceType: "refund",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CURRENCY_MISMATCH" });

    mockSelectResults({
      creditLedgerEntries: [[]],
      creditAccounts: [[account]],
    });
    await expect(
      service.refund({
        accountId: "account-1",
        amountCents: 1000,
        currency: "TWD",
        idempotencyKey: "refund-ok",
        sourceType: "refund",
        marketCheckoutPaymentId: "pay-1",
      }),
    ).resolves.toMatchObject({
      ledgerEntryId: "refund-ledger",
      balanceAfterCents: 51000,
    });

    mockSelectResults({ creditLedgerEntries: [[]] });
    await expect(
      service.refundByOriginalSpend({
        spendIdempotencyKey: "unknown-spend",
        refundIdempotencyKey: "refund-by-spend",
        amountCents: 100,
        currency: "TWD",
        sourceType: "refund",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_SPEND_NOT_FOUND" });

    mockSelectResults({
      creditLedgerEntries: [
        [
          {
            id: "spend-ledger",
            accountId: "account-1",
            balanceAfterCents: 49000,
          },
        ],
        [],
      ],
      creditAccounts: [[account]],
    });
    await expect(
      service.refundByOriginalSpend({
        spendIdempotencyKey: "known-spend",
        refundIdempotencyKey: "refund-from-spend",
        amountCents: 1000,
        currency: "TWD",
        sourceType: "refund",
      }),
    ).resolves.toMatchObject({ ledgerEntryId: "refund-from-spend" });
  });

  it("manages cards and reads ledger/export/drift reports", async () => {
    const { service, mockSelectResults, mockMutationResults } = createService();
    const mutations = mockMutationResults({
      // setPin, then setCardStatus.
      creditCards: { update: [{ changes: 1 }, { changes: 1 }] },
    });

    mockSelectResults({ creditCards: [[card]], creditAccounts: [[account]] });
    await service.setPin("public-1", "4321");
    expect(mutations.updated.at(-1)).toMatchObject({
      secretHash: "hash:new-pin",
      pinRetryCount: 0,
      lockedUntilMs: null,
    });

    mockSelectResults({ creditCards: [[card]], creditAccounts: [[account]] });
    await service.setCardStatus("public-1", "frozen");
    expect(mutations.updated.at(-1)).toMatchObject({ status: "frozen" });

    mockSelectResults({
      creditCards: [[card]],
      creditAccounts: [[account]],
      creditLedgerEntries: [[{ id: "ledger-1" }]],
    });
    await expect(
      service.listLedger("public-1", { limit: 500, offset: -5 }),
    ).resolves.toEqual({
      accountId: "account-1",
      entries: [{ id: "ledger-1" }],
    });

    mockSelectResults({ creditLedgerEntries: [[{ id: "export-1" }]] });
    await expect(service.listLedgerForExport({ limit: 0 })).resolves.toEqual([
      { id: "export-1" },
    ]);

    mockSelectResults({ creditLedgerEntries: [[{ id: "export-2" }]] });
    await expect(
      service.listLedgerForExport({
        fromMs: Date.parse("2026-06-01T00:00:00.000Z"),
        toMs: Date.parse("2026-06-02T00:00:00.000Z"),
      }),
    ).resolves.toEqual([{ id: "export-2" }]);

    mockSelectResults({
      creditAccounts: [
        [{ accountId: "account-1", balanceCents: 5000, ledgerSumCents: 4500 }],
      ],
    });
    await expect(service.findBalanceLedgerDrift()).resolves.toEqual([
      {
        accountId: "account-1",
        balanceCents: 5000,
        ledgerSumCents: 4500,
        driftCents: 500,
      },
    ]);
  });

  it("expires stale accounts with isolated failures and concurrent-update skips", async () => {
    const { service, mockSelectResults, mockBatchResults } = createService();
    mockBatchResults([
      [{ meta: { changes: 0 } }, { meta: { changes: 0 } }],
      [{ meta: { changes: 1 } }, { meta: { changes: 1 } }],
      new Error("write failed"),
    ]);
    mockSelectResults({
      creditAccounts: [
        [
          {
            id: "account-skip",
            balanceCents: 1000,
            version: 1,
            currency: "TWD",
            expiresAtMs: new Date("2026-01-01T00:00:00.000Z"),
          },
          {
            id: "account-expire",
            balanceCents: 2000,
            version: 2,
            currency: "TWD",
            expiresAtMs: new Date("2026-01-02T00:00:00.000Z"),
          },
          {
            id: "account-fail",
            balanceCents: 3000,
            version: 3,
            currency: "TWD",
            expiresAtMs: new Date("2026-01-03T00:00:00.000Z"),
          },
        ],
      ],
    });
    const result = await service.expireStaleAccounts({
      nowMs: Date.parse("2026-06-01T00:00:00.000Z"),
      limit: 5000,
    });

    expect(result).toEqual({
      scanned: 3,
      expired: 1,
      totalExpiredCents: 2000,
      failures: [{ accountId: "account-fail", error: "write failed" }],
    });
  });
});
