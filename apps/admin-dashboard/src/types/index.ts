// Re-export canonical OrderStatus from shared-types (string union, not enum).
// Use string literals directly: "pending", "confirmed", etc. — not OrderStatus.PENDING.
import type { OrderStatus } from "@makanmasak/shared-types";
import type { UserId } from "./api-user";
export type { UserId } from "./api-user";
export type { OrderStatus } from "@makanmasak/shared-types";
export { ORDER_STATUSES } from "@makanmasak/shared-types";

/** Platform admin (role 0) tier; only administrators manage other admins. */
export type AdminTier = "administrator" | "operator" | "support";
export const ADMIN_TIERS: AdminTier[] = [
  "administrator",
  "operator",
  "support",
];

export interface User {
  id: UserId;
  username: string;
  email: string;
  role: UserRole;
  adminTier?: AdminTier;
  restaurantId: string | null;
  loginSlug?: string | null;
  createdAt: string;
  updatedAt: string;
}

export enum UserRole {
  ADMIN = 0,
  OWNER = 1,
  CHEF = 2,
  SERVICE = 3,
  CASHIER = 4,
}

export interface Restaurant {
  id: number;
  name: string;
  address: string;
  phone: string;
  email: string;
  settings: RestaurantSettings;
  createdAt: string;
  updatedAt: string;
}

export interface RestaurantSettings {
  // No `timezone` here: the business day is cut at `restaurants.timezone`, a
  // column of its own since #329. A copy inside settings is a second place for
  // the boundary to live and disagree from.
  currency: string;
  language: string;
  operatingHours: OperatingHours;
  orderSettings: OrderSettings;
}

export interface OperatingHours {
  [key: string]: {
    open: string;
    close: string;
    closed: boolean;
  };
}

export interface OrderSettings {
  autoAcceptOrders: boolean;
  estimatedPrepTime: number;
  allowPreOrders: boolean;
  maxOrdersPerHour: number;
}

export interface MenuItem {
  id: number;
  restaurantId: string;
  categoryId: number;
  name: string;
  description: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  prepTime: number;
  customizations: MenuCustomization[];
  createdAt: string;
  updatedAt: string;
}

export interface MenuCategory {
  id: number;
  restaurantId: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MenuCustomization {
  id: string;
  name: string;
  type: "single" | "multiple";
  required: boolean;
  options: CustomizationOption[];
}

export interface CustomizationOption {
  id: string;
  name: string;
  priceModifier: number;
}

export interface DeliveryInfo {
  type: "dine_in" | "takeaway" | "delivery";
  address?: string;
  phone?: string;
  instructions?: string;
  deliveryFee?: number;
}

export interface Order {
  id: string;
  restaurantId: string;
  tableId?: number;
  orderNumber: string;
  table?: {
    id: number;
    number: string;
  };
  orderType?: "table" | "seat" | "shop";
  status: OrderStatus;
  /**
   * Optimistic-lock counter. The API has always sent it (mapToOrder in
   * packages/database/src/services/order.ts); it was simply never declared
   * here. The item-edit endpoints echo it back so two staff editing one order
   * get a 409 instead of silently overwriting each other.
   */
  version?: number;
  orderSource?:
    | "direct"
    | "market_checkout"
    | "uber_eats"
    | "foodpanda"
    | "grabfood";
  paymentTransactionId?: string;
  subtotal?: number;
  totalAmount: number;
  items: OrderItem[];
  notes?: string;
  customerInfo?: CustomerInfo;
  deliveryInfo?: DeliveryInfo;
  createdAt: number;
  updatedAt: number;
  // Client-side only: the API never sends this field (see the order response
  // assembly in packages/database/src/services/order.ts), it is stamped locally
  // when a status update lands. Hence a string, unlike the two above which
  // carry the API's Unix milliseconds.
  completedAt?: string;
}

export interface OrderItem {
  id: number;
  menuItemId: number;
  quantity: number;
  unitPrice: number;
  /** Snapshot name, so a renamed menu item does not rewrite order history. */
  name?: string;
  totalPrice?: number;
  customizations: OrderItemCustomization[];
  notes?: string;
  menuItem?: {
    id: number;
    name: string;
    imageUrl?: string;
  };
}

export interface OrderItemCustomization {
  customizationId: string;
  optionId: string;
  name: string;
  priceModifier: number;
}

export interface CustomerInfo {
  name?: string;
  phone?: string;
  email?: string;
}

export interface Table {
  id: number;
  restaurantId: string;
  number: string;
  name?: string;
  capacity: number;
  qrCodeUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  todayOrders: number;
  todayRevenue: number;
  averageOrderValue: number;
  completionRate: number;
  topMenuItems: TopMenuItem[];
  revenueChart: ChartData[];
  ordersChart: ChartData[];
}

export interface TopMenuItem {
  id?: string | number;
  name: string;
  quantity?: number;
  count?: number;
  revenue: number;
  category?: string;
  percentage?: number;
}

export interface ChartData {
  label: string;
  value: number;
  date?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  order?: "asc" | "desc";
}

export interface NotificationSettings {
  newOrders: boolean;
  orderStatusChanges: boolean;
  systemAlerts: boolean;
  sound: boolean;
}

export interface SystemNotification {
  id: number;
  type: "urgent_order" | "new_order" | "achievement" | "system_alert";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface UrgentOrderAlert {
  message: string;
}

// Account Management Types (platform-level accounts)
export interface CreateAccountRequest {
  username: string;
  password: string;
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  restaurantId?: number;
  newRestaurantName?: string;
  newRestaurantAddress?: string;
}

export interface PlatformUser {
  id: UserId;
  username: string;
  fullName?: string;
  email: string;
  role: UserRole;
  adminTier?: AdminTier | null;
  restaurantId: string | null;
  restaurantName?: string;
  status?: string;
  createdAt: string;
}
