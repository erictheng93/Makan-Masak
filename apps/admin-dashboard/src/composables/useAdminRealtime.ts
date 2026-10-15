/**
 * Admin Dashboard Real-time Composable
 * 管理後台的實時功能整合
 */

import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useWebSocketService } from "@/services/websocketService";
import { useAuthStore } from "@/stores/auth";
import {
  RealtimeEventType,
  type NewOrderEvent,
  type OrderItemStatusUpdateEvent,
  type OrderStatusUpdateEvent,
  type KitchenQueueUpdateEvent,
  type KitchenItemStatusEvent,
  type MenuAvailabilityUpdateEvent,
} from "@makanmasak/shared-types";

// ============================================================================
// 類型定義
// ============================================================================

export interface OrderNotification {
  orderId: string;
  orderNumber: string;
  tableId?: string;
  tableName?: string;
  totalAmount: number;
  timestamp: number;
  isNew: boolean;
}

export interface KitchenStats {
  pendingItems: number;
  cookingItems: number;
  readyItems: number;
  averageWaitTime: number;
  lastUpdated: number;
}

export interface MenuAlert {
  menuItemId: number;
  menuItemName: string;
  isAvailable: boolean;
  inventoryCount?: number;
  reason?: string;
  timestamp: number;
}

export interface SystemAlert {
  notificationId: string;
  level: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

// ============================================================================
// Composable 主體
// ============================================================================

export function useAdminRealtime() {
  const wsService = useWebSocketService({
    maxReconnectAttempts: 5,
    reconnectDelay: 3000,
    heartbeatInterval: 30000,
    heartbeatTimeout: 10000,
  });

  const authStore = useAuthStore();

  // ========================================
  // 響應式狀態
  // ========================================

  const isConnected = wsService.isConnected;
  const connectionStatus = wsService.status;

  // 訂單通知
  const orderNotifications = ref<OrderNotification[]>([]);
  const unreadOrderCount = computed(
    () => orderNotifications.value.filter((n) => n.isNew).length,
  );

  // 廚房統計
  const kitchenStats = ref<KitchenStats>({
    pendingItems: 0,
    cookingItems: 0,
    readyItems: 0,
    averageWaitTime: 0,
    lastUpdated: Date.now(),
  });

  // 菜單警示
  const menuAlerts = ref<MenuAlert[]>([]);
  const activeMenuAlerts = computed(() =>
    menuAlerts.value.filter((a) => !a.isAvailable),
  );

  // 系統通知
  const systemAlerts = ref<SystemAlert[]>([]);
  const unreadAlertCount = computed(
    () => systemAlerts.value.filter((a) => !a.read).length,
  );

  // 訂閱 ID 追蹤
  const subscriptionIds = ref<string[]>([]);

  // 音效設置
  const soundEnabled = ref(true);
  const notificationSound = ref<HTMLAudioElement | null>(null);

  // ========================================
  // 事件處理函數
  // ========================================

  /**
   * 處理新訂單事件
   */
  const handleNewOrder = (event: NewOrderEvent) => {
    const { orderId, orderNumber, tableId, tableName, totalAmount } =
      event.data;

    const notification: OrderNotification = {
      orderId,
      orderNumber,
      tableId,
      tableName,
      totalAmount,
      timestamp: event.timestamp,
      isNew: true,
    };

    orderNotifications.value.unshift(notification);

    // 限制歷史長度
    if (orderNotifications.value.length > 50) {
      orderNotifications.value = orderNotifications.value.slice(0, 50);
    }

    // 播放通知音效
    playNotificationSound();

    console.log("🆕 New order received:", notification);
  };

  /**
   * 處理訂單狀態更新
   */
  const handleOrderStatusUpdate = (event: OrderStatusUpdateEvent) => {
    const { orderId, status, previousStatus } = event.data;

    console.log(
      `📦 Order ${orderId} status changed: ${previousStatus} → ${status}`,
    );

    // 更新現有通知的狀態
    const existingNotification = orderNotifications.value.find(
      (n) => n.orderId === orderId,
    );
    if (existingNotification) {
      existingNotification.isNew = false;
    }
  };

  /**
   * 處理訂單項目狀態更新
   */
  const handleOrderItemStatusUpdate = (event: OrderItemStatusUpdateEvent) => {
    const { orderId, orderItemId, status, previousStatus } = event.data;

    console.log(
      `📦 Order ${orderId} item ${orderItemId} status changed: ${previousStatus} → ${status}`,
    );

    const existingNotification = orderNotifications.value.find(
      (n) => n.orderId === orderId,
    );
    if (existingNotification) {
      existingNotification.isNew = false;
    }
  };

  /**
   * 處理廚房隊列更新事件
   */
  const handleKitchenQueueUpdate = (event: KitchenQueueUpdateEvent) => {
    const { pendingCount, cookingCount, readyCount, averageWaitTime } =
      event.data;

    kitchenStats.value = {
      pendingItems: pendingCount || 0,
      cookingItems: cookingCount || 0,
      readyItems: readyCount || 0,
      averageWaitTime: averageWaitTime || 0,
      lastUpdated: Date.now(),
    };

    console.log("🍳 Kitchen stats updated:", kitchenStats.value);
  };

  /**
   * 處理廚房項目狀態事件
   */
  const handleKitchenItemStatus = (event: KitchenItemStatusEvent) => {
    console.log("👨‍🍳 Kitchen item status:", event.data);
  };

  /**
   * 處理菜單可用性更新
   */
  const handleMenuUpdate = (event: MenuAvailabilityUpdateEvent) => {
    const { menuItemId, menuItemName, isAvailable, inventoryCount, reason } =
      event.data;

    const alert: MenuAlert = {
      menuItemId,
      menuItemName,
      isAvailable,
      inventoryCount,
      reason,
      timestamp: event.timestamp,
    };

    // 更新或新增警示
    const existingIndex = menuAlerts.value.findIndex(
      (a) => a.menuItemId === menuItemId,
    );

    if (existingIndex >= 0) {
      menuAlerts.value[existingIndex] = alert;
    } else {
      menuAlerts.value.unshift(alert);
    }

    // 如果是售罄，播放警示音
    if (!isAvailable) {
      playNotificationSound();
      console.log("⚠️ Menu item unavailable:", alert);
    }
  };

  // ========================================
  // 音效管理
  // ========================================

  /**
   * 初始化音效
   */
  const initializeSound = () => {
    // 使用瀏覽器內建的通知音效或自訂音效
    notificationSound.value = new Audio("/sounds/notification.mp3");
    notificationSound.value.volume = 0.5;
  };

  /**
   * 播放通知音效
   */
  const playNotificationSound = () => {
    if (soundEnabled.value && notificationSound.value) {
      notificationSound.value.currentTime = 0;
      notificationSound.value.play().catch((error) => {
        console.warn("Failed to play notification sound:", error);
      });
    }
  };

  /**
   * 切換音效
   */
  const toggleSound = () => {
    soundEnabled.value = !soundEnabled.value;
    localStorage.setItem("admin_sound_enabled", soundEnabled.value.toString());
  };

  // ========================================
  // 連接管理
  // ========================================

  /**
   * 開始監聽
   */
  const startListening = () => {
    if (!authStore.restaurantId) {
      console.warn("No restaurant ID, cannot start realtime listening");
      return;
    }

    // 訂閱訂單事件
    const orderSubId = wsService.subscribe(
      [
        RealtimeEventType.NEW_ORDER,
        RealtimeEventType.ORDER_STATUS_UPDATE,
        RealtimeEventType.ORDER_ITEM_STATUS_UPDATE,
        RealtimeEventType.ORDER_CANCELLED,
      ],
      (event) => {
        if (event.type === RealtimeEventType.NEW_ORDER) {
          handleNewOrder(event as NewOrderEvent);
        } else if (event.type === RealtimeEventType.ORDER_STATUS_UPDATE) {
          handleOrderStatusUpdate(event as OrderStatusUpdateEvent);
        } else if (event.type === RealtimeEventType.ORDER_ITEM_STATUS_UPDATE) {
          handleOrderItemStatusUpdate(event as OrderItemStatusUpdateEvent);
        }
      },
    );

    // 訂閱廚房事件
    const kitchenSubId = wsService.subscribe(
      [
        RealtimeEventType.KITCHEN_ITEM_STATUS,
        RealtimeEventType.KITCHEN_QUEUE_UPDATE,
      ],
      (event) => {
        if (event.type === RealtimeEventType.KITCHEN_ITEM_STATUS) {
          handleKitchenItemStatus(event as KitchenItemStatusEvent);
        } else if (event.type === RealtimeEventType.KITCHEN_QUEUE_UPDATE) {
          handleKitchenQueueUpdate(event as KitchenQueueUpdateEvent);
        }
      },
    );

    // 訂閱菜單事件
    const menuSubId = wsService.subscribe(
      [RealtimeEventType.MENU_AVAILABILITY_UPDATE],
      (event) => handleMenuUpdate(event as MenuAvailabilityUpdateEvent),
    );

    subscriptionIds.value = [orderSubId, kitchenSubId, menuSubId];

    console.log("✅ Started listening to realtime events");
  };

  /**
   * 停止監聽
   */
  const stopListening = () => {
    subscriptionIds.value.forEach((subId) => {
      wsService.unsubscribe(subId);
    });
    subscriptionIds.value = [];
    console.log("🛑 Stopped listening to realtime events");
  };

  /**
   * 連接到 WebSocket
   */
  const connect = async () => {
    if (!authStore.restaurantId) {
      console.warn("No restaurant ID, cannot connect");
      return;
    }

    try {
      await wsService.connect(authStore.restaurantId.toString());
      startListening();
    } catch (error) {
      console.error("Failed to connect to realtime service:", error);
    }
  };

  /**
   * 斷開連接
   */
  const disconnect = () => {
    stopListening();
    wsService.disconnect();
  };

  // ========================================
  // 工具方法
  // ========================================

  /**
   * 標記訂單通知為已讀
   */
  const markOrderAsRead = (orderId: string) => {
    const notification = orderNotifications.value.find(
      (n) => n.orderId === orderId,
    );
    if (notification) {
      notification.isNew = false;
    }
  };

  /**
   * 標記所有訂單為已讀
   */
  const markAllOrdersAsRead = () => {
    orderNotifications.value.forEach((n) => {
      n.isNew = false;
    });
  };

  /**
   * 標記系統通知為已讀
   */
  const markAlertAsRead = (notificationId: string) => {
    const alert = systemAlerts.value.find(
      (a) => a.notificationId === notificationId,
    );
    if (alert) {
      alert.read = true;
    }
  };

  /**
   * 標記所有通知為已讀
   */
  const markAllAlertsAsRead = () => {
    systemAlerts.value.forEach((a) => {
      a.read = true;
    });
  };

  /**
   * 清除訂單通知
   */
  const clearOrderNotifications = () => {
    orderNotifications.value = [];
  };

  /**
   * 清除菜單警示
   */
  const clearMenuAlerts = () => {
    menuAlerts.value = [];
  };

  /**
   * 清除系統通知
   */
  const clearSystemAlerts = () => {
    systemAlerts.value = [];
  };

  /**
   * 獲取最近的訂單
   */
  const getRecentOrders = (limit = 10) => {
    return orderNotifications.value.slice(0, limit);
  };

  // ========================================
  // 生命週期管理
  // ========================================

  onMounted(async () => {
    // 初始化音效
    initializeSound();

    // 從 localStorage 讀取音效設置
    const savedSoundEnabled = localStorage.getItem("admin_sound_enabled");
    if (savedSoundEnabled !== null) {
      soundEnabled.value = savedSoundEnabled === "true";
    }

    // 自動連接（only if restaurant context exists）
    if (authStore.isAuthenticated && authStore.restaurantId) {
      await connect();
    }

    // 監聽認證狀態及餐廳上下文變化
    watch(
      () => authStore.isAuthenticated,
      (isAuth) => {
        if (isAuth && authStore.restaurantId) {
          connect();
        } else {
          disconnect();
        }
      },
    );

    // Reconnect when restaurant context changes (admin switching restaurants)
    watch(
      () => authStore.restaurantId,
      (newId, oldId) => {
        if (oldId) disconnect();
        if (newId && authStore.isAuthenticated) connect();
      },
    );
  });

  onUnmounted(() => {
    disconnect();
  });

  // ========================================
  // 返回 API
  // ========================================

  return {
    // 連接狀態
    isConnected,
    connectionStatus,

    // 訂單通知
    orderNotifications,
    unreadOrderCount,
    markOrderAsRead,
    markAllOrdersAsRead,
    clearOrderNotifications,
    getRecentOrders,

    // 廚房統計
    kitchenStats,

    // 菜單警示
    menuAlerts,
    activeMenuAlerts,
    clearMenuAlerts,

    // 系統通知
    systemAlerts,
    unreadAlertCount,
    markAlertAsRead,
    markAllAlertsAsRead,
    clearSystemAlerts,

    // 音效控制
    soundEnabled,
    toggleSound,

    // 連接管理
    connect,
    disconnect,
  };
}

export default useAdminRealtime;
