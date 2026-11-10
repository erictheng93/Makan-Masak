<template>
  <!-- 全局錯誤顯示組件 -->
  <Teleport to="body">
    <!-- 離線狀態橫幅 -->
    <div
      v-if="showOfflineBanner"
      class="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-white p-2 text-center text-sm font-medium"
    >
      <div class="flex items-center justify-center space-x-2">
        <WifiIcon class="w-4 h-4" />
        <span>{{ offlineMessage }}</span>
        <button
          v-if="pendingRequests > 0"
          class="text-yellow-100 hover:text-white underline"
          @click="showPendingRequests = !showPendingRequests"
        >
          {{
            t("errorDisplay.pendingRequestsCount", { count: pendingRequests })
          }}
        </button>
      </div>
    </div>

    <!-- 連接狀態指示器 -->
    <div
      v-if="showConnectionStatus"
      :class="[
        'fixed top-4 right-4 z-40 px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2 text-sm font-medium transition-all duration-300',
        connectionStatusClass,
      ]"
    >
      <div
        :class="[
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400',
        ]"
      />
      <span>{{ connectionStatusText }}</span>
      <button
        v-if="!isConnected && canReconnect"
        class="text-xs bg-white bg-opacity-20 px-2 py-1 rounded hover:bg-opacity-30"
        @click="handleReconnect"
      >
        {{ t("errorDisplay.reconnect") }}
      </button>
    </div>

    <!-- 待處理請求列表 -->
    <div
      v-if="showPendingRequests && pendingRequests > 0"
      class="fixed top-12 right-4 z-40 w-80 bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden"
    >
      <div class="p-4 bg-yellow-50 border-b border-yellow-200">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-gray-900">
            {{ t("errorDisplay.pendingRequests") }}
          </h3>
          <button
            :aria-label="t('common.close')"
            class="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            @click="showPendingRequests = false"
          >
            <XMarkIcon class="w-5 h-5" />
          </button>
        </div>
        <p class="text-sm text-gray-600 mt-1">
          {{ t("errorDisplay.pendingRequestsHint") }}
        </p>
      </div>
      <div class="max-h-64 overflow-y-auto">
        <div
          v-for="(request, index) in pendingRequestsList"
          :key="index"
          class="p-3 border-b border-gray-100 last:border-b-0"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-900">
                {{ request.method }} {{ request.url }}
              </p>
              <p class="text-xs text-gray-500">
                {{ request.timestamp }}
              </p>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
              <span class="text-xs text-gray-500">{{
                t("errorDisplay.waiting")
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 錯誤快速恢復面板 -->
    <div
      v-if="showRecoveryPanel"
      class="fixed bottom-4 right-4 z-40 w-96 bg-white rounded-lg shadow-2xl border border-red-200 overflow-hidden"
    >
      <div class="p-4 bg-red-50 border-b border-red-200">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <ExclamationTriangleIcon class="w-5 h-5 text-red-600" />
            <h3 class="font-semibold text-red-900">
              {{ t("errorDisplay.systemError") }}
            </h3>
          </div>
          <button
            :aria-label="t('common.close')"
            class="text-red-400 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            @click="showRecoveryPanel = false"
          >
            <XMarkIcon class="w-5 h-5" />
          </button>
        </div>
      </div>
      <div class="p-4">
        <p class="text-sm text-gray-700 mb-4">
          {{ t("errorDisplay.recoveryHint") }}
        </p>
        <div class="space-y-2">
          <button
            class="w-full text-left px-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 rounded-md"
            @click="handleClearCache"
          >
            🗑️ {{ t("errorDisplay.clearCache") }}
          </button>
          <button
            class="w-full text-left px-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 rounded-md"
            @click="handleRefreshPage"
          >
            🔄 {{ t("errorDisplay.refreshPage") }}
          </button>
          <button
            class="w-full text-left px-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 rounded-md"
            @click="handleResetSettings"
          >
            ⚙️ {{ t("errorDisplay.resetSettings") }}
          </button>
          <button
            class="w-full text-left px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100 rounded-md text-blue-700"
            @click="handleReportProblem"
          >
            📝 {{ t("errorDisplay.reportProblem") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 錯誤統計面板（開發模式） -->
    <div
      v-if="isDevelopment && showErrorStats"
      class="fixed bottom-4 left-4 z-40 w-80 bg-gray-900 text-white rounded-lg shadow-2xl overflow-hidden"
    >
      <div class="p-3 bg-gray-800 border-b border-gray-700">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-sm">
            {{ t("errorDisplay.errorStats") }}
          </h3>
          <button
            :aria-label="t('common.close')"
            class="text-gray-400 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            @click="showErrorStats = false"
          >
            <XMarkIcon class="w-4 h-4" />
          </button>
        </div>
      </div>
      <div class="p-3 text-xs space-y-2">
        <div
          v-for="(count, type) in errorStats"
          :key="type"
          class="flex justify-between"
        >
          <span class="capitalize">{{ type }}:</span>
          <span class="font-mono">{{ count }}</span>
        </div>
        <hr class="border-gray-700" />
        <div class="flex justify-between">
          <span>{{ t("errorDisplay.total") }}:</span>
          <span class="font-mono font-bold">{{ totalErrors }}</span>
        </div>
        <button
          class="w-full mt-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
          @click="clearErrorStats"
        >
          {{ t("errorDisplay.clearStats") }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import {
  WifiIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { errorHandler } from "@/utils/errorHandler";

// Props
interface Props {
  showConnectionIndicator?: boolean;
  showOfflineSupport?: boolean;
  enableRecoveryPanel?: boolean;
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

const props = withDefaults(defineProps<Props>(), {
  showConnectionIndicator: true,
  showOfflineSupport: true,
  enableRecoveryPanel: true,
  position: "top-right",
});

const { t } = useI18n();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();

// 響應式狀態
const isConnected = ref(navigator.onLine);
const isRealtimeConnected = ref(true);
const showConnectionStatus = ref(false);
const showOfflineBanner = ref(false);
const showPendingRequests = ref(false);
const showRecoveryPanel = ref(false);
const showErrorStats = ref(false);
const pendingRequests = ref(0);
const pendingRequestsList = ref<
  Array<{
    method: string;
    url: string;
    timestamp: string;
  }>
>([]);

const errorStats = ref<Record<string, number>>({});
const isDevelopment = ref(import.meta.env.DEV);

// 計算屬性
const connectionStatusClass = computed(() => {
  if (isConnected.value && isRealtimeConnected.value) {
    return "bg-green-500 text-white";
  } else if (isConnected.value) {
    return "bg-yellow-500 text-white";
  } else {
    return "bg-red-500 text-white";
  }
});

const connectionStatusText = computed(() => {
  if (isConnected.value && isRealtimeConnected.value) {
    return t("errorDisplay.connectionNormal");
  } else if (isConnected.value) {
    return t("errorDisplay.realtimeDisconnected");
  } else {
    return t("errorDisplay.networkDisconnected");
  }
});

const offlineMessage = computed(() => {
  if (pendingRequests.value > 0) {
    return t("errorDisplay.offlineWithPending", {
      count: pendingRequests.value,
    });
  }
  return t("errorDisplay.offlineMode");
});

const canReconnect = computed(() => {
  return isConnected.value && !isRealtimeConnected.value;
});

const totalErrors = computed(() => {
  return Object.values(errorStats.value).reduce((sum, count) => sum + count, 0);
});

// 方法
const handleReconnect = () => {
  // 觸發重連事件
  window.dispatchEvent(new CustomEvent("manual-reconnect"));
};

const handleClearCache = () => {
  try {
    // 清理 localStorage
    const keysToKeep = ["auth_user", "user_preferences"];
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (!keysToKeep.includes(key)) {
        localStorage.removeItem(key);
      }
    });

    // 清理 sessionStorage
    sessionStorage.clear();

    // Clear application cache if method exists
    if (
      "clearCache" in errorHandler &&
      typeof errorHandler.clearCache === "function"
    ) {
      errorHandler.clearCache();
    }

    toast.success(t("errorDisplay.cacheClearedAlert"));
  } catch (error) {
    console.error("清理緩存失敗:", error);
    toast.error(t("errorDisplay.cacheCleanFailed"));
  }
};

const handleRefreshPage = () => {
  window.location.reload();
};

const handleResetSettings = async () => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("errorDisplay.resetSettings"),
    message: t("errorDisplay.resetSettingsConfirm"),
    confirmLabel: t("errorDisplay.resetSettings"),
  });
  if (!confirmed) return;
  localStorage.clear();
  sessionStorage.clear();
  window.location.reload();
};

const handleReportProblem = () => {
  const errorInfo = {
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    errorStats: errorStats.value,
    isOnline: isConnected.value,
    isRealtimeConnected: isRealtimeConnected.value,
  };

  // 在實際應用中，這裡應該打開問題回報表單或發送錯誤報告
  console.log("錯誤報告信息:", errorInfo);
  toast.info(t("errorDisplay.reportNotImplemented"));
};

const clearErrorStats = () => {
  errorStats.value = {};
};

const updateErrorStats = (errorType: string) => {
  errorStats.value[errorType] = (errorStats.value[errorType] || 0) + 1;
};

// 事件監聽器
const handleOnlineStatusChange = () => {
  const wasOffline = !isConnected.value;
  isConnected.value = navigator.onLine;

  if (wasOffline && isConnected.value) {
    // 從離線恢復到在線
    showOfflineBanner.value = false;
    showConnectionStatus.value = true;
    setTimeout(() => {
      showConnectionStatus.value = false;
    }, 3000);
  } else if (!isConnected.value) {
    // 變為離線狀態
    showOfflineBanner.value = props.showOfflineSupport;
  }
};

const handleRealtimeStatusChange = (event: CustomEvent) => {
  isRealtimeConnected.value = event.detail.connected;

  if (props.showConnectionIndicator) {
    showConnectionStatus.value = true;
    setTimeout(() => {
      if (isConnected.value && isRealtimeConnected.value) {
        showConnectionStatus.value = false;
      }
    }, 3000);
  }
};

const handleErrorOccurred = (event: CustomEvent) => {
  const errorType = event.detail.type || "unknown";
  updateErrorStats(errorType);

  // 如果錯誤比較嚴重，顯示恢復面板
  if (
    props.enableRecoveryPanel &&
    (errorType === "critical" || totalErrors.value > 5)
  ) {
    showRecoveryPanel.value = true;
  }
};

const handlePendingRequestsChange = (event: CustomEvent) => {
  pendingRequests.value = event.detail.count;
  pendingRequestsList.value = event.detail.requests || [];
};

// 生命週期
onMounted(() => {
  // 監聽網絡狀態變化
  window.addEventListener("online", handleOnlineStatusChange);
  window.addEventListener("offline", handleOnlineStatusChange);

  // 監聽 realtime 狀態變化
  window.addEventListener(
    "realtime-status-change",
    handleRealtimeStatusChange as EventListener,
  );

  // 監聽錯誤事件
  window.addEventListener(
    "error-occurred",
    handleErrorOccurred as EventListener,
  );

  // 監聽待處理請求變化
  window.addEventListener(
    "pending-requests-change",
    handlePendingRequestsChange as EventListener,
  );

  // 初始狀態檢查
  handleOnlineStatusChange();

  // 開發模式下顯示錯誤統計
  if (isDevelopment.value) {
    // 雙擊右下角顯示錯誤統計
    document.addEventListener("dblclick", (event) => {
      if (
        event.clientX > window.innerWidth - 100 &&
        event.clientY > window.innerHeight - 100
      ) {
        showErrorStats.value = !showErrorStats.value;
      }
    });
  }
});

onUnmounted(() => {
  window.removeEventListener("online", handleOnlineStatusChange);
  window.removeEventListener("offline", handleOnlineStatusChange);
  window.removeEventListener(
    "realtime-status-change",
    handleRealtimeStatusChange as EventListener,
  );
  window.removeEventListener(
    "error-occurred",
    handleErrorOccurred as EventListener,
  );
  window.removeEventListener(
    "pending-requests-change",
    handlePendingRequestsChange as EventListener,
  );
});
</script>
