import { BaseEntity } from "./common";
import { MenuItem } from "./menu";

// Platform source for orders
export type PlatformSource =
  | "direct"
  | "market_checkout"
  | "uber_eats"
  | "foodpanda"
  | "grabfood";

// Delivery/fulfillment information interface
export interface DeliveryInfo {
  /** Optional: the stored `orders.delivery_info` JSON does not guarantee it. */
  type?: "dine_in" | "takeaway" | "delivery";
  address?: string;
  phone?: string;
  instructions?: string;
  deliveryFee?: number;
  estimatedDeliveryTime?: number;
}

// Customer information interface
export interface CustomerInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  preferences?: Record<string, unknown>;
}

// Table information interface
export interface TableInfo {
  id: number;
  number: string;
  /** Optional: order queries select only id + number from `tables`. */
  seats?: number;
  location?: string;
  qrCode?: string;
}

// Restaurant information interface
export interface RestaurantInfo {
  /** `restaurants.id` is a TEXT UUID v7 (packages/database/src/schema/restaurants.ts). */
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  businessHours?: Record<string, unknown>;
}

// Customer profile interface
export interface CustomerProfile {
  id: string;
  email?: string;
  phone?: string;
  fullName: string;
  address?: string;
  profileImageUrl?: string;
  preferences?: Record<string, unknown>;
}

// Order overrides BaseEntity's `id` to the database-backed UUID/text id. See
// packages/database/src/services/order.ts
// `toMillis` and apps/api/src/__tests__/integration/orders.real.integration.test.ts
// for the enforcement point.
export interface Order extends Omit<BaseEntity, "id"> {
  id: string;
  restaurantId: string;
  tableId?: number;
  customerId?: string;
  waitingListId?: string;
  orderNumber: string;
  orderType?: "shop" | "table" | "seat";
  customerName?: string;
  customerPhone?: string;
  customerInfo?: CustomerInfo;
  subtotal: number; // in cents
  taxAmount?: number; // in cents
  serviceCharge?: number; // in cents
  discountAmount?: number; // in cents
  totalAmount: number; // in cents
  status: OrderStatus;
  version?: number;
  paymentStatus: OrderPaymentStatus;
  paymentMethod?: OrderPaymentMethod;
  paymentTransactionId?: string;
  notes?: string;
  internalNotes?: string;
  estimatedPrepTime?: number; // minutes
  actualPrepTime?: number; // minutes
  createdAt: number; // Unix ms
  updatedAt: number; // Unix ms
  confirmedAt: number | null;
  preparingAt: number | null;
  readyAt: number | null;
  deliveredAt: number | null;
  deliveryAssignedTo?: string | null;
  deliveryStartTime?: number | null;
  paidAt: number | null;
  cancelledAt: number | null;
  rating?: number;
  reviewComment?: string;
  orderSource?: PlatformSource;
  deliveryInfo?: DeliveryInfo;
  pickupNumber?: string;
  fulfillmentType?: "dine-in" | "takeaway" | "delivery";
  items?: OrderItem[];
  restaurant?: RestaurantInfo;
  table?: TableInfo;
  customer?: CustomerProfile;
}

/**
 * Canonical OrderStatus — matches the DB schema in
 * `packages/database/src/schema/orders.ts` exactly. Do not re-introduce a
 * numeric variant. See `docs/investigations/2026-04-09-orderstatus-surface-audit.md`
 * for the full history of why this is a string union and
 * `docs/superpowers/plans/2026-04-09-orderstatus-unification.md` Issue #9
 * for the migration plan.
 */
export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
  "paid",
  "cancelled",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The order status machine. Every consumer that needs to know "what can this
 * order become" reads it from here.
 *
 * It lives in shared-types rather than in the API because three copies of this
 * knowledge already existed and one of them had drifted: OrdersView's
 * `canCancel` offered cancellation only from pending and confirmed, while the
 * server accepted it from preparing and ready too, so a shop owner whose
 * customer left mid-cook had no button and could only push the order forward
 * to paid (#310). An earlier divergence between the API table and
 * `cancellableOrderStatuses` in packages/database was worse than a missing
 * button: the wider list was honoured while no inventory was restored, so a
 * cancelled `preparing` order left its stock deducted with no way back (#282).
 *
 * Values stay `string[]` rather than `OrderStatus[]` on purpose — callers do
 * `TRANSITIONS[current]?.includes(next)` with plain strings off the wire, and
 * a narrower element type turns that `includes` into a compile error.
 */
export const ORDER_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  // PaymentService owns the transition to paid because it atomically creates
  // the transaction and updates the order's payment fields. A fulfilment-only
  // status update must never manufacture a paid order with no payment record.
  delivered: ["refunded"],
  paid: [],
  cancelled: [],
  refunded: [],
} as const;

/** Statuses an order can still be cancelled from, derived so it cannot drift
 * from the machine above. */
export const CANCELLABLE_ORDER_STATUSES: readonly string[] = Object.entries(
  ORDER_STATUS_TRANSITIONS,
)
  .filter(([, next]) => next.includes("cancelled"))
  .map(([status]) => status);

/** Statuses each staff role may set. Owners retain full control of their own
 * restaurant; route-level restaurant access remains the tenancy boundary. */
export const ROLE_STATUS_PERMISSIONS: Record<number, readonly OrderStatus[]> = {
  0: ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"],
  1: ["confirmed", "preparing", "ready", "delivered", "cancelled"],
  2: ["preparing", "ready"],
  3: ["delivered"],
  4: ["confirmed"],
} as const;

/**
 * Canonical OrderPaymentStatus — the TEXT `orders.payment_status` column in
 * `packages/database/src/schema/orders.ts:113`. This used to be a numeric enum
 * (PENDING=0, PAID=1, FAILED=2), which never matched the string values the DB
 * and API actually produce — comparisons against real data always failed.
 *
 * It is deliberately NOT the same vocabulary as `payment_transactions.status`
 * (`PAYMENT_TRANSACTION_STATUS`, which says "paid"). `orders.status` already
 * uses "paid" for a workflow state a shop owner can set by hand without any
 * money arriving (#310), so reusing the word here would give one row two
 * different meanings for it. The payment side says "completed"; the external
 * API says so too — `toExternalPaymentStatus` maps both spellings to
 * "completed" (`features/payments/services/refundPayment.ts:211`).
 *
 * "partial_refunded" is here because `refundPayment` writes it for a partial
 * refund (`refundPayment.ts:102`). Leaving it out made every partially
 * refunded order read back as "pending", since `toOrderPaymentStatus` falls
 * back to "pending" for anything off this list (#311).
 */
export const ORDER_PAYMENT_STATUSES = [
  "pending",
  "completed",
  "failed",
  "refunded",
  "partial_refunded",
] as const;

export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

/**
 * Canonical OrderPaymentMethod — the union of every value that actually reaches
 * the unconstrained TEXT `orders.payment_method` column. "cash" / "card" /
 * "online" / "ewallet" come from the API query schema
 * (apps/api/src/features/orders/schemas/validation.ts); "digital_wallet" /
 * "bank_transfer" / "other" are what the cashier UI and PAYMENT_METHODS in
 * packages/database/src/schema/orders.ts write. Declaring only the first four
 * meant the rest had to be cast through the order DTO to survive.
 */
export const ORDER_PAYMENT_METHODS = [
  "cash",
  "card",
  "online",
  "ewallet",
  "digital_wallet",
  "bank_transfer",
  "other",
] as const;

export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

export interface OrderItem extends BaseEntity {
  orderId: string;
  menuItemId: number;
  quantity: number;
  unitPrice: number; // in cents, price at time of order
  totalPrice: number; // in cents
  customizations?: SelectedCustomizations;
  itemSnapshot?: OrderItemSnapshot;
  notes?: string;
  status: OrderItemStatus;
  /** Name captured at order time, with a menu-item fallback for older orders. */
  name?: string;
  description?: string;
  imageUrl?: string;
  menuItem?: OrderItemMenuItem; // populated when needed
}

/**
 * The menu-item projection order queries actually select
 * (`orderMenuItemSummaryColumns` in packages/database/src/services/order.ts),
 * with `price` filled from the order-time snapshot. The full `MenuItem` was
 * never populated on this path — declaring it here only worked because the
 * order mapper cast its result.
 */
export interface OrderItemMenuItem {
  id: number;
  name: string;
  nameEn?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  price?: number;
}

export interface OrderItemSnapshot {
  name: string;
  description?: string;
  imageUrl?: string;
  category?: string;
  price?: number;
  unitPrice?: number;
  customizations?: SelectedCustomizations;
}

/**
 * Canonical OrderItemStatus — matches the TEXT `order_items.status` column in
 * `packages/database/src/schema/order-items.ts:87`
 * (pending / preparing / ready / served / cancelled). Previously a numeric enum
 * (PENDING=0…DELIVERED=3) that never matched the string values in the DB/API.
 * Note the fulfilled terminal state is "served" (not "delivered") for items.
 */
export const ORDER_ITEM_STATUSES = [
  "pending",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;

export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

export interface SelectedCustomizations {
  size?: {
    id: string;
    name: string;
    priceAdjustment?: number;
  };
  options?: {
    id: string;
    optionName: string; // option category name (e.g., "spice level")
    choiceId: string;
    choiceName: string; // selected choice name (e.g., "medium spicy")
    priceAdjustment?: number;
  }[];
  addOns?: {
    id: string;
    name: string;
    unitPrice: number;
    quantity: number;
    totalPrice: number;
  }[];
  specialInstructions?: string;
}

export interface CreateOrderRequest {
  restaurantId: string;
  tableId?: number;
  waitingListId?: string;
  customerName?: string;
  customerPhone?: string;
  items: CreateOrderItemRequest[];
  notes?: string;
  couponCode?: string; // 優惠券代碼
  /**
   * Idempotency key for this submission, enforced by the unique index on
   * (restaurant_id, client_mutation_id); a replay comes back as
   * CLIENT_MUTATION_DUPLICATE / 409 rather than a second order.
   *
   * The authenticated path has nothing else guarding it — the KV active-order
   * lock is guest-only — so a connection dropped between the commit and the
   * response leaves the customer looking at "please try again", and a second
   * tap without this key books the kitchen for two.
   */
  clientMutationId?: string;
}

export interface CreateOrderItemRequest {
  menuItemId: number;
  quantity: number;
  customizations?: SelectedCustomizations;
  notes?: string;
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  notes?: string;
}

export interface UpdateOrderItemStatusRequest {
  status: OrderItemStatus;
}

export interface OrderSummary {
  subtotal: number; // in cents
  tax?: number; // in cents
  serviceCharge?: number; // in cents
  discount?: number; // in cents
  total: number; // in cents
}

export interface OrderFilters {
  status?: OrderStatus[];
  paymentStatus?: OrderPaymentStatus[];
  tableId?: number;
  customerPhone?: string;
  dateFrom?: string;
  dateTo?: string;
  orderSource?: PlatformSource[];
}

export interface OrderStats {
  totalOrders: number;
  pendingOrders: number;
  preparingOrders: number;
  readyOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalRevenue: number; // in cents
  averageOrderValue: number; // in cents
  averagePreparationTime: number; // minutes
}

// Cart-related types for frontend
export interface CartItem {
  id: string;
  menuItem: MenuItem;
  quantity: number;
  customizations?: SelectedCustomizations;
  notes?: string;
  price: number; // in cents, base price per item
  totalPrice: number; // in cents, calculated price including customizations
}

export interface CartState {
  items: CartItem[];
  restaurantId?: string;
  tableId?: number;
  total: number; // in cents
  itemCount: number;
}

export interface CustomizationOption {
  id: string;
  name: string;
  priceModifier: number; // in cents
  description?: string;
  priceAdjustment?: number; // for compatibility
}

export interface CustomizationGroup {
  id: string;
  name: string;
  type: "single" | "multiple";
  required?: boolean;
  multiple?: boolean;
  options: CustomizationOption[];
  choices?: string[]; // for selected values
}
