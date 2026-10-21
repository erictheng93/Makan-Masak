<script setup lang="ts">
import type { KitchenOrder } from "@/types";
import DragDropOrderBoard from "./DragDropOrderBoard.vue";

// Accept same props as DragDropOrderBoard and pass through
// This is the named component from the spec (Section 12 Core Components)
interface Props {
  pendingOrders: KitchenOrder[];
  preparingOrders: KitchenOrder[];
  readyOrders: KitchenOrder[];
}

defineProps<Props>();

const emit = defineEmits<{
  "start-cooking": [orderId: string | number, itemId: number];
  "mark-ready": [orderId: string | number, itemId: number];
  "view-details": [order: KitchenOrder];
  "order-status-changed": [
    orderId: string | number,
    newStatus: "pending" | "preparing" | "ready",
  ];
  "batch-start-order": [orderId: string | number];
  "batch-complete-order": [orderId: string | number];
  "toggle-selection": [orderId: string | number];
}>();
</script>

<template>
  <div class="kanban-board h-full">
    <DragDropOrderBoard
      v-bind="$attrs"
      :pending-orders="pendingOrders"
      :preparing-orders="preparingOrders"
      :ready-orders="readyOrders"
      @start-cooking="
        (orderId, itemId) => emit('start-cooking', orderId, itemId)
      "
      @mark-ready="(orderId, itemId) => emit('mark-ready', orderId, itemId)"
      @view-details="(order) => emit('view-details', order)"
      @order-status-changed="
        (orderId, newStatus) => emit('order-status-changed', orderId, newStatus)
      "
      @batch-start-order="(orderId) => emit('batch-start-order', orderId)"
      @batch-complete-order="(orderId) => emit('batch-complete-order', orderId)"
      @toggle-selection="(orderId) => emit('toggle-selection', orderId)"
    />
  </div>
</template>
