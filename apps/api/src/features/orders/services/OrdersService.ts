/**
 * Orders Service
 * Comprehensive business logic for order management
 */

import {
  AUDIT_ACTIONS,
  auditLogs,
  createDatabase,
  OrderService as BaseOrderService,
  CouponService,
  INVALID_CUSTOMIZATION_PREFIX,
} from "@makanmasak/database";
import {
  Order,
  OrderStatus,
  OrderPaymentStatus,
  OrderPaymentMethod,
  RealtimeEventType,
} from "@makanmasak/shared-types";
import {
  ApiError,
  badRequest,
  notFound,
  forbidden,
  conflict,
} from "../../../shared/utils/api-error";
import type { Env } from "../../../shared/types";
import type { UserRole } from "../../../shared/constants";
import { ConsoleLogger } from "../../../core/monitoring";
import { RealtimeBroadcastService } from "@makanmasak/database";
import type {
  OrderCancelledEvent,
  NewOrderEvent,
} from "@makanmasak/shared-types";
import { RestaurantOrderPushService } from "../../push/services/RestaurantOrderPushService";
import { ReceiptService } from "../../pos/services/ReceiptService";
import { ORDER_STATUS_TRANSITIONS, ROLE_STATUS_PERMISSIONS } from "../types";
import {
  clearGuestActiveOrderLock,
  finalizeOrderStatusSideEffects,
  invalidateOrderCache as invalidateOrderCacheKeys,
} from "./order-finalization";
import type {
  CreateOrderData,
  OrderStatusUpdateData,
  OrderQueryFilters,
  OrderSearchParams,
  OrderAnalytics,
  OrderStats,
  CouponValidation,
  CouponPreviewRequest,
  OrderUpdateEvent,
  BulkOrderOperation,
  BulkOrderResult,
  OrderReceipt,
  PaymentIntegration,
  IOrdersService,
  CallerContext,
  SelectedCustomizations,
} from "../types";

// Minimal KV surface used by this service.
interface KVLike {
  get(key: string, type?: "json"): Promise<unknown>;
  list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>;
  }>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

/**
 * Turn the base service's plain Errors into the unified ApiError shape.
 *
 * `handleError` in the database package rethrows Errors carrying a message and
 * nothing else, so the message is the only signal available here. Each arm
 * maps to the status the admin UI has to distinguish: 409 means "reload and
 * try again", 400 means "this order will never accept the edit".
 */
function mapOrderItemMutationError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  // Already an ApiError from the guards above; passing it through a second
  // mapping would relabel a 403 as a 400.
  if (error instanceof ApiError) return error;

  const message = error.message;
  if (message.includes("Order version conflict")) {
    return conflict(
      "Order was updated by another actor. Reload before retrying.",
      "ORDER_VERSION_CONFLICT",
    );
  }
  if (message.includes("Insufficient inventory")) {
    return conflict(
      "Not enough stock for the requested quantity",
      "INSUFFICIENT_INVENTORY",
    );
  }
  if (message.includes("Cannot modify items")) {
    return badRequest(message, "ORDER_NOT_MODIFIABLE");
  }
  if (message.includes("Cannot remove the last item")) {
    return badRequest(message, "ORDER_LAST_ITEM");
  }
  if (message.includes("Order item not found")) {
    return notFound("Order item not found", "ORDER_ITEM_NOT_FOUND");
  }
  if (message.includes("Order not found")) {
    return notFound("Order not found", "ORDER_NOT_FOUND");
  }
  if (message.includes("Discount percent must be")) {
    return badRequest(message, "INVALID_DISCOUNT_PERCENT");
  }
  if (message.includes("already carries a coupon discount")) {
    return badRequest(
      "This order already carries a coupon discount",
      "ORDER_HAS_COUPON_DISCOUNT",
    );
  }
  return error;
}

/**
 * The indexed `audit_logs.action` value for each order event this service
 * emits. Anything unmapped falls back to OTHER rather than inventing a value,
 * and the exact event is preserved in `changes.metadata.event` either way.
 */
const ORDER_AUDIT_ACTIONS: Readonly<Record<string, string>> = {
  ORDER_CREATED: AUDIT_ACTIONS.ORDER_CREATE,
  ORDER_ITEMS_ADDED: AUDIT_ACTIONS.ORDER_UPDATE,
  ORDER_ITEM_QUANTITY_CHANGED: AUDIT_ACTIONS.ORDER_UPDATE,
  ORDER_ITEM_REMOVED: AUDIT_ACTIONS.ORDER_UPDATE,
  ORDER_DISCOUNT_APPLIED: AUDIT_ACTIONS.ORDER_UPDATE,
  ORDER_CANCELLED: AUDIT_ACTIONS.ORDER_CANCEL,
  ORDER_DELETED: AUDIT_ACTIONS.ORDER_CANCEL,
};

export class OrdersService implements IOrdersService {
  private baseOrderService: BaseOrderService;
  private couponService: CouponService;
  private realtimeBroadcastService: RealtimeBroadcastService;
  private orderPushService: RestaurantOrderPushService;
  // Loose KV interface; only the methods we actually call are typed.
  private cacheKV: KVLike;
  private logger: ConsoleLogger;
  private env: Env;

  constructor(env: Env) {
    this.env = env;
    this.baseOrderService = new BaseOrderService(env.DB, env);
    this.couponService = new CouponService(env.DB, env);
    this.realtimeBroadcastService = new RealtimeBroadcastService(env);
    this.orderPushService = new RestaurantOrderPushService(env);
    this.cacheKV = env.CACHE_KV;
    this.logger = new ConsoleLogger("OrdersService");
  }

  // Core CRUD Operations
  async createOrder(data: CreateOrderData, userId?: string): Promise<Order> {
    try {
      this.logger.info("Creating new order", {
        restaurantId: data.restaurantId,
        userId,
      });

      // Defence-in-depth: validate inputs even though Zod schemas cover the route layer.
      // Guards against direct service calls bypassing route validation.

      // Validate restaurant ID
      if (!data.restaurantId) {
        throw badRequest("Invalid restaurant ID", "INVALID_RESTAURANT_ID");
      }

      // Validate items
      if (!data.items || data.items.length === 0) {
        throw badRequest(
          "Order must contain at least one item",
          "EMPTY_ORDER_ITEMS",
        );
      }
      if (data.items.length > 100) {
        throw badRequest(
          "Order cannot exceed 100 items",
          "TOO_MANY_ORDER_ITEMS",
        );
      }

      // Validate each item
      for (const item of data.items) {
        if (!item.menuItemId || item.menuItemId <= 0) {
          throw badRequest("Invalid menu item ID", "INVALID_MENU_ITEM_ID");
        }
        if (!item.quantity || item.quantity <= 0) {
          throw badRequest("Invalid item quantity", "INVALID_ITEM_QUANTITY");
        }
        if (item.quantity > 999) {
          throw badRequest(
            "Invalid item quantity: cannot exceed 999",
            "ITEM_QUANTITY_EXCEEDED",
          );
        }
      }

      // Validate phone format
      if (
        data.customerInfo?.phone &&
        !/^[\d\s\-+()]{7,20}$/.test(data.customerInfo.phone)
      ) {
        throw badRequest("Invalid phone number format", "INVALID_PHONE_FORMAT");
      }

      // Validate email format
      if (
        data.customerInfo?.email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.customerInfo.email)
      ) {
        throw badRequest("Invalid email format", "INVALID_EMAIL_FORMAT");
      }

      // Validate notes length
      if (data.notes && data.notes.length > 1000) {
        throw badRequest(
          "Order notes cannot exceed 1000 characters",
          "NOTES_TOO_LONG",
        );
      }

      // Validate coupon code format
      if (data.couponCode && data.couponCode.length < 3) {
        throw badRequest(
          "Invalid coupon code format",
          "INVALID_COUPON_CODE_FORMAT",
        );
      }

      // Convert feature-specific data to base service format
      const baseOrderData = {
        restaurantId: String(data.restaurantId),
        tableId: data.tableId ?? undefined, // undefined for shop/takeaway orders (no table needed)
        customerId: data.customerId, // Keep as number
        waitingListId: data.waitingListId,
        waitingListCustomerPhone: data.waitingListCustomerPhone,
        orderType: data.orderType,
        customerInfo: data.customerInfo,
        items: data.items.map((item) => ({
          menuItemId: item.menuItemId, // Keep as number
          quantity: item.quantity,
          customizations: item.customizations as
            | SelectedCustomizations
            | undefined,
          notes: item.notes,
        })),
        notes: data.notes,
        couponCode: data.couponCode,
        couponUserId: userId,
        clientMutationId: data.clientMutationId,
        orderSource: data.orderSource,
        deliveryInfo: data.deliveryInfo,
      };

      // Create order using base service
      const order = await this.baseOrderService.createOrder(baseOrderData);

      // Cache the order
      await Promise.all([
        this.cacheOrder(order),
        this.logOrderActivity(
          order.id,
          "ORDER_CREATED",
          userId,
          {
            itemCount: data.items.length,
            total: order.totalAmount,
          },
          data.restaurantId,
        ),
        data.waitingListId ? Promise.resolve() : this.broadcastNewOrder(order),
        data.waitingListId ? Promise.resolve() : this.notifyNewOrderPush(order),
      ]);

      this.logger.info("Order created successfully", {
        orderId: order.id,
        orderNumber: order.orderNumber,
      });
      return order;
    } catch (error) {
      if (error instanceof Error) {
        // A selection the catalog refuses — an unanswered required group, or
        // more choices than the group allows. It is the request that is wrong,
        // so it must not surface as a 500.
        if (error.message.startsWith(INVALID_CUSTOMIZATION_PREFIX)) {
          throw badRequest(error.message, "INVALID_CUSTOMIZATION");
        }
        if (error.message === "DELIVERY_NOT_ENABLED") {
          throw badRequest("此店家未開放外送", "DELIVERY_NOT_ENABLED");
        }
        if (error.message === "WAITING_LIST_PREORDER_EXISTS") {
          throw conflict(
            "A pre-order already exists for this waiting-list ticket",
            "WAITING_LIST_PREORDER_EXISTS",
          );
        }
        if (error.message === "WAITING_LIST_TICKET_NOT_FOUND") {
          throw notFound(
            "Waiting-list ticket not found",
            "WAITING_LIST_TICKET_NOT_FOUND",
          );
        }
        if (error.message === "WAITING_LIST_TICKET_NOT_ACTIVE") {
          throw conflict(
            "Waiting-list ticket is no longer active",
            "WAITING_LIST_TICKET_NOT_ACTIVE",
          );
        }
        if (error.message === "WAITING_LIST_PHONE_MISMATCH") {
          throw forbidden(
            "Waiting-list phone verification failed",
            "WAITING_LIST_PHONE_MISMATCH",
          );
        }
      }

      this.logger.error(
        "Failed to create order",
        error instanceof Error ? error : undefined,
        { data },
      );
      throw error;
    }
  }

  async getOrder(
    id: string,
    includeItems: boolean = true,
    caller?: CallerContext,
  ): Promise<Order | null> {
    try {
      // Try cache first
      const cacheKey = `order:${id}:${includeItems ? "full" : "basic"}`;
      const cached = (await this.cacheKV.get(cacheKey, "json")) as Order | null;
      if (cached) {
        this.assertRestaurantAccess(cached, caller);
        return cached;
      }

      // Get from base service
      const order = await this.baseOrderService.getOrder(id);
      if (!order) return null;

      // Defence-in-depth: verify caller has access to this order's restaurant
      this.assertRestaurantAccess(order, caller);

      // Cache the result
      await this.cacheKV.put(cacheKey, JSON.stringify(order), {
        expirationTtl: 300,
      }); // 5 minutes

      return order;
    } catch (error) {
      this.logger.error(
        "Failed to get order",
        error instanceof Error ? error : undefined,
        { orderId: id },
      );
      throw error;
    }
  }

  async claimDelivery(
    id: string,
    userId: string,
    caller?: CallerContext,
  ): Promise<Order | null> {
    const order = await this.getOrder(id);
    if (!order) return null;
    this.assertRestaurantAccess(order, caller);

    const claimed = await this.baseOrderService.claimDelivery(id, userId);
    if (!claimed) {
      throw conflict(
        "Order is no longer available for delivery",
        "DELIVERY_ALREADY_CLAIMED",
      );
    }
    await invalidateOrderCacheKeys(this.cacheKV, id);
    return claimed;
  }

  async getOrders(
    filters: OrderQueryFilters,
    userId?: string,
    userRole?: UserRole,
    caller?: CallerContext,
  ): Promise<{
    orders: Order[];
    total: number;
    pagination: { page: number; limit: number; totalPages: number };
  }> {
    try {
      // Apply permission-based filtering (defence-in-depth: overrides restaurantId for non-admin)
      const permissionFilters = await this.applyPermissionFilters(
        filters,
        userId,
        userRole,
        caller,
      );

      // Convert to base service format
      const baseFilters = this.convertToBaseFilters(permissionFilters);

      // Get orders from base service
      const result = await this.baseOrderService.getOrders(
        baseFilters,
        filters.page || 1,
        filters.limit || 20,
      );

      // Apply additional filtering and sorting
      let orders = result.orders;

      // Defence-in-depth: strip any orders that don't match the requested restaurant
      // Only filter orders that have a restaurantId field.
      if (permissionFilters.restaurantId) {
        orders = orders.filter(
          (o) =>
            !o.restaurantId ||
            o.restaurantId === permissionFilters.restaurantId,
        );
      }

      return {
        orders,
        total: result.pagination.total,
        pagination: result.pagination,
      };
    } catch (error) {
      this.logger.error(
        "Failed to get orders",
        error instanceof Error ? error : undefined,
        { filters },
      );
      throw error;
    }
  }

  async addItemsToOrder(
    id: string,
    items: CreateOrderData["items"],
    userId?: string,
    expectedVersion?: number,
  ): Promise<Order> {
    try {
      this.logger.info("Adding items to order", {
        orderId: id,
        itemCount: items.length,
        userId,
      });

      const updatedOrder = await this.baseOrderService.addItemsToOrder(
        id,
        items.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          customizations: item.customizations as
            | SelectedCustomizations
            | undefined,
          notes: item.notes,
        })),
        expectedVersion,
      );

      await Promise.all([
        this.invalidateOrderCache(id),
        this.logOrderActivity(
          id,
          "ORDER_ITEMS_ADDED",
          userId,
          {
            itemCount: items.length,
            addedItems: items.map((item) => ({
              menuItemId: item.menuItemId,
              quantity: item.quantity,
            })),
            totalAfter: updatedOrder.totalAmount,
          },
          updatedOrder.restaurantId,
        ),
        this.broadcastNewOrder(updatedOrder),
      ]);

      return updatedOrder;
    } catch (error) {
      this.logger.error(
        "Failed to add items to order",
        error instanceof Error ? error : undefined,
        { orderId: id, itemCount: items.length },
      );
      throw mapOrderItemMutationError(error);
    }
  }

  /**
   * Apply an order-level discount at the counter.
   *
   * The percentage arrives from the till; the money does not. This computes the
   * figure from the order's own stored subtotal, tax and service charge, so a
   * tampered or merely stale client cannot decide what an order costs -- the
   * same rule `calculateOrderTotal`'s callers already follow for customer
   * requests (#295).
   *
   * Refused when the order carries a coupon. `orders.discount_amount_cents` is
   * one column for one figure, and the coupon path already owns it; writing a
   * manual discount over it would silently cancel the customer's coupon and
   * leave `coupon_code` claiming otherwise. Splitting the two is a schema
   * change, so until then the counter has to void and re-ring (#327).
   */
  async applyOrderDiscount(
    id: string,
    discountPercent: number,
    reason: string,
    userId?: string,
    expectedVersion?: number,
  ): Promise<Order> {
    try {
      const order = await this.getOrder(id);
      if (!order) {
        throw notFound("Order not found");
      }
      this.logger.info("Applying order discount", {
        orderId: id,
        discountPercent,
        userId,
      });

      // The percentage goes down as a percentage: the base service holds the
      // order's cents and derives the money there, so nothing in this layer
      // can put a rounded float into a price.
      const updatedOrder = await this.baseOrderService.applyOrderDiscount(
        id,
        discountPercent,
        expectedVersion,
      );

      await Promise.all([
        this.invalidateOrderCache(id),
        this.logOrderActivity(
          id,
          "ORDER_DISCOUNT_APPLIED",
          userId,
          {
            discountPercent,
            reason,
            totalBefore: order.totalAmount,
            totalAfter: updatedOrder.totalAmount,
            discountAfter: updatedOrder.discountAmount,
          },
          updatedOrder.restaurantId,
        ),
        this.broadcastNewOrder(updatedOrder),
      ]);

      return updatedOrder;
    } catch (error) {
      this.logger.error(
        "Failed to apply order discount",
        error instanceof Error ? error : undefined,
        { orderId: id, discountPercent },
      );
      throw mapOrderItemMutationError(error);
    }
  }

  /**
   * Change one line's quantity, or remove it when `newQuantity` is 0.
   *
   * The realtime side deliberately reuses `broadcastNewOrder`. The kitchen
   * display's handler upserts by order id (`stores/orders.ts` handleNewOrder),
   * so the full, corrected item list replaces what the screen was holding --
   * and the accompanying chime is wanted here, because a modified order is
   * exactly the thing the kitchen must re-read.
   * ponytail: reuses the existing event rather than adding an ORDER_MODIFIED
   * type nothing subscribes to yet. Add one when a client needs to tell a
   * modification from an arrival.
   */
  async changeOrderItemQuantity(
    id: string,
    orderItemId: number,
    newQuantity: number,
    options: {
      userId?: string;
      expectedVersion?: number;
      caller?: CallerContext;
    } = {},
  ): Promise<Order> {
    const { userId, expectedVersion, caller } = options;
    try {
      const existing = await this.getOrder(id);
      if (!existing) {
        throw notFound("Order not found", "ORDER_NOT_FOUND");
      }
      this.assertRestaurantAccess(existing, caller);

      const before = existing.items?.find((item) => item.id === orderItemId);
      if (!before) {
        throw notFound("Order item not found", "ORDER_ITEM_NOT_FOUND");
      }

      this.logger.info("Changing order item quantity", {
        orderId: id,
        orderItemId,
        from: before.quantity,
        to: newQuantity,
        userId,
      });

      const updatedOrder = await this.baseOrderService.changeOrderItemQuantity(
        id,
        orderItemId,
        newQuantity,
        expectedVersion,
      );

      await Promise.all([
        this.invalidateOrderCache(id),
        this.logOrderActivity(
          id,
          newQuantity === 0
            ? "ORDER_ITEM_REMOVED"
            : "ORDER_ITEM_QUANTITY_CHANGED",
          userId,
          {
            orderItemId,
            menuItemId: before.menuItemId,
            menuItemName: before.name ?? before.menuItem?.name,
            quantityBefore: before.quantity,
            quantityAfter: newQuantity,
            totalBefore: existing.totalAmount,
            totalAfter: updatedOrder.totalAmount,
          },
          updatedOrder.restaurantId,
        ),
        this.broadcastNewOrder(updatedOrder),
      ]);

      return updatedOrder;
    } catch (error) {
      this.logger.error(
        "Failed to change order item quantity",
        error instanceof Error ? error : undefined,
        { orderId: id, orderItemId, newQuantity },
      );
      throw mapOrderItemMutationError(error);
    }
  }

  async deleteOrder(id: string, userId?: string): Promise<boolean> {
    try {
      const order = await this.getOrder(id);
      if (!order) return false;

      // Only allow deletion of pending orders
      if (String(order.status) !== "pending") {
        throw conflict(
          "Only pending orders can be deleted",
          "ORDER_NOT_DELETABLE",
        );
      }

      // Use base service cancel method
      await this.baseOrderService.cancelOrder(id, "Order deleted");

      // Clear cache
      await this.invalidateOrderCache(id);

      // Log activity
      await this.logOrderActivity(
        id,
        "ORDER_DELETED",
        userId,
        undefined,
        order.restaurantId,
      );

      return true;
    } catch (error) {
      this.logger.error(
        "Failed to delete order",
        error instanceof Error ? error : undefined,
        { orderId: id },
      );
      throw error;
    }
  }

  // Order Item Status
  async updateItemStatus(
    itemId: number,
    status: string,
    notes?: string,
  ): Promise<void> {
    try {
      await this.baseOrderService.updateOrderItemStatus(itemId, status, notes);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Order item status conflict")
      ) {
        throw conflict(
          "Order item was already updated. Reload before retrying.",
          "ORDER_ITEM_STATUS_CONFLICT",
        );
      }
      throw error;
    }
  }

  // Status Management
  async updateOrderStatus(
    id: string,
    statusData: OrderStatusUpdateData,
    userId?: string,
    userRole?: UserRole,
    caller?: CallerContext,
    /** Pre-fetched order to avoid redundant DB lookups */
    prefetchedOrder?: Order,
  ): Promise<Order | null> {
    try {
      const order = prefetchedOrder ?? (await this.getOrder(id));
      if (!order) return null;
      if (prefetchedOrder && prefetchedOrder.id !== id) {
        throw badRequest("Prefetched order ID mismatch", "ORDER_ID_MISMATCH");
      }

      this.assertRestaurantAccess(order, caller);

      if (
        statusData.status === "delivered" &&
        userRole !== 1 &&
        order.deliveryAssignedTo !== userId
      ) {
        throw forbidden(
          "Only the service crew member who claimed this delivery can complete it",
          "DELIVERY_CLAIM_REQUIRED",
        );
      }

      // Validate status transition
      this.validateStatusTransition(order.status, statusData.status, userRole);

      // Update using base service
      let updatedOrder;
      try {
        updatedOrder = await this.baseOrderService.updateOrderStatus(id, {
          status: statusData.status,
          notes: statusData.notes,
          expectedVersion: order.version,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Order version conflict")
        ) {
          throw conflict(
            "Order was updated by another actor. Reload before retrying.",
            "ORDER_VERSION_CONFLICT",
          );
        }
        throw error;
      }

      if (!updatedOrder) {
        throw new Error("Failed to update order status");
      }

      if (statusData.status === "confirmed") {
        await this.emitKitchenTicket(id);
      }

      await finalizeOrderStatusSideEffects({
        env: this.env,
        order: updatedOrder,
        previousStatus: order.status,
        newStatus: statusData.status,
        updatedBy: userId,
        updatedByRole: userId ? "admin" : "system",
        notes: statusData.notes,
        estimatedReadyTime: statusData.estimatedReadyTime,
      });

      return updatedOrder;
    } catch (error) {
      this.logger.error(
        "Failed to update order status",
        error instanceof Error ? error : undefined,
        { orderId: id },
      );
      throw error;
    }
  }

  async cancelOrder(
    id: string,
    reason: string,
    userId?: string,
    caller?: CallerContext,
    /** Pre-fetched order to avoid redundant DB lookups */
    prefetchedOrder?: Order,
  ): Promise<Order | null> {
    try {
      // Defence-in-depth: verify caller has access before cancelling
      if (caller) {
        const order = prefetchedOrder ?? (await this.getOrder(id));
        if (order) {
          this.assertRestaurantAccess(order, caller);
        }
      }

      const cancelledOrder = await this.baseOrderService.cancelOrder(
        id,
        reason,
      );

      if (cancelledOrder) {
        await Promise.all([
          // The database service claims the usage row with its existing
          // refund-release marker, making retries a no-op before decrementing
          // the coupon counter.
          this.couponService.releaseUsageForCancelledOrder(id),
          this.invalidateOrderCache(id),
          clearGuestActiveOrderLock(this.cacheKV, id),
          this.logOrderActivity(
            id,
            "ORDER_CANCELLED",
            userId,
            { reason },
            cancelledOrder.restaurantId,
          ),
          this.broadcastOrderCancelled(
            cancelledOrder,
            reason,
            userId ?? "system",
          ),
        ]);
      }

      return cancelledOrder;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Order cannot be cancelled"
      ) {
        throw conflict("Order cannot be cancelled", "ORDER_NOT_CANCELLABLE");
      }

      this.logger.error(
        "Failed to cancel order",
        error instanceof Error ? error : undefined,
        { orderId: id },
      );
      throw error;
    }
  }

  async getOrderStatusHistory(id: string): Promise<
    Array<{
      status: OrderStatus;
      timestamp: Date;
      updatedBy?: string;
      notes?: string;
    }>
  > {
    try {
      // This would require implementing audit log tracking in base service
      // For now, return a basic implementation
      const order = await this.getOrder(id);
      if (!order) return [];

      return [
        {
          status: order.status,
          timestamp: new Date(order.updatedAt),
          notes: order.notes,
        },
      ];
    } catch (error) {
      this.logger.error(
        "Failed to get order status history",
        error instanceof Error ? error : undefined,
        { orderId: id },
      );
      return [];
    }
  }

  // Payment Operations
  async updatePaymentStatus(
    id: string,
    _paymentStatus: OrderPaymentStatus,
    _paymentMethod?: OrderPaymentMethod,
    _transactionData?: PaymentIntegration,
  ): Promise<Order | null> {
    try {
      // This would require extending base service or direct database access
      const order = await this.getOrder(id);
      if (!order) return null;

      // Update payment information
      // Implementation would depend on base service capabilities

      await this.invalidateOrderCache(id);

      return order;
    } catch (error) {
      this.logger.error(
        "Failed to update payment status",
        error instanceof Error ? error : undefined,
        { orderId: id },
      );
      throw error;
    }
  }

  // Analytics and Reporting
  async getOrderAnalytics(
    filters: OrderQueryFilters,
    _userId?: string,
    _caller?: CallerContext,
  ): Promise<OrderAnalytics> {
    try {
      const cacheKey = `analytics:${JSON.stringify(filters)}`;
      const cached = (await this.cacheKV.get(
        cacheKey,
        "json",
      )) as OrderAnalytics | null;
      if (cached) return cached;

      // Get basic stats from base service
      const restaurantId = filters.restaurantId;
      if (!restaurantId) {
        throw badRequest(
          "Restaurant ID required for analytics",
          "RESTAURANT_ID_REQUIRED",
        );
      }

      const dailyStats = await this.baseOrderService.getDailyOrderStats(
        String(restaurantId),
        new Date(),
      );

      // Build comprehensive analytics
      const analytics: OrderAnalytics = {
        summary: {
          totalOrders: dailyStats.totalOrders,
          totalRevenue: dailyStats.totalRevenue,
          averageOrderValue: dailyStats.avgOrderValue,
          averagePreparationTime: 0, // Add when available in base service
          orderCompletionRate: 0.95, // Calculate from actual data
          customerRetentionRate: 0.75, // Calculate from actual data
        },
        byStatus: [],
        byPaymentStatus: [],
        byOrderType: [],
        byTime: {
          hourly: [],
          daily: [],
          weekly: [],
          monthly: [],
        },
        topItems: [],
        customerAnalytics: {
          newCustomers: 0,
          returningCustomers: 0,
          averageOrdersPerCustomer: 0,
          customerLifetimeValue: 0,
        },
        performanceMetrics: {
          averageOrderProcessingTime: 0,
          peakHours: [],
          busyDays: [],
          orderAccuracy: 0.98,
          cancellationRate: 0.05,
        },
      };

      // Cache for 15 minutes
      await this.cacheKV.put(cacheKey, JSON.stringify(analytics), {
        expirationTtl: 900,
      });

      return analytics;
    } catch (error) {
      this.logger.error(
        "Failed to get order analytics",
        error instanceof Error ? error : undefined,
        {},
      );
      throw error;
    }
  }

  async getOrderStatistics(
    restaurantId: string,
    _filters?: OrderQueryFilters,
  ): Promise<OrderStats> {
    const baseStats =
      await this.baseOrderService.getOrderStatistics(restaurantId);
    return {
      ...baseStats,
      readyOrders: 0,
      averageOrderValue: baseStats.avgOrderValue,
      averagePreparationTime: 0,
    };
  }

  async getActiveOrders(restaurantId: string): Promise<Order[]> {
    const filters: OrderQueryFilters = {
      restaurantId,
      // DB stores status as text — must use string literals matching the schema
      status: ["pending", "confirmed", "preparing", "ready"],
      limit: 100,
    };
    const result = await this.getOrders(filters);
    return result.orders;
  }

  async getDailyStats(restaurantId: string, date?: Date): Promise<OrderStats> {
    try {
      const baseStats = await this.baseOrderService.getDailyOrderStats(
        restaurantId,
        date || new Date(),
      );
      return {
        ...baseStats,
        preparingOrders: 0, // Add when available
        readyOrders: 0, // Add when available
        averageOrderValue: baseStats.avgOrderValue,
        averagePreparationTime: 0, // Add when available
      };
    } catch (error) {
      this.logger.error(
        "Failed to get daily stats",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async getPopularItems(
    restaurantId: string,
    timeRange?: string,
  ): Promise<
    Array<{
      menuItemId: number;
      name: string;
      quantity: number;
      revenue: number;
    }>
  > {
    try {
      const cacheKey = `popular-items:${restaurantId}:${timeRange || "month"}`;
      const cached = (await this.cacheKV.get(cacheKey, "json")) as Array<{
        menuItemId: number;
        name: string;
        quantity: number;
        revenue: number;
      }> | null;
      if (cached) return cached;

      // Implementation would require aggregating order items
      const results: Array<{
        menuItemId: number;
        name: string;
        quantity: number;
        revenue: number;
      }> = [];

      await this.cacheKV.put(cacheKey, JSON.stringify(results), {
        expirationTtl: 1800,
      }); // 30 minutes
      return results;
    } catch (error) {
      this.logger.error(
        "Failed to get popular items",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      return [];
    }
  }

  // Search and Filter
  async searchOrders(
    searchParams: OrderSearchParams,
    filters?: OrderQueryFilters,
    userId?: string,
  ): Promise<Order[]> {
    try {
      // Combine search with filters
      const combinedFilters = { ...filters };

      if (searchParams.query) {
        // Add search logic to filters
        // Implementation would depend on search fields
      }

      const result = await this.getOrders(combinedFilters, userId);
      return result.orders;
    } catch (error) {
      this.logger.error(
        "Failed to search orders",
        error instanceof Error ? error : undefined,
        { searchParams },
      );
      return [];
    }
  }

  // Bulk Operations
  async bulkUpdateOrders(
    operation: BulkOrderOperation,
    userId?: string,
    userRole?: UserRole,
    caller?: CallerContext,
  ): Promise<BulkOrderResult> {
    try {
      const batchId =
        operation.batchId ||
        `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const result: BulkOrderResult = {
        batchId,
        totalOrders: operation.orderIds.length,
        successCount: 0,
        failedCount: 0,
        errors: [],
        results: [],
      };

      for (const orderId of operation.orderIds) {
        try {
          let success = false;
          let data: Order | null = null;

          switch (operation.action) {
            case "update_status":
              if (operation.data?.status) {
                const updated = await this.updateOrderStatus(
                  orderId,
                  {
                    status: operation.data.status,
                    notes: operation.data.notes,
                  },
                  userId,
                  userRole,
                  caller,
                );
                success = !!updated;
                data = updated;
              }
              break;

            case "cancel": {
              const cancelled = await this.cancelOrder(
                orderId,
                operation.data?.reason || "Bulk cancellation",
                userId,
                caller,
              );
              success = !!cancelled;
              data = cancelled;
              break;
            }

            default:
              throw badRequest(
                `Unsupported bulk operation: ${operation.action}`,
                "UNSUPPORTED_BULK_OPERATION",
              );
          }

          if (success) {
            result.results.push({ orderId, success: true, data });
            result.successCount++;
          } else {
            // A falsy result that did not throw: cancelOrder returning null
            // for an order it could not find, or an update_status call that
            // reached the service without a status. Counting only the throwing
            // failures left totalOrders !== successCount + failedCount and an
            // empty `errors`, so a caller could not tell a silently skipped
            // batch from a fully applied one.
            const error = "Order not found or could not be actioned";
            result.failedCount++;
            result.errors.push({ orderId, error });
            result.results.push({ orderId, success: false, error });
          }
        } catch (error) {
          result.failedCount++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          result.errors.push({ orderId, error: errorMessage });
          result.results.push({ orderId, success: false, error: errorMessage });
        }
      }

      this.logger.info("Bulk operation completed", { batchId, result });
      return result;
    } catch (error) {
      this.logger.error(
        "Failed to execute bulk operation",
        error instanceof Error ? error : undefined,
        { operation },
      );
      throw error;
    }
  }

  // Coupon and Discount Operations
  async previewCoupon(data: CouponPreviewRequest): Promise<CouponValidation> {
    return this.validateCoupon(data);
  }

  async validateCoupon(data: CouponPreviewRequest): Promise<CouponValidation> {
    try {
      const result = await this.couponService.validateCoupon(
        data.couponCode,
        data.restaurantId.toString(),
        data.orderAmount,
        data.userId,
        data.menuItems,
      );

      return {
        valid: result.valid,
        coupon: result.coupon
          ? {
              code: result.coupon.code,
              name: result.coupon.name,
              discountType: result.coupon.discountType as
                | "percentage"
                | "fixed_amount"
                | "free_item",
              // `discountValue` is derived from nullable cents/bps columns, so a
              // coupon that carries no numeric value — a `free_item` grant — maps
              // to null. The response contract promises a number, and every
              // existing consumer already renders `discountValue || 0`, so
              // collapse it here rather than widening the contract.
              discountValue: result.coupon.discountValue ?? 0,
            }
          : undefined,
        originalAmount: data.orderAmount,
        discountAmount: result.discountAmount || 0,
        finalAmount: result.finalAmount || data.orderAmount,
        savings: result.discountAmount,
        error: result.error,
      };
    } catch (error) {
      this.logger.error(
        "Failed to validate coupon",
        error instanceof Error ? error : undefined,
        { data },
      );
      return {
        valid: false,
        originalAmount: data.orderAmount,
        discountAmount: 0,
        finalAmount: data.orderAmount,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Receipt and Export
  async generateReceipt(orderId: string): Promise<OrderReceipt> {
    try {
      const order = await this.getOrder(orderId, true);
      if (!order) throw notFound("Order not found", "ORDER_NOT_FOUND");

      // Build receipt data
      const receipt: OrderReceipt = {
        orderNumber: order.orderNumber,
        restaurantInfo: {
          id: order.restaurantId,
          name: order.restaurant?.name || "Restaurant",
          address: order.restaurant?.address,
          phone: order.restaurant?.phone,
          email: order.restaurant?.email,
        },
        customerInfo: order.customerInfo || {},
        tableInfo: order.table
          ? {
              id: order.tableId ?? order.table.id,
              number: order.table.number || "N/A",
              seats: order.table.seats || 0,
            }
          : undefined,
        items:
          order.items?.map((item) => ({
            name: item.menuItem?.name || "Unknown Item",
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            customizations: this.formatCustomizations(item.customizations),
            notes: item.notes,
          })) || [],
        summary: {
          subtotal: order.subtotal,
          tax: order.taxAmount,
          serviceCharge: order.serviceCharge,
          discount: order.discountAmount,
          total: order.totalAmount,
        },
        paymentInfo: {
          method: (order.paymentMethod as OrderPaymentMethod) || "cash",
          status: order.paymentStatus,
          paidAt: order.paidAt ? new Date(order.paidAt) : undefined,
        },
        timestamps: {
          orderedAt: new Date(order.createdAt),
          confirmedAt: order.confirmedAt
            ? new Date(order.confirmedAt)
            : undefined,
          readyAt: order.readyAt ? new Date(order.readyAt) : undefined,
          deliveredAt: order.deliveredAt
            ? new Date(order.deliveredAt)
            : undefined,
        },
      };

      return receipt;
    } catch (error) {
      this.logger.error(
        "Failed to generate receipt",
        error instanceof Error ? error : undefined,
        { orderId },
      );
      throw error;
    }
  }

  async exportOrders(
    filters: OrderQueryFilters,
    format: "csv" | "excel" | "pdf",
  ): Promise<Buffer> {
    try {
      // This would require implementing export logic
      // For now, return empty buffer
      return Buffer.from("");
    } catch (error) {
      this.logger.error(
        "Failed to export orders",
        error instanceof Error ? error : undefined,
        { filters, format },
      );
      throw error;
    }
  }

  // Real-time Updates
  /**
   * 廣播新訂單事件
   */
  private async broadcastNewOrder(order: Order): Promise<void> {
    try {
      const realtimeEvent: NewOrderEvent = {
        type: RealtimeEventType.NEW_ORDER,
        eventId: this.realtimeBroadcastService.generateEventId(),
        timestamp: Date.now(),
        restaurantId: String(order.restaurantId),
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber || `#${order.id}`,
          tableId: order.tableId ? String(order.tableId) : undefined,
          // The admin notification panel renders a table badge off this field
          // and nothing else supplied it, so the badge never appeared. The
          // order arrives fully loaded, table relation included, so the number
          // is already here -- it was only never copied across.
          tableName: order.table?.number,
          items: (order.items || []).map((item) => ({
            orderItemId: item.id,
            menuItemId: item.menuItemId,
            menuItemName: item.menuItem?.name || "",
            quantity: item.quantity,
            price: item.unitPrice,
            notes: item.notes,
          })),
          totalAmount: order.totalAmount,
          orderSource: order.orderSource,
          notes: order.notes,
          customer: order.customerInfo
            ? {
                name: order.customerInfo.name,
                phone: order.customerInfo.phone,
              }
            : undefined,
        },
      };

      const result =
        await this.realtimeBroadcastService.broadcastNewOrder(realtimeEvent);

      if (result.success) {
        this.logger.info("New order broadcasted successfully", {
          orderId: order.id,
          eventId: result.eventId,
          recipientCount: result.recipientCount,
        });
      }
    } catch (error) {
      this.logger.error(
        "Failed to broadcast new order",
        error instanceof Error ? error : undefined,
        {
          orderId: order.id,
        },
      );
    }
  }

  private async notifyNewOrderPush(order: Order): Promise<void> {
    try {
      await this.orderPushService.notifyNewOrder({
        restaurantId: String(order.restaurantId),
        orderId: order.id,
        orderNumber: order.orderNumber || `#${order.id}`,
        orderSource: order.orderSource,
        totalAmount: order.totalAmount,
        itemCount: order.items?.length ?? 0,
        customerName: order.customerInfo?.name,
        notes: order.notes,
      });
    } catch (error) {
      this.logger.error(
        "Failed to send new order push notification",
        error instanceof Error ? error : undefined,
        {
          orderId: order.id,
          restaurantId: order.restaurantId,
        },
      );
    }
  }

  /**
   * Broadcast order status update — accepts Order directly to avoid re-fetching.
   */
  private async broadcastOrderStatusUpdate(
    order: Order,
    previousStatus: OrderStatus,
    newStatus: OrderStatus,
    updatedBy: string,
    notes?: string,
    estimatedReadyTime?: Date,
  ): Promise<void> {
    try {
      await finalizeOrderStatusSideEffects({
        env: this.env,
        order,
        previousStatus,
        newStatus,
        updatedBy,
        updatedByRole: updatedBy ? "admin" : "system",
        notes,
        estimatedReadyTime,
      });
    } catch (error) {
      this.logger.error(
        "Failed to broadcast order update",
        error instanceof Error ? error : undefined,
        { orderId: order.id },
      );
    }
  }

  private async broadcastOrderCancelled(
    order: Order,
    reason: string,
    cancelledBy: string,
  ): Promise<void> {
    try {
      const realtimeEvent: OrderCancelledEvent = {
        type: RealtimeEventType.ORDER_CANCELLED,
        eventId: this.realtimeBroadcastService.generateEventId(),
        timestamp: Date.now(),
        restaurantId: String(order.restaurantId),
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber || `#${order.id}`,
          reason,
          cancelledBy: {
            userId: cancelledBy,
            userName: "System",
            role: "admin",
          },
        },
      };

      const result =
        await this.realtimeBroadcastService.broadcastOrderCancelled(
          realtimeEvent,
        );

      if (result.success) {
        this.logger.info("Order cancellation broadcasted successfully", {
          orderId: order.id,
          eventId: result.eventId,
          recipientCount: result.recipientCount,
        });
      } else {
        this.logger.error(
          "Failed to broadcast order cancellation",
          new Error(result.error),
          { orderId: order.id },
        );
      }
    } catch (error) {
      this.logger.error(
        "Failed to broadcast order cancellation",
        error instanceof Error ? error : undefined,
        { orderId: order.id },
      );
    }
  }

  /**
   * Public broadcastOrderUpdate — backward-compatible wrapper that fetches order if needed.
   * Prefer broadcastOrderStatusUpdate() when order data is already available.
   */
  async broadcastOrderUpdate(event: OrderUpdateEvent): Promise<void> {
    const order = await this.getOrder(event.orderId);
    if (!order) {
      this.logger.warn("Order not found for broadcast", {
        orderId: event.orderId,
      });
      return;
    }
    await this.broadcastOrderStatusUpdate(
      order,
      event.previousStatus!,
      event.newStatus,
      event.updatedBy,
      event.notes,
      event.estimatedReadyTime,
    );
  }

  async subscribeToOrderUpdates(
    restaurantId: string,
    roles: UserRole[],
  ): Promise<void> {
    try {
      // Implementation would depend on real-time service
      this.logger.info("Subscribing to order updates", { restaurantId, roles });
    } catch (error) {
      this.logger.error(
        "Failed to subscribe to order updates",
        error instanceof Error ? error : undefined,
        { restaurantId, roles },
      );
    }
  }

  // Private helper methods
  private async cacheOrder(order: Order): Promise<void> {
    const serialized = JSON.stringify(order);
    await Promise.all([
      this.cacheKV.put(`order:${order.id}:full`, serialized, {
        expirationTtl: 300,
      }),
      this.cacheKV.put(`order:${order.id}:basic`, serialized, {
        expirationTtl: 300,
      }),
    ]);
  }

  private async invalidateOrderCache(orderId: string): Promise<void> {
    await invalidateOrderCacheKeys(this.cacheKV, orderId);
  }

  /**
   * Write one row to `audit_logs`.
   *
   * This used to be a stub that only console-logged, which meant orders had
   * never written a single audit row -- creates and cancellations included,
   * not just the item edits that #273 asked for. The `action` column is the
   * indexed one, so it takes a coarse value from AUDIT_ACTIONS; the precise
   * event name survives in `changes.metadata.event` so a query can still tell
   * an item removal from a quantity change.
   *
   * A failure here is logged, never rethrown. The mutation it describes has
   * already committed, and turning a committed order edit into a 500 invites
   * the caller to retry and apply it twice. An unwritten audit row is the
   * lesser of those two.
   */
  private async logOrderActivity(
    orderId: string,
    action: string,
    userId?: string,
    metadata?: unknown,
    restaurantId?: string,
  ): Promise<void> {
    this.logger.info("Order activity logged", {
      orderId,
      action,
      userId,
      metadata,
    });

    try {
      const db = createDatabase(this.env.DB);
      await db.insert(auditLogs).values({
        userId: userId ?? null,
        restaurantId: restaurantId ?? null,
        action: ORDER_AUDIT_ACTIONS[action] ?? AUDIT_ACTIONS.OTHER,
        resource: "orders",
        resourceId: orderId,
        description: `${action} on order ${orderId}`,
        changes: {
          metadata: {
            event: action,
            ...(metadata && typeof metadata === "object"
              ? (metadata as Record<string, unknown>)
              : {}),
          },
        },
        success: true,
      });
    } catch (error) {
      this.logger.error(
        "Failed to write order audit log",
        error instanceof Error ? error : undefined,
        { orderId, action, userId },
      );
    }
  }

  /**
   * Defence-in-depth: verify the caller has access to the order's restaurant.
   * Admin (role 0) is always allowed. Non-admin must match restaurantId.
   * When no caller context is provided, trust the route layer (backward compatible).
   *
   * The refusal deliberately says nothing about who owns the order. POST
   * /orders/bulk answers up to 100 ids in one request and reports per-id
   * outcomes, so a message naming the owning restaurant would turn a rejected
   * batch into an `order id -> restaurant` lookup table. The detail is still
   * worth having, so it goes to the log rather than to the caller.
   */
  private assertRestaurantAccess(
    order: { restaurantId: string },
    caller?: CallerContext,
  ): void {
    if (!caller) return;
    if (caller.userRole === 0) return;
    if (
      !caller.userRestaurantId?.trim() ||
      caller.userRestaurantId !== order.restaurantId
    ) {
      this.logger.warn("Cross-tenant order access denied", {
        userId: caller.userId,
        callerRestaurantId: caller.userRestaurantId,
        orderRestaurantId: order.restaurantId,
      });
      throw forbidden("Access denied", "FORBIDDEN");
    }
  }

  private async applyPermissionFilters(
    filters: OrderQueryFilters,
    userId?: string,
    userRole?: UserRole,
    caller?: CallerContext,
  ): Promise<OrderQueryFilters> {
    const role = caller?.userRole ?? userRole;
    const restaurantId = caller?.userRestaurantId;

    if (role === 0 || role === undefined) {
      // Admin or unknown role — no additional filtering
      return filters;
    }

    if (role === 5) {
      // Legacy users.role=5 (customer) is retired — customer identity lives in
      // the `customers` table and orders.customer_id is a TEXT FK to
      // customers.id, so a users row id can never scope this query. The old
      // branch also fell open when userId was undefined: it returned filters
      // with neither a customer nor a restaurant scope, i.e. every order in
      // every tenant. Refuse instead. Canonical customers reach their own
      // orders through GET /api/v1/customers/me/orders, which passes no role.
      throw forbidden(
        "Legacy customer role cannot list orders",
        "LEGACY_CUSTOMER_ROLE_RETIRED",
      );
    }

    // Roles 1–4 MUST be scoped to their restaurant, and one with no assignment
    // has nothing to scope to. Falling through with the filters untouched ran
    // the query unscoped — and getOrders' post-query strip is guarded by the
    // same empty restaurantId, so it did not catch the leak either. That is how
    // a NULL-tenant staff account read every restaurant's orders (#306); refuse
    // instead, the same way assertRestaurantAccess does for a single order.
    if (!restaurantId?.trim()) {
      throw forbidden("Restaurant assignment required", "FORBIDDEN");
    }

    return { ...filters, restaurantId };
  }

  private convertToBaseFilters(
    filters: OrderQueryFilters,
  ): import("@makanmasak/database").OrderFilters {
    return {
      restaurantId: filters.restaurantId,
      customerId: filters.customerId,
      status: filters.status,
      paymentStatus: filters.paymentStatus,
      orderType: filters.orderType,
      fulfillmentType: filters.fulfillmentType,
      orderSource: filters.orderSource,
      search: filters.search,
      tableId: filters.tableId,
      dateRange:
        filters.dateFrom && filters.dateTo
          ? [new Date(filters.dateFrom), new Date(filters.dateTo)]
          : undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    };
  }

  /**
   * 訂單一確認就把廚房票排進待印佇列。
   *
   * 刻意吞掉失敗：訂單狀態已經寫進資料庫了，不能因為排不進出單佇列就把它回滾
   * 或讓整個請求失敗。印不出來是可觀察的（收據列停在 pending），而狀態被回滾
   * 不是。
   */
  private async emitKitchenTicket(orderId: string): Promise<void> {
    try {
      const result = await new ReceiptService(this.env.DB).createKitchenTicket(
        orderId,
      );
      if (!result.success) {
        this.logger.warn("Kitchen ticket not queued", {
          orderId,
          error: result.error,
        });
      }
    } catch (error) {
      this.logger.warn("Kitchen ticket not queued", { orderId, error });
    }
  }

  private validateStatusTransition(
    currentStatus: OrderStatus,
    newStatus: OrderStatus,
    userRole?: UserRole,
  ): void {
    if (!ORDER_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus)) {
      throw conflict(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
        "INVALID_STATUS_TRANSITION",
      );
    }

    if (
      userRole !== undefined &&
      !ROLE_STATUS_PERMISSIONS[userRole]?.includes(newStatus)
    ) {
      throw forbidden(
        `Insufficient permissions for status transition to ${newStatus}`,
        "FORBIDDEN",
      );
    }
  }

  private formatCustomizations(
    customizations: SelectedCustomizations | undefined | null,
  ): string[] {
    if (!customizations) return [];

    const formatted: string[] = [];

    if (customizations.size) {
      formatted.push(`Size: ${customizations.size.name}`);
    }

    if (customizations.options) {
      for (const option of customizations.options) {
        formatted.push(`${option.optionName}: ${option.choiceName}`);
      }
    }

    if (customizations.addOns) {
      for (const addOn of customizations.addOns) {
        formatted.push(`${addOn.name} x${addOn.quantity}`);
      }
    }

    return formatted;
  }
}
