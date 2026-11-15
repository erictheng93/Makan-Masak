import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { PnlService } from "./PnlService";

// Real migrations, real SQL: the arithmetic lives in the queries.
const MIGRATIONS = fileURLToPath(
  new URL(
    "../../../../../../packages/database/migrations_fresh/",
    import.meta.url,
  ).href,
);

function createDb() {
  const sqlite = new Database(":memory:");
  // Fixtures set only the columns the report reads; skip unrelated FK parents.
  sqlite.pragma("foreign_keys = OFF");
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const file of files) {
    for (const statement of readFileSync(MIGRATIONS + file, "utf8").split(
      "--> statement-breakpoint",
    )) {
      sqlite.exec(statement);
    }
  }
  return sqlite;
}

const SHOP = "shop-1";
const OTHER_SHOP = "shop-2";
// 2026-03-10 12:00 in Taipei (UTC+8).
const NOW = Date.parse("2026-03-10T04:00:00Z");

let seq = 0;
function seed(sqlite: Database.Database, settings = "{}") {
  for (const id of [SHOP, OTHER_SHOP]) {
    sqlite
      .prepare(
        "INSERT INTO restaurants (id, name, type, category, address, district, phone, settings, timezone, created_at_ms, updated_at_ms) VALUES (?, 'R', 'restaurant', 'x', 'a', 'd', 'p', ?, 'Asia/Taipei', 0, 0)",
      )
      .run(id, settings);
  }
}

function addMenuItem(
  sqlite: Database.Database,
  restaurantId: string,
  cost: number | null,
) {
  return Number(
    sqlite
      .prepare(
        "INSERT INTO menu_items (restaurant_id, category_id, name, price_cents, cost_price_cents, created_at_ms, updated_at_ms) VALUES (?, 1, 'dish', 1000, ?, 0, 0)",
      )
      .run(restaurantId, cost).lastInsertRowid,
  );
}

function addOrder(
  sqlite: Database.Database,
  o: {
    createdAt: string;
    total: number;
    discount?: number;
    refund?: number;
    paymentStatus?: string;
    status?: string;
    lines?: { menuItemId: number; quantity: number; status?: string }[];
  },
) {
  const id = `order-${++seq}`;
  sqlite
    .prepare(
      `INSERT INTO orders (id, restaurant_id, status, payment_status, total_amount_cents,
         discount_amount_cents, refund_amount_cents, tax_amount_cents, service_charge_cents, created_at_ms, updated_at_ms, order_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, 100, 50, ?, 0, ?)`,
    )
    .run(
      id,
      SHOP,
      o.status ?? "paid",
      o.paymentStatus ?? "completed",
      o.total,
      o.discount ?? 0,
      o.refund ?? 0,
      Date.parse(o.createdAt),
      id,
    );
  for (const line of o.lines ?? []) {
    sqlite
      .prepare(
        "INSERT INTO order_items (order_id, menu_item_id, quantity, status, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, 0, 0)",
      )
      .run(id, line.menuItemId, line.quantity, line.status ?? "served");
  }
}

function service(sqlite: Database.Database) {
  return new PnlService(
    drizzle(sqlite) as unknown as ConstructorParameters<typeof PnlService>[0],
    () => NOW,
  );
}

describe("PnlService.getDaily", () => {
  it("computes revenue, COGS, expenses and profit", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const costed = addMenuItem(sqlite, SHOP, 300);
    const uncosted = addMenuItem(sqlite, SHOP, null);
    // 2026-03-10 08:00 Taipei
    addOrder(sqlite, {
      createdAt: "2026-03-10T00:00:00Z",
      total: 9000,
      discount: 1000,
      lines: [
        { menuItemId: costed, quantity: 2 },
        { menuItemId: uncosted, quantity: 1 },
        { menuItemId: costed, quantity: 5, status: "cancelled" },
      ],
    });
    // partially refunded
    addOrder(sqlite, {
      createdAt: "2026-03-10T02:00:00Z",
      total: 5000,
      refund: 2000,
      paymentStatus: "partial_refunded",
      lines: [{ menuItemId: costed, quantity: 1 }],
    });
    // not collected, cancelled: both excluded
    addOrder(sqlite, {
      createdAt: "2026-03-10T02:00:00Z",
      total: 7777,
      paymentStatus: "pending",
    });
    addOrder(sqlite, {
      createdAt: "2026-03-10T02:00:00Z",
      total: 8888,
      status: "cancelled",
    });
    const svc = service(sqlite);
    const rent = await svc.createExpense(SHOP, "u1", {
      date: "2026-03-10",
      category: "rent",
      amountCents: 200000,
    });
    await svc.createExpense(SHOP, "u1", {
      date: "2026-03-10",
      category: "misc",
      amountCents: 5000,
      note: "tape",
    });
    const gone = await svc.createExpense(SHOP, "u1", {
      date: "2026-03-10",
      category: "labor",
      amountCents: 99900,
    });
    expect(await svc.deleteExpense(SHOP, gone.id)).toBe(true);

    const result = await svc.getDaily(SHOP, "2026-03-10");

    expect(result.currency).toBe("TWD");
    expect(result.revenue).toEqual({
      grossSalesCents: 15000, // 9000+5000 totals + 1000 discount
      discountCents: 1000,
      refundCents: 2000,
      netRevenueCents: 12000,
      taxCents: 200,
      serviceChargeCents: 100,
      orderCount: 2,
    });
    // 2*300 + 0 (uncosted) + 1*300; the cancelled line is excluded
    expect(result.cogs).toEqual({ totalCents: 900, itemsMissingCost: 1 });
    expect(result.grossProfitCents).toBe(11100);
    expect(result.expenses.totalCents).toBe(205000);
    expect(result.expenses.byCategory).toEqual(
      expect.arrayContaining([
        { category: "rent", amountCents: 200000 },
        { category: "misc", amountCents: 5000 },
      ]),
    );
    expect(result.expenses.byCategory).toHaveLength(2);
    expect(result.expenses.items.map((i) => i.id)).toContain(rent.id);
    expect(result.expenses.items.map((i) => i.id)).not.toContain(gone.id);
    expect(result.netProfitCents).toBe(11100 - 205000);
  });

  it("cuts the day at the restaurant timezone and defaults to its today", async () => {
    const sqlite = createDb();
    seed(sqlite);
    // 2026-03-09 16:30Z = 2026-03-10 00:30 Taipei -> belongs to the 10th
    addOrder(sqlite, { createdAt: "2026-03-09T16:30:00Z", total: 1000 });
    // 2026-03-10 15:59Z = 2026-03-10 23:59 Taipei -> still the 10th
    addOrder(sqlite, { createdAt: "2026-03-10T15:59:00Z", total: 2000 });
    // 2026-03-09 15:59Z = 2026-03-09 23:59 Taipei -> the 9th
    addOrder(sqlite, { createdAt: "2026-03-09T15:59:00Z", total: 4000 });
    const svc = service(sqlite);

    const tenth = await svc.getDaily(SHOP); // NOW is the 10th in Taipei
    expect(tenth.date).toBe("2026-03-10");
    expect(tenth.revenue.netRevenueCents).toBe(3000);
    expect(
      (await svc.getDaily(SHOP, "2026-03-09")).revenue.netRevenueCents,
    ).toBe(4000);
  });
});

describe("PnlService expenses", () => {
  it("rejects a future date and a TWD amount off the whole-dollar step", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const svc = service(sqlite);

    await expect(
      svc.createExpense(SHOP, "u1", {
        date: "2026-03-11",
        category: "misc",
        amountCents: 100,
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_DATE_IN_FUTURE" });
    await expect(
      svc.createExpense(SHOP, "u1", {
        date: "2026-03-10",
        category: "misc",
        amountCents: 15550,
      }),
    ).rejects.toMatchObject({ code: "CURRENCY_PRECISION" });
  });

  it("soft-deletes once, keeps the row, and never across restaurants", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const svc = service(sqlite);
    const e = await svc.createExpense(SHOP, "u1", {
      date: "2026-03-10",
      category: "utilities",
      amountCents: 10000,
    });

    expect(await svc.deleteExpense(OTHER_SHOP, e.id)).toBe(false);
    expect(await svc.deleteExpense(SHOP, e.id)).toBe(true);
    expect(await svc.deleteExpense(SHOP, e.id)).toBe(false);
    expect(
      sqlite
        .prepare("SELECT deleted_at_ms FROM restaurant_expenses WHERE id = ?")
        .get(e.id),
    ).toEqual({ deleted_at_ms: NOW });
  });
});
