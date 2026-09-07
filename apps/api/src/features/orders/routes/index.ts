/**
 * Orders Routes
 * HTTP routes for order management matching existing orders.ts functionality
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  customerAuthMiddleware,
  requireRole,
} from "../../../shared/middleware";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../shared/middleware";
import { OrdersService } from "../services/OrdersService";
import { assertShopOrderingEnabled } from "../services/shop-mode-gate";
import { ConsoleLogger } from "../../../core/monitoring";
import type { Env } from "../../../shared/types";
import type { AuthUser } from "../../../middleware/auth";
import {
  ORDER_PAYMENT_STATUSES,
  OrderStatus,
  OrderPaymentStatus,
  OrderPaymentMethod,
  UserRole,
} from "@makanmasak/shared-types";
import {
  notFound,
  forbidden,
  badRequest,
  conflict,
} from "../../../shared/utils/api-error";
import { moduleGate } from "../../../middleware/moduleGate";
import { quotaGate } from "../../../middleware/quotaGate";
import { meterEmit } from "../../../shared/utils/meter";
import type { CallerContext } from "../types";
import { ROLE_STATUS_PERMISSIONS } from "../types";

const ORDER_TIMESTAMP_FIELDS = [
  "createdAt",
  "updatedAt",
  "confirmedAt",
  "preparingAt",
  "readyAt",
  "deliveredAt",
  "paidAt",
  "cancelledAt",
] as const;

function toWireTimestamp(value: unknown): unknown {
  if (value == null || typeof value === "number") {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : value;
  }
  return value;
}

function serializeOrderForWire<T>(order: T): T {
  if (!order || typeof order !== "object") {
    return order;
  }

  const serialized = { ...(order as Record<string, unknown>) };
  for (const field of ORDER_TIMESTAMP_FIELDS) {
    serialized[field] = toWireTimestamp(serialized[field]);
  }

  return serialized as T;
}

function serializeOrdersForWire<T>(orders: T[]): T[] {
  return orders.map((order) => serializeOrderForWire(order));
}

/** Convert auth user to CallerContext for service-layer defence-in-depth */
function toCallerContext(user: AuthUser): CallerContext {
  return {
    userId: user.id,
    userRole: user.role,
    userRestaurantId:
      user.restaurantId == null ? undefined : String(user.restaurantId),
  };
}

/**
 * Propagate a staff-initiated cancellation without delaying its local response.
 * Platform-originated cancellations intentionally do not use this helper, which
 * prevents an inbound webhook from being echoed back to its source platform.
 */
function syncCancellationToPlatform(
  c: {
    env: Env;
    executionCtx?: { waitUntil(promise: Promise<unknown>): void };
  },
  order: unknown,
): void {
  if (
    !order ||
    typeof order !== "object" ||
    typeof (order as { id?: unknown }).id !== "string" ||
    !(order as { orderSource?: unknown }).orderSource ||
    (order as { orderSource?: unknown }).orderSource === "direct"
  ) {
    return;
  }

  const orderId = (order as { id: string }).id;
  c.executionCtx?.waitUntil(
    (async () => {
      try {
        const { PlatformOrderService } =
          await import("../../integrations/services/PlatformOrderService");
        await new PlatformOrderService(c.env).syncStatusToPlatform(
          orderId,
          "cancelled",
        );
      } catch (err) {
        logger.error(
          "Failed to sync cancellation to platform",
          err instanceof Error ? err : undefined,
          { orderId },
        );
      }
    })(),
  );
}

// Map a wire status string onto the canonical OrderStatus union. The
// only non-identity hop is `completed` → `delivered`, kept so realtime
// clients that still emit the older event vocabulary keep working.
function stringToOrderStatus(status: string): OrderStatus {
  if (status === "completed") return "delivered";
  return (status as OrderStatus) || "pending";
}

// Normalise the status query parameter into an OrderStatus array.
// Each entry has already been validated by orderStatusSchema upstream,
// so this is a structural-only conversion (string | string[] → array).
function convertStatusArray(
  status: string | string[] | undefined,
): OrderStatus[] | undefined {
  if (!status) return undefined;
  return (typeof status === "string" ? [status] : status) as OrderStatus[];
}

// Spellings accepted from clients that are not themselves canonical values.
// "paid" is what orders.payment_status actually held until #311 changed the
// three writers to "completed", so it has to keep resolving — both for clients
// that still send it and for any row written before that change.
const PAYMENT_STATUS_ALIASES: Readonly<Record<string, OrderPaymentStatus>> = {
  paid: "completed",
};

// Normalise an incoming payment-status string to a canonical
// OrderPaymentStatus. The identity half is derived from
// ORDER_PAYMENT_STATUSES rather than restated, because the fallback here is a
// silent "pending" rather than an error: a value added to the canonical set
// and forgotten in a hand-copied map does not fail, it quietly filters by the
// wrong status. That is exactly what happened to "partial_refunded" (#311).
function stringToPaymentStatus(status: string): OrderPaymentStatus {
  if ((ORDER_PAYMENT_STATUSES as readonly string[]).includes(status)) {
    return status as OrderPaymentStatus;
  }
  return PAYMENT_STATUS_ALIASES[status] ?? "pending";
}

// Helper function to convert payment status array
function convertPaymentStatusArray(
  status: string | string[] | undefined,
): OrderPaymentStatus[] | undefined {
  if (!status) return undefined;
  if (typeof status === "string") {
    return [stringToPaymentStatus(status)];
  }
  return status.map((s) => stringToPaymentStatus(s));
}

// Helper function to convert payment method array
function convertPaymentMethodArray(
  method: string | string[] | undefined,
): OrderPaymentMethod[] | undefined {
  if (!method) return undefined;
  if (typeof method === "string") {
    return [method as OrderPaymentMethod];
  }
  return method as OrderPaymentMethod[];
}

// Import validation schemas
import {
  orderSchemas,
  CreateOrderInput,
  UpdateOrderStatusInput,
  OrderFiltersInput,
  CouponPreviewInput,
  BulkOrderOperationInput,
  AnalyticsQueryInput,
  StatsQueryInput,
  AddOrderItemsInput,
  ChangeOrderItemQuantityInput,
} from "../schemas/validation";

// Create router
const app = new Hono<{ Bindings: Env }>();
const logger = new ConsoleLogger("OrdersRoutes");
const orderBatchSyncSchema = z.object({}).loose();

// Optional body for DELETE /orders/:id — carries a human cancellation reason.
// Both the body and the field are optional; the value is trimmed and capped to
// 500 chars by the handler (truncated rather than rejected) before it is stored.
const cancelOrderBodySchema = z.object({
  reason: z.string().optional(),
});

function createBatchSyncId(payload: Record<string, unknown>): string {
  if (typeof payload.sync_id === "string" && payload.sync_id.trim()) {
    return encodeURIComponent(payload.sync_id);
  }
  return `${Date.now()}`;
}

// NOTE: The `/orders/guest` and `/orders/guest/:id` routes were removed as dead
// code. They were unreachable in production because the blanket
// `use("/orders/*", staffOrUserCustomerAuthMiddleware)` gate (formerly in
// app-factory.ts) ran first and rejected KV-based guest tokens with a 401
// before guestSessionAuth/guestTokenAuth could execute. The live guest-ordering
// path is the separately-mounted `/api/v1/guest-orders` feature, which is what
// the customer app actually calls.

/**
 * Preview coupon discount effect (without creating order)
 * POST /api/v1/orders/preview-coupon
 */
app.post(
  "/preview-coupon",
  customerAuthMiddleware,
  moduleGate("online_ordering"),
  validateBody(orderSchemas.couponPreview),
  async (c) => {
    const data: CouponPreviewInput = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.info("Previewing coupon", {
      couponCode: data.couponCode,
      userId: user.id,
    });

    const result = await ordersService.previewCoupon({
      restaurantId: data.restaurantId,
      couponCode: data.couponCode,
      orderAmount: data.orderAmount,
      userId: data.userId || user.id,
      menuItems: data.menuItems,
    });

    return c.json({
      success: true,
      data: result,
    });
  },
);

/**
 * Batch order sync compatibility endpoint
 * POST /api/v1/orders/batch-sync
 */
app.post(
  "/batch-sync",
  customerAuthMiddleware,
  moduleGate("online_ordering"),
  validateBody(orderBatchSyncSchema),
  async (c) => {
    const user: AuthUser = c.get("user");
    const payload = c.get("validatedBody") as Record<string, unknown>;
    const now = new Date().toISOString();
    const syncId = createBatchSyncId(payload);
    const restaurantId =
      user.restaurantId == null ? "global" : String(user.restaurantId);
    const scope = encodeURIComponent(restaurantId);
    const record = {
      userId: user.id,
      restaurantId:
        user.restaurantId == null ? null : String(user.restaurantId),
      payload,
      syncedAt: now,
    };

    await c.env.CACHE_KV.put(
      `orders:batch-sync:${scope}:${user.id}:${syncId}`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    await c.env.CACHE_KV.put(
      `orders:batch-sync:${scope}:${user.id}:latest`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );

    return c.json({
      success: true,
      data: {
        syncId,
        synced: true,
        itemCount: Array.isArray(payload.orders) ? payload.orders.length : 0,
        restaurantId: record.restaurantId,
        syncedAt: now,
      },
    });
  },
);

/**
 * Create new order (requires authentication)
 * POST /api/v1/orders
 */
app.post(
  "/",
  customerAuthMiddleware,
  moduleGate("online_ordering"),
  quotaGate("orders.created"),
  validateBody(orderSchemas.createOrder),
  async (c) => {
    const data: CreateOrderInput = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const customer = c.get("customer") as { id: string } | undefined;
    const ordersService = new OrdersService(c.env);

    logger.info("Creating new order", {
      restaurantId: data.restaurantId,
      userId: user.id,
    });

    // Security: Verify restaurant access if user has restaurant constraints
    if (
      user.restaurantId != null &&
      String(user.restaurantId) !== data.restaurantId
    ) {
      throw forbidden("Access denied to this restaurant");
    }

    // Shop-channel orders only. `orderType` defaults to "shop" in the schema, so
    // a table order whose client omitted the field lands here too — those carry
    // a tableId and belong to the dine-in channel, which shop mode does not
    // govern.
    if (data.orderType === "shop" && !data.tableId) {
      await assertShopOrderingEnabled(
        c.env,
        data.restaurantId,
        data.shopQrCode,
      );
    }

    // Transform data for service
    const createOrderData = {
      restaurantId: data.restaurantId,
      tableId: data.tableId,
      customerId: customer?.id,
      waitingListId: data.waitingListId,
      waitingListCustomerPhone: data.customerPhone,
      customerInfo: {
        ...data.customerInfo,
        name: data.customerName ?? data.customerInfo?.name,
        phone: data.customerPhone ?? data.customerInfo?.phone,
        email: data.customerEmail ?? data.customerInfo?.email,
      },
      items: data.items.map((item) => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        price: item.price,
        customizations: item.customizations,
        notes: item.notes,
      })),
      notes: data.notes,
      orderType: data.orderType,
      deliveryInfo: data.deliveryInfo,
      scheduledTime: data.scheduledTime
        ? new Date(data.scheduledTime)
        : undefined,
      couponCode: data.couponCode,
      clientMutationId: data.clientMutationId,
    };

    let order;
    try {
      order = await ordersService.createOrder(createOrderData, user.id);
    } catch (error) {
      // The unique index did its job: this cart was already committed under the
      // same key. Say so with a 409 the client can act on — the customer app
      // maps this code to "your order is already in" — instead of letting a
      // bare sentinel message fall through to a 500 that reads like a failure
      // and invites yet another tap.
      if (
        error instanceof Error &&
        error.message === "CLIENT_MUTATION_DUPLICATE"
      ) {
        throw conflict(
          "Client mutation has already been processed",
          "CLIENT_MUTATION_DUPLICATE",
        );
      }
      throw error;
    }
    await meterEmit(c, "orders.created", {
      restaurantId: data.restaurantId,
      metadata: { orderId: order.id },
    });

    return c.json(
      {
        success: true,
        data: serializeOrderForWire(order),
      },
      201,
    );
  },
);

/**
 * Get orders list with filtering and pagination
 * GET /api/v1/orders
 */
app.get(
  "/",
  customerAuthMiddleware,
  // Staff only. Legacy users.role=5 (customer) is retired: customer identity
  // lives in `customers` and orders.customer_id is a TEXT FK to customers.id,
  // so a users row can never scope this list correctly. Reject it outright
  // rather than fall through to a comparison that silently matches nothing.
  requireRole([0, 1, 2, 3, 4]),
  moduleGate("online_ordering"),
  validateQuery(orderSchemas.orderFilters),
  async (c) => {
    const query: OrderFiltersInput = c.get("validatedQuery");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.debug("Getting orders", { filters: query, userId: user.id });

    // Apply role-based filtering and type conversions
    const filters = {
      ...query,
      status: convertStatusArray(query.status),
      paymentStatus: convertPaymentStatusArray(query.paymentStatus),
      paymentMethod: convertPaymentMethodArray(query.paymentMethod),
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      scheduledTimeFrom: query.scheduledTimeFrom
        ? new Date(query.scheduledTimeFrom)
        : undefined,
      scheduledTimeTo: query.scheduledTimeTo
        ? new Date(query.scheduledTimeTo)
        : undefined,
    };

    // Role-based filtering
    if (user.role !== 0) {
      // Non-admin staff only sees their restaurant's orders
      filters.restaurantId =
        user.restaurantId == null ? undefined : String(user.restaurantId);
    } else if (query.restaurantId) {
      // Admin can filter by restaurant
      filters.restaurantId = query.restaurantId;
    }

    const result = await ordersService.getOrders(
      filters,
      user.id,
      user.role as UserRole,
      toCallerContext(user),
    );

    return c.json({
      success: true,
      data: serializeOrdersForWire(result.orders),
      pagination: result.pagination,
    });
  },
);

/**
 * Get order statistics
 * GET /api/v1/orders/stats
 */
app.get(
  "/stats",
  customerAuthMiddleware,
  requireRole([0, 1]), // Admin and Owner only
  // These are the order counts on the order-management screen, not the
  // analytics add-on: the same orders are already listed by `GET /orders`
  // under `online_ordering`. Gating the counts behind `analytics` left every
  // basic-plan owner with four cards stuck at 0 and a rejected request on
  // each filter change, on the very screen the counts belong to.
  moduleGate("online_ordering"),
  validateQuery(orderSchemas.stats),
  async (c) => {
    const query: StatsQueryInput = c.get("validatedQuery");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.debug("Getting order statistics", { query, userId: user.id });

    // Determine restaurant ID
    let restaurantId: string | undefined;
    if (user.role === 1) {
      // Owner only sees their restaurant
      restaurantId =
        user.restaurantId == null ? undefined : String(user.restaurantId);
    } else if (query.restaurantId) {
      restaurantId = query.restaurantId;
    }

    if (!restaurantId) {
      throw badRequest("Restaurant ID is required");
    }

    const statistics = await ordersService.getOrderStatistics(restaurantId);

    return c.json({
      success: true,
      data: statistics,
    });
  },
);

/**
 * Get order analytics
 * GET /api/v1/orders/analytics
 */
app.get(
  "/analytics",
  customerAuthMiddleware,
  requireRole([0, 1]), // Admin and Owner only
  moduleGate("analytics"),
  validateQuery(orderSchemas.analytics),
  async (c) => {
    const query: AnalyticsQueryInput = c.get("validatedQuery");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.debug("Getting order analytics", { query, userId: user.id });

    // Apply role-based filtering and type conversions
    const filters = {
      ...query,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    };
    if (user.role === 1) {
      filters.restaurantId =
        user.restaurantId == null ? undefined : String(user.restaurantId);
    }

    const analytics = await ordersService.getOrderAnalytics(
      filters,
      user.id,
      toCallerContext(user),
    );

    return c.json({
      success: true,
      data: analytics,
    });
  },
);

/**
 * Get active orders for restaurant
 * GET /api/v1/orders/active
 */
app.get(
  "/active",
  customerAuthMiddleware,
  requireRole([0, 1, 2, 3]), // All except cashier
  moduleGate("online_ordering"),
  async (c) => {
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    const restaurantId =
      user.role === 0
        ? c.req.query("restaurantId") || ""
        : user.restaurantId == null
          ? ""
          : String(user.restaurantId);

    if (!restaurantId) {
      throw badRequest("Restaurant ID is required");
    }

    logger.debug("Getting active orders", { restaurantId, userId: user.id });

    const orders = await ordersService.getActiveOrders(restaurantId);

    return c.json({
      success: true,
      data: serializeOrdersForWire(orders),
    });
  },
);

/**
 * Get single order details
 * GET /api/v1/orders/:id
 */
app.get(
  "/:id",
  customerAuthMiddleware,
  // Staff only — customers read their own orders via
  // GET /api/v1/customers/me/orders (canonical customer JWT).
  requireRole([0, 1, 2, 3, 4]),
  moduleGate("online_ordering"),
  validateParams(orderSchemas.params),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.debug("Getting order details", { orderId: id, userId: user.id });

    const order = await ordersService.getOrder(id, true, toCallerContext(user));

    if (!order) {
      throw notFound("Order not found");
    }

    return c.json({
      success: true,
      data: serializeOrderForWire(order),
    });
  },
);

/**
 * Update order status
 * PUT /api/v1/orders/:id/status
 */
app.post(
  "/:id/delivery-claim",
  customerAuthMiddleware,
  requireRole([0, 3]),
  moduleGate("online_ordering"),
  validateParams(orderSchemas.params),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    const order = await ordersService.claimDelivery(
      id,
      String(user.id),
      toCallerContext(user),
    );
    if (!order) throw notFound("Order not found");

    return c.json({ success: true, data: serializeOrderForWire(order) });
  },
);

app.put(
  "/:id/status",
  customerAuthMiddleware,
  requireRole([0, 1, 2, 3, 4]),
  moduleGate("online_ordering"),
  validateParams(orderSchemas.params),
  validateBody(orderSchemas.updateOrderStatus),
  async (c) => {
    const { id } = c.get("validatedParams");
    const data: UpdateOrderStatusInput = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.info("Updating order status", {
      orderId: id,
      newStatus: data.status,
      userId: user.id,
    });

    // Get existing order for permission checks
    const existingOrder = await ordersService.getOrder(id);
    if (!existingOrder) {
      throw notFound("Order not found");
    }

    // Permission check
    if (user.role !== 0 && user.restaurantId !== existingOrder.restaurantId) {
      throw forbidden("Access denied");
    }

    // Role-based status transition validation (uses shared constant)
    if (!ROLE_STATUS_PERMISSIONS[user.role]?.includes(data.status)) {
      throw forbidden("Insufficient permissions for this status change");
    }

    const updatedOrder = await ordersService.updateOrderStatus(
      id,
      {
        status: stringToOrderStatus(data.status),
        notes: data.notes,
        estimatedReadyTime: data.estimatedReadyTime
          ? new Date(data.estimatedReadyTime)
          : undefined,
        updatedBy: user.id,
      },
      user.id,
      user.role as UserRole,
      toCallerContext(user),
      existingOrder, // Pass pre-fetched order to avoid redundant DB lookup
    );

    if (!updatedOrder) {
      throw badRequest("Failed to update order status");
    }

    // Sync status to external platform if this is a platform order
    if (existingOrder.orderSource && existingOrder.orderSource !== "direct") {
      c.executionCtx?.waitUntil(
        (async () => {
          try {
            const { PlatformOrderService } =
              await import("../../integrations/services/PlatformOrderService");
            const platformService = new PlatformOrderService(c.env);
            await platformService.syncStatusToPlatform(id, data.status);
          } catch (err) {
            logger.error(
              "Failed to sync status to platform",
              err instanceof Error ? err : undefined,
              { orderId: id, status: data.status },
            );
          }
        })(),
      );
    }

    return c.json({
      success: true,
      data: serializeOrderForWire(updatedOrder),
    });
  },
);

/**
 * Cancel order
 * DELETE /api/v1/orders/:id
 */
app.delete(
  "/:id",
  customerAuthMiddleware,
  requireRole([0, 1]), // Admin and Owner only
  moduleGate("online_ordering"),
  validateParams(orderSchemas.params),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    // Parse the optional cancellation reason from the request body. The body is
    // optional — an absent or empty body must not error. The reason is trimmed
    // and capped so an over-long or malformed value can't bloat the audit log.
    let reason = "Cancelled by user";
    try {
      const rawBody = await c.req.text();
      if (rawBody.trim().length > 0) {
        const parsed = cancelOrderBodySchema.safeParse(JSON.parse(rawBody));
        const provided = parsed.success
          ? parsed.data.reason?.trim()
          : undefined;
        if (provided) {
          reason = provided.slice(0, 500);
        }
      }
    } catch {
      // Malformed JSON body — fall back to the default reason rather than 400,
      // matching the tolerant behaviour of the other guest/order cancel paths.
    }

    logger.info("Cancelling order", { orderId: id, userId: user.id });

    // Get order for permission check
    const order = await ordersService.getOrder(id);
    if (!order) {
      throw notFound("Order not found");
    }

    // Permission check
    if (user.role !== 0 && user.restaurantId !== order.restaurantId) {
      throw forbidden("Access denied");
    }

    const cancelledOrder = await ordersService.cancelOrder(
      id,
      reason,
      user.id,
      toCallerContext(user),
      order, // Pass pre-fetched order to avoid redundant DB lookup
    );

    if (!cancelledOrder) {
      throw badRequest("Failed to cancel order");
    }

    syncCancellationToPlatform(c, order);

    return c.json({
      success: true,
      message: "Order cancelled successfully",
    });
  },
);

/**
 * Staff-side order modification (#273).
 *
 * The engine for this already existed and was already in production -- it was
 * only ever wired to the guest door (POST /api/v1/guest-orders/:id/items).
 * These three routes are the staff door onto the same code, plus the reverse
 * gear it never had.
 *
 * Role 0/1 only, matching cancel and refund: changing what a customer is
 * charged is an owner-level action, not a service-crew one. The base service
 * refuses anything past `confirmed`, so a dish already in the pan cannot be
 * edited out from under the kitchen.
 */

/**
 * Add items to an existing order
 * POST /api/v1/orders/:id/items
 */
app.post(
  "/:id/items",
  customerAuthMiddleware,
  requireRole([0, 1]),
  moduleGate("online_ordering"),
  validateParams(orderSchemas.params),
  validateBody(orderSchemas.addItems),
  async (c) => {
    const { id } = c.get("validatedParams");
    const data: AddOrderItemsInput = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    const order = await ordersService.getOrder(id);
    if (!order) {
      throw notFound("Order not found");
    }
    if (user.role !== 0 && user.restaurantId !== order.restaurantId) {
      throw forbidden("Access denied");
    }
    // expectedVersion is deliberately NOT compared here. It is enforced inside
    // the base service, against the same read that feeds its compare-and-swap;
    // a check at this layer would leave a window between its read and that one
    // in which another writer could land unnoticed.

    logger.info("Adding items to order", {
      orderId: id,
      itemCount: data.items.length,
      userId: user.id,
    });

    const updatedOrder = await ordersService.addItemsToOrder(
      id,
      data.items,
      user.id,
      data.expectedVersion,
    );

    return c.json({
      success: true,
      data: serializeOrderForWire(updatedOrder),
    });
  },
);

/**
 * Change one line's quantity
 * PATCH /api/v1/orders/:id/items/:itemId
 */
app.patch(
  "/:id/items/:itemId",
  customerAuthMiddleware,
  requireRole([0, 1]),
  moduleGate("online_ordering"),
  validateParams(orderSchemas.itemParams),
  validateBody(orderSchemas.changeItemQuantity),
  async (c) => {
    const { id, itemId } = c.get("validatedParams");
    const data: ChangeOrderItemQuantityInput = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    const updatedOrder = await ordersService.changeOrderItemQuantity(
      id,
      itemId,
      data.quantity,
      {
        userId: user.id,
        expectedVersion: data.expectedVersion,
        caller: toCallerContext(user),
      },
    );

    return c.json({
      success: true,
      data: serializeOrderForWire(updatedOrder),
    });
  },
);

/**
 * Remove one line from an order
 * DELETE /api/v1/orders/:id/items/:itemId
 */
app.delete(
  "/:id/items/:itemId",
  customerAuthMiddleware,
  requireRole([0, 1]),
  moduleGate("online_ordering"),
  validateParams(orderSchemas.itemParams),
  validateQuery(orderSchemas.removeItemQuery),
  async (c) => {
    const { id, itemId } = c.get("validatedParams");
    const { expectedVersion } = c.get("validatedQuery");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    // Quantity 0 is the removal signal the service takes; the HTTP surface
    // keeps DELETE because that is what removing a line is.
    const updatedOrder = await ordersService.changeOrderItemQuantity(
      id,
      itemId,
      0,
      {
        userId: user.id,
        expectedVersion,
        caller: toCallerContext(user),
      },
    );

    return c.json({
      success: true,
      data: serializeOrderForWire(updatedOrder),
    });
  },
);

/**
 * Bulk order operations
 * POST /api/v1/orders/bulk
 */
app.post(
  "/bulk",
  customerAuthMiddleware,
  requireRole([0, 1]), // Admin and Owner only
  moduleGate("online_ordering"),
  validateBody(orderSchemas.bulkOperation),
  async (c) => {
    const data: BulkOrderOperationInput = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.info("Executing bulk order operation", {
      action: data.action,
      orderCount: data.orderIds.length,
    });

    const result = await ordersService.bulkUpdateOrders(
      data,
      user.id,
      user.role as UserRole,
      toCallerContext(user),
    );

    if (data.action === "cancel") {
      for (const cancelledOrder of result.results) {
        if (cancelledOrder.success) {
          syncCancellationToPlatform(c, cancelledOrder.data);
        }
      }
    }

    return c.json({
      success: true,
      data: result,
    });
  },
);

/**
 * Export orders
 * POST /api/v1/orders/export
 */
app.post(
  "/export",
  customerAuthMiddleware,
  requireRole([0, 1]), // Admin and Owner only
  moduleGate("online_ordering"),
  validateBody(orderSchemas.export),
  async (c) => {
    const data = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.info("Exporting orders", { format: data.format, userId: user.id });

    // Apply role-based filtering — exportOrdersSchema spreads orderFilterSchema flat,
    // so filter fields live alongside `format`/`includeItems`/etc on `data`.
    const {
      format,
      includeItems,
      includeCustomerInfo,
      columns,
      ...filterFields
    } = data;
    void includeItems;
    void includeCustomerInfo;
    void columns;
    const filters: Record<string, unknown> = { ...filterFields };
    if (user.role === 1) {
      filters.restaurantId =
        user.restaurantId == null ? undefined : String(user.restaurantId);
    }

    const exportData = await ordersService.exportOrders(filters, format);

    // Set appropriate headers
    const filename = `orders-${new Date().toISOString().split("T")[0]}.${data.format}`;
    let contentType = "application/octet-stream";

    switch (data.format) {
      case "csv":
        contentType = "text/csv";
        break;
      case "excel":
        contentType =
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        break;
      case "pdf":
        contentType = "application/pdf";
        break;
    }

    return new Response(exportData, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);

/**
 * Generate order receipt
 * GET /api/v1/orders/:id/receipt
 */
app.get(
  "/:id/receipt",
  customerAuthMiddleware,
  // Staff only — see the note on GET / above.
  requireRole([0, 1, 2, 3, 4]),
  moduleGate("receipt_printing"),
  quotaGate("print.jobs"),
  validateParams(orderSchemas.params),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user: AuthUser = c.get("user");
    const ordersService = new OrdersService(c.env);

    logger.debug("Generating order receipt", {
      orderId: id,
      userId: user.id,
    });

    // Get order first to check permissions
    const order = await ordersService.getOrder(id);
    if (!order) {
      throw notFound("Order not found");
    }

    // Permission check — staff can only view receipts from their restaurant
    if (user.role !== 0 && user.restaurantId !== order.restaurantId) {
      throw forbidden("Access denied");
    }

    const receipt = await ordersService.generateReceipt(id);
    await meterEmit(c, "print.jobs", {
      restaurantId: String(order.restaurantId),
      metadata: { orderId: id },
    });

    return c.json({
      success: true,
      data: receipt,
    });
  },
);

export default app;
