<template>
  <Transition
    enter-active-class="transition-all duration-250 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="visibleConflicts.length > 0"
      class="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden"
    >
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-ios-bg">
        <AlertTriangle class="w-4 h-4 text-ios-orange shrink-0" />
        <span class="text-xs font-semibold text-ios-text">
          排班警告 ({{ visibleConflicts.length }})
        </span>
        <button
          class="ml-auto text-xs text-ios-text/40 hover:text-ios-text/70 transition-colors"
          @click="dismissAll"
        >
          全部關閉
        </button>
      </div>

      <div class="flex flex-wrap gap-2 px-4 py-3">
        <div
          v-for="(conflict, idx) in visibleConflicts"
          :key="idx"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
          :class="
            conflict.severity === 'error'
              ? 'bg-ios-red/10 text-ios-red'
              : 'bg-ios-orange/10 text-ios-orange'
          "
        >
          <component
            :is="conflict.severity === 'error' ? AlertCircle : AlertTriangle"
            class="w-3 h-3 shrink-0"
          />
          <span>{{ conflict.message }}</span>
          <button
            class="ml-1 hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :title="'關閉'"
            :aria-label="'關閉'"
            @click="dismiss(idx)"
          >
            <X class="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { AlertTriangle, AlertCircle, X } from "lucide-vue-next";

interface Conflict {
  type: string;
  message: string;
  severity: "warning" | "error";
}

const props = defineProps<{
  conflicts: Conflict[];
}>();

// Local dismissed set to allow per-item dismiss
const dismissed = ref<Set<number>>(new Set());

// When conflicts change (new week load), reset dismissed
watch(
  () => props.conflicts,
  () => {
    dismissed.value = new Set();
  },
);

const visibleConflicts = computed(() =>
  props.conflicts.filter((_, i) => !dismissed.value.has(i)),
);

function dismiss(idx: number) {
  dismissed.value = new Set([...dismissed.value, idx]);
}

function dismissAll() {
  dismissed.value = new Set(props.conflicts.map((_, i) => i));
}
</script>
