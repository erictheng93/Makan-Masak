<script setup lang="ts">
/**
 * Realtime Monitor Panel
 * WebSocket 連接監控儀表板組件
 */
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "@/i18n";
import { api, unwrapApiPayload } from "@/services/api";
import type { RealtimeOverview, RoomType } from "@/types/realtime";

// Props
interface Props {
  restaurantId: string;
  refreshInterval?: number; // in seconds
}

const props = withDefaults(defineProps<Props>(), {
  refreshInterval: 10,
});

// Emit events
const emit = defineEmits<{
  (e: "error", error: Error): void;
  (e: "refresh"): void;
}>();

// i18n — cast _t to accept string fallback; vue-i18n v9 types only allow NamedValue
const { t: _t } = useI18n();
const t = _t as unknown as (key: string, fallback?: string) => string;

// State
const isLoading = ref(false);
const lastError = ref<string | null>(null);
const overview = ref<RealtimeOverview | null>(null);
const lastRefresh = ref<Date | null>(null);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// Computed
const totalConnections = computed(() => overview.value?.totalConnections ?? 0);

const healthStatus = computed(() => {
  if (!overview.value) return "unknown";
  return overview.value.health.status;
});

const healthStatusClass = computed(() => {
  const status = healthStatus.value;
  switch (status) {
    case "healthy":
      return "bg-green-100 text-green-800";
    case "idle":
      return "bg-gray-100 text-gray-800";
    case "degraded":
      return "bg-yellow-100 text-yellow-800";
    case "unhealthy":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
});

const roomStatsOrdered = computed(() => {
  if (!overview.value?.roomStats) return [];
  const order: RoomType[] = ["kitchen", "admin", "customer"];
  return order.map(
    (type) =>
      overview.value!.roomStats.find((r) => r.roomType === type) || {
        roomType: type,
        connectionCount: 0,
        status: "inactive" as const,
      },
  );
});

// Methods
async function fetchOverview() {
  if (!props.restaurantId) return;

  isLoading.value = true;
  lastError.value = null;

  try {
    const response = await api.get<RealtimeOverview>(
      `/realtime/stats/overview?restaurantId=${props.restaurantId}`,
    );

    if (response.data.success && response.data.data) {
      // Defensive: handle double-wrapped cache responses
      const payload = response.data.data;
      overview.value = unwrapApiPayload<RealtimeOverview>(payload);
      lastRefresh.value = new Date();
      emit("refresh");
    } else {
      const errorMsg =
        typeof response.data.error === "string"
          ? response.data.error
          : response.data.error?.message || "Failed to fetch realtime stats";
      throw new Error(errorMsg);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Unknown error");
    lastError.value = err.message;
    emit("error", err);
    console.error("Failed to fetch realtime overview:", error);
  } finally {
    isLoading.value = false;
  }
}

function getRoomLabel(roomType: RoomType): string {
  switch (roomType) {
    case "kitchen":
      return t("realtime.rooms.kitchen", "廚房");
    case "admin":
      return t("realtime.rooms.admin", "管理後台");
    case "customer":
      return t("realtime.rooms.customer", "顧客");
    default:
      return roomType;
  }
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-500";
    case "inactive":
      return "bg-gray-400";
    case "error":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

function formatTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleTimeString();
  } catch {
    return "--:--:--";
  }
}

function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = setInterval(fetchOverview, props.refreshInterval * 1000);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// Lifecycle
onMounted(() => {
  fetchOverview();
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});
</script>

<template>
  <div
    class="realtime-monitor-panel bg-white rounded-lg shadow-sm border border-gray-200"
  >
    <!-- Header -->
    <div
      class="px-4 py-3 border-b border-gray-200 flex items-center justify-between"
    >
      <div class="flex items-center space-x-2">
        <div
          class="w-2 h-2 rounded-full animate-pulse"
          :class="totalConnections > 0 ? 'bg-green-500' : 'bg-gray-400'"
        />
        <h3 class="text-lg font-semibold text-gray-900">
          {{ t("realtime.title", "即時連接監控") }}
        </h3>
      </div>
      <div class="flex items-center space-x-3">
        <!-- Health Status Badge -->
        <span
          class="px-2 py-1 text-xs font-medium rounded-full"
          :class="healthStatusClass"
        >
          {{ healthStatus }}
        </span>
        <!-- Refresh Button -->
        <button
          :aria-label="t('common.refresh')"
          :disabled="isLoading"
          class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
          :class="{ 'animate-spin': isLoading }"
          @click="fetchOverview"
        >
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Stats Overview -->
    <div class="p-4">
      <!-- Total Connections -->
      <div class="mb-4 text-center">
        <div class="text-4xl font-bold text-gray-900">
          {{ totalConnections }}
        </div>
        <div class="text-sm text-gray-500">
          {{ t("realtime.totalConnections", "總連接數") }}
        </div>
      </div>

      <!-- Room Stats Grid -->
      <div class="grid grid-cols-3 gap-3">
        <div
          v-for="room in roomStatsOrdered"
          :key="room.roomType"
          class="p-3 bg-gray-50 rounded-lg"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-gray-700">
              {{ getRoomLabel(room.roomType) }}
            </span>
            <span
              class="w-2 h-2 rounded-full"
              :class="getStatusBadgeClass(room.status)"
            />
          </div>
          <div class="text-2xl font-bold text-gray-900">
            {{ room.connectionCount }}
          </div>
          <div class="text-xs text-gray-500 mt-1">
            {{
              room.status === "active"
                ? t("realtime.status.active", "活躍")
                : t("realtime.status.inactive", "閒置")
            }}
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div
      class="px-4 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500"
    >
      <span v-if="lastRefresh">
        {{ t("realtime.lastUpdate", "最後更新") }}:
        {{ formatTime(lastRefresh.toISOString()) }}
      </span>
      <span v-else>
        {{ t("realtime.loading", "載入中...") }}
      </span>
      <span>
        {{ t("realtime.autoRefresh") }}: {{ props.refreshInterval }}s
      </span>
    </div>

    <!-- Error State -->
    <div
      v-if="lastError"
      class="px-4 py-2 bg-red-50 border-t border-red-200 text-sm text-red-600"
    >
      {{ lastError }}
    </div>
  </div>
</template>

<style scoped>
.realtime-monitor-panel {
  min-width: 320px;
}
</style>
