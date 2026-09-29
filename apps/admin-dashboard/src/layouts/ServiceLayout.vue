<template>
  <div class="service-layout min-h-screen bg-gray-100">
    <!-- 頂部導航欄 -->
    <nav class="bg-white shadow-sm border-b border-gray-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16">
          <!-- 左側 Logo 和標題 -->
          <div class="flex items-center">
            <div class="flex-shrink-0 flex items-center">
              <ListBulletIcon class="h-8 w-8 text-blue-600 mr-3" />
              <h1 class="text-xl font-bold text-gray-900">MakanMasak</h1>
              <span
                class="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full font-medium"
              >
                {{ t("serviceLayout.roleBadge") }}
              </span>
            </div>
          </div>

          <!-- 右側用戶信息和操作 -->
          <div class="flex items-center space-x-4">
            <!-- 通知指示器 -->
            <button
              class="relative p-2 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              @click="toggleNotifications"
            >
              <BellIcon class="h-6 w-6" />
              <span
                v-if="unreadNotifications > 0"
                class="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center"
              >
                {{ unreadNotifications }}
              </span>
            </button>

            <!-- 用戶下拉選單 -->
            <div class="relative">
              <button
                class="flex items-center text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                @click="toggleUserMenu"
              >
                <div
                  class="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center"
                >
                  <UserIcon class="h-5 w-5 text-blue-600" />
                </div>
                <span class="hidden sm:block ml-2 text-gray-700 font-medium">{{
                  currentUser.name
                }}</span>
                <ChevronDownIcon
                  class="hidden sm:block ml-1 h-4 w-4 text-gray-500"
                />
              </button>

              <!-- 下拉選單 -->
              <div
                v-if="showUserMenu"
                class="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-gray-200"
              >
                <div class="px-4 py-2 border-b border-gray-200">
                  <p class="text-sm font-medium text-gray-900">
                    {{ currentUser.name }}
                  </p>
                  <p class="text-sm text-gray-500">
                    {{ t("serviceLayout.roleBadge") }}
                  </p>
                </div>
                <button
                  class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  @click="openProfile"
                >
                  {{ t("serviceLayout.profile") }}
                </button>
                <button
                  class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  @click="openSettings"
                >
                  {{ t("serviceLayout.settings") }}
                </button>
                <div class="border-t border-gray-200" />
                <button
                  class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  @click="logout"
                >
                  {{ t("serviceLayout.logout") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <!-- 主要內容區域 -->
    <main class="flex-1">
      <router-view />
    </main>

    <!-- 通知面板 -->
    <div v-if="showNotifications" class="fixed inset-0 z-50 overflow-hidden">
      <div
        class="absolute inset-0 bg-black bg-opacity-25"
        @click="closeNotifications"
      />
      <div class="absolute right-0 top-0 h-full w-96 bg-white shadow-xl">
        <div
          class="flex items-center justify-between p-4 border-b border-gray-200"
        >
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("serviceLayout.notifications") }}
          </h3>
          <button
            class="text-gray-400 hover:text-gray-500"
            @click="closeNotifications"
          >
            <XMarkIcon class="h-5 w-5" />
          </button>
        </div>

        <div class="overflow-y-auto h-full pb-20">
          <div v-if="notifications.length === 0" class="p-8 text-center">
            <BellIcon class="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p class="text-gray-500">
              {{ t("serviceLayout.noNotifications") }}
            </p>
          </div>

          <div v-else class="divide-y divide-gray-200">
            <div
              v-for="notification in notifications"
              :key="notification.id"
              class="p-4 hover:bg-gray-50 cursor-pointer"
              :class="{ 'bg-blue-50': !notification.read }"
              @click="handleNotificationClick(notification)"
            >
              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <component
                    :is="getNotificationIcon(notification.type)"
                    :class="getNotificationIconClass(notification.type)"
                    class="h-6 w-6"
                  />
                </div>
                <div class="ml-3 flex-1">
                  <p class="text-sm font-medium text-gray-900">
                    {{ notification.title }}
                  </p>
                  <p class="text-sm text-gray-600 mt-1">
                    {{ notification.message }}
                  </p>
                  <p class="text-xs text-gray-500 mt-2">
                    {{ formatNotificationTime(notification.createdAt) }}
                  </p>
                </div>
                <div
                  v-if="!notification.read"
                  class="w-2 h-2 bg-blue-500 rounded-full"
                />
              </div>
            </div>
          </div>
        </div>

        <div
          class="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200"
        >
          <button
            class="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            @click="markAllAsRead"
          >
            {{ t("serviceLayout.markAllRead") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 緊急訂單提醒彈窗 -->
    <div
      v-if="urgentOrderAlert"
      class="fixed bottom-4 right-4 z-40 max-w-sm bg-red-100 border border-red-400 rounded-lg shadow-lg p-4"
    >
      <div class="flex items-start">
        <ExclamationTriangleIcon
          class="h-6 w-6 text-red-600 mr-3 flex-shrink-0"
        />
        <div class="flex-1">
          <h4 class="text-sm font-semibold text-red-800">
            {{ t("serviceLayout.urgentOrderAlert") }}
          </h4>
          <p class="text-sm text-red-700 mt-1">
            {{ urgentOrderAlert.message }}
          </p>
          <div class="mt-3 flex space-x-2">
            <button
              class="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
              @click="handleUrgentOrder"
            >
              {{ t("serviceLayout.handleNow") }}
            </button>
            <button
              class="px-3 py-1 bg-red-200 text-red-800 text-xs rounded hover:bg-red-300 transition-colors"
              @click="dismissUrgentAlert"
            >
              {{ t("serviceLayout.remindLater") }}
            </button>
          </div>
        </div>
        <button
          class="text-red-400 hover:text-red-600 ml-2"
          @click="closeUrgentAlert"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- 快速操作浮動按鈕 (移動端) -->
    <div class="sm:hidden fixed bottom-6 right-6 z-30">
      <button
        class="w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
        @click="toggleQuickActions"
      >
        <component
          :is="showQuickActions ? XMarkIcon : PlusIcon"
          class="h-6 w-6"
        />
      </button>

      <!-- 快速操作選單 -->
      <div v-if="showQuickActions" class="absolute bottom-16 right-0 space-y-2">
        <button
          class="flex items-center justify-center w-12 h-12 bg-green-600 text-white rounded-full shadow-lg hover:bg-green-700 transition-colors"
          @click="refreshData"
        >
          <ArrowPathIcon class="h-5 w-5" />
        </button>
        <button
          class="flex items-center justify-center w-12 h-12 bg-yellow-600 text-white rounded-full shadow-lg hover:bg-yellow-700 transition-colors"
          @click="openNotifications"
        >
          <BellIcon class="h-5 w-5" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, type Component } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useAuthStore } from "@/stores/auth";
import type { SystemNotification, UrgentOrderAlert } from "@/types";
import {
  BellIcon,
  UserIcon,
  ChevronDownIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  ArrowPathIcon,
  ListBulletIcon,
  StarIcon,
} from "@heroicons/vue/24/outline";
import { useConfirmModal } from "@/composables/useConfirmModal";

const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();
const { confirm: confirmModal } = useConfirmModal();

// 響應式狀態
const showUserMenu = ref(false);
const showNotifications = ref(false);
const showQuickActions = ref(false);
const urgentOrderAlert = ref<UrgentOrderAlert | null>(null);

// 用戶數據（從 auth store 取得）
const currentUser = computed(() => ({
  name: authStore.user?.username || "",
  role:
    authStore.user?.role !== undefined
      ? ["admin", "shop_owner", "chef", "service_crew", "cashier"][
          authStore.user.role
        ] || "staff"
      : "staff",
}));

const unreadNotifications = ref(0);

const notifications = ref<SystemNotification[]>([]);

// 方法
const toggleUserMenu = () => {
  showUserMenu.value = !showUserMenu.value;
  if (showUserMenu.value) {
    showNotifications.value = false;
    showQuickActions.value = false;
  }
};

const toggleNotifications = () => {
  showNotifications.value = !showNotifications.value;
  if (showNotifications.value) {
    showUserMenu.value = false;
    showQuickActions.value = false;
  }
};

const toggleQuickActions = () => {
  showQuickActions.value = !showQuickActions.value;
  if (showQuickActions.value) {
    showUserMenu.value = false;
    showNotifications.value = false;
  }
};

const closeNotifications = () => {
  showNotifications.value = false;
};

const openNotifications = () => {
  showNotifications.value = true;
  showQuickActions.value = false;
};

const openProfile = () => {
  showUserMenu.value = false;
  toast.info(t("serviceLayout.profileWIP"));
};

const openSettings = () => {
  showUserMenu.value = false;
  toast.info(t("serviceLayout.settingsWIP"));
};

const logout = async () => {
  showUserMenu.value = false;
  const confirmed = await confirmModal({
    type: "warning",
    title: t("auth.confirmLogout"),
    message: t("auth.confirmLogout"),
    confirmLabel: t("auth.logout"),
  });
  if (!confirmed) return;
  authStore.logout();
  router.push("/login");
};

const refreshData = () => {
  showQuickActions.value = false;
  // 觸發數據刷新
  window.location.reload();
};

const handleNotificationClick = (notification: SystemNotification) => {
  if (!notification.read) {
    notification.read = true;
    unreadNotifications.value = Math.max(0, unreadNotifications.value - 1);
  }

  // 根據通知類型執行相應操作
  if (notification.type === "urgent_order") {
    router.push("/service");
    closeNotifications();
  }
};

const markAllAsRead = () => {
  notifications.value.forEach((n) => (n.read = true));
  unreadNotifications.value = 0;
};

const getNotificationIcon = (type: string) => {
  const icons: Record<string, Component> = {
    urgent_order: ExclamationTriangleIcon,
    new_order: BellIcon,
    achievement: StarIcon,
  };
  return icons[type] || BellIcon;
};

const getNotificationIconClass = (type: string) => {
  const classes: Record<string, string> = {
    urgent_order: "text-red-500",
    new_order: "text-blue-500",
    achievement: "text-green-500",
  };
  return classes[type] || "text-gray-500";
};

const formatNotificationTime = (dateTime: string) => {
  const now = new Date();
  const time = new Date(dateTime);
  const diffInMinutes = Math.floor(
    (now.getTime() - time.getTime()) / (1000 * 60),
  );

  if (diffInMinutes < 1) return t("serviceLayout.justNow");
  if (diffInMinutes < 60)
    return t("serviceLayout.minutesAgo", { count: diffInMinutes });
  const hours = Math.floor(diffInMinutes / 60);
  if (hours < 24) return t("serviceLayout.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("serviceLayout.daysAgo", { count: days });
};

const handleUrgentOrder = () => {
  router.push("/service");
  closeUrgentAlert();
};

const dismissUrgentAlert = () => {
  // 5分鐘後再次提醒
  setTimeout(
    () => {
      if (!urgentOrderAlert.value) {
        showUrgentOrderAlert("訂單T01仍在等待配送，請儘快處理！");
      }
    },
    5 * 60 * 1000,
  );
  closeUrgentAlert();
};

const closeUrgentAlert = () => {
  urgentOrderAlert.value = null;
};

const showUrgentOrderAlert = (message: string) => {
  urgentOrderAlert.value = { message };
};

// 點擊外部關閉選單
const handleClickOutside = (event: Event) => {
  if (!(event.target as Element)?.closest?.(".relative")) {
    showUserMenu.value = false;
    showQuickActions.value = false;
  }
};

// 生命週期
onMounted(() => {
  document.addEventListener("click", handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
});
</script>

<style scoped>
.service-layout {
  font-family:
    "Inter",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "Roboto",
    sans-serif;
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

/* 動畫效果 */
@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes bounce {
  0%,
  20%,
  53%,
  80%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  40%,
  43% {
    transform: translate3d(0, -8px, 0);
  }
  70% {
    transform: translate3d(0, -4px, 0);
  }
  90% {
    transform: translate3d(0, -2px, 0);
  }
}

.bounce {
  animation: bounce 1s infinite;
}
</style>
