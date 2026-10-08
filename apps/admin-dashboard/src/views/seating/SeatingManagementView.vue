<template>
  <div class="min-h-screen bg-ios-bg p-4 sm:p-6 space-y-6">
    <!-- Header -->
    <div class="flex justify-between items-center">
      <div>
        <h1 class="text-2xl font-bold text-ios-text">
          {{ t("seating.title") }}
        </h1>
        <p class="text-sm text-ios-text/50 mt-1">
          {{ t("seating.subtitle") }}
        </p>
      </div>
      <!-- No global CTA button — each tab has its own actions -->
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
      <div
        v-for="stat in statCards"
        :key="stat.label"
        class="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-transform hover:scale-[1.02]"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center"
            :class="stat.bgClass"
          >
            <component
              :is="stat.icon"
              class="w-5 h-5"
              :class="stat.iconClass"
            />
          </div>
          <div class="min-w-0">
            <p class="text-xs text-ios-text/50 truncate">{{ stat.label }}</p>
            <p class="text-xl font-bold" :class="stat.valueClass">
              {{ stat.value }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <nav class="flex overflow-x-auto border-b border-ios-bg px-4 sm:px-6">
        <router-link
          v-for="tab in tabs"
          :key="tab.name"
          :to="tab.path"
          class="flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors -mb-px"
          :class="
            isActiveTab(tab.path)
              ? 'border-ios-blue text-ios-blue'
              : 'border-transparent text-ios-text/40 hover:text-ios-text/70'
          "
          :data-active="isActiveTab(tab.path)"
        >
          <component :is="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
          <span
            v-if="tab.badge !== undefined && tab.badge > 0"
            class="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-ios-red text-white"
          >
            {{ tab.badge }}
          </span>
        </router-link>
      </nav>

      <!-- Tab Content -->
      <div class="p-4 sm:p-6">
        <router-view />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { ReservationService } from "@/services/reservationService";
import { WaitingListService } from "@/services/waitingListService";
import { createVisibilityAwarePoller } from "@/services/visibilityAwarePoller";
import { SEATING_CHANGED } from "./seatingEvents";
import {
  Calendar,
  CheckCircle,
  Clock,
  Timer,
  UtensilsCrossed,
  AlertCircle,
  Users,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  Table,
} from "lucide-vue-next";

const route = useRoute();
const { t } = useI18n();
const authStore = useAuthStore();

const reservationStats = ref({
  totalReservations: 0,
  confirmedCount: 0,
  completedCount: 0,
  noShowRate: 0,
});
const queueStatus = ref({
  totalWaiting: 0,
  averageWaitMinutes: 0,
  availableTables: 0,
});
const waitingStats = ref({
  totalServedToday: 0,
});

// Badge counts derived from stats
const pendingCount = computed(() => {
  const total = reservationStats.value.totalReservations;
  const confirmed = reservationStats.value.confirmedCount;
  const pending = total - confirmed;
  return pending > 0 ? pending : undefined;
});
const currentWaitingCount = computed(() => queueStatus.value.totalWaiting);

// Stats cards
const statCards = computed(() => [
  {
    label: t("seating.stats.todayReservations"),
    value: reservationStats.value.totalReservations,
    icon: Calendar,
    bgClass: "bg-blue-50",
    iconClass: "text-blue-600",
    valueClass: "text-blue-600",
  },
  {
    label: t("seating.stats.confirmed"),
    value: reservationStats.value.confirmedCount,
    icon: CheckCircle,
    bgClass: "bg-green-50",
    iconClass: "text-green-600",
    valueClass: "text-green-600",
  },
  {
    label: t("seating.stats.currentlyWaiting"),
    value: queueStatus.value.totalWaiting,
    icon: Clock,
    bgClass: "bg-orange-50",
    iconClass: "text-orange-600",
    valueClass: "text-orange-600",
  },
  {
    label: t("seating.stats.avgWaitTime"),
    value:
      typeof queueStatus.value.averageWaitMinutes === "number"
        ? queueStatus.value.averageWaitMinutes + " min"
        : "--",
    icon: Timer,
    bgClass: "bg-sky-50",
    iconClass: "text-sky-600",
    valueClass: "text-sky-600",
  },
  {
    label: t("seating.stats.availableTables"),
    value: queueStatus.value.availableTables,
    icon: UtensilsCrossed,
    bgClass: "bg-emerald-50",
    iconClass: "text-emerald-600",
    valueClass: "text-emerald-600",
  },
  {
    label: t("seating.stats.noShowRate"),
    value:
      typeof reservationStats.value.noShowRate === "number"
        ? reservationStats.value.noShowRate.toFixed(1) + "%"
        : "--",
    icon: AlertCircle,
    bgClass: "bg-red-50",
    iconClass: "text-red-600",
    valueClass: "text-red-600",
  },
  {
    label: t("seating.stats.todayServed"),
    value: waitingStats.value.totalServedToday,
    icon: Users,
    bgClass: "bg-teal-50",
    iconClass: "text-teal-600",
    valueClass: "text-teal-600",
  },
]);

// Tabs
const tabs = computed(() => {
  const allTabs = [];

  // Table Setup tab — Admin/Owner only
  if (authStore.canAccessAdminFeatures) {
    allTabs.push({
      name: "table-setup",
      path: "/dashboard/seating/table-setup",
      label: t("seating.tabs.tableSetup"),
      icon: Table,
    });
  }

  allTabs.push(
    {
      name: "reservations",
      path: "/dashboard/seating",
      label: t("seating.tabs.reservations"),
      icon: BookOpen,
      badge: pendingCount.value,
    },
    {
      name: "waiting-list",
      path: "/dashboard/seating/waiting-list",
      label: t("seating.tabs.waitingList"),
      icon: ClipboardList,
      badge: currentWaitingCount.value || undefined,
    },
    {
      name: "queue-dashboard",
      path: "/dashboard/seating/queue-dashboard",
      label: t("seating.tabs.queueDashboard"),
      icon: LayoutDashboard,
    },
  );

  return allTabs;
});

const isActiveTab = (path: string) => {
  // Exact match for reservations tab (don't match waiting-list or queue-dashboard routes)
  if (path === "/dashboard/seating") {
    return route.path === "/dashboard/seating";
  }
  return route.path === path || route.path.startsWith(path + "/");
};

async function loadStats() {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;

  try {
    const [resStats, qStatus, wStats] = await Promise.all([
      ReservationService.getStats(String(restaurantId)).catch(() => null),
      WaitingListService.getQueueStatus(String(restaurantId)).catch(() => null),
      WaitingListService.getStats(String(restaurantId)).catch(() => null),
    ]);

    if (resStats) {
      reservationStats.value = {
        totalReservations: resStats.totalReservations || 0,
        confirmedCount: resStats.confirmedCount || 0,
        completedCount: resStats.completedCount || 0,
        noShowRate: resStats.noShowRate || 0,
      };
    }

    if (qStatus) {
      queueStatus.value = {
        totalWaiting: qStatus.totalWaiting || 0,
        averageWaitMinutes: qStatus.averageWaitMinutes || 0,
        availableTables: qStatus.availableTables || 0,
      };
    }

    if (wStats) {
      waitingStats.value = {
        totalServedToday: wStats.seatedCount || 0,
      };
    }
  } catch (error) {
    console.error("Failed to load seating stats:", error);
  }
}

// Bookings, queue joins and table turnover all happen outside this page, and
// the tabs below mutate the same numbers, so the cards refresh on a timer, on
// every tab switch, and whenever a tab reports that it reloaded.
const statsPoller = createVisibilityAwarePoller({
  intervalMs: 30_000,
  onTick: loadStats,
});

watch(
  () => route.path,
  () => void loadStats(),
);

onMounted(() => {
  void loadStats();
  statsPoller.start();
  window.addEventListener(SEATING_CHANGED, loadStats);
});
onBeforeUnmount(() => {
  statsPoller.stop();
  window.removeEventListener(SEATING_CHANGED, loadStats);
});
</script>
