<template>
  <div
    ref="container"
    :style="{ height: containerHeight + 'px', overflowY: 'auto' }"
    class="virtual-grid-container grid gap-6"
    :class="gridCols"
    @scroll="handleScroll"
  >
    <!-- Virtual spacer for items before visible area -->
    <div
      v-if="beforeHeight > 0"
      :style="{
        height: beforeHeight + 'px',
        gridColumn: `1 / -1`,
      }"
    />

    <!-- Visible order cards -->
    <div
      v-for="order in visibleOrders"
      :key="order.id"
      :style="{ minHeight: itemHeight + 'px' }"
      class="virtual-grid-item"
    >
      <slot :order="order" :index="order._virtualIndex" />
    </div>

    <!-- Virtual spacer for items after visible area -->
    <div
      v-if="afterHeight > 0"
      :style="{
        height: afterHeight + 'px',
        gridColumn: `1 / -1`,
      }"
    />

    <!-- Loading indicator -->
    <div
      v-if="loading && hasMore"
      :style="{ height: itemHeight + 'px', gridColumn: `1 / -1` }"
      class="virtual-grid-loading"
    >
      <div class="flex items-center justify-center h-full">
        <div
          class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
        />
        <span class="ml-3 text-gray-600">{{ t("orders.loadMore") }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useI18n } from "@/i18n";
import type { KitchenOrder } from "@/types/index";
import { sameOrderId } from "@/utils/orderId";

const { t } = useI18n();

interface Props {
  orders: KitchenOrder[];
  itemHeight: number;
  containerHeight?: number;
  columnsCount?: number;
  bufferSize?: number;
  loading?: boolean;
  hasMore?: boolean;
  loadMore?: () => Promise<void>;
}

const props = withDefaults(defineProps<Props>(), {
  containerHeight: 600,
  columnsCount: 3,
  loadMore: () => Promise.resolve(),
  bufferSize: 3,
  loading: false,
  hasMore: false,
});

const emit = defineEmits<{
  "load-more": [];
}>();

// Refs
const container = ref<HTMLElement>();
const scrollTop = ref(0);
const isLoadingMore = ref(false);

// Computed properties
const totalOrders = computed(() => props.orders.length);
const rowsPerView = computed(() =>
  Math.ceil(props.containerHeight / props.itemHeight),
);
const totalRows = computed(() =>
  Math.ceil(totalOrders.value / props.columnsCount),
);

const gridCols = computed(() => {
  const colsMap: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    5: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
    6: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
  };
  return (
    colsMap[props.columnsCount] || "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
  );
});

const startRow = computed(() => {
  const row = Math.floor(scrollTop.value / props.itemHeight) - props.bufferSize;
  return Math.max(0, row);
});

const endRow = computed(() => {
  const row = startRow.value + rowsPerView.value + props.bufferSize * 2;
  return Math.min(totalRows.value - 1, row);
});

const visibleOrders = computed(() => {
  const startIndex = startRow.value * props.columnsCount;
  const endIndex = (endRow.value + 1) * props.columnsCount - 1;

  const orders = [];
  for (let i = startIndex; i <= endIndex && i < props.orders.length; i++) {
    if (props.orders[i]) {
      orders.push({
        ...props.orders[i],
        _virtualIndex: i,
      });
    }
  }
  return orders;
});

const beforeHeight = computed(() => startRow.value * props.itemHeight);
const afterHeight = computed(() => {
  const remaining = totalRows.value - endRow.value - 1;
  return Math.max(0, remaining * props.itemHeight);
});

// Methods
const handleScroll = async (event: Event) => {
  const target = event.target as HTMLElement;
  scrollTop.value = target.scrollTop;

  // Check if we need to load more items
  if (props.hasMore === true && !isLoadingMore.value) {
    const scrolledPercentage =
      (target.scrollTop + target.clientHeight) / target.scrollHeight;
    if (scrolledPercentage > 0.9) {
      // Load more when 90% scrolled
      await loadMoreItems();
    }
  }
};

const loadMoreItems = async () => {
  if (isLoadingMore.value) return;

  try {
    isLoadingMore.value = true;
    await props.loadMore();
    emit("load-more");
  } catch (error) {
    console.error("Error loading more kitchen orders:", error);
  } finally {
    isLoadingMore.value = false;
  }
};

const scrollToTop = (behavior: "auto" | "smooth" = "smooth") => {
  if (!container.value) return;

  container.value.scrollTo({
    top: 0,
    behavior,
  });
};

const scrollToBottom = (behavior: "auto" | "smooth" = "smooth") => {
  if (!container.value) return;

  container.value.scrollTo({
    top: container.value.scrollHeight,
    behavior,
  });
};

const scrollToOrder = (
  orderId: string | number,
  behavior: "auto" | "smooth" = "smooth",
) => {
  const orderIndex = props.orders.findIndex((order) =>
    sameOrderId(order.id, orderId),
  );
  if (orderIndex === -1 || !container.value) return;

  const row = Math.floor(orderIndex / props.columnsCount);
  const scrollPosition = row * props.itemHeight;

  container.value.scrollTo({
    top: scrollPosition,
    behavior,
  });
};

// Watch for orders changes and maintain scroll position
let previousOrdersLength = 0;
watch(
  () => props.orders.length,
  (newLength) => {
    const ordersAdded = newLength - previousOrdersLength;

    // If orders were prepended, adjust scroll position
    if (ordersAdded > 0 && previousOrdersLength > 0) {
      nextTick(() => {
        if (container.value) {
          const newRows = Math.ceil(ordersAdded / props.columnsCount);
          const newScrollTop = scrollTop.value + newRows * props.itemHeight;
          container.value.scrollTop = newScrollTop;
        }
      });
    }

    previousOrdersLength = newLength;
  },
);

// Lifecycle
onMounted(() => {
  if (container.value) {
    scrollTop.value = container.value.scrollTop;
  }
});

// Expose methods for parent components
defineExpose({
  scrollToTop,
  scrollToBottom,
  scrollToOrder,
  container,
});
</script>

<style scoped>
.virtual-grid-container {
  position: relative;
  box-sizing: border-box;
}

.virtual-grid-item {
  overflow: hidden;
  box-sizing: border-box;
}

.virtual-grid-loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Webkit scrollbar styling */
.virtual-grid-container::-webkit-scrollbar {
  width: 12px;
}

.virtual-grid-container::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 6px;
}

.virtual-grid-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 6px;
}

.virtual-grid-container::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
