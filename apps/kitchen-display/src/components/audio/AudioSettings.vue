<template>
  <div class="audio-settings">
    <!-- Section: 主音效控制 -->
    <div
      class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-4 tracking-wide"
    >
      {{ t("audio.mainControl") }}
    </div>
    <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
      <!-- Master Enable Toggle -->
      <div
        class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            :class="audioEnabled ? 'bg-ios-green/10' : 'bg-ios-bg'"
          >
            <Volume2 v-if="audioEnabled" class="w-4 h-4 text-ios-green" />
            <VolumeX v-else class="w-4 h-4 text-ios-secondary" />
          </div>
          <div>
            <span class="text-[15px] font-medium text-ios-text">{{
              t("settings.audioNotifications")
            }}</span>
            <p class="text-xs text-ios-secondary mt-0.5">
              {{
                audioEnabled
                  ? t("audio.audioEnabled")
                  : t("audio.audioDisabled")
              }}
            </p>
          </div>
        </div>
        <button
          :aria-label="t('settings.audioNotifications')"
          class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
          :class="audioEnabled ? 'bg-ios-green' : 'bg-ios-bg'"
          @click="toggleAudio"
        >
          <span
            class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
            :class="audioEnabled ? 'translate-x-[18px]' : 'translate-x-[2px]'"
          />
        </button>
      </div>

      <!-- Master Volume Slider -->
      <div class="py-3.5 px-4 border-b border-ios-bg">
        <div class="flex items-center justify-between mb-2.5">
          <span class="text-[15px] font-medium text-ios-text">{{
            t("audio.masterVolume")
          }}</span>
          <span class="text-[15px] font-medium text-ios-secondary">
            {{ Math.round(masterVolume * 100) }}%
          </span>
        </div>
        <div class="flex items-center gap-2">
          <VolumeX class="w-4 h-4 text-ios-secondary flex-shrink-0" />
          <div class="relative flex-1 h-5 flex items-center">
            <div class="h-1 rounded-full bg-ios-bg w-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-150"
                :class="audioEnabled ? 'bg-ios-blue' : 'bg-ios-secondary/30'"
                :style="{ width: Math.round(masterVolume * 100) + '%' }"
              />
            </div>
            <input
              v-model.number="masterVolumePercent"
              type="range"
              min="0"
              max="100"
              step="5"
              :disabled="!audioEnabled"
              class="absolute inset-0 w-full opacity-0 cursor-pointer h-full disabled:cursor-not-allowed"
              @input="updateMasterVolume"
            />
            <div
              class="absolute w-5 h-5 rounded-full bg-white shadow-card pointer-events-none transition-all duration-150"
              :style="{
                left: 'calc(' + Math.round(masterVolume * 100) + '% - 10px)',
              }"
            />
          </div>
          <Volume2 class="w-4 h-4 text-ios-secondary flex-shrink-0" />
        </div>
      </div>

      <!-- Notification Queue Toggle -->
      <div
        class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg"
      >
        <div>
          <span class="text-[15px] font-medium text-ios-text">{{
            t("audio.notificationQueue")
          }}</span>
          <p class="text-xs text-ios-secondary mt-0.5">
            {{ t("audio.notificationQueueDesc") }}
          </p>
        </div>
        <button
          :aria-label="t('audio.notificationQueue')"
          class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
          :class="
            notificationQueue && audioEnabled ? 'bg-ios-green' : 'bg-ios-bg'
          "
          :disabled="!audioEnabled"
          @click="toggleNotificationQueue"
        >
          <span
            class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
            :class="
              notificationQueue && audioEnabled
                ? 'translate-x-[18px]'
                : 'translate-x-[2px]'
            "
          />
        </button>
      </div>

      <!-- Priority Override Toggle -->
      <div class="flex items-center justify-between py-3.5 px-4">
        <div>
          <span class="text-[15px] font-medium text-ios-text">{{
            t("audio.priorityOverride")
          }}</span>
          <p class="text-xs text-ios-secondary mt-0.5">
            {{ t("audio.priorityOverrideDesc") }}
          </p>
        </div>
        <button
          :aria-label="t('audio.priorityOverride')"
          class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
          :class="
            priorityOverride && audioEnabled && notificationQueue
              ? 'bg-ios-green'
              : 'bg-ios-bg'
          "
          :disabled="!audioEnabled || !notificationQueue"
          @click="togglePriorityOverride"
        >
          <span
            class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
            :class="
              priorityOverride && audioEnabled && notificationQueue
                ? 'translate-x-[18px]'
                : 'translate-x-[2px]'
            "
          />
        </button>
      </div>
    </div>

    <!-- Section: 訂單通知 -->
    <div
      class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
    >
      {{ t("audio.orderNotifications") }}
    </div>
    <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
      <template v-for="soundType in orderSounds" :key="soundType">
        <div
          class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg last:border-b-0"
          :class="{ 'opacity-50': !audioEnabled }"
        >
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <button
              :aria-label="`${t('audio.play')} ${getSoundLabel(soundType)}`"
              :disabled="!audioEnabled || !soundSettings[soundType].enabled"
              class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              :class="
                audioEnabled && soundSettings[soundType].enabled
                  ? 'bg-ios-blue/10 active:bg-ios-blue/20'
                  : 'bg-ios-bg'
              "
              @click="testSound(soundType)"
            >
              <Play
                class="w-4 h-4"
                :class="
                  audioEnabled && soundSettings[soundType].enabled
                    ? 'text-ios-blue'
                    : 'text-ios-secondary'
                "
              />
            </button>
            <div class="flex-1 min-w-0">
              <span class="text-[15px] font-medium text-ios-text">
                {{ getSoundLabel(soundType) }}
              </span>
              <div
                v-if="soundSettings[soundType].enabled"
                class="relative mt-1.5 h-4 flex items-center"
              >
                <div class="h-1 rounded-full bg-ios-bg w-full overflow-hidden">
                  <div
                    class="h-full rounded-full bg-ios-blue transition-all duration-150"
                    :style="{
                      width:
                        Math.round(soundSettings[soundType].volume * 100) + '%',
                    }"
                  />
                </div>
                <input
                  v-model.number="soundVolumePercent[soundType]"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  :disabled="!audioEnabled || !soundSettings[soundType].enabled"
                  class="absolute inset-0 w-full opacity-0 cursor-pointer h-full disabled:cursor-not-allowed"
                  @input="updateSoundVolume(soundType)"
                />
                <div
                  class="absolute w-3.5 h-3.5 rounded-full bg-white shadow-card pointer-events-none"
                  :style="{
                    left:
                      'calc(' +
                      Math.round(soundSettings[soundType].volume * 100) +
                      '% - 7px)',
                  }"
                />
              </div>
            </div>
          </div>
          <button
            :aria-label="getSoundLabel(soundType)"
            class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 ml-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :class="
              soundSettings[soundType].enabled && audioEnabled
                ? 'bg-ios-green'
                : 'bg-ios-bg'
            "
            :disabled="!audioEnabled"
            @click="toggleSound(soundType)"
          >
            <span
              class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
              :class="
                soundSettings[soundType].enabled && audioEnabled
                  ? 'translate-x-[18px]'
                  : 'translate-x-[2px]'
              "
            />
          </button>
        </div>
      </template>
    </div>

    <!-- Section: 警告與反饋 -->
    <div
      class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
    >
      {{ t("audio.warningsAndFeedback") }}
    </div>
    <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
      <template v-for="soundType in alertSounds" :key="soundType">
        <div
          class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg last:border-b-0"
          :class="{ 'opacity-50': !audioEnabled }"
        >
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <button
              :aria-label="`${t('audio.play')} ${getSoundLabel(soundType)}`"
              :disabled="!audioEnabled || !soundSettings[soundType].enabled"
              class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              :class="
                audioEnabled && soundSettings[soundType].enabled
                  ? 'bg-ios-blue/10 active:bg-ios-blue/20'
                  : 'bg-ios-bg'
              "
              @click="testSound(soundType)"
            >
              <Play
                class="w-4 h-4"
                :class="
                  audioEnabled && soundSettings[soundType].enabled
                    ? 'text-ios-blue'
                    : 'text-ios-secondary'
                "
              />
            </button>
            <div class="flex-1 min-w-0">
              <span class="text-[15px] font-medium text-ios-text">
                {{ getSoundLabel(soundType) }}
              </span>
              <div
                v-if="soundSettings[soundType].enabled"
                class="relative mt-1.5 h-4 flex items-center"
              >
                <div class="h-1 rounded-full bg-ios-bg w-full overflow-hidden">
                  <div
                    class="h-full rounded-full bg-ios-blue transition-all duration-150"
                    :style="{
                      width:
                        Math.round(soundSettings[soundType].volume * 100) + '%',
                    }"
                  />
                </div>
                <input
                  v-model.number="soundVolumePercent[soundType]"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  :disabled="!audioEnabled || !soundSettings[soundType].enabled"
                  class="absolute inset-0 w-full opacity-0 cursor-pointer h-full disabled:cursor-not-allowed"
                  @input="updateSoundVolume(soundType)"
                />
                <div
                  class="absolute w-3.5 h-3.5 rounded-full bg-white shadow-card pointer-events-none"
                  :style="{
                    left:
                      'calc(' +
                      Math.round(soundSettings[soundType].volume * 100) +
                      '% - 7px)',
                  }"
                />
              </div>
            </div>
          </div>
          <button
            :aria-label="getSoundLabel(soundType)"
            class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 ml-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :class="
              soundSettings[soundType].enabled && audioEnabled
                ? 'bg-ios-green'
                : 'bg-ios-bg'
            "
            :disabled="!audioEnabled"
            @click="toggleSound(soundType)"
          >
            <span
              class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
              :class="
                soundSettings[soundType].enabled && audioEnabled
                  ? 'translate-x-[18px]'
                  : 'translate-x-[2px]'
              "
            />
          </button>
        </div>
      </template>
    </div>

    <!-- Section: 環境音效 -->
    <div
      class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
    >
      {{ t("audio.ambientSounds") }}
    </div>
    <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
      <template v-for="soundType in ambientSounds" :key="soundType">
        <div
          class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg last:border-b-0"
          :class="{ 'opacity-50': !audioEnabled }"
        >
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <button
              :aria-label="`${t('audio.play')} ${getSoundLabel(soundType)}`"
              :disabled="!audioEnabled || !soundSettings[soundType].enabled"
              class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              :class="
                audioEnabled && soundSettings[soundType].enabled
                  ? 'bg-ios-blue/10 active:bg-ios-blue/20'
                  : 'bg-ios-bg'
              "
              @click="testSound(soundType)"
            >
              <Play
                class="w-4 h-4"
                :class="
                  audioEnabled && soundSettings[soundType].enabled
                    ? 'text-ios-blue'
                    : 'text-ios-secondary'
                "
              />
            </button>
            <div class="flex-1 min-w-0">
              <span class="text-[15px] font-medium text-ios-text">
                {{ getSoundLabel(soundType) }}
              </span>
              <div
                v-if="soundSettings[soundType].enabled"
                class="relative mt-1.5 h-4 flex items-center"
              >
                <div class="h-1 rounded-full bg-ios-bg w-full overflow-hidden">
                  <div
                    class="h-full rounded-full bg-ios-blue transition-all duration-150"
                    :style="{
                      width:
                        Math.round(soundSettings[soundType].volume * 100) + '%',
                    }"
                  />
                </div>
                <input
                  v-model.number="soundVolumePercent[soundType]"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  :disabled="!audioEnabled || !soundSettings[soundType].enabled"
                  class="absolute inset-0 w-full opacity-0 cursor-pointer h-full disabled:cursor-not-allowed"
                  @input="updateSoundVolume(soundType)"
                />
                <div
                  class="absolute w-3.5 h-3.5 rounded-full bg-white shadow-card pointer-events-none"
                  :style="{
                    left:
                      'calc(' +
                      Math.round(soundSettings[soundType].volume * 100) +
                      '% - 7px)',
                  }"
                />
              </div>
            </div>
          </div>
          <button
            :aria-label="getSoundLabel(soundType)"
            class="w-[44px] h-[26px] rounded-full relative cursor-pointer transition-colors duration-200 flex-shrink-0 ml-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :class="
              soundSettings[soundType].enabled && audioEnabled
                ? 'bg-ios-green'
                : 'bg-ios-bg'
            "
            :disabled="!audioEnabled"
            @click="toggleSound(soundType)"
          >
            <span
              class="w-[22px] h-[22px] rounded-full bg-white shadow-card-sm absolute top-[2px] transition-transform duration-200"
              :class="
                soundSettings[soundType].enabled && audioEnabled
                  ? 'translate-x-[18px]'
                  : 'translate-x-[2px]'
              "
            />
          </button>
        </div>
      </template>
    </div>

    <!-- Section: 音效測試 -->
    <div
      class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
    >
      {{ t("audio.soundTest") }}
    </div>
    <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
      <!-- Test All Sounds -->
      <div
        class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-full bg-ios-blue/10 flex items-center justify-center"
          >
            <Play class="w-4 h-4 text-ios-blue" />
          </div>
          <span class="text-[15px] font-medium text-ios-text">{{
            t("audio.testAll")
          }}</span>
        </div>
        <button
          :disabled="!audioEnabled || isTesting"
          class="px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-200"
          :class="
            audioEnabled && !isTesting
              ? 'bg-ios-blue text-white active:opacity-80'
              : 'bg-ios-bg text-ios-secondary'
          "
          @click="testAllSounds"
        >
          {{ isTesting ? t("audio.testing") : t("audio.play") }}
        </button>
      </div>

      <!-- Stop All Sounds -->
      <div class="flex items-center justify-between py-3.5 px-4">
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-full bg-ios-red/10 flex items-center justify-center"
          >
            <VolumeX class="w-4 h-4 text-ios-red" />
          </div>
          <span class="text-[15px] font-medium text-ios-text">{{
            t("audio.stopAll")
          }}</span>
        </div>
        <button
          :disabled="!audioEnabled"
          class="px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-200"
          :class="
            audioEnabled
              ? 'bg-ios-red/10 text-ios-red active:bg-ios-red/20'
              : 'bg-ios-bg text-ios-secondary'
          "
          @click="stopAllSounds"
        >
          {{ t("common.stop") }}
        </button>
      </div>
    </div>

    <!-- Section: 進階設定 -->
    <div
      class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
    >
      {{ t("audio.advanced") }}
    </div>
    <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
      <!-- Max Queue Size -->
      <div
        class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg"
        :class="{ 'opacity-50': !audioEnabled || !notificationQueue }"
      >
        <div>
          <span class="text-[15px] font-medium text-ios-text">{{
            t("audio.maxQueueSize")
          }}</span>
          <p class="text-xs text-ios-secondary mt-0.5">
            {{ t("audio.maxQueueSizeDesc") }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            :disabled="!audioEnabled || !notificationQueue || maxQueueSize <= 1"
            class="w-8 h-8 rounded-full bg-ios-bg flex items-center justify-center text-ios-text font-semibold disabled:opacity-40 active:bg-ios-bg/70 transition-colors"
            @click="adjustQueueSize(-1)"
          >
            −
          </button>
          <span class="text-[15px] font-semibold text-ios-blue w-8 text-center">
            {{ maxQueueSize }}
          </span>
          <button
            :disabled="
              !audioEnabled || !notificationQueue || maxQueueSize >= 20
            "
            class="w-8 h-8 rounded-full bg-ios-bg flex items-center justify-center text-ios-text font-semibold disabled:opacity-40 active:bg-ios-bg/70 transition-colors"
            @click="adjustQueueSize(1)"
          >
            +
          </button>
        </div>
      </div>

      <!-- Fade Out Time -->
      <div class="py-3.5 px-4" :class="{ 'opacity-50': !audioEnabled }">
        <div class="flex items-center justify-between mb-2.5">
          <div>
            <span class="text-[15px] font-medium text-ios-text">{{
              t("audio.fadeOutDuration")
            }}</span>
            <p class="text-xs text-ios-secondary mt-0.5">
              {{ t("audio.fadeOutDurationDesc") }}
            </p>
          </div>
          <span class="text-[15px] font-medium text-ios-secondary">
            {{ fadeOutTime }} ms
          </span>
        </div>
        <div class="relative h-5 flex items-center">
          <div class="h-1 rounded-full bg-ios-bg w-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-150"
              :class="audioEnabled ? 'bg-ios-blue' : 'bg-ios-secondary/30'"
              :style="{ width: (fadeOutTime / 5000) * 100 + '%' }"
            />
          </div>
          <input
            v-model.number="fadeOutTime"
            type="range"
            min="0"
            max="5000"
            step="100"
            :disabled="!audioEnabled"
            class="absolute inset-0 w-full opacity-0 cursor-pointer h-full disabled:cursor-not-allowed"
            @input="updateAdvancedSettings"
          />
          <div
            class="absolute w-5 h-5 rounded-full bg-white shadow-card pointer-events-none"
            :style="{
              left: 'calc(' + (fadeOutTime / 5000) * 100 + '% - 10px)',
            }"
          />
        </div>
      </div>
    </div>

    <!-- Section: 操作 -->
    <div
      class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 mt-6 tracking-wide"
    >
      {{ t("audio.operations") }}
    </div>
    <div class="bg-white rounded-2xl shadow-card-sm overflow-hidden">
      <!-- Save Settings -->
      <div
        class="flex items-center justify-between py-3.5 px-4 border-b border-ios-bg cursor-pointer active:bg-ios-bg transition-colors"
        @click="saveSettings"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-full bg-ios-green/10 flex items-center justify-center"
          >
            <Bell class="w-4 h-4 text-ios-green" />
          </div>
          <span class="text-[15px] font-medium text-ios-text">{{
            t("common.saveSettings")
          }}</span>
        </div>
        <span class="text-sm font-semibold text-ios-green">{{
          t("audio.saveButton")
        }}</span>
      </div>

      <!-- Reset to Defaults -->
      <div
        class="flex items-center justify-between py-3.5 px-4 cursor-pointer active:bg-ios-bg transition-colors"
        @click="resetToDefaults"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-full bg-ios-red/10 flex items-center justify-center"
          >
            <VolumeX class="w-4 h-4 text-ios-red" />
          </div>
          <span class="text-[15px] font-medium text-ios-red">{{
            t("audio.resetToDefaults")
          }}</span>
        </div>
      </div>
    </div>

    <!-- Bottom spacer -->
    <div class="h-6" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { Volume2, VolumeX, Play, Bell } from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { audioService } from "@/services/audioService";
import type { SoundType, AudioSettings } from "@/services/audioService";

const { t } = useI18n();

const toast = useToast();

// State
const audioEnabled = ref(true);
const masterVolume = ref(0.7);
const notificationQueue = ref(true);
const priorityOverride = ref(true);
const maxQueueSize = ref(10);
const fadeOutTime = ref(500);
const isTesting = ref(false);

const soundSettings = reactive<
  Record<SoundType, { enabled: boolean; volume: number }>
>({
  newOrder: { enabled: true, volume: 0.8 },
  orderReady: { enabled: true, volume: 0.9 },
  orderUrgent: { enabled: true, volume: 1.0 },
  orderComplete: { enabled: true, volume: 0.6 },
  warning: { enabled: true, volume: 0.8 },
  success: { enabled: true, volume: 0.5 },
  error: { enabled: true, volume: 0.9 },
  notification: { enabled: true, volume: 0.6 },
  bell: { enabled: true, volume: 0.7 },
  chime: { enabled: true, volume: 0.5 },
});

// Volume percent proxies for range inputs (0-100 integers)
const soundVolumePercent = reactive<Record<SoundType, number>>({
  newOrder: 80,
  orderReady: 90,
  orderUrgent: 100,
  orderComplete: 60,
  warning: 80,
  success: 50,
  error: 90,
  notification: 60,
  bell: 70,
  chime: 50,
});

// Master volume as 0-100 for range input
const masterVolumePercent = computed({
  get: () => Math.round(masterVolume.value * 100),
  set: (val: number) => {
    masterVolume.value = val / 100;
  },
});

// Sound categories
const orderSounds: SoundType[] = [
  "newOrder",
  "orderReady",
  "orderUrgent",
  "orderComplete",
];
const alertSounds: SoundType[] = [
  "warning",
  "error",
  "success",
  "notification",
];
const ambientSounds: SoundType[] = ["bell", "chime"];

// Labels
const getSoundLabel = (soundType: SoundType): string => {
  const labelKeys: Record<string, string> = {
    newOrder: "audio.newOrder",
    orderReady: "audio.orderReady",
    orderUrgent: "audio.urgentOrder",
    orderComplete: "audio.orderComplete",
    warning: "audio.warningSound",
    success: "audio.successSound",
    error: "audio.errorSound",
    notification: "audio.notificationSound",
    bell: "audio.bellSound",
    chime: "audio.chimeSound",
  };
  return labelKeys[soundType] ? t(labelKeys[soundType]) : soundType;
};

// Toggle handlers
const toggleAudio = () => {
  audioEnabled.value = !audioEnabled.value;
  if (audioEnabled.value) {
    audioService.enable();
    toast.success(t("audio.audioEnabledToast"));
  } else {
    audioService.disable();
    toast.info(t("audio.audioDisabledToast"));
  }
};

const toggleNotificationQueue = () => {
  notificationQueue.value = !notificationQueue.value;
  updateAdvancedSettings();
};

const togglePriorityOverride = () => {
  priorityOverride.value = !priorityOverride.value;
  updateAdvancedSettings();
};

const toggleSound = (soundType: SoundType) => {
  soundSettings[soundType].enabled = !soundSettings[soundType].enabled;
  updateSoundSettings(soundType);
};

// Volume handlers
const updateMasterVolume = () => {
  audioService.setMasterVolume(masterVolume.value);
};

const updateSoundVolume = (soundType: SoundType) => {
  soundSettings[soundType].volume = soundVolumePercent[soundType] / 100;
  updateSoundSettings(soundType);
};

const updateSoundSettings = (soundType: SoundType) => {
  const settings = audioService.getSettings();
  settings.sounds[soundType] = { ...soundSettings[soundType] };
  audioService.updateSettings({ sounds: settings.sounds });
};

const updateAdvancedSettings = () => {
  audioService.updateSettings({
    notificationQueue: notificationQueue.value,
    priorityOverride: priorityOverride.value,
    maxQueueSize: maxQueueSize.value,
  });
};

const adjustQueueSize = (delta: number) => {
  const next = maxQueueSize.value + delta;
  if (next >= 1 && next <= 20) {
    maxQueueSize.value = next;
    updateAdvancedSettings();
  }
};

// Test & stop
const testSound = async (soundType: SoundType) => {
  if (!audioEnabled.value) return;
  try {
    await audioService.testSound(soundType);
    toast.success(t("audio.playedSound", { name: getSoundLabel(soundType) }));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    toast.error(`${t("audio.playFailed")} ${msg}`);
  }
};

const testAllSounds = async () => {
  if (!audioEnabled.value || isTesting.value) return;
  isTesting.value = true;
  try {
    await audioService.testAllSounds();
    toast.success(t("audio.testAllComplete"));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    toast.error(`${t("audio.testAllFailed")} ${msg}`);
  } finally {
    isTesting.value = false;
  }
};

const stopAllSounds = () => {
  audioService.stopAll();
  toast.info(t("audio.stoppedAll"));
};

// Reset & save
const resetToDefaults = () => {
  const defaults = {
    masterVolume: 0.7,
    enabled: true,
    notificationQueue: true,
    priorityOverride: true,
    maxQueueSize: 10,
    sounds: {
      newOrder: { enabled: true, volume: 0.8 },
      orderReady: { enabled: true, volume: 0.9 },
      orderUrgent: { enabled: true, volume: 1.0 },
      orderComplete: { enabled: true, volume: 0.6 },
      warning: { enabled: true, volume: 0.8 },
      success: { enabled: true, volume: 0.5 },
      error: { enabled: true, volume: 0.9 },
      notification: { enabled: true, volume: 0.6 },
      bell: { enabled: true, volume: 0.7 },
      chime: { enabled: true, volume: 0.5 },
    },
  };

  audioEnabled.value = defaults.enabled;
  masterVolume.value = defaults.masterVolume;
  notificationQueue.value = defaults.notificationQueue;
  priorityOverride.value = defaults.priorityOverride;
  maxQueueSize.value = defaults.maxQueueSize;
  fadeOutTime.value = 500;

  Object.assign(soundSettings, defaults.sounds);
  (Object.keys(defaults.sounds) as SoundType[]).forEach((key) => {
    soundVolumePercent[key] = Math.round(defaults.sounds[key].volume * 100);
  });

  audioService.updateSettings(defaults);
  toast.success(t("audio.resetComplete"));
};

const saveSettings = () => {
  const settings: Partial<AudioSettings> = {
    masterVolume: masterVolume.value,
    enabled: audioEnabled.value,
    notificationQueue: notificationQueue.value,
    priorityOverride: priorityOverride.value,
    maxQueueSize: maxQueueSize.value,
    sounds: { ...soundSettings },
  };
  audioService.updateSettings(settings);
  toast.success(t("audio.settingsSaved"));
};

// Init
onMounted(() => {
  const current = audioService.getSettings();
  audioEnabled.value = current.enabled;
  masterVolume.value = current.masterVolume;
  notificationQueue.value = current.notificationQueue;
  priorityOverride.value = current.priorityOverride;
  maxQueueSize.value = current.maxQueueSize;
  Object.assign(soundSettings, current.sounds);
  (Object.keys(current.sounds) as SoundType[]).forEach((key) => {
    soundVolumePercent[key] = Math.round(current.sounds[key].volume * 100);
  });
});
</script>
