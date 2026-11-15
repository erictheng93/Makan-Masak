<template>
  <section
    class="rounded-2xl bg-white p-6 text-center shadow-card-sm"
    data-testid="module-unavailable"
    role="status"
  >
    <p class="text-base font-semibold text-ios-text">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
defineProps<{ message: string }>();
</script>
