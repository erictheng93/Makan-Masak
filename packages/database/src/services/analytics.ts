import {
  and,
  asc,
  avg,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  lt,
  ne,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import {
  categories,
  customers,
  menuItems,
  orderItems,
  orders,
  tables,
} from "../schema";
import {
  avgMoneyAmount,
  moneyAmountExpression,
  sumMoneyAmount,
} from "../utils/money-sql";
import {
  businessDateNow,
  dateFromUnixMs,
  strftimeFromUnixMs,
  strftimeNow,
  unixMsDiffMinutes,
} from "../utils/sql-time";
import {
  BusinessTimezoneResolver,
  PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES,
} from "../utils/business-timezone";
import { BaseService } from "./base";

/**
 * Status values that represent a "successfully completed" order for analytics.
 * The orders.status column never contains the literal string "completed" — older
 * queries used `eq(status, "completed")` and silently matched zero rows. Use this
 * array with `inArray(orders.status, ...)` for revenue / fulfillment analytics.
 */
const FULFILLED_ORDER_STATUSES: readonly string[] = [
  "paid",
  "delivered",
  "served",
];

type RevenueDataRow = {
  date: string;
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
};

export interface DateRange {
  dateFrom?: string;
  dateTo?: string;
}

export interface AnalyticsFilters extends DateRange {
  restaurantId?: string;
  groupBy?: "day" | "week" | "month" | "year";
  includeComparison?: boolean;
  limit?: number;
  metric?: "orders" | "revenue" | "avg_order_value" | "customer_count";
  period?: "daily" | "weekly" | "monthly" | "yearly";
  year?: string;
  month?: string;
}

export interface RevenueData {
  date: string;
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
  comparison?: {
    previousRevenue: number;
    growthRate: number;
  };
}

export interface OrderAnalytics {
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  averageOrderValue: number;
  totalRevenue: number;
  conversionRate: number;
  averagePreparationTime: number;
  popularTimeSlots: Array<{ hour: number; orderCount: number }>;
  /** Change against the equally long window immediately before this one, in
   * percent. Callers used to pair these figures with the dashboard summary's
   * month-over-month rates, so a year's revenue was shown beside a monthly
   * change (#312). Zero when there is no prior window or it earned nothing. */
  revenueGrowth: number;
  orderGrowth: number;
}

export interface MenuAnalytics {
  popularItems: Array<{
    itemId: number;
    itemName: string;
    categoryName: string;
    quantity: number;
    revenue: number;
    growthRate?: number;
  }>;
  categoryPerformance: Array<{
    categoryId: number;
    categoryName: string;
    quantity: number;
    revenue: number;
    itemCount: number;
  }>;
  lowPerformingItems: Array<{
    itemId: number;
    itemName: string;
    quantity: number;
    lastOrdered?: Date;
  }>;
}

export interface CustomerAnalytics {
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  averageOrdersPerCustomer: number;
  customerLifetimeValue: number;
  topCustomers: Array<{
    customerId: string;
    customerName: string;
    totalOrders: number;
    totalSpent: number;
  }>;
}

export interface TableAnalytics {
  tableUtilization: Array<{
    tableId: number;
    tableNumber: string;
    utilizationRate: number;
    averageOccupancyTime: number;
    totalRevenue: number;
  }>;
  peakHours: Array<{ hour: number; occupancyRate: number }>;
  averageTurnoverTime: number;
}

export interface DashboardData {
  summary: {
    todayRevenue: number;
    todayOrders: number;
    monthRevenue: number;
    monthOrders: number;
    growthRates: {
      revenueGrowth: number;
      orderGrowth: number;
    };
  };
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: number;
    customerInfo: (typeof orders.$inferSelect)["customerInfo"];
    tableNumber: string | null;
    createdAt: Date;
  }>;
  topSellingItems: Array<{
    itemId: number;
    itemName: string;
    quantity: number;
    revenue: number;
  }>;
  tableStatus: {
    occupied: number;
    available: number;
    total: number;
  };
}

export class AnalyticsService extends BaseService {
  private readonly businessTimezone = new BusinessTimezoneResolver(this.db);

  /**
   * The UTC offset this query's business days are cut at (#329).
   *
   * An unscoped filter aggregates across every tenant, so there is no single
   * shop's midnight to honour; the platform constant says that out loud
   * rather than quietly borrowing one restaurant's boundary for all of them.
   */
  private async offsetMinutesFor(restaurantId?: string): Promise<number> {
    return restaurantId
      ? this.businessTimezone.offsetMinutes(restaurantId)
      : PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES;
  }

  // 取得營收分析資料
  async getRevenueAnalytics(filters: AnalyticsFilters): Promise<RevenueData[]> {
    try {
      const {
        restaurantId,
        dateFrom,
        dateTo,
        groupBy = "day",
        includeComparison = false,
        limit = 30,
      } = filters;

      // 建構日期條件
      const conditions = [];
      if (restaurantId) {
        conditions.push(eq(orders.restaurantId, restaurantId));
      }
      if (dateFrom) {
        conditions.push(gte(orders.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        conditions.push(lte(orders.createdAt, new Date(dateTo)));
      }

      // 排除已取消訂單（計入所有已確認、製作中、已完成的營收）
      conditions.push(sql`${orders.status} != 'cancelled'`);

      // 生成日期分組 SQL
      const dateGroupSql = this.getDateGroupSQL(
        groupBy,
        await this.offsetMinutesFor(restaurantId),
      );

      // 查詢營收資料
      const revenueData = await this.db
        .select({
          date: sql<string>`${dateGroupSql}`,
          revenue: sumMoneyAmount(orders.totalAmountCents),
          orderCount: count(orders.id),
          averageOrderValue: avgMoneyAmount(orders.totalAmountCents),
        })
        .from(orders)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(sql`${dateGroupSql}`)
        .orderBy(sql`${dateGroupSql}`)
        .limit(limit);

      // 如果需要對比資料
      if (includeComparison) {
        return await this.addComparisonData(revenueData, filters);
      }

      return revenueData.map((item) => ({
        date: item.date,
        revenue: Number(item.revenue) || 0,
        orderCount: item.orderCount,
        averageOrderValue: Number(item.averageOrderValue) || 0,
      }));
    } catch (error) {
      this.handleError(error, "getRevenueAnalytics");
    }
  }

  // 取得訂單分析
  async getOrderAnalytics(filters: AnalyticsFilters): Promise<OrderAnalytics> {
    try {
      const { restaurantId, dateFrom, dateTo } = filters;

      const conditions = [];
      if (restaurantId) {
        conditions.push(eq(orders.restaurantId, restaurantId));
      }
      if (dateFrom) {
        conditions.push(gte(orders.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        conditions.push(lte(orders.createdAt, new Date(dateTo)));
      }

      // Two queries, not one. `totalOrders` counts every order in the window
      // because it is the denominator of the conversion rate below -- filtering
      // it to fulfilled orders as well would make that rate a set divided by
      // itself, permanently 100%.
      //
      // Revenue and average order value must exclude everything that was not
      // fulfilled. Without that filter the KPI cards counted cancelled orders
      // as income: NT$1,185 across 7 orders on a screen whose own revenue
      // report, chart and CSV export all said NT$570 across 4, the difference
      // being three cancellations (#312). The two queries immediately below
      // this one always did filter by status, so the distinction was known --
      // it was only the headline figures that missed it.
      const [orderStats] = await this.db
        .select({ totalOrders: count() })
        .from(orders)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const [revenueStats] = await this.db
        .select({
          totalRevenue: sumMoneyAmount(orders.totalAmountCents),
          averageOrderValue: avgMoneyAmount(orders.totalAmountCents),
        })
        .from(orders)
        .where(
          and(...conditions, inArray(orders.status, FULFILLED_ORDER_STATUSES)),
        );

      // 已完成訂單數
      const [{ completedOrders }] = await this.db
        .select({ completedOrders: count() })
        .from(orders)
        .where(
          and(...conditions, inArray(orders.status, FULFILLED_ORDER_STATUSES)),
        );

      // 已取消訂單數
      const [{ cancelledOrders }] = await this.db
        .select({ cancelledOrders: count() })
        .from(orders)
        .where(and(...conditions, eq(orders.status, "cancelled")));

      // 轉換率
      const conversionRate =
        orderStats.totalOrders > 0
          ? (completedOrders / orderStats.totalOrders) * 100
          : 0;

      // 平均準備時間
      const [{ averagePreparationTime }] = await this.db
        .select({
          averagePreparationTime: avg(orders.actualPrepTime),
        })
        .from(orders)
        .where(
          and(
            ...conditions,
            inArray(orders.status, FULFILLED_ORDER_STATUSES),
            sql`${orders.actualPrepTime} IS NOT NULL`,
          ),
        );

      // 熱門時段分析。
      //
      // The hour has to be cut at the shop's own offset, like every other
      // bucket in this file. Bucketing in UTC shifted a Taipei shop's whole
      // day by eight hours: measured against production on 2026-09-01, orders
      // placed at 09:48, 10:35, 10:54, 23:21, 23:38, 01:34 and 01:35 (+08)
      // came back as hours 1, 2, 2, 15, 15, 17, 17, and the dashboard told a
      // shop with no afternoon trade that its peak was 16:00-18:00 (#290).
      //
      // Resolved per restaurant rather than hardcoded to +8 -- that shortcut
      // is what #329 removed from these helpers, because it silently
      // mis-bucketed every shop that had chosen another zone and was shown
      // that choice back.
      const orderHour = strftimeFromUnixMs(
        "%H",
        orders.createdAt,
        await this.offsetMinutesFor(restaurantId),
      );
      const popularTimeSlots = await this.db
        .select({
          hour: sql<number>`CAST(${orderHour} AS INTEGER)`,
          orderCount: count(),
        })
        .from(orders)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(orderHour)
        .orderBy(desc(count()));

      // Growth against the window immediately before this one, the same
      // construction getFinancialReport uses. The alternative in place before
      // this was the dashboard summary's month-over-month rate, which is a
      // fixed window: selecting "this year" showed a year's revenue with a
      // monthly change beside it, describing two different spans in one card.
      const { revenueGrowth, orderGrowth } = await this.getPriorWindowGrowth(
        filters,
        Number(revenueStats.totalRevenue) || 0,
        orderStats.totalOrders,
      );

      return {
        totalOrders: orderStats.totalOrders,
        completedOrders,
        cancelledOrders,
        averageOrderValue: Number(revenueStats.averageOrderValue) || 0,
        totalRevenue: Number(revenueStats.totalRevenue) || 0,
        revenueGrowth,
        orderGrowth,
        conversionRate: Math.round(conversionRate * 100) / 100,
        averagePreparationTime: Number(averagePreparationTime) || 0,
        popularTimeSlots: popularTimeSlots.map((slot) => ({
          hour: slot.hour,
          orderCount: slot.orderCount,
        })),
      };
    } catch (error) {
      this.handleError(error, "getOrderAnalytics");
    }
  }

  /**
   * Revenue and order change against the equally long window ending where the
   * current one begins. Returns zeros when the caller gave no date range (the
   * window has no length, so "the period before" is undefined) or when the
   * prior window earned nothing — a percentage against zero is not a growth
   * rate, and reporting one as an enormous positive number is worse than
   * reporting none.
   */
  private async getPriorWindowGrowth(
    filters: AnalyticsFilters,
    currentRevenue: number,
    currentOrders: number,
  ): Promise<{ revenueGrowth: number; orderGrowth: number }> {
    const none = { revenueGrowth: 0, orderGrowth: 0 };
    if (!filters.dateFrom || !filters.dateTo) return none;

    const fromMs = new Date(filters.dateFrom).getTime();
    const toMs = new Date(filters.dateTo).getTime();
    const span = toMs - fromMs;
    if (!Number.isFinite(span) || span <= 0) return none;

    const priorConditions = [
      gte(orders.createdAt, new Date(fromMs - span)),
      lte(orders.createdAt, new Date(fromMs)),
    ];
    if (filters.restaurantId) {
      priorConditions.push(eq(orders.restaurantId, filters.restaurantId));
    }

    const [priorOrders] = await this.db
      .select({ total: count() })
      .from(orders)
      .where(and(...priorConditions));

    const [priorRevenue] = await this.db
      .select({ total: sumMoneyAmount(orders.totalAmountCents) })
      .from(orders)
      .where(
        and(
          ...priorConditions,
          inArray(orders.status, FULFILLED_ORDER_STATUSES),
        ),
      );

    const priorRevenueTotal = Number(priorRevenue.total) || 0;
    const priorOrderTotal = priorOrders.total;

    return {
      revenueGrowth:
        priorRevenueTotal > 0
          ? Math.round(
              ((currentRevenue - priorRevenueTotal) / priorRevenueTotal) *
                10000,
            ) / 100
          : 0,
      orderGrowth:
        priorOrderTotal > 0
          ? Math.round(
              ((currentOrders - priorOrderTotal) / priorOrderTotal) * 10000,
            ) / 100
          : 0,
    };
  }

  // 取得菜單分析
  async getMenuAnalytics(filters: AnalyticsFilters): Promise<MenuAnalytics> {
    try {
      const { restaurantId, dateFrom, dateTo, limit = 10 } = filters;

      const conditions = [];
      if (restaurantId) {
        conditions.push(eq(orders.restaurantId, restaurantId));
      }
      if (dateFrom) {
        conditions.push(gte(orders.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        conditions.push(lte(orders.createdAt, new Date(dateTo)));
      }
      // 排除已取消訂單
      conditions.push(sql`${orders.status} != 'cancelled'`);

      // 熱門菜品
      const popularItems = await this.db
        .select({
          itemId: orderItems.menuItemId,
          itemName: menuItems.name,
          categoryName: categories.name,
          quantity: sum(orderItems.quantity),
          revenue: sumMoneyAmount(orderItems.totalPriceCents),
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .leftJoin(categories, eq(menuItems.categoryId, categories.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(orderItems.menuItemId, menuItems.name, categories.name)
        .orderBy(desc(sum(orderItems.quantity)))
        .limit(limit);

      // 分類表現
      const categoryPerformance = await this.db
        .select({
          categoryId: categories.id,
          categoryName: categories.name,
          quantity: sum(orderItems.quantity),
          revenue: sumMoneyAmount(orderItems.totalPriceCents),
          itemCount: count(sql`DISTINCT ${menuItems.id}`),
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .innerJoin(categories, eq(menuItems.categoryId, categories.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(categories.id, categories.name)
        .orderBy(desc(sumMoneyAmount(orderItems.totalPriceCents)));

      // 表現差的菜品（近期很少被點）
      const lowPerformingItems = await this.db
        .select({
          itemId: menuItems.id,
          itemName: menuItems.name,
          quantity: sum(orderItems.quantity),
          lastOrdered: sql<Date>`MAX(${orders.createdAt})`,
        })
        .from(menuItems)
        .leftJoin(orderItems, eq(menuItems.id, orderItems.menuItemId))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .where(
          restaurantId ? eq(menuItems.restaurantId, restaurantId) : undefined,
        )
        .groupBy(menuItems.id, menuItems.name)
        .having(sql`COALESCE(SUM(${orderItems.quantity}), 0) < 5`)
        .orderBy(asc(sql`COALESCE(SUM(${orderItems.quantity}), 0)`))
        .limit(limit);

      return {
        popularItems: popularItems.map((item) => ({
          itemId: item.itemId,
          itemName: item.itemName,
          categoryName: item.categoryName || "Uncategorized",
          quantity: Number(item.quantity) || 0,
          revenue: Number(item.revenue) || 0,
        })),
        categoryPerformance: categoryPerformance.map((cat) => ({
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          quantity: Number(cat.quantity) || 0,
          revenue: Number(cat.revenue) || 0,
          itemCount: cat.itemCount,
        })),
        lowPerformingItems: lowPerformingItems.map((item) => ({
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: Number(item.quantity) || 0,
          lastOrdered: item.lastOrdered,
        })),
      };
    } catch (error) {
      this.handleError(error, "getMenuAnalytics");
    }
  }

  // 取得顧客分析
  async getCustomerAnalytics(
    filters: AnalyticsFilters,
  ): Promise<CustomerAnalytics> {
    try {
      const { restaurantId, dateFrom, dateTo, limit = 10 } = filters;

      const conditions = [];
      if (restaurantId) {
        conditions.push(eq(orders.restaurantId, restaurantId));
      }
      if (dateFrom) {
        conditions.push(gte(orders.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        conditions.push(lte(orders.createdAt, new Date(dateTo)));
      }

      // 總顧客數（有註冊的）
      //
      // `count()` here counted order rows, not customers, so a single customer
      // with 3 orders reported `totalCustomers: 3` and — since `newCustomers`
      // is correctly grouped by customer — `returningCustomers: 2` for a
      // restaurant that has served exactly one person. Latent while every
      // `customer_id` was NULL; #294 starts attributing orders, so it would
      // have begun showing owners a wrong number rather than a zero.
      const [{ totalCustomers }] = await this.db
        .select({ totalCustomers: countDistinct(orders.customerId) })
        .from(orders)
        .where(and(...conditions, sql`${orders.customerId} IS NOT NULL`));

      // 新顧客數（第一次下單）
      //
      // The bound value must be the epoch-ms integer, not a `Date`. Drizzle
      // encodes a `Date` for `orders.createdAt` because it knows that column is
      // `timestamp_ms`, but `MIN(...)` here is a raw `sql` expression with no
      // column type behind it, so the `Date` went to D1 unencoded and every
      // request carrying `dateFrom` failed with `Failed query` — a 500 on
      // GET /api/v1/analytics/customers for any date-filtered range, which is
      // what the dashboard always sends.
      //
      // Note the clause is currently redundant: `conditions` already restricts
      // `created_at_ms >= dateFrom`, so MIN over the surviving rows cannot be
      // smaller. It also means "new" is measured inside the window rather than
      // against the customer's first order ever — kept as-is here because
      // changing that is a metric definition change, not a bug fix.
      const newCustomers = await this.db
        .select({
          customerId: orders.customerId,
          firstOrder: sql<number>`MIN(${orders.createdAt})`,
        })
        .from(orders)
        .where(and(...conditions, sql`${orders.customerId} IS NOT NULL`))
        .groupBy(orders.customerId)
        .having(
          dateFrom
            ? gte(
                sql<number>`MIN(${orders.createdAt})`,
                new Date(dateFrom).getTime(),
              )
            : undefined,
        );

      // 回頭客數
      const returningCustomers = totalCustomers - newCustomers.length;

      // 平均每客戶訂單數
      //
      // These two rollups used to be raw `sql` subqueries that named their
      // columns as strings and applied no filter at all — not the restaurant,
      // not the date range — so they averaged across every tenant on the
      // platform while every sibling metric in the same payload was scoped.
      // That stayed invisible only because `orders.customer_id` was always
      // NULL in production; #294 starts attributing orders to logged-in
      // customers, which would have turned each restaurant's analytics page
      // into a platform-wide readout. Rebuilt as Drizzle subqueries so
      // `conditions` actually reaches them and the columns are checked at
      // compile time (CLAUDE.md's Layer 2 rule — raw string SQL is exactly how
      // the filter went missing unnoticed).
      const customerOrderCounts = this.db
        .select({
          customerId: orders.customerId,
          orderCount: count().as("order_count"),
        })
        .from(orders)
        .where(and(...conditions, sql`${orders.customerId} IS NOT NULL`))
        .groupBy(orders.customerId)
        .as("customer_order_counts");

      const [{ averageOrdersPerCustomer }] = await this.db
        .select({
          averageOrdersPerCustomer: avg(customerOrderCounts.orderCount),
        })
        .from(customerOrderCounts);

      // 顧客終身價值
      const customerTotals = this.db
        .select({
          customerId: orders.customerId,
          totalSpent: sumMoneyAmount(orders.totalAmountCents).as("total_spent"),
        })
        .from(orders)
        .where(
          and(
            ...conditions,
            sql`${orders.customerId} IS NOT NULL`,
            inArray(orders.status, FULFILLED_ORDER_STATUSES),
          ),
        )
        .groupBy(orders.customerId)
        .as("customer_totals");

      const [{ customerLifetimeValue }] = await this.db
        .select({
          customerLifetimeValue: avg(customerTotals.totalSpent),
        })
        .from(customerTotals);

      // 頂級客戶
      const topCustomers = await this.db
        .select({
          customerId: orders.customerId,
          customerName: customers.displayName,
          totalOrders: count(),
          totalSpent: sumMoneyAmount(orders.totalAmountCents),
        })
        .from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(
          and(...conditions, inArray(orders.status, FULFILLED_ORDER_STATUSES)),
        )
        .groupBy(orders.customerId, customers.displayName)
        .orderBy(desc(sumMoneyAmount(orders.totalAmountCents)))
        .limit(limit);

      return {
        totalCustomers,
        newCustomers: newCustomers.length,
        returningCustomers,
        averageOrdersPerCustomer: Number(averageOrdersPerCustomer) || 0,
        customerLifetimeValue: Number(customerLifetimeValue) || 0,
        topCustomers: topCustomers.map((customer) => ({
          customerId: customer.customerId!,
          customerName: customer.customerName,
          totalOrders: customer.totalOrders,
          totalSpent: Number(customer.totalSpent) || 0,
        })),
      };
    } catch (error) {
      this.handleError(error, "getCustomerAnalytics");
    }
  }

  // 取得桌子分析
  async getTableAnalytics(filters: AnalyticsFilters): Promise<TableAnalytics> {
    try {
      const { restaurantId, dateFrom, dateTo } = filters;

      const conditions = [];
      if (restaurantId) {
        conditions.push(eq(orders.restaurantId, restaurantId));
      }
      if (dateFrom) {
        conditions.push(gte(orders.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        conditions.push(lte(orders.createdAt, new Date(dateTo)));
      }

      const tableConditions = [isNull(tables.deletedAt)];
      if (restaurantId) {
        tableConditions.push(eq(tables.restaurantId, restaurantId));
      }
      const tableCountCondition = restaurantId
        ? sql`restaurant_id = ${restaurantId} AND deleted_at_ms IS NULL`
        : sql`deleted_at_ms IS NULL`;

      // 桌子使用率
      const tableUtilization = await this.db
        .select({
          tableId: tables.id,
          tableNumber: tables.number,
          utilizationRate: sql<number>`
            CASE 
              WHEN ${tables.totalUsage} > 0 
              THEN ROUND((${tables.totalUsage} * ${tables.averageOccupancyMinutes}) / (24.0 * 60), 2)
              ELSE 0 
            END
          `,
          averageOccupancyTime: tables.averageOccupancyMinutes,
          totalRevenue: sumMoneyAmount(orders.totalAmountCents),
        })
        .from(tables)
        .leftJoin(orders, eq(tables.id, orders.tableId))
        .where(and(...tableConditions))
        .groupBy(
          tables.id,
          tables.number,
          tables.averageOccupancyMinutes,
          tables.totalUsage,
        )
        .orderBy(desc(sumMoneyAmount(orders.totalAmountCents)));

      // 高峰時段. Same business-hour boundary as every other bucket here --
      // see the note in getOrderAnalytics for what UTC bucketing did to a
      // Taipei shop's numbers (#290).
      //
      // On the denominator: `tableCountCondition` counts tables that are not
      // soft-deleted, and deliberately does NOT also require `is_active`. That
      // differs from getDashboardData's tableStatus on purpose. tableStatus is
      // a live snapshot whose three figures must satisfy
      // total = occupied + available, so it counts only tables that can be
      // seated right now. This is a historical window, and `is_active` is a
      // current flag: a table parked in 維護中 today would otherwise vanish
      // from the denominator of a month it was serving customers throughout,
      // inflating that month's occupancy after the fact. What does matter is
      // that the two halves agree, and they do -- the numerator's join is
      // filtered by `isNull(tables.deletedAt)` and nothing more, so the rate
      // cannot exceed 100%.
      const peakHourExpr = strftimeFromUnixMs(
        "%H",
        orders.createdAt,
        await this.offsetMinutesFor(restaurantId),
      );
      const peakHours = await this.db
        .select({
          hour: sql<number>`CAST(${peakHourExpr} AS INTEGER)`,
          occupancyRate: sql<number>`
            ROUND(
              COUNT(DISTINCT ${orders.tableId}) * 100.0 /
              (SELECT COUNT(*) FROM tables WHERE ${tableCountCondition}),
              2
            )
          `,
        })
        .from(orders)
        .innerJoin(tables, eq(orders.tableId, tables.id))
        .where(and(...conditions, isNull(tables.deletedAt)))
        .groupBy(peakHourExpr)
        .orderBy(sql`CAST(${peakHourExpr} AS INTEGER)`);

      // 平均翻台時間
      const [{ averageTurnoverTime }] = await this.db
        .select({
          averageTurnoverTime: avg(tables.averageOccupancyMinutes),
        })
        .from(tables)
        .where(and(...tableConditions));

      return {
        tableUtilization: tableUtilization.map((table) => ({
          tableId: table.tableId,
          tableNumber: table.tableNumber,
          utilizationRate: Number(table.utilizationRate) || 0,
          averageOccupancyTime: table.averageOccupancyTime || 0,
          totalRevenue: Number(table.totalRevenue) || 0,
        })),
        peakHours: peakHours.map((hour) => ({
          hour: hour.hour,
          occupancyRate: Number(hour.occupancyRate) || 0,
        })),
        averageTurnoverTime: Number(averageTurnoverTime) || 0,
      };
    } catch (error) {
      this.handleError(error, "getTableAnalytics");
    }
  }

  // 取得儀表板資料
  async getDashboardData(restaurantId: string): Promise<DashboardData> {
    try {
      // If no restaurantId provided (e.g., system admin), return empty data
      if (!restaurantId) {
        return {
          summary: {
            todayRevenue: 0,
            todayOrders: 0,
            monthRevenue: 0,
            monthOrders: 0,
            growthRates: {
              revenueGrowth: 0,
              orderGrowth: 0,
            },
          },
          recentOrders: [],
          topSellingItems: [],
          tableStatus: {
            occupied: 0,
            available: 0,
            total: 0,
          },
        };
      }

      // One offset for every bucket in this dashboard: the day, the month and
      // the month it is compared against all have to be cut at the same
      // midnight, or the comparison is between two different calendars.
      const offsetMinutes = await this.offsetMinutesFor(restaurantId);
      const orderBusinessDate = dateFromUnixMs(orders.createdAt, offsetMinutes);
      const orderBusinessMonth = strftimeFromUnixMs(
        "%Y-%m",
        orders.createdAt,
        offsetMinutes,
      );
      const currentBusinessMonth = strftimeNow("%Y-%m", offsetMinutes);
      const previousBusinessMonth = strftimeNow(
        "%Y-%m",
        offsetMinutes,
        "start of month",
        "-1 month",
      );

      // 訂單數計非取消訂單；營收計已結帳訂單 (paid / delivered / served)
      // 先前用 eq(status, "completed") 一直過不了，因為 orders 表實際
      // 狀態是 pending/confirmed/preparing/ready/delivered/served/paid/cancelled，
      // 根本沒有 "completed"，所以 dashboard 永遠顯示 0。

      // 今日營收和訂單數
      const todayStatsQuery = this.db
        .select({
          revenue: sumMoneyAmount(orders.totalAmountCents),
          orderCount: count(),
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orderBusinessDate, businessDateNow(offsetMinutes)),
            ne(orders.status, "cancelled"),
          ),
        );

      const todayRevenueQuery = this.db
        .select({
          revenue: sumMoneyAmount(orders.totalAmountCents),
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orderBusinessDate, businessDateNow(offsetMinutes)),
            inArray(orders.status, FULFILLED_ORDER_STATUSES),
          ),
        );

      // 本月營收和訂單數
      const monthStatsQuery = this.db
        .select({
          revenue: sumMoneyAmount(orders.totalAmountCents),
          orderCount: count(),
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orderBusinessMonth, currentBusinessMonth),
            ne(orders.status, "cancelled"),
          ),
        );

      const monthRevenueQuery = this.db
        .select({
          revenue: sumMoneyAmount(orders.totalAmountCents),
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orderBusinessMonth, currentBusinessMonth),
            inArray(orders.status, FULFILLED_ORDER_STATUSES),
          ),
        );

      // 上月資料（用於計算成長率）
      const lastMonthStatsQuery = this.db
        .select({
          revenue: sumMoneyAmount(orders.totalAmountCents),
          orderCount: count(),
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orderBusinessMonth, previousBusinessMonth),
            ne(orders.status, "cancelled"),
          ),
        );

      const lastMonthRevenueQuery = this.db
        .select({
          revenue: sumMoneyAmount(orders.totalAmountCents),
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orderBusinessMonth, previousBusinessMonth),
            inArray(orders.status, FULFILLED_ORDER_STATUSES),
          ),
        );

      // 最近訂單
      const recentOrdersQuery = this.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          totalAmount: moneyAmountExpression(orders.totalAmountCents),
          customerInfo: orders.customerInfo,
          tableNumber: tables.number,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .leftJoin(tables, eq(orders.tableId, tables.id))
        .where(eq(orders.restaurantId, restaurantId))
        .orderBy(desc(orders.createdAt))
        .limit(10);

      // 熱銷商品 — 計非取消訂單即可（不限定 paid，否則剛出餐的熱賣品都會被排除）
      const topSellingItemsQuery = this.db
        .select({
          itemId: menuItems.id,
          itemName: menuItems.name,
          quantity: sum(orderItems.quantity),
          revenue: sumMoneyAmount(orderItems.totalPriceCents),
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orderBusinessMonth, currentBusinessMonth),
            ne(orders.status, "cancelled"),
          ),
        )
        .groupBy(menuItems.id, menuItems.name)
        .orderBy(desc(sum(orderItems.quantity)))
        .limit(5);

      // 桌子狀態
      // The owner overview renders this as `occupied/total` with an "N 可用"
      // subtitle, so the three numbers have to satisfy total = occupied +
      // available. That only holds if every one of them counts the same
      // population: tables that exist (not soft-deleted) *and* can actually be
      // seated (is_active). A table parked in 維護中 sets is_active = 0 without
      // being deleted (TableSetupTab writes `isActive: status !== "maintenance"`),
      // and leaving it in `total` alone reproduces the very symptom #272 was
      // filed about — "0/4" for a shop with one usable table.
      const tableStatusQuery = this.db
        .select({
          total: count(),
          occupied: sum(
            sql<number>`CASE WHEN ${tables.isOccupied} THEN 1 ELSE 0 END`,
          ),
          available: sum(
            sql<number>`CASE WHEN NOT ${tables.isOccupied} THEN 1 ELSE 0 END`,
          ),
        })
        .from(tables)
        .where(
          and(
            eq(tables.restaurantId, restaurantId),
            isNull(tables.deletedAt),
            eq(tables.isActive, true),
          ),
        );

      // 九筆查詢彼此獨立（沒有任何一筆吃另一筆的結果），所以走一次 db.batch()
      // 而不是九個 await。D1 主庫在 APAC、Worker 卻跑在使用者落點的 colo，
      // 單一 `SELECT 1` 實測 113ms（`/api/v1/system/health` 自報），序列化的話
      // 光這個函式就是九個來回。batch 把它壓成一次。
      const [
        [todayStats],
        [todayRevenueRow],
        [monthStats],
        [monthRevenueRow],
        [lastMonthStats],
        [lastMonthRevenueRow],
        recentOrders,
        topSellingItems,
        [tableStatus],
      ] = await this.db.batch([
        todayStatsQuery,
        todayRevenueQuery,
        monthStatsQuery,
        monthRevenueQuery,
        lastMonthStatsQuery,
        lastMonthRevenueQuery,
        recentOrdersQuery,
        topSellingItemsQuery,
        tableStatusQuery,
      ]);

      // 計算成長率 — 營收成長率用已結帳的營收，訂單成長率用非取消訂單數
      const revenueGrowth = this.calculateGrowthRate(
        Number(monthRevenueRow?.revenue) || 0,
        Number(lastMonthRevenueRow?.revenue) || 0,
      );
      const orderGrowth = this.calculateGrowthRate(
        monthStats.orderCount,
        lastMonthStats.orderCount,
      );

      return {
        summary: {
          todayRevenue: Number(todayRevenueRow?.revenue) || 0,
          todayOrders: todayStats.orderCount,
          monthRevenue: Number(monthRevenueRow?.revenue) || 0,
          monthOrders: monthStats.orderCount,
          growthRates: {
            revenueGrowth,
            orderGrowth,
          },
        },
        recentOrders: recentOrders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalAmount: order.totalAmount,
          customerInfo: order.customerInfo,
          tableNumber: order.tableNumber,
          createdAt: order.createdAt,
        })),
        topSellingItems: topSellingItems.map((item) => ({
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: Number(item.quantity) || 0,
          revenue: Number(item.revenue) || 0,
        })),
        tableStatus: {
          occupied: Number(tableStatus.occupied) || 0,
          available: Number(tableStatus.available) || 0,
          total: tableStatus.total,
        },
      };
    } catch (error) {
      this.handleError(error, "getDashboardData");
    }
  }

  // 輔助函數：生成日期分組 SQL
  private getDateGroupSQL(groupBy: string, offsetMinutes: number) {
    switch (groupBy) {
      case "day":
        return dateFromUnixMs(orders.createdAt, offsetMinutes);
      case "week":
        return strftimeFromUnixMs("%Y-W%W", orders.createdAt, offsetMinutes);
      case "month":
        return strftimeFromUnixMs("%Y-%m", orders.createdAt, offsetMinutes);
      case "year":
        return strftimeFromUnixMs("%Y", orders.createdAt, offsetMinutes);
      default:
        return dateFromUnixMs(orders.createdAt, offsetMinutes);
    }
  }

  // 輔助函數：計算成長率
  private calculateGrowthRate(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100 * 100) / 100;
  }

  // 輔助函數：添加對比資料
  private async addComparisonData(
    revenueData: RevenueDataRow[],
    filters: AnalyticsFilters,
  ): Promise<RevenueData[]> {
    const comparisonByDate = await this.getComparisonRevenueByDate(
      filters,
      revenueData,
    );

    return revenueData.map((item) => ({
      date: item.date,
      revenue: Number(item.revenue) || 0,
      orderCount: item.orderCount,
      averageOrderValue: Number(item.averageOrderValue) || 0,
      comparison: {
        previousRevenue: comparisonByDate.get(item.date) ?? 0,
        growthRate: this.calculateGrowthRate(
          Number(item.revenue) || 0,
          comparisonByDate.get(item.date) ?? 0,
        ),
      },
    }));
  }

  /**
   * Sum the tax already carried inside the order totals.
   *
   * Scoped to the buckets `revenueData` actually holds rather than to the raw
   * date filter: getRevenueAnalytics caps its result at `limit` buckets, so a
   * range-wide sum would subtract tax from days the revenue total never
   * counted and push netRevenue below the truth.
   */
  private async getTaxTotal(
    filters: AnalyticsFilters,
    revenueData: RevenueData[],
  ): Promise<number> {
    if (revenueData.length === 0) return 0;

    const { restaurantId, dateFrom, dateTo, groupBy = "day" } = filters;
    const conditions = [];
    if (restaurantId) {
      conditions.push(eq(orders.restaurantId, restaurantId));
    }
    if (dateFrom) {
      conditions.push(gte(orders.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      conditions.push(lte(orders.createdAt, new Date(dateTo)));
    }
    // Same population as the revenue query it is netted against.
    conditions.push(sql`${orders.status} != 'cancelled'`);

    const dateGroupSql = this.getDateGroupSQL(
      groupBy,
      await this.offsetMinutesFor(restaurantId),
    );
    conditions.push(
      inArray(
        sql<string>`${dateGroupSql}`,
        revenueData.map((item) => item.date),
      ),
    );

    const [row] = await this.db
      .select({ tax: sumMoneyAmount(orders.taxAmountCents) })
      .from(orders)
      .where(and(...conditions));

    return Number(row?.tax) || 0;
  }

  private async getComparisonRevenueByDate(
    filters: AnalyticsFilters,
    revenueData: RevenueDataRow[],
  ): Promise<Map<string, number>> {
    if (revenueData.length === 0) return new Map();

    const {
      restaurantId,
      dateFrom,
      dateTo,
      groupBy = "day",
      limit = 30,
    } = filters;
    const conditions = [];
    if (restaurantId) {
      conditions.push(eq(orders.restaurantId, restaurantId));
    }
    conditions.push(sql`${orders.status} != 'cancelled'`);

    if (dateFrom && dateTo) {
      const dateRange = this.getPreviousDateRange(dateFrom, dateTo);
      if (dateRange) {
        conditions.push(gte(orders.createdAt, dateRange.dateFrom));
        conditions.push(lt(orders.createdAt, dateRange.dateToExclusive));

        const shiftedDateGroupSql = this.getShiftedDateGroupSQL(
          groupBy,
          dateRange.spanMs,
          await this.offsetMinutesFor(restaurantId),
        );

        const comparisonData = await this.db
          .select({
            date: sql<string>`${shiftedDateGroupSql}`,
            revenue: sumMoneyAmount(orders.totalAmountCents),
          })
          .from(orders)
          .where(and(...conditions))
          .groupBy(sql`${shiftedDateGroupSql}`)
          .orderBy(sql`${shiftedDateGroupSql}`)
          .limit(limit);

        return new Map(
          comparisonData.map((item) => [item.date, Number(item.revenue) || 0]),
        );
      }
    }

    const dateGroupSql = this.getDateGroupSQL(
      groupBy,
      await this.offsetMinutesFor(restaurantId),
    );
    const priorBuckets = revenueData.map((item) =>
      this.getPreviousBucketDate(item.date, groupBy),
    );
    conditions.push(inArray(sql<string>`${dateGroupSql}`, priorBuckets));

    const comparisonData = await this.db
      .select({
        date: sql<string>`${dateGroupSql}`,
        revenue: sumMoneyAmount(orders.totalAmountCents),
      })
      .from(orders)
      .where(and(...conditions))
      .groupBy(sql`${dateGroupSql}`)
      .orderBy(sql`${dateGroupSql}`)
      .limit(limit);

    const priorRevenueByDate = new Map(
      comparisonData.map((item) => [item.date, Number(item.revenue) || 0]),
    );

    return new Map(
      revenueData.map((item) => [
        item.date,
        priorRevenueByDate.get(
          this.getPreviousBucketDate(item.date, groupBy),
        ) ?? 0,
      ]),
    );
  }

  private getPreviousDateRange(
    dateFrom: string,
    dateTo: string,
  ): { dateFrom: Date; dateToExclusive: Date; spanMs: number } | undefined {
    const fromMs = new Date(dateFrom).getTime();
    const toMs = new Date(dateTo).getTime();
    const span = toMs - fromMs;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || span < 0) {
      return undefined;
    }

    return {
      dateFrom: new Date(fromMs - span),
      dateToExclusive: new Date(fromMs),
      spanMs: span,
    };
  }

  private getShiftedDateGroupSQL(
    groupBy: NonNullable<AnalyticsFilters["groupBy"]>,
    shiftMs: number,
    offsetMinutes: number,
  ): SQL {
    const shiftedDateSql = sql`(${orders.createdAt} + ${shiftMs})`;

    switch (groupBy) {
      case "day":
        return dateFromUnixMs(shiftedDateSql, offsetMinutes);
      case "week":
        return strftimeFromUnixMs("%Y-W%W", shiftedDateSql, offsetMinutes);
      case "month":
        return strftimeFromUnixMs("%Y-%m", shiftedDateSql, offsetMinutes);
      case "year":
        return strftimeFromUnixMs("%Y", shiftedDateSql, offsetMinutes);
    }
  }

  private getPreviousBucketDate(
    value: string,
    groupBy: NonNullable<AnalyticsFilters["groupBy"]>,
  ): string {
    const date = this.parseAnalyticsDate(value);

    switch (groupBy) {
      case "day":
        date.setUTCDate(date.getUTCDate() - 1);
        break;
      case "week":
        date.setUTCDate(date.getUTCDate() - 7);
        break;
      case "month":
        date.setUTCMonth(date.getUTCMonth() - 1);
        break;
      case "year":
        date.setUTCFullYear(date.getUTCFullYear() - 1);
        break;
    }

    return this.formatAnalyticsDate(date, groupBy);
  }

  // 取得效能分析 (Referenced in API routes)
  async getPerformanceAnalytics(filters: AnalyticsFilters): Promise<{
    orderProcessingTime: number;
    kitchenEfficiency: number;
    tableUtilization: number;
    customerSatisfaction: number;
    trends: Array<{
      date: string;
      revenue: number;
      orderCount: number;
      averageOrderValue: number;
    }>;
  }> {
    try {
      const { restaurantId, dateFrom, dateTo } = filters;
      const conditions = [];
      if (restaurantId) conditions.push(eq(orders.restaurantId, restaurantId));
      if (dateFrom) conditions.push(gte(orders.createdAt, new Date(dateFrom)));
      if (dateTo) conditions.push(lte(orders.createdAt, new Date(dateTo)));

      const performanceData = await this.getPerformanceReport(restaurantId!, {
        dateFrom,
        dateTo,
      });
      const revenueData = await this.getRevenueAnalytics({
        ...filters,
        restaurantId,
        groupBy: filters.groupBy ?? "day",
      });

      return {
        ...performanceData,
        trends: revenueData.map((item) => ({
          date: item.date,
          revenue: item.revenue,
          orderCount: item.orderCount,
          averageOrderValue: item.averageOrderValue,
        })),
      };
    } catch (error) {
      this.handleError(error, "getPerformanceAnalytics");
    }
  }

  // 取得實時儀表板資料 (Referenced in API routes)
  //
  // `dashboard` 是這裡本來就要查的那份 DashboardData，順手回傳出去。
  // 呼叫端（AnalyticsService.getRealtimeData）以前會自己再查一次同一份資料，
  // 等於整組九筆查詢跑兩遍。回傳它就不必再查。
  async getRealtimeDashboard(restaurantId: string): Promise<{
    activeOrders: number;
    kitchenQueue: number;
    averageWaitTime: number;
    occupiedTables: number;
    todayRevenue: number;
    dashboard: DashboardData;
    alerts: Array<{ type: string; severity: string; message: string }>;
  }> {
    try {
      // 活躍訂單數
      const activeOrdersQuery = this.db
        .select({ activeOrders: count() })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            sql`${orders.status} IN ('confirmed', 'preparing', 'ready')`,
          ),
        );

      // 廚房隊列
      const kitchenQueueQuery = this.db
        .select({ kitchenQueue: count() })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.status, "preparing"),
          ),
        );

      // 平均等待時間 (基於最近完成的訂單)
      const averageWaitTimeQuery = this.db
        .select({
          averageWaitTime: avg(
            sql<number>`
              CASE
                WHEN ${orders.readyAt} IS NOT NULL AND ${orders.createdAt} IS NOT NULL
                THEN ${unixMsDiffMinutes(orders.readyAt, orders.createdAt)}
                ELSE NULL
              END
            `,
          ),
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            inArray(orders.status, FULFILLED_ORDER_STATUSES),
            gte(orders.createdAt, sql`(unixepoch('now', '-2 hours') * 1000)`),
          ),
        );

      // dashboard 與這三筆彼此不相依，兩批同時發出去而不是排隊等。
      const [
        dashboardData,
        [[{ activeOrders }], [{ kitchenQueue }], [{ averageWaitTime }]],
      ] = await Promise.all([
        this.getDashboardData(restaurantId),
        this.db.batch([
          activeOrdersQuery,
          kitchenQueueQuery,
          averageWaitTimeQuery,
        ]),
      ]);

      return {
        dashboard: dashboardData,
        activeOrders,
        kitchenQueue,
        averageWaitTime: Number(averageWaitTime) || 0,
        occupiedTables: dashboardData.tableStatus.occupied,
        todayRevenue: dashboardData.summary.todayRevenue,
        alerts: [
          ...(Number(averageWaitTime) > 30
            ? [
                {
                  type: "performance",
                  severity: "warning",
                  message: "Average wait time is above 30 minutes",
                },
              ]
            : []),
          ...(kitchenQueue > 10
            ? [
                {
                  type: "operations",
                  severity: "warning",
                  message: "Kitchen queue has more than 10 active orders",
                },
              ]
            : []),
          ...(dashboardData.tableStatus.total > 0 &&
          dashboardData.tableStatus.occupied / dashboardData.tableStatus.total >
            0.9
            ? [
                {
                  type: "capacity",
                  severity: "info",
                  message: "Table occupancy is above 90%",
                },
              ]
            : []),
        ],
      };
    } catch (error) {
      this.handleError(error, "getRealtimeDashboard");
    }
  }

  // 取得詳細效能分析 (Referenced in API routes)
  async getDetailedPerformanceAnalytics(filters: AnalyticsFilters): Promise<{
    overview: {
      totalOrders: number;
      completionRate: number;
      averageOrderValue: number;
    };
    kitchenMetrics: {
      averagePreparationTime: number;
      efficiency: number;
    };
    serviceMetrics: {
      orderProcessingTime: number;
      tableUtilization: number;
    };
    customerMetrics: {
      satisfaction: number;
      totalCustomers: number;
    };
    recommendations: string[];
  }> {
    try {
      const { restaurantId } = filters;
      const performanceData = await this.getPerformanceReport(
        restaurantId!,
        filters,
      );
      const orderAnalytics = await this.getOrderAnalytics(filters);
      const customerAnalytics = await this.getCustomerAnalytics(filters);

      return {
        overview: {
          totalOrders: orderAnalytics.totalOrders,
          completionRate: orderAnalytics.conversionRate,
          averageOrderValue: orderAnalytics.averageOrderValue,
        },
        kitchenMetrics: {
          averagePreparationTime: orderAnalytics.averagePreparationTime,
          efficiency: performanceData.kitchenEfficiency,
        },
        serviceMetrics: {
          orderProcessingTime: performanceData.orderProcessingTime,
          tableUtilization: performanceData.tableUtilization,
        },
        customerMetrics: {
          satisfaction: performanceData.customerSatisfaction,
          totalCustomers: customerAnalytics.totalCustomers,
        },
        recommendations: performanceData.recommendations,
      };
    } catch (error) {
      this.handleError(error, "getDetailedPerformanceAnalytics");
    }
  }

  // 取得店主儀表板資料 (Referenced in API routes)
  async getOwnerDashboard(
    restaurantId: string,
    filters: AnalyticsFilters,
  ): Promise<{
    financialSummary: {
      monthRevenue: number;
      todayRevenue: number;
      revenueGrowth: number;
      averageOrderValue: number;
    };
    operationalMetrics: {
      totalOrders: number;
      tableUtilization: number;
      occupiedTables: number;
      availableTables: number;
    };
    staffPerformance: {
      averageServiceTime: number;
      staffEfficiency: number;
    };
    customerInsights: {
      totalCustomers: number;
      newCustomers: number;
      returningCustomers: number;
      customerLifetimeValue: number;
    };
    businessTrends: RevenueData[];
  }> {
    try {
      const dashboardData = await this.getDashboardData(restaurantId);
      const revenueData = await this.getRevenueAnalytics({
        ...filters,
        restaurantId,
      });
      const customerAnalytics = await this.getCustomerAnalytics({
        ...filters,
        restaurantId,
      });
      const tableAnalytics = await this.getTableAnalytics({
        ...filters,
        restaurantId,
      });

      return {
        financialSummary: {
          monthRevenue: dashboardData.summary.monthRevenue,
          todayRevenue: dashboardData.summary.todayRevenue,
          revenueGrowth: dashboardData.summary.growthRates.revenueGrowth,
          averageOrderValue: revenueData[0]?.averageOrderValue || 0,
        },
        operationalMetrics: {
          totalOrders: dashboardData.summary.monthOrders,
          tableUtilization: tableAnalytics.averageTurnoverTime,
          occupiedTables: dashboardData.tableStatus.occupied,
          availableTables: dashboardData.tableStatus.available,
        },
        staffPerformance: {
          // Staff-level tracking is not present in the current schema.
          averageServiceTime: 0,
          staffEfficiency: 0,
        },
        customerInsights: {
          totalCustomers: customerAnalytics.totalCustomers,
          newCustomers: customerAnalytics.newCustomers,
          returningCustomers: customerAnalytics.returningCustomers,
          customerLifetimeValue: customerAnalytics.customerLifetimeValue,
        },
        businessTrends: revenueData.slice(0, 30), // Last 30 data points
      };
    } catch (error) {
      this.handleError(error, "getOwnerDashboard");
    }
  }

  // 取得財務報告 (Referenced in API routes)
  async getFinancialReport(filters: AnalyticsFilters): Promise<{
    summary: {
      totalRevenue: number;
      totalOrders: number;
      averageOrderValue: number;
      taxAmount: number;
      netRevenue: number;
      growthRate: number;
    };
    revenueBreakdown: {
      byDay: RevenueData[];
      byCategory: MenuAnalytics["categoryPerformance"];
      topItems: MenuAnalytics["popularItems"];
    };
    expenseAnalysis: {
      totalExpenses: number;
      expenseCategories: unknown[];
    };
    profitability: {
      grossProfit: number;
      netProfit: number;
      profitMargin: number;
    };
    projections: Array<{
      date: string;
      projectedRevenue: number;
      basis: string;
    }>;
  }> {
    try {
      const revenueData = await this.getRevenueAnalytics(filters);
      const menuAnalytics = await this.getMenuAnalytics(filters);

      const totalRevenue = revenueData.reduce(
        (sum, item) => sum + item.revenue,
        0,
      );
      const totalOrders = revenueData.reduce(
        (sum, item) => sum + item.orderCount,
        0,
      );
      const projections = this.buildRevenueProjections(revenueData);
      const taxAmount = await this.getTaxTotal(filters, revenueData);

      // Period-over-period growth: build a same-length prior window
      // immediately preceding the current one and compare revenue.
      let growthRate = 0;
      if (filters.dateFrom && filters.dateTo) {
        const fromMs = new Date(filters.dateFrom).getTime();
        const toMs = new Date(filters.dateTo).getTime();
        const span = toMs - fromMs;
        if (span > 0) {
          const priorRevenue = await this.getRevenueAnalytics({
            ...filters,
            dateFrom: new Date(fromMs - span).toISOString(),
            dateTo: new Date(fromMs).toISOString(),
          });
          const priorTotal = priorRevenue.reduce(
            (sum, item) => sum + item.revenue,
            0,
          );
          growthRate =
            priorTotal > 0
              ? ((totalRevenue - priorTotal) / priorTotal) * 100
              : 0;
        }
      }

      return {
        summary: {
          totalRevenue,
          totalOrders,
          averageOrderValue: totalRevenue / (totalOrders || 1),
          taxAmount,
          // totalRevenue is gross (tax_amount_cents is part of the order
          // total), so net is what the restaurant keeps once tax is handed on.
          netRevenue: totalRevenue - taxAmount,
          growthRate,
        },
        revenueBreakdown: {
          byDay: revenueData,
          byCategory: menuAnalytics.categoryPerformance,
          topItems: menuAnalytics.popularItems.slice(0, 10),
        },
        expenseAnalysis: {
          // Expense data is not modeled yet; keep this section explicit.
          totalExpenses: 0,
          expenseCategories: [],
        },
        profitability: {
          // TODO: Compute once cost/expense tracking is modeled. Leave at 0
          // rather than echoing revenue, which would imply a 100% margin.
          grossProfit: 0,
          netProfit: 0,
          profitMargin: 0,
        },
        projections,
      };
    } catch (error) {
      this.handleError(error, "getFinancialReport");
    }
  }

  private buildRevenueProjections(
    revenueData: RevenueData[],
  ): Array<{ date: string; projectedRevenue: number; basis: string }> {
    if (revenueData.length === 0) return [];

    const ordered = [...revenueData].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const recent = ordered.slice(-7);
    const averageRevenue =
      recent.reduce((sum, item) => sum + item.revenue, 0) / recent.length;
    const lastDate = this.parseAnalyticsDate(ordered[ordered.length - 1].date);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(lastDate);
      date.setDate(date.getDate() + index + 1);

      return {
        date: date.toISOString().slice(0, 10),
        projectedRevenue: Math.round(averageRevenue * 100) / 100,
        basis: `${recent.length}-period moving average`,
      };
    });
  }

  private parseAnalyticsDate(value: string): Date {
    const weekMatch = /^(?<year>\d{4})-W(?<week>\d{2})$/.exec(value);
    if (weekMatch?.groups) {
      return this.parseSqliteWeekDate(
        Number(weekMatch.groups.year),
        Number(weekMatch.groups.week),
      );
    }

    const normalized = /^\d{4}$/.test(value)
      ? `${value}-01-01`
      : /^\d{4}-\d{2}$/.test(value)
        ? `${value}-01`
        : value;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private parseSqliteWeekDate(year: number, week: number): Date {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    if (week === 0) return yearStart;

    const firstMonday = new Date(yearStart);
    const day = firstMonday.getUTCDay();
    firstMonday.setUTCDate(
      firstMonday.getUTCDate() + (day === 1 ? 0 : (8 - day) % 7),
    );
    firstMonday.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);
    return firstMonday;
  }

  private formatAnalyticsDate(
    date: Date,
    groupBy: NonNullable<AnalyticsFilters["groupBy"]>,
  ): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    switch (groupBy) {
      case "day":
        return `${year}-${month}-${day}`;
      case "week": {
        const week = this.getSqliteWeekNumber(date);
        return `${year}-W${String(week).padStart(2, "0")}`;
      }
      case "month":
        return `${year}-${month}`;
      case "year":
        return String(year);
    }
  }

  private getSqliteWeekNumber(date: Date): number {
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const firstMonday = new Date(yearStart);
    const day = firstMonday.getUTCDay();
    firstMonday.setUTCDate(
      firstMonday.getUTCDate() + (day === 1 ? 0 : (8 - day) % 7),
    );

    if (date < firstMonday) return 0;
    return (
      Math.floor(
        (date.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000),
      ) + 1
    );
  }

  // 取得效能報告
  async getPerformanceReport(
    restaurantId: string,
    dateRange: DateRange,
  ): Promise<{
    orderProcessingTime: number;
    kitchenEfficiency: number;
    tableUtilization: number;
    customerSatisfaction: number;
    recommendations: string[];
  }> {
    try {
      const { dateFrom, dateTo } = dateRange;
      const conditions = [eq(orders.restaurantId, restaurantId)];

      if (dateFrom) conditions.push(gte(orders.createdAt, new Date(dateFrom)));
      if (dateTo) conditions.push(lte(orders.createdAt, new Date(dateTo)));

      // 訂單處理時間
      const [{ avgProcessingTime }] = await this.db
        .select({
          avgProcessingTime: avg(
            sql<number>`
              CASE 
                WHEN ${orders.readyAt} IS NOT NULL AND ${orders.createdAt} IS NOT NULL 
                THEN ${unixMsDiffMinutes(orders.readyAt, orders.createdAt)}
                ELSE NULL 
              END
            `,
          ),
        })
        .from(orders)
        .where(
          and(...conditions, inArray(orders.status, FULFILLED_ORDER_STATUSES)),
        );

      // 廚房效率（實際準備時間 vs 預估準備時間）
      const [{ kitchenEfficiency }] = await this.db
        .select({
          kitchenEfficiency: avg(
            sql<number>`
              CASE 
                WHEN ${orders.actualPrepTime} > 0 AND ${orders.estimatedPrepTime} > 0
                THEN (${orders.estimatedPrepTime} * 100.0 / ${orders.actualPrepTime})
                ELSE NULL
              END
            `,
          ),
        })
        .from(orders)
        .where(
          and(...conditions, inArray(orders.status, FULFILLED_ORDER_STATUSES)),
        );

      // 桌子使用率
      const [{ tableUtilization }] = await this.db
        .select({
          tableUtilization: avg(
            sql<number>`
              CASE 
                WHEN ${tables.totalUsage} > 0 
                THEN (${tables.totalUsage} * ${tables.averageOccupancyMinutes}) / (24.0 * 60) * 100
                ELSE 0 
              END
            `,
          ),
        })
        .from(tables)
        .where(
          and(eq(tables.restaurantId, restaurantId), isNull(tables.deletedAt)),
        );

      // 顧客滿意度（基於評分）
      const [{ customerSatisfaction }] = await this.db
        .select({
          customerSatisfaction: avg(orders.rating),
        })
        .from(orders)
        .where(and(...conditions, sql`${orders.rating} IS NOT NULL`));

      // 生成建議
      const recommendations = [];
      if ((Number(avgProcessingTime) || 0) > 30) {
        recommendations.push(
          "Consider optimizing kitchen workflow to reduce order processing time",
        );
      }
      if ((Number(kitchenEfficiency) || 100) < 80) {
        recommendations.push(
          "Review preparation time estimates and kitchen processes",
        );
      }
      if ((Number(tableUtilization) || 0) < 50) {
        recommendations.push(
          "Improve table management to increase utilization rate",
        );
      }
      if ((Number(customerSatisfaction) || 5) < 4) {
        recommendations.push(
          "Focus on improving customer service and food quality",
        );
      }

      return {
        orderProcessingTime: Number(avgProcessingTime) || 0,
        kitchenEfficiency: Number(kitchenEfficiency) || 100,
        tableUtilization: Number(tableUtilization) || 0,
        customerSatisfaction: Number(customerSatisfaction) || 0,
        recommendations,
      };
    } catch (error) {
      this.handleError(error, "getPerformanceReport");
    }
  }
}
