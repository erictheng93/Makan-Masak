import type { D1Database } from "@cloudflare/workers-types";
import {
  DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES,
  businessTimezoneOffsetMinutes,
  marketCheckoutChildOrders,
  marketCheckoutSessions,
  marketVendorOpenEvents,
  markets,
  orders,
  restaurantMarketMemberships,
  restaurants,
  users,
} from "@makanmasak/database";
import { and, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { displayCurrencyFromRestaurantSettings } from "../../../shared/utils/restaurant-currency";
import {
  buildOpenReport,
  type OpenReport,
  type OpenReportVendor,
} from "./market-open-report";

const DAY_MS = 86_400_000;

export type MarketOpenReportResult = OpenReport & {
  market: { id: string; name: string; businessDayCutoffMinutes: number };
  from: string;
  to: string;
};

export class MarketOpenReportService {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async getReport(input: {
    marketId: string;
    restaurantId?: string;
    from: string;
    to: string;
    now?: Date;
  }): Promise<MarketOpenReportResult | null> {
    const [market] = await this.db
      .select({
        id: markets.id,
        name: markets.name,
        cutoffMinutes: markets.businessDayCutoffMinutes,
        openingHours: markets.openingHours,
      })
      .from(markets)
      .where(and(eq(markets.id, input.marketId), isNull(markets.deletedAt)))
      .limit(1);
    if (!market) return null;
    const cutoffMinutes =
      market.cutoffMinutes ?? DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES;

    const vendorRows = await this.db
      .select({
        restaurantId: restaurants.id,
        name: restaurants.name,
        stallNumber: restaurantMarketMemberships.stallNumber,
        membershipId: restaurantMarketMemberships.id,
        joinedAt: restaurantMarketMemberships.joinedAt,
        leftAt: restaurantMarketMemberships.leftAt,
        timezone: restaurants.timezone,
        settings: restaurants.settings,
      })
      .from(restaurantMarketMemberships)
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, market.id),
          input.restaurantId
            ? eq(restaurantMarketMemberships.restaurantId, input.restaurantId)
            : undefined,
        ),
      );
    // Active membership wins; otherwise use the most recently joined row.
    // ID breaks ties from legacy rows with equal timestamps.
    vendorRows.sort(
      (a, b) =>
        Number(a.leftAt !== null) - Number(b.leftAt !== null) ||
        b.joinedAt.getTime() - a.joinedAt.getTime() ||
        b.membershipId - a.membershipId,
    );
    const vendorsById = new Map<string, OpenReportVendor>();
    for (const row of vendorRows) {
      if (vendorsById.has(row.restaurantId)) continue;
      vendorsById.set(row.restaurantId, {
        restaurantId: row.restaurantId,
        name: row.name,
        stallNumber: row.stallNumber,
        offsetMinutes: businessTimezoneOffsetMinutes(row.timezone),
        currency: displayCurrencyFromRestaurantSettings(row.settings),
      });
    }
    const vendors = [...vendorsById.values()];

    const eventRows = await this.db
      .select()
      .from(marketVendorOpenEvents)
      .where(
        and(
          eq(marketVendorOpenEvents.marketId, market.id),
          input.restaurantId
            ? eq(marketVendorOpenEvents.restaurantId, input.restaurantId)
            : undefined,
          gte(marketVendorOpenEvents.businessDate, input.from),
          lte(marketVendorOpenEvents.businessDate, input.to),
        ),
      );

    const windowStart = new Date(
      Date.parse(`${input.from}T00:00:00Z`) - DAY_MS,
    );
    const windowEnd = new Date(
      Date.parse(`${input.to}T00:00:00Z`) + 2 * DAY_MS,
    );
    const orderRows = await this.db
      .select({
        restaurantId: marketCheckoutChildOrders.restaurantId,
        createdAt: marketCheckoutChildOrders.createdAt,
        amountCents: marketCheckoutChildOrders.totalAmountCents,
      })
      .from(marketCheckoutChildOrders)
      .innerJoin(
        marketCheckoutSessions,
        eq(marketCheckoutChildOrders.checkoutId, marketCheckoutSessions.id),
      )
      .innerJoin(orders, eq(orders.id, marketCheckoutChildOrders.orderId))
      .where(
        and(
          eq(marketCheckoutSessions.marketId, market.id),
          eq(orders.paymentStatus, "completed"),
          input.restaurantId
            ? eq(marketCheckoutChildOrders.restaurantId, input.restaurantId)
            : undefined,
          gte(marketCheckoutChildOrders.createdAt, windowStart),
          lt(marketCheckoutChildOrders.createdAt, windowEnd),
        ),
      );

    const actorIds = [
      ...new Set(
        eventRows
          .map((event) => event.actorUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const actorRows = actorIds.length
      ? await this.db
          .select({
            id: users.id,
            fullName: users.fullName,
            username: users.username,
          })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];

    const report = buildOpenReport({
      from: input.from,
      to: input.to,
      cutoffMinutes,
      openingHours: market.openingHours ?? null,
      vendors,
      events: eventRows.map((event) => ({
        restaurantId: event.restaurantId,
        action: event.action,
        businessDate: event.businessDate,
        occurredAtMs: event.occurredAt.getTime(),
        actorUserId: event.actorUserId,
      })),
      orders: orderRows.map((row) => ({
        restaurantId: row.restaurantId,
        createdAtMs: row.createdAt.getTime(),
        amountCents: row.amountCents,
      })),
      actorNames: Object.fromEntries(
        actorRows.map((row) => [row.id, row.fullName || row.username]),
      ),
      nowMs: (input.now ?? new Date()).getTime(),
    });

    return {
      market: {
        id: market.id,
        name: market.name,
        businessDayCutoffMinutes: cutoffMinutes,
      },
      from: input.from,
      to: input.to,
      ...report,
    };
  }
}
