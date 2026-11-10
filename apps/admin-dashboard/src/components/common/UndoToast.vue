<template>
  <div class="flex items-center justify-between gap-4">
    <span>{{ message }}</span>
    <button
      type="button"
      class="shrink-0 rounded-full bg-white/20 px-3 py-1 text-[13px] font-semibold hover:bg-white/30 transition-colors"
      data-testid="undo-toast-action"
      @click="$emit('undo')"
    >
      {{ label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ message: string; label: string }>();
defineEmits<{ undo: [] }>();
</script>
