<template>
  <div class="kitchen-page ui-page bg-ios-bg min-h-screen px-5 pt-6 pb-10">
    <!-- Header Row -->
    <div class="kitchen-page-heading ui-page-heading">
      <button
        :aria-label="t('common.back')"
        class="w-11 h-11 rounded-full bg-white shadow-card-sm flex items-center justify-center flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
        @click="$router.back()"
      >
        <ArrowLeft class="w-5 h-5 text-ios-text" />
      </button>
      <h1 class="text-2xl font-extrabold text-ios-text flex-1">
        {{ t("history.title") }}
      </h1>

      <!-- iOS Segmented Control -->
      <div
        class="ui-tabs bg-white rounded-full p-1 inline-flex gap-0.5 shadow-card-sm"
      >
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :aria-pressed="activeTab === tab.key"
          class="px-3.5 py-1.5 text-sm rounded-full transition-all duration-200"
          :class="
            activeTab === tab.key
              ? 'bg-blue-700 text-white font-semibold shadow-card-sm'
              : 'text-ios-secondary font-medium'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- Summary Card -->
    <div
      v-if="!loading && !loadError"
      data-testid="history-summary"
      class="mt-5"
    >
      <div class="history-stats ui-stat-strip">
        <!-- Total Orders -->
        <div class="ui-stat flex flex-col items-center">
          <span class="text-2xl font-extrabold text-ios-text">{{
            summary.total
          }}</span>
          <span class="text-xs text-ios-secondary mt-0.5">{{
            t("history.totalOrders")
          }}</span>
        </div>
        <!-- Avg Cooking Time -->
        <div class="ui-stat flex flex-col items-center">
          <span class="text-2xl font-extrabold text-ios-green">{{
            summary.avgCookingTime
          }}</span>
          <span class="text-xs text-ios-secondary mt-0.5">{{
            t("history.avgPrepTime")
          }}</span>
        </div>
        <!-- On-time Rate -->
        <div class="ui-stat flex flex-col items-center">
          <span class="text-2xl font-extrabold text-ios-blue"
            >{{ summary.onTimeRate }}%</span
          >
          <span class="text-xs text-ios-secondary mt-0.5">{{
            t("history.onTimeRate")
          }}</span>
        </div>
      </div>
    </div>

    <div
      v-if="loading"
      role="status"
      class="ui-empty-state mt-5 bg-white rounded-3xl p-10 text-center"
    >
      <div class="loading-spinner w-8 h-8 mx-auto mb-4" aria-hidden="true" />
      {{ t("common.loading") }}
    </div>
    <div
      v-else-if="loadError"
      role="alert"
      class="ui-empty-state mt-5 bg-white rounded-3xl p-8 text-center"
    >
      <p class="font-semibold text-red-700">{{ loadError }}</p>
      <button
        data-testid="history-retry"
        class="btn-kitchen btn-kitchen-primary mt-4"
        @click="loadOrders"
      >
        {{ t("common.retry") }}
      </button>
    </div>
    <!-- Order List -->
    <div
      v-else-if="filteredOrders.length > 0"
      class="bg-white rounded-2xl shadow-card overflow-hidden mt-4"
    >
      <div
        v-for="order in filteredOrders"
        :key="order.id"
        class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg last:border-b-0"
      >
        <!-- Left: info -->
        <div class="flex flex-col gap-0.5 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Order Number -->
            <span
              class="text-base font-extrabold"
              :class="
                order.status === 'cancelled'
                  ? 'text-ios-secondary line-through'
                  : 'text-ios-text'
              "
            >
              {{ order.orderNumber }}
            </span>
            <!-- Status Badge -->
            <span
              class="text-xs font-semibold px-2 py-0.5 rounded-full"
              :class="statusBadgeClass(order.status)"
            >
              {{ statusLabel(order.status) }}
            </span>
            <!-- Type Badge -->
            <span
              v-if="order.deliveryInfo?.type"
              class="text-xs font-semibold px-2 py-0.5 rounded-full bg-ios-bg"
              :class="
                order.status === 'cancelled'
                  ? 'text-ios-tertiary'
                  : 'text-ios-secondary'
              "
            >
              {{ typeLabel(order.deliveryInfo.type) }}
            </span>
          </div>
          <!-- Second line: table, items, cooking time -->
          <div
            class="flex items-center gap-2 text-xs text-ios-secondary flex-wrap"
          >
            <span v-if="order.tableName">{{ order.tableName }}</span>
            <span
              v-if="order.tableName && order.totalItems"
              class="text-ios-tertiary"
              >·</span
            >
            <span>{{ order.totalItems }} {{ t("common.items") }}</span>
            <span class="text-ios-tertiary">·</span>
            <span>{{ orderCookingTime(order) }} min</span>
          </div>
        </div>

        <!-- Right: timestamp -->
        <div class="text-xs text-ios-secondary flex-shrink-0 ml-3">
          {{ formatTime(order.createdAt) }}
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="flex flex-col items-center justify-center py-16">
      <Inbox class="w-12 h-12 text-ios-tertiary" />
      <p class="text-base font-semibold text-ios-text mt-4">
        {{ t("history.noRecords") }}
      </p>
      <p class="text-sm text-ios-secondary mt-1">
        {{ t("history.noRecordsHint") }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ArrowLeft, Inbox } from "lucide-vue-next";
import { useAuthStore } from "@/stores/auth";
import { useI18n } from "@/i18n";
import { kitchenApi } from "@/services/kitchenApi";
import type { KitchenOrder, OrderStatus } from "@/types";

// ── Auth ──────────────────────────────────────────────────────────────────────
const authStore = useAuthStore();
const { t, locale } = useI18n();

// ── Tab state ─────────────────────────────────────────────────────────────────
type TabKey = "today" | "yesterday" | "week";

const tabs = computed<{ key: TabKey; label: string }[]>(() => [
  { key: "today", label: t("history.today") },
  { key: "yesterday", label: t("history.yesterday") },
  { key: "week", label: t("history.thisWeek") },
]);

const activeTab = ref<TabKey>("today");

// ── Data ──────────────────────────────────────────────────────────────────────
const allOrders = ref<KitchenOrder[]>([]);
const loading = ref(true);
const loadError = ref("");

async function loadOrders() {
  const restaurantId = authStore.restaurantId;
  loadError.value = "";
  if (!restaurantId) {
    loading.value = false;
    loadError.value = t("myShifts.noRestaurant");
    return;
  }

  loading.value = true;
  try {
    const response = await kitchenApi.getOrders(restaurantId);
    if (response.success && response.data) {
      // Collect all orders from the three queues
      allOrders.value = [
        ...response.data.pending,
        ...response.data.preparing,
        ...response.data.ready,
      ];
    } else {
      loadError.value = t("history.loadFailed");
    }
  } catch (err) {
    console.error("Failed to fetch history orders:", err);
    loadError.value = t("history.loadFailed");
  } finally {
    loading.value = false;
  }
}

onMounted(loadOrders);

// ── Date helpers ──────────────────────────────────────────────────────────────
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function tabRange(): { from: Date; to: Date } {
  const now = new Date();
  if (activeTab.value === "today") {
    return { from: startOfDay(now), to: endOfDay(now) };
  }
  if (activeTab.value === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
  }
  // week: last 7 days
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 6);
  return { from: startOfDay(weekAgo), to: endOfDay(now) };
}

// ── Filtered orders ───────────────────────────────────────────────────────────
const filteredOrders = computed<KitchenOrder[]>(() => {
  const { from, to } = tabRange();
  return allOrders.value.filter((order) => {
    const ts = new Date(order.createdAt).getTime();
    return ts >= from.getTime() && ts <= to.getTime();
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────
const summary = computed(() => {
  const orders = filteredOrders.value;
  const total = orders.length;

  // Average cooking time (minutes) across all items that have start + end
  let totalCookSecs = 0;
  let cookCount = 0;
  orders.forEach((order) => {
    order.items.forEach((item) => {
      if (item.startedAt && item.completedAt) {
        const diff =
          (new Date(item.completedAt).getTime() -
            new Date(item.startedAt).getTime()) /
          60000;
        totalCookSecs += diff;
        cookCount++;
      }
    });
  });
  const avgCookingTime =
    cookCount > 0 ? Math.round(totalCookSecs / cookCount) : 0;

  // On-time rate: completed orders (delivered/paid) that were finished within estimatedTime
  const completedOrders = orders.filter(
    (o) => o.status === "delivered" || o.status === "paid",
  );
  const onTimeCount = completedOrders.filter((o) => {
    if (!o.estimatedTime || !o.confirmedAt) return false;
    const elapsed = (Date.now() - new Date(o.confirmedAt).getTime()) / 60000;
    return elapsed <= o.estimatedTime;
  }).length;
  const onTimeRate =
    completedOrders.length > 0
      ? Math.round((onTimeCount / completedOrders.length) * 100)
      : 0;

  return { total, avgCookingTime, onTimeRate };
});

// ── Per-order cooking time ────────────────────────────────────────────────────
function orderCookingTime(order: KitchenOrder): number {
  let total = 0;
  let count = 0;
  order.items.forEach((item) => {
    if (item.startedAt && item.completedAt) {
      total +=
        (new Date(item.completedAt).getTime() -
          new Date(item.startedAt).getTime()) /
        60000;
      count++;
    }
  });
  return count > 0 ? Math.round(total / count) : 0;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────
function statusLabel(status: OrderStatus): string {
  return statusLabels.value[status] ?? t("orderStatus.unknown");
}

const statusLabels = computed<Record<OrderStatus, string>>(() => ({
  pending: t("orderStatus.pending"),
  confirmed: t("orderStatus.confirmed"),
  preparing: t("orderStatus.preparing"),
  ready: t("orderStatus.ready"),
  delivered: t("orderStatus.served"),
  paid: t("orderStatus.paid"),
  cancelled: t("orderStatus.cancelled"),
  refunded: t("orderStatus.refunded"),
}));

function statusBadgeClass(status: OrderStatus): string {
  if (status === "cancelled" || status === "refunded")
    return "bg-ios-bg text-ios-tertiary";
  if (status === "ready" || status === "delivered" || status === "paid")
    return "bg-ios-green/10 text-ios-green";
  if (status === "preparing") return "bg-ios-orange/10 text-ios-orange";
  return "bg-ios-blue/10 text-ios-blue";
}

function typeLabel(type: string): string {
  return orderTypeLabels.value[type] ?? type;
}

const orderTypeLabels = computed<Record<string, string>>(() => ({
  dine_in: t("orderType.dineIn"),
  takeaway: t("orderType.takeaway"),
  delivery: t("orderType.delivery"),
}));

// ── Time formatter ────────────────────────────────────────────────────────────
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString(locale.value, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "--:--";
  }
}
</script>
