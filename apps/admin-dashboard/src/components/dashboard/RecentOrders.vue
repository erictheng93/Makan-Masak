<template>
  <div class="space-y-3">
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 5" :key="i" class="animate-pulse">
        <div
          class="flex items-center justify-between py-3 px-3 border rounded-lg"
        >
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 bg-gray-300 rounded-full" />
            <div class="space-y-2">
              <div class="h-4 bg-gray-300 rounded w-20" />
              <div class="h-3 bg-gray-300 rounded w-16" />
            </div>
          </div>
          <div class="space-y-2">
            <div class="h-4 bg-gray-300 rounded w-16" />
            <div class="h-3 bg-gray-300 rounded w-12" />
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="!orders || orders.length === 0"
      class="text-center py-8 text-gray-500"
    >
      <ShoppingCart class="w-16 h-16 mx-auto mb-4 text-gray-300" />
      <p>{{ t("dashboard.recentOrdersPanel.empty") }}</p>
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="order in orders.slice(0, maxOrders)"
        :key="order.id"
        class="flex items-center justify-between py-3 px-3 border rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all cursor-pointer"
        @click="$emit('orderClick', order)"
      >
        <div class="flex items-center space-x-3">
          <div class="flex-shrink-0">
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
              :class="getStatusColor(order.status).bg"
            >
              <component :is="getStatusIcon(order.status)" class="w-5 h-5" />
            </div>
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center space-x-2">
              <p class="text-sm font-medium text-gray-900">
                #{{ order.orderNumber }}
              </p>
              <span
                class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                :class="getStatusColor(order.status).text"
              >
                {{ getStatusText(order.status) }}
              </span>
            </div>
            <div class="flex items-center space-x-2 mt-1">
              <p class="text-xs text-gray-500">
                {{ t("dashboard.recentOrdersPanel.table") }}
                {{ order.tableNumber }}
              </p>
              <span class="text-gray-300">•</span>
              <p class="text-xs text-gray-500">
                {{ formatClockTime(order.createdAt) }}
              </p>
              <span v-if="order.itemCount" class="text-gray-300">•</span>
              <p v-if="order.itemCount" class="text-xs text-gray-500">
                {{
                  t("dashboard.recentOrdersPanel.items", {
                    count: order.itemCount,
                  })
                }}
              </p>
            </div>
          </div>
        </div>

        <div class="flex-shrink-0 text-right">
          <p class="text-sm font-semibold text-gray-900">
            {{ formatPrice(order.total) }}
          </p>
          <div class="flex items-center space-x-1 mt-1">
            <Clock class="w-3 h-3 text-gray-400" />
            <p class="text-xs text-gray-500">
              {{ getTimeElapsed(order.createdAt) }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="orders && orders.length > maxOrders" class="pt-2 text-center">
      <button
        class="text-sm text-primary-600 hover:text-primary-700 font-medium"
        @click="$emit('showMore')"
      >
        {{
          t("dashboard.recentOrdersPanel.showMore", {
            count: orders.length - maxOrders,
          })
        }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Remove unused computed import
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  ShoppingCart,
  Clock,
  CheckCircle,
  XCircle,
  Utensils,
  Package,
} from "lucide-vue-next";
import type { OrderStatus } from "@/types";

interface RecentOrder {
  id: string;
  orderNumber: string;
  tableNumber: string;
  status: OrderStatus;
  total: number;
  itemCount?: number;
  createdAt: string;
}

interface RecentOrdersProps {
  orders?: RecentOrder[];
  loading?: boolean;
  maxOrders?: number;
}

withDefaults(defineProps<RecentOrdersProps>(), {
  orders: () => [],
  loading: false,
  maxOrders: 10,
});

defineEmits<{
  orderClick: [order: RecentOrder];
  showMore: [];
}>();

const { t } = useI18n();
const { formatPrice } = useCurrency();
const { formatTime, formatRelativeTime } = useDateFormatter();

// createdAt is an ISO datetime, and formatTime reads a string as an "HH:mm"
// time of day, so it has to be a Date before it goes in.
const formatClockTime = (dateString: string) =>
  formatTime(new Date(dateString));

const getStatusColor = (status: OrderStatus) => {
  const colorMap: Record<OrderStatus, { bg: string; text: string }> = {
    pending: {
      bg: "bg-yellow-500",
      text: "bg-yellow-100 text-yellow-800",
    },
    confirmed: {
      bg: "bg-blue-500",
      text: "bg-blue-100 text-blue-800",
    },
    preparing: {
      bg: "bg-orange-500",
      text: "bg-orange-100 text-orange-800",
    },
    ready: {
      bg: "bg-teal-500",
      text: "bg-teal-100 text-teal-800",
    },
    delivered: {
      bg: "bg-green-500",
      text: "bg-green-100 text-green-800",
    },
    paid: {
      bg: "bg-teal-500",
      text: "bg-teal-100 text-teal-800",
    },
    cancelled: {
      bg: "bg-red-500",
      text: "bg-red-100 text-red-800",
    },
    refunded: {
      bg: "bg-gray-500",
      text: "bg-gray-100 text-gray-800",
    },
  };
  return colorMap[status] ?? colorMap.pending;
};

const getStatusIcon = (status: OrderStatus) => {
  const iconMap: Record<OrderStatus, typeof Clock> = {
    pending: Clock,
    confirmed: CheckCircle,
    preparing: Utensils,
    ready: Package,
    delivered: CheckCircle,
    paid: CheckCircle,
    cancelled: XCircle,
    refunded: XCircle,
  };
  return iconMap[status] ?? Clock;
};

const getStatusText = (status: OrderStatus) => {
  return (
    t(`dashboard.recentOrdersPanel.status.${status}`) ||
    t("dashboard.recentOrdersPanel.status.unknown")
  );
};

const getTimeElapsed = (dateString: string) =>
  formatRelativeTime(new Date(dateString));
</script>
