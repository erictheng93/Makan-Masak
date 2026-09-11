/**
 * Customers Routes
 * API endpoints for customer-specific operations
 */

import { Hono } from "hono";
import { count, desc, eq } from "drizzle-orm";
import { validateQuery } from "../../../shared/middleware";
import { OrdersService } from "../../orders/services/OrdersService";
import { createDatabase, marketCheckoutSessions } from "@makanmasak/database";
import { ConsoleLogger } from "../../../core/monitoring";
import type { Env } from "../../../shared/types";
import { canonicalCustomerAuthMiddleware } from "../../../middleware/auth";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";
import { z } from "zod";
import type { OrderQueryFilters } from "../../orders/types";
import type { OrderStatus as DbOrderStatus } from "@makanmasak/database";

// Create router
const app = new Hono<{ Bindings: Env }>();
const logger = new ConsoleLogger("CustomersRoutes");

// Validation schema for order query
export const myOrdersSchema = z.lazy(() =>
  z.object({
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
);
type MyOrdersQuery = z.infer<typeof myOrdersSchema>;

export const myMarketCheckoutsSchema = z.lazy(() =>
  z.object({
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
  }),
);

function toOrderStatuses(status: MyOrdersQuery["status"]): DbOrderStatus[] {
  return (typeof status === "string" ? [status] : status) as DbOrderStatus[];
}

/**
 * Get current customer's orders
 * GET /api/v1/customers/me/orders
 */
app.get(
  "/me/orders",
  canonicalCustomerAuthMiddleware,
  validateQuery(myOrdersSchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const customer = c.get("customer");
    const ordersService = new OrdersService(c.env);

    logger.debug("Getting customer orders", { customerId: customer.id, query });

    // Build filters - always filter by current customer
    const filters: OrderQueryFilters = {
      customerId: customer.id,
      page: query.page || 1,
      limit: query.limit || 20,
    };

    if (query.status) {
      filters.status = toOrderStatuses(query.status);
    }

    if (query.dateFrom) {
      filters.dateFrom = new Date(query.dateFrom);
    }

    if (query.dateTo) {
      filters.dateTo = new Date(query.dateTo);
    }

    const result = await ordersService.getOrders(filters);

    return c.json({
      success: true,
      data: result.orders,
      pagination: result.pagination,
    });
  },
);

/**
 * Get current customer's market checkout history.
 * GET /api/v1/customers/me/market-checkouts
 */
app.get(
  "/me/market-checkouts",
  canonicalCustomerAuthMiddleware,
  validateQuery(myMarketCheckoutsSchema),
  async (c) => {
    const customer = c.get("customer");
    const query = c.get("validatedQuery");
    const page = query.page || 1;
    const limit = query.limit || 20;
    const db = createDatabase(c.env.DB);
    const where = eq(marketCheckoutSessions.customerId, customer.id);

    const [checkouts, total] = await Promise.all([
      db
        .select({
          id: marketCheckoutSessions.id,
          marketId: marketCheckoutSessions.marketId,
          marketSlug: marketCheckoutSessions.marketSlug,
          marketName: marketCheckoutSessions.marketName,
          status: marketCheckoutSessions.status,
          paymentStatus: marketCheckoutSessions.paymentStatus,
          subtotalCents: marketCheckoutSessions.subtotalCents,
          childOrderCount: marketCheckoutSessions.childOrderCount,
          createdAt: marketCheckoutSessions.createdAt,
        })
        .from(marketCheckoutSessions)
        .where(where)
        .orderBy(desc(marketCheckoutSessions.createdAt))
        .limit(limit)
        .offset((page - 1) * limit)
        .all(),
      db
        .select({ total: count() })
        .from(marketCheckoutSessions)
        .where(where)
        .get(),
    ]);

    const totalCount = total?.total ?? 0;
    return c.json({
      success: true,
      data: checkouts.map((checkout) => ({
        id: checkout.id,
        market: {
          id: checkout.marketId,
          slug: checkout.marketSlug,
          name: checkout.marketName,
        },
        status: checkout.status,
        paymentStatus: checkout.paymentStatus,
        subtotal: checkout.subtotalCents,
        childOrderCount: checkout.childOrderCount,
        createdAt: checkout.createdAt,
      })),
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  },
);

/**
 * Get current customer's profile
 * GET /api/v1/customers/me
 */
app.get("/me", canonicalCustomerAuthMiddleware, async (c) => {
  const customer = c.get("customer");

  logger.debug("Getting customer profile", { customerId: customer.id });

  // Return user profile
  return c.json({
    success: true,
    data: {
      id: customer.id,
      username: customer.primaryPhone || customer.primaryEmail || customer.id,
      fullName: customer.displayName,
      email: customer.primaryEmail || undefined,
      phone: customer.primaryPhone || undefined,
      role: 5,
    },
  });
});

export default app;
