import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { marketCheckoutSessions } from "@makanmasak/database";
import {
  releaseStaleMarketCheckoutVoucherReservations,
  type VoucherExpirySweepDb,
} from "./market-checkout-voucher-expiry";
import type { Env } from "../types/env";

// Real SQLite, built from the Drizzle schema like overdue-order-alerts.test.ts:
// the sweep is mostly a WHERE clause plus a compare-and-set.
function ddlFor(table: SQLiteTable): string {
  const { name, columns } = getTableConfig(table);
  const defs = columns.map((column) => {
    const pk = column.primary ? " PRIMARY KEY" : "";
    return `"${column.name}" ${column.getSQLType()}${pk}`;
  });
  return `CREATE TABLE "${name}" (${defs.join(", ")});`;
}

const NOW = new Date("2026-10-21T12:00:00.000Z").getTime();
const HOUR = 60 * 60_000;

function voucher(reservationStatus?: "reserved" | "released") {
  return {
    couponId: 7,
    code: "ONCE",
    name: "Once per customer",
    fundedBy: "platform",
    usageIdentity: "customer:cust-1",
    discountCents: 1000,
    allocations: [{ orderId: "o-1", amountCents: 5000, discountCents: 1000 }],
    ...(reservationStatus ? { reservationStatus } : {}),
  };
}

async function setup(
  rows: Array<{
    id: string;
    paymentStatus: string;
    hoursAgo: number;
    appliedVoucher: Record<string, unknown> | null;
  }>,
) {
  const sqlite = new Database(":memory:");
  sqlite.exec(ddlFor(marketCheckoutSessions));
  const db = drizzle(sqlite) as unknown as VoucherExpirySweepDb;
  for (const row of rows) {
    await db.insert(marketCheckoutSessions).values({
      id: row.id,
      marketId: "m-1",
      marketSlug: "m",
      marketName: "M",
      subtotalCents: 5000,
      paymentStatus: row.paymentStatus,
      appliedVoucher: row.appliedVoucher,
      createdAt: new Date(NOW - row.hoursAgo * HOUR),
      updatedAt: new Date(NOW - row.hoursAgo * HOUR),
    });
  }
  const voucherService = {
    releaseReservation: vi.fn(async (v) => ({
      ...v,
      reservationStatus: "released" as const,
    })),
  };
  const run = () =>
    releaseStaleMarketCheckoutVoucherReservations({} as Env, {
      nowMs: NOW,
      db,
      voucherService,
    });
  return { db, voucherService, run };
}

describe("releaseStaleMarketCheckoutVoucherReservations", () => {
  it("releases only stale, unpaid, still-reserved checkouts", async () => {
    const { db, voucherService, run } = await setup([
      {
        id: "stale",
        paymentStatus: "pending",
        hoursAgo: 25,
        appliedVoucher: voucher("reserved"),
      },
      {
        id: "fresh",
        paymentStatus: "pending",
        hoursAgo: 2,
        appliedVoucher: voucher("reserved"),
      },
      {
        id: "paid",
        paymentStatus: "paid",
        hoursAgo: 48,
        appliedVoucher: voucher("reserved"),
      },
      {
        id: "released",
        paymentStatus: "failed",
        hoursAgo: 48,
        appliedVoucher: voucher("released"),
      },
      {
        id: "none",
        paymentStatus: "pending",
        hoursAgo: 48,
        appliedVoucher: null,
      },
    ]);

    const result = await run();

    expect(result).toMatchObject({ released: 1, errors: [] });
    expect(voucherService.releaseReservation).toHaveBeenCalledOnce();
    expect(voucherService.releaseReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        couponId: 7,
        usageIdentity: "customer:cust-1",
        reservationStatus: "reserved",
      }),
    );
    const [stale] = await db
      .select({ appliedVoucher: marketCheckoutSessions.appliedVoucher })
      .from(marketCheckoutSessions)
      .where(eq(marketCheckoutSessions.id, "stale"))
      .all();
    expect(stale.appliedVoucher).toMatchObject({
      reservationStatus: "released",
    });
  });

  it("is a no-op on the next tick once a reservation is released", async () => {
    const { voucherService, run } = await setup([
      {
        id: "stale",
        paymentStatus: "pending",
        hoursAgo: 25,
        appliedVoucher: voucher("reserved"),
      },
    ]);

    await run();
    await expect(run()).resolves.toMatchObject({ released: 0 });

    expect(voucherService.releaseReservation).toHaveBeenCalledOnce();
  });
});
