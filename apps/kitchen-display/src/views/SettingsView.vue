<template>
  <div class="kitchen-page ui-page bg-ios-bg min-h-screen">
    <!-- Header -->
    <div class="kitchen-page-heading ui-page-heading px-4 pt-6 pb-4">
      <button
        :aria-label="t('common.back')"
        class="w-11 h-11 rounded-full bg-white shadow-card-sm flex items-center justify-center flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
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
            :aria-label="t('settings.showCustomerName')"
            role="switch"
            :aria-checked="settings.showCustomerNames"
            class="kitchen-switch w-[44px] h-11 rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :class="settings.showCustomerNames ? 'bg-green-700' : 'bg-ios-bg'"
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
            :aria-label="t('settings.showEstimatedTime')"
            role="switch"
            :aria-checked="settings.showEstimatedTime"
            class="kitchen-switch w-[44px] h-11 rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :class="settings.showEstimatedTime ? 'bg-green-700' : 'bg-ios-bg'"
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
            :aria-label="t('settings.audioNotifications')"
            role="switch"
            :aria-checked="settings.audioEnabled"
            class="kitchen-switch w-[44px] h-11 rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :class="settings.audioEnabled ? 'bg-green-700' : 'bg-ios-bg'"
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
          <div class="relative h-11 flex items-center">
            <div class="h-1 rounded-full bg-ios-bg w-full overflow-hidden">
              <div
                class="h-full rounded-full bg-blue-700 transition-all duration-150"
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
              :aria-label="t('settings.volume')"
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
        <button
          type="button"
          class="w-full text-left flex items-center justify-between py-3.5 px-4 cursor-pointer active:bg-ios-bg transition-colors"
          @click="showSoundPicker = true"
        >
          <span class="text-[15px] font-medium text-ios-text">{{
            t("settings.notificationSound")
          }}</span>
          <div class="flex items-center gap-1.5 text-ios-secondary">
            <span class="text-[15px]">{{ t("settings.soundDefault") }}</span>
            <ChevronRight class="w-4 h-4" />
          </div>
        </button>
      </div>

      <!-- Section: 時間門檻 -->
      <div
        class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
      >
        {{ t("settings.timeThresholds") }}
      </div>
      <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
        <!-- Urgent Threshold Disclosure -->
        <button
          type="button"
          class="w-full text-left flex items-center justify-between py-3.5 px-4 border-b border-ios-bg cursor-pointer active:bg-ios-bg transition-colors"
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
        </button>

        <!-- Auto-Refresh Interval Disclosure -->
        <button
          type="button"
          class="w-full text-left flex items-center justify-between py-3.5 px-4 cursor-pointer active:bg-ios-bg transition-colors"
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
        </button>
      </div>
    </div>

    <!-- Urgent Threshold Picker Sheet -->
    <TransitionRoot
      as="template"
      :show="showUrgentPicker"
      appear
      @after-leave="restorePickerFocus"
    >
      <Dialog
        class="fixed inset-0 z-50 flex items-end"
        @close="showUrgentPicker = false"
      >
        <TransitionChild
          as="template"
          enter="transition-opacity duration-200 ease-out"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="transition-opacity duration-200 ease-in"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div
            class="absolute inset-0 bg-black/30"
            @click="showUrgentPicker = false"
          />
        </TransitionChild>
        <TransitionChild
          as="template"
          enter="transition-transform duration-300 ease-out"
          enter-from="translate-y-full"
          enter-to="translate-y-0"
          leave="transition-transform duration-200 ease-in"
          leave-from="translate-y-0"
          leave-to="translate-y-full"
        >
          <DialogPanel
            class="relative w-full bg-white rounded-t-3xl sm:rounded-3xl sm:max-w-2xl sm:mx-auto shadow-card-lg px-5 pt-5 pb-8 max-h-[90dvh] overflow-y-auto"
          >
            <div class="flex items-center justify-between mb-4">
              <DialogTitle as="h2" class="text-lg font-bold text-ios-text">{{
                t("settings.urgentTime")
              }}</DialogTitle>
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
                    ? 'bg-red-700 text-white'
                    : 'bg-ios-bg text-ios-secondary'
                "
                @click="setUrgentThreshold(val)"
              >
                {{ val }} {{ t("settings.min") }}
              </button>
            </div>
          </DialogPanel>
        </TransitionChild>
      </Dialog>
    </TransitionRoot>

    <!-- Refresh Interval Picker Sheet -->
    <TransitionRoot
      as="template"
      :show="showRefreshPicker"
      appear
      @after-leave="restorePickerFocus"
    >
      <Dialog
        class="fixed inset-0 z-50 flex items-end"
        @close="showRefreshPicker = false"
      >
        <TransitionChild
          as="template"
          enter="transition-opacity duration-200 ease-out"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="transition-opacity duration-200 ease-in"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div
            class="absolute inset-0 bg-black/30"
            @click="showRefreshPicker = false"
          />
        </TransitionChild>
        <TransitionChild
          as="template"
          enter="transition-transform duration-300 ease-out"
          enter-from="translate-y-full"
          enter-to="translate-y-0"
          leave="transition-transform duration-200 ease-in"
          leave-from="translate-y-0"
          leave-to="translate-y-full"
        >
          <DialogPanel
            class="relative w-full bg-white rounded-t-3xl sm:rounded-3xl sm:max-w-2xl sm:mx-auto shadow-card-lg px-5 pt-5 pb-8 max-h-[90dvh] overflow-y-auto"
          >
            <div class="flex items-center justify-between mb-4">
              <DialogTitle as="h2" class="text-lg font-bold text-ios-text">{{
                t("settings.autoRefreshInterval")
              }}</DialogTitle>
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
                    ? 'bg-blue-700 text-white'
                    : 'bg-ios-bg text-ios-secondary'
                "
                @click="setRefreshInterval(val)"
              >
                {{ val }} {{ t("common.seconds") }}
              </button>
            </div>
          </DialogPanel>
        </TransitionChild>
      </Dialog>
    </TransitionRoot>

    <!-- Sound Picker Sheet -->
    <TransitionRoot
      as="template"
      :show="showSoundPicker"
      appear
      @after-leave="restorePickerFocus"
    >
      <Dialog
        class="fixed inset-0 z-50 flex items-end"
        @close="showSoundPicker = false"
      >
        <TransitionChild
          as="template"
          enter="transition-opacity duration-200 ease-out"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="transition-opacity duration-200 ease-in"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div
            class="absolute inset-0 bg-black/30"
            @click="showSoundPicker = false"
          />
        </TransitionChild>
        <TransitionChild
          as="template"
          enter="transition-transform duration-300 ease-out"
          enter-from="translate-y-full"
          enter-to="translate-y-0"
          leave="transition-transform duration-200 ease-in"
          leave-from="translate-y-0"
          leave-to="translate-y-full"
        >
          <DialogPanel
            class="relative w-full bg-white rounded-t-3xl sm:rounded-3xl sm:max-w-2xl sm:mx-auto shadow-card-lg px-5 pt-5 pb-8 max-h-[90dvh] overflow-y-auto"
          >
            <div class="flex items-center justify-between mb-4">
              <DialogTitle as="h2" class="text-lg font-bold text-ios-text">{{
                t("settings.notificationSound")
              }}</DialogTitle>
              <button
                class="text-ios-blue font-semibold text-[15px]"
                @click="showSoundPicker = false"
              >
                {{ t("common.done") }}
              </button>
            </div>
            <div class="space-y-1">
              <button
                v-for="sound in soundOptions"
                :key="sound.value"
                type="button"
                class="w-full text-left flex items-center justify-between py-3 px-4 rounded-2xl cursor-pointer transition-colors"
                :class="
                  selectedSound === sound.value
                    ? 'bg-ios-blue/10'
                    : 'active:bg-ios-bg'
                "
                :aria-pressed="selectedSound === sound.value"
                @click="selectedSound = sound.value"
              >
                <span class="text-[15px] font-medium text-ios-text">{{
                  sound.label
                }}</span>
                <Check
                  v-if="selectedSound === sound.value"
                  class="w-5 h-5 text-ios-blue"
                />
              </button>
            </div>
          </DialogPanel>
        </TransitionChild>
      </Dialog>
    </TransitionRoot>
  </div>
</template>

<script setup lang="ts">
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionRoot,
  TransitionChild,
} from "@headlessui/vue";
import { reactive, ref, computed } from "vue";
import { ArrowLeft, ChevronRight, Check } from "lucide-vue-next";
import { useSettingsStore } from "@/stores/settings";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useI18n } from "@/i18n";
import { storeToRefs } from "pinia";
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";

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
const restorePickerFocus = useDialogReturnFocus(
  () =>
    showUrgentPicker.value || showRefreshPicker.value || showSoundPicker.value,
);
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
