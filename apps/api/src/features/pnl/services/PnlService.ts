import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import {
  and,
  asc,
  between,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import {
  businessTimezoneOffsetMinutes,
  dateFromUnixMs,
  employeeSchedules,
  menuItems,
  orderItems,
  orders,
  PLATFORM_TYPES,
  restaurantExpenses,
  restaurants,
  revenueReportableOrder,
  shiftTemplates,
  users,
  type ExpenseCategory,
} from "@makanmasak/database";
import { ORDER_PAYMENT_METHODS } from "@makanmasak/shared-types";
import {
  assertCurrencyAlignedCents,
  roundToCurrencyCents,
} from "@makanmasak/utils";
import {
  badRequest,
  conflict,
  notFound,
} from "../../../shared/utils/api-error";
import {
  currencyFromRestaurantSettings,
  displayCurrencyFromRestaurantSettings,
} from "../../../shared/utils/restaurant-currency";
import type { Env } from "../../../types/env";

/** Allowed keys of `settings.pnlRates`: the values `orders.payment_method` / `orders.order_source` take. */
export const PNL_PAYMENT_METHODS = ORDER_PAYMENT_METHODS;
export const PNL_PLATFORMS = Object.values(PLATFORM_TYPES);
export const PNL_MAX_RANGE_DAYS = 92;
export const PNL_MAX_RATE_VERSIONS = 60;
const DAY_MS = 86_400_000;
/** What a legacy `{ paymentFeeBps, platformCommissionBps }` reads as: in force since forever. */
const LEGACY_EFFECTIVE_FROM = "1970-01-01";

interface RateSet {
  paymentFeeBps: Record<string, number>;
  platformCommissionBps: Record<string, number>;
}

export interface RateVersion extends RateSet {
  effectiveFrom: string;
}

export interface PnlRates extends RateSet {
  paymentMethods: string[];
  platforms: string[];
  /** Of the version in force today; null when none is. */
  effectiveFrom: string | null;
  /** Every version, newest first. */
  history: RateVersion[];
}

export interface ExpenseView {
  id: string;
  category: string;
  amountCents: number;
  note: string | null;
  createdAtMs: number;
}

export interface DailyPnl {
  date: string;
  currency: string;
  revenue: {
    /** What customers paid less refunds, tax included; matches the analytics revenue report. */
    collectedCents: number;
    grossSalesCents: number;
    discountCents: number;
    refundCents: number;
    netRevenueCents: number;
    taxCents: number;
    serviceChargeCents: number;
    orderCount: number;
  };
  cogs: { totalCents: number; itemsMissingCost: number };
  grossProfitCents: number;
  fees: {
    paymentFeeCents: number;
    platformCommissionCents: number;
    configured: boolean;
  };
  labor: { costCents: number; shifts: number; shiftsMissingRate: number };
  expenses: {
    totalCents: number;
    byCategory: { category: string; amountCents: number }[];
    items: ExpenseView[];
  };
  netProfitCents: number;
}

export interface PnlRow {
  date: string;
  orderCount: number;
  netRevenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  feesCents: number;
  laborCents: number;
  expensesCents: number;
  netProfitCents: number;
}

export interface RangePnl {
  from: string;
  to: string;
  currency: string;
  days: PnlRow[];
  totals: Omit<PnlRow, "date">;
}

/** Everything one business date contributes; daily and range both read it. */
interface DayAgg {
  orderCount: number;
  total: number;
  discount: number;
  refund: number;
  /** Tax retained after refunds; a real sum until rounded once per day. */
  tax: number;
  service: number;
  paymentFee: number;
  platformCommission: number;
  cogs: number;
  itemsMissingCost: number;
  labor: number;
  shifts: number;
  shiftsMissingRate: number;
  expenses: ExpenseView[];
}

const emptyDay = (): DayAgg => ({
  orderCount: 0,
  total: 0,
  discount: 0,
  refund: 0,
  tax: 0,
  service: 0,
  paymentFee: 0,
  platformCommission: 0,
  cogs: 0,
  itemsMissingCost: 0,
  labor: 0,
  shifts: 0,
  shiftsMissingRate: 0,
  expenses: [],
});

const collected = (d: DayAgg) => d.total - d.refund;
// Tax is collected for the tax authority, not earned; service charge is earned.
const net = (d: DayAgg) => collected(d) - d.tax;
const gross = (d: DayAgg) => net(d) - d.cogs;
const expenseTotal = (d: DayAgg) =>
  d.expenses.reduce((sum, e) => sum + e.amountCents, 0);
const netProfit = (d: DayAgg) =>
  gross(d) - d.paymentFee - d.platformCommission - d.labor - expenseTotal(d);

const isBps = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 10_000;

const asMap = (map: unknown) =>
  map && typeof map === "object" && !Array.isArray(map)
    ? (map as Record<string, unknown>)
    : {};

const isRealDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/**
 * One rate set; invalid values read as 0. Payment keys are open (orders carry
 * free-text methods such as "split" or a gateway name), platform keys fixed.
 */
function normalizeRates(raw: Record<string, unknown>): RateSet {
  const platform = asMap(raw.platformCommissionBps);
  return {
    paymentFeeBps: Object.fromEntries([
      ...PNL_PAYMENT_METHODS.map((key) => [key, 0]),
      ...Object.entries(asMap(raw.paymentFeeBps)).filter(([, v]) => isBps(v)),
    ]),
    platformCommissionBps: Object.fromEntries(
      PNL_PLATFORMS.map((key) => [
        key,
        isBps(platform[key]) ? platform[key] : 0,
      ]),
    ),
  };
}

/**
 * `settings.pnlRates` as versions, oldest first. The legacy shape (no
 * `versions`) is one version in force since 1970; a malformed entry is skipped.
 */
function readVersions(settings: unknown): RateVersion[] {
  const raw = asMap(asMap(settings).pnlRates);
  const list = Array.isArray(raw.versions)
    ? raw.versions
    : "paymentFeeBps" in raw || "platformCommissionBps" in raw
      ? [{ ...raw, effectiveFrom: LEGACY_EFFECTIVE_FROM }]
      : [];
  const byDate = new Map<string, RateVersion>();
  for (const entry of list) {
    const v = asMap(entry);
    if (!isRealDate(v.effectiveFrom)) continue;
    byDate.set(v.effectiveFrom, {
      effectiveFrom: v.effectiveFrom,
      ...normalizeRates(v),
    });
  }
  return [...byDate.values()].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
}

/** The version with the greatest effectiveFrom <= date; undefined before the first. */
const versionAt = (versions: RateVersion[], date: string) =>
  [...versions].reverse().find((v) => v.effectiveFrom <= date);

const ZERO_RATES = normalizeRates({});

const hasRates = (rates: RateSet | undefined) =>
  !!rates &&
  [
    ...Object.values(rates.paymentFeeBps),
    ...Object.values(rates.platformCommissionBps),
  ].some((bps) => bps > 0);

function datesBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += DAY_MS
  ) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export class PnlService {
  private readonly db: DrizzleD1Database;

  constructor(
    d1: Env["DB"] | DrizzleD1Database,
    private readonly now: () => number = Date.now,
  ) {
    // Accepts an already-built Drizzle handle so tests can run the real SQL.
    this.db = "select" in d1 ? d1 : drizzle(d1);
  }

  private async loadRestaurant(restaurantId: string) {
    const row = await this.db
      .select({
        settings: restaurants.settings,
        timezone: restaurants.timezone,
        // The stored text, for the compare-and-set in setRates.
        pnlRatesJson: sql<
          string | null
        >`json_extract(${restaurants.settings}, '$.pnlRates')`,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .get();
    if (!row) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
    const offsetMinutes = businessTimezoneOffsetMinutes(row.timezone);
    const today = new Date(this.now() + offsetMinutes * 60_000)
      .toISOString()
      .slice(0, 10);
    return {
      settings: row.settings,
      pnlRatesJson: row.pnlRatesJson,
      offsetMinutes,
      today,
    };
  }

  /**
   * The one computation behind daily and range: 1 restaurant read plus 4
   * grouped queries, whatever the number of days.
   */
  private async aggregate(
    shop: Awaited<ReturnType<PnlService["loadRestaurant"]>>,
    restaurantId: string,
    from: string,
    to: string,
  ) {
    const currency = displayCurrencyFromRestaurantSettings(shop.settings);
    const versions = readVersions(shop.settings);

    // Same order set and day attribution (orders.created_at_ms cut at the shop
    // offset) as the analytics revenue report, so the two figures agree.
    const offsetMs = shop.offsetMinutes * 60_000;
    const orderScope = and(
      eq(orders.restaurantId, restaurantId),
      revenueReportableOrder(),
      gte(
        orders.createdAt,
        new Date(Date.parse(`${from}T00:00:00Z`) - offsetMs),
      ),
      lt(
        orders.createdAt,
        new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS - offsetMs),
      ),
    );
    const orderDay = dateFromUnixMs(orders.createdAt, shop.offsetMinutes);
    // Clamped per order like analytics: a refund never takes an order below 0.
    const refund = sql<number>`min(coalesce(${orders.refundAmountCents}, 0), coalesce(${orders.totalAmountCents}, 0))`;
    const orderNet = sql<number>`coalesce(${orders.totalAmountCents}, 0) - ${refund}`;
    // A line's cost: the snapshot taken at sale, else the item's current cost.
    const lineCost = sql`coalesce(${orderItems.unitCostCents}, ${menuItems.costPriceCents})`;

    const [orderGroups, cogsGroups, schedules, expenseRows] = await Promise.all(
      [
        // Grouped by everything a fee depends on (day, payment method, order
        // source); fees are rounded once per group, not per order.
        this.db
          .select({
            day: orderDay,
            paymentMethod: orders.paymentMethod,
            orderSource: orders.orderSource,
            net: sql<number>`coalesce(sum(${orderNet}), 0)`,
            count: sql<number>`count(*)`,
            total: sql<number>`coalesce(sum(coalesce(${orders.totalAmountCents}, 0)), 0)`,
            discount: sql<number>`coalesce(sum(coalesce(${orders.discountAmountCents}, 0)), 0)`,
            refund: sql<number>`coalesce(sum(${refund}), 0)`,
            // Per order, tax x (total - refund) / total, kept in [0, tax]; rounded per day below.
            tax: sql<number>`coalesce(sum(case when coalesce(${orders.totalAmountCents}, 0) > 0 then max(0, min(coalesce(${orders.taxAmountCents}, 0), coalesce(${orders.taxAmountCents}, 0) * 1.0 * (${orderNet}) / ${orders.totalAmountCents})) else 0 end), 0)`,
            service: sql<number>`coalesce(sum(coalesce(${orders.serviceChargeCents}, 0)), 0)`,
          })
          .from(orders)
          .where(orderScope)
          .groupBy(orderDay, orders.paymentMethod, orders.orderSource),
        this.db
          .select({
            day: orderDay,
            total: sql<number>`coalesce(sum(${orderItems.quantity} * coalesce(${lineCost}, 0)), 0)`,
            missing: sql<number>`count(distinct case when ${lineCost} is null then ${orderItems.menuItemId} end)`,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .leftJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
          .where(and(orderScope, ne(orderItems.status, "cancelled")))
          .groupBy(orderDay),
        // Worked shifts only: clock-out sets status completed and the hours.
        this.db
          .select({
            day: employeeSchedules.workDate,
            actualHours: employeeSchedules.actualHours,
            overtimeHours: employeeSchedules.overtimeHours,
            // Clock-out snapshot, else the employee's wage, else the template's.
            rate: sql<
              number | null
            >`coalesce(${employeeSchedules.hourlyRateCents}, ${users.hourlyRateCents}, ${shiftTemplates.hourlyRateCents})`,
            multiplier: shiftTemplates.overtimeMultiplier,
          })
          .from(employeeSchedules)
          .leftJoin(
            shiftTemplates,
            and(
              eq(shiftTemplates.id, employeeSchedules.shiftTemplateId),
              eq(shiftTemplates.restaurantId, employeeSchedules.restaurantId),
            ),
          )
          .leftJoin(users, eq(users.id, employeeSchedules.employeeId))
          .where(
            and(
              eq(employeeSchedules.restaurantId, restaurantId),
              between(employeeSchedules.workDate, from, to),
              eq(employeeSchedules.status, "completed"),
              isNotNull(employeeSchedules.clockOutTime),
              isNull(employeeSchedules.deletedAt),
              gt(employeeSchedules.actualHours, 0),
            ),
          ),
        this.db
          .select()
          .from(restaurantExpenses)
          .where(
            and(
              eq(restaurantExpenses.restaurantId, restaurantId),
              between(restaurantExpenses.businessDate, from, to),
              isNull(restaurantExpenses.deletedAt),
            ),
          )
          .orderBy(
            asc(restaurantExpenses.createdAt),
            asc(restaurantExpenses.id),
          ),
      ],
    );

    const byDay = new Map(datesBetween(from, to).map((d) => [d, emptyDay()]));
    const at = (day: string) => {
      let agg = byDay.get(day);
      if (!agg) byDay.set(day, (agg = emptyDay()));
      return agg;
    };
    // payment_method is free text: an own-key lookup keeps "constructor" & co. at 0.
    const fee = (
      base: number,
      map: Record<string, number>,
      key: string | null,
    ) =>
      key !== null && Object.hasOwn(map, key)
        ? roundToCurrencyCents((base * map[key]) / 10_000, currency)
        : 0;

    for (const g of orderGroups) {
      const d = at(g.day);
      const rates = versionAt(versions, g.day) ?? ZERO_RATES;
      d.orderCount += g.count;
      d.total += g.total;
      d.discount += g.discount;
      d.refund += g.refund;
      d.tax += g.tax;
      d.service += g.service;
      d.paymentFee += fee(g.net, rates.paymentFeeBps, g.paymentMethod);
      d.platformCommission += fee(
        g.net,
        rates.platformCommissionBps,
        g.orderSource,
      );
    }
    for (const d of byDay.values())
      d.tax = roundToCurrencyCents(d.tax, currency);
    for (const g of cogsGroups) {
      at(g.day).cogs += g.total;
      at(g.day).itemsMissingCost += g.missing;
    }
    for (const s of schedules) {
      const d = at(s.day);
      d.shifts += 1;
      if (s.rate == null) {
        d.shiftsMissingRate += 1;
        continue;
      }
      // overtimeHours = max(0, actualHours − scheduledHours), so it is part of actualHours.
      const overtime = Math.min(s.overtimeHours ?? 0, s.actualHours ?? 0);
      const regular = (s.actualHours ?? 0) - overtime;
      d.labor += roundToCurrencyCents(
        regular * s.rate + overtime * s.rate * (s.multiplier ?? 1.5),
        currency,
      );
    }
    for (const row of expenseRows)
      at(row.businessDate).expenses.push(toView(row));

    return { currency, versions, byDay };
  }

  async getDaily(restaurantId: string, date?: string): Promise<DailyPnl> {
    const shop = await this.loadRestaurant(restaurantId);
    const day = date ?? shop.today;
    const { currency, versions, byDay } = await this.aggregate(
      shop,
      restaurantId,
      day,
      day,
    );
    const d = byDay.get(day)!;

    const byCategory = new Map<string, number>();
    for (const item of d.expenses) {
      byCategory.set(
        item.category,
        (byCategory.get(item.category) ?? 0) + item.amountCents,
      );
    }

    // shortcut: lines sold before migration 0047 have no cost snapshot and fall back to the item's CURRENT cost, and shifts clocked out before 0048 cost at the CURRENT wage; upgrade = backfill if that matters.
    return {
      date: day,
      currency,
      revenue: {
        collectedCents: collected(d),
        grossSalesCents: d.total + d.discount,
        discountCents: d.discount,
        refundCents: d.refund,
        netRevenueCents: net(d),
        taxCents: d.tax,
        serviceChargeCents: d.service,
        orderCount: d.orderCount,
      },
      cogs: { totalCents: d.cogs, itemsMissingCost: d.itemsMissingCost },
      grossProfitCents: gross(d),
      fees: {
        paymentFeeCents: d.paymentFee,
        platformCommissionCents: d.platformCommission,
        configured: hasRates(versionAt(versions, day)),
      },
      labor: {
        costCents: d.labor,
        shifts: d.shifts,
        shiftsMissingRate: d.shiftsMissingRate,
      },
      expenses: {
        totalCents: expenseTotal(d),
        byCategory: [...byCategory].map(([category, amountCents]) => ({
          category,
          amountCents,
        })),
        items: d.expenses,
      },
      netProfitCents: netProfit(d),
    };
  }

  async getRange(
    restaurantId: string,
    from: string,
    to: string,
  ): Promise<RangePnl> {
    const span = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
    if (!(span >= 1 && span <= PNL_MAX_RANGE_DAYS)) {
      throw badRequest(
        `from must not be after to, and the range is at most ${PNL_MAX_RANGE_DAYS} days`,
        "PNL_RANGE_INVALID",
      );
    }
    const { currency, byDay } = await this.aggregate(
      await this.loadRestaurant(restaurantId),
      restaurantId,
      from,
      to,
    );
    const days = [...byDay].map(([date, d]) => ({
      date,
      orderCount: d.orderCount,
      netRevenueCents: net(d),
      cogsCents: d.cogs,
      grossProfitCents: gross(d),
      feesCents: d.paymentFee + d.platformCommission,
      laborCents: d.labor,
      expensesCents: expenseTotal(d),
      netProfitCents: netProfit(d),
    }));
    const totals = {
      orderCount: 0,
      netRevenueCents: 0,
      cogsCents: 0,
      grossProfitCents: 0,
      feesCents: 0,
      laborCents: 0,
      expensesCents: 0,
      netProfitCents: 0,
    };
    for (const row of days) {
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
        totals[key] += row[key];
      }
    }
    return { from, to, currency, days, totals };
  }

  /** The fixed methods first, then every other method this shop's orders were paid with. */
  private async paymentMethodKeys(restaurantId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ method: orders.paymentMethod })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          isNotNull(orders.paymentMethod),
        ),
      );
    const known = new Set<string>(PNL_PAYMENT_METHODS);
    const extras = rows
      .map((r) => r.method as string)
      .filter((m) => m !== "" && !known.has(m))
      .sort();
    return [...PNL_PAYMENT_METHODS, ...extras];
  }

  private withKeys(
    versions: RateVersion[],
    today: string,
    paymentMethods: string[],
  ): PnlRates {
    const current = versionAt(versions, today);
    const rates = current ?? ZERO_RATES;
    return {
      paymentFeeBps: {
        ...Object.fromEntries(paymentMethods.map((key) => [key, 0])),
        ...rates.paymentFeeBps,
      },
      platformCommissionBps: rates.platformCommissionBps,
      paymentMethods,
      platforms: PNL_PLATFORMS,
      effectiveFrom: current?.effectiveFrom ?? null,
      history: [...versions].reverse(),
    };
  }

  async getRates(restaurantId: string): Promise<PnlRates> {
    const [shop, paymentMethods] = await Promise.all([
      this.loadRestaurant(restaurantId),
      this.paymentMethodKeys(restaurantId),
    ]);
    return this.withKeys(
      readVersions(shop.settings),
      shop.today,
      paymentMethods,
    );
  }

  /**
   * Adds the version effective from `effectiveFrom` (default: the shop's
   * today), or replaces the one already on that date. The write is one
   * `json_set` that only applies while the stored pnlRates is still the one
   * read here, retried once, so two saves seconds apart cannot drop a version
   * and every other settings key stays as it is in the row at write time.
   */
  async setRates(
    restaurantId: string,
    input: RateSet & { effectiveFrom?: string },
  ): Promise<PnlRates> {
    const paymentMethods = await this.paymentMethodKeys(restaurantId);
    const allowed = new Set(paymentMethods);
    const unknown = Object.keys(input.paymentFeeBps).filter(
      (key) => !allowed.has(key),
    );
    if (unknown.length > 0) {
      throw badRequest(
        "Validation failed",
        "VALIDATION_ERROR",
        unknown.map((key) => ({
          field: `paymentFeeBps.${key}`,
          message: "Unknown payment method",
          code: "unrecognized_keys",
        })),
      );
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const shop = await this.loadRestaurant(restaurantId);
      const effectiveFrom = input.effectiveFrom ?? shop.today;
      if (!isRealDate(effectiveFrom) || effectiveFrom > shop.today) {
        throw badRequest(
          "effectiveFrom must be a real date that is not in the future",
          "PNL_RATES_DATE_INVALID",
        );
      }
      const versions = [
        ...readVersions(shop.settings).filter(
          (v) => v.effectiveFrom !== effectiveFrom,
        ),
        {
          effectiveFrom,
          ...normalizeRates({
            paymentFeeBps: input.paymentFeeBps,
            platformCommissionBps: input.platformCommissionBps,
          }),
        },
      ].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      if (versions.length > PNL_MAX_RATE_VERSIONS) {
        throw badRequest(
          `At most ${PNL_MAX_RATE_VERSIONS} rate versions are kept`,
          "PNL_RATES_TOO_MANY_VERSIONS",
        );
      }

      const rows = await this.db
        .update(restaurants)
        .set({
          settings: sql`json_set(coalesce(${restaurants.settings}, '{}'), '$.pnlRates', json(${JSON.stringify({ versions })}))`,
          updatedAt: new Date(this.now()),
        })
        .where(
          and(
            eq(restaurants.id, restaurantId),
            shop.pnlRatesJson === null
              ? sql`json_extract(${restaurants.settings}, '$.pnlRates') is null`
              : sql`json_extract(${restaurants.settings}, '$.pnlRates') = ${shop.pnlRatesJson}`,
          ),
        )
        .returning({ id: restaurants.id });
      if (rows.length > 0) {
        return this.withKeys(versions, shop.today, paymentMethods);
      }
    }
    // loadRestaurant 404s a missing shop, so a miss here is a concurrent save.
    throw conflict(
      "The rates were changed by another save; reload and try again",
      "PNL_RATES_CONFLICT",
    );
  }

  async createExpense(
    restaurantId: string,
    userId: string,
    input: {
      date: string;
      category: ExpenseCategory;
      amountCents: number;
      note?: string;
    },
  ): Promise<ExpenseView> {
    const shop = await this.loadRestaurant(restaurantId);
    const currency = currencyFromRestaurantSettings(
      shop.settings,
      restaurantId,
    );
    assertCurrencyAlignedCents(currency, [
      { field: "amountCents", cents: input.amountCents },
    ]);
    if (input.date > shop.today) {
      throw badRequest(
        "Expense date cannot be in the future",
        "EXPENSE_DATE_IN_FUTURE",
      );
    }

    const [row] = await this.db
      .insert(restaurantExpenses)
      .values({
        restaurantId,
        businessDate: input.date,
        category: input.category,
        amountCents: input.amountCents,
        note: input.note || null,
        createdBy: userId,
        createdAt: new Date(this.now()),
      })
      .returning();
    return toView(row);
  }

  /** Soft delete. False when missing, already deleted, or another shop's. */
  async deleteExpense(
    restaurantId: string,
    expenseId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .update(restaurantExpenses)
      .set({ deletedAt: new Date(this.now()) })
      .where(
        and(
          eq(restaurantExpenses.id, expenseId),
          eq(restaurantExpenses.restaurantId, restaurantId),
          isNull(restaurantExpenses.deletedAt),
        ),
      )
      .returning({ id: restaurantExpenses.id });
    return rows.length > 0;
  }
}

function toView(row: typeof restaurantExpenses.$inferSelect): ExpenseView {
  return {
    id: row.id,
    category: row.category,
    amountCents: row.amountCents,
    note: row.note,
    createdAtMs: row.createdAt.getTime(),
  };
}
