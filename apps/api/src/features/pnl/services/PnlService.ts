import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  businessTimezoneOffsetMinutes,
  dateFromUnixMs,
  menuItems,
  orderItems,
  orders,
  restaurantExpenses,
  restaurants,
  revenueReportableOrder,
  type ExpenseCategory,
} from "@makanmasak/database";
import { assertCurrencyAlignedCents } from "@makanmasak/utils";
import { badRequest, notFound } from "../../../shared/utils/api-error";
import {
  currencyFromRestaurantSettings,
  displayCurrencyFromRestaurantSettings,
} from "../../../shared/utils/restaurant-currency";
import type { Env } from "../../../types/env";

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
  expenses: {
    totalCents: number;
    byCategory: { category: string; amountCents: number }[];
    items: ExpenseView[];
  };
  netProfitCents: number;
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
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .get();
    if (!row) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
    const offsetMinutes = businessTimezoneOffsetMinutes(row.timezone);
    const today = new Date(this.now() + offsetMinutes * 60_000)
      .toISOString()
      .slice(0, 10);
    return { settings: row.settings, offsetMinutes, today };
  }

  async getDaily(restaurantId: string, date?: string): Promise<DailyPnl> {
    const shop = await this.loadRestaurant(restaurantId);
    const day = date ?? shop.today;
    // Same order set and day attribution (orders.created_at_ms cut at the shop
    // offset) as the analytics revenue report, so the two figures agree.
    const orderScope = and(
      eq(orders.restaurantId, restaurantId),
      revenueReportableOrder(),
      eq(dateFromUnixMs(orders.createdAt, shop.offsetMinutes), day),
    );

    const [rev] = await this.db
      .select({
        total: sql<number>`coalesce(sum(coalesce(${orders.totalAmountCents}, 0)), 0)`,
        discount: sql<number>`coalesce(sum(coalesce(${orders.discountAmountCents}, 0)), 0)`,
        // Clamped per order like analytics: a refund never takes an order below 0.
        refund: sql<number>`coalesce(sum(min(coalesce(${orders.refundAmountCents}, 0), coalesce(${orders.totalAmountCents}, 0))), 0)`,
        tax: sql<number>`coalesce(sum(coalesce(${orders.taxAmountCents}, 0)), 0)`,
        service: sql<number>`coalesce(sum(coalesce(${orders.serviceChargeCents}, 0)), 0)`,
        orderCount: sql<number>`count(${orders.id})`,
      })
      .from(orders)
      .where(orderScope);

    const [cogs] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${orderItems.quantity} * coalesce(${menuItems.costPriceCents}, 0)), 0)`,
        missing: sql<number>`count(distinct case when ${menuItems.costPriceCents} is null then ${orderItems.menuItemId} end)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .leftJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
      .where(and(orderScope, ne(orderItems.status, "cancelled")));

    const rows = await this.db
      .select()
      .from(restaurantExpenses)
      .where(
        and(
          eq(restaurantExpenses.restaurantId, restaurantId),
          eq(restaurantExpenses.businessDate, day),
          isNull(restaurantExpenses.deletedAt),
        ),
      )
      .orderBy(asc(restaurantExpenses.createdAt), asc(restaurantExpenses.id));

    const items = rows.map(toView);
    const byCategory = new Map<string, number>();
    for (const item of items) {
      byCategory.set(
        item.category,
        (byCategory.get(item.category) ?? 0) + item.amountCents,
      );
    }
    const expenseTotal = items.reduce((sum, item) => sum + item.amountCents, 0);

    const netRevenueCents = rev.total - rev.refund;
    // shortcut: cost is the menu item's CURRENT cost, not a snapshot at sale time; upgrade = snapshot unit cost on order_items.
    const cogsTotal = cogs.total;
    const grossProfitCents = netRevenueCents - cogsTotal;

    return {
      date: day,
      currency: displayCurrencyFromRestaurantSettings(shop.settings),
      revenue: {
        grossSalesCents: rev.total + rev.discount,
        discountCents: rev.discount,
        refundCents: rev.refund,
        netRevenueCents,
        taxCents: rev.tax,
        serviceChargeCents: rev.service,
        orderCount: rev.orderCount,
      },
      cogs: { totalCents: cogsTotal, itemsMissingCost: cogs.missing },
      grossProfitCents,
      expenses: {
        totalCents: expenseTotal,
        byCategory: [...byCategory].map(([category, amountCents]) => ({
          category,
          amountCents,
        })),
        items,
      },
      netProfitCents: grossProfitCents - expenseTotal,
    };
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
