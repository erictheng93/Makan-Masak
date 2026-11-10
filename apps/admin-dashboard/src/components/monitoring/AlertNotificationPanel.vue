<template>
  <div class="alert-notification-panel">
    <!-- Connection Status Bar -->
    <div
      v-if="showConnectionStatus"
      :class="[
        'px-4 py-2 text-sm font-medium flex items-center justify-between',
        connectionStatusClass,
      ]"
    >
      <div class="flex items-center">
        <component :is="connectionStatusIcon" class="w-4 h-4 mr-2" />
        <span>{{ connectionStatusText }}</span>
      </div>
      <button
        v-if="!connectionStatus.connected"
        class="text-xs underline hover:no-underline"
        @click="$emit('reconnect')"
      >
        {{ t("monitoring.alertPanel.reconnect") }}
      </button>
    </div>

    <!-- Alerts Header -->
    <div class="px-4 py-3 border-b border-gray-200 bg-gray-50">
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <BellIcon class="w-5 h-5 text-gray-600 mr-2" />
          <h3 class="text-sm font-semibold text-gray-900">
            {{ t("monitoring.alertPanel.title") }}
          </h3>
          <span
            v-if="unacknowledgedCount > 0"
            class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"
          >
            {{ unacknowledgedCount }}
          </span>
        </div>

        <div class="flex items-center space-x-2">
          <!-- Sound toggle -->
          <button
            :class="[
              'p-1.5 rounded-md transition-colors',
              soundEnabled
                ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                : 'text-gray-400 hover:bg-gray-100',
            ]"
            :title="
              soundEnabled
                ? t('monitoring.alertPanel.muteSound')
                : t('monitoring.alertPanel.enableSound')
            "
            :aria-label="
              soundEnabled
                ? t('monitoring.alertPanel.muteSound')
                : t('monitoring.alertPanel.enableSound')
            "
            @click="toggleSound"
          >
            <component
              :is="soundEnabled ? SpeakerWaveIcon : SpeakerXMarkIcon"
              class="w-4 h-4"
            />
          </button>

          <!-- Clear all -->
          <button
            v-if="alerts.length > 0"
            class="text-xs text-gray-600 hover:text-gray-900 underline"
            @click="clearAll"
          >
            {{ t("monitoring.alertPanel.clearAll") }}
          </button>
        </div>
      </div>
    </div>

    <!-- Alerts List -->
    <div class="max-h-96 overflow-y-auto">
      <TransitionGroup name="alert-list" tag="div">
        <div
          v-for="alert in alerts"
          :key="alert.id"
          :class="[
            'px-4 py-3 border-b border-gray-100 transition-colors cursor-pointer',
            alert.acknowledged
              ? 'bg-white opacity-60'
              : 'bg-white hover:bg-gray-50',
            getSeverityBorderClass(alert.severity),
          ]"
          @click="acknowledgeAlert(alert.id)"
        >
          <div class="flex items-start">
            <!-- Severity Icon -->
            <div
              :class="[
                'flex-shrink-0 mt-0.5',
                getSeverityTextClass(alert.severity),
              ]"
            >
              <component
                :is="getSeverityIcon(alert.severity)"
                class="w-5 h-5"
              />
            </div>

            <!-- Alert Content -->
            <div class="ml-3 flex-1 min-w-0">
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <p class="text-sm font-medium text-gray-900">
                    {{ alert.title }}
                  </p>
                  <p class="mt-1 text-sm text-gray-600">
                    {{ alert.message }}
                  </p>

                  <!-- Alert Metadata -->
                  <div
                    class="mt-2 flex items-center space-x-4 text-xs text-gray-500"
                  >
                    <span>{{ formatTimestamp(alert.timestamp) }}</span>
                    <span v-if="alert.ruleName" class="flex items-center">
                      <TagIcon class="w-3 h-3 mr-1" />
                      {{ alert.ruleName }}
                    </span>
                    <span
                      v-if="alert.currentValue !== undefined"
                      class="flex items-center"
                    >
                      {{ t("monitoring.alertPanel.currentValue") }}:
                      {{ alert.currentValue }}
                      <span v-if="alert.threshold !== undefined" class="ml-1">
                        ({{ t("monitoring.alertPanel.threshold") }}:
                        {{ alert.threshold }})
                      </span>
                    </span>
                  </div>
                </div>

                <!-- Acknowledged Badge -->
                <CheckCircleIcon
                  v-if="alert.acknowledged"
                  class="w-5 h-5 text-green-500 ml-2 flex-shrink-0"
                  :title="t('monitoring.alertPanel.acknowledged')"
                />
              </div>
            </div>
          </div>
        </div>
      </TransitionGroup>

      <!-- Empty State -->
      <div v-if="alerts.length === 0" class="px-4 py-12 text-center">
        <CheckCircleIcon class="mx-auto h-12 w-12 text-green-400" />
        <h3 class="mt-2 text-sm font-medium text-gray-900">
          {{ t("monitoring.alertPanel.noAlerts") }}
        </h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ t("monitoring.alertPanel.systemNormal") }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  BellIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  WifiIcon,
  ArrowPathIcon,
} from "@heroicons/vue/24/outline";
import TagIcon from "@heroicons/vue/24/outline/TagIcon";
import type {
  AlertNotification,
  ConnectionStatus,
} from "@/services/monitoringWebSocket";

interface Props {
  alerts: AlertNotification[];
  connectionStatus: ConnectionStatus;
  showConnectionStatus?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showConnectionStatus: true,
});

const emit = defineEmits<{
  acknowledge: [alertId: string];
  clearAll: [];
  reconnect: [];
}>();

const { t } = useI18n();
const { formatDateTime } = useDateFormatter();
const soundEnabled = ref(true);

// ============================================================================
// Computed
// ============================================================================

const unacknowledgedCount = computed(() => {
  return props.alerts.filter((a) => !a.acknowledged).length;
});

const connectionStatusClass = computed(() => {
  if (props.connectionStatus.connected) {
    return "bg-green-50 text-green-800";
  }
  if (props.connectionStatus.reconnecting) {
    return "bg-yellow-50 text-yellow-800";
  }
  return "bg-red-50 text-red-800";
});

const connectionStatusText = computed(() => {
  if (props.connectionStatus.connected) {
    return t("monitoring.polling.connected");
  }
  if (props.connectionStatus.reconnecting) {
    return t("monitoring.alertPanel.reconnecting", {
      attempts: props.connectionStatus.reconnectAttempts,
    });
  }
  return t("monitoring.polling.disconnected");
});

const connectionStatusIcon = computed(() => {
  if (props.connectionStatus.connected) {
    return WifiIcon;
  }
  if (props.connectionStatus.reconnecting) {
    return ArrowPathIcon;
  }
  return XCircleIcon;
});

// ============================================================================
// Methods
// ============================================================================

function acknowledgeAlert(alertId: string) {
  emit("acknowledge", alertId);
}

function clearAll() {
  emit("clearAll");
}

function toggleSound() {
  soundEnabled.value = !soundEnabled.value;
}

function getSeverityIcon(severity: string) {
  const iconMap: Record<string, unknown> = {
    info: InformationCircleIcon,
    warning: ExclamationTriangleIcon,
    critical: XCircleIcon,
    fatal: XCircleIcon,
  };
  return iconMap[severity] || InformationCircleIcon;
}

function getSeverityTextClass(severity: string) {
  const classMap: Record<string, string> = {
    info: "text-blue-500",
    warning: "text-yellow-500",
    critical: "text-red-500",
    fatal: "text-teal-500",
  };
  return classMap[severity] || "text-gray-500";
}

function getSeverityBorderClass(severity: string) {
  const classMap: Record<string, string> = {
    info: "border-l-4 border-l-blue-500",
    warning: "border-l-4 border-l-yellow-500",
    critical: "border-l-4 border-l-red-500",
    fatal: "border-l-4 border-l-teal-500",
  };
  return classMap[severity] || "";
}

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return t("monitoring.alertPanel.justNow");
  } else if (diff < 3600000) {
    return t("monitoring.alertPanel.minutesAgo", {
      count: Math.floor(diff / 60000),
    });
  } else if (diff < 86400000) {
    return t("monitoring.alertPanel.hoursAgo", {
      count: Math.floor(diff / 3600000),
    });
  } else {
    return formatDateTime(new Date(timestamp));
  }
}

// Play alert sound when new alert arrives
function playAlertSound() {
  if (!soundEnabled.value) return;

  try {
    const audio = new Audio("/alert-sound.mp3");
    audio.volume = 0.5;
    audio.play().catch((e) => console.warn("Failed to play alert sound:", e));
  } catch (error) {
    console.warn("Alert sound not available:", error);
  }
}

// Watch for new alerts and play sound
const lastAlertCount = ref(props.alerts.length);
// Watch alerts for changes and play sound on new alerts
watch(
  () => props.alerts.length,
  (newCount) => {
    if (newCount > lastAlertCount.value) {
      playAlertSound();
    }
    lastAlertCount.value = newCount;
  },
);
</script>

<style scoped>
.alert-list-enter-active,
.alert-list-leave-active {
  transition: all 0.3s ease;
}

.alert-list-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.alert-list-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.alert-notification-panel {
  background: white;
  border-radius: 0.5rem;
  box-shadow:
    0 1px 3px 0 rgba(0, 0, 0, 0.1),
    0 1px 2px 0 rgba(0, 0, 0, 0.06);
  overflow: hidden;
}
</style>
