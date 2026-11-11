<template>
  <div
    ref="container"
    :style="{ height: containerHeight + 'px', overflowY: 'auto' }"
    class="virtual-menu-grid-container grid gap-6"
    data-testid="menu-grid-container"
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

    <!-- Visible menu item cards -->
    <div
      v-for="menuItem in visibleMenuItems"
      :key="menuItem.id"
      :style="{ minHeight: itemHeight + 'px' }"
      :data-row="Math.floor(menuItem._virtualIndex / columns)"
      class="virtual-grid-item"
      data-testid="menu-grid-item"
    >
      <slot :menu-item="menuItem" :index="menuItem._virtualIndex" />
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
      v-if="loading"
      :style="{ height: itemHeight + 'px', gridColumn: `1 / -1` }"
      class="virtual-grid-loading"
    >
      <div class="flex items-center justify-center h-full">
        <div
          class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
        />
        <span class="ml-3 text-gray-600">{{ t("common.loading") }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export interface VirtualMenuGridProps<T extends { id: number }> {
  menuItems: T[];
  itemHeight: number;
  containerHeight?: number;
  columnsCount?: number;
  bufferSize?: number;
  loading?: boolean;
}

export interface VirtualMenuGridInstance {
  scrollToTop: (behavior?: "auto" | "smooth") => void;
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
  scrollToMenuItem: (menuItemId: number, behavior?: "auto" | "smooth") => void;
  container: HTMLElement | undefined;
}
</script>

<script setup lang="ts" generic="T extends { id: number }">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUpdated,
  onBeforeUnmount,
  nextTick,
} from "vue";
import { useI18n } from "@/i18n";

const { t } = useI18n();

type MenuItemWithIndex = T & {
  _virtualIndex: number;
};

const props = withDefaults(defineProps<VirtualMenuGridProps<T>>(), {
  containerHeight: 600,
  columnsCount: 4,
  bufferSize: 3,
  loading: false,
});

// Refs
const container = ref<HTMLElement>();
const scrollTop = ref(0);

// The props are only estimates: the column count follows the breakpoint and a
// card's height follows its width and content. Scrolling by the estimates made
// every card jump whenever the first rendered row changed, so rows are measured
// as they render; rows not seen yet stand in at the average of those that were.
const columns = ref(props.columnsCount);
const rowGap = ref(0);
const measuredRows = ref(new Map<number, number>());
let measuredWidth = -1;
const measure = () => {
  const element = container.value;
  if (!element) return;
  const style = getComputedStyle(element);
  const tracks = style.gridTemplateColumns.split(" ").filter(Boolean).length;
  const cols =
    style.display === "grid" && tracks > 0 ? tracks : props.columnsCount;
  const gap = parseFloat(style.rowGap) || 0;
  if (
    cols !== columns.value ||
    gap !== rowGap.value ||
    element.clientWidth !== measuredWidth
  ) {
    // A new width reflows every card, so earlier measurements no longer hold.
    columns.value = cols;
    rowGap.value = gap;
    measuredWidth = element.clientWidth;
    measuredRows.value = new Map();
    nextTick(measure);
    return;
  }
  const next = new Map(measuredRows.value);
  let changed = false;
  element
    .querySelectorAll<HTMLElement>(".virtual-grid-item")
    .forEach((cell) => {
      const row = Number(cell.dataset.row);
      if (cell.offsetHeight > 0 && next.get(row) !== cell.offsetHeight) {
        next.set(row, cell.offsetHeight);
        changed = true;
      }
    });
  if (changed) measuredRows.value = next;
};
let resizeObserver: ResizeObserver | undefined;

// Computed properties
const totalMenuItems = computed(() => props.menuItems.length);
const totalRows = computed(() =>
  Math.ceil(totalMenuItems.value / columns.value),
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
    colsMap[props.columnsCount] ||
    "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
  );
});

const estimatedRowHeight = computed(() => {
  const heights = [...measuredRows.value.values()];
  return heights.length
    ? heights.reduce((sum, height) => sum + height, 0) / heights.length
    : props.itemHeight;
});

// rowTops[r] is where row r starts; the extra last entry closes the list.
const rowTops = computed(() => {
  const tops: number[] = [0];
  for (let row = 0; row < totalRows.value; row++)
    tops.push(
      tops[row] +
        (measuredRows.value.get(row) ?? estimatedRowHeight.value) +
        rowGap.value,
    );
  return tops;
});

const firstVisibleRow = computed(() => {
  let row = 0;
  while (row < totalRows.value - 1 && rowTops.value[row + 1] <= scrollTop.value)
    row++;
  return row;
});

const startRow = computed(() =>
  Math.max(0, firstVisibleRow.value - props.bufferSize),
);

const endRow = computed(() => {
  const bottom = scrollTop.value + props.containerHeight;
  let row = firstVisibleRow.value;
  while (row < totalRows.value - 1 && rowTops.value[row + 1] < bottom) row++;
  return Math.min(totalRows.value - 1, row + props.bufferSize);
});

const visibleMenuItems = computed(() => {
  const startIndex = startRow.value * columns.value;
  const endIndex = (endRow.value + 1) * columns.value - 1;

  const items: MenuItemWithIndex[] = [];
  for (let i = startIndex; i <= endIndex && i < props.menuItems.length; i++) {
    if (props.menuItems[i]) {
      items.push({
        ...props.menuItems[i],
        _virtualIndex: i,
      });
    }
  }
  return items;
});

// Each spacer is itself a grid row, so the gap beside it is part of the
// distance it stands in for.
const beforeHeight = computed(() =>
  Math.max(0, rowTops.value[startRow.value] - rowGap.value),
);
const afterHeight = computed(() =>
  Math.max(
    0,
    rowTops.value[totalRows.value] -
      (rowTops.value[endRow.value + 1] ?? 0) -
      rowGap.value,
  ),
);

// Methods
const handleScroll = (event: Event) => {
  const target = event.target as HTMLElement;
  scrollTop.value = target.scrollTop;
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

const scrollToMenuItem = (
  menuItemId: number,
  behavior: "auto" | "smooth" = "smooth",
) => {
  const itemIndex = props.menuItems.findIndex((item) => item.id === menuItemId);
  if (itemIndex === -1 || !container.value) return;

  const row = Math.floor(itemIndex / columns.value);
  const scrollPosition = rowTops.value[row] ?? 0;

  container.value.scrollTo({
    top: scrollPosition,
    behavior,
  });
};

// Watch for menuItems changes and maintain scroll position
let previousMenuItemsLength = 0;
watch(
  () => props.menuItems.length,
  (newLength) => {
    const itemsAdded = newLength - previousMenuItemsLength;

    // If items were prepended, adjust scroll position
    if (itemsAdded > 0 && previousMenuItemsLength > 0) {
      nextTick(() => {
        if (container.value) {
          const newRows = Math.ceil(itemsAdded / columns.value);
          const newScrollTop =
            scrollTop.value +
            newRows * (estimatedRowHeight.value + rowGap.value);
          container.value.scrollTop = newScrollTop;
        }
      });
    }

    previousMenuItemsLength = newLength;
  },
);

// Lifecycle
onMounted(() => {
  if (container.value) {
    scrollTop.value = container.value.scrollTop;
    measure();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(container.value);
    }
  }
});

onUpdated(measure);
onBeforeUnmount(() => resizeObserver?.disconnect());

// Expose methods for parent components
// NOTE: the public contract is VirtualMenuGridInstance (exported above).
// defineExpose is left untyped because its generic form does not unwrap the
// `container` ref, which would conflict with the unwrapped consumer-facing type.
defineExpose({
  scrollToTop,
  scrollToBottom,
  scrollToMenuItem,
  container,
});
</script>

<style scoped>
.virtual-menu-grid-container {
  position: relative;
  box-sizing: border-box;
  /* Rows take their card's height; the fixed container height would
     otherwise hold them at the minimum and clip the card's action row. */
  grid-auto-rows: max-content;
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
.virtual-menu-grid-container::-webkit-scrollbar {
  width: 12px;
}

.virtual-menu-grid-container::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 6px;
}

.virtual-menu-grid-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 6px;
}

.virtual-menu-grid-container::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
