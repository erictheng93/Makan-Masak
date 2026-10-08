// ==========================================
// Reservation Types - 訂位系統
// ==========================================

/**
 * 訂位狀態
 */
export enum ReservationStatus {
  PENDING = "pending", // 待確認
  CONFIRMED = "confirmed", // 已確認
  ARRIVED = "arrived", // 已到店
  SEATED = "seated", // 已入座
  COMPLETED = "completed", // 已完成
  CANCELLED = "cancelled", // 已取消
  NO_SHOW = "no_show", // 未到店
}

/**
 * 訂位實體
 */
export interface Reservation {
  id: string;
  restaurantId: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  partySize: number;
  reservationDate: string; // YYYY-MM-DD
  reservationTime: string; // HH:MM
  durationMinutes: number;
  tableId?: number;
  specialRequests?: string;
  status: ReservationStatus;
  confirmationCode: string;
  notes?: string;
  createdAt: number;
  confirmedAt?: number;
  remindedAt?: number;
  arrivedAt?: number;
  seatedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  noShowAt?: number;
  updatedAt: number;
}

/**
 * 建立訂位請求
 */
export interface CreateReservationRequest {
  restaurantId: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  partySize: number;
  reservationDate: string;
  reservationTime: string;
  durationMinutes?: number;
  specialRequests?: string;
}

/**
 * 更新訂位請求
 */
export interface UpdateReservationRequest {
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  partySize?: number;
  reservationDate?: string;
  reservationTime?: string;
  durationMinutes?: number;
  tableId?: number;
  specialRequests?: string;
  notes?: string;
}

/**
 * 訂位查詢過濾器
 */
export interface ReservationFilters {
  restaurantId?: string;
  customerId?: string;
  customerPhone?: string;
  status?: ReservationStatus | ReservationStatus[];
  reservationDate?: string;
  startDate?: string;
  endDate?: string;
  tableId?: number;
  confirmationCode?: string;
  page?: number;
  limit?: number;
  sortBy?: "createdAt" | "reservationDate" | "reservationTime";
  sortOrder?: "asc" | "desc";
}

/**
 * 訂位回應（含桌位資訊）
 */
export interface ReservationResponse extends Reservation {
  table?: {
    id: number;
    number: string;
    capacity: number;
    location?: string;
  };
  customer?: {
    id: string;
    fullName: string;
    email?: string;
    phone?: string;
  };
}

/**
 * 時段可用性查詢請求
 */
export interface AvailabilityRequest {
  restaurantId: string;
  date: string; // YYYY-MM-DD
  partySize: number;
  duration?: number; // 用餐時長（分鐘）
}

/**
 * 時段可用性回應
 */
export interface TimeSlotAvailability {
  time: string; // HH:MM
  available: boolean;
  remainingCapacity: number;
  remainingTables: number;
  occupancyRate: number; // 0-1
  reason?: string; // 不可用原因
}

/**
 * 可用性查詢回應
 */
export interface AvailabilityResponse {
  date: string;
  partySize: number;
  slots: TimeSlotAvailability[];
}

// ==========================================
// Waiting List Types - 候位系統
// ==========================================

/**
 * 候位狀態
 */
export enum WaitingStatus {
  WAITING = "waiting", // 等待中
  CALLED = "called", // 已叫號
  CONFIRMED = "confirmed", // 已確認
  SEATED = "seated", // 已入座
  CANCELLED = "cancelled", // 已取消
  EXPIRED = "expired", // 已過號
  NO_SHOW = "no_show", // 未到
}

/**
 * 候位實體
 */
export interface WaitingListEntry {
  id: string;
  restaurantId: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  partySize: number;
  preferredTableType?: string;
  queueNumber: number;
  queueLetter?: string;
  priority: number;
  estimatedWaitMinutes?: number;
  tableId?: number;
  status: WaitingStatus;
  notes?: string;
  createdAt: number;
  calledAt?: number;
  notifiedAt?: number;
  confirmedAt?: number;
  seatedAt?: number;
  cancelledAt?: number;
  expiredAt?: number;
  timeoutAt?: number;
  updatedAt: number;
}

/**
 * 加入候位請求
 */
export interface JoinWaitingListRequest {
  restaurantId: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  partySize: number;
  preferredTableType?: "2-person" | "4-person" | "6-person+";
  notes?: string;
}

/**
 * 候位查詢過濾器
 */
export interface WaitingListFilters {
  restaurantId?: string;
  status?: WaitingStatus | WaitingStatus[];
  customerPhone?: string;
  date?: string; // YYYY-MM-DD
  page?: number;
  limit?: number;
}

/**
 * 候位回應（含位置資訊）
 */
export interface WaitingListResponse extends WaitingListEntry {
  queueDisplay: string; // 如 "A005"
  partiesAhead: number; // 前方還有幾組
  table?: {
    id: number;
    number: string;
    capacity: number;
  };
  /**
   * G4 idempotency marker. Set to `true` when joinWaitingList detects
   * the same customer (restaurant + phone, same local day) already has
   * an active ticket and returns it instead of creating a new one.
   * Absent / undefined for fresh joins.
   */
  alreadyJoined?: boolean;
  /** Private guest capability, issued only after ownership is established. */
  waitingToken?: string;
}

/**
 * 叫號請求
 */
export interface CallWaitingRequest {
  tableId: number; // 分配的桌位
}

/**
 * 候位隊列狀態
 */
export interface QueueStatus {
  restaurantId: string;
  totalWaiting: number;
  averageWaitMinutes: number;
  availableTables: number;
  byTableType: {
    type: string;
    waiting: number;
    averageWait: number;
  }[];
}

// ==========================================
// Reservation Slot Types - 時段容量
// ==========================================

/**
 * 時段容量實體
 */
export interface ReservationSlot {
  id: string;
  restaurantId: string;
  date: string; // YYYY-MM-DD
  timeSlot: string; // HH:MM
  maxCapacity: number;
  maxTables: number;
  currentReservations: number;
  currentCapacity: number;
  isAvailable: boolean;
  blockReason?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 建立時段請求
 */
export interface CreateSlotRequest {
  restaurantId: string;
  date: string;
  timeSlot: string;
  maxCapacity: number;
  maxTables: number;
  isAvailable?: boolean;
}

/**
 * 更新時段請求
 */
export interface UpdateSlotRequest {
  maxCapacity?: number;
  maxTables?: number;
  isAvailable?: boolean;
  blockReason?: string;
}

/**
 * 批次建立時段請求
 */
export interface BatchCreateSlotsRequest {
  restaurantId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  timeSlots: string[]; // ["11:00", "11:30", ...]
  maxCapacity: number;
  maxTables: number;
}

// ==========================================
// Statistics Types - 統計
// ==========================================

/**
 * 訂位統計
 */
export interface ReservationStats {
  restaurantId: string;
  date?: string;
  totalReservations: number;
  confirmedCount: number;
  completedCount: number;
  noShowCount: number;
  cancelledCount: number;
  totalGuests: number;
  noShowRate: number; // 百分比
  averagePartySize: number;
}

/**
 * 候位統計
 */
export interface WaitingStats {
  restaurantId: string;
  date?: string;
  totalWaiting: number;
  seatedCount: number;
  expiredCount: number;
  cancelledCount: number;
  avgWaitMinutes: number;
  expireRate: number; // 百分比
}

/**
 * 桌位使用率
 */
export interface TableUtilization {
  restaurantId: string;
  totalTables: number;
  availableTables: number;
  occupiedTables: number;
  reservedTables: number;
  cleaningTables: number;
  occupancyRate: number; // 百分比
}

// ==========================================
// Notification Types - 通知
// ==========================================

/**
 * 通知類型
 */
export enum NotificationType {
  RESERVATION_CONFIRMED = "reservation_confirmed",
  RESERVATION_REMINDER = "reservation_reminder",
  RESERVATION_CANCELLED = "reservation_cancelled",
  WAITING_CONFIRMED = "waiting_confirmed",
  WAITING_CALLED = "waiting_called",
  WAITING_ABOUT_TO_EXPIRE = "waiting_about_to_expire",
  WAITING_EXPIRED = "waiting_expired",
}

/**
 * 通知請求
 */
export interface NotificationRequest {
  type: NotificationType;
  recipientPhone: string;
  recipientEmail?: string;
  data: Record<string, unknown>; // 通知相關數據
}

// ==========================================
// Algorithm Types - 演算法
// ==========================================

/**
 * 桌位分配請求
 */
export interface TableAssignmentRequest {
  restaurantId: string;
  partySize: number;
  reservationTime?: string; // HH:MM (訂位) 或 null (候位)
  specialRequests?: string;
}

/**
 * 桌位分配結果
 */
export interface TableAssignmentResult {
  tableId: number;
  tableNumber: string;
  confidence: number; // 0-1，匹配信心度
  reason: string; // 分配原因
}

/**
 * 等待時間預估請求
 */
export interface WaitTimeEstimateRequest {
  restaurantId: string;
  partySize: number;
  currentTime?: string; // HH:MM
}

/**
 * 等待時間預估結果
 */
export interface WaitTimeEstimateResult {
  estimatedWaitMinutes: number;
  partiesAhead: number;
  availableTables: number;
  confidence: number; // 0-1，預估準確度
}
