<template>
  <div
    class="priority-timing-manager bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center space-x-3">
        <div
          class="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center"
        >
          <ClockIcon class="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("priorityTiming.title") }}
          </h3>
          <p class="text-sm text-gray-600">
            {{ t("priorityTiming.description") }}
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-2">
        <!-- Auto Priority Toggle -->
        <div class="flex items-center space-x-2">
          <span class="text-sm text-gray-600">{{
            t("priorityTiming.autoPriority")
          }}</span>
          <button
            :class="[
              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-600 focus:ring-offset-2',
              autoPriorityEnabled ? 'bg-orange-600' : 'bg-gray-200',
            ]"
            @click="toggleAutoPriority"
          >
            <span
              :class="[
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                autoPriorityEnabled ? 'translate-x-5' : 'translate-x-0',
              ]"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Priority Statistics -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-red-50 rounded-lg p-4 border border-red-100">
        <div class="flex items-center space-x-2">
          <ExclamationTriangleIcon class="w-5 h-5 text-red-600" />
          <div class="text-sm font-medium text-red-900">
            {{ t("priorityTiming.urgentOrders") }}
          </div>
        </div>
        <div class="text-2xl font-bold text-red-600 mt-1">
          {{ urgentCount }}
        </div>
        <div class="text-xs text-red-600">
          {{ t("priorityTiming.overThreshold", { minutes: urgentThreshold }) }}
        </div>
      </div>

      <div class="bg-orange-50 rounded-lg p-4 border border-orange-100">
        <div class="flex items-center space-x-2">
          <ClockIcon class="w-5 h-5 text-orange-600" />
          <div class="text-sm font-medium text-orange-900">
            {{ t("priorityTiming.importantOrders") }}
          </div>
        </div>
        <div class="text-2xl font-bold text-orange-600 mt-1">
          {{ highPriorityCount }}
        </div>
        <div class="text-xs text-orange-600">
          {{
            t("priorityTiming.betweenThreshold", {
              min: warningThreshold,
              max: urgentThreshold,
            })
          }}
        </div>
      </div>

      <div class="bg-green-50 rounded-lg p-4 border border-green-100">
        <div class="flex items-center space-x-2">
          <CheckCircleIcon class="w-5 h-5 text-green-600" />
          <div class="text-sm font-medium text-green-900">
            {{ t("priorityTiming.onTimeOrders") }}
          </div>
        </div>
        <div class="text-2xl font-bold text-green-600 mt-1">
          {{ normalCount }}
        </div>
        <div class="text-xs text-green-600">
          {{
            t("priorityTiming.underThreshold", { minutes: warningThreshold })
          }}
        </div>
      </div>

      <div class="bg-blue-50 rounded-lg p-4 border border-blue-100">
        <div class="flex items-center space-x-2">
          <ChartBarIcon class="w-5 h-5 text-blue-600" />
          <div class="text-sm font-medium text-blue-900">
            {{ t("priorityTiming.avgWaitTime") }}
          </div>
        </div>
        <div class="text-2xl font-bold text-blue-600 mt-1">
          {{ averageWaitTime }}
        </div>
        <div class="text-xs text-blue-600">{{ t("common.minutes") }}</div>
      </div>
    </div>

    <!-- Time Thresholds Configuration -->
    <div class="mb-6">
      <h4 class="text-md font-semibold text-gray-900 mb-4">
        {{ t("priorityTiming.thresholdSettings") }}
      </h4>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            {{ t("priorityTiming.warningThreshold") }}
          </label>
          <div class="flex items-center space-x-3">
            <input
              v-model.number="warningThresholdTemp"
              type="range"
              min="5"
              max="30"
              step="1"
              class="flex-1 h-2 bg-orange-200 rounded-lg appearance-none cursor-pointer"
            />
            <div class="flex items-center space-x-2">
              <input
                v-model.number="warningThresholdTemp"
                type="number"
                min="5"
                max="30"
                class="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <span class="text-sm text-gray-600">{{
                t("common.minutes")
              }}</span>
            </div>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            {{ t("priorityTiming.urgentThreshold") }}
          </label>
          <div class="flex items-center space-x-3">
            <input
              v-model.number="urgentThresholdTemp"
              type="range"
              min="10"
              max="60"
              step="1"
              class="flex-1 h-2 bg-red-200 rounded-lg appearance-none cursor-pointer"
            />
            <div class="flex items-center space-x-2">
              <input
                v-model.number="urgentThresholdTemp"
                type="number"
                min="10"
                max="60"
                class="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <span class="text-sm text-gray-600">{{
                t("common.minutes")
              }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-end mt-4">
        <button
          :disabled="!hasThresholdChanges"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          @click="saveThresholds"
        >
          {{ t("priorityTiming.saveThreshold") }}
        </button>
      </div>
    </div>

    <!-- Overdue Orders Alert -->
    <div v-if="overdueOrders.length > 0" class="mb-6">
      <div class="bg-red-50 border border-red-200 rounded-lg p-4">
        <div class="flex items-center space-x-2 mb-3">
          <ExclamationTriangleIcon class="w-5 h-5 text-red-600" />
          <span class="font-medium text-red-900">
            {{
              t("priorityTiming.overdueAlert", { count: overdueOrders.length })
            }}
          </span>
        </div>

        <div class="space-y-2">
          <div
            v-for="order in overdueOrders.slice(0, 5)"
            :key="order.id"
            class="flex items-center justify-between bg-white p-3 rounded-lg"
          >
            <div class="flex items-center space-x-3">
              <span class="font-semibold text-gray-900">{{
                order.orderNumber
              }}</span>
              <span class="text-sm text-gray-600">{{ order.tableName }}</span>
              <span
                class="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium"
              >
                {{
                  t("priorityTiming.overdueMinutes", {
                    minutes: order.elapsedTime - urgentThreshold,
                  })
                }}
              </span>
            </div>

            <button
              class="text-sm px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
              @click="prioritizeOrder(order.id)"
            >
              {{ t("priorityTiming.priorityAction") }}
            </button>
          </div>
        </div>

        <div v-if="overdueOrders.length > 5" class="text-center mt-3">
          <button
            class="text-sm text-red-600 hover:text-red-700"
            @click="showAllOverdue = !showAllOverdue"
          >
            {{
              showAllOverdue
                ? t("common.collapse")
                : t("priorityTiming.viewAllOverdue", {
                    count: overdueOrders.length,
                  })
            }}
          </button>
        </div>
      </div>
    </div>

    <!-- Estimated Completion Times -->
    <div class="mb-6">
      <h4 class="text-md font-semibold text-gray-900 mb-4">
        {{ t("priorityTiming.estimatedCompletion") }}
      </h4>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          class="text-center p-4 bg-yellow-50 rounded-lg border border-yellow-200"
        >
          <div class="text-2xl font-bold text-yellow-600">
            {{ estimatedCompletionTimes.pending }}
          </div>
          <div class="text-sm text-yellow-600">
            {{ t("priorityTiming.pendingOrders") }}
          </div>
          <div class="text-xs text-gray-600">
            {{ t("priorityTiming.avgCompletionTime") }}
          </div>
        </div>

        <div
          class="text-center p-4 bg-blue-50 rounded-lg border border-blue-200"
        >
          <div class="text-2xl font-bold text-blue-600">
            {{ estimatedCompletionTimes.preparing }}
          </div>
          <div class="text-sm text-blue-600">
            {{ t("priorityTiming.preparingOrders") }}
          </div>
          <div class="text-xs text-gray-600">
            {{ t("priorityTiming.estimatedRemaining") }}
          </div>
        </div>

        <div
          class="text-center p-4 bg-green-50 rounded-lg border border-green-200"
        >
          <div class="text-2xl font-bold text-green-600">
            {{ workloadCapacity }}%
          </div>
          <div class="text-sm text-green-600">
            {{ t("priorityTiming.kitchenLoad") }}
          </div>
          <div class="text-xs text-gray-600">
            {{ t("priorityTiming.basedOnCurrentLoad") }}
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="flex flex-wrap gap-3">
      <button
        class="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
        @click="autoAssignPriorities"
      >
        <ExclamationTriangleIcon class="w-4 h-4" />
        <span>{{ t("priorityTiming.autoAssignPriority") }}</span>
      </button>

      <button
        class="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        @click="rebalanceWorkload"
      >
        <ChartBarIcon class="w-4 h-4" />
        <span>{{ t("priorityTiming.rebalanceWorkload") }}</span>
      </button>

      <button
        class="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        @click="generateTimingReport"
      >
        <DocumentArrowDownIcon class="w-4 h-4" />
        <span>{{ t("priorityTiming.generateTimeReport") }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "@/i18n";
import {
  Clock as ClockIcon,
  AlertTriangle as ExclamationTriangleIcon,
  CheckCircle as CheckCircleIcon,
  BarChart2 as ChartBarIcon,
  FileDown as DocumentArrowDownIcon,
} from "lucide-vue-next";
import { useSettingsStore } from "@/stores/settings";
import { useToast } from "vue-toastification";
import { storeToRefs } from "pinia";
import type { KitchenOrder } from "@/types";

// Props
interface Props {
  orders: KitchenOrder[];
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  "priority-updated": [orderId: string | number, priority: string];
  "thresholds-updated": [warningThreshold: number, urgentThreshold: number];
}>();

const { t } = useI18n();
const toast = useToast();

// Settings Store
const settingsStore = useSettingsStore();
const { urgentThreshold, warningThreshold } = storeToRefs(settingsStore);

// Local State
const autoPriorityEnabled = ref(true);
const warningThresholdTemp = ref(warningThreshold.value);
const urgentThresholdTemp = ref(urgentThreshold.value);
const showAllOverdue = ref(false);

// Computed Properties
const urgentCount = computed(
  () => props.orders.filter((order) => order.priority === "urgent").length,
);

const highPriorityCount = computed(
  () => props.orders.filter((order) => order.priority === "high").length,
);

const normalCount = computed(
  () => props.orders.filter((order) => order.priority === "normal").length,
);

const averageWaitTime = computed(() => {
  if (props.orders.length === 0) return 0;
  const totalTime = props.orders.reduce(
    (sum, order) => sum + order.elapsedTime,
    0,
  );
  return Math.round(totalTime / props.orders.length);
});

const overdueOrders = computed(() =>
  props.orders
    .filter((order) => order.elapsedTime >= urgentThreshold.value)
    .sort((a, b) => b.elapsedTime - a.elapsedTime),
);

const hasThresholdChanges = computed(
  () =>
    warningThresholdTemp.value !== warningThreshold.value ||
    urgentThresholdTemp.value !== urgentThreshold.value,
);

const estimatedCompletionTimes = computed(() => {
  const pendingOrders = props.orders.filter(
    (order) => order.status === "confirmed",
  );
  const preparingOrders = props.orders.filter(
    (order) => order.status === "preparing",
  );

  const pendingAvg =
    pendingOrders.length > 0
      ? Math.round(
          pendingOrders.reduce(
            (sum, order) => sum + (order.estimatedTime || 15),
            0,
          ) / pendingOrders.length,
        )
      : 0;

  const preparingAvg =
    preparingOrders.length > 0
      ? Math.round(
          preparingOrders.reduce(
            (sum, order) =>
              sum +
              Math.max(0, (order.estimatedTime || 15) - order.elapsedTime),
            0,
          ) / preparingOrders.length,
        )
      : 0;

  return {
    pending: `${pendingAvg}分`,
    preparing: `${preparingAvg}分`,
  };
});

const workloadCapacity = computed(() => {
  // Simple calculation based on current orders vs typical capacity
  const totalOrders = props.orders.length;
  const typicalCapacity = 20; // Assume 20 orders is 100% capacity
  return Math.min(100, Math.round((totalOrders / typicalCapacity) * 100));
});

// Methods
const toggleAutoPriority = () => {
  autoPriorityEnabled.value = !autoPriorityEnabled.value;
  toast.success(
    autoPriorityEnabled.value
      ? t("priorityTiming.autoPriorityEnabled")
      : t("priorityTiming.autoPriorityDisabled"),
  );

  if (autoPriorityEnabled.value) {
    autoAssignPriorities();
  }
};

const saveThresholds = () => {
  if (urgentThresholdTemp.value <= warningThresholdTemp.value) {
    toast.error(t("priorityTiming.urgentMustBeGreater"));
    return;
  }

  emit(
    "thresholds-updated",
    warningThresholdTemp.value,
    urgentThresholdTemp.value,
  );
  toast.success(t("priorityTiming.thresholdSaved"));
};

const prioritizeOrder = (orderId: string | number) => {
  emit("priority-updated", orderId, "urgent");
  toast.success(t("priorityTiming.orderSetUrgent"));
};

const autoAssignPriorities = () => {
  let updatedCount = 0;

  props.orders.forEach((order) => {
    let newPriority = "normal";

    if (order.elapsedTime >= urgentThreshold.value) {
      newPriority = "urgent";
    } else if (order.elapsedTime >= warningThreshold.value) {
      newPriority = "high";
    }

    if (newPriority !== order.priority) {
      emit("priority-updated", order.id, newPriority);
      updatedCount++;
    }
  });

  toast.success(t("priorityTiming.autoAdjusted", { count: updatedCount }));
};

const rebalanceWorkload = () => {
  // Simulate workload rebalancing logic
  toast.success(t("priorityTiming.workloadRebalanced"));
};

const generateTimingReport = () => {
  // Generate timing report CSV
  const reportData = props.orders.map((order) => ({
    訂單號: order.orderNumber,
    桌號: order.tableName,
    等待時間: `${order.elapsedTime}分`,
    優先級:
      order.priority === "urgent"
        ? "緊急"
        : order.priority === "high"
          ? "重要"
          : "普通",
    預估時間: `${order.estimatedTime || "未設定"}分`,
    狀態:
      order.status === "confirmed"
        ? "已確認"
        : order.status === "preparing"
          ? "製作中"
          : "準備完成",
    延遲狀況:
      order.elapsedTime >= urgentThreshold.value
        ? "嚴重延遲"
        : order.elapsedTime >= warningThreshold.value
          ? "輕微延遲"
          : "正常",
  }));

  const csvContent =
    Object.keys(reportData[0] || {}).join(",") +
    "\n" +
    reportData.map((row) => Object.values(row).join(",")).join("\n");

  const blob = new Blob(["\ufeff" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `廚房時間報告_${new Date().toISOString().split("T")[0]}.csv`;
  link.click();

  toast.success(t("priorityTiming.reportGenerated"));
};

// Auto-update priorities when enabled
watch(
  () => props.orders,
  () => {
    if (autoPriorityEnabled.value) {
      autoAssignPriorities();
    }
  },
  { deep: true },
);

// Sync temp values with settings
watch(warningThreshold, (newVal) => {
  warningThresholdTemp.value = newVal;
});

watch(urgentThreshold, (newVal) => {
  urgentThresholdTemp.value = newVal;
});
</script>

<style scoped>
/* Range slider custom styles */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  height: 20px;
  width: 20px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #ff9500;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

input[type="range"]::-moz-range-thumb {
  height: 20px;
  width: 20px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #ff9500;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

/* Red slider variant */
input[type="range"].red::-webkit-slider-thumb {
  border-color: #d0332b;
}

input[type="range"].red::-moz-range-thumb {
  border-color: #d0332b;
}
</style>
