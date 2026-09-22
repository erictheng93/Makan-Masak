import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { kitchenApi } from "@/services/kitchenApi";
import { offlineService } from "@/services/offlineService";
import type {
  KitchenOrder,
  KitchenStats,
  KitchenSSEEvent,
  OrderStatus,
  ItemStatus,
} from "@/types";
import { t } from "@/i18n";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isKitchenOrder = (value: unknown): value is KitchenOrder =>
  isRecord(value) &&
  typeof value.id === "number" &&
  Number.isFinite(value.id) &&
  value.id > 0 &&
  typeof value.orderNumber === "string" &&
  Array.isArray(value.items);

const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === "string" &&
  [
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "delivered",
    "paid",
    "cancelled",
    "refunded",
  ].includes(value);

const normalizeEventType = (type: KitchenSSEEvent["type"]) => {
  switch (type) {
    case "new_order":
      return "NEW_ORDER";
    case "order_status_update":
      return "ORDER_STATUS_UPDATE";
    case "order_item_status_update":
      return "ORDER_ITEM_STATUS_UPDATE";
    case "order_cancelled":
      return "ORDER_CANCELLED";
    default:
      return type;
  }
};

const timestampToIso = (timestamp: KitchenSSEEvent["timestamp"]) => {
  const date =
    typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
};

const buildKitchenOrderFromRealtimeData = (
  data: Record<string, unknown>,
  timestamp: KitchenSSEEvent["timestamp"],
): KitchenOrder | null => {
  const orderId = Number(data.orderId);
  if (!Number.isFinite(orderId) || orderId <= 0) return null;

  const items = Array.isArray(data.items)
    ? data.items.map((item) => {
        const row = isRecord(item) ? item : {};
        return {
          id: Number(row.orderItemId ?? row.id ?? row.menuItemId ?? 0),
          name: String(row.menuItemName ?? row.name ?? ""),
          quantity: Number(row.quantity ?? 0),
          status: "pending" as const,
          notes: typeof row.notes === "string" ? row.notes : undefined,
          priority: "normal" as const,
          price: Number(row.price ?? 0),
        };
      })
    : [];

  const customer = isRecord(data.customer) ? data.customer : null;
  const tableId =
    data.tableId === undefined || data.tableId === null
      ? undefined
      : Number(data.tableId);

  return {
    id: orderId,
    orderNumber: String(data.orderNumber ?? `#${orderId}`),
    tableId: Number.isFinite(tableId) ? tableId : undefined,
    tableName:
      typeof data.tableName === "string"
        ? data.tableName
        : Number.isFinite(tableId)
          ? `Table ${tableId}`
          : undefined,
    status: "confirmed",
    deliveryInfo: {
      type: Number.isFinite(tableId) ? "dine_in" : "takeaway",
    },
    orderSource:
      typeof data.orderSource === "string"
        ? (data.orderSource as KitchenOrder["orderSource"])
        : undefined,
    items,
    customerName:
      typeof customer?.name === "string" ? customer.name : undefined,
    notes: typeof data.notes === "string" ? data.notes : undefined,
    createdAt: timestampToIso(timestamp),
    totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
    priority: "normal",
    elapsedTime: 0,
    totalAmount: Number(data.totalAmount ?? 0),
  };
};

const extractKitchenOrderPayload = (payload: unknown): KitchenOrder | null => {
  if (isRecord(payload) && isKitchenOrder(payload.order)) {
    return payload.order;
  }

  if (isKitchenOrder(payload)) {
    return payload;
  }

  return null;
};

const extractNewOrder = (event: KitchenSSEEvent): KitchenOrder | null => {
  const payloadOrder = extractKitchenOrderPayload(event.payload);
  if (payloadOrder) return payloadOrder;

  if (isRecord(event.data)) {
    const dataOrder = extractKitchenOrderPayload(event.data);
    if (dataOrder) return dataOrder;
    return buildKitchenOrderFromRealtimeData(event.data, event.timestamp);
  }

  return null;
};

const eventData = (event: KitchenSSEEvent) =>
  isRecord(event.payload)
    ? event.payload
    : isRecord(event.data)
      ? event.data
      : null;

export const useOrdersStore = defineStore("orders", () => {
  // State
  const orders = ref<KitchenOrder[]>([]);
  const stats = ref<KitchenStats>({
    pendingCount: 0,
    preparingCount: 0,
    readyCount: 0,
    completedToday: 0,
    averageCookingTime: 0,
    averageWaitingTime: 0,
    efficiency: 0,
    urgentOrders: 0,
  });
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);

  // Computed
  const pendingOrders = computed(
    () => orders.value.filter((order) => order.status === "confirmed"), // CONFIRMED
  );

  const preparingOrders = computed(
    () => orders.value.filter((order) => order.status === "preparing"), // PREPARING
  );

  const readyOrders = computed(
    () => orders.value.filter((order) => order.status === "ready"), // READY
  );

  const urgentOrders = computed(() =>
    orders.value.filter((order) => order.priority === "urgent"),
  );

  const totalOrders = computed(() => orders.value.length);

  /**
   * 從 API 獲取訂單資料
   */
  const fetchOrders = async (restaurantId: number | string) => {
    loading.value = true;
    error.value = null;

    // 綁定離線快取到本次請求的餐廳，避免共用裝置讀到其他餐廳的舊訂單
    offlineService.setActiveRestaurant(restaurantId);

    try {
      const response = await kitchenApi.getOrders(restaurantId);

      if (response.success && response.data) {
        // 合併所有狀態的訂單
        const allOrders = [
          ...response.data.pending,
          ...response.data.preparing,
          ...response.data.ready,
        ];

        orders.value = allOrders;
        offlineService.cacheOrders(allOrders, restaurantId);
        stats.value = response.data.stats;
        lastUpdated.value = new Date();

        console.log(
          `Loaded ${allOrders.length} orders for restaurant ${restaurantId}`,
        );
      } else {
        throw new Error(response.error || "載入訂單失敗");
      }
    } catch (err: unknown) {
      const cachedOrders = offlineService.getCachedOrders(restaurantId);
      if (shouldQueueOfflineAction() && cachedOrders.length > 0) {
        orders.value = cachedOrders;
        updateStats();
        lastUpdated.value = new Date();
        error.value = null;
        return;
      }

      // `error` is rendered, so it holds localized copy; the server's own text
      // stays in the log line below where it is useful for diagnosis.
      error.value = resolveUserFacingError(err, t).message;
      console.error("Failed to fetch orders:", err);
    } finally {
      loading.value = false;
    }
  };

  /**
   * 處理 SSE 事件
   */
  const handleSSEEvent = (event: KitchenSSEEvent) => {
    switch (normalizeEventType(event.type)) {
      case "NEW_ORDER":
        handleNewOrder(event);
        break;
      case "ORDER_STATUS_UPDATE":
        handleOrderStatusUpdate(event);
        break;
      case "ORDER_ITEM_STATUS_UPDATE":
        handleOrderStatusUpdate(event);
        break;
      case "ORDER_CANCELLED":
        handleOrderCancelled(event);
        break;
      case "PRIORITY_UPDATE":
        handlePriorityUpdate(event);
        break;
    }

    // 重新計算統計
    updateStats();
  };

  /**
   * 處理新訂單事件
   * 支援兩種格式：
   * 1. { type: 'NEW_ORDER', payload: { order: {...} } }
   * 2. { type: 'NEW_ORDER', payload: {...} } (直接是訂單物件)
   */
  const handleNewOrder = (event: KitchenSSEEvent) => {
    const newOrder = extractNewOrder(event);

    // 驗證是否為有效訂單物件
    if (!newOrder) {
      console.warn("Invalid order data in NEW_ORDER event", event);
      return;
    }

    // 檢查訂單是否已存在
    const existingOrderIndex = orders.value.findIndex(
      (o) => o.id === newOrder.id,
    );

    if (existingOrderIndex === -1) {
      orders.value.unshift(newOrder); // 新訂單插入到最前面
      console.log(`New order added: ${newOrder.orderNumber}`);
    } else {
      // 更新現有訂單
      orders.value[existingOrderIndex] = newOrder;
      console.log(`Existing order updated: ${newOrder.orderNumber}`);
    }
  };

  /**
   * 處理訂單狀態更新事件
   */
  const handleOrderStatusUpdate = (event: KitchenSSEEvent) => {
    const payload = eventData(event);
    const orderId = event.orderId ?? Number(payload?.orderId);
    if (Number.isFinite(orderId) && payload) {
      const { status, updatedAt, notes } = payload;
      const itemId = payload.itemId ?? payload.orderItemId;

      const orderIndex = orders.value.findIndex((o) => o.id === orderId);
      if (orderIndex !== -1) {
        const order = orders.value[orderIndex];

        if (itemId) {
          // 更新特定項目狀態
          const itemIndex = order.items.findIndex(
            (i) => i.id === Number(itemId),
          );
          if (itemIndex !== -1) {
            order.items[itemIndex].status = status as ItemStatus;

            if (status === "preparing" && !order.items[itemIndex].startedAt) {
              order.items[itemIndex].startedAt = String(updatedAt);
            } else if (
              status === "ready" &&
              !order.items[itemIndex].completedAt
            ) {
              order.items[itemIndex].completedAt = String(updatedAt);
            }

            if (typeof notes === "string") {
              order.items[itemIndex].notes = notes;
            }

            console.log(
              `Order ${orderId} item ${itemId} status updated to ${status}`,
            );
          }
        }

        // Item events deliberately do not infer a parent status. The server
        // emits a separate ORDER_STATUS_UPDATE after applying its versioned
        // transition; treating an item event as authoritative was what moved
        // cards into a column that reverted after a refresh (#412).
        if (!itemId && isOrderStatus(status)) {
          order.status = status;
        }

        // 觸發響應式更新
        orders.value[orderIndex] = { ...order };
      }
    }
  };

  /**
   * 處理訂單取消事件
   */
  const handleOrderCancelled = (event: KitchenSSEEvent) => {
    const payload = eventData(event);
    const orderId = event.orderId ?? Number(payload?.orderId);
    if (Number.isFinite(orderId)) {
      const orderIndex = orders.value.findIndex((o) => o.id === orderId);
      if (orderIndex !== -1) {
        // 移除已取消的訂單
        orders.value.splice(orderIndex, 1);
        console.log(`Order ${orderId} cancelled and removed`);
      }
    }
  };

  /**
   * 處理優先級更新事件
   */
  const handlePriorityUpdate = (event: KitchenSSEEvent) => {
    if (event.orderId && isRecord(event.payload)) {
      const orderId = event.orderId;
      const { priority } = event.payload;

      const orderIndex = orders.value.findIndex((o) => o.id === orderId);
      if (orderIndex !== -1) {
        if (
          priority === "normal" ||
          priority === "high" ||
          priority === "urgent"
        ) {
          orders.value[orderIndex].priority = priority;
          console.log(`Order ${orderId} priority updated to ${priority}`);
        }
      }
    }
  };

  /**
   * 重新計算統計資料
   */
  const updateStats = () => {
    stats.value = {
      pendingCount: pendingOrders.value.length,
      preparingCount: preparingOrders.value.length,
      readyCount: readyOrders.value.length,
      completedToday: stats.value.completedToday, // 保持原有值
      averageCookingTime: calculateAverageCookingTime(),
      averageWaitingTime: calculateAverageWaitingTime(),
      efficiency: stats.value.efficiency, // 保持原有值
      urgentOrders: urgentOrders.value.length,
    };
  };

  /**
   * 計算平均製作時間
   */
  const calculateAverageCookingTime = (): number => {
    const cookingOrders = orders.value.filter((order) =>
      order.items.some((item) => item.startedAt && item.completedAt),
    );

    if (cookingOrders.length === 0) return 0;

    let totalTime = 0;
    let count = 0;

    cookingOrders.forEach((order) => {
      order.items.forEach((item) => {
        if (item.startedAt && item.completedAt) {
          const startTime = new Date(item.startedAt).getTime();
          const endTime = new Date(item.completedAt).getTime();
          totalTime += (endTime - startTime) / 60000; // 轉換為分鐘
          count++;
        }
      });
    });

    return Math.round(totalTime / count);
  };

  /**
   * 計算平均等待時間
   */
  const calculateAverageWaitingTime = (): number => {
    const waitingOrders = orders.value.filter(
      (order) =>
        order.status === "pending" ||
        order.status === "confirmed" ||
        order.status === "preparing",
    );

    if (waitingOrders.length === 0) return 0;

    const totalWaitingTime = waitingOrders.reduce(
      (sum, order) => sum + order.elapsedTime,
      0,
    );

    return Math.round(totalWaitingTime / waitingOrders.length);
  };

  const applyItemStatus = (
    orderId: number,
    itemId: number,
    status: ItemStatus,
    orderStatus?: OrderStatus,
  ) => {
    const orderIndex = orders.value.findIndex((o) => o.id === orderId);
    if (orderIndex === -1) return;

    const order = orders.value[orderIndex];
    const itemIndex = order.items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) return;

    order.items[itemIndex].status = status;

    const now = new Date().toISOString();
    if (status === "preparing" && !order.items[itemIndex].startedAt) {
      order.items[itemIndex].startedAt = now;
    } else if (status === "ready" && !order.items[itemIndex].completedAt) {
      order.items[itemIndex].completedAt = now;
    }

    // Only the server response (or its realtime order event) may move a card
    // between columns. Offline actions intentionally remain a local item
    // preview until their queued request is accepted and the next refresh
    // supplies the canonical parent status.
    if (orderStatus) {
      order.status = orderStatus;
    }
    orders.value[orderIndex] = { ...order };
    updateStats();
  };

  const shouldQueueOfflineAction = () =>
    !offlineService.isOnline.value || !navigator.onLine;

  /**
   * 開始製作訂單項目
   */
  const startCooking = async (
    restaurantId: number | string,
    orderId: number,
    itemId: number,
  ) => {
    try {
      if (shouldQueueOfflineAction()) {
        offlineService.queueAction(
          "start_cooking",
          orderId,
          { restaurantId, status: "preparing" },
          itemId,
        );
        applyItemStatus(orderId, itemId, "preparing");
        return;
      }

      const response = await kitchenApi.startCooking(
        restaurantId,
        orderId,
        itemId,
      );

      if (response.success && response.data) {
        applyItemStatus(
          orderId,
          itemId,
          "preparing",
          response.data.orderStatus,
        );
      } else {
        throw new Error(response.error || "開始製作失敗");
      }
    } catch (error: unknown) {
      console.error("Failed to start cooking:", error);
      throw error;
    }
  };

  /**
   * 標記項目完成
   */
  const markReady = async (
    restaurantId: number | string,
    orderId: number,
    itemId: number,
  ) => {
    try {
      if (shouldQueueOfflineAction()) {
        offlineService.queueAction(
          "mark_ready",
          orderId,
          { restaurantId, status: "ready" },
          itemId,
        );
        applyItemStatus(orderId, itemId, "ready");
        return;
      }

      const response = await kitchenApi.markItemReady(
        restaurantId,
        orderId,
        itemId,
      );

      if (response.success && response.data) {
        applyItemStatus(orderId, itemId, "ready", response.data.orderStatus);
      } else {
        throw new Error(response.error || "標記完成失敗");
      }
    } catch (error: unknown) {
      console.error("Failed to mark ready:", error);
      throw error;
    }
  };

  /**
   * 批量開始製作訂單所有項目
   */
  const startAllItems = async (
    restaurantId: number | string,
    orderId: number,
  ) => {
    const order = orders.value.find((o) => o.id === orderId);
    if (!order) return;

    const pendingItemIds = order.items
      .filter((item) => item.status === "pending")
      .map((item) => item.id);

    if (pendingItemIds.length === 0) return;

    try {
      if (shouldQueueOfflineAction()) {
        pendingItemIds.forEach((itemId) => {
          offlineService.queueAction(
            "start_cooking",
            orderId,
            { restaurantId, status: "preparing" },
            itemId,
          );
          applyItemStatus(orderId, itemId, "preparing");
        });
        return;
      }

      const response = await kitchenApi.startAllItems(
        restaurantId,
        orderId,
        pendingItemIds,
      );

      if (!response.success) {
        throw new Error(response.error || "批量開始製作失敗");
      }
      await fetchOrders(restaurantId);
    } catch (error: unknown) {
      console.error("Failed to start all items:", error);
      throw error;
    }
  };

  /**
   * 批量標記訂單所有項目完成
   */
  const markAllReady = async (
    restaurantId: number | string,
    orderId: number,
  ) => {
    const order = orders.value.find((o) => o.id === orderId);
    if (!order) return;

    const preparingItemIds = order.items
      .filter((item) => item.status === "preparing")
      .map((item) => item.id);

    if (preparingItemIds.length === 0) return;

    try {
      if (shouldQueueOfflineAction()) {
        preparingItemIds.forEach((itemId) => {
          offlineService.queueAction(
            "mark_ready",
            orderId,
            { restaurantId, status: "ready" },
            itemId,
          );
          applyItemStatus(orderId, itemId, "ready");
        });
        return;
      }

      const response = await kitchenApi.markAllItemsReady(
        restaurantId,
        orderId,
        preparingItemIds,
      );

      if (!response.success) {
        throw new Error(response.error || "批量標記完成失敗");
      }
      await fetchOrders(restaurantId);
    } catch (error: unknown) {
      console.error("Failed to mark all ready:", error);
      throw error;
    }
  };

  /**
   * 根據 ID 獲取訂單
   */
  const getOrderById = (orderId: number) => {
    return orders.value.find((order) => order.id === orderId);
  };

  /**
   * 清除錯誤狀態
   */
  const clearError = () => {
    error.value = null;
  };

  /**
   * 清空訂單列表（保留其他 store 狀態）
   */
  const clearOrders = () => {
    orders.value = [];
    updateStats();
  };

  /**
   * 公開方法：直接更新訂單狀態（支援 number 或 string ID）
   */
  const updateOrderStatus = (
    orderId: number | string,
    newStatus: OrderStatus,
  ) => {
    const id = typeof orderId === "string" ? parseInt(orderId, 10) : orderId;
    const orderIndex = orders.value.findIndex((o) => o.id === id);
    if (orderIndex !== -1) {
      orders.value[orderIndex].status = newStatus;
      updateStats();
    }
  };

  /**
   * 別名：updateOrderStatusById (向後兼容)
   */
  const updateOrderStatusById = updateOrderStatus;

  /**
   * 公開方法：直接更新單個 item 狀態
   */
  const updateItemStatus = (
    orderId: number,
    itemId: number,
    newStatus: string | ItemStatus,
  ) => {
    const orderIndex = orders.value.findIndex((o) => o.id === orderId);
    if (orderIndex !== -1) {
      const order = orders.value[orderIndex];
      const itemIndex = order.items.findIndex((i) => i.id === itemId);

      if (itemIndex !== -1) {
        order.items[itemIndex].status = newStatus as ItemStatus;

        // 更新時間戳
        const now = new Date().toISOString();
        if (newStatus === "preparing" && !order.items[itemIndex].startedAt) {
          order.items[itemIndex].startedAt = now;
        } else if (
          newStatus === "ready" &&
          !order.items[itemIndex].completedAt
        ) {
          order.items[itemIndex].completedAt = now;
        }

        // 觸發響應式更新
        orders.value[orderIndex] = { ...order };
        updateStats();
      }
    }
  };

  /**
   * 重置 store 狀態
   */
  const reset = () => {
    orders.value = [];
    stats.value = {
      pendingCount: 0,
      preparingCount: 0,
      readyCount: 0,
      completedToday: 0,
      averageCookingTime: 0,
      averageWaitingTime: 0,
      efficiency: 0,
      urgentOrders: 0,
    };
    loading.value = false;
    error.value = null;
    lastUpdated.value = null;
  };

  return {
    // State
    orders,
    stats,
    loading,
    error,
    lastUpdated,

    // Computed
    pendingOrders,
    preparingOrders,
    readyOrders,
    urgentOrders,
    totalOrders,

    // Actions
    fetchOrders,
    handleSSEEvent,
    startCooking,
    markReady,
    startAllItems,
    markAllReady,
    getOrderById,
    clearError,
    clearOrders,
    updateOrderStatus,
    updateOrderStatusById,
    updateItemStatus,
    reset,
  };
});
