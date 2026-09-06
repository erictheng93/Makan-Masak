import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { ORDER_STATUS, orders } from "@makanmasak/database";
import {
  raiseOverdueOrderAlerts,
  type OverdueOrderSweepDb,
} from "./overdue-order-alerts";
import type { Env } from "../types/env";

/**
 * Run against a real SQLite rather than a fake, for the same reason the group
 * order sweep does: this worker is almost entirely a WHERE clause. A fake that
 * re-implements "which statuses count as unserved" and "which rows are past the
 * cutoff" only proves the fake agrees with itself.
 *
 * Build the fixture table from the Drizzle schema rather than a copied DDL.
 * Drizzle emits every defaulted column on insert, so a hand-trimmed `orders`
 * fails on whichever column was added last — and a copy of the baseline goes
 * stale the moment a migration adds one. Constraints are deliberately dropped:
 * this fixture exists to exercise the sweep's WHERE clause, not the schema's.
 */
function ddlFor(table: SQLiteTable): string {
  const { name, columns } = getTableConfig(table);
  const defs = columns.map((column) => {
    const pk = column.primary ? " PRIMARY KEY" : "";
    return `"${column.name}" ${column.getSQLType()}${pk}`;
  });
  return `CREATE TABLE "${name}" (${defs.join(", ")});`;
}

const NOW = new Date("2026-09-06T12:00:00.000Z").getTime();
const MINUTE = 60_000;

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(ddlFor(orders));
  return drizzle(sqlite) as unknown as OverdueOrderSweepDb;
}

async function seed(
  db: OverdueOrderSweepDb,
  rows: Array<{
    id: string;
    status: string;
    minutesAgo: number;
    orderNumber?: string;
    restaurantId?: string;
  }>,
) {
  for (const row of rows) {
    await db.insert(orders).values({
      id: row.id,
      restaurantId: row.restaurantId ?? "restaurant-1",
      orderNumber: row.orderNumber ?? `A-${row.id}`,
      status: row.status,
      createdAt: new Date(NOW - row.minutesAgo * MINUTE),
    });
  }
}

function run(
  db: OverdueOrderSweepDb,
  raise: ReturnType<typeof vi.fn>,
  over?: number,
) {
  return raiseOverdueOrderAlerts({ DB: {} } as unknown as Env, {
    db,
    nowMs: NOW,
    overdueMinutes: over,
    raise: raise as never,
  });
}

describe("raiseOverdueOrderAlerts", () => {
  it("raises for an unserved order past the threshold", async () => {
    const db = createDb();
    await seed(db, [
      { id: "o1", status: ORDER_STATUS.PREPARING, minutesAgo: 35 },
    ]);
    const raise = vi.fn().mockResolvedValue(undefined);

    const result = await run(db, raise);

    expect(result).toMatchObject({ scanned: 1, raised: 1, overdueMinutes: 20 });
    expect(raise).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        restaurantId: "restaurant-1",
        orderId: "o1",
        orderNumber: "A-o1",
        minutesLate: 35,
        status: ORDER_STATUS.PREPARING,
      }),
    );
  });

  it("leaves an order that is not yet late", async () => {
    const db = createDb();
    await seed(db, [
      { id: "o1", status: ORDER_STATUS.PREPARING, minutesAgo: 5 },
    ]);
    const raise = vi.fn();

    const result = await run(db, raise);

    expect(result.raised).toBe(0);
    expect(raise).not.toHaveBeenCalled();
  });

  // The terminal four owe the customer nothing, however old they are.
  it.each([
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.PAID,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.REFUNDED,
  ])("ignores a long-finished %s order", async (status) => {
    const db = createDb();
    await seed(db, [{ id: "o1", status, minutesAgo: 600 }]);
    const raise = vi.fn();

    const result = await run(db, raise);

    expect(result.raised).toBe(0);
    expect(raise).not.toHaveBeenCalled();
  });

  // `ready` is the one people expect to be terminal and is not: plated food
  // nobody delivered is exactly what the panel exists to interrupt.
  it("treats a stale ready order as overdue", async () => {
    const db = createDb();
    await seed(db, [{ id: "o1", status: ORDER_STATUS.READY, minutesAgo: 40 }]);
    const raise = vi.fn().mockResolvedValue(undefined);

    const result = await run(db, raise);

    expect(result.raised).toBe(1);
  });

  it("honours a custom threshold", async () => {
    const db = createDb();
    await seed(db, [
      { id: "o1", status: ORDER_STATUS.CONFIRMED, minutesAgo: 12 },
    ]);
    const raise = vi.fn().mockResolvedValue(undefined);

    expect((await run(db, raise, 20)).raised).toBe(0);
    expect((await run(db, raise, 10)).raised).toBe(1);
  });

  it("reports the oldest orders first", async () => {
    const db = createDb();
    await seed(db, [
      { id: "new", status: ORDER_STATUS.PENDING, minutesAgo: 25 },
      { id: "old", status: ORDER_STATUS.PENDING, minutesAgo: 90 },
    ]);
    const raise = vi.fn().mockResolvedValue(undefined);

    await run(db, raise);

    expect(raise.mock.calls.map((call) => call[1].orderId)).toEqual([
      "old",
      "new",
    ]);
  });
});
