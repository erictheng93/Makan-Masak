<template>
  <div
    :data-testid="`kitchen-order-card-${order.id}`"
    :class="[
      'relative overflow-hidden rounded-2xl transition-transform duration-150 ease-spring active:scale-[0.97]',
      isUrgent
        ? 'bg-ios-red-soft border-t-[6px] border-ios-red shadow-[0_4px_20px_rgba(255,59,48,0.08)] animate-urgent-pulse'
        : isCancelled
          ? 'bg-white shadow-card opacity-45 ' + statusBorderClass
          : 'bg-white shadow-card ' + statusBorderClass,
    ]"
  >
    <!-- URGENT corner badge -->
    <div
      v-if="isUrgent"
      class="absolute top-0 right-0 bg-ios-red text-white text-xs font-extrabold px-2.5 py-1 rounded-bl-xl tracking-wide"
    >
      URGENT
    </div>

    <div class="p-4">
      <!-- Row 1: Order number + Table number -->
      <div class="flex items-center justify-between mb-2">
        <span
          :class="[
            'text-xl font-extrabold text-ios-text',
            isCancelled && 'line-through',
          ]"
        >
          {{ order.orderNumber }}
        </span>
        <span v-if="order.tableName" class="text-lg font-bold text-ios-blue">
          {{ t("orders.table") }} {{ displayTableName }}
        </span>
      </div>

      <!-- Row 2: Badges + Elapsed time -->
      <div class="flex items-center justify-between mb-3 flex-wrap gap-y-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          <!-- Order type badge -->
          <span
            :style="{
              backgroundColor: orderTypeBadge.bg,
              color: orderTypeBadge.text,
            }"
            class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
          >
            {{ orderTypeBadge.emoji }} {{ orderTypeBadge.label }}
          </span>

          <!-- Platform badge (only if not direct) -->
          <span
            v-if="order.orderSource && order.orderSource !== 'direct'"
            :style="{
              backgroundColor: platformBadge.bg,
              color: platformBadge.text,
            }"
            class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
          >
            {{ platformBadge.emoji }} {{ platformBadge.label }}
          </span>
        </div>

        <!-- Elapsed time -->
        <div class="text-right">
          <div :class="elapsedTimeClass">
            {{ formatElapsedTime(order.elapsedTime) }}
          </div>
          <div class="text-xs text-ios-secondary">
            {{ formatOrderTime(order.createdAt) }}
          </div>
        </div>
      </div>

      <!-- Customer info -->
      <div v-if="order.customerName && showCustomerNames" class="mb-3">
        <div class="flex items-center gap-1.5 text-sm text-ios-secondary">
          <UserIcon class="w-4 h-4 shrink-0" />
          <span>{{ order.customerName }}</span>
        </div>
      </div>

      <!-- Item list -->
      <div class="mb-4 divide-y divide-ios-bg">
        <div
          v-for="item in order.items"
          :key="item.id"
          class="py-2 first:pt-0 last:pb-0"
        >
          <div class="flex items-center justify-between">
            <!-- Item name + quantity + status icon -->
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="text-base font-medium text-ios-text truncate">
                {{ item.name }}
              </span>
              <span class="text-sm text-ios-secondary shrink-0">
                ×{{ item.quantity }}
              </span>
              <component
                :is="getItemStatusIcon(item.status)"
                :class="getItemStatusClass(item.status)"
                class="w-4 h-4 shrink-0"
              />
            </div>

            <!-- Per-item action + estimated time -->
            <div class="flex items-center gap-2 ml-3 shrink-0">
              <div
                v-if="item.estimatedTime && showEstimatedTime"
                class="flex flex-col items-center text-ios-secondary"
              >
                <ClockIcon class="w-4 h-4" />
                <span class="text-xs"
                  >{{ item.estimatedTime }}{{ t("time.min") }}</span
                >
              </div>

              <button
                v-if="item.status === 'pending'"
                class="min-h-[44px] px-3 py-1 rounded-full bg-ios-blue text-white text-sm font-semibold"
                :data-testid="`kitchen-item-start-${order.id}-${item.id}`"
                :title="t('orders.startPreparing')"
                @click.stop="handleStartCooking(item.id)"
              >
                {{ t("orders.startItem") }}
              </button>
              <button
                v-else-if="item.status === 'preparing'"
                class="min-h-[44px] px-3 py-1 rounded-full bg-ios-green text-white text-sm font-semibold"
                :data-testid="`kitchen-item-ready-${order.id}-${item.id}`"
                :title="t('orders.markComplete')"
                @click.stop="handleMarkReady(item.id)"
              >
                {{ t("orders.completeItem") }}
              </button>
              <span
                v-else-if="item.status === 'ready'"
                class="text-sm px-3 py-1 rounded-full bg-ios-bg text-ios-secondary font-semibold"
              >
                {{ t("orders.itemCompleted") }}
              </span>
            </div>
          </div>

          <!-- Item notes -->
          <div
            v-if="item.notes"
            class="mt-1.5 flex items-start gap-1.5 bg-ios-orange-soft rounded-lg px-2 py-1.5"
          >
            <ZapIcon class="w-3.5 h-3.5 text-ios-orange-deep shrink-0 mt-0.5" />
            <span class="text-sm text-ios-orange-deep">{{ item.notes }}</span>
          </div>

          <!-- Customizations -->
          <div
            v-if="item.customizations && item.customizations.length"
            class="mt-1 text-sm text-ios-blue"
          >
            <span class="font-medium">{{ t("orders.customization") }}</span>
            {{ item.customizations.join("、") }}
          </div>
        </div>
      </div>

      <!-- Order notes -->
      <div
        v-if="order.notes"
        class="mb-4 flex items-start gap-2 bg-ios-orange-soft rounded-lg p-2"
      >
        <ZapIcon class="w-4 h-4 text-ios-orange-deep shrink-0 mt-0.5" />
        <span class="text-sm text-ios-orange-deep">{{ order.notes }}</span>
      </div>

      <!-- Delivery info -->
      <div
        v-if="order.deliveryInfo?.type === 'delivery'"
        class="mb-4 p-3 bg-ios-blue-soft rounded-xl text-sm text-ios-blue-deep space-y-1"
      >
        <div class="font-semibold">{{ t("orders.deliveryInfo") }}</div>
        <div v-if="order.deliveryInfo.address">
          📍 {{ order.deliveryInfo.address }}
        </div>
        <div v-if="order.deliveryInfo.phone">
          📞 {{ order.deliveryInfo.phone }}
        </div>
        <div v-if="order.deliveryInfo.instructions" class="italic opacity-80">
          💬 {{ order.deliveryInfo.instructions }}
        </div>
      </div>
      <div
        v-else-if="order.deliveryInfo?.type === 'takeaway'"
        class="mb-4 p-3 bg-ios-orange-soft rounded-xl text-sm text-ios-orange-deep font-semibold"
      >
        {{ t("orders.takeawayNote") }}
      </div>

      <!-- Progress bar (preparing orders with estimated time) -->
      <div
        v-if="statusType === 'preparing' && order.estimatedTime"
        class="mb-4"
      >
        <div class="flex justify-between text-xs text-ios-secondary mb-1">
          <span>{{ t("orders.progress") }}</span>
          <span>{{ getProgressPercentage(order) }}%</span>
        </div>
        <div class="w-full bg-ios-bg rounded-full h-1.5">
          <div
            class="bg-ios-blue h-1.5 rounded-full transition-all duration-300"
            :style="{ width: `${getProgressPercentage(order)}%` }"
          />
        </div>
      </div>

      <!-- Action footer -->
      <div class="flex items-center justify-between gap-2">
        <!-- Primary action button (full-width pill) -->
        <button
          v-if="statusType === 'pending'"
          class="flex-1 min-h-[44px] rounded-full py-3 font-bold text-white bg-ios-blue flex items-center justify-center gap-2"
          :data-testid="`kitchen-order-start-${order.id}`"
          @click="handleStartAll"
        >
          <PlayIcon class="w-4 h-4" />
          {{ t("orders.startPreparing") }}
        </button>
        <button
          v-else-if="statusType === 'preparing'"
          class="flex-1 min-h-[44px] rounded-full py-3 font-bold text-white bg-ios-green flex items-center justify-center gap-2"
          :data-testid="`kitchen-order-ready-${order.id}`"
          @click="handleMarkAllReady"
        >
          <CheckIcon class="w-4 h-4" />
          {{ t("orders.markCompleteBtn") }}
        </button>
        <div
          v-else-if="statusType === 'ready'"
          class="flex-1 min-h-[44px] rounded-full py-3 font-bold text-ios-secondary bg-ios-bg flex items-center justify-center"
        >
          {{ t("orders.served") }}
        </div>

        <!-- Secondary: view details + keyboard hint -->
        <div class="flex items-center gap-2 shrink-0">
          <button
            class="w-11 h-11 rounded-full bg-ios-bg flex items-center justify-center text-ios-secondary hover:text-ios-text transition-colors"
            :title="t('orders.viewDetails')"
            @click="$emit('view-details', order)"
          >
            <EyeIcon class="w-5 h-5" />
          </button>
          <div v-if="keyboardShortcuts" class="text-xs text-ios-tertiary">
            <span
              class="px-1.5 py-0.5 bg-ios-bg rounded text-ios-secondary font-mono"
              >Space</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  UserIcon,
  ClockIcon,
  PlayIcon,
  CheckIcon,
  EyeIcon,
  ZapIcon,
  CheckCircleIcon,
  FlameIcon,
} from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "@/i18n";
import { useSettingsStore } from "@/stores/settings";
import type { KitchenOrder } from "@/types";
import { storeToRefs } from "pinia";

// Props
interface Props {
  order: KitchenOrder;
  statusType: "pending" | "preparing" | "ready";
}

const props = defineProps<Props>();

const { t, locale } = useI18n();

// Emits
const emit = defineEmits<{
  "start-cooking": [orderId: string | number, itemId: number];
  "mark-ready": [orderId: string | number, itemId: number];
  "view-details": [order: KitchenOrder];
}>();

// Settings
const settingsStore = useSettingsStore();
const {
  showEstimatedTime,
  showCustomerNames,
  keyboardShortcuts,
  urgentThreshold,
} = storeToRefs(settingsStore);

// Derived state
const isUrgent = computed(() => props.order.priority === "urgent");
const isCancelled = computed(() => props.order.status === "cancelled");

// Strip translated table prefixes only when they are followed by a separator,
// so names like "Tabletop" or "桌子" remain intact.
const displayTableName = computed(() => {
  const name = props.order.tableName ?? "";
  return name.replace(/^(Table|桌)[\s-]+/i, "");
});

const statusBorderClass = computed(() => {
  if (props.order.status === "cancelled")
    return "border-t-4 border-ios-secondary";
  const map: Record<string, string> = {
    pending: "border-t-4 border-ios-orange",
    preparing: "border-t-4 border-ios-blue",
    ready: "border-t-4 border-ios-green",
  };
  return map[props.statusType] || "border-t-4 border-ios-orange";
});

// Order Type Badge
const orderTypeBadge = computed(() => {
  const type = props.order.deliveryInfo?.type ?? "dine_in";
  const badges: Record<
    string,
    { label: string; emoji: string; bg: string; text: string }
  > = {
    dine_in: {
      label: t("orderType.dineIn"),
      emoji: "🪑",
      bg: "#E3F2FD",
      text: "#007AFF",
    },
    takeaway: {
      label: t("orderType.takeaway"),
      emoji: "🛍️",
      bg: "#FFF3E0",
      text: "#FF9500",
    },
    delivery: {
      label: t("orderType.delivery"),
      emoji: "🛵",
      bg: "#E8EAF6",
      text: "#283593",
    },
  };
  return badges[type] || badges.dine_in;
});

// Platform Source Badge
const platformBadge = computed(() => {
  const source = props.order.orderSource ?? "direct";
  const badges: Record<
    string,
    { label: string; emoji: string; bg: string; text: string }
  > = {
    uber_eats: {
      label: t("platform.uberEats"),
      emoji: "🟢",
      bg: "#E8F5E9",
      text: "#004D40",
    },
    foodpanda: {
      label: t("platform.foodpanda"),
      emoji: "🦋",
      bg: "#FFEBEE",
      text: "#B71C1C",
    },
    grabfood: {
      label: t("platform.grabFood"),
      emoji: "🟠",
      bg: "#E8F5E9",
      text: "#1B5E20",
    },
    market_checkout: {
      label: t("platform.marketCheckout"),
      emoji: "🏮",
      bg: "#FFF3E0",
      text: "#E65100",
    },
    direct: {
      label: t("platform.direct"),
      emoji: "📦",
      bg: "#F2F2F7",
      text: "#1C1C1E",
    },
  };
  return (
    badges[source] || {
      label: source,
      emoji: "📦",
      bg: "#F2F2F7",
      text: "#1C1C1E",
    }
  );
});

// Elapsed time class
const elapsedTimeClass = computed(() => {
  if (isUrgent.value || props.order.elapsedTime >= urgentThreshold.value) {
    return "text-ios-red font-extrabold text-sm";
  }
  if (props.statusType === "preparing") {
    return "text-ios-blue font-semibold text-sm";
  }
  return "text-ios-secondary text-sm";
});

// Item status icon (using lucide-vue-next equivalents)
const getItemStatusIcon = (status: string) => {
  const icons: Record<string, unknown> = {
    pending: ClockIcon,
    preparing: FlameIcon,
    ready: CheckCircleIcon,
    completed: CheckCircleIcon,
  };
  return icons[status] || ClockIcon;
};

const getItemStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    pending: "text-ios-orange",
    preparing: "text-ios-blue",
    ready: "text-ios-green",
    completed: "text-ios-green",
  };
  return classes[status] || "text-ios-secondary";
};

const getProgressPercentage = (order: KitchenOrder) => {
  if (!order.estimatedTime) return 0;
  return Math.min(
    100,
    Math.round((order.elapsedTime / order.estimatedTime) * 100),
  );
};

// Methods
const formatElapsedTime = (minutes: number) => {
  if (minutes < 60) {
    return `${minutes}${t("time.minutes")}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}${t("time.hour")}${remainingMinutes}${t("time.min")}`;
};

const formatOrderTime = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const handleStartCooking = (itemId: number) => {
  emit("start-cooking", props.order.id, itemId);
};

const handleMarkReady = (itemId: number) => {
  emit("mark-ready", props.order.id, itemId);
};

const handleStartAll = () => {
  props.order.items
    .filter((item) => item.status === "pending")
    .forEach((item) => {
      emit("start-cooking", props.order.id, item.id);
    });
};

const handleMarkAllReady = () => {
  props.order.items
    .filter((item) => item.status === "preparing")
    .forEach((item) => {
      emit("mark-ready", props.order.id, item.id);
    });
};
</script>
