<template>
  <div
    :class="[
      'draggable-order-card relative transition-all duration-200 cursor-grab active:cursor-grabbing',
      { 'opacity-50 scale-95': isDragging },
      { 'ring-2 ring-ios-blue ring-opacity-50 rounded-2xl': isSelected },
    ]"
    :data-order-id="order.id"
    :data-status="statusType"
  >
    <!-- Drag Handle (visible on hover) -->
    <div
      class="drag-handle absolute top-2 right-2 z-10 text-ios-label-tertiary hover:text-ios-label-secondary transition-colors"
    >
      <GripVertical class="w-4 h-4" />
    </div>

    <!-- Selection Checkbox (visible on hover) -->
    <div class="select-checkbox absolute top-2 left-2 z-10">
      <input
        :checked="isSelected"
        type="checkbox"
        class="w-4 h-4 accent-ios-blue rounded focus:ring-ios-blue focus:ring-2"
        @change="$emit('toggle-selection', order.id)"
        @click.stop
      />
    </div>

    <!-- OrderCard renders the actual card UI -->
    <OrderCard
      :order="order"
      :status-type="statusType"
      @start-cooking="
        (orderId, itemId) => $emit('start-cooking', orderId, itemId)
      "
      @mark-ready="(orderId, itemId) => $emit('mark-ready', orderId, itemId)"
      @view-details="$emit('view-details', order)"
    />
  </div>
</template>

<script setup lang="ts">
import { GripVertical } from "lucide-vue-next";
import type { KitchenOrder } from "@/types";
import OrderCard from "./OrderCard.vue";

// Props
interface Props {
  order: KitchenOrder;
  statusType: "pending" | "preparing" | "ready";
  isDragging?: boolean;
  isDragOver?: boolean;
  isSelected?: boolean;
}

withDefaults(defineProps<Props>(), {
  isDragging: false,
  isDragOver: false,
  isSelected: false,
});

// Emits
defineEmits<{
  "start-cooking": [orderId: string | number, itemId: number];
  "mark-ready": [orderId: string | number, itemId: number];
  "view-details": [order: KitchenOrder];
  "toggle-selection": [orderId: string | number];
}>();
</script>

<style scoped>
.drag-handle {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.select-checkbox {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.draggable-order-card:hover .drag-handle,
.draggable-order-card:hover .select-checkbox {
  opacity: 1;
}
</style>
