/**
 * 即時通訊事件型別定義
 *
 * 此檔案定義了所有 WebSocket 即時通訊的事件型別，
 * 確保前端、後端和即時服務之間的型別安全。
 */

import type { OrderStatus, OrderItemStatus, PlatformSource } from "./order";
import type { MenuItem } from "./menu";

// ============================================================================
// 房間類型定義
// ============================================================================

/**
 * WebSocket 連線的房間類型
 */
export type RoomType =
  | "customer" // 顧客房間（桌號或店鋪）
  | "kitchen" // 廚房顯示系統
  | "admin" // 管理後台
  | "restaurant"; // 餐廳級別（所有訂單）

/**
 * 房間 ID 格式
 * - customer: tableId (e.g., "T1") 或 restaurantId (e.g., "R123")
 * - kitchen: restaurantId (e.g., "R123")
 * - admin: restaurantId (e.g., "R123")
 * - restaurant: restaurantId (e.g., "R123")
 */
export type RoomId = string;

// ============================================================================
// 認證與授權型別
// ============================================================================

/**
 * WebSocket 連線授權資訊
 */
export interface RealtimeAuthPayload {
  /** 房間類型 */
  roomType: RoomType;
  /** 房間 ID */
  roomId: RoomId;
  /** 餐廳 ID */
  restaurantId: string;
  /** 使用者角色 */
  role: "customer" | "staff" | "admin";
  /** 原始應用角色代碼（0=ADMIN, 1=OWNER, ...） */
  appRole?: number;
  scope?: "guest-realtime" | "group-order-realtime";
  guestFlag?: boolean;
  /** 桌號 ID（顧客連線時使用） */
  tableId?: string;
  orderId?: string;
  /** 群組訂單 ID（scope=group-order-realtime 時，roomId 即等於此值） */
  groupOrderId?: string;
  /** 群組成員 ID（僅供稽核，不作為授權依據） */
  memberId?: string;
  /** 座位 ID（座位級別連線時使用） */
  seatId?: string;
  /** 使用者 ID（已登入使用者） */
  userId?: string;
  /** UUID public user id during staff identity migration */
  publicUserId?: string;
  /** Token 過期時間（Unix timestamp） */
  exp: number;
  /** Token 發行時間（Unix timestamp） */
  iat: number;
}

/**
 * 請求 WebSocket 授權 Token 的參數
 */
export interface RealtimeAuthTokenRequest {
  /** 房間類型 */
  roomType: RoomType;
  /** 房間 ID */
  roomId: RoomId;
  /** 餐廳 ID */
  restaurantId: string;
  /** 桌號 ID（可選） */
  tableId?: string;
  /** 座位 ID（可選） */
  seatId?: string;
  /** 使用者會話 ID（已登入使用者） */
  sessionId?: string;
}

/**
 * WebSocket 授權 Token 回應
 */
export interface RealtimeAuthTokenResponse {
  /** JWT Token */
  token: string;
  /** Token 過期時間（秒） */
  expiresIn: number;
  /** WebSocket 連線 URL */
  wsUrl: string;
}

export interface GuestRealtimeTokenRequest {
  restaurantId: string;
  guestToken?: string;
  tableId?: string;
  seatId?: string;
  orderId?: string;
  qrCode?: string;
}

export interface GuestRealtimeTokenResponse {
  token: string;
  expiresAt: string;
  wsUrl: string;
}

/**
 * 以群組訂單成員憑證換取即時連線 token。
 * memberToken 即 group_members.session_id，僅在建立/加入群組時回傳給該成員一次。
 */
export interface GroupOrderRealtimeTokenRequest {
  groupOrderId: string;
  memberToken: string;
}

export interface GroupOrderRealtimeTokenResponse {
  token: string;
  expiresAt: string;
  wsUrl: string;
}

// ============================================================================
// 基礎訊息結構
// ============================================================================

/**
 * 事件類型列舉
 */
export enum RealtimeEventType {
  // 訂單事件
  NEW_ORDER = "new_order",
  ORDER_STATUS_UPDATE = "order_status_update",
  ORDER_ITEM_STATUS_UPDATE = "order_item_status_update",
  ORDER_CANCELLED = "order_cancelled",

  // 廚房事件
  KITCHEN_ITEM_STATUS = "kitchen_item_status",
  KITCHEN_QUEUE_UPDATE = "kitchen_queue_update",

  // 桌台事件
  TABLE_STATUS_UPDATE = "table_status_update",
  TABLE_CALL_SERVICE = "table_call_service",

  // 菜單事件
  MENU_AVAILABILITY_UPDATE = "menu_availability_update",
  MENU_ITEM_UPDATE = "menu_item_update",

  // 系統事件
  SYSTEM_NOTIFICATION = "system_notification",
  CONNECTION_ACK = "connection_ack",
  HEARTBEAT = "heartbeat",
  ERROR = "error",

  // 餐廳事件
  RESTAURANT_STATUS_UPDATE = "restaurant_status_update",

  // 候位事件 (G1)
  WAITING_LIST_JOINED = "waiting_list_joined",
  WAITING_LIST_CALLED = "waiting_list_called",
  WAITING_LIST_CONFIRMED = "waiting_list_confirmed",
  WAITING_LIST_SEATED = "waiting_list_seated",
  WAITING_LIST_CANCELLED = "waiting_list_cancelled",
  WAITING_LIST_EXPIRED = "waiting_list_expired",

  // 群組訂單事件 (G2)
  GROUP_ORDER_CREATED = "group_order_created",
  GROUP_MEMBER_JOINED = "group_member_joined",
  GROUP_CART_ITEM_ADDED = "group_cart_item_added",
  GROUP_CART_ITEM_UPDATED = "group_cart_item_updated",
  GROUP_CART_ITEM_REMOVED = "group_cart_item_removed",
  GROUP_ORDER_COMPLETED = "group_order_completed",
}

/**
 * 基礎即時訊息介面
 */
export interface BaseRealtimeEvent {
  /** 事件類型 */
  type: RealtimeEventType;
  /** 事件 ID（用於去重和追蹤） */
  eventId: string;
  /** 事件時間戳（Unix timestamp） */
  timestamp: number;
  /** 餐廳 ID */
  restaurantId: string;
}

// ============================================================================
// 訂單相關事件
// ============================================================================

/**
 * 新訂單事件
 */
export interface NewOrderEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.NEW_ORDER;
  data: {
    /** 訂單 ID */
    orderId: string;
    /** 訂單公開 UUID */
    orderPublicId?: string;
    /** 訂單編號 */
    orderNumber: string;
    /** 桌號 ID */
    tableId?: string;
    /** 桌號名稱 */
    tableName?: string;
    /** 座位 ID */
    seatId?: string;
    /** 訂單項目 */
    items: Array<{
      orderItemId: number;
      menuItemId: number;
      menuItemName: string;
      quantity: number;
      price: number;
      notes?: string;
    }>;
    /** 訂單總金額 */
    totalAmount: number;
    /** 訂單來源 */
    orderSource?: PlatformSource;
    /** 訂單備註 */
    notes?: string;
    /** 顧客資訊 */
    customer?: {
      name?: string;
      phone?: string;
    };
  };
}

/**
 * 訂單狀態更新事件
 */
export interface OrderStatusUpdateEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.ORDER_STATUS_UPDATE;
  data: {
    /** 訂單 ID */
    orderId: string;
    /** 訂單公開 UUID */
    orderPublicId?: string;
    /** 訂單編號 */
    orderNumber: string;
    /** 新狀態 */
    status: OrderStatus;
    /** 舊狀態 */
    previousStatus: OrderStatus;
    /** 預估完成時間（分鐘） */
    estimatedTime?: number;
    /** 更新訊息 */
    message?: string;
    /** 更新者 */
    updatedBy?: {
      userId: string;
      userName: string;
      role: string;
    };
  };
}

/**
 * 訂單項目狀態更新事件
 */
export interface OrderItemStatusUpdateEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.ORDER_ITEM_STATUS_UPDATE;
  data: {
    /** 訂單 ID */
    orderId: string;
    /** 訂單公開 UUID */
    orderPublicId?: string;
    /** 訂單項目 ID */
    orderItemId: number;
    /** 菜單項目 ID */
    menuItemId: number;
    /** 菜單項目名稱 */
    menuItemName: string;
    /** 新狀態 */
    status: OrderItemStatus;
    /** 舊狀態 */
    previousStatus: OrderItemStatus;
    /** 更新時間 */
    updatedAt: number;
  };
}

/**
 * 訂單取消事件
 */
export interface OrderCancelledEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.ORDER_CANCELLED;
  data: {
    /** 訂單 ID */
    orderId: string;
    /** 訂單公開 UUID */
    orderPublicId?: string;
    /** 訂單編號 */
    orderNumber: string;
    /** 取消原因 */
    reason: string;
    /** 取消者 */
    cancelledBy: {
      userId: string;
      userName: string;
      role: string;
    };
  };
}

// ============================================================================
// 廚房相關事件
// ============================================================================

/**
 * 廚房項目狀態事件
 */
export interface KitchenItemStatusEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.KITCHEN_ITEM_STATUS;
  data: {
    /** 訂單 ID */
    orderId: string;
    /** 訂單公開 UUID */
    orderPublicId?: string;
    /** 訂單項目 ID */
    orderItemId: number;
    /** 菜單項目名稱 */
    menuItemName: string;
    /** 狀態 */
    status: "pending" | "cooking" | "ready" | "served";
    /** 桌號名稱 */
    tableName?: string;
    /** 優先級 */
    priority?: "normal" | "high" | "urgent";
    /** 等待時間（分鐘） */
    waitingTime?: number;
  };
}

/**
 * 廚房佇列更新事件
 */
export interface KitchenQueueUpdateEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.KITCHEN_QUEUE_UPDATE;
  data: {
    /** 待處理訂單數量 */
    pendingCount: number;
    /** 烹飪中訂單數量 */
    cookingCount: number;
    /** 已完成訂單數量 */
    readyCount: number;
    /** 平均等待時間（分鐘） */
    averageWaitTime: number;
    /** 最舊的待處理訂單（分鐘前） */
    oldestPendingMinutes?: number;
  };
}

// ============================================================================
// 桌台相關事件
// ============================================================================

/**
 * 桌台狀態更新事件
 */
export interface TableStatusUpdateEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.TABLE_STATUS_UPDATE;
  data: {
    /** 桌號 ID */
    tableId: string;
    /** 桌號名稱 */
    tableName: string;
    /** 狀態 */
    status: "available" | "occupied" | "reserved" | "cleaning";
    /** 顧客數量 */
    customerCount?: number;
    /** 當前訂單 ID */
    currentOrderId?: number;
  };
}

/**
 * 桌台呼叫服務事件
 */
export interface TableCallServiceEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.TABLE_CALL_SERVICE;
  data: {
    /** 桌號 ID */
    tableId: string;
    /** 桌號名稱 */
    tableName: string;
    /** 服務類型 */
    serviceType: "water" | "utensils" | "help" | "bill" | "other";
    /** 備註 */
    notes?: string;
    /** 緊急程度 */
    urgency: "low" | "normal" | "high";
  };
}

// ============================================================================
// 菜單相關事件
// ============================================================================

/**
 * 菜單可用性更新事件
 */
export interface MenuAvailabilityUpdateEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.MENU_AVAILABILITY_UPDATE;
  data: {
    /** 菜單項目 ID */
    menuItemId: number;
    /** 菜單項目名稱 */
    menuItemName: string;
    /** 是否可用 */
    isAvailable: boolean;
    /** 庫存數量 */
    inventoryCount?: number;
    /** 原因 */
    reason?: string;
  };
}

/**
 * 菜單項目更新事件
 */
export interface MenuItemUpdateEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.MENU_ITEM_UPDATE;
  data: {
    /** 菜單項目 ID */
    menuItemId: number;
    /** 更新動作 */
    action: "added" | "updated" | "removed";
    /** 菜單項目資料（新增或更新時） */
    menuItem?: Partial<MenuItem>;
  };
}

// ============================================================================
// 系統相關事件
// ============================================================================

/**
 * 系統通知事件
 */
export interface SystemNotificationEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.SYSTEM_NOTIFICATION;
  data: {
    /** 通知 ID */
    notificationId: string;
    /** 通知等級 */
    level: "info" | "success" | "warning" | "error";
    /** 標題 */
    title: string;
    /** 訊息內容 */
    message: string;
    /** 動作 URL */
    actionUrl?: string;
    /** 是否持續顯示直到已讀 */
    persistUntilRead?: boolean;
  };
}

/**
 * 連線確認事件
 */
export interface ConnectionAckEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.CONNECTION_ACK;
  data: {
    /** 連線 ID */
    connectionId: string;
    /** 房間類型 */
    roomType: RoomType;
    /** 房間 ID */
    roomId: RoomId;
    /** 連線時間 */
    connectedAt: number;
    /** 當前房間內的連線數 */
    activeConnections: number;
  };
}

/**
 * 心跳事件
 */
export interface HeartbeatEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.HEARTBEAT;
  data: {
    /** 伺服器時間 */
    serverTime: number;
  };
}

/**
 * 錯誤事件
 */
export interface ErrorEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.ERROR;
  data: {
    /** 錯誤代碼 */
    code: string;
    /** 錯誤訊息 */
    message: string;
    /** 錯誤詳情 */
    details?: Record<string, unknown>;
  };
}

/**
 * 餐廳狀態更新事件
 */
export interface RestaurantStatusUpdateEvent extends BaseRealtimeEvent {
  type: RealtimeEventType.RESTAURANT_STATUS_UPDATE;
  data: {
    /** 是否營業中 */
    isOpen: boolean;
    /** 容納人數 */
    capacity?: number;
    /** 當前訂單數 */
    currentOrders?: number;
    /** 平均等待時間（分鐘） */
    averageWaitTime?: number;
  };
}

// ============================================================================
// 聯合型別
// ============================================================================

/**
 * 所有即時事件的聯合型別
 */
export type RealtimeEvent =
  // 訂單事件
  | NewOrderEvent
  | OrderStatusUpdateEvent
  | OrderItemStatusUpdateEvent
  | OrderCancelledEvent
  // 廚房事件
  | KitchenItemStatusEvent
  | KitchenQueueUpdateEvent
  // 桌台事件
  | TableStatusUpdateEvent
  | TableCallServiceEvent
  // 菜單事件
  | MenuAvailabilityUpdateEvent
  | MenuItemUpdateEvent
  // 系統事件
  | SystemNotificationEvent
  | ConnectionAckEvent
  | HeartbeatEvent
  | ErrorEvent
  | RestaurantStatusUpdateEvent
  // 候位事件 (G1)
  | WaitingListEvent
  // 群組訂單事件 (G2)
  | GroupOrderEvent;

/**
 * 候位生命週期事件 (G1)
 *
 * 同一介面涵蓋 6 個 lifecycle 事件，由 type 欄位區分：
 *   waiting_list_joined / called / confirmed / seated / cancelled / expired
 *
 * 廣播 room 為 `admin:${restaurantId}`（admin-dashboard 既有的
 * realtime worker 連線點），由 RealtimeBroadcastService.broadcastEvent
 * 負責路由。
 */
export interface WaitingListEvent extends BaseRealtimeEvent {
  type:
    | RealtimeEventType.WAITING_LIST_JOINED
    | RealtimeEventType.WAITING_LIST_CALLED
    | RealtimeEventType.WAITING_LIST_CONFIRMED
    | RealtimeEventType.WAITING_LIST_SEATED
    | RealtimeEventType.WAITING_LIST_CANCELLED
    | RealtimeEventType.WAITING_LIST_EXPIRED;
  data: {
    /** Waiting list entry id (UUID v7) */
    entryId: string;
    /** 顯示用號碼，例如 "A005" */
    queueDisplay: string;
    /** 當前狀態（與 type 一致，方便客戶端不解析 type 也能拿到） */
    status: string;
    /** 前方還有幾組（僅在 joined / 顯示位置時填） */
    partiesAhead?: number;
    /** 派位後的 tableId（called / seated 時填） */
    tableId?: number | null;
    /** 顧客姓名 */
    customerName?: string;
  };
}

/**
 * 群組訂單事件 (G2)
 *
 * 同一介面涵蓋 6 個群組訂單事件，由 type 欄位區分：
 *   group_order_created / group_member_joined / group_cart_item_added /
 *   group_cart_item_updated / group_cart_item_removed / group_order_completed
 *
 * 廣播 room 為 `customer:${groupOrderId}`（群組參與者連線的房間；DO 實例即以
 * groupOrderId 隔離）。data 的額外欄位依事件類型而異，因此除必備的
 * groupOrderId 外以索引簽章保留彈性。
 */
export interface GroupOrderEvent extends BaseRealtimeEvent {
  type:
    | RealtimeEventType.GROUP_ORDER_CREATED
    | RealtimeEventType.GROUP_MEMBER_JOINED
    | RealtimeEventType.GROUP_CART_ITEM_ADDED
    | RealtimeEventType.GROUP_CART_ITEM_UPDATED
    | RealtimeEventType.GROUP_CART_ITEM_REMOVED
    | RealtimeEventType.GROUP_ORDER_COMPLETED;
  data: {
    /** 群組訂單 ID */
    groupOrderId: string;
    /** 其餘事件相關欄位（依事件類型而異） */
    [key: string]: unknown;
  };
}

// ============================================================================
// 型別守衛函式
// ============================================================================

/**
 * 檢查是否為可交給 realtime worker broadcast 的事件格式。
 *
 * TypeScript can say `restaurantId: string`, but it cannot stop runtime code
 * from producing `String(undefined ?? "")`. Keep this predicate shared by
 * producers and consumers so invalid broadcast events fail before routing.
 */
export function isValidRealtimeEvent(event: unknown): event is RealtimeEvent {
  if (!event || typeof event !== "object") return false;

  const candidate = event as Partial<BaseRealtimeEvent> & {
    data?: unknown;
  };

  return (
    isRealtimeEventType(candidate.type) &&
    isNonEmptyString(candidate.eventId) &&
    typeof candidate.timestamp === "number" &&
    Number.isFinite(candidate.timestamp) &&
    isNonEmptyString(candidate.restaurantId) &&
    candidate.data !== null &&
    typeof candidate.data === "object" &&
    !Array.isArray(candidate.data)
  );
}

function isRealtimeEventType(value: unknown): value is RealtimeEventType {
  return (
    typeof value === "string" &&
    (Object.values(RealtimeEventType) as string[]).includes(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 檢查是否為新訂單事件
 */
export function isNewOrderEvent(event: RealtimeEvent): event is NewOrderEvent {
  return event.type === RealtimeEventType.NEW_ORDER;
}

/**
 * 檢查是否為訂單狀態更新事件
 */
export function isOrderStatusUpdateEvent(
  event: RealtimeEvent,
): event is OrderStatusUpdateEvent {
  return event.type === RealtimeEventType.ORDER_STATUS_UPDATE;
}

/**
 * 檢查是否為訂單項目狀態更新事件
 */
export function isOrderItemStatusUpdateEvent(
  event: RealtimeEvent,
): event is OrderItemStatusUpdateEvent {
  return event.type === RealtimeEventType.ORDER_ITEM_STATUS_UPDATE;
}

/**
 * 檢查是否為訂單取消事件
 */
export function isOrderCancelledEvent(
  event: RealtimeEvent,
): event is OrderCancelledEvent {
  return event.type === RealtimeEventType.ORDER_CANCELLED;
}

/**
 * 檢查是否為廚房項目狀態事件
 */
export function isKitchenItemStatusEvent(
  event: RealtimeEvent,
): event is KitchenItemStatusEvent {
  return event.type === RealtimeEventType.KITCHEN_ITEM_STATUS;
}

/**
 * 檢查是否為廚房佇列更新事件
 */
export function isKitchenQueueUpdateEvent(
  event: RealtimeEvent,
): event is KitchenQueueUpdateEvent {
  return event.type === RealtimeEventType.KITCHEN_QUEUE_UPDATE;
}

/**
 * 檢查是否為桌台狀態更新事件
 */
export function isTableStatusUpdateEvent(
  event: RealtimeEvent,
): event is TableStatusUpdateEvent {
  return event.type === RealtimeEventType.TABLE_STATUS_UPDATE;
}

/**
 * 檢查是否為桌台呼叫服務事件
 */
export function isTableCallServiceEvent(
  event: RealtimeEvent,
): event is TableCallServiceEvent {
  return event.type === RealtimeEventType.TABLE_CALL_SERVICE;
}

/**
 * 檢查是否為菜單可用性更新事件
 */
export function isMenuAvailabilityUpdateEvent(
  event: RealtimeEvent,
): event is MenuAvailabilityUpdateEvent {
  return event.type === RealtimeEventType.MENU_AVAILABILITY_UPDATE;
}

/**
 * 檢查是否為菜單項目更新事件
 */
export function isMenuItemUpdateEvent(
  event: RealtimeEvent,
): event is MenuItemUpdateEvent {
  return event.type === RealtimeEventType.MENU_ITEM_UPDATE;
}

/**
 * 檢查是否為系統通知事件
 */
export function isSystemNotificationEvent(
  event: RealtimeEvent,
): event is SystemNotificationEvent {
  return event.type === RealtimeEventType.SYSTEM_NOTIFICATION;
}

/**
 * 檢查是否為連線確認事件
 */
export function isConnectionAckEvent(
  event: RealtimeEvent,
): event is ConnectionAckEvent {
  return event.type === RealtimeEventType.CONNECTION_ACK;
}

/**
 * 檢查是否為心跳事件
 */
export function isHeartbeatEvent(
  event: RealtimeEvent,
): event is HeartbeatEvent {
  return event.type === RealtimeEventType.HEARTBEAT;
}

/**
 * 檢查是否為錯誤事件
 */
export function isErrorEvent(event: RealtimeEvent): event is ErrorEvent {
  return event.type === RealtimeEventType.ERROR;
}

/**
 * 檢查是否為餐廳狀態更新事件
 */
export function isRestaurantStatusUpdateEvent(
  event: RealtimeEvent,
): event is RestaurantStatusUpdateEvent {
  return event.type === RealtimeEventType.RESTAURANT_STATUS_UPDATE;
}

// ============================================================================
// 客戶端連線狀態
// ============================================================================

/**
 * WebSocket 連線狀態
 */
export interface RealtimeConnectionState {
  /** 連線狀態 */
  status:
    | "connecting"
    | "connected"
    | "disconnecting"
    | "disconnected"
    | "error";
  /** 連線 ID */
  connectionId?: string;
  /** 房間類型 */
  roomType?: RoomType;
  /** 房間 ID */
  roomId?: RoomId;
  /** 最後連線時間 */
  lastConnected?: number;
  /** 重連次數 */
  reconnectAttempts: number;
  /** 最大重連次數 */
  maxReconnectAttempts: number;
  /** 錯誤訊息 */
  error?: string;
}

/**
 * 客戶端發送的訊息（心跳、訂閱等）
 */
export interface ClientMessage {
  /** 訊息類型 */
  type: "ping" | "subscribe" | "unsubscribe";
  /** 時間戳 */
  timestamp: number;
  /** 附加資料 */
  data?: Record<string, unknown>;
}
