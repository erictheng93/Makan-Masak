<template>
  <div
    v-if="navigationPending"
    class="nav-progress fixed inset-x-0 top-0 z-50 h-0.5 bg-ios-blue"
    aria-hidden="true"
    data-testid="navigation-progress"
  />
</template>

<script setup lang="ts">
import { navigationPending } from "@/utils/routeProgress";
</script>

<style scoped>
/* Delayed so cached navigations never flash the bar. */
.nav-progress {
  transform-origin: left;
  animation: nav-progress 8s cubic-bezier(0.1, 0.6, 0.2, 1) 120ms both;
}
@keyframes nav-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(0.95);
  }
}
</style>
