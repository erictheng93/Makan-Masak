<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        class="fixed inset-0 bg-black/30 z-50"
        @click="$emit('close')"
      />
    </Transition>

    <Transition name="slide-up">
      <div
        v-if="show"
        class="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-50 max-h-[90vh] flex flex-col"
        @click.stop
      >
        <!-- Drag Handle -->
        <div class="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div class="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <!-- Header -->
        <div class="px-5 pt-3 pb-4 flex-shrink-0">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3 flex-wrap">
                <h2 class="text-2xl font-extrabold text-ios-text">
                  {{ order.orderNumber }}
                </h2>
                <span :class="getOrderTypeBadgeClass(order.deliveryInfo?.type)">
                  {{ getOrderTypeText(order.deliveryInfo?.type) }}
                </span>
              </div>
              <p class="text-sm text-ios-secondary mt-1">
                {{ order.tableName }}
                <span class="mx-1.5">·</span>
                {{ formatTime(order.createdAt) }}
                <span class="mx-1.5">·</span>
                <span :class="getTimeClass(order.elapsedTime)">
                  {{ t("orders.waiting") }}
                  {{ formatElapsedTime(order.elapsedTime) }}
                </span>
              </p>
            </div>
            <button
              class="w-11 h-11 rounded-full bg-ios-bg flex items-center justify-center flex-shrink-0 ml-3"
              @click="$emit('close')"
            >
              <XIcon class="w-5 h-5 text-ios-secondary" />
            </button>
          </div>
        </div>

        <!-- Scrollable Content -->
        <div class="flex-1 overflow-y-auto px-5 space-y-4 pb-6">
          <!-- Order Items -->
          <div class="bg-ios-bg rounded-2xl overflow-hidden">
            <div
              v-for="(item, index) in order.items"
              :key="item.id"
              :class="[
                'px-4 py-3.5',
                index < order.items.length - 1
                  ? 'border-b border-white/60'
                  : '',
              ]"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-base font-semibold text-ios-text">
                      {{ item.name }}
                    </span>
                    <span :class="getItemStatusClass(item.status)">
                      {{ getItemStatusText(item.status) }}
                    </span>
                  </div>

                  <!-- Customization notes -->
                  <div v-if="item.notes" class="mt-1 text-ios-orange text-sm">
                    {{ t("orders.notes") }} {{ item.notes }}
                  </div>
                  <div
                    v-if="item.customizations && item.customizations.length"
                    class="mt-1 text-ios-orange text-sm"
                  >
                    {{ t("orders.customization") }}
                    {{ item.customizations.join(", ") }}
                  </div>

                  <!-- Item timestamps -->
                  <div
                    v-if="item.startedAt || item.completedAt"
                    class="mt-1 flex gap-3 text-xs text-ios-secondary"
                  >
                    <span v-if="item.startedAt">
                      {{ t("orders.startTimestamp") }}
                      {{ formatTime(item.startedAt) }}
                    </span>
                    <span v-if="item.completedAt" class="text-ios-green">
                      {{ t("orders.completeTimestamp") }}
                      {{ formatTime(item.completedAt) }}
                    </span>
                  </div>
                </div>

                <!-- Quantity + Item Actions -->
                <div class="flex items-center gap-2 flex-shrink-0">
                  <span class="text-base font-semibold text-ios-text">
                    x{{ item.quantity }}
                  </span>
                  <button
                    v-if="item.status === 'pending'"
                    class="rounded-full px-3 py-1.5 text-sm font-semibold bg-ios-blue text-white"
                    @click="updateItemStatus(item.id, 'preparing')"
                  >
                    {{ t("orders.startItem") }}
                  </button>
                  <button
                    v-else-if="item.status === 'preparing'"
                    class="rounded-full px-3 py-1.5 text-sm font-semibold bg-ios-green text-white"
                    @click="updateItemStatus(item.id, 'ready')"
                  >
                    {{ t("orders.completeItem") }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Order Notes -->
          <div
            v-if="order.notes"
            class="bg-ios-orange-soft rounded-xl p-3 flex items-start gap-2"
          >
            <ZapIcon
              class="w-4 h-4 text-ios-orange-deep flex-shrink-0 mt-0.5"
            />
            <p class="text-ios-orange-deep text-sm font-medium">
              {{ order.notes }}
            </p>
          </div>
        </div>

        <!-- Action Button -->
        <div class="px-5 pb-8 pt-3 flex-shrink-0">
          <button
            v-if="hasUncompletedItems"
            class="w-full rounded-full py-4 font-bold text-white bg-ios-blue text-base"
            @click="markAllComplete"
          >
            {{
              hasPendingItems ? t("orders.startAll") : t("orders.completeAll")
            }}
          </button>
          <button
            v-else
            class="w-full rounded-full py-4 font-bold text-white bg-ios-green text-base"
            @click="$emit('close')"
          >
            {{ t("orders.completeAll") }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { XIcon, ZapIcon } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import type { KitchenOrder, ItemStatus } from "@/types";

const { t, locale } = useI18n();

interface Props {
  order: KitchenOrder;
  show: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "update-status": [
    orderId: string | number,
    itemId: number,
    status: ItemStatus,
  ];
}>();

// Computed
const hasUncompletedItems = computed(() => {
  return props.order.items.some(
    (item) => item.status !== "ready" && item.status !== "completed",
  );
});

const hasPendingItems = computed(() =>
  props.order.items.some((item) => item.status === "pending"),
);

// Methods
const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

const formatElapsedTime = (minutes: number) => {
  if (minutes < 60) {
    return `${minutes}${t("time.minutes")}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}${t("time.hour")}${remainingMinutes}${t("time.min")}`;
};

const getTimeClass = (elapsedMinutes: number) => {
  if (elapsedMinutes >= 15) {
    return "font-bold text-ios-red";
  } else if (elapsedMinutes >= 10) {
    return "font-bold text-ios-orange";
  }
  return "font-medium text-ios-text";
};

const getOrderTypeText = (type?: string) => {
  const texts: Record<string, string> = {
    dine_in: t("orderType.dineIn"),
    takeout: t("orderType.takeaway"),
    delivery: t("orderType.delivery"),
  };
  return texts[type ?? ""] ?? t("orderType.dineIn");
};

const getOrderTypeBadgeClass = (type?: string) => {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold";
  const colors: Record<string, string> = {
    dine_in: `${base} bg-blue-100 text-ios-blue`,
    takeout: `${base} bg-orange-100 text-ios-orange`,
    delivery: `${base} bg-teal-100 text-teal-700`,
  };
  return colors[type ?? ""] ?? `${base} bg-blue-100 text-ios-blue`;
};

const getItemStatusClass = (status: ItemStatus) => {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";
  const classes: Record<string, string> = {
    pending: `${base} bg-gray-100 text-gray-600`,
    preparing: `${base} bg-blue-100 text-ios-blue`,
    ready: `${base} bg-green-100 text-ios-green`,
    completed: `${base} bg-green-100 text-ios-green`,
  };
  return classes[status] ?? classes.pending;
};

const getItemStatusText = (status: ItemStatus) => {
  const texts: Record<string, string> = {
    pending: t("itemStatus.pending"),
    preparing: t("itemStatus.preparing"),
    ready: t("itemStatus.completed"),
    completed: t("itemStatus.served"),
  };
  return texts[status] ?? t("itemStatus.unknown");
};

const updateItemStatus = (itemId: number, status: ItemStatus) => {
  emit("update-status", props.order.id, itemId, status);
};

const markAllComplete = () => {
  props.order.items
    .filter((item) => item.status !== "ready" && item.status !== "completed")
    .forEach((item) => {
      emit(
        "update-status",
        props.order.id,
        item.id,
        item.status === "pending" ? "preparing" : "ready",
      );
    });
};
</script>

<style scoped>
/* Fade transition for overlay */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 250ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Slide-up transition for bottom sheet */
.slide-up-enter-active {
  transition: transform 350ms ease-out;
}
.slide-up-leave-active {
  transition: transform 300ms ease-in;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
