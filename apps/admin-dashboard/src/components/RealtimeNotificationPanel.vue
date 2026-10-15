<template>
  <div class="realtime-notification-panel">
    <!-- 連接狀態指示器 -->
    <div class="connection-status" :class="connectionStatusClass">
      <div class="status-dot"></div>
      <span class="status-text">{{ connectionStatusText }}</span>
    </div>

    <!-- 通知標籤頁 -->
    <div class="notification-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-button"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
        <span v-if="tab.badge > 0" class="badge">{{ tab.badge }}</span>
      </button>

      <!-- 音效切換 -->
      <button
        class="sound-toggle"
        :class="{ muted: !soundEnabled }"
        :title="
          soundEnabled
            ? t('realtimeNotification.mute')
            : t('realtimeNotification.unmute')
        "
        @click="toggleSound"
      >
        <span v-if="soundEnabled">🔔</span>
        <span v-else>🔕</span>
      </button>
    </div>

    <!-- 訂單通知面板 -->
    <div v-show="activeTab === 'orders'" class="notification-content">
      <div class="content-header">
        <h3>{{ t("realtimeNotification.orderNotifications") }}</h3>
        <button
          v-if="orderNotifications.length > 0"
          class="clear-button"
          @click="handleClearOrders"
        >
          {{ t("realtimeNotification.clearAll") }}
        </button>
      </div>

      <div v-if="orderNotifications.length === 0" class="empty-state">
        <p>{{ t("realtimeNotification.noOrderNotifications") }}</p>
      </div>

      <div v-else class="notification-list">
        <div
          v-for="order in orderNotifications"
          :key="order.orderId"
          class="notification-item order-item"
          :class="{ unread: order.isNew }"
          @click="handleOrderClick(order)"
        >
          <div class="item-icon">📦</div>
          <div class="item-content">
            <div class="item-title">
              {{ order.orderNumber }}
              <span v-if="order.tableName" class="table-badge">{{
                order.tableName
              }}</span>
            </div>
            <div class="item-meta">
              <span class="amount">{{ formatPrice(order.totalAmount) }}</span>
              <span class="time">{{ formatTime(order.timestamp) }}</span>
            </div>
          </div>
          <div v-if="order.isNew" class="unread-indicator"></div>
        </div>
      </div>
    </div>

    <!-- 廚房統計面板 -->
    <div v-show="activeTab === 'kitchen'" class="notification-content">
      <div class="content-header">
        <h3>{{ t("realtimeNotification.kitchenStatus") }}</h3>
        <span class="last-updated">{{
          formatTime(kitchenStats.lastUpdated)
        }}</span>
      </div>

      <div class="kitchen-stats">
        <div class="stat-card pending">
          <div class="stat-icon">⏳</div>
          <div class="stat-content">
            <div class="stat-label">
              {{ t("realtimeNotification.pending") }}
            </div>
            <div class="stat-value">{{ kitchenStats.pendingItems }}</div>
          </div>
        </div>

        <div class="stat-card cooking">
          <div class="stat-icon">🍳</div>
          <div class="stat-content">
            <div class="stat-label">
              {{ t("realtimeNotification.cooking") }}
            </div>
            <div class="stat-value">{{ kitchenStats.cookingItems }}</div>
          </div>
        </div>

        <div class="stat-card ready">
          <div class="stat-icon">✅</div>
          <div class="stat-content">
            <div class="stat-label">
              {{ t("realtimeNotification.completed") }}
            </div>
            <div class="stat-value">{{ kitchenStats.readyItems }}</div>
          </div>
        </div>

        <div class="stat-card time">
          <div class="stat-icon">⏱️</div>
          <div class="stat-content">
            <div class="stat-label">
              {{ t("realtimeNotification.averageWait") }}
            </div>
            <div class="stat-value">
              {{
                t("realtimeNotification.minutesShort", {
                  value: kitchenStats.averageWaitTime,
                })
              }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 菜單警示面板 -->
    <div v-show="activeTab === 'menu'" class="notification-content">
      <div class="content-header">
        <h3>{{ t("realtimeNotification.menuAlerts") }}</h3>
        <button
          v-if="menuAlerts.length > 0"
          class="clear-button"
          @click="handleClearMenuAlerts"
        >
          {{ t("realtimeNotification.clear") }}
        </button>
      </div>

      <div v-if="activeMenuAlerts.length === 0" class="empty-state">
        <p>{{ t("realtimeNotification.allMenuItemsAvailable") }}</p>
      </div>

      <div v-else class="notification-list">
        <div
          v-for="alert in menuAlerts"
          :key="alert.menuItemId"
          class="notification-item menu-item"
          :class="{ unavailable: !alert.isAvailable }"
        >
          <div class="item-icon">{{ alert.isAvailable ? "✅" : "⚠️" }}</div>
          <div class="item-content">
            <div class="item-title">{{ alert.menuItemName }}</div>
            <div class="item-meta">
              <span v-if="!alert.isAvailable" class="status unavailable">
                {{
                  alert.reason || t("realtimeNotification.temporarilySoldOut")
                }}
              </span>
              <span v-else class="status available">{{
                t("realtimeNotification.backInStock")
              }}</span>
              <span class="time">{{ formatTime(alert.timestamp) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useCurrency } from "@/composables/useCurrency";
import { useAdminRealtime } from "@/composables/useAdminRealtime";
import type { OrderNotification } from "@/composables/useAdminRealtime";

// ========================================
// Composables
// ========================================

const {
  isConnected,
  connectionStatus,
  orderNotifications,
  unreadOrderCount,
  kitchenStats,
  menuAlerts,
  activeMenuAlerts,
  soundEnabled,
  toggleSound,
  markOrderAsRead,
  markAllOrdersAsRead,
  clearOrderNotifications,
  clearMenuAlerts,
} = useAdminRealtime();

const { t } = useI18n();
const { formatShortDateTime } = useDateFormatter();
const { formatPrice } = useCurrency();

// ========================================
// 本地狀態
// ========================================

const activeTab = ref<"orders" | "kitchen" | "menu">("orders");

// ========================================
// 計算屬性
// ========================================

const tabs = computed(() => [
  {
    id: "orders" as const,
    label: t("realtimeNotification.tabOrders"),
    badge: unreadOrderCount.value,
  },
  {
    id: "kitchen" as const,
    label: t("realtimeNotification.tabKitchen"),
    badge: 0,
  },
  {
    id: "menu" as const,
    label: t("realtimeNotification.tabMenu"),
    badge: activeMenuAlerts.value.length,
  },
]);

const connectionStatusClass = computed(() => {
  return {
    connected: isConnected.value,
    disconnected: connectionStatus.value === "disconnected",
    connecting: connectionStatus.value === "connecting",
    reconnecting: connectionStatus.value === "reconnecting",
    error: connectionStatus.value === "error",
  };
});

const connectionStatusText = computed(() => {
  switch (connectionStatus.value) {
    case "connected":
      return t("realtimeNotification.statusConnected");
    case "connecting":
      return t("realtimeNotification.statusConnecting");
    case "reconnecting":
      return t("realtimeNotification.statusReconnecting");
    case "disconnected":
      return t("realtimeNotification.statusDisconnected");
    case "error":
      return t("realtimeNotification.statusError");
    default:
      return t("realtimeNotification.statusUnknown");
  }
});

// ========================================
// 方法
// ========================================

/**
 * 格式化時間
 */
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (minutes < 1) return t("realtimeNotification.justNow");
  if (minutes < 60)
    return t("realtimeNotification.minutesAgo", { count: minutes });
  if (hours < 24) return t("realtimeNotification.hoursAgo", { count: hours });

  return formatShortDateTime(date);
};

/**
 * 處理訂單點擊
 */
const handleOrderClick = (order: OrderNotification) => {
  markOrderAsRead(order.orderId);
  // TODO: 導航到訂單詳情頁面
  console.log("Navigate to order:", order.orderId);
};

/**
 * 清除訂單通知
 */
const handleClearOrders = () => {
  markAllOrdersAsRead();
  clearOrderNotifications();
};

/**
 * 清除菜單警示
 */
const handleClearMenuAlerts = () => {
  clearMenuAlerts();
};
</script>

<style scoped>
.realtime-notification-panel {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  max-height: 600px;
  display: flex;
  flex-direction: column;
}

/* 連接狀態 */
.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  font-size: 14px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #bbb;
  animation: pulse 2s infinite;
}

.connection-status.connected .status-dot {
  background: #4caf50;
}

.connection-status.connecting .status-dot,
.connection-status.reconnecting .status-dot {
  background: #ff9800;
}

.connection-status.error .status-dot {
  background: #f44336;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* 標籤頁 */
.notification-tabs {
  display: flex;
  border-bottom: 1px solid #e0e0e0;
  background: white;
}

.tab-button {
  flex: 1;
  padding: 12px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: #666;
  position: relative;
  transition: all 0.3s;
}

.tab-button:hover {
  background: #f5f5f5;
}

.tab-button.active {
  color: #1976d2;
  font-weight: 600;
}

.tab-button.active::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #1976d2;
}

.tab-button .badge {
  display: inline-block;
  padding: 2px 6px;
  margin-left: 6px;
  background: #f44336;
  color: white;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}

.sound-toggle {
  padding: 12px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 18px;
  transition: opacity 0.3s;
}

.sound-toggle:hover {
  opacity: 0.7;
}

.sound-toggle.muted {
  opacity: 0.5;
}

/* 內容區域 */
.notification-content {
  flex: 1;
  overflow-y: auto;
  min-height: 300px;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.content-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.last-updated {
  font-size: 12px;
  color: #999;
}

.clear-button {
  padding: 6px 12px;
  border: none;
  background: #f5f5f5;
  color: #666;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.3s;
}

.clear-button:hover {
  background: #e0e0e0;
}

/* 空狀態 */
.empty-state {
  padding: 60px 20px;
  text-align: center;
  color: #999;
}

/* 通知列表 */
.notification-list {
  max-height: 450px;
  overflow-y: auto;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background 0.2s;
  position: relative;
}

.notification-item:hover {
  background: #f9f9f9;
}

.notification-item.unread {
  background: #e3f2fd;
}

.notification-item.unread:hover {
  background: #d1e7fd;
}

.item-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-weight: 600;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.table-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #e0e0e0;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.item-message {
  font-size: 14px;
  color: #666;
  margin-bottom: 4px;
}

.item-meta {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: #999;
}

.amount {
  color: #4caf50;
  font-weight: 600;
}

.status.unavailable {
  color: #f44336;
}

.status.available {
  color: #4caf50;
}

.unread-indicator {
  position: absolute;
  top: 20px;
  right: 16px;
  width: 8px;
  height: 8px;
  background: #2196f3;
  border-radius: 50%;
}

/* 系統通知級別顏色 */
/* 廚房統計 */
.kitchen-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  padding: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 8px;
  background: #f5f5f5;
}

.stat-card.pending {
  background: #fff3e0;
}

.stat-card.cooking {
  background: #e3f2fd;
}

.stat-card.ready {
  background: #e8f5e9;
}

.stat-card.time {
  background: #f3e5f5;
}

.stat-icon {
  font-size: 32px;
}

.stat-content {
  flex: 1;
}

.stat-label {
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #333;
}

/* 響應式 */
@media (max-width: 768px) {
  .notification-tabs {
    overflow-x: auto;
  }

  .tab-button {
    white-space: nowrap;
  }

  .kitchen-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
