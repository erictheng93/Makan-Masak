<template>
  <Transition name="fade">
    <div
      v-if="show"
      class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
      @click="$emit('close')"
    >
      <div
        class="bg-white rounded-2xl shadow-card-lg max-w-[480px] w-full mx-4 p-6 max-h-[80vh] flex flex-col"
        @click.stop
      >
        <!-- Header -->
        <div class="flex items-center justify-between mb-4 shrink-0">
          <h2 class="text-xl font-extrabold text-ios-text">
            {{ t("shortcuts.title") }}
          </h2>
          <button
            :aria-label="t('common.close')"
            class="w-11 h-11 rounded-full bg-ios-bg flex items-center justify-center text-ios-secondary hover:text-ios-text active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            @click="$emit('close')"
          >
            <XIcon class="w-5 h-5" />
          </button>
        </div>

        <!-- Scrollable Content -->
        <div class="overflow-y-auto flex-1 -mx-1 px-1">
          <!-- Groups -->
          <div v-for="group in filteredGroups" :key="group.category">
            <p
              class="text-xs font-semibold text-ios-secondary uppercase mt-4 mb-2 tracking-wide"
            >
              {{ group.title }}
            </p>

            <div class="space-y-0.5">
              <div
                v-for="shortcut in group.shortcuts"
                :key="shortcut.id"
                class="flex items-center justify-between py-2"
              >
                <span class="text-sm text-ios-secondary">{{
                  shortcut.description
                }}</span>
                <div class="flex items-center gap-1 ml-4">
                  <kbd
                    v-for="(key, index) in shortcut.keys"
                    :key="index"
                    class="bg-ios-bg rounded-lg px-2 py-1 font-mono text-sm text-ios-text"
                  >
                    {{ formatKey(key) }}
                  </kbd>
                </div>
              </div>
            </div>
          </div>

          <!-- No results -->
          <div
            v-if="filteredGroups.length === 0"
            class="text-center py-8 text-ios-secondary"
          >
            <KeyboardIcon class="w-12 h-12 mx-auto mb-3 text-ios-separator" />
            <p class="text-base font-medium">{{ t("shortcuts.noMatch") }}</p>
          </div>
        </div>

        <!-- Tips Footer -->
        <div class="mt-4 pt-4 border-t border-ios-separator shrink-0">
          <p class="text-xs text-ios-secondary text-center">
            {{ t("shortcuts.helpTip") }}
            <kbd
              class="bg-ios-bg rounded px-1.5 py-0.5 font-mono text-xs text-ios-text"
              >?</kbd
            >
            {{ t("shortcuts.helpTipEnd") }}
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "@/i18n";
import { XIcon, KeyboardIcon } from "lucide-vue-next";

const { t } = useI18n();
import { useKeyboardShortcuts } from "@/composables/useKeyboardShortcuts";
import type { ShortcutGroup } from "@/composables/useKeyboardShortcuts";

// Props
interface Props {
  show: boolean;
}

defineProps<Props>();

// Emits
const _emit = defineEmits<{
  close: [];
}>();

// Composables
const { shortcutGroups } = useKeyboardShortcuts();

// Computed — show all groups (no search in simplified design)
const filteredGroups = computed((): ShortcutGroup[] => {
  return shortcutGroups.value.filter(
    (g: ShortcutGroup) =>
      ["orders", "navigation", "system"].includes(g.category) &&
      g.shortcuts.length > 0,
  );
});

// Methods
const formatKey = (key: string): string => {
  const symbols: Record<string, string> = {
    Ctrl: "⌃",
    Cmd: "⌘",
    Alt: "⌥",
    Shift: "⇧",
    Space: "Space",
    Enter: "↵",
    Tab: "⇥",
    Escape: "Esc",
    Backspace: "⌫",
    Delete: "⌦",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };

  return symbols[key] || key;
};
</script>

<style scoped>
/* Fade animation */
.fade-enter-active {
  transition: opacity 200ms ease-out;
}

.fade-leave-active {
  transition: opacity 150ms ease-in;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

kbd {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo,
    monospace;
}
</style>
