<template>
  <div
    class="fixed right-0 top-16 w-80 max-w-sm bg-white shadow-2xl z-50 border border-gray-200 rounded-bl-lg overflow-hidden"
  >
    <!-- 標題欄 -->
    <div
      class="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between"
    >
      <div class="flex items-center space-x-2">
        <Bell class="w-5 h-5 text-gray-600" />
        <h3 class="text-sm font-semibold text-gray-900">
          {{ t("notification.title") }}
        </h3>
        <span
          v-if="unreadCount > 0"
          class="bg-red-500 text-white text-xs rounded-full px-2 py-0.5 min-w-[1.25rem] text-center"
        >
          {{ unreadCount > 99 ? "99+" : unreadCount }}
        </span>
      </div>
      <button
        :aria-label="t('common.close')"
        class="text-gray-400 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
        @click="$emit('close')"
      >
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <!-- 快速操作 -->
    <div
      class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-xs"
    >
      <div class="flex items-center space-x-3">
        <button
          :disabled="unreadCount === 0"
          class="text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
          @click="markAllAsRead"
        >
          {{ t("notification.markAllRead") }}
        </button>
        <button
          :disabled="notifications.length === 0"
          class="text-red-600 hover:text-red-800 disabled:text-gray-400 disabled:cursor-not-allowed"
          @click="clearAll"
        >
          {{ t("notification.clearAll") }}
        </button>
      </div>
      <div class="flex items-center space-x-2">
        <button
          :aria-label="
            soundEnabled ? t('a11y.muteSound') : t('a11y.enableSound')
          "
          class="p-1 rounded hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
          @click="toggleSound"
        >
          <SpeakerWaveIcon v-if="soundEnabled" class="w-4 h-4 text-blue-600" />
          <SpeakerXMarkIcon v-else class="w-4 h-4 text-gray-400" />
        </button>
        <button
          :aria-label="t('common.refresh')"
          class="p-1 rounded hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
          @click="refreshNotifications"
        >
          <ArrowPathIcon
            class="w-4 h-4 text-gray-600"
            :class="{ 'animate-spin': isRefreshing }"
          />
        </button>
      </div>
    </div>

    <!-- 通知列表 -->
    <div class="max-h-96 overflow-y-auto">
      <div v-if="notifications.length === 0" class="p-8 text-center">
        <Bell class="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p class="text-gray-500 text-sm">
          {{ t("notification.noNotifications") }}
        </p>
      </div>

      <div v-else class="divide-y divide-gray-100">
        <div
          v-for="notification in sortedNotifications"
          :key="notification.id"
          class="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
          :class="{
            'bg-blue-50 border-l-4 border-blue-500': !notification.read,
          }"
          @click="handleNotificationClick(notification)"
        >
          <div class="flex items-start space-x-3">
            <!-- 通知圖標 -->
            <div class="flex-shrink-0 mt-0.5">
              <div
                :class="[
                  'w-8 h-8 rounded-full flex items-center justify-center',
                  getNotificationIconBg(notification.type),
                ]"
              >
                <component
                  :is="getNotificationIcon(notification.type)"
                  :class="[
                    'w-4 h-4',
                    getNotificationIconColor(notification.type),
                  ]"
                />
              </div>
            </div>

            <!-- 通知內容 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-gray-900 truncate">
                  {{ notification.title }}
                </p>
                <div class="flex items-center space-x-2">
                  <span
                    v-if="!notification.read"
                    class="w-2 h-2 bg-blue-500 rounded-full"
                  />
                  <time class="text-xs text-gray-500 whitespace-nowrap">
                    {{ formatTime(notification.createdAt) }}
                  </time>
                </div>
              </div>

              <p class="text-sm text-gray-600 mt-1 line-clamp-2">
                {{ notification.message }}
              </p>

              <!-- 額外信息 -->
              <div v-if="notification.data" class="mt-2 text-xs text-gray-500">
                <span
                  v-if="notification.data.orderNumber"
                  class="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-800"
                >
                  {{
                    t("notification.orderBadge", {
                      orderNumber: notification.data.orderNumber,
                    })
                  }}
                </span>
                <span
                  v-if="notification.data.tableNumber"
                  class="inline-flex items-center px-2 py-1 rounded-full bg-blue-100 text-blue-800 ml-1"
                >
                  {{
                    t("notification.tableBadge", {
                      tableNumber: notification.data.tableNumber,
                    })
                  }}
                </span>
              </div>

              <!-- 操作按鈕 -->
              <div
                v-if="hasActionButtons(notification)"
                class="mt-3 flex space-x-2"
              >
                <button
                  v-if="notification.type === 'order_ready'"
                  class="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition-colors"
                  @click.stop="handleOrderAction(notification, 'deliver')"
                >
                  {{ t("notification.startDelivery") }}
                </button>
                <button
                  v-if="notification.type === 'order_urgent'"
                  class="text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors"
                  @click.stop="handleOrderAction(notification, 'prioritize')"
                >
                  {{ t("notification.prioritize") }}
                </button>
                <button
                  class="text-xs bg-gray-200 text-gray-800 px-3 py-1 rounded hover:bg-gray-300 transition-colors"
                  @click.stop="markAsRead(notification.id)"
                >
                  {{ t("notification.markRead") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作欄 -->
    <div
      v-if="notifications.length > 0"
      class="p-3 bg-gray-50 border-t border-gray-200"
    >
      <div class="flex items-center justify-between text-xs text-gray-500">
        <span>{{
          t("notification.totalCount", { count: notifications.length })
        }}</span>
        <button
          class="text-blue-600 hover:text-blue-800 transition-colors"
          @click="showAllNotifications"
        >
          {{ t("notification.viewAll") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useNotificationStore, type Notification } from "@/stores/notification";
import { useRouter } from "vue-router";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  Bell,
  AlertTriangle,
  ShoppingCart,
  CheckCircle,
  Info,
  Clock,
  User,
} from "lucide-vue-next";

defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const { formatShortDateTime } = useDateFormatter();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
const notificationStore = useNotificationStore();
const router = useRouter();

const isRefreshing = ref(false);

// 從 store 獲取數據
const notifications = computed(() => notificationStore.notifications);
const unreadCount = computed(() => notificationStore.unreadCount);
const soundEnabled = computed(() => notificationStore.soundEnabled);

// 按時間排序通知（未讀優先，然後按時間降序）
const sortedNotifications = computed(() => {
  return [...notifications.value].sort((a, b) => {
    if (a.read === b.read) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return a.read ? 1 : -1;
  });
});

// 方法
const markAllAsRead = () => {
  notificationStore.markAllAsRead();
};

const clearAll = async () => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("notification.title"),
    message: t("notification.clearConfirm"),
    confirmLabel: t("notification.clearAll"),
  });
  if (!confirmed) return;
  notificationStore.clearAll();
};

const toggleSound = () => {
  notificationStore.toggleSound();
};

const refreshNotifications = async () => {
  isRefreshing.value = true;
  // Notifications are pushed via real-time events (WebSocket/SSE).
  // Refresh provides visual feedback only.
  await new Promise((resolve) => setTimeout(resolve, 300));
  isRefreshing.value = false;
};

const markAsRead = (id: string) => {
  notificationStore.markAsRead(id);
};

const handleNotificationClick = (notification: Notification) => {
  if (!notification.read) {
    markAsRead(notification.id);
  }

  // 根據通知類型導航到相應頁面
  if (
    notification.type === "order_new" ||
    notification.type === "order_urgent"
  ) {
    router.push("/dashboard/orders");
  } else if (notification.type === "order_ready") {
    if (userCanAccessService()) {
      router.push("/service");
    } else {
      router.push("/dashboard/orders");
    }
  } else if (notification.type === "system_alert") {
    router.push("/dashboard/analytics");
  }
};

const handleOrderAction = (notification: Notification, action: string) => {
  console.log("Handle order action:", action, notification);

  if (action === "deliver") {
    router.push("/service");
  } else if (action === "prioritize") {
    // 優先處理邏輯
    toast.success(t("notification.prioritized"));
    markAsRead(notification.id);
  }
};

const showAllNotifications = () => {
  router.push("/dashboard/notifications");
};

const hasActionButtons = (notification: Notification) => {
  return ["order_ready", "order_urgent"].includes(notification.type);
};

const userCanAccessService = () => {
  // 檢查用戶是否有服務權限
  return true; // 簡化實現
};

// 通知圖標映射
const getNotificationIcon = (type: string) => {
  const iconMap = {
    order_new: ShoppingCart,
    order_urgent: AlertTriangle,
    order_ready: CheckCircle,
    system_alert: Info,
    staff_update: User,
    reminder: Clock,
  };
  return iconMap[type as keyof typeof iconMap] || Bell;
};

const getNotificationIconBg = (type: string) => {
  const bgMap = {
    order_new: "bg-blue-100",
    order_urgent: "bg-red-100",
    order_ready: "bg-green-100",
    system_alert: "bg-yellow-100",
    staff_update: "bg-teal-100",
    reminder: "bg-gray-100",
  };
  return bgMap[type as keyof typeof bgMap] || "bg-gray-100";
};

const getNotificationIconColor = (type: string) => {
  const colorMap = {
    order_new: "text-blue-600",
    order_urgent: "text-red-600",
    order_ready: "text-green-600",
    system_alert: "text-yellow-600",
    staff_update: "text-teal-600",
    reminder: "text-gray-600",
  };
  return colorMap[type as keyof typeof colorMap] || "text-gray-600";
};

const formatTime = (dateTime: Date) => {
  const now = new Date();
  const diff = now.getTime() - dateTime.getTime();
  const minutes = Math.floor(diff / (1000 * 60));

  if (minutes < 1) return t("notification.justNow");
  if (minutes < 60) return t("notification.minutesAgo", { count: minutes });
  if (minutes < 24 * 60)
    return t("notification.hoursAgo", { count: Math.floor(minutes / 60) });

  return formatShortDateTime(dateTime);
};

onMounted(() => {
  notificationStore.initializeSoundSetting();
});
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 自定義滾動條 */
.overflow-y-auto::-webkit-scrollbar {
  width: 4px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: #f1f5f9;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 2px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
