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
    paymentMethod?: string;
    orderSource?: string;
    tax?: number;
    service?: number;
    lines?: {
      menuItemId: number;
      quantity: number;
      status?: string;
      unitCost?: number | null;
    }[];
  },
) {
  const id = `order-${++seq}`;
  sqlite
    .prepare(
      `INSERT INTO orders (id, restaurant_id, status, payment_status, total_amount_cents,
         discount_amount_cents, refund_amount_cents, tax_amount_cents, service_charge_cents, created_at_ms, updated_at_ms, order_number,
         payment_method, order_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      id,
      SHOP,
      o.status ?? "paid",
      o.paymentStatus ?? "completed",
      o.total,
      o.discount ?? 0,
      o.refund ?? 0,
      o.tax ?? 100,
      o.service ?? 50,
      Date.parse(o.createdAt),
      id,
      o.paymentMethod ?? "cash",
      o.orderSource ?? "direct",
    );
  for (const line of o.lines ?? []) {
    sqlite
      .prepare(
        "INSERT INTO order_items (order_id, menu_item_id, quantity, status, unit_cost_cents, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 0, 0)",
      )
      .run(
        id,
        line.menuItemId,
        line.quantity,
        line.status ?? "served",
        line.unitCost ?? null,
      );
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
      collectedCents: 12000,
      grossSalesCents: 15000, // 9000+5000 totals + 1000 discount
      discountCents: 1000,
      refundCents: 2000,
      // tax 100 + 100*3000/5000 = 160 -> NT$2, carved out of revenue
      netRevenueCents: 11800,
      taxCents: 200,
      serviceChargeCents: 100,
      orderCount: 2,
    });
    // 2*300 + 0 (uncosted) + 1*300; the cancelled line is excluded
    expect(result.cogs).toEqual({ totalCents: 900, itemsMissingCost: 1 });
    expect(result.grossProfitCents).toBe(10900);
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
    expect(result.fees).toEqual({
      paymentFeeCents: 0,
      platformCommissionCents: 0,
      configured: false,
    });
    expect(result.labor).toEqual({
      costCents: 0,
      shifts: 0,
      shiftsMissingRate: 0,
    });
    expect(result.netProfitCents).toBe(10900 - 205000);
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
    expect(tenth.revenue.collectedCents).toBe(3000);
    expect(
      (await svc.getDaily(SHOP, "2026-03-09")).revenue.collectedCents,
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

function addTemplate(
  sqlite: Database.Database,
  rate: number | null,
  multiplier = 1.5,
) {
  return Number(
    sqlite
      .prepare(
        "INSERT INTO shift_templates (restaurant_id, name, start_time, end_time, duration_minutes, hourly_rate_cents, overtime_multiplier, created_at_ms, updated_at_ms) VALUES (?, 'shift', '09:00', '17:00', 480, ?, ?, 0, 0)",
      )
      .run(SHOP, rate, multiplier).lastInsertRowid,
  );
}

/** Shaped like SchedulingService.clockOut leaves a worked shift. */
function addSchedule(
  sqlite: Database.Database,
  s: {
    workDate: string;
    templateId: number | null;
    actualHours: number;
    overtimeHours?: number;
    status?: string;
    employeeId?: string;
    /** The rate snapshot clock-out stores. */
    rate?: number | null;
  },
) {
  const worked = (s.status ?? "completed") === "completed";
  sqlite
    .prepare(
      `INSERT INTO employee_schedules (restaurant_id, employee_id, shift_template_id, work_date, start_time, end_time,
         scheduled_hours, actual_hours, overtime_hours, status, clock_in_time_ms, clock_out_time_ms, created_by, created_at_ms, updated_at_ms,
         hourly_rate_cents)
       VALUES (?, ?, ?, ?, '09:00', '17:00', 8, ?, ?, ?, ?, ?, 'u1', 0, 0, ?)`,
    )
    .run(
      SHOP,
      s.employeeId ?? "emp-1",
      s.templateId,
      s.workDate,
      s.actualHours,
      s.overtimeHours ?? 0,
      s.status ?? "completed",
      worked ? 1 : null,
      worked ? 2 : null,
      s.rate ?? null,
    );
}

function addEmployee(
  sqlite: Database.Database,
  id: string,
  rate: number | null,
) {
  sqlite
    .prepare(
      "INSERT INTO users (id, username, full_name, password_hash, role, restaurant_id, hourly_rate_cents, created_at_ms, updated_at_ms) VALUES (?, ?, 'E', 'x', 4, ?, ?, 0, 0)",
    )
    .run(id, id, SHOP, rate);
}

function storedPnlRates(sqlite: Database.Database) {
  const row = sqlite
    .prepare("SELECT settings FROM restaurants WHERE id = ?")
    .get(SHOP) as { settings: string };
  return JSON.parse(row.settings).pnlRates;
}

describe("PnlService fees", () => {
  it("rounds the fee once per day/method/source group to whole TWD, on the post-refund amount", async () => {
    const sqlite = createDb();
    seed(sqlite, '{"currency":"TWD","taxRate":5}');
    const svc = service(sqlite);
    await svc.setRates(SHOP, {
      paymentFeeBps: { card: 250 },
      platformCommissionBps: { uber_eats: 3000 },
    });
    // card group: 15500 + 15500 + (10000 - 4000) = 37000
    for (let i = 0; i < 2; i++) {
      addOrder(sqlite, {
        createdAt: "2026-03-10T01:00:00Z",
        total: 15500,
        paymentMethod: "card",
      });
    }
    addOrder(sqlite, {
      createdAt: "2026-03-10T01:00:00Z",
      total: 10000,
      refund: 4000,
      paymentStatus: "partial_refunded",
      paymentMethod: "card",
    });
    addOrder(sqlite, {
      createdAt: "2026-03-10T01:00:00Z",
      total: 20000,
      paymentMethod: "cash",
      orderSource: "uber_eats",
    });

    const result = await svc.getDaily(SHOP, "2026-03-10");

    // 2.5% of 37000 = 925 -> NT$9 (without the refund: 1025 -> NT$10)
    expect(result.fees).toEqual({
      paymentFeeCents: 900,
      platformCommissionCents: 6000,
      configured: true,
    });
    expect(result.netProfitCents).toBe(result.grossProfitCents - 6900);
    // The rates write merged into settings instead of replacing them.
    const raw = sqlite
      .prepare("SELECT settings FROM restaurants WHERE id = ?")
      .get(SHOP) as { settings: string };
    expect(JSON.parse(raw.settings)).toMatchObject({
      currency: "TWD",
      taxRate: 5,
      pnlRates: {
        versions: [
          {
            effectiveFrom: "2026-03-10",
            paymentFeeBps: { card: 250, cash: 0 },
          },
        ],
      },
    });
  });

  it("keeps sen for MYR", async () => {
    const sqlite = createDb();
    seed(sqlite, '{"currency":"MYR"}');
    const svc = service(sqlite);
    await svc.setRates(SHOP, {
      paymentFeeBps: { card: 250 },
      platformCommissionBps: {},
    });
    // 2.5% of 31100 = 777.5 -> 778 sen (TWD would give 800)
    for (let i = 0; i < 2; i++) {
      addOrder(sqlite, {
        createdAt: "2026-03-10T01:00:00Z",
        total: 15550,
        paymentMethod: "card",
      });
    }

    const result = await svc.getDaily(SHOP, "2026-03-10");

    expect(result.currency).toBe("MYR");
    expect(result.fees.paymentFeeCents).toBe(778);
  });

  it("reads unset rates as zero and lists the allowed keys", async () => {
    const sqlite = createDb();
    seed(sqlite);

    const rates = await service(sqlite).getRates(SHOP);

    expect(rates.paymentMethods).toEqual(
      expect.arrayContaining(["cash", "card", "online", "ewallet"]),
    );
    expect(rates.platforms).toEqual(["uber_eats", "foodpanda", "grabfood"]);
    expect(rates.paymentFeeBps.card).toBe(0);
    expect(rates.platformCommissionBps.foodpanda).toBe(0);
  });
});

describe("PnlService payment-method keys", () => {
  it("offers a method seen on the shop's orders, accepts a rate for it and charges it", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const svc = service(sqlite);
    addOrder(sqlite, {
      createdAt: "2026-03-10T01:00:00Z",
      total: 20000,
      paymentMethod: "line_pay",
    });
    addOrder(sqlite, {
      createdAt: "2026-03-10T01:00:00Z",
      total: 1000,
      paymentMethod: "split",
    });

    const before = await svc.getRates(SHOP);
    expect(before.paymentMethods.slice(-2)).toEqual(["line_pay", "split"]);
    expect(before.paymentMethods[0]).toBe("cash");
    expect(before.paymentFeeBps.line_pay).toBe(0);
    await expect(
      svc.setRates(SHOP, {
        paymentFeeBps: { bitcoin: 100 },
        platformCommissionBps: {},
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    const saved = await svc.setRates(SHOP, {
      paymentFeeBps: { line_pay: 220 },
      platformCommissionBps: {},
    });
    expect(saved.paymentFeeBps).toMatchObject({ line_pay: 220, split: 0 });
    expect((await svc.getRates(SHOP)).paymentFeeBps.line_pay).toBe(220);

    // 2.2% of 20000 = 440 -> NT$4
    const daily = await svc.getDaily(SHOP, "2026-03-10");
    expect(daily.fees).toMatchObject({
      paymentFeeCents: 400,
      configured: true,
    });
  });
});

describe("PnlService labor", () => {
  it("costs worked shifts from the template rate, overtime at its multiplier", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const day = addTemplate(sqlite, 20000, 2);
    const odd = addTemplate(sqlite, 15000);
    const noRate = addTemplate(sqlite, null);
    // 8 regular + 1 overtime (overtime is inside actual): 8*200 + 1*200*2 = NT$2000
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: day,
      actualHours: 9,
      overtimeHours: 1,
    });
    // 2.33h * 15000 = 34950 -> NT$350, rounded per shift
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: odd,
      actualHours: 2.33,
    });
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: noRate,
      actualHours: 4,
    });
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: null,
      actualHours: 4,
    });
    // not worked / another day: not counted
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: day,
      actualHours: 0,
      status: "scheduled",
    });
    addSchedule(sqlite, {
      workDate: "2026-03-09",
      templateId: day,
      actualHours: 8,
    });

    const result = await service(sqlite).getDaily(SHOP, "2026-03-10");

    expect(result.labor).toEqual({
      costCents: 235000,
      shifts: 4,
      shiftsMissingRate: 2,
    });
    expect(result.netProfitCents).toBe(-235000);
  });
});

describe("PnlService COGS", () => {
  it("prefers the sale-time cost snapshot over the current menu cost", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const item = addMenuItem(sqlite, SHOP, 300);
    const uncosted = addMenuItem(sqlite, SHOP, null);
    addOrder(sqlite, {
      createdAt: "2026-03-10T01:00:00Z",
      total: 9000,
      lines: [
        { menuItemId: item, quantity: 2, unitCost: 250 }, // snapshot
        { menuItemId: item, quantity: 1 }, // pre-0047: current 300
        { menuItemId: uncosted, quantity: 1, unitCost: 0 }, // a real 0 cost
        { menuItemId: uncosted, quantity: 1 }, // no cost anywhere
      ],
    });

    const result = await service(sqlite).getDaily(SHOP, "2026-03-10");

    expect(result.cogs).toEqual({ totalCents: 800, itemsMissingCost: 1 });
  });
});

describe("PnlService.getRange", () => {
  it("returns every day, each equal to the daily statement, and column totals", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const svc = service(sqlite);
    await svc.setRates(SHOP, {
      paymentFeeBps: { card: 300 },
      platformCommissionBps: { foodpanda: 2500 },
      effectiveFrom: "2026-03-01",
    });
    const item = addMenuItem(sqlite, SHOP, 400);
    // 2026-03-08 00:00:00 Taipei: first instant of the window
    addOrder(sqlite, {
      createdAt: "2026-03-07T16:00:00Z",
      total: 15500,
      paymentMethod: "card",
      lines: [{ menuItemId: item, quantity: 3 }],
    });
    // 2026-03-07 23:59:59 Taipei: just outside
    addOrder(sqlite, { createdAt: "2026-03-07T15:59:59Z", total: 99900 });
    // 2026-03-10 23:59:59 Taipei: last instant of the window
    addOrder(sqlite, {
      createdAt: "2026-03-10T15:59:59Z",
      total: 20000,
      orderSource: "foodpanda",
      lines: [{ menuItemId: item, quantity: 1, unitCost: 350 }],
    });
    // 2026-03-11 00:00 Taipei: just outside
    addOrder(sqlite, { createdAt: "2026-03-10T16:00:00Z", total: 88800 });
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: addTemplate(sqlite, 18000),
      actualHours: 8,
    });
    await svc.createExpense(SHOP, "u1", {
      date: "2026-03-08",
      category: "rent",
      amountCents: 100000,
    });

    const range = await svc.getRange(SHOP, "2026-03-08", "2026-03-10");

    expect(range.days.map((d) => d.date)).toEqual([
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(range.days[1]).toEqual({
      date: "2026-03-09",
      orderCount: 0,
      netRevenueCents: 0,
      cogsCents: 0,
      grossProfitCents: 0,
      feesCents: 0,
      laborCents: 0,
      expensesCents: 0,
      netProfitCents: 0,
    });
    for (const row of range.days) {
      const daily = await svc.getDaily(SHOP, row.date);
      expect(row).toEqual({
        date: daily.date,
        orderCount: daily.revenue.orderCount,
        netRevenueCents: daily.revenue.netRevenueCents,
        cogsCents: daily.cogs.totalCents,
        grossProfitCents: daily.grossProfitCents,
        feesCents:
          daily.fees.paymentFeeCents + daily.fees.platformCommissionCents,
        laborCents: daily.labor.costCents,
        expensesCents: daily.expenses.totalCents,
        netProfitCents: daily.netProfitCents,
      });
    }
    const { date: _date, ...zero } = range.days[1];
    const sum = { ...zero };
    for (const row of range.days) {
      for (const key of Object.keys(sum) as (keyof typeof sum)[]) {
        sum[key] += row[key];
      }
    }
    expect(range.totals).toEqual(sum);
    // 15500 + 20000 less tax 100 + 100, fee 465 -> 500, commission 5000, labor 144000
    expect(range.totals).toMatchObject({
      orderCount: 2,
      netRevenueCents: 35300,
      cogsCents: 1550,
      feesCents: 5500,
      laborCents: 144000,
      expensesCents: 100000,
    });
  });

  it("rejects from after to, and more than 92 days", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const svc = service(sqlite);

    await expect(
      svc.getRange(SHOP, "2026-03-10", "2026-03-09"),
    ).rejects.toMatchObject({ code: "PNL_RANGE_INVALID" });
    await expect(
      svc.getRange(SHOP, "2026-01-01", "2026-04-03"), // 93 days
    ).rejects.toMatchObject({ code: "PNL_RANGE_INVALID" });
    const ok = await svc.getRange(SHOP, "2026-01-01", "2026-04-02");
    expect(ok.days).toHaveLength(92);
  });
});

describe("PnlService labor rates", () => {
  it("prefers the clock-out snapshot, then the employee wage, then the template", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const template = addTemplate(sqlite, 20000);
    addEmployee(sqlite, "paid", 30000);
    addEmployee(sqlite, "unpaid", null);
    // employee wage beats the template: 2h * NT$300
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: template,
      actualHours: 2,
      employeeId: "paid",
    });
    // the snapshot beats both: 2h * NT$100
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: template,
      actualHours: 2,
      employeeId: "paid",
      rate: 10000,
    });
    // no wage: the template, 2h * NT$200
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: template,
      actualHours: 2,
      employeeId: "unpaid",
    });
    // nothing at all
    addSchedule(sqlite, {
      workDate: "2026-03-10",
      templateId: null,
      actualHours: 2,
      employeeId: "unpaid",
    });
    const svc = service(sqlite);

    expect((await svc.getDaily(SHOP, "2026-03-10")).labor).toEqual({
      costCents: 60000 + 20000 + 40000,
      shifts: 4,
      shiftsMissingRate: 1,
    });

    // A raise moves the unsnapshotted shift only.
    sqlite
      .prepare("UPDATE users SET hourly_rate_cents = 50000 WHERE id = 'paid'")
      .run();
    expect((await svc.getDaily(SHOP, "2026-03-10")).labor.costCents).toBe(
      100000 + 20000 + 40000,
    );
  });
});

describe("PnlService revenue excludes tax", () => {
  it("carves retained tax out of revenue, pro rata to refunds, rounded per day", async () => {
    const sqlite = createDb();
    seed(sqlite);
    // 03-06: subtotal 10000 + service 1000 + tax 500 = 11500
    addOrder(sqlite, {
      createdAt: "2026-03-06T01:00:00Z",
      total: 11500,
      tax: 500,
      service: 1000,
    });
    // 03-07: refunded 20% -> tax 400
    addOrder(sqlite, {
      createdAt: "2026-03-07T01:00:00Z",
      total: 11500,
      refund: 2300,
      paymentStatus: "partial_refunded",
      tax: 500,
      service: 1000,
    });
    // 03-08: fully refunded -> tax 0
    addOrder(sqlite, {
      createdAt: "2026-03-08T01:00:00Z",
      total: 11500,
      refund: 11500,
      paymentStatus: "refunded",
      tax: 500,
    });
    // 03-09: 500 * 7000 / 10500 = 333.3, twice = 666.7 -> NT$7 (once per day, not per order)
    for (let i = 0; i < 2; i++) {
      addOrder(sqlite, {
        createdAt: "2026-03-09T01:00:00Z",
        total: 10500,
        refund: 3500,
        paymentStatus: "partial_refunded",
        tax: 500,
      });
    }
    const svc = service(sqlite);
    const revenue = async (date: string) =>
      (await svc.getDaily(SHOP, date)).revenue;

    expect(await revenue("2026-03-06")).toMatchObject({
      collectedCents: 11500,
      taxCents: 500,
      // service charge stays in revenue
      netRevenueCents: 11000,
      serviceChargeCents: 1000,
    });
    expect(await revenue("2026-03-07")).toMatchObject({
      collectedCents: 9200,
      taxCents: 400,
      netRevenueCents: 8800,
    });
    expect(await revenue("2026-03-08")).toMatchObject({
      collectedCents: 0,
      taxCents: 0,
      netRevenueCents: 0,
    });
    expect(await revenue("2026-03-09")).toMatchObject({
      collectedCents: 14000,
      taxCents: 700,
      netRevenueCents: 13300,
    });
    const range = await svc.getRange(SHOP, "2026-03-06", "2026-03-09");
    expect(range.days.map((d) => d.netRevenueCents)).toEqual([
      11000, 8800, 0, 13300,
    ]);
  });

  it("keeps sen for MYR and charges fees on the collected amount", async () => {
    const sqlite = createDb();
    seed(sqlite, '{"currency":"MYR"}');
    const svc = service(sqlite);
    await svc.setRates(SHOP, {
      paymentFeeBps: { card: 1000 },
      platformCommissionBps: {},
    });
    addOrder(sqlite, {
      createdAt: "2026-03-10T01:00:00Z",
      total: 10500,
      refund: 3500,
      paymentStatus: "partial_refunded",
      tax: 500,
      paymentMethod: "card",
    });

    const daily = await svc.getDaily(SHOP, "2026-03-10");

    expect(daily.revenue).toMatchObject({
      collectedCents: 7000,
      taxCents: 333,
      netRevenueCents: 6667,
    });
    // 10% of 7000 (tax included), not of 6667
    expect(daily.fees.paymentFeeCents).toBe(700);
  });
});

describe("PnlService rate versions", () => {
  const card = (bps: number) => ({
    paymentFeeBps: { card: bps },
    platformCommissionBps: {},
  });

  it("charges each day of a range at the version in force that day", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const svc = service(sqlite);
    await svc.setRates(SHOP, { ...card(100), effectiveFrom: "2026-03-01" });
    await svc.setRates(SHOP, { ...card(1000), effectiveFrom: "2026-03-09" });
    for (const day of ["2026-02-28", "2026-03-08", "2026-03-09"]) {
      addOrder(sqlite, {
        createdAt: `${day}T01:00:00Z`,
        total: 10000,
        tax: 0,
        paymentMethod: "card",
      });
    }

    const range = await svc.getRange(SHOP, "2026-02-28", "2026-03-09");

    const fees = Object.fromEntries(
      range.days.map((d) => [d.date, d.feesCents]),
    );
    // before the first version: nothing; then 1%, then 10%
    expect(fees).toMatchObject({
      "2026-02-28": 0,
      "2026-03-08": 100,
      "2026-03-09": 1000,
    });
    expect((await svc.getDaily(SHOP, "2026-02-28")).fees.configured).toBe(
      false,
    );
    expect((await svc.getDaily(SHOP, "2026-03-08")).fees.configured).toBe(true);

    const rates = await svc.getRates(SHOP);
    expect(rates).toMatchObject({
      effectiveFrom: "2026-03-09",
      paymentFeeBps: { card: 1000 },
    });
    expect(rates.history.map((v) => v.effectiveFrom)).toEqual([
      "2026-03-09",
      "2026-03-01",
    ]);
  });

  it("reads the legacy shape as one version since 1970, and the first save converts it", async () => {
    const sqlite = createDb();
    seed(
      sqlite,
      '{"pnlRates":{"paymentFeeBps":{"card":250},"platformCommissionBps":{"uber_eats":3000}}}',
    );
    const svc = service(sqlite);
    addOrder(sqlite, {
      createdAt: "2026-03-04T01:00:00Z",
      total: 20000,
      paymentMethod: "card",
    });

    const before = await svc.getRates(SHOP);
    expect(before).toMatchObject({
      effectiveFrom: "1970-01-01",
      paymentFeeBps: { card: 250 },
      platformCommissionBps: { uber_eats: 3000 },
    });
    expect(before.history).toHaveLength(1);
    // 2.5% of 20000 = 500 -> NT$5
    expect((await svc.getDaily(SHOP, "2026-03-04")).fees.paymentFeeCents).toBe(
      500,
    );

    await svc.setRates(SHOP, { ...card(100), effectiveFrom: "2026-03-05" });

    expect(storedPnlRates(sqlite)).toEqual({
      versions: [
        expect.objectContaining({
          effectiveFrom: "1970-01-01",
          paymentFeeBps: expect.objectContaining({ card: 250 }),
          platformCommissionBps: expect.objectContaining({ uber_eats: 3000 }),
        }),
        expect.objectContaining({
          effectiveFrom: "2026-03-05",
          paymentFeeBps: expect.objectContaining({ card: 100 }),
        }),
      ],
    });
    // the day before the new version keeps the legacy rate
    expect((await svc.getDaily(SHOP, "2026-03-04")).fees.paymentFeeCents).toBe(
      500,
    );
  });

  it("replaces a same-date version, defaults to today, and rejects bad dates", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const svc = service(sqlite);

    await svc.setRates(SHOP, card(100));
    const saved = await svc.setRates(SHOP, {
      ...card(200),
      effectiveFrom: "2026-03-10",
    });

    expect(saved.effectiveFrom).toBe("2026-03-10");
    expect(saved.history).toHaveLength(1);
    expect(saved.history[0].paymentFeeBps.card).toBe(200);
    for (const effectiveFrom of ["2026-03-11", "2026-02-31", "yesterday"]) {
      await expect(
        svc.setRates(SHOP, { ...card(300), effectiveFrom }),
      ).rejects.toMatchObject({ code: "PNL_RATES_DATE_INVALID", status: 400 });
    }
    expect(storedPnlRates(sqlite).versions).toHaveLength(1);
  });

  it("keeps at most 60 versions", async () => {
    const sqlite = createDb();
    const versions = Array.from({ length: 60 }, (_, i) => ({
      effectiveFrom: new Date(Date.parse("2025-12-01") + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
      paymentFeeBps: { card: i },
      platformCommissionBps: {},
    }));
    seed(sqlite, JSON.stringify({ pnlRates: { versions } }));
    const svc = service(sqlite);

    await expect(
      svc.setRates(SHOP, { ...card(1), effectiveFrom: "2026-03-10" }),
    ).rejects.toMatchObject({
      code: "PNL_RATES_TOO_MANY_VERSIONS",
      status: 400,
    });
    // replacing one still fits
    const saved = await svc.setRates(SHOP, {
      ...card(1),
      effectiveFrom: versions[59].effectiveFrom,
    });
    expect(saved.history).toHaveLength(60);
  });

  it("re-reads once when another save lands between read and write", async () => {
    const sqlite = createDb();
    seed(sqlite);
    const svc = service(sqlite);
    const internals = svc as unknown as {
      loadRestaurant: (id: string) => Promise<unknown>;
    };
    const load = internals.loadRestaurant.bind(svc);
    let reads = 0;
    let racing = 1;
    internals.loadRestaurant = async (id) => {
      const shop = await load(id);
      reads += 1;
      if (racing-- > 0) {
        sqlite
          .prepare(
            "UPDATE restaurants SET settings = json_set(settings, '$.pnlRates', json(?)) WHERE id = ?",
          )
          .run(
            JSON.stringify({
              versions: [{ effectiveFrom: `2026-03-0${reads}`, ...card(100) }],
            }),
            SHOP,
          );
      }
      return shop;
    };

    const saved = await svc.setRates(SHOP, {
      ...card(200),
      effectiveFrom: "2026-03-05",
    });

    expect(reads).toBe(2);
    expect(saved.history.map((v) => v.effectiveFrom)).toEqual([
      "2026-03-05",
      "2026-03-01",
    ]);
    expect(storedPnlRates(sqlite).versions).toHaveLength(2);

    // A save that loses the race twice is refused, not silently merged.
    racing = 2;
    await expect(
      svc.setRates(SHOP, { ...card(300), effectiveFrom: "2026-03-06" }),
    ).rejects.toMatchObject({ code: "PNL_RATES_CONFLICT", status: 409 });
  });
});
