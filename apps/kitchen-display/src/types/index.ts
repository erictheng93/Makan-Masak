// 廚房專用類型定義

import type { OrderStatus } from "@makanmasak/shared-types";
export type { OrderStatus };

export type ItemStatus = "pending" | "preparing" | "ready" | "completed";

export interface KitchenOrderItem {
  id: number;
  name: string;
  quantity: number;
  status: ItemStatus;
  notes?: string;
  customizations?: string[];
  allergens?: string[];
  estimatedTime?: number; // 預估製作時間（分鐘）
  startedAt?: string;
  completedAt?: string;
  priority: "normal" | "high" | "urgent";
  cookingTime?: number; // 實際製作時間（分鐘）
  price?: number; // 單品價格
}

export interface KitchenOrder {
  // Text UUIDs in production; legacy fixtures and older servers use integers.
  id: string | number;
  orderNumber: string;
  tableId?: number;
  tableName?: string;
  status: OrderStatus;
  deliveryInfo?: {
    type?: "dine_in" | "takeaway" | "delivery";
    address?: string;
    phone?: string;
    instructions?: string;
    deliveryFee?: number;
  };
  orderSource?:
    | "direct"
    | "market_checkout"
    | "uber_eats"
    | "foodpanda"
    | "grabfood";
  items: KitchenOrderItem[];
  customerName?: string;
  notes?: string;
  createdAt: string;
  confirmedAt?: string;
  estimatedTime?: number;
  totalItems: number;
  priority: "normal" | "high" | "urgent";
  elapsedTime: number; // 已等待時間（分鐘）
  assignedChef?: string | number; // 指派的廚師ID
  totalAmount?: number; // 訂單總金額（分）
}

export interface OrderStatusUpdate {
  orderId: string | number;
  itemId?: number;
  status: OrderStatus | ItemStatus;
  timestamp: string;
  updatedBy?: string;
}

// SSE 事件類型
export interface SSEMessage {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

export interface KitchenSSEEvent {
  type:
    | "NEW_ORDER"
    | "new_order"
    | "ORDER_STATUS_UPDATE"
    | "order_status_update"
    | "ORDER_ITEM_STATUS_UPDATE"
    | "order_item_status_update"
    | "ORDER_CANCELLED"
    | "order_cancelled"
    | "PRIORITY_UPDATE"
    | "HEARTBEAT";
  eventId?: string;
  orderId?: string | number;
  payload?: unknown;
  data?: unknown;
  timestamp: string | number;
  restaurantId: number | string;
  connectionId?: string;
  message?: string;
}

// 統計數據
export interface KitchenStats {
  pendingCount: number;
  preparingCount: number;
  readyCount: number;
  completedToday: number;
  averageCookingTime: number;
  averageWaitingTime: number;
  efficiency: number; // 完成率百分比
  urgentOrders: number;
}

// 用戶認證
export interface User {
  id: number;
  username: string;
  name: string;
  role: number;
  restaurantId: number;
  permissions: string[];
  lastLogin?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
}

// API 響應
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: string;
}

export interface KitchenOrdersResponse {
  pending: KitchenOrder[];
  preparing: KitchenOrder[];
  ready: KitchenOrder[];
  stats: KitchenStats;
}

// 設定選項
export interface KitchenSettings {
  audioEnabled: boolean;
  autoRefresh: boolean;
  refreshInterval: number; // 秒
  showEstimatedTime: boolean;
  showCustomerNames: boolean;
  theme: "light" | "dark" | "high-contrast";
  fontSize: "normal" | "large" | "extra-large";
  urgentThreshold: number; // 分鐘
  warningThreshold: number; // 分鐘
  soundVolume: number; // 0-100
  keyboardShortcuts: boolean;
}

// 連接狀態
export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error";

export interface ConnectionState {
  status: ConnectionStatus;
  lastConnected?: string;
  reconnectAttempts: number;
  latency?: number;
}

// 音效類型
export type SoundType =
  | "new-order"
  | "urgent-alert"
  | "order-ready"
  | "notification";

// 性能指標
export interface PerformanceMetrics {
  ordersProcessed: number;
  averageProcessingTime: number;
  peakHours: { hour: number; count: number }[];
  efficiency: number;
  errorRate: number;
}

// 歷史記錄
export interface HistoryRecord {
  id: number;
  orderId: string | number;
  orderNumber: string;
  action: string;
  timestamp: string;
  userId: number;
  userName: string;
  details?: unknown;
}
