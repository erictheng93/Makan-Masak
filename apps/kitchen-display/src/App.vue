<template>
  <div id="app" class="min-h-screen bg-ios-bg">
    <!-- Global Error Boundary -->
    <ErrorBoundary>
      <!-- 主要內容 -->
      <router-view />

      <!-- 音效控制 -->
      <button
        data-testid="kitchen-audio-toggle"
        :data-audio-enabled="audioEnabled ? 'true' : 'false'"
        class="audio-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
        :title="
          audioEnabled
            ? t('shortcuts.audioToggleOff')
            : t('shortcuts.audioToggleOn')
        "
        :aria-label="
          audioEnabled
            ? t('shortcuts.audioToggleOff')
            : t('shortcuts.audioToggleOn')
        "
        @click="toggleAudio"
      >
        <component
          :is="audioEnabled ? SpeakerWaveIcon : SpeakerXMarkIcon"
          class="w-6 h-6 text-gray-600"
        />
      </button>

      <!-- 鍵盤快捷鍵幫助（可選顯示） -->
      <div
        v-if="showKeyboardHelp"
        class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        @click="showKeyboardHelp = false"
      >
        <div class="bg-white rounded-xl p-6 max-w-md w-full">
          <h3 class="text-lg font-semibold mb-4">{{ t("shortcuts.title") }}</h3>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span>{{ t("shortcuts.markComplete") }}</span>
              <span class="keyboard-hint">Space</span>
            </div>
            <div class="flex justify-between">
              <span>{{ t("shortcuts.startPreparing") }}</span>
              <span class="keyboard-hint">Enter</span>
            </div>
            <div class="flex justify-between">
              <span>{{ t("shortcuts.audioToggle") }}</span>
              <span class="keyboard-hint">M</span>
            </div>
            <div class="flex justify-between">
              <span>{{ t("shortcuts.fullscreen") }}</span>
              <span class="keyboard-hint">F</span>
            </div>
            <div class="flex justify-between">
              <span>{{ t("shortcuts.help") }}</span>
              <span class="keyboard-hint">?</span>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>

    <!-- 全域確認彈窗 -->
    <ConfirmModal />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import {
  Volume2 as SpeakerWaveIcon,
  VolumeX as SpeakerXMarkIcon,
} from "lucide-vue-next";
import { useI18n } from "@/i18n";

const { t } = useI18n();
import { useSettingsStore } from "@/stores/settings";
import { storeToRefs } from "pinia";
import ErrorBoundary from "@/components/error/ErrorBoundary.vue";
import ConfirmModal from "@/components/common/ConfirmModal.vue";
import { useGlobalErrorHandler } from "@/composables/useErrorHandling";

// Store
const settingsStore = useSettingsStore();
const { audioEnabled } = storeToRefs(settingsStore);

// Global error handling
const { setupGlobalHandlers } = useGlobalErrorHandler();

// Local state
const showKeyboardHelp = ref(false);

// Methods
const toggleAudio = () => {
  settingsStore.toggleAudio();
};

// Keyboard shortcuts
const handleKeyDown = (event: KeyboardEvent) => {
  // 避免在輸入框中觸發快捷鍵
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return;
  }

  switch (event.key) {
    case "m":
    case "M":
      event.preventDefault();
      toggleAudio();
      break;
    case "?":
      event.preventDefault();
      showKeyboardHelp.value = !showKeyboardHelp.value;
      break;
    case "f":
    case "F":
      event.preventDefault();
      // 全屏切換
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
      break;
    case "Escape":
      showKeyboardHelp.value = false;
      break;
  }
};

// 生命週期
onMounted(() => {
  document.addEventListener("keydown", handleKeyDown);
  // Setup global error handlers
  setupGlobalHandlers();
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeyDown);
});
</script>
