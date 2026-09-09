/**
 * Orders Feature Types
 * TypeScript type definitions for the orders feature
 */

// BaseEntity import available for future use
import type { UserRole } from "../../../shared/constants";

// Import shared order types from packages/shared-types. OrderStatus is a
// string union ("pending" | "confirmed" | ...) that mirrors the
// orders.status TEXT column in packages/database/src/schema/orders.ts.
// The numeric enum that used to live alongside it has been retired —
// see docs/superpowers/plans/2026-04-09-orderstatus-unification.md.
import type {
  Order as SharedOrder,
  OrderItem as SharedOrderItem,
  OrderStatus,
  OrderPaymentStatus,
  OrderPaymentMethod,
  OrderItemStatus,
  CustomerInfo,
  TableInfo,
  RestaurantInfo,
  CustomerProfile,
  SelectedCustomizations,
  OrderSummary,
  OrderFilters,
  OrderStats,
  CartItem,
  CartState,
} from "@makanmasak/shared-types";

// Re-export for use in the feature module
export type {
  OrderStatus,
  OrderPaymentStatus,
  OrderPaymentMethod,
  OrderItemStatus,
  CustomerInfo,
  TableInfo,
  RestaurantInfo,
  CustomerProfile,
  SelectedCustomizations,
  OrderSummary,
  OrderFilters,
  OrderStats,
  CartItem,
  CartState,
};

export type Order = SharedOrder;
export type OrderItem = SharedOrderItem;

// Order Creation and Management Types
export interface CreateOrderData {
  restaurantId: string;
  tableId?: number;
  customerId?: string;
  waitingListId?: string;
  waitingListCustomerPhone?: string;
  customerInfo?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  items: OrderItemData[];
  notes?: string;
  orderType?: "shop" | "table" | "seat";
  orderSource?:
    | "direct"
    | "market_checkout"
    | "uber_eats"
    | "foodpanda"
    | "grabfood";
  scheduledTime?: Date;
  couponCode?: string;
  couponUserId?: string;
  clientMutationId?: string;
  isGuestOrder?: boolean;
  deliveryInfo?: {
    type: "dine_in" | "takeaway" | "delivery";
    address?: string;
    phone?: string;
    instructions?: string;
    deliveryFee?: number;
    estimatedDeliveryTime?: number;
  };
}

export interface OrderItemData {
  menuItemId: number;
  quantity: number;
  price?: number;
  customizations?: unknown;
  notes?: string;
}

export interface OrderStatusUpdateData {
  status: OrderStatus;
  notes?: string;
  estimatedReadyTime?: Date;
  updatedBy?: string;
}

// Coupon and Discount Types
export interface CouponValidation {
  valid: boolean;
  coupon?: {
    code: string;
    name: string;
    discountType: "percentage" | "fixed_amount" | "free_item";
    discountValue: number;
    description?: string;
  };
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  savings?: number;
  error?: string;
}

export interface CouponPreviewRequest {
  restaurantId: string;
  couponCode: string;
  orderAmount: number;
  userId?: string;
  menuItems?: Array<{
    menuItemId: number;
    quantity: number;
  }>;
}

// Order Query and Filter Types
export interface OrderQueryFilters {
  restaurantId?: string;
  status?: OrderStatus[];
  paymentStatus?: OrderPaymentStatus[];
  orderType?: "shop" | "table" | "seat";
  orderSource?:
    | "direct"
    | "market_checkout"
    | "uber_eats"
    | "foodpanda"
    | "grabfood";
  search?: string;
  fulfillmentType?: "dine_in" | "takeaway" | "delivery";
  tableId?: number;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  dateFrom?: Date;
  dateTo?: Date;
  scheduledTimeFrom?: Date;
  scheduledTimeTo?: Date;
  minAmount?: number;
  maxAmount?: number;
  paymentMethod?: OrderPaymentMethod[];
  hasNotes?: boolean;
  rating?: number[];
  createdBy?: number;
  page?: number;
  limit?: number;
  sortBy?: "createdAt" | "totalAmount" | "status" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

/**
 * Caller context for service-layer defence-in-depth authorization.
 * Passed from route handlers to service methods.
 * When provided, the service validates restaurant ownership for non-admin callers.
 */
export interface CallerContext {
  userId: string;
  userRole: number;
  /** The restaurant the caller belongs to. undefined for admin users. */
  userRestaurantId?: string;
}

export interface OrderSearchParams {
  query?: string;
  searchFields?: ("orderNumber" | "customerName" | "customerPhone" | "notes")[];
  fuzzy?: boolean;
}

// Advanced Order Statistics
export interface OrderAnalytics {
  summary: {
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
    averagePreparationTime: number;
    orderCompletionRate: number;
    customerRetentionRate: number;
  };
  byStatus: Array<{
    status: OrderStatus;
    count: number;
    percentage: number;
    averageTime?: number;
  }>;
  byPaymentStatus: Array<{
    status: OrderPaymentStatus;
    count: number;
    amount: number;
  }>;
  byOrderType: Array<{
    type: "dine_in" | "takeaway" | "delivery";
    count: number;
    revenue: number;
  }>;
  byTime: {
    hourly: Array<{
      hour: number;
      count: number;
      revenue: number;
    }>;
    daily: Array<{
      date: string;
      count: number;
      revenue: number;
    }>;
    weekly: Array<{
      week: string;
      count: number;
      revenue: number;
    }>;
    monthly: Array<{
      month: string;
      count: number;
      revenue: number;
    }>;
  };
  topItems: Array<{
    menuItemId: number;
    name: string;
    quantity: number;
    revenue: number;
  }>;
  customerAnalytics: {
    newCustomers: number;
    returningCustomers: number;
    averageOrdersPerCustomer: number;
    customerLifetimeValue: number;
  };
  performanceMetrics: {
    averageOrderProcessingTime: number;
    peakHours: string[];
    busyDays: string[];
    orderAccuracy: number;
    cancellationRate: number;
  };
}

// Real-time Order Updates and Events
export interface OrderUpdateEvent {
  orderId: string;
  previousStatus?: OrderStatus;
  newStatus: OrderStatus;
  updatedBy: string;
  updatedAt: Date;
  notes?: string;
  estimatedReadyTime?: Date;
  targetRoles?: UserRole[];
}

export interface OrderNotification {
  type:
    | "ORDER_CREATED"
    | "ORDER_UPDATED"
    | "ORDER_CANCELLED"
    | "PAYMENT_UPDATED";
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  message: string;
  priority: "low" | "normal" | "high" | "urgent";
  targetRoles: UserRole[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  expiresAt?: Date;
}

// Bulk Operations
export interface BulkOrderOperation {
  action: "update_status" | "cancel" | "export" | "archive";
  orderIds: string[];
  data?: {
    status?: OrderStatus;
    reason?: string;
    format?: "csv" | "excel" | "pdf";
    notes?: string;
  };
  batchId?: string;
}

export interface BulkOrderResult {
  batchId: string;
  totalOrders: number;
  successCount: number;
  failedCount: number;
  errors: Array<{
    orderId: string;
    error: string;
  }>;
  results: Array<{
    orderId: string;
    success: boolean;
    data?: unknown;
    error?: string;
  }>;
}

// Order Status Transitions and Permissions
export interface OrderStatusTransition {
  from: OrderStatus;
  to: OrderStatus;
  allowedRoles: UserRole[];
  conditions?: Array<{
    field: string;
    operator: "equals" | "not_equals" | "greater_than" | "less_than";
    value: unknown;
  }>;
  sideEffects?: Array<{
    type: "notification" | "audit_log" | "webhook" | "email";
    config: Record<string, unknown>;
  }>;
}

export interface OrderReceipt {
  orderNumber: string;
  restaurantInfo: RestaurantInfo;
  customerInfo: CustomerInfo;
  tableInfo?: TableInfo;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    customizations?: string[];
    notes?: string;
  }>;
  summary: OrderSummary;
  paymentInfo: {
    method: OrderPaymentMethod;
    status: OrderPaymentStatus;
    transactionId?: string;
    paidAt?: Date;
  };
  timestamps: {
    orderedAt: Date;
    confirmedAt?: Date;
    readyAt?: Date;
    deliveredAt?: Date;
  };
  qrCode?: string;
  footerMessage?: string;
}

// Service Interface Definitions
export interface IOrdersService {
  // Core CRUD Operations
  createOrder(data: CreateOrderData, userId?: string): Promise<Order>;
  getOrder(id: string, includeItems?: boolean): Promise<Order | null>;
  getOrders(
    filters: OrderQueryFilters,
    userId?: string,
    userRole?: UserRole,
  ): Promise<{
    orders: Order[];
    total: number;
    pagination: {
      page: number;
      limit: number;
      totalPages: number;
    };
  }>;
  addItemsToOrder(
    id: string,
    items: CreateOrderData["items"],
    userId?: string,
    expectedVersion?: number,
  ): Promise<Order>;
  /** #273. quantity 0 removes the line; see OrdersService for the rationale. */
  changeOrderItemQuantity(
    id: string,
    orderItemId: number,
    newQuantity: number,
    options?: {
      userId?: string;
      expectedVersion?: number;
      caller?: CallerContext;
    },
  ): Promise<Order>;
  deleteOrder(id: string, userId?: string): Promise<boolean>;

  // Status Management
  updateOrderStatus(
    id: string,
    statusData: OrderStatusUpdateData,
    userId?: string,
    userRole?: UserRole,
  ): Promise<Order | null>;
  cancelOrder(
    id: string,
    reason: string,
    userId?: string,
  ): Promise<Order | null>;
  getOrderStatusHistory(id: string): Promise<
    Array<{
      status: OrderStatus;
      timestamp: Date;
      updatedBy?: string;
      notes?: string;
    }>
  >;

  // Analytics and Reporting
  getOrderAnalytics(
    filters: OrderQueryFilters,
    userId?: string,
  ): Promise<OrderAnalytics>;
  getDailyStats(restaurantId: string, date?: Date): Promise<OrderStats>;
  getPopularItems(
    restaurantId: string,
    timeRange?: string,
  ): Promise<
    Array<{
      menuItemId: number;
      name: string;
      quantity: number;
      revenue: number;
    }>
  >;

  // Search and Filter
  searchOrders(
    searchParams: OrderSearchParams,
    filters?: OrderQueryFilters,
    userId?: string,
  ): Promise<Order[]>;

  // Bulk Operations
  bulkUpdateOrders(
    operation: BulkOrderOperation,
    userId?: string,
    userRole?: UserRole,
    caller?: CallerContext,
  ): Promise<BulkOrderResult>;

  // Coupon and Discount Operations
  validateCoupon(data: CouponPreviewRequest): Promise<CouponValidation>;

  // Receipt and Export
  generateReceipt(orderId: string): Promise<OrderReceipt>;
  exportOrders(
    filters: OrderQueryFilters,
    format: "csv" | "excel" | "pdf",
  ): Promise<Buffer>;

  // Real-time Updates
  broadcastOrderUpdate(event: OrderUpdateEvent): Promise<void>;
  subscribeToOrderUpdates(
    restaurantId: string,
    roles: UserRole[],
  ): Promise<void>;
}

// Error Types
export interface OrderError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export const ORDER_ERROR_CODES = {
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  INVALID_ORDER_DATA: "INVALID_ORDER_DATA",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  MENU_ITEM_NOT_FOUND: "MENU_ITEM_NOT_FOUND",
  MENU_ITEM_UNAVAILABLE: "MENU_ITEM_UNAVAILABLE",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  INVALID_CUSTOMIZATION: "INVALID_CUSTOMIZATION",
  TABLE_NOT_AVAILABLE: "TABLE_NOT_AVAILABLE",
  RESTAURANT_CLOSED: "RESTAURANT_CLOSED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  COUPON_INVALID: "COUPON_INVALID",
  COUPON_EXPIRED: "COUPON_EXPIRED",
  COUPON_ALREADY_USED: "COUPON_ALREADY_USED",
  ORDER_ALREADY_CANCELLED: "ORDER_ALREADY_CANCELLED",
  ORDER_ALREADY_COMPLETED: "ORDER_ALREADY_COMPLETED",
  BULK_OPERATION_FAILED: "BULK_OPERATION_FAILED",
  EXPORT_FAILED: "EXPORT_FAILED",
  BROADCAST_FAILED: "BROADCAST_FAILED",
} as const;

export type OrderErrorCode =
  (typeof ORDER_ERROR_CODES)[keyof typeof ORDER_ERROR_CODES];

/**
 * Valid status transitions: maps each status to the statuses it can transition to.
 * Single source of truth — used by both route-layer guards and service-layer validation.
 */
export { ORDER_STATUS_TRANSITIONS } from "@makanmasak/shared-types";

/**
 * Role-based permissions for which statuses each role can set an order to.
 * Single source of truth — used by both route-layer guards and service-layer validation.
 */
export { ROLE_STATUS_PERMISSIONS } from "@makanmasak/shared-types";

// Configuration
export interface OrdersConfig {
  orderNumberFormat: string;
  defaultPreparationTime: number;
  maxOrderItems: number;
  allowGuestOrders: boolean;
  requireCustomerInfo: boolean;
  autoConfirmOrders: boolean;
  enableRealTimeUpdates: boolean;
  statusTransitionRules: OrderStatusTransition[];
  notificationSettings: {
    enablePushNotifications: boolean;
    enableEmailNotifications: boolean;
    enableSMSNotifications: boolean;
  };
  paymentSettings: {
    enableOnlinePayments: boolean;
    acceptCashPayments: boolean;
    acceptCardPayments: boolean;
    defaultPaymentMethod: OrderPaymentMethod;
  };
  analytics: {
    retentionPeriodDays: number;
    enableAdvancedAnalytics: boolean;
    enableReporting: boolean;
  };
}

// Event Types for Real-time Updates
export type OrderEvent =
  | { type: "ORDER_CREATED"; payload: Order }
  | { type: "ORDER_UPDATED"; payload: Order }
  | { type: "ORDER_STATUS_CHANGED"; payload: OrderUpdateEvent }
  | { type: "ORDER_CANCELLED"; payload: { orderId: string; reason: string } }
  | {
      type: "PAYMENT_STATUS_CHANGED";
      payload: { orderId: string; paymentStatus: OrderPaymentStatus };
    }
  | {
      type: "ORDER_ITEM_UPDATED";
      payload: { orderId: string; itemId: number; status: OrderItemStatus };
    }
  | { type: "BULK_OPERATION_COMPLETED"; payload: BulkOrderResult }
  | { type: "ORDER_NOTIFICATION"; payload: OrderNotification };
