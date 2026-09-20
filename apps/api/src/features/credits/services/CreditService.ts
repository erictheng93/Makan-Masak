import { drizzle } from "drizzle-orm/d1";
import { and, asc, desc, eq, gt, gte, isNotNull, lt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  creditAccounts,
  creditCards,
  creditLedgerEntries,
  type CreditCardStatus,
  type CreditEntryType,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from "../../../shared/utils/api-error";
import {
  generateUUID,
  currencyStepCents,
  isCurrencyAlignedCents,
  normalizeCurrencyCode,
  type CurrencyCode,
} from "@makanmasak/utils";

// Spends strictly above this amount require a PIN ((b) 門檻式 PIN). Override via env.
const DEFAULT_CREDIT_PIN_THRESHOLD_CENTS = 20000;
const MAX_PIN_RETRIES = 5;
const PIN_LOCK_MS = 15 * 60 * 1000; // lock card for 15 min after repeated PIN failures
const CREDIT_ROLLING_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // activity extends expiry 1 year
const BCRYPT_COST = 10; // matches repo convention (customer OTP hashing)

/**
 * Money entering a stored-value balance, on the currency's real precision.
 *
 * A balance can only leave the account in whole steps of its currency —
 * `CreditBalanceMarketCheckoutPaymentProvider` refuses an off-step charge and
 * no gateway will take NT$0.50 — so a TWD card holding NT$100.50 can never be
 * spent to zero. `CreditTopupService.createIntent` already refuses an
 * unaligned gateway top-up; a manual (cash/admin) top-up and the opening
 * balance on a freshly issued card are the other two ways money is created,
 * and they must not be a way around it. Refuse to create the stranded 50
 * cents rather than discover later that it cannot be released.
 */
function assertAlignedCreditAmount(
  amountCents: number,
  currencyValue: string,
  code: string,
): CurrencyCode {
  const currency = normalizeCurrencyCode(currencyValue);
  if (!currency) {
    throw badRequest(
      "Credit currency is not supported",
      "CREDIT_CURRENCY_UNSUPPORTED",
    );
  }
  if (!isCurrencyAlignedCents(amountCents, currency)) {
    throw badRequest(
      `Amounts in ${currency} must be multiples of ${currencyStepCents(currency) / 100}`,
      code,
    );
  }
  return currency;
}

export interface IssueCardInput {
  currency: string;
  ownerCustomerId?: string;
  /** Optional PIN; required later for spends above the threshold. */
  pin?: string;
  initialBalanceCents?: number;
}

export interface IssueCardResult {
  cardId: string;
  publicId: string;
  accountId: string;
  currency: string;
}

export interface CreditBalance {
  publicId: string;
  accountId: string;
  currency: string;
  balanceCents: number;
  status: string;
  cardStatus: string;
  expiresAtMs: number | null;
}

export interface SpendInput {
  publicId: string;
  amountCents: number;
  currency: string;
  /** Stable per logical operation — replays return the prior ledger entry, never double-spend. */
  idempotencyKey: string;
  sourceType: string;
  sourceId?: string;
  marketCheckoutPaymentId?: string;
  pin?: string;
}

export interface TopupInput {
  publicId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  sourceType: string;
  sourceId?: string;
}

export interface RefundInput {
  /** Account to credit back. */
  accountId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  sourceType: string;
  sourceId?: string;
  marketCheckoutPaymentId?: string;
}

export interface LedgerMovementResult {
  ledgerEntryId: string;
  accountId: string;
  balanceAfterCents: number;
}

type CreditAccountRow = typeof creditAccounts.$inferSelect;
type CreditCardRow = typeof creditCards.$inferSelect;

/**
 * Stored-value credits (代幣) ledger service.
 *
 * Money-safety is enforced by a single conditional UPDATE with a balance guard
 * (`balance_cents >= :amount`) — atomic on D1, so concurrent spends on the same
 * balance cannot overspend and cannot double-spend (proven against real D1).
 * `idempotency_key` UNIQUE on the ledger makes every movement replay-safe.
 * Every balance/ledger pair is committed in one D1 batch, so a failed ledger
 * insert rolls the balance update back instead of requiring compensation.
 */
export class CreditService {
  private readonly db: ReturnType<typeof drizzle>;
  private readonly pinThresholdCents: number;

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
    const parsed = Number(env.CREDIT_PIN_THRESHOLD_CENTS);
    this.pinThresholdCents =
      Number.isFinite(parsed) && parsed >= 0
        ? parsed
        : DEFAULT_CREDIT_PIN_THRESHOLD_CENTS;
  }

  async issueCard(input: IssueCardInput): Promise<IssueCardResult> {
    if (
      input.initialBalanceCents !== undefined &&
      input.initialBalanceCents < 0
    ) {
      throw badRequest("Initial balance cannot be negative");
    }
    assertAlignedCreditAmount(
      input.initialBalanceCents ?? 0,
      input.currency,
      "CREDIT_BALANCE_NOT_ALIGNED",
    );
    const secretHash = input.pin
      ? await bcrypt.hash(input.pin, BCRYPT_COST)
      : null;
    const expiresAt = new Date(Date.now() + CREDIT_ROLLING_EXPIRY_MS);
    const initialBalanceCents = input.initialBalanceCents ?? 0;
    const accountId = generateUUID();
    const cardId = generateUUID();
    const publicId = generateUUID();

    const createAccount = this.db.insert(creditAccounts).values({
      id: accountId,
      ownerCustomerId: input.ownerCustomerId ?? null,
      currency: input.currency,
      balanceCents: initialBalanceCents,
      expiresAtMs: expiresAt,
    });

    const createCard = this.db.insert(creditCards).values({
      id: cardId,
      accountId,
      publicId,
      secretHash,
    });

    // Audit the opening balance as a ledger entry so the ledger is the complete
    // source of truth (balance == sum(ledger)) — no un-audited money creation.
    if (initialBalanceCents > 0) {
      const recordOpeningBalance = this.db.insert(creditLedgerEntries).values({
        accountId,
        entryType: "adjust",
        amountCents: initialBalanceCents,
        balanceAfterCents: initialBalanceCents,
        currency: input.currency,
        sourceType: "card_issue",
        sourceId: cardId,
        idempotencyKey: `credit-issue:${accountId}`,
      });
      await this.db.batch([createAccount, createCard, recordOpeningBalance]);
    } else {
      await this.db.batch([createAccount, createCard]);
    }

    return {
      cardId,
      publicId,
      accountId,
      currency: input.currency,
    };
  }

  async getBalance(publicId: string): Promise<CreditBalance> {
    const { card, account } = await this.loadCardAndAccount(publicId);
    return {
      publicId: card.publicId,
      accountId: account.id,
      currency: account.currency,
      balanceCents: account.balanceCents,
      status: account.status,
      cardStatus: card.status,
      expiresAtMs: account.expiresAtMs ? account.expiresAtMs.getTime() : null,
    };
  }

  /**
   * Deduct `amountCents` from the card's account in full (no partial spend).
   * Throws `INSUFFICIENT_BALANCE` (409) when the balance cannot cover it.
   */
  async spend(input: SpendInput): Promise<LedgerMovementResult> {
    if (input.amountCents <= 0) {
      throw badRequest("Spend amount must be positive");
    }

    // Replay safety: a prior identical operation returns its recorded result.
    const existing = await this.findLedgerByIdempotencyKey(
      input.idempotencyKey,
    );
    if (existing) {
      return {
        ledgerEntryId: existing.id,
        accountId: existing.accountId,
        balanceAfterCents: existing.balanceAfterCents,
      };
    }

    const { card, account } = await this.loadCardAndAccount(input.publicId);
    if (account.status !== "active") {
      throw forbidden(
        "Credit account is not active",
        "CREDIT_ACCOUNT_INACTIVE",
      );
    }
    if (account.currency !== input.currency) {
      throw badRequest(
        "Credit currency does not match checkout currency",
        "CREDIT_CURRENCY_MISMATCH",
      );
    }
    await this.assertPinIfRequired(card, input.amountCents, input.pin);

    return this.applyLedgerMovement({
      accountId: account.id,
      entryType: "spend",
      amountCents: -input.amountCents,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      marketCheckoutPaymentId: input.marketCheckoutPaymentId,
      requireActiveBalance: input.amountCents,
    });
  }

  async topup(input: TopupInput): Promise<LedgerMovementResult> {
    if (input.amountCents <= 0) {
      throw badRequest("Top-up amount must be positive");
    }
    assertAlignedCreditAmount(
      input.amountCents,
      input.currency,
      "CREDIT_TOPUP_AMOUNT_NOT_ALIGNED",
    );
    const existing = await this.findLedgerByIdempotencyKey(
      input.idempotencyKey,
    );
    if (existing) {
      return {
        ledgerEntryId: existing.id,
        accountId: existing.accountId,
        balanceAfterCents: existing.balanceAfterCents,
      };
    }

    const { account } = await this.loadCardAndAccount(input.publicId);
    if (account.currency !== input.currency) {
      throw badRequest(
        "Credit currency does not match top-up currency",
        "CREDIT_CURRENCY_MISMATCH",
      );
    }

    return this.applyLedgerMovement({
      accountId: account.id,
      entryType: "topup",
      amountCents: input.amountCents,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
  }

  /** Credit an amount back to an account (e.g. market-checkout refund). */
  async refund(input: RefundInput): Promise<LedgerMovementResult> {
    if (input.amountCents <= 0) {
      throw badRequest("Refund amount must be positive");
    }
    const existing = await this.findLedgerByIdempotencyKey(
      input.idempotencyKey,
    );
    if (existing) {
      return {
        ledgerEntryId: existing.id,
        accountId: existing.accountId,
        balanceAfterCents: existing.balanceAfterCents,
      };
    }

    const account = await this.db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.id, input.accountId))
      .get();
    if (!account) {
      throw notFound("Credit account not found", "CREDIT_ACCOUNT_NOT_FOUND");
    }
    if (account.currency !== input.currency) {
      throw badRequest(
        "Credit currency does not match refund currency",
        "CREDIT_CURRENCY_MISMATCH",
      );
    }

    return this.applyLedgerMovement({
      accountId: account.id,
      entryType: "refund",
      amountCents: input.amountCents,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      marketCheckoutPaymentId: input.marketCheckoutPaymentId,
    });
  }

  /**
   * Refund a prior credit spend by its idempotency key — resolves the account
   * from the original spend ledger entry, then credits it back.
   */
  async refundByOriginalSpend(input: {
    spendIdempotencyKey: string;
    refundIdempotencyKey: string;
    amountCents: number;
    currency: string;
    sourceType: string;
    sourceId?: string;
    marketCheckoutPaymentId?: string;
  }): Promise<LedgerMovementResult> {
    const spend = await this.findLedgerByIdempotencyKey(
      input.spendIdempotencyKey,
    );
    if (!spend) {
      throw notFound(
        "Original credit spend not found for refund",
        "CREDIT_SPEND_NOT_FOUND",
      );
    }
    return this.refund({
      accountId: spend.accountId,
      amountCents: input.amountCents,
      currency: input.currency,
      idempotencyKey: input.refundIdempotencyKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      marketCheckoutPaymentId: input.marketCheckoutPaymentId,
    });
  }

  /** Set or reset the card PIN (admin action); clears retry count and lock. */
  async setPin(publicId: string, newPin: string): Promise<void> {
    const { card } = await this.loadCardAndAccount(publicId);
    const secretHash = await bcrypt.hash(newPin, BCRYPT_COST);
    await this.db
      .update(creditCards)
      .set({
        secretHash,
        pinRetryCount: 0,
        lockedUntilMs: null,
        updatedAt: new Date(),
      })
      .where(eq(creditCards.id, card.id));
  }

  /** Freeze or mark a card lost. Balance stays on the account for reissue. */
  async setCardStatus(
    publicId: string,
    status: CreditCardStatus,
  ): Promise<void> {
    const { card } = await this.loadCardAndAccount(publicId);
    await this.db
      .update(creditCards)
      .set({ status, updatedAt: new Date() })
      .where(eq(creditCards.id, card.id));
  }

  /** Paginated ledger history for a card's account (newest first). */
  async listLedger(
    publicId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{
    accountId: string;
    entries: (typeof creditLedgerEntries.$inferSelect)[];
  }> {
    const { account } = await this.loadCardAndAccount(publicId);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const entries = await this.db
      .select()
      .from(creditLedgerEntries)
      .where(eq(creditLedgerEntries.accountId, account.id))
      .orderBy(desc(creditLedgerEntries.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
    return { accountId: account.id, entries };
  }

  /**
   * Zero out balances whose rolling expiry has lapsed (inactivity), recording
   * an `expire` ledger entry per account. Batch job — run from cron. A
   * concurrent spend/topup wins via the version guard (it also extends expiry).
   */
  async expireStaleAccounts(
    options: { nowMs?: number; limit?: number } = {},
  ): Promise<{
    scanned: number;
    expired: number;
    totalExpiredCents: number;
    failures: Array<{ accountId: string; error: string }>;
  }> {
    const now = new Date(options.nowMs ?? Date.now());
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);

    const candidates = await this.db
      .select({
        id: creditAccounts.id,
        balanceCents: creditAccounts.balanceCents,
        version: creditAccounts.version,
        expiresAtMs: creditAccounts.expiresAtMs,
      })
      .from(creditAccounts)
      .where(
        and(
          eq(creditAccounts.status, "active"),
          isNotNull(creditAccounts.expiresAtMs),
          lt(creditAccounts.expiresAtMs, now),
          gt(creditAccounts.balanceCents, 0),
        ),
      )
      .limit(limit)
      .all();

    let expired = 0;
    let totalExpiredCents = 0;
    const failures: Array<{ accountId: string; error: string }> = [];
    for (const account of candidates) {
      // Isolate each account so one bad row can't abort the rest of the batch.
      try {
        const expiryIdempotencyKey = `credit-expire:${account.id}:${
          account.expiresAtMs?.getTime() ?? now.getTime()
        }`;
        const writtenAtMs = Date.now();
        const zeroBalance = this.env.DB.prepare(
          `UPDATE credit_accounts
              SET balance_cents = 0, version = version + 1, updated_at_ms = ?
            WHERE id = ? AND version = ? AND balance_cents > 0
            RETURNING id`,
        ).bind(writtenAtMs, account.id, account.version);
        const recordExpiry = this.env.DB.prepare(
          `INSERT INTO credit_ledger_entries
               (id, account_id, entry_type, amount_cents, balance_after_cents,
                currency, source_type, source_id, market_checkout_payment_id,
                idempotency_key, created_at_ms)
             SELECT ?, id, 'expire', ?, 0, currency, 'expiry_job', id, NULL, ?, ?
               FROM credit_accounts
              WHERE id = ? AND changes() = 1
             RETURNING id`,
        ).bind(
          generateUUID(),
          -account.balanceCents,
          expiryIdempotencyKey,
          writtenAtMs,
          account.id,
        );
        const [zeroed] = await this.env.DB.batch([zeroBalance, recordExpiry]);
        if (zeroed.meta.changes === 0) continue; // concurrent activity won

        expired += 1;
        totalExpiredCents += account.balanceCents;
      } catch (error) {
        failures.push({
          accountId: account.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { scanned: candidates.length, expired, totalExpiredCents, failures };
  }

  /** Credit ledger entries in a time range, oldest first — for the liability sub-ledger export. */
  async listLedgerForExport(
    options: { fromMs?: number; toMs?: number; limit?: number } = {},
  ): Promise<(typeof creditLedgerEntries.$inferSelect)[]> {
    const limit = Math.min(Math.max(options.limit ?? 5000, 1), 50000);
    const conds = [
      options.fromMs !== undefined
        ? gte(creditLedgerEntries.createdAt, new Date(options.fromMs))
        : undefined,
      options.toMs !== undefined
        ? lt(creditLedgerEntries.createdAt, new Date(options.toMs))
        : undefined,
    ].filter(Boolean) as ReturnType<typeof gte>[];

    const order = asc(creditLedgerEntries.createdAt);
    if (conds.length === 0) {
      return this.db
        .select()
        .from(creditLedgerEntries)
        .orderBy(order)
        .limit(limit)
        .all();
    }
    return this.db
      .select()
      .from(creditLedgerEntries)
      .where(conds.length === 1 ? conds[0] : and(...conds))
      .orderBy(order)
      .limit(limit)
      .all();
  }

  /**
   * Integrity check: accounts whose materialized balance disagrees with the sum
   * of their ledger entries. With opening balances audited, `balance == Σledger`
   * is an invariant, so any drift flags the narrow deduct-then-ledger crash
   * window (or a bug). Detection only — money is never auto-repaired.
   */
  async findBalanceLedgerDrift(options: { limit?: number } = {}): Promise<
    Array<{
      accountId: string;
      balanceCents: number;
      ledgerSumCents: number;
      driftCents: number;
    }>
  > {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const rows = await this.db
      .select({
        accountId: creditAccounts.id,
        balanceCents: creditAccounts.balanceCents,
        ledgerSumCents: sql<number>`COALESCE(SUM(${creditLedgerEntries.amountCents}), 0)`,
      })
      .from(creditAccounts)
      .leftJoin(
        creditLedgerEntries,
        eq(creditLedgerEntries.accountId, creditAccounts.id),
      )
      .groupBy(creditAccounts.id)
      .having(
        sql`${creditAccounts.balanceCents} != COALESCE(SUM(${creditLedgerEntries.amountCents}), 0)`,
      )
      .limit(limit)
      .all();
    return rows.map((r) => ({
      ...r,
      driftCents: r.balanceCents - r.ledgerSumCents,
    }));
  }

  // ---- internals -----------------------------------------------------------

  private async loadCardAndAccount(
    publicId: string,
  ): Promise<{ card: CreditCardRow; account: CreditAccountRow }> {
    const card = await this.db
      .select()
      .from(creditCards)
      .where(eq(creditCards.publicId, publicId))
      .get();
    if (!card) {
      throw notFound("Credit card not found", "CREDIT_CARD_NOT_FOUND");
    }
    const account = await this.db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.id, card.accountId))
      .get();
    if (!account) {
      throw notFound("Credit account not found", "CREDIT_ACCOUNT_NOT_FOUND");
    }
    return { card, account };
  }

  private async assertPinIfRequired(
    card: CreditCardRow,
    amountCents: number,
    pin: string | undefined,
  ): Promise<void> {
    if (card.status !== "active") {
      throw forbidden("Credit card is not active", "CREDIT_CARD_INACTIVE");
    }
    if (amountCents <= this.pinThresholdCents) {
      return; // small amount — PIN not required
    }
    if (!card.secretHash) {
      throw forbidden(
        "This amount requires a PIN but the card has none set",
        "CREDIT_PIN_NOT_SET",
      );
    }
    const now = Date.now();
    if (card.lockedUntilMs && card.lockedUntilMs.getTime() > now) {
      throw forbidden(
        "Credit card is temporarily locked",
        "CREDIT_CARD_LOCKED",
      );
    }
    if (!pin) {
      throw unauthorized("PIN required for this amount", "CREDIT_PIN_REQUIRED");
    }

    const valid = await bcrypt.compare(pin, card.secretHash);
    if (!valid) {
      const nextCount = (card.pinRetryCount ?? 0) + 1;
      const lock = nextCount >= MAX_PIN_RETRIES;
      await this.db
        .update(creditCards)
        .set({
          pinRetryCount: nextCount,
          lockedUntilMs: lock
            ? new Date(now + PIN_LOCK_MS)
            : card.lockedUntilMs,
          updatedAt: new Date(),
        })
        .where(eq(creditCards.id, card.id));
      throw unauthorized("Invalid PIN", "CREDIT_PIN_INVALID");
    }

    if ((card.pinRetryCount ?? 0) > 0 || card.lockedUntilMs) {
      await this.db
        .update(creditCards)
        .set({ pinRetryCount: 0, lockedUntilMs: null, updatedAt: new Date() })
        .where(eq(creditCards.id, card.id));
    }
  }

  private async findLedgerByIdempotencyKey(key: string) {
    return this.db
      .select()
      .from(creditLedgerEntries)
      .where(eq(creditLedgerEntries.idempotencyKey, key))
      .get();
  }

  /** Atomically apply a balance delta and append its corresponding ledger row. */
  private async applyLedgerMovement(params: {
    accountId: string;
    entryType: CreditEntryType;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    sourceType: string;
    sourceId?: string;
    marketCheckoutPaymentId?: string;
    /** A spend needs the account to stay active and funded during the write. */
    requireActiveBalance?: number;
  }): Promise<LedgerMovementResult> {
    const now = Date.now();
    const expiresAtMs = now + CREDIT_ROLLING_EXPIRY_MS;
    const accountPredicate = params.requireActiveBalance
      ? " AND currency = ? AND status = 'active' AND balance_cents >= ?"
      : "";
    const accountBindings = params.requireActiveBalance
      ? [params.currency, params.requireActiveBalance]
      : [];
    const update = this.env.DB.prepare(
      `UPDATE credit_accounts
          SET balance_cents = balance_cents + ?, version = version + 1,
              expires_at_ms = ?, updated_at_ms = ?
        WHERE id = ?${accountPredicate}`,
    ).bind(
      params.amountCents,
      expiresAtMs,
      now,
      params.accountId,
      ...accountBindings,
    );
    // `changes()` is the preceding UPDATE's affected-row count on this batch
    // connection. It prevents a failed spend guard from adding a ledger row.
    // This insert deliberately has no conflict-ignore clause: a duplicate key
    // aborts the whole D1 batch, including the balance update.
    const ledger = this.env.DB.prepare(
      `INSERT INTO credit_ledger_entries
           (id, account_id, entry_type, amount_cents, balance_after_cents,
            currency, source_type, source_id, market_checkout_payment_id,
            idempotency_key, created_at_ms)
         SELECT ?, ?, ?, ?, balance_cents, ?, ?, ?, ?, ?, ?
           FROM credit_accounts
          WHERE id = ? AND changes() = 1
         RETURNING id, account_id, balance_after_cents`,
    ).bind(
      generateUUID(),
      params.accountId,
      params.entryType,
      params.amountCents,
      params.currency,
      params.sourceType,
      params.sourceId ?? null,
      params.marketCheckoutPaymentId ?? null,
      params.idempotencyKey,
      now,
      params.accountId,
    );

    let updateResult: D1Result<unknown>;
    let ledgerResult: D1Result<unknown>;
    try {
      [updateResult, ledgerResult] = await this.env.DB.batch([update, ledger]);
    } catch (error) {
      // A concurrent twin can reach the strict UNIQUE insert after its own
      // preflight read. Its failed batch changed neither balance nor ledger;
      // return the canonical ledger row once the winner commits.
      const canonical = await this.findLedgerByIdempotencyKey(
        params.idempotencyKey,
      );
      if (canonical) {
        return {
          ledgerEntryId: canonical.id,
          accountId: canonical.accountId,
          balanceAfterCents: canonical.balanceAfterCents,
        };
      }
      throw error;
    }
    if (updateResult.meta.changes === 0) {
      if (params.requireActiveBalance) {
        throw conflict("Insufficient credit balance", "INSUFFICIENT_BALANCE");
      }
      throw conflict(
        "Credit account could not be updated",
        "CREDIT_ACCOUNT_MOVEMENT_FAILED",
      );
    }
    {
      const entry = ledgerResult.results[0] as
        | {
            id: string;
            account_id: string;
            balance_after_cents: number;
          }
        | undefined;
      if (!entry) {
        throw new Error("Credit movement batch did not append a ledger entry");
      }
      return {
        ledgerEntryId: entry.id,
        accountId: entry.account_id,
        balanceAfterCents: entry.balance_after_cents,
      };
    }
  }
}
