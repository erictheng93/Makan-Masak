import { ref, onMounted, onUnmounted } from "vue";
import { useRealtime, type RealtimeMessage } from "@/services/realtimeService";
import { useAuthStore } from "@/stores/auth";
import { RealtimeEventType } from "@makanmasak/shared-types";

export interface RealtimeQueueUpdate {
  queueId: string;
  queueNumber: number;
  customerName?: string;
  partySize: number;
  status:
    | "waiting"
    | "called"
    | "notified"
    | "seated"
    | "no_show"
    | "cancelled"
    | "expired";
  waitTime?: number;
  tableNumber?: string;
  timestamp: string;
  type: "joined" | "called" | "notified" | "seated" | "no_show" | "cancelled";
  estimatedWaitMinutes?: number;
  actualWaitMinutes?: number;
}

export interface RealtimeTableUpdate {
  tableId: string;
  tableNumber: string;
  status: string;
  capacity: number;
  occupiedSince?: string;
  timestamp: string;
  type: "occupied" | "available" | "reserved" | "cleaning";
}

type WaitingRealtimeMessage = Extract<
  RealtimeMessage,
  {
    type:
      | RealtimeEventType.WAITING_LIST_JOINED
      | RealtimeEventType.WAITING_LIST_CALLED
      | RealtimeEventType.WAITING_LIST_CONFIRMED
      | RealtimeEventType.WAITING_LIST_SEATED
      | RealtimeEventType.WAITING_LIST_CANCELLED
      | RealtimeEventType.WAITING_LIST_EXPIRED;
  }
>;

type TableStatusRealtimeMessage = Extract<
  RealtimeMessage,
  { type: RealtimeEventType.TABLE_STATUS_UPDATE }
>;

function isWaitingRealtimeMessage(
  message: RealtimeMessage,
): message is WaitingRealtimeMessage {
  return [
    RealtimeEventType.WAITING_LIST_JOINED,
    RealtimeEventType.WAITING_LIST_CALLED,
    RealtimeEventType.WAITING_LIST_CONFIRMED,
    RealtimeEventType.WAITING_LIST_SEATED,
    RealtimeEventType.WAITING_LIST_CANCELLED,
    RealtimeEventType.WAITING_LIST_EXPIRED,
  ].includes(message.type as RealtimeEventType);
}

function isTableStatusRealtimeMessage(
  message: RealtimeMessage,
): message is TableStatusRealtimeMessage {
  return message.type === RealtimeEventType.TABLE_STATUS_UPDATE;
}

function toQueueStatus(value: string): RealtimeQueueUpdate["status"] {
  return [
    "waiting",
    "called",
    "notified",
    "seated",
    "no_show",
    "cancelled",
    "expired",
  ].includes(value)
    ? (value as RealtimeQueueUpdate["status"])
    : "waiting";
}

export function useRealtimeQueue() {
  const { subscribe, unsubscribe, connect, connectionStatus } = useRealtime();
  const authStore = useAuthStore();

  // 響應式狀態
  const isConnected = ref(false);
  const queueUpdates = ref<RealtimeQueueUpdate[]>([]);
  const tableUpdates = ref<RealtimeTableUpdate[]>([]);
  const subscriptionIds = ref<string[]>([]);

  // 統計狀態
  const queueStats = ref({
    currentWaiting: 0,
    totalServedToday: 0,
    averageWaitTime: 0,
    peakWaitTime: 0,
  });

  // 候位更新處理函數 - 適配新模組化事件結構
  const handleQueueUpdate = (message: RealtimeMessage) => {
    if (!isWaitingRealtimeMessage(message)) return;

    const queueNumber = Number.parseInt(
      message.data.queueDisplay.replace(/\D/g, ""),
      10,
    );
    const update: RealtimeQueueUpdate = {
      queueId: message.data.entryId,
      queueNumber: Number.isNaN(queueNumber) ? 0 : queueNumber,
      customerName: message.data.customerName,
      partySize: 1,
      status: toQueueStatus(message.data.status),
      tableNumber: message.data.tableId?.toString(),
      timestamp: message.timestamp,
      type: message.type.includes("joined")
        ? "joined"
        : message.type.includes("called")
          ? "called"
          : message.type.includes("notified")
            ? "notified"
            : message.type.includes("seated")
              ? "seated"
              : message.type.includes("no_show")
                ? "no_show"
                : "cancelled",
    };

    queueUpdates.value.unshift(update);

    // 更新統計
    updateQueueStats(update);

    // 限制更新歷史長度
    if (queueUpdates.value.length > 100) {
      queueUpdates.value = queueUpdates.value.slice(0, 100);
    }

    console.log("Queue update received:", update);

    // 觸發通知（可選）- 增強通知內容
    if (update.type === "joined") {
      showQueueNotification(
        `新顧客加入排隊: ${update.customerName || `排號 ${update.queueNumber}`} (${update.partySize}人)`,
        "info",
      );
    } else if (update.type === "called") {
      showQueueNotification(
        `叫號: ${update.customerName || `排號 ${update.queueNumber}`}`,
        "success",
      );
    } else if (update.type === "seated") {
      showQueueNotification(
        `入座完成: ${update.customerName || `排號 ${update.queueNumber}`}`,
        "success",
      );
    } else if (update.type === "no_show") {
      showQueueNotification(
        `未到場: ${update.customerName || `排號 ${update.queueNumber}`}`,
        "warning",
      );
    } else if (update.type === "cancelled") {
      showQueueNotification(
        `已取消: ${update.customerName || `排號 ${update.queueNumber}`}`,
        "info",
      );
    }
  };

  // 桌位更新處理函數
  const handleTableUpdate = (message: RealtimeMessage) => {
    if (!isTableStatusRealtimeMessage(message)) return;

    const update: RealtimeTableUpdate = {
      tableId: message.data.tableId,
      tableNumber: message.data.tableName,
      status: message.data.status,
      capacity: message.data.customerCount ?? 0,
      timestamp: message.timestamp,
      type: message.data.status,
    };

    tableUpdates.value.unshift(update);

    // 限制更新歷史長度
    if (tableUpdates.value.length > 50) {
      tableUpdates.value = tableUpdates.value.slice(0, 50);
    }

    console.log("Table update received:", update);

    // 觸發通知
    if (update.type === "available") {
      showQueueNotification(`桌位 ${update.tableNumber} 現已可用`);
    }
  };

  // 更新候位統計
  const updateQueueStats = (update: RealtimeQueueUpdate) => {
    switch (update.type) {
      case "joined":
        queueStats.value.currentWaiting++;
        break;
      case "seated":
        queueStats.value.currentWaiting = Math.max(
          0,
          queueStats.value.currentWaiting - 1,
        );
        queueStats.value.totalServedToday++;
        if (update.waitTime) {
          // 計算平均等待時間
          const currentAvg = queueStats.value.averageWaitTime;
          const totalServed = queueStats.value.totalServedToday;
          queueStats.value.averageWaitTime = Math.round(
            (currentAvg * (totalServed - 1) + update.waitTime) / totalServed,
          );

          // 更新最長等待時間
          if (update.waitTime > queueStats.value.peakWaitTime) {
            queueStats.value.peakWaitTime = update.waitTime;
          }
        }
        break;
      case "cancelled":
      case "no_show":
        queueStats.value.currentWaiting = Math.max(
          0,
          queueStats.value.currentWaiting - 1,
        );
        break;
    }
  };

  // 顯示通知
  const showQueueNotification = (
    message: string,
    type: "info" | "warning" | "success" = "info",
  ) => {
    // 這裡可以整合到通知系統中
    console.log(`[${type.toUpperCase()}] ${message}`);

    // 如果支援瀏覽器通知
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("候位系統", {
        body: message,
        icon: "/favicon.ico",
        tag: "queue-update",
      });
    }
  };

  // 開始監聽候位相關事件
  const startListening = () => {
    if (!authStore.user?.restaurantId) {
      console.warn(
        "No restaurant ID found, cannot start realtime queue listening",
      );
      return;
    }

    const queueEventTypes = [
      RealtimeEventType.WAITING_LIST_JOINED,
      RealtimeEventType.WAITING_LIST_CALLED,
      RealtimeEventType.WAITING_LIST_SEATED,
      RealtimeEventType.WAITING_LIST_EXPIRED,
      RealtimeEventType.WAITING_LIST_CANCELLED,
    ];

    const queueSubId = subscribe(
      queueEventTypes,
      handleQueueUpdate,
      authStore.user.restaurantId.toString(),
    );

    // 訂閱桌位相關事件
    const tableEventTypes = [RealtimeEventType.TABLE_STATUS_UPDATE];

    const tableSubId = subscribe(
      tableEventTypes,
      handleTableUpdate,
      authStore.user.restaurantId.toString(),
    );

    subscriptionIds.value = [queueSubId, tableSubId];
    console.log("Started listening to realtime queue events");
  };

  // 停止監聽
  const stopListening = () => {
    subscriptionIds.value.forEach((subId) => {
      unsubscribe(subId);
    });
    subscriptionIds.value = [];
    console.log("Stopped listening to realtime queue events");
  };

  // 清除更新歷史
  const clearUpdates = () => {
    queueUpdates.value = [];
    tableUpdates.value = [];
  };

  // 重置統計
  const resetStats = () => {
    queueStats.value = {
      currentWaiting: 0,
      totalServedToday: 0,
      averageWaitTime: 0,
      peakWaitTime: 0,
    };
  };

  // 獲取最近的候位更新
  const getRecentQueueUpdates = (limit = 20) => {
    return queueUpdates.value.slice(0, limit);
  };

  // 獲取最近的桌位更新
  const getRecentTableUpdates = (limit = 10) => {
    return tableUpdates.value.slice(0, limit);
  };

  // 按狀態篩選候位更新
  const getUpdatesByStatus = (status: string) => {
    return queueUpdates.value.filter((update) => update.status === status);
  };

  // 按桌位號篩選桌位更新
  const getTableUpdatesByNumber = (tableNumber: string) => {
    return tableUpdates.value.filter(
      (update) => update.tableNumber === tableNumber,
    );
  };

  // 檢查是否有待處理的叫號 - 包含 notified 狀態
  const hasPendingCalls = () => {
    return queueUpdates.value.some(
      (update) =>
        (update.type === "called" || update.type === "notified") &&
        new Date().getTime() - new Date(update.timestamp).getTime() < 300000, // 5分鐘內
    );
  };

  // 獲取特定狀態的候位更新數量
  const getUpdateCountByStatus = (status: string) => {
    return queueUpdates.value.filter((update) => update.status === status)
      .length;
  };

  // 獲取平均等待時間
  const getAverageWaitTime = () => {
    const seatedUpdates = queueUpdates.value.filter(
      (update) => update.type === "seated" && update.actualWaitMinutes,
    );

    if (seatedUpdates.length === 0) return 0;

    const totalWait = seatedUpdates.reduce(
      (sum, update) => sum + (update.actualWaitMinutes || 0),
      0,
    );

    return Math.round(totalWait / seatedUpdates.length);
  };

  // 獲取可用桌位數量
  const getAvailableTablesCount = () => {
    const recentTableUpdates = tableUpdates.value.slice(0, 20);
    const availableUpdates = recentTableUpdates.filter(
      (update) => update.type === "available",
    );
    return availableUpdates.length;
  };

  // 請求瀏覽器通知權限
  const requestNotificationPermission = async () => {
    if ("Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    }
    return Notification.permission === "granted";
  };

  // 生命週期管理
  onMounted(async () => {
    // 確保已連接到實時服務
    if (connectionStatus.value !== "connected") {
      await connect(authStore.user?.restaurantId?.toString());
    }

    // 請求通知權限
    await requestNotificationPermission();

    // 開始監聽
    startListening();

    // 監聽連接狀態變化
    const checkConnection = () => {
      isConnected.value = connectionStatus.value === "connected";
    };

    checkConnection();
    const connectionChecker = setInterval(checkConnection, 1000);

    onUnmounted(() => {
      clearInterval(connectionChecker);
    });
  });

  onUnmounted(() => {
    stopListening();
  });

  return {
    // 狀態
    isConnected,
    queueUpdates,
    tableUpdates,
    queueStats,
    connectionStatus,

    // 方法
    startListening,
    stopListening,
    clearUpdates,
    resetStats,
    getRecentQueueUpdates,
    getRecentTableUpdates,
    getUpdatesByStatus,
    getTableUpdatesByNumber,
    hasPendingCalls,
    getAvailableTablesCount,
    getUpdateCountByStatus,
    getAverageWaitTime,
    requestNotificationPermission,
  };
}

export default useRealtimeQueue;
