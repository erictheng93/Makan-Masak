/**
 * Group Orders Types
 * TypeScript type definitions for the group orders feature
 */

import type { BaseEntity } from "../../../shared/types";
import type { SettledBy } from "@makanmasak/database";
import type {
  CartItemCustomizations,
  GroupActivityMetadata,
  GroupOrderFeeMode,
  GroupOrderFinalizeFailure,
  GroupOrderStatus,
} from "@makanmasak/shared-types";

// Core Group Order Types
export interface GroupOrder extends Omit<BaseEntity, "id"> {
  // Group order tables use TEXT UUID primary keys, not numeric ids.
  id: string;
  groupOrderId: string;
  restaurantId: string;
  tableId?: number;
  shareCode: string;
  createdBy: string | null;
  status: GroupOrderStatus;
  expiresAt: Date;
  maxMembers: number;
  /** How finalize will divide the bill. Host-controlled. */
  splitType: string;
  /** Whether expiry submits the cart as a real order. Host-controlled. */
  autoSubmitOnExpiry: boolean;
  /** Who carries the service charge and tax. Host-controlled. */
  feeMode: GroupOrderFeeMode;
  permissions: GroupOrderPermissions;
  totalAmount: number;
  finalizedAt?: Date;
  paidAt?: Date;
  finalizeFailure?: GroupOrderFinalizeFailure;
}

export interface GroupOrderMember extends Omit<BaseEntity, "id"> {
  // UUID primary key (see GroupOrder.id).
  id: string;
  memberId: string;
  groupOrderId: string;
  memberName: string;
  phone?: string;
  email?: string;
  isHost: boolean;
  joinedAt: Date;
  leftAt?: Date;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  /** True only when restaurant staff or a payment provider confirmed payment. */
  revenueRecognised?: boolean;
  /** Settlement source; `self` remains paid but is not restaurant revenue. */
  settledBy?: SettledBy | null;
}

export interface GroupOrderCartItem extends Omit<BaseEntity, "id"> {
  // UUID primary key (see GroupOrder.id).
  id: string;
  itemId: string;
  groupOrderId: string;
  memberId: string;
  menuItemId: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitPriceCents?: number | null;
  totalPriceCents?: number | null;
  menuItem?: {
    id: number;
    name: string;
    price: number;
    imageUrl?: string;
  };
  customizations: CartItemCustomizations;
  specialInstructions?: string;
}

export interface GroupOrderCartItemWithMenu extends GroupOrderCartItem {
  menuItem: {
    id: number;
    name: string;
    price: number;
    imageUrl?: string;
  };
}

// Enums

/**
 * Group order status now lives in `@makanmasak/shared-types` so the customer
 * app holds the same union instead of translating into a vocabulary of its
 * own. Re-exported here because this module is the feature's public surface
 * and every existing import already points at it.
 */
export {
  GROUP_ORDER_STATUSES,
  parseGroupOrderStatus,
} from "@makanmasak/shared-types";
export type { GroupOrderStatus } from "@makanmasak/shared-types";

export type PaymentStatus =
  | "pending" // 等待付款
  | "partial" // 部分付款
  | "paid" // 已付款
  | "refunded"; // 已退款

export interface GroupOrderPermissions {
  canInviteMembers: boolean;
  canModifyOthersCart: boolean;
  canFinalizeOrder: boolean;
  canSplitBill: boolean;
  canProcessPayment: boolean;
}

// Request/Response Types
export interface CreateGroupOrderRequest {
  restaurantId: string;
  tableId?: number;
  expirationHours?: number;
  expirationMinutes?: number;
  maxMembers?: number;
  expectedMembers?: number;
  hostName?: string;
  notes?: string;
  tableNumber?: string;
  permissions?: Partial<GroupOrderPermissions>;
  fulfillmentType?: "dine_in" | "delivery" | "pickup";
  deliveryAddress?: {
    line1: string;
    line2?: string;
    contactPhone?: string;
    notes?: string;
  };
  pickupAt?: string;
  autoSubmitOnExpiry?: boolean;
  feeMode?: GroupOrderFeeMode;
}

export interface CreateGroupOrderResponse {
  groupOrderId: string;
  shareCode: string;
  expiresAt: Date;
  host: GroupOrderMember;
  /**
   * The host's own membership credential (`group_members.session_id`).
   *
   * Secret, and returned exactly once — to the caller who created the group.
   * It is the proof exchanged at POST /realtime/auth/group-token for a realtime
   * token. Never put it on `GroupOrderMember`: that type is used for member
   * *listings*, which would hand every member everyone else's credential.
   */
  memberToken: string;
  recoveryCode: string;
}

export interface GroupOrderJoinPreview {
  groupOrderId: string;
  restaurantId: string;
  hostName: string;
  memberCount: number;
  fulfillmentType: "dine_in" | "delivery" | "pickup";
  expiresAt: Date;
  status: GroupOrderStatus;
}

export interface JoinGroupRequest {
  memberName: string;
  phone?: string;
  email?: string;
}

export interface JoinGroupResponse {
  member: GroupOrderMember;
  groupOrder: GroupOrder;
  /** See CreateGroupOrderResponse.memberToken — secret, returned once. */
  memberToken: string;
}

export interface AddCartItemRequest {
  memberId: string;
  menuItemId: number;
  quantity: number;
  customizations?: Record<string, unknown>;
  specialInstructions?: string;
}

export interface UpdateCartItemRequest {
  quantity?: number;
  customizations?: Record<string, unknown>;
  specialInstructions?: string;
}

export interface SplitBillRequest {
  splitType: "equal" | "proportional" | "individual" | "by_item" | "custom";
  /** Overrides the group's stored choice; finalize relies on the stored one. */
  feeMode?: GroupOrderFeeMode;
  // No tax or service-charge rate: splitBill reads both from the
  // restaurant's settings, the same place an ordinary order's come from.
  sharedServiceChargeCents?: number;
  sharedTaxCents?: number;
  orderTotalCents?: number;
  customSplits?: Array<{
    memberId: string;
    amount: number;
    items: unknown[];
  }>;
  customAmounts?: Array<{
    memberId: string;
    amount: number;
  }>;
}

export interface ProcessPaymentRequest {
  paymentMethod: string;
  amount?: number; // Optional - will use amount from split_bills if not provided
  transactionId?: string;
  paymentDetails?: Record<string, unknown>; // Additional payment details (card info, etc.)
}

// Response Types
export interface GroupOrderSummary {
  groupOrder: GroupOrder;
  members: GroupOrderMember[];
  cartItems: GroupOrderCartItemWithMenu[];
  totalAmount: number;
  activities: GroupOrderActivity[];
  /**
   * Empty until the bill is split. Carried on the summary rather than behind
   * its own endpoint because settling is a shared moment: everyone watches the
   * same list fill in, and the summary is already the thing that refreshes.
   */
  splitBills: GroupOrderSplitBill[];
}

export interface GroupOrderSplitBill {
  id: string;
  memberId: string;
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  totalAmount: number;
  paymentStatus: string;
  /** Whose word the settlement is; null while pending. See SettledBy. */
  settledBy: SettledBy | null;
  paidAt?: Date;
}

export interface GroupOrderActivity extends Omit<BaseEntity, "id"> {
  // UUID primary key (see GroupOrder.id).
  id: string;
  activityId: string;
  groupOrderId: string;
  memberId?: string;
  memberName?: string;
  type: ActivityType;
  description: string;
  metadata?: GroupActivityMetadata;
  timestamp: Date;
}

export type ActivityType =
  | "group_created"
  | "member_joined"
  | "member_left"
  | "item_added"
  | "item_updated"
  | "item_removed"
  | "bill_split"
  | "payment_made"
  | "order_finalized"
  | "order_cancelled"
  | "group_expired"
  | "finalize_claim_abandoned";

// Statistics and Analytics
export interface GroupOrderStatistics {
  totalGroupOrders: number;
  activeGroupOrders: number;
  averageGroupSize: number;
  averageOrderValue: number;
  popularTimeSlots: Array<{
    hour: number;
    count: number;
  }>;
  conversionRate: number;
  paymentMethodDistribution: Record<string, number>;
}

// Service Interface
export interface IGroupOrderService {
  // Core operations
  createGroupOrder(
    data: CreateGroupOrderRequest,
    hostId: string | null,
  ): Promise<{
    success: boolean;
    data?: CreateGroupOrderResponse;
    error?: string;
  }>;
  joinGroup(
    shareCode: string,
    memberData: JoinGroupRequest,
  ): Promise<{ success: boolean; data?: JoinGroupResponse; error?: string }>;
  getGroupOrder(groupOrderId: string): Promise<GroupOrderSummary | null>;

  // Cart operations
  addCartItem(
    groupOrderId: string,
    itemData: AddCartItemRequest,
  ): Promise<{ success: boolean; data?: GroupOrderCartItem; error?: string }>;
  updateCartItem(
    groupOrderId: string,
    itemId: string,
    updateData: UpdateCartItemRequest,
  ): Promise<{ success: boolean; data?: GroupOrderCartItem; error?: string }>;
  removeCartItem(
    groupOrderId: string,
    itemId: string,
    memberId: string,
  ): Promise<{ success: boolean; error?: string }>;

  // Bill and payment operations
  splitBill(
    groupOrderId: string,
    splitData: SplitBillRequest,
  ): Promise<{ success: boolean; data?: unknown; error?: string }>;
  finalizeGroupOrder(groupOrderId: string): Promise<{
    success: boolean;
    data?: { masterOrderId: string; status: "completed" };
    error?: string;
  }>;
  processPayment(
    groupOrderId: string,
    memberId: string,
    paymentData: ProcessPaymentRequest,
    settledBy: SettledBy,
  ): Promise<{ success: boolean; data?: unknown; error?: string }>;

  // Group management
  leaveGroup(
    groupOrderId: string,
    memberId: string,
  ): Promise<{ success: boolean; error?: string }>;
  getActivities(groupOrderId: string): Promise<GroupOrderActivity[]>;

  // Maintenance
  cleanupExpiredGroups(): Promise<{ cleaned: number; errors: string[] }>;

  // Statistics
  getStatistics(
    restaurantId?: string,
    timeRange?: string,
  ): Promise<GroupOrderStatistics>;
}

// Error Types
export interface GroupOrderError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export const GROUP_ORDER_ERROR_CODES = {
  GROUP_NOT_FOUND: "GROUP_NOT_FOUND",
  GROUP_EXPIRED: "GROUP_EXPIRED",
  GROUP_FULL: "GROUP_FULL",
  MEMBER_NOT_FOUND: "MEMBER_NOT_FOUND",
  MEMBER_ALREADY_EXISTS: "MEMBER_ALREADY_EXISTS",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  INVALID_SHARE_CODE: "INVALID_SHARE_CODE",
  CART_ITEM_NOT_FOUND: "CART_ITEM_NOT_FOUND",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  GROUP_LOCKED: "GROUP_LOCKED",
  GROUP_FINALIZED: "GROUP_FINALIZED",
} as const;

export type GroupOrderErrorCode =
  (typeof GROUP_ORDER_ERROR_CODES)[keyof typeof GROUP_ORDER_ERROR_CODES];

// Events for real-time updates
export type GroupOrderEvent =
  | {
      type: "GROUP_CREATED";
      payload: { groupOrderId: string; shareCode: string };
    }
  | {
      type: "MEMBER_JOINED";
      payload: { groupOrderId: string; member: GroupOrderMember };
    }
  | { type: "MEMBER_LEFT"; payload: { groupOrderId: string; memberId: string } }
  | {
      type: "CART_UPDATED";
      payload: {
        groupOrderId: string;
        item: GroupOrderCartItem;
        action: "added" | "updated" | "removed";
      };
    }
  | {
      type: "BILL_SPLIT";
      payload: { groupOrderId: string; splitData: unknown };
    }
  | {
      type: "PAYMENT_MADE";
      payload: { groupOrderId: string; memberId: string; amount: number };
    }
  | {
      type: "ORDER_FINALIZED";
      payload: { groupOrderId: string; totalAmount: number };
    }
  | {
      type: "ORDER_CANCELLED";
      payload: { groupOrderId: string; reason: string };
    };
