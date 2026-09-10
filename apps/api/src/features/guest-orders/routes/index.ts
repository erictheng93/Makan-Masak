/**
 * Guest Orders Routes
 * Public endpoints for unauthenticated QR code ordering.
 * Guest access uses KV tokens; valid customer tokens optionally associate an
 * order with its customer without changing anonymous ordering.
 */

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  createDatabase,
  orders,
  restaurants,
  tables,
  seats,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";
import {
  guestTokenAuth,
  generateGuestToken,
  guestActiveOrderKey,
  resolveGuestLockIdentity,
} from "../../../middleware/guestAuth";
import type { GuestTokenData } from "../../../middleware/guestAuth";
import { optionalCanonicalCustomerAuthMiddleware } from "../../../middleware/auth";
import {
  createGuestOrderSchema,
  addGuestOrderItemsSchema,
} from "../schemas/validation";
import { OrdersService } from "../../orders/services/OrdersService";
import {
  assertShopModeEnabled,
  assertShopQrCurrent,
} from "../../orders/services/shop-mode-gate";
import { enforceGuestOrderThrottle } from "../services/guest-order-throttle";
import {
  ApiError,
  notFound,
  forbidden,
  badRequest,
  conflict,
} from "../../../shared/utils/api-error";
import { enforceQuota } from "../../../middleware/quotaGate";
import { meterEmit } from "../../../shared/utils/meter";
import { validateBody } from "../../../shared/middleware";

const app = new Hono<{ Bindings: Env }>();

// ─── POST / ─── Create guest order (optional customer auth, rate limited) ───
app.post(
  "/",
  optionalCanonicalCustomerAuthMiddleware,
  validateBody(createGuestOrderSchema),
  async (c) => {
    const data = c.get("validatedBody");
    const customer = c.get("customer");
    await enforceQuota(c, "orders.created", {
      restaurantId: data.restaurantId,
    });

    // Before any database work: the cheapest request to serve is the one a
    // flooder never gets to pay for.
    await enforceGuestOrderThrottle(c, data.restaurantId);

    const db = createDatabase(c.env.DB);

    // 1. Query restaurant and check allowGuestOrders
    const restaurant = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, data.restaurantId))
      .get();

    if (!restaurant) {
      throw notFound("Restaurant not found");
    }

    if (!restaurant.isActive || !restaurant.isAvailable) {
      throw badRequest("Restaurant is currently unavailable");
    }

    const settings = restaurant.settings as Record<string, unknown> | null;
    if (!settings || settings.allowGuestOrders !== true) {
      throw forbidden("Guest orders are not enabled for this restaurant");
    }

    // Shop orders ride the shop QR channel, which the owner can switch off.
    // Reuses the row already loaded above rather than re-reading it.
    if (data.orderType === "shop") {
      assertShopModeEnabled(restaurant.enableShopMode);
      assertShopQrCurrent(restaurant.shopQrCode, data.shopQrCode);
    }

    // 2. Check active order limit for this device when it already carries an
    // identity. Brand-new anonymous guests have none yet; using IP here
    // incorrectly makes a restaurant's shared WiFi/CGNAT address the lock.
    const requestLockIdentity = resolveGuestLockIdentity(c.req);
    const existingActiveOrderKey = requestLockIdentity
      ? guestActiveOrderKey(data.restaurantId, requestLockIdentity)
      : null;
    const existingActiveOrder = existingActiveOrderKey
      ? await c.env.CACHE_KV.get(existingActiveOrderKey)
      : null;
    if (existingActiveOrder) {
      if (data.clientMutationId) {
        const duplicateMutation = await db
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.restaurantId, data.restaurantId),
              eq(orders.clientMutationId, data.clientMutationId),
            ),
          )
          .get();

        if (duplicateMutation) {
          throw conflict(
            "Client mutation has already been processed",
            "CLIENT_MUTATION_DUPLICATE",
          );
        }
      }

      throw new ApiError(
        "ACTIVE_GUEST_ORDER_EXISTS",
        "You already have an active order at this restaurant. Please wait for it to complete.",
        429,
      );
    }

    // 3. Validate table/seat if needed
    if (data.orderType === "table" || data.orderType === "seat") {
      const table = await db
        .select()
        .from(tables)
        .where(eq(tables.id, data.tableId!))
        .get();

      if (!table || String(table.restaurantId) !== data.restaurantId) {
        throw badRequest(
          "Table not found or does not belong to this restaurant",
        );
      }
    }

    if (data.orderType === "seat") {
      const seat = await db
        .select()
        .from(seats)
        .where(eq(seats.id, data.seatId!))
        .get();

      if (!seat || seat.tableId !== data.tableId) {
        throw badRequest("Seat not found or does not belong to this table");
      }
    }

    // 4. Create order via OrdersService
    const fulfillmentType =
      data.deliveryInfo?.type ??
      (data.orderType === "shop" ? "takeaway" : "dine_in");

    const ordersService = new OrdersService(c.env);
    let order;
    try {
      order = await ordersService.createOrder({
        restaurantId: data.restaurantId,
        customerId: customer?.id,
        // Only pass tableId for table/seat orders — shop orders don't need a table
        tableId: data.orderType === "shop" ? undefined : data.tableId,
        waitingListId: data.waitingListId,
        waitingListCustomerPhone: data.customerPhone,
        customerInfo: {
          name: data.guestName,
        },
        items: data.items.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          customizations: item.customizations,
          notes: item.notes,
        })),
        notes: data.notes,
        clientMutationId: data.clientMutationId,
        orderType: data.orderType,
        deliveryInfo: {
          type: fulfillmentType,
          address: data.deliveryInfo?.address,
          phone: data.deliveryInfo?.phone,
          instructions: data.deliveryInfo?.instructions,
          deliveryFee: data.deliveryInfo?.deliveryFee,
        },
        isGuestOrder: true,
      });
    } catch (error) {
      // The database service now rejects its own business rules as ApiErrors
      // (#352), so they arrive complete with code, status and details. Rewrap
      // one here and the details are lost and the status is decided twice.
      //
      // This replaces the `/^Menu item \d+ is not available$/` arm that used to
      // live here: `prepareOrderItems` was its only producer and it now throws
      // ApiError("MENU_ITEM_UNAVAILABLE", …, 409) itself — the same code and
      // status this arm was assigning, plus the menu item id in details.
      if (error instanceof ApiError) throw error;

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

    // 5. Generate guest token and store in KV
    const guestToken = generateGuestToken();
    const tokenData: GuestTokenData = {
      orderId: String(order.id),
      restaurantId: data.restaurantId,
      guestName: data.guestName,
      createdAt: Date.now(),
    };

    const fourHoursInSeconds = 4 * 60 * 60;
    await c.env.CACHE_KV.put(
      `guest_token:${guestToken}`,
      JSON.stringify(tokenData),
      { expirationTtl: fourHoursInSeconds },
    );

    // 6. Set active order KV key (2hr TTL). A device that presented no identity
    // gets its lock keyed on the token minted just above — the customer app
    // stores that token, so its next order arrives holding the matching key.
    const twoHoursInSeconds = 2 * 60 * 60;
    const activeOrderKey = guestActiveOrderKey(
      data.restaurantId,
      requestLockIdentity ?? { kind: "token", value: guestToken },
    );
    await c.env.CACHE_KV.put(activeOrderKey, String(order.id), {
      expirationTtl: twoHoursInSeconds,
    });
    // Reverse mapping so any cancel path (admin DELETE, guest cancel, cleanup
    // jobs) can locate and clear the active-order key from the order id alone.
    await c.env.CACHE_KV.put(
      `guest_active_lookup:${order.id}`,
      activeOrderKey,
      {
        expirationTtl: twoHoursInSeconds,
      },
    );
    await meterEmit(c, "orders.created", {
      restaurantId: data.restaurantId,
      metadata: { orderId: order.id, source: "guest-orders" },
    });

    // 7. Return order + guestToken
    const tokenExpiresAt = new Date(
      Date.now() + fourHoursInSeconds * 1000,
    ).toISOString();
    return c.json(
      {
        success: true,
        data: {
          order,
          guestToken,
          tokenExpiresAt,
        },
      },
      201,
    );
  },
);

// ─── GET /:id ─── View guest order (guest token required) ───
app.get("/:id", guestTokenAuth, async (c) => {
  const orderId = c.req.param("id");
  if (!orderId) throw badRequest("Missing order id");

  const ordersService = new OrdersService(c.env);
  const order = await ordersService.getOrder(orderId, true);

  if (!order) {
    throw notFound("Order not found");
  }

  return c.json({ success: true, data: { order } });
});

// ─── POST /:id/items ─── Add items to guest order (guest token required) ───
app.post(
  "/:id/items",
  guestTokenAuth,
  validateBody(addGuestOrderItemsSchema),
  async (c) => {
    const orderId = c.req.param("id");
    if (!orderId) throw badRequest("Missing order id");
    const data = c.get("validatedBody");

    const ordersService = new OrdersService(c.env);
    const order = await ordersService.getOrder(orderId, true);

    if (!order) {
      throw notFound("Order not found");
    }

    // Only allow adding items to pending or confirmed orders
    const status = String(order.status).toLowerCase();
    if (status !== "pending" && status !== "confirmed") {
      throw badRequest(`Cannot add items to an order with status: ${status}`);
    }

    // Enforce guest item limit (20 total)
    const existingItemCount = order.items?.length ?? 0;
    if (existingItemCount + data.items.length > 20) {
      throw badRequest("Guest orders cannot exceed 20 items total");
    }

    const updatedOrder = await ordersService.addItemsToOrder(
      orderId,
      data.items,
    );

    return c.json({
      success: true,
      data: { order: updatedOrder },
      message: "Items added successfully",
    });
  },
);

// ─── POST /:id/cancel ─── Cancel guest order (guest token required) ───
app.post("/:id/cancel", guestTokenAuth, async (c) => {
  const orderId = c.req.param("id");
  if (!orderId) throw badRequest("Missing order id");

  const ordersService = new OrdersService(c.env);
  const order = await ordersService.getOrder(orderId, false);

  if (!order) {
    throw notFound("Order not found");
  }

  // Only allow cancelling pending or confirmed orders
  const status = String(order.status).toLowerCase();
  if (status !== "pending" && status !== "confirmed") {
    throw badRequest(`Cannot cancel an order with status: ${status}`);
  }

  const cancelledOrder = await ordersService.cancelOrder(
    orderId,
    "Cancelled by guest",
  );

  // Clean up KV keys. The active-order lock is keyed by whatever identity the
  // device held when the order was created, so resolve it via the
  // `guest_active_lookup:{orderId}` reverse mapping written at creation (same
  // as the admin cancel path). Fall back to rebuilding the key from the
  // identity this request presents — usually the same one.
  const guestData = c.get("guestOrder");
  const requestLockIdentity = resolveGuestLockIdentity(c.req);
  const lookupKey = `guest_active_lookup:${orderId}`;
  const activeOrderKey =
    (await c.env.CACHE_KV.get(lookupKey)) ??
    (requestLockIdentity
      ? guestActiveOrderKey(guestData.restaurantId, requestLockIdentity)
      : null);
  await Promise.allSettled([
    activeOrderKey ? c.env.CACHE_KV.delete(activeOrderKey) : Promise.resolve(),
    c.env.CACHE_KV.delete(lookupKey),
  ]);

  // Also remove guest token to prevent further access
  const authHeader = c.req.header("Authorization");
  if (authHeader) {
    const token = authHeader.substring(7);
    await c.env.CACHE_KV.delete(`guest_token:${token}`);
  }

  return c.json({
    success: true,
    data: { order: cancelledOrder },
    message: "Order cancelled successfully",
  });
});

export default app;
