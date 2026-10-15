import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import { groupActivityLogs, groupOrders } from "@makanmasak/database";
import type { GroupOrderSettings } from "@makanmasak/shared-types";
import { EMPTY_GROUP_ORDER_ERROR } from "../features/group-orders/services/GroupOrdersService";
import {
  ABANDONED_FINALIZE_CLAIM_CODE,
  GROUP_ORDER_EXPIRY_WARNING_MS,
  GROUP_ORDER_FINALIZING_STALE_MS,
  sweepExpiringGroupOrders,
  type GroupOrderSweepDb,
} from "./group-order-expiry";
import type { Env } from "../types/env";

/**
 * These tests run against a real SQLite database rather than a fake.
 *
 * The sweep's correctness lives almost entirely in its WHERE clauses — which
 * claims count as stale, which rows are already cancelled, which group is
 * inside the warning window. A fake that pattern-matches on the query and
 * re-implements those predicates only proves the fake agrees with itself.
 * Executing them is the point.
 *
 * Only the DDL below is written by hand; every read and write in the tests
 * goes through the same Drizzle schema objects the production code uses, so a
 * column rename fails here at compile time too.
 */
const DDL = `
  CREATE TABLE group_orders (
    id TEXT PRIMARY KEY NOT NULL,
    share_code TEXT NOT NULL,
    master_order_id TEXT,
    created_by TEXT,
    recovery_code TEXT NOT NULL,
    restaurant_id TEXT NOT NULL,
    table_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    split_type TEXT NOT NULL DEFAULT 'individual',
    total_amount_cents INTEGER,
    tax_amount_cents INTEGER,
    service_charge_cents INTEGER,
    final_amount_cents INTEGER,
    expires_at_ms INTEGER NOT NULL,
    locked_at_ms INTEGER,
    completed_at_ms INTEGER,
    settings TEXT NOT NULL DEFAULT '{}',
    notes TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  );
  CREATE TABLE group_activity_logs (
    id TEXT PRIMARY KEY NOT NULL,
    group_order_id TEXT NOT NULL,
    member_id TEXT,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at_ms INTEGER NOT NULL
  );
`;

interface SeedRow {
  id: string;
  status: string;
  expiresAt: Date;
  settings?: GroupOrderSettings;
  lockedAt?: Date | null;
  masterOrderId?: string | null;
  finalAmountCents?: number | null;
  serviceChargeCents?: number | null;
  taxAmountCents?: number | null;
}

function createDb(): GroupOrderSweepDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  return drizzle(sqlite) as unknown as GroupOrderSweepDb;
}

async function seed(db: GroupOrderSweepDb, rows: SeedRow[]): Promise<void> {
  const createdAt = new Date("2026-06-01T00:00:00.000Z");
  for (const seedRow of rows) {
    await db.insert(groupOrders).values({
      id: seedRow.id,
      shareCode: seedRow.id.toUpperCase(),
      recoveryCode: `recovery-${seedRow.id}`,
      restaurantId: "restaurant-1",
      status: seedRow.status,
      expiresAt: seedRow.expiresAt,
      lockedAt: seedRow.lockedAt ?? null,
      masterOrderId: seedRow.masterOrderId ?? null,
      finalAmountCents: seedRow.finalAmountCents ?? null,
      serviceChargeCents: seedRow.serviceChargeCents ?? null,
      taxAmountCents: seedRow.taxAmountCents ?? null,
      settings: seedRow.settings ?? {},
      createdAt,
      updatedAt: createdAt,
    });
  }
}

async function readRow(db: GroupOrderSweepDb, id: string) {
  const rows = await db
    .select()
    .from(groupOrders)
    .where(eq(groupOrders.id, id));
  return rows[0];
}

function createEnv(): Env & { cacheDeletes: string[] } {
  const cacheDeletes: string[] = [];
  return {
    DB: {} as unknown,
    CACHE_KV: {
      delete: vi.fn(async (key: string) => {
        cacheDeletes.push(key);
      }),
    },
    // Without a binding the broadcast service warns and skips; supply one so
    // the sweep's broadcasts take the delivered path.
    REALTIME_SESSION: {
      idFromName: vi.fn((name: string) => ({ name })),
      get: vi.fn(() => ({
        fetch: vi.fn(
          async () =>
            new Response(JSON.stringify({ success: true, recipientCount: 0 })),
        ),
      })),
    },
    cacheDeletes,
  } as unknown as Env & { cacheDeletes: string[] };
}

describe("sweepExpiringGroupOrders", () => {
  const now = new Date("2026-06-07T00:00:00.000Z");

  it("finalizes or cancels expired active groups and keeps processing after item failures", async () => {
    const db = createDb();
    const env = createEnv();
    await seed(db, [
      {
        id: "finalize-1",
        status: "active",
        expiresAt: new Date(now.getTime() - 1),
        settings: { autoSubmitOnExpiry: true },
      },
      {
        id: "cancel-1",
        status: "active",
        expiresAt: new Date(now.getTime() - 1),
        settings: { autoSubmitOnExpiry: false },
      },
      {
        id: "finalize-fail",
        status: "active",
        expiresAt: new Date(now.getTime() - 1),
        settings: { autoSubmitOnExpiry: true },
      },
    ]);

    const finalizeGroupOrder = vi.fn(async (groupOrderId: string) => {
      if (groupOrderId === "finalize-fail") {
        return { success: false, error: "order service down" };
      }
      return {
        success: true,
        data: {
          masterOrderId: `order-${groupOrderId}`,
          status: "completed" as const,
        },
      };
    });

    await expect(
      sweepExpiringGroupOrders(env, {
        now,
        db,
        serviceFactory: () => ({ finalizeGroupOrder }),
      }),
    ).resolves.toEqual({
      finalized: 1,
      cancelled: 1,
      warned: 0,
      awaitingRecovery: 0,
      errors: ["finalize-fail: order service down"],
    });

    expect((await readRow(db, "cancel-1"))?.status).toBe("cancelled");
    const logs = await db.select().from(groupActivityLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      groupOrderId: "cancel-1",
      action: "group_expired",
      metadata: { expiredAt: now.getTime() - 1 },
    });
    expect(env.cacheDeletes).toEqual([
      "group_order:cancel-1",
      "group_order_summary:cancel-1",
      "share_code:CANCEL-1",
    ]);
  });

  it("cancels an expired group whose cart is empty rather than failing it every sweep", async () => {
    const db = createDb();
    const env = createEnv();
    await seed(db, [
      {
        id: "empty-1",
        status: "active",
        expiresAt: new Date(now.getTime() - 1),
        settings: { autoSubmitOnExpiry: true },
      },
    ]);

    const finalizeGroupOrder = vi.fn(async () => ({
      success: false,
      error: EMPTY_GROUP_ORDER_ERROR,
    }));

    await expect(
      sweepExpiringGroupOrders(env, {
        now,
        db,
        serviceFactory: () => ({ finalizeGroupOrder }),
      }),
    ).resolves.toEqual({
      finalized: 0,
      cancelled: 1,
      warned: 0,
      awaitingRecovery: 0,
      errors: [],
    });

    // Cancelled, so the next sweep's `status = 'active'` filter no longer
    // selects it — that is what stops the every-five-minutes error loop.
    expect((await readRow(db, "empty-1"))?.status).toBe("cancelled");
    expect(finalizeGroupOrder).toHaveBeenCalledOnce();
  });

  it("marks five-minute expiry warnings once in settings", async () => {
    const db = createDb();
    const env = createEnv();
    await seed(db, [
      {
        id: "warn-1",
        status: "active",
        expiresAt: new Date(now.getTime() + GROUP_ORDER_EXPIRY_WARNING_MS),
      },
    ]);

    await expect(
      sweepExpiringGroupOrders(env, { now, db }),
    ).resolves.toMatchObject({ warned: 1 });
    expect((await readRow(db, "warn-1"))?.settings).toMatchObject({
      expiryWarningSentAt: now.toISOString(),
    });

    // A cron on a five-minute tick sees the same group again on its next run.
    await expect(
      sweepExpiringGroupOrders(env, { now, db }),
    ).resolves.toMatchObject({ warned: 0 });
  });

  it("lets overlapping sweeps race through finalize without creating a second real order", async () => {
    const db = createDb();
    const env = createEnv();
    await seed(db, [
      {
        id: "race-1",
        status: "active",
        expiresAt: new Date(now.getTime() - 1),
        settings: { autoSubmitOnExpiry: true },
      },
    ]);

    let createdOrders = 0;
    const finalizeGroupOrder = vi.fn(async (groupOrderId: string) => {
      // Stands in for finalizeGroupOrder's own claim, and has to be the same
      // shape to mean anything: a single conditional update that reports
      // whether it won. Reading the status and then writing it would leave a
      // gap both sweeps can pass through — which is exactly the bug the real
      // compare-and-swap exists to prevent, so a mock with that gap would
      // report a failure the production code does not have.
      const claimed = await db
        .update(groupOrders)
        .set({ status: "finalizing", lockedAt: now })
        .where(
          and(
            eq(groupOrders.id, groupOrderId),
            eq(groupOrders.status, "active"),
          ),
        )
        .returning({ id: groupOrders.id });

      if (claimed.length === 0) {
        return {
          success: false,
          error: "Group order is already being finalized",
        };
      }

      createdOrders++;
      await Promise.resolve();
      await db
        .update(groupOrders)
        .set({ status: "completed", masterOrderId: "order-race-1" })
        .where(eq(groupOrders.id, groupOrderId));

      return {
        success: true,
        data: { masterOrderId: "order-race-1", status: "completed" as const },
      };
    });

    const results = await Promise.all([
      sweepExpiringGroupOrders(env, {
        now,
        db,
        serviceFactory: () => ({ finalizeGroupOrder }),
      }),
      sweepExpiringGroupOrders(env, {
        now,
        db,
        serviceFactory: () => ({ finalizeGroupOrder }),
      }),
    ]);

    expect(createdOrders).toBe(1);
    expect(results.reduce((sum, result) => sum + result.finalized, 0)).toBe(1);
  });

  it("recovers only stale finalizing claims and leaves active claims plus finalizing_failed alone", async () => {
    const db = createDb();
    const env = createEnv();
    await seed(db, [
      {
        id: "active-claim",
        status: "finalizing",
        expiresAt: new Date(now.getTime() - 1),
        lockedAt: new Date(now.getTime() - GROUP_ORDER_FINALIZING_STALE_MS + 1),
      },
      {
        id: "stale-claim",
        status: "finalizing",
        expiresAt: new Date(now.getTime() - 1),
        lockedAt: new Date(now.getTime() - GROUP_ORDER_FINALIZING_STALE_MS - 1),
      },
      {
        id: "failed",
        status: "finalizing_failed",
        expiresAt: new Date(now.getTime() - 1),
        lockedAt: new Date(now.getTime() - GROUP_ORDER_FINALIZING_STALE_MS - 1),
      },
      {
        id: "stale-but-ordered",
        status: "finalizing",
        expiresAt: new Date(now.getTime() - 1),
        lockedAt: new Date(now.getTime() - GROUP_ORDER_FINALIZING_STALE_MS - 1),
        masterOrderId: "order-already-placed",
      },
    ]);

    await sweepExpiringGroupOrders(env, { now, db });

    expect((await readRow(db, "active-claim"))?.status).toBe("finalizing");
    const stale = await readRow(db, "stale-claim");
    expect(stale?.status).toBe("active");
    expect(stale?.lockedAt).toBeNull();
    expect((await readRow(db, "failed"))?.status).toBe("finalizing_failed");
    // A claim whose real order already exists must never be handed back to a
    // second finalizer, however stale it looks. It is resolved the other way,
    // by the abandoned-claim pass below.
    expect((await readRow(db, "stale-but-ordered"))?.status).not.toBe("active");
  });

  it("hands an abandoned claim whose order exists to the recovery path", async () => {
    const db = createDb();
    const env = createEnv();
    await seed(db, [
      {
        id: "abandoned",
        status: "finalizing",
        expiresAt: new Date(now.getTime() - 1),
        lockedAt: new Date(now.getTime() - GROUP_ORDER_FINALIZING_STALE_MS - 1),
        masterOrderId: "order-abandoned",
        finalAmountCents: 12_000,
        serviceChargeCents: 1_200,
        taxAmountCents: 600,
      },
    ]);

    const result = await sweepExpiringGroupOrders(env, { now, db });

    const row = await readRow(db, "abandoned");
    expect(row?.status).toBe("finalizing_failed");
    expect(result.awaitingRecovery).toBe(1);
    // The totals come off the row the finalizer wrote, which is what
    // recoverFinalization re-runs the split with.
    expect(
      (row?.settings as GroupOrderSettings | null)?.finalizeFailure,
    ).toEqual(
      expect.objectContaining({
        code: ABANDONED_FINALIZE_CLAIM_CODE,
        masterOrderId: "order-abandoned",
        orderTotalCents: 12_000,
        serviceChargeCents: 1_200,
        taxAmountCents: 600,
        failedAt: expect.any(String),
      }),
    );
    expect(env.cacheDeletes).toContain("group_order:abandoned");
  });

  it("keeps the first failure when an abandoned claim was itself a recovery", async () => {
    const db = createDb();
    const env = createEnv();
    const original = {
      code: "SPLIT_TOTAL_MISMATCH",
      masterOrderId: "order-retry",
      orderTotalCents: 9_000,
      serviceChargeCents: 900,
      taxAmountCents: 450,
      splitError: "Split total does not match order total",
      failedAt: "2026-06-01T00:00:00.000Z",
    };
    await seed(db, [
      {
        id: "retry-abandoned",
        status: "finalizing",
        expiresAt: new Date(now.getTime() - 1),
        lockedAt: new Date(now.getTime() - GROUP_ORDER_FINALIZING_STALE_MS - 1),
        masterOrderId: "order-retry",
        settings: { finalizeFailure: original },
      },
    ]);

    await sweepExpiringGroupOrders(env, { now, db });

    const row = await readRow(db, "retry-abandoned");
    expect(row?.status).toBe("finalizing_failed");
    // #231: a retry must never overwrite the original diagnostics.
    expect(
      (row?.settings as GroupOrderSettings | null)?.finalizeFailure,
    ).toEqual(original);
  });

  it("leaves a claim alone while it is still inside the stale window", async () => {
    const db = createDb();
    const env = createEnv();
    await seed(db, [
      {
        id: "running-recovery",
        status: "finalizing",
        expiresAt: new Date(now.getTime() - 1),
        lockedAt: new Date(now.getTime() - GROUP_ORDER_FINALIZING_STALE_MS + 1),
        masterOrderId: "order-running",
      },
    ]);

    const result = await sweepExpiringGroupOrders(env, { now, db });

    expect((await readRow(db, "running-recovery"))?.status).toBe("finalizing");
    expect(result.awaitingRecovery).toBe(0);
  });
});
