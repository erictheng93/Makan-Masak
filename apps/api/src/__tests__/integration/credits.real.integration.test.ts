/**
 * Real-D1 tests for CreditService (代幣 stored-value ledger).
 *
 * Runs the real implementation against a Miniflare D1 database through Drizzle,
 * so the money-safety guarantees are proven against actual SQLite semantics:
 *   - guarded conditional UPDATE prevents overspend
 *   - concurrent spends on one balance cannot double-spend
 *   - idempotency-key replays never deduct twice
 *   - threshold-based PIN + lockout
 *   - top-up / refund movements
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  creditAccounts,
  creditCards,
  creditLedgerEntries,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import type { Env } from "../../types/env";
import { CreditService } from "../../features/credits/services/CreditService";

let testDb: TestDatabase;

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
    ...overrides,
  } as Env;
}

function makeService(overrides: Partial<Env> = {}): CreditService {
  return new CreditService(buildEnv(overrides));
}

async function ledgerEntriesFor(accountId: string) {
  return testDb.drizzle
    .select()
    .from(creditLedgerEntries)
    .where(eq(creditLedgerEntries.accountId, accountId))
    .all();
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

describe("CreditService — issue & balance", () => {
  it("issues a card with an account and reports balance", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 5000,
    });

    expect(card).toMatchObject({
      publicId: expect.any(String),
      accountId: expect.any(String),
      currency: "TWD",
    });

    const balance = await service.getBalance(card.publicId);
    expect(balance).toMatchObject({
      balanceCents: 5000,
      currency: "TWD",
      status: "active",
      cardStatus: "active",
    });
  });

  it("rolls back the account when creating its card fails", async () => {
    const service = makeService();

    await testDb.db
      .prepare(
        `CREATE TRIGGER poison_credit_card_insert
           BEFORE INSERT ON credit_cards
           BEGIN SELECT RAISE(ABORT, 'poisoned card insert'); END`,
      )
      .run();

    try {
      await expect(
        service.issueCard({ currency: "TWD", initialBalanceCents: 5000 }),
      ).rejects.toThrow();

      expect(await testDb.drizzle.select().from(creditAccounts).all()).toEqual(
        [],
      );
      expect(await testDb.drizzle.select().from(creditCards).all()).toEqual([]);
      expect(await service.findBalanceLedgerDrift()).toEqual([]);
    } finally {
      await testDb.db.prepare("DROP TRIGGER poison_credit_card_insert").run();
    }
  });
});

describe("CreditService — expiry atomicity", () => {
  it("keeps the balance when writing the expiry ledger entry fails", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 5000,
    });
    const expiredAtMs = Date.now() - 1;
    await testDb.drizzle
      .update(creditAccounts)
      .set({ expiresAtMs: new Date(expiredAtMs) })
      .where(eq(creditAccounts.id, card.accountId));

    await testDb.db
      .prepare(
        `CREATE TRIGGER poison_expiry_ledger_insert
           BEFORE INSERT ON credit_ledger_entries
           WHEN NEW.entry_type = 'expire'
           BEGIN SELECT RAISE(ABORT, 'poisoned expiry ledger insert'); END`,
      )
      .run();

    try {
      const result = await service.expireStaleAccounts({
        nowMs: Date.now(),
      });

      expect(result).toMatchObject({ expired: 0, totalExpiredCents: 0 });
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error).toContain(
        "poisoned expiry ledger insert",
      );
      expect((await service.getBalance(card.publicId)).balanceCents).toBe(5000);
      expect(
        (await ledgerEntriesFor(card.accountId)).filter(
          (entry) => entry.entryType === "expire",
        ),
      ).toEqual([]);
      expect(await service.findBalanceLedgerDrift()).toEqual([]);
    } finally {
      await testDb.db.prepare("DROP TRIGGER poison_expiry_ledger_insert").run();
    }
  });

  it("does not expire a stale snapshot after a concurrent full spend", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 5000,
    });
    await testDb.drizzle
      .update(creditAccounts)
      .set({ expiresAtMs: new Date(Date.now() - 1) })
      .where(eq(creditAccounts.id, card.accountId));

    let injectedSpend = false;
    const wrappedDb = new Proxy(testDb.bindings.DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!injectedSpend) {
              injectedSpend = true;
              await service.spend({
                publicId: card.publicId,
                amountCents: 5000,
                currency: "TWD",
                idempotencyKey: "spend-before-expiry-batch",
                sourceType: "market_checkout",
              });
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const expiryService = makeService({ DB: wrappedDb });

    const result = await expiryService.expireStaleAccounts({
      nowMs: Date.now(),
    });

    expect(injectedSpend).toBe(true);
    expect(result).toMatchObject({
      scanned: 1,
      expired: 0,
      totalExpiredCents: 0,
      failures: [],
    });
    expect((await service.getBalance(card.publicId)).balanceCents).toBe(0);
    expect(
      (await ledgerEntriesFor(card.accountId)).filter(
        (entry) => entry.entryType === "expire",
      ),
    ).toEqual([]);
    expect(await service.findBalanceLedgerDrift()).toEqual([]);
  });
});

describe("CreditService — spend guards", () => {
  it("deducts the full amount and records a signed ledger entry", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });

    const result = await service.spend({
      publicId: card.publicId,
      amountCents: 300,
      currency: "TWD",
      idempotencyKey: "spend-1",
      sourceType: "market_checkout",
      sourceId: "checkout-1",
    });

    expect(result.balanceAfterCents).toBe(700);
    expect((await service.getBalance(card.publicId)).balanceCents).toBe(700);

    const spendEntries = (await ledgerEntriesFor(card.accountId)).filter(
      (e) => e.entryType === "spend",
    );
    expect(spendEntries).toHaveLength(1);
    expect(spendEntries[0]).toMatchObject({
      entryType: "spend",
      amountCents: -300,
      balanceAfterCents: 700,
      currency: "TWD",
      idempotencyKey: "spend-1",
    });
  });

  it("rejects overspend and leaves the balance untouched", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 200,
    });

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 500,
        currency: "TWD",
        idempotencyKey: "spend-over",
        sourceType: "market_checkout",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    expect((await service.getBalance(card.publicId)).balanceCents).toBe(200);
    const spends = (await ledgerEntriesFor(card.accountId)).filter(
      (e) => e.entryType === "spend",
    );
    expect(spends).toHaveLength(0); // no spend written (opening adjust entry aside)
  });

  it("rejects a currency mismatch", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 100,
        currency: "MYR",
        idempotencyKey: "spend-cur",
        sourceType: "market_checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CURRENCY_MISMATCH" });
  });

  it("does not double-spend under concurrent spends on one balance", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 300,
    });

    const settled = await Promise.allSettled([
      service.spend({
        publicId: card.publicId,
        amountCents: 200,
        currency: "TWD",
        idempotencyKey: "concurrent-a",
        sourceType: "market_checkout",
      }),
      service.spend({
        publicId: card.publicId,
        amountCents: 200,
        currency: "TWD",
        idempotencyKey: "concurrent-b",
        sourceType: "market_checkout",
      }),
    ]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });

    expect((await service.getBalance(card.publicId)).balanceCents).toBe(100);
    const spends = (await ledgerEntriesFor(card.accountId)).filter(
      (e) => e.entryType === "spend",
    );
    expect(spends).toHaveLength(1);
  });

  it("replays an idempotent spend without deducting twice", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });

    const first = await service.spend({
      publicId: card.publicId,
      amountCents: 400,
      currency: "TWD",
      idempotencyKey: "same-key",
      sourceType: "market_checkout",
    });
    const second = await service.spend({
      publicId: card.publicId,
      amountCents: 400,
      currency: "TWD",
      idempotencyKey: "same-key",
      sourceType: "market_checkout",
    });

    expect(second.ledgerEntryId).toBe(first.ledgerEntryId);
    expect((await service.getBalance(card.publicId)).balanceCents).toBe(600);
    const spends = (await ledgerEntriesFor(card.accountId)).filter(
      (e) => e.entryType === "spend",
    );
    expect(spends).toHaveLength(1); // replay did not write a second spend
  });
});

describe("CreditService — movement atomicity", () => {
  // A movement is a balance change plus the ledger entry that records it, and
  // the two used to be separate statements. Whichever one runs second, a
  // failure there left the other committed on its own: money moved with
  // nothing recording it, or an entry claiming a movement that never
  // happened. Both directions are covered here so the guarantee does not
  // depend on which statement the implementation puts first.
  //
  // A trigger supplies the failure, because it aborts a statement the same
  // way a real constraint or a disk error would. Triggers outlive
  // `truncateAll`, so each one is dropped in a `finally`.

  it("rolls the ledger entry back when the balance update fails", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });

    // 1000 - 400: the balance this one spend is about to write.
    await testDb.db
      .prepare(
        `CREATE TRIGGER poison_balance_update
           BEFORE UPDATE ON credit_accounts
           WHEN NEW.balance_cents = 600
           BEGIN SELECT RAISE(ABORT, 'poisoned balance update'); END`,
      )
      .run();

    try {
      await expect(
        service.spend({
          publicId: card.publicId,
          amountCents: 400,
          currency: "TWD",
          idempotencyKey: "poisoned-update",
          sourceType: "market_checkout",
        }),
      ).rejects.toThrow();

      expect((await service.getBalance(card.publicId)).balanceCents).toBe(1000);
      expect(
        (await ledgerEntriesFor(card.accountId)).some(
          (e) => e.idempotencyKey === "poisoned-update",
        ),
      ).toBe(false);
      expect(await service.findBalanceLedgerDrift()).toEqual([]);
    } finally {
      await testDb.db.prepare("DROP TRIGGER poison_balance_update").run();
    }
  });

  it("rolls the deduction back when the ledger insert fails", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });

    await testDb.db
      .prepare(
        `CREATE TRIGGER poison_ledger_insert
           BEFORE INSERT ON credit_ledger_entries
           WHEN NEW.idempotency_key = 'poisoned-insert'
           BEGIN SELECT RAISE(ABORT, 'poisoned ledger insert'); END`,
      )
      .run();

    try {
      await expect(
        service.spend({
          publicId: card.publicId,
          amountCents: 400,
          currency: "TWD",
          idempotencyKey: "poisoned-insert",
          sourceType: "market_checkout",
        }),
      ).rejects.toThrow();

      // The deduction rolled back with the entry it was batched against —
      // otherwise the card is short with nothing in the ledger to show it.
      expect((await service.getBalance(card.publicId)).balanceCents).toBe(1000);
      expect(await service.findBalanceLedgerDrift()).toEqual([]);
    } finally {
      await testDb.db.prepare("DROP TRIGGER poison_ledger_insert").run();
    }
  });
});

describe("CreditService — threshold PIN", () => {
  const PIN_ENV = {
    CREDIT_PIN_THRESHOLD_CENTS_TWD: "1000",
  } as Partial<Env>;

  it("skips PIN at or below the threshold", async () => {
    const service = makeService(PIN_ENV);
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 5000,
      pin: "1234",
    });

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 1000, // == threshold, no PIN required
        currency: "TWD",
        idempotencyKey: "pin-small",
        sourceType: "market_checkout",
      }),
    ).resolves.toMatchObject({ balanceAfterCents: 4000 });
  });

  it("requires a PIN above the threshold and accepts the correct one", async () => {
    const service = makeService(PIN_ENV);
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 5000,
      pin: "1234",
    });

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "pin-missing",
        sourceType: "market_checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_PIN_REQUIRED" });

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "pin-wrong",
        sourceType: "market_checkout",
        pin: "0000",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_PIN_INVALID" });

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "pin-ok",
        sourceType: "market_checkout",
        pin: "1234",
      }),
    ).resolves.toMatchObject({ balanceAfterCents: 3000 });
  });

  it("locks the card after repeated PIN failures", async () => {
    const service = makeService(PIN_ENV);
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 50000,
      pin: "1234",
    });

    for (let i = 0; i < 5; i++) {
      await expect(
        service.spend({
          publicId: card.publicId,
          amountCents: 2000,
          currency: "TWD",
          idempotencyKey: `lock-${i}`,
          sourceType: "market_checkout",
          pin: "0000",
        }),
      ).rejects.toMatchObject({ code: "CREDIT_PIN_INVALID" });
    }

    // Even the correct PIN is refused while locked.
    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "lock-after",
        sourceType: "market_checkout",
        pin: "1234",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CARD_LOCKED" });
  });
});

describe("CreditService — currency-specific controls", () => {
  it("uses each currency's default PIN threshold", async () => {
    const service = makeService();
    const vndCard = await service.issueCard({
      currency: "VND",
      initialBalanceCents: 40_000_000,
      pin: "1234",
    });
    const twdCard = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 50_000,
      pin: "1234",
    });

    await expect(
      service.spend({
        publicId: vndCard.publicId,
        amountCents: 15_000_000, // ₫150,000 — below the ₫200,000 threshold
        currency: "VND",
        idempotencyKey: "vnd-without-pin",
        sourceType: "market_checkout",
      }),
    ).resolves.toMatchObject({ balanceAfterCents: 25_000_000 });
    await expect(
      service.spend({
        publicId: vndCard.publicId,
        amountCents: 25_000_000, // ₫250,000 — above threshold
        currency: "VND",
        idempotencyKey: "vnd-pin-required",
        sourceType: "market_checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_PIN_REQUIRED" });

    await expect(
      service.spend({
        publicId: twdCard.publicId,
        amountCents: 15_000, // NT$150 — below the NT$200 threshold
        currency: "TWD",
        idempotencyKey: "twd-without-pin",
        sourceType: "market_checkout",
      }),
    ).resolves.toMatchObject({ balanceAfterCents: 35_000 });
    await expect(
      service.spend({
        publicId: twdCard.publicId,
        amountCents: 25_000, // NT$250 — above threshold
        currency: "TWD",
        idempotencyKey: "twd-pin-required",
        sourceType: "market_checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_PIN_REQUIRED" });
  });

  it("allows a VND top-up above the former fixed Zod cap", async () => {
    const service = makeService();
    const card = await service.issueCard({ currency: "VND" });

    await expect(
      service.topup({
        publicId: card.publicId,
        amountCents: 500_000_000, // ₫5,000,000
        currency: "VND",
        idempotencyKey: "vnd-five-million-topup",
        sourceType: "topup",
      }),
    ).resolves.toMatchObject({ balanceAfterCents: 500_000_000 });
  });

  it("enforces the currency cap for issuance, top-up, and spend", async () => {
    const service = makeService();

    await expect(
      service.issueCard({
        currency: "VND",
        initialBalanceCents: 30_000_000_100,
      }),
    ).rejects.toMatchObject({ code: "CREDIT_AMOUNT_EXCEEDS_LIMIT" });

    const vndCard = await service.issueCard({ currency: "VND" });
    await expect(
      service.topup({
        publicId: vndCard.publicId,
        amountCents: 30_000_000_100,
        currency: "VND",
        idempotencyKey: "vnd-over-cap-topup",
        sourceType: "topup",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_AMOUNT_EXCEEDS_LIMIT" });

    const twdCard = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 100_000_000,
    });
    await expect(
      service.spend({
        publicId: twdCard.publicId,
        amountCents: 100_000_100,
        currency: "TWD",
        idempotencyKey: "twd-over-cap-spend",
        sourceType: "market_checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_AMOUNT_EXCEEDS_LIMIT" });
  });
});

describe("CreditService — topup & refund", () => {
  it("tops up the balance and records a topup entry", async () => {
    const service = makeService();
    const card = await service.issueCard({ currency: "TWD" });

    const result = await service.topup({
      publicId: card.publicId,
      amountCents: 1500,
      currency: "TWD",
      idempotencyKey: "topup-1",
      sourceType: "topup",
    });

    expect(result.balanceAfterCents).toBe(1500);
    const entries = await ledgerEntriesFor(card.accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entryType: "topup", amountCents: 1500 });
  });

  it("commits one topup when concurrent deliveries share an idempotency key", async () => {
    const service = makeService();
    const card = await service.issueCard({ currency: "TWD" });
    const input = {
      publicId: card.publicId,
      amountCents: 1500,
      currency: "TWD",
      idempotencyKey: "topup-concurrent-same-key",
      sourceType: "topup",
    };

    const [first, second] = await Promise.all([
      service.topup(input),
      service.topup(input),
    ]);

    expect(second.ledgerEntryId).toBe(first.ledgerEntryId);
    expect((await service.getBalance(card.publicId)).balanceCents).toBe(1500);
    const topups = (await ledgerEntriesFor(card.accountId)).filter(
      (entry) => entry.entryType === "topup",
    );
    expect(topups).toHaveLength(1);
    expect(topups[0]).toMatchObject({
      amountCents: 1500,
      balanceAfterCents: 1500,
      idempotencyKey: input.idempotencyKey,
    });
  });

  it("refunds a prior spend back to the originating account", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });
    await service.spend({
      publicId: card.publicId,
      amountCents: 600,
      currency: "TWD",
      idempotencyKey: "spend-for-refund",
      sourceType: "market_checkout",
      sourceId: "checkout-9",
    });

    const refund = await service.refundByOriginalSpend({
      spendIdempotencyKey: "spend-for-refund",
      refundIdempotencyKey: "spend-for-refund:refund",
      amountCents: 600,
      currency: "TWD",
      sourceType: "market_checkout",
      sourceId: "checkout-9",
    });

    expect(refund.balanceAfterCents).toBe(1000);
    expect((await service.getBalance(card.publicId)).balanceCents).toBe(1000);
    const refundEntries = (await ledgerEntriesFor(card.accountId)).filter(
      (e) => e.entryType === "refund",
    );
    expect(refundEntries).toHaveLength(1);
    expect(refundEntries[0]).toMatchObject({ amountCents: 600 });
  });

  it("is idempotent on refund replays", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });
    await service.spend({
      publicId: card.publicId,
      amountCents: 600,
      currency: "TWD",
      idempotencyKey: "spend-r2",
      sourceType: "market_checkout",
    });

    const first = await service.refundByOriginalSpend({
      spendIdempotencyKey: "spend-r2",
      refundIdempotencyKey: "spend-r2:refund",
      amountCents: 600,
      currency: "TWD",
      sourceType: "market_checkout",
    });
    const second = await service.refundByOriginalSpend({
      spendIdempotencyKey: "spend-r2",
      refundIdempotencyKey: "spend-r2:refund",
      amountCents: 600,
      currency: "TWD",
      sourceType: "market_checkout",
    });

    expect(second.ledgerEntryId).toBe(first.ledgerEntryId);
    expect((await service.getBalance(card.publicId)).balanceCents).toBe(1000);
  });
});

describe("CreditService — card management", () => {
  it("sets a PIN that then authorises an above-threshold spend", async () => {
    const service = makeService({ CREDIT_PIN_THRESHOLD_CENTS_TWD: "1000" });
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 5000,
    });

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "no-pin",
        sourceType: "market_checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_PIN_NOT_SET" });

    await service.setPin(card.publicId, "4321");

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 2000,
        currency: "TWD",
        idempotencyKey: "with-pin",
        sourceType: "market_checkout",
        pin: "4321",
      }),
    ).resolves.toMatchObject({ balanceAfterCents: 3000 });
  });

  it("freezes a card so further spends are rejected", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 5000,
    });

    await service.setCardStatus(card.publicId, "frozen");
    expect((await service.getBalance(card.publicId)).cardStatus).toBe("frozen");

    await expect(
      service.spend({
        publicId: card.publicId,
        amountCents: 100,
        currency: "TWD",
        idempotencyKey: "frozen-spend",
        sourceType: "market_checkout",
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CARD_INACTIVE" });
  });

  it("lists ledger entries newest-first with pagination", async () => {
    const service = makeService();
    const card = await service.issueCard({ currency: "TWD" });
    await service.topup({
      publicId: card.publicId,
      amountCents: 1000,
      currency: "TWD",
      idempotencyKey: "lg-topup",
      sourceType: "topup",
    });
    await service.spend({
      publicId: card.publicId,
      amountCents: 300,
      currency: "TWD",
      idempotencyKey: "lg-spend",
      sourceType: "market_checkout",
    });

    const all = await service.listLedger(card.publicId);
    expect(all.entries).toHaveLength(2);
    expect(all.entries[0].entryType).toBe("spend"); // newest first

    const page = await service.listLedger(card.publicId, {
      limit: 1,
      offset: 1,
    });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].entryType).toBe("topup");
  });
});

describe("CreditService — ledger integrity", () => {
  it("audits the opening balance as a ledger entry", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 5000,
    });

    const entries = await ledgerEntriesFor(card.accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "adjust",
      amountCents: 5000,
      balanceAfterCents: 5000,
      sourceType: "card_issue",
    });
    expect(await service.findBalanceLedgerDrift()).toHaveLength(0);
  });

  it("reports no drift for healthy accounts after spend + topup", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });
    await service.spend({
      publicId: card.publicId,
      amountCents: 300,
      currency: "TWD",
      idempotencyKey: "drift-spend",
      sourceType: "market_checkout",
    });
    await service.topup({
      publicId: card.publicId,
      amountCents: 500,
      currency: "TWD",
      idempotencyKey: "drift-topup",
      sourceType: "topup",
    });

    expect(await service.findBalanceLedgerDrift()).toHaveLength(0);
  });

  it("detects a balance that drifts from its ledger sum", async () => {
    const service = makeService();
    const card = await service.issueCard({
      currency: "TWD",
      initialBalanceCents: 1000,
    });
    // Simulate the deduct-then-ledger crash window: balance moved, no ledger row.
    await testDb.drizzle
      .update(creditAccounts)
      .set({ balanceCents: 1234 })
      .where(eq(creditAccounts.id, card.accountId));

    const drift = await service.findBalanceLedgerDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      accountId: card.accountId,
      balanceCents: 1234,
      ledgerSumCents: 1000,
      driftCents: 234,
    });
  });
});
