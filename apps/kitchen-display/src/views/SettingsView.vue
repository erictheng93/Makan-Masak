<template>
  <div class="bg-ios-bg min-h-screen">
    <!-- Header -->
    <div class="px-4 pt-6 pb-2 flex items-center gap-3">
      <button
        class="w-11 h-11 rounded-full bg-white shadow-card-sm flex items-center justify-center flex-shrink-0"
        @click="$router.back()"
      >
        <ArrowLeft class="w-5 h-5 text-ios-text" />
      </button>
      <h1 class="text-2xl font-extrabold text-ios-text">
        {{ t("settings.title") }}
      </h1>
      <div class="flex-1" />
      <button
        class="text-ios-red text-sm font-semibold"
        @click="resetToDefaults"
      >
        {{ t("settings.restoreDefaults") }}
      </button>
    </div>

    <!-- Content -->
    <div class="px-4 pb-10 max-w-2xl mx-auto">
      <!-- Section: 顯示 -->
      <div
        class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
      >
        {{ t("settings.display") }}
      </div>
      <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
        <!-- Font Size Segmented Control -->
        <div
          class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg"
        >
          <span class="text-[15px] font-medium text-ios-text">{{
            t("settings.fontSize")
          }}</span>
          <div class="bg-ios-bg rounded-full p-0.5 inline-flex gap-0.5">
            <button
              v-for="opt in fontSizeOptions"
              :key="opt.value"
              class="px-3 py-1 text-sm rounded-full transition-all duration-200"
              :class="
                settings.fontSize === opt.value
                  ? 'bg-white shadow-card-sm font-semibold text-ios-text'
                  : 'text-ios-secondary font-medium'
              "
              @click="setFontSize(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Show Customer Names -->
        <div
          class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg"
        >
          <span class="text-[15px] font-medium text-ios-text">{{
            t("settings.showCustomerName")
          }}</span>
          <button
            class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0"
            :class="settings.showCustomerNames ? 'bg-ios-green' : 'bg-ios-bg'"
            @click="toggleCustomerNames"
          >
            <span
              class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
              :class="
                settings.showCustomerNames
                  ? 'translate-x-[18px]'
                  : 'translate-x-[2px]'
              "
            />
          </button>
        </div>

        <!-- Show Estimated Time -->
        <div class="flex items-center justify-between py-3.5 px-4">
          <span class="text-[15px] font-medium text-ios-text">{{
            t("settings.showEstimatedTime")
          }}</span>
          <button
            class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0"
            :class="settings.showEstimatedTime ? 'bg-ios-green' : 'bg-ios-bg'"
            @click="toggleEstimatedTime"
          >
            <span
              class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
              :class="
                settings.showEstimatedTime
                  ? 'translate-x-[18px]'
                  : 'translate-x-[2px]'
              "
            />
          </button>
        </div>
      </div>

      <!-- Section: 音效 -->
      <div
        class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
      >
        {{ t("settings.audio") }}
      </div>
      <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
        <!-- Sound Notifications Toggle -->
        <div
          class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg"
        >
          <span class="text-[15px] font-medium text-ios-text">{{
            t("settings.audioNotifications")
          }}</span>
          <button
            class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0"
            :class="settings.audioEnabled ? 'bg-ios-green' : 'bg-ios-bg'"
            @click="toggleAudio"
          >
            <span
              class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
              :class="
                settings.audioEnabled
                  ? 'translate-x-[18px]'
                  : 'translate-x-[2px]'
              "
            />
          </button>
        </div>

        <!-- Volume Slider -->
        <div class="py-3.5 px-4 border-b border-ios-bg">
          <div class="flex items-center justify-between mb-2.5">
            <span class="text-[15px] font-medium text-ios-text">{{
              t("settings.volume")
            }}</span>
            <span class="text-[15px] font-medium text-ios-secondary"
              >{{ settings.soundVolume }}%</span
            >
          </div>
          <div class="relative h-5 flex items-center">
            <div class="h-1 rounded-full bg-ios-bg w-full overflow-hidden">
              <div
                class="h-full rounded-full bg-ios-blue transition-all duration-150"
                :style="{ width: settings.soundVolume + '%' }"
              />
            </div>
            <input
              v-model.number="settings.soundVolume"
              type="range"
              min="0"
              max="100"
              step="5"
              class="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
              :disabled="!settings.audioEnabled"
              @input="onVolumeInput"
            />
            <div
              class="absolute w-5 h-5 rounded-full bg-white shadow-card pointer-events-none"
              :style="{ left: 'calc(' + settings.soundVolume + '% - 10px)' }"
            />
          </div>
        </div>

        <!-- Notification Sound Disclosure -->
        <div
          class="flex items-center justify-between py-3.5 px-4 cursor-pointer active:bg-ios-bg transition-colors"
          @click="showSoundPicker = true"
        >
          <span class="text-[15px] font-medium text-ios-text">{{
            t("settings.notificationSound")
          }}</span>
          <div class="flex items-center gap-1.5 text-ios-secondary">
            <span class="text-[15px]">{{ t("settings.soundDefault") }}</span>
            <ChevronRight class="w-4 h-4" />
          </div>
        </div>
      </div>

      <!-- Section: 時間門檻 -->
      <div
        class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
      >
        {{ t("settings.timeThresholds") }}
      </div>
      <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
        <!-- Urgent Threshold Disclosure -->
        <div
          class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg cursor-pointer active:bg-ios-bg transition-colors"
          @click="showUrgentPicker = true"
        >
          <span class="text-[15px] font-medium text-ios-text">{{
            t("settings.urgentTime")
          }}</span>
          <div class="flex items-center gap-1.5">
            <span class="text-[15px] font-medium text-ios-red"
              >{{ settings.urgentThreshold }} {{ t("common.minutes") }}</span
            >
            <ChevronRight class="w-4 h-4 text-ios-secondary" />
          </div>
        </div>

        <!-- Auto-Refresh Interval Disclosure -->
        <div
          class="flex items-center justify-between py-3.5 px-4 cursor-pointer active:bg-ios-bg transition-colors"
          @click="showRefreshPicker = true"
        >
          <span class="text-[15px] font-medium text-ios-text">{{
            t("settings.autoRefreshInterval")
          }}</span>
          <div class="flex items-center gap-1.5">
            <span class="text-[15px] font-medium text-ios-blue"
              >{{ settings.refreshInterval }} {{ t("common.seconds") }}</span
            >
            <ChevronRight class="w-4 h-4 text-ios-secondary" />
          </div>
        </div>
      </div>
    </div>

    <!-- Urgent Threshold Picker Sheet -->
    <Transition name="sheet">
      <div
        v-if="showUrgentPicker"
        class="fixed inset-0 z-50 flex items-end"
        @click.self="showUrgentPicker = false"
      >
        <div
          class="absolute inset-0 bg-black/30"
          @click="showUrgentPicker = false"
        />
        <div
          class="relative w-full bg-white rounded-t-3xl shadow-card-lg px-4 pt-5 pb-8"
        >
          <div class="flex items-center justify-between mb-4">
            <span class="text-lg font-bold text-ios-text">{{
              t("settings.urgentTime")
            }}</span>
            <button
              class="text-ios-blue font-semibold text-[15px]"
              @click="showUrgentPicker = false"
            >
              {{ t("common.done") }}
            </button>
          </div>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="val in urgentOptions"
              :key="val"
              class="py-2.5 rounded-full text-sm font-semibold transition-all duration-200"
              :class="
                settings.urgentThreshold === val
                  ? 'bg-ios-red text-white'
                  : 'bg-ios-bg text-ios-secondary'
              "
              @click="setUrgentThreshold(val)"
            >
              {{ val }} {{ t("settings.min") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Refresh Interval Picker Sheet -->
    <Transition name="sheet">
      <div
        v-if="showRefreshPicker"
        class="fixed inset-0 z-50 flex items-end"
        @click.self="showRefreshPicker = false"
      >
        <div
          class="absolute inset-0 bg-black/30"
          @click="showRefreshPicker = false"
        />
        <div
          class="relative w-full bg-white rounded-t-3xl shadow-card-lg px-4 pt-5 pb-8"
        >
          <div class="flex items-center justify-between mb-4">
            <span class="text-lg font-bold text-ios-text">{{
              t("settings.autoRefreshInterval")
            }}</span>
            <button
              class="text-ios-blue font-semibold text-[15px]"
              @click="showRefreshPicker = false"
            >
              {{ t("common.done") }}
            </button>
          </div>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="val in refreshOptions"
              :key="val"
              class="py-2.5 rounded-full text-sm font-semibold transition-all duration-200"
              :class="
                settings.refreshInterval === val
                  ? 'bg-ios-blue text-white'
                  : 'bg-ios-bg text-ios-secondary'
              "
              @click="setRefreshInterval(val)"
            >
              {{ val }} {{ t("common.seconds") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Sound Picker Sheet -->
    <Transition name="sheet">
      <div
        v-if="showSoundPicker"
        class="fixed inset-0 z-50 flex items-end"
        @click.self="showSoundPicker = false"
      >
        <div
          class="absolute inset-0 bg-black/30"
          @click="showSoundPicker = false"
        />
        <div
          class="relative w-full bg-white rounded-t-3xl shadow-card-lg px-4 pt-5 pb-8"
        >
          <div class="flex items-center justify-between mb-4">
            <span class="text-lg font-bold text-ios-text">{{
              t("settings.notificationSound")
            }}</span>
            <button
              class="text-ios-blue font-semibold text-[15px]"
              @click="showSoundPicker = false"
            >
              {{ t("common.done") }}
            </button>
          </div>
          <div class="space-y-1">
            <div
              v-for="sound in soundOptions"
              :key="sound.value"
              class="flex items-center justify-between py-3 px-4 rounded-2xl cursor-pointer transition-colors"
              :class="
                selectedSound === sound.value
                  ? 'bg-ios-blue/10'
                  : 'active:bg-ios-bg'
              "
              @click="selectedSound = sound.value"
            >
              <span class="text-[15px] font-medium text-ios-text">{{
                sound.label
              }}</span>
              <Check
                v-if="selectedSound === sound.value"
                class="w-5 h-5 text-ios-blue"
              />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import { ArrowLeft, ChevronRight, Check } from "lucide-vue-next";
import { useSettingsStore } from "@/stores/settings";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useI18n } from "@/i18n";
import { storeToRefs } from "pinia";

const settingsStore = useSettingsStore();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
const { t } = useI18n();
const { settings: storeSettings } = storeToRefs(settingsStore);

// Create reactive copy of settings
const settings = reactive({ ...storeSettings.value });

// UI state
const showUrgentPicker = ref(false);
const showRefreshPicker = ref(false);
const showSoundPicker = ref(false);
const selectedSound = ref("default");

// Options
const fontSizeOptions = computed(() => [
  { value: "normal" as const, label: t("settings.fontNormal") },
  { value: "large" as const, label: t("settings.fontLarge") },
  { value: "extra-large" as const, label: t("settings.fontExtraLarge") },
]);

const urgentOptions = [5, 10, 15, 20, 25, 30, 45, 60];
const refreshOptions = [5, 10, 15, 20, 30, 45, 60, 120];

const soundOptions = computed(() => [
  { value: "default", label: t("settings.soundDefault") },
  { value: "chime", label: t("settings.soundCrisp") },
  { value: "bell", label: t("settings.soundBell") },
  { value: "ping", label: t("settings.soundChime") },
]);

const toggleAudio = () => {
  settings.audioEnabled = !settings.audioEnabled;
  settingsStore.toggleAudio();
};

const toggleCustomerNames = () => {
  settings.showCustomerNames = !settings.showCustomerNames;
  settingsStore.toggleCustomerNames();
};

const toggleEstimatedTime = () => {
  settings.showEstimatedTime = !settings.showEstimatedTime;
  settingsStore.toggleEstimatedTime();
};

const setFontSize = (size: "normal" | "large" | "extra-large") => {
  settings.fontSize = size;
  settingsStore.setFontSize(size);
};

const onVolumeInput = () => {
  settingsStore.setSoundVolume(settings.soundVolume);
};

const setUrgentThreshold = (val: number) => {
  settings.urgentThreshold = val;
  settingsStore.setUrgentThreshold(val);
  showUrgentPicker.value = false;
};

const setRefreshInterval = (val: number) => {
  settings.refreshInterval = val;
  settingsStore.setRefreshInterval(val);
  showRefreshPicker.value = false;
};

const resetToDefaults = async () => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("settings.restoreConfirmTitle"),
    message: t("settings.restoreConfirmMessage"),
    confirmLabel: t("settings.restoreConfirmLabel"),
  });
  if (!confirmed) return;

  settingsStore.resetSettings();
  Object.assign(settings, storeSettings.value);
  toast.success(t("settings.restoredSuccess"));
};
</script>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.25s ease;
}
.sheet-enter-active > div:last-child,
.sheet-leave-active > div:last-child {
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from > div:last-child,
.sheet-leave-to > div:last-child {
  transform: translateY(100%);
}
</style>
