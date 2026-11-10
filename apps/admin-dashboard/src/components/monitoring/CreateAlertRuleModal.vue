<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { XMarkIcon, BellAlertIcon, CheckIcon } from "@heroicons/vue/24/outline";
import { monitoringService } from "@/services/monitoringService";
import type { CreateAlertRuleRequest } from "@/types/monitoring";

// Props
interface Props {
  show: boolean;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  close: [];
  created: [];
}>();

const { t } = useI18n();
const toast = useToast();

// Metric label lookup — resolves dot-path through nested i18n keys
function getMetricLabel(metricPath: string): string {
  // metricPath is like "apiMetrics.errorRate" which resolves to
  // monitoring.createRule.metrics.apiMetrics.errorRate in the nested i18n structure
  const key = `monitoring.createRule.metrics.${metricPath}`;
  const translated = t(key);
  return translated === key ? metricPath : translated;
}

// Metric options grouped by category
const METRIC_OPTIONS = [
  {
    group: "api",
    metrics: [
      "apiMetrics.errorRate",
      "apiMetrics.averageResponseTime",
      "apiMetrics.p95ResponseTime",
      "apiMetrics.p99ResponseTime",
      "apiMetrics.totalRequests",
      "apiMetrics.slowRequestCount",
      "apiMetrics.requestsPerSecond",
    ],
  },
  {
    group: "database",
    metrics: [
      "databaseMetrics.averageQueryTime",
      "databaseMetrics.queryCount",
      "databaseMetrics.slowQueryCount",
      "databaseMetrics.errorCount",
    ],
  },
  {
    group: "cache",
    metrics: [
      "cacheMetrics.hitRate",
      "cacheMetrics.totalKeys",
      "cacheMetrics.totalSize",
    ],
  },
  {
    group: "error",
    metrics: [
      "errorMetrics.totalErrors",
      "errorMetrics.criticalErrors",
      "errorMetrics.warningCount",
    ],
  },
  {
    group: "resource",
    metrics: [
      "resourceMetrics.memoryUsage",
      "resourceMetrics.cpuUsage",
      "resourceMetrics.activeConnections",
    ],
  },
];

const OPERATOR_OPTIONS = [
  { value: ">", label: "> (greater than)" },
  { value: "<", label: "< (less than)" },
  { value: ">=", label: ">= (greater or equal)" },
  { value: "<=", label: "<= (less or equal)" },
  { value: "=", label: "= (equal)" },
];

const SEVERITY_OPTIONS = [
  { value: "info", color: "#007AFF" },
  { value: "warning", color: "#FF9500" },
  { value: "critical", color: "#FF3B30" },
  { value: "fatal", color: "#8E0000" },
] as const;

// Form state
const form = ref({
  name: "",
  metric: "",
  operator: ">" as ">" | "<" | ">=" | "<=" | "=",
  threshold: null as number | null,
  duration: 300,
  configType: "slack" as "email" | "slack" | "webhook" | "sms",
  configSeverity: "warning" as "info" | "warning" | "critical" | "fatal",
  configEnabled: true,
  configWebhookUrl: "",
});

const submitting = ref(false);

// Computed
const conditionString = computed(() => {
  const metric = form.value.metric || "...";
  const operator = form.value.operator;
  const threshold =
    form.value.threshold !== null ? form.value.threshold : "...";
  return `${metric} ${operator} ${threshold}`;
});

const showWebhookUrl = computed(() => {
  return (
    form.value.configType === "slack" || form.value.configType === "webhook"
  );
});

const isFormValid = computed(() => {
  return (
    form.value.name.trim().length >= 1 &&
    form.value.name.trim().length <= 100 &&
    form.value.metric !== "" &&
    form.value.threshold !== null &&
    form.value.duration >= 1 &&
    form.value.duration <= 3600 &&
    Number.isInteger(form.value.duration)
  );
});

// Methods
function resetForm() {
  form.value = {
    name: "",
    metric: "",
    operator: ">",
    threshold: null,
    duration: 300,
    configType: "slack",
    configSeverity: "warning",
    configEnabled: true,
    configWebhookUrl: "",
  };
  submitting.value = false;
}

function handleClose() {
  if (!submitting.value) {
    resetForm();
    emit("close");
  }
}

async function handleSubmit() {
  if (!isFormValid.value) return;
  submitting.value = true;
  try {
    const request: CreateAlertRuleRequest = {
      name: form.value.name,
      condition: conditionString.value,
      metric: form.value.metric,
      operator: form.value.operator,
      threshold: Number(form.value.threshold),
      duration: Number(form.value.duration),
      config: {
        type: form.value.configType,
        severity: form.value.configSeverity,
        enabled: form.value.configEnabled,
        ...(showWebhookUrl.value && form.value.configWebhookUrl
          ? { webhookUrl: form.value.configWebhookUrl }
          : {}),
      },
    };
    await monitoringService.createAlertRule(request);
    toast.success(t("monitoring.createRule.success"));
    emit("created");
    handleClose();
  } catch (error) {
    console.error("Failed to create alert rule:", error);
    toast.error(t("monitoring.createRule.failed"));
  } finally {
    submitting.value = false;
  }
}

// Reset form when modal is closed externally
watch(
  () => props.show,
  (newVal) => {
    if (!newVal) {
      resetForm();
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
        @click.self="handleClose"
      >
        <Transition
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 scale-95 translate-y-4"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition-all duration-200 ease-in"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-4"
        >
          <div
            v-if="show"
            class="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
          >
            <!-- Header -->
            <div
              class="flex items-center justify-between px-6 py-5 flex-shrink-0"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 rounded-xl bg-ios-blue/10 flex items-center justify-center"
                >
                  <BellAlertIcon class="w-5 h-5 text-ios-blue" />
                </div>
                <h2 class="text-lg font-semibold text-ios-text">
                  {{ t("monitoring.createRule.title") }}
                </h2>
              </div>
              <button
                :aria-label="t('common.close')"
                :disabled="submitting"
                class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                @click="handleClose"
              >
                <XMarkIcon class="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <!-- Body (scrollable) -->
            <div class="px-6 pb-6 overflow-y-auto flex-1 space-y-5">
              <!-- Rule Name -->
              <div>
                <label class="block text-sm font-medium text-gray-500 mb-1.5">
                  {{ t("monitoring.createRule.name") }}
                </label>
                <input
                  v-model="form.name"
                  type="text"
                  maxlength="100"
                  :placeholder="t('monitoring.createRule.namePlaceholder')"
                  class="w-full rounded-xl border-0 ring-1 ring-gray-200 focus:ring-2 focus:ring-ios-blue bg-white px-4 py-2.5 text-sm text-ios-text placeholder-gray-400 outline-none transition-shadow duration-200"
                />
              </div>

              <!-- Metric + Operator + Threshold (grid) -->
              <div class="grid grid-cols-3 gap-3">
                <!-- Metric -->
                <div class="col-span-3 sm:col-span-1">
                  <label class="block text-sm font-medium text-gray-500 mb-1.5">
                    {{ t("monitoring.createRule.metric") }}
                  </label>
                  <select
                    v-model="form.metric"
                    class="w-full rounded-xl border-0 ring-1 ring-gray-200 focus:ring-2 focus:ring-ios-blue bg-white px-4 py-2.5 text-sm text-ios-text outline-none transition-shadow duration-200 appearance-none"
                  >
                    <option value="" disabled>
                      {{ t("monitoring.createRule.selectMetric") }}
                    </option>
                    <optgroup
                      v-for="group in METRIC_OPTIONS"
                      :key="group.group"
                      :label="
                        t(`monitoring.createRule.metricGroups.${group.group}`)
                      "
                    >
                      <option
                        v-for="metric in group.metrics"
                        :key="metric"
                        :value="metric"
                      >
                        {{ getMetricLabel(metric) }}
                      </option>
                    </optgroup>
                  </select>
                </div>

                <!-- Operator -->
                <div class="col-span-3 sm:col-span-1">
                  <label class="block text-sm font-medium text-gray-500 mb-1.5">
                    {{ t("monitoring.createRule.operator") }}
                  </label>
                  <select
                    v-model="form.operator"
                    class="w-full rounded-xl border-0 ring-1 ring-gray-200 focus:ring-2 focus:ring-ios-blue bg-white px-4 py-2.5 text-sm text-ios-text outline-none transition-shadow duration-200 appearance-none"
                  >
                    <option
                      v-for="op in OPERATOR_OPTIONS"
                      :key="op.value"
                      :value="op.value"
                    >
                      {{ op.label }}
                    </option>
                  </select>
                </div>

                <!-- Threshold -->
                <div class="col-span-3 sm:col-span-1">
                  <label class="block text-sm font-medium text-gray-500 mb-1.5">
                    {{ t("monitoring.createRule.threshold") }}
                  </label>
                  <input
                    v-model.number="form.threshold"
                    type="number"
                    :placeholder="
                      t('monitoring.createRule.thresholdPlaceholder')
                    "
                    class="w-full rounded-xl border-0 ring-1 ring-gray-200 focus:ring-2 focus:ring-ios-blue bg-white px-4 py-2.5 text-sm text-ios-text placeholder-gray-400 outline-none transition-shadow duration-200"
                  />
                </div>
              </div>

              <!-- Condition Preview -->
              <div class="bg-gray-50 rounded-xl p-3">
                <p class="text-xs font-medium text-gray-500 mb-1">
                  {{ t("monitoring.createRule.conditionPreview") }}
                </p>
                <p class="font-mono text-sm text-ios-text">
                  {{ conditionString }}
                </p>
              </div>

              <!-- Duration -->
              <div>
                <label class="block text-sm font-medium text-gray-500 mb-1.5">
                  {{ t("monitoring.createRule.duration") }}
                </label>
                <input
                  v-model.number="form.duration"
                  type="number"
                  min="1"
                  max="3600"
                  step="1"
                  class="w-full rounded-xl border-0 ring-1 ring-gray-200 focus:ring-2 focus:ring-ios-blue bg-white px-4 py-2.5 text-sm text-ios-text outline-none transition-shadow duration-200"
                />
                <p class="mt-1 text-xs text-gray-400">
                  {{ t("monitoring.createRule.durationHint") }}
                </p>
              </div>

              <!-- Notification Configuration -->
              <div class="grid grid-cols-2 gap-3">
                <!-- Notification Type -->
                <div>
                  <label class="block text-sm font-medium text-gray-500 mb-1.5">
                    {{ t("monitoring.createRule.alertType") }}
                  </label>
                  <select
                    v-model="form.configType"
                    class="w-full rounded-xl border-0 ring-1 ring-gray-200 focus:ring-2 focus:ring-ios-blue bg-white px-4 py-2.5 text-sm text-ios-text outline-none transition-shadow duration-200 appearance-none"
                  >
                    <option value="email">
                      {{ t("monitoring.createRule.alertTypes.email") }}
                    </option>
                    <option value="slack">
                      {{ t("monitoring.createRule.alertTypes.slack") }}
                    </option>
                    <option value="webhook">
                      {{ t("monitoring.createRule.alertTypes.webhook") }}
                    </option>
                    <option value="sms">
                      {{ t("monitoring.createRule.alertTypes.sms") }}
                    </option>
                  </select>
                </div>

                <!-- Severity -->
                <div>
                  <label class="block text-sm font-medium text-gray-500 mb-1.5">
                    {{ t("monitoring.createRule.severity") }}
                  </label>
                  <select
                    v-model="form.configSeverity"
                    class="w-full rounded-xl border-0 ring-1 ring-gray-200 focus:ring-2 focus:ring-ios-blue bg-white px-4 py-2.5 text-sm text-ios-text outline-none transition-shadow duration-200 appearance-none"
                  >
                    <option
                      v-for="sev in SEVERITY_OPTIONS"
                      :key="sev.value"
                      :value="sev.value"
                    >
                      {{ t(`monitoring.createRule.severities.${sev.value}`) }}
                    </option>
                  </select>
                </div>
              </div>

              <!-- Webhook URL (conditional) -->
              <Transition
                enter-active-class="transition-all duration-200 ease-out"
                enter-from-class="opacity-0 -translate-y-2"
                enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition-all duration-150 ease-in"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 -translate-y-2"
              >
                <div v-if="showWebhookUrl">
                  <label class="block text-sm font-medium text-gray-500 mb-1.5">
                    {{ t("monitoring.createRule.webhookUrl") }}
                  </label>
                  <input
                    v-model="form.configWebhookUrl"
                    type="url"
                    placeholder="https://hooks.slack.com/services/..."
                    class="w-full rounded-xl border-0 ring-1 ring-gray-200 focus:ring-2 focus:ring-ios-blue bg-white px-4 py-2.5 text-sm text-ios-text placeholder-gray-400 outline-none transition-shadow duration-200"
                  />
                </div>
              </Transition>

              <!-- Enabled Toggle -->
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-ios-text">
                    {{ t("monitoring.createRule.enabled") }}
                  </p>
                </div>
                <button
                  :aria-label="t('monitoring.createRule.enabled')"
                  type="button"
                  role="switch"
                  :aria-checked="form.configEnabled"
                  :class="[
                    'relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out',
                    form.configEnabled ? 'bg-ios-green' : 'bg-gray-200',
                  ]"
                  @click="form.configEnabled = !form.configEnabled"
                >
                  <span
                    :class="[
                      'pointer-events-none inline-flex h-6 w-6 transform items-center justify-center rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out mt-0.5',
                      form.configEnabled
                        ? 'translate-x-5.5 ml-0.5'
                        : 'translate-x-0.5',
                    ]"
                  >
                    <CheckIcon
                      v-if="form.configEnabled"
                      class="h-3 w-3 text-ios-green"
                    />
                  </span>
                </button>
              </div>
            </div>

            <!-- Footer -->
            <div
              class="flex items-center justify-end gap-3 px-6 py-4 flex-shrink-0"
            >
              <button
                :disabled="submitting"
                class="rounded-full bg-gray-100 hover:bg-gray-200 text-ios-text px-6 py-2.5 text-sm font-medium transition-colors duration-200 disabled:opacity-50"
                @click="handleClose"
              >
                {{ t("monitoring.createRule.cancel") }}
              </button>
              <button
                :disabled="!isFormValid || submitting"
                :class="[
                  'rounded-full px-6 py-2.5 text-sm font-medium text-white transition-colors duration-200 flex items-center gap-2',
                  isFormValid && !submitting
                    ? 'bg-ios-blue hover:bg-blue-600'
                    : 'bg-gray-300 cursor-not-allowed',
                ]"
                @click="handleSubmit"
              >
                <BellAlertIcon v-if="!submitting" class="w-4 h-4" />
                <svg
                  v-else
                  class="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  />
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                {{
                  submitting
                    ? t("monitoring.createRule.submitting")
                    : t("monitoring.createRule.submit")
                }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
