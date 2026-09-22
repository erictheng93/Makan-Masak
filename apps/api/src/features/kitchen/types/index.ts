/**
 * Kitchen Feature Module Types
 */

export interface KitchenOrder {
  id: string;
  orderNumber: string;
  tableId: number;
  tableName: string;
  status: string; // OrderStatus (canonical string union)
  orderSource?:
    | "direct"
    | "market_checkout"
    | "uber_eats"
    | "foodpanda"
    | "grabfood";
  items: KitchenOrderItem[];
  customerName?: string;
  notes?: string;
  createdAt: number; // Unix ms — matches Order wire contract
  totalItems: number;
  priority: "normal" | "high" | "urgent";
  elapsedTime: number;
}

export interface KitchenOrderItem {
  id: number;
  name: string;
  quantity: number;
  status: "pending" | "preparing" | "ready" | "completed";
  notes?: string;
  priority: "normal" | "high" | "urgent";
  estimatedTime: number;
  startedAt?: string;
}

export interface KitchenStats {
  pendingCount: number;
  preparingCount: number;
  readyCount: number;
  completedToday: number;
  averageCookingTime: number;
  averageWaitingTime: number;
  efficiency: number;
  urgentOrders: number;
}

export interface KitchenOrdersResponse {
  pending: KitchenOrder[];
  preparing: KitchenOrder[];
  ready: KitchenOrder[];
  stats: KitchenStats;
}

export interface OrderItemStatusUpdate {
  status: "pending" | "preparing" | "ready" | "completed";
  notes?: string;
}

// Service Interface
export interface IKitchenService {
  // Kitchen Operations
  getKitchenOrders(
    restaurantId: string,
    userId?: string,
    limit?: number,
  ): Promise<KitchenOrdersResponse>;
  updateOrderItemStatus(
    restaurantId: string,
    orderId: string,
    itemId: number,
    statusUpdate: OrderItemStatusUpdate,
    userId: string,
  ): Promise<{
    orderId: string;
    itemId: number;
    status: string;
    /** Canonical parent-order state after the item update has been reconciled. */
    orderStatus: string;
    updatedAt: string;
  }>;

  validateChefAccess(
    userId: string,
    userRole: number,
    restaurantId: string,
  ): boolean;
}
