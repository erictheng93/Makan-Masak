<template>
  <div
    class="workflow-automation bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center space-x-3">
        <div
          class="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center"
        >
          <CogIcon class="w-5 h-5 text-teal-600" />
        </div>
        <div>
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("workflow.title") }}
          </h3>
          <p class="text-sm text-gray-600">{{ t("workflow.description") }}</p>
        </div>
      </div>

      <div class="flex items-center space-x-3">
        <!-- Automation Status -->
        <div class="flex items-center space-x-2">
          <div
            :class="[
              'w-3 h-3 rounded-full',
              automationActive ? 'bg-green-500 animate-pulse' : 'bg-gray-300',
            ]"
          />
          <span class="text-sm font-medium text-gray-700">
            {{
              automationActive
                ? t("workflow.automationEnabled")
                : t("workflow.automationDisabled")
            }}
          </span>
        </div>

        <!-- Master Toggle -->
        <button
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2',
            automationActive ? 'bg-teal-600' : 'bg-gray-200',
          ]"
          @click="toggleAutomation"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              automationActive ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>
    </div>

    <!-- Workflow Rules Configuration -->
    <div class="mb-6">
      <h4 class="text-md font-semibold text-gray-900 mb-4">
        {{ t("workflow.ruleConfig") }}
      </h4>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Auto Assignment Rules -->
        <div class="bg-gray-50 rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h5 class="font-medium text-gray-900">
              {{ t("workflow.smartAssignment") }}
            </h5>
            <input
              v-model="rules.autoAssignment.enabled"
              type="checkbox"
              class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">{{
                t("workflow.skillBasedAssignment")
              }}</span>
              <input
                v-model="rules.autoAssignment.skillBased"
                type="checkbox"
                :disabled="!rules.autoAssignment.enabled"
                class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">{{
                t("workflow.loadBalancing")
              }}</span>
              <input
                v-model="rules.autoAssignment.loadBalancing"
                type="checkbox"
                :disabled="!rules.autoAssignment.enabled"
                class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">{{
                t("workflow.priorityFirst")
              }}</span>
              <input
                v-model="rules.autoAssignment.priorityFirst"
                type="checkbox"
                :disabled="!rules.autoAssignment.enabled"
                class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
            </div>
          </div>
        </div>

        <!-- Auto Progression Rules -->
        <div class="bg-gray-50 rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h5 class="font-medium text-gray-900">
              {{ t("workflow.autoStatusAdvance") }}
            </h5>
            <input
              v-model="rules.autoProgression.enabled"
              type="checkbox"
              class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
          </div>

          <div class="space-y-3">
            <div>
              <label class="block text-sm text-gray-600 mb-1">{{
                t("workflow.autoStartDelay")
              }}</label>
              <div class="flex items-center space-x-2">
                <input
                  v-model.number="rules.autoProgression.startDelay"
                  type="number"
                  min="0"
                  max="10"
                  :disabled="!rules.autoProgression.enabled"
                  class="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <span class="text-sm text-gray-500">{{
                  t("common.seconds")
                }}</span>
              </div>
            </div>
            <div>
              <label class="block text-sm text-gray-600 mb-1">{{
                t("workflow.autoCompleteDelay")
              }}</label>
              <div class="flex items-center space-x-2">
                <input
                  v-model.number="rules.autoProgression.completeDelay"
                  type="number"
                  min="0"
                  max="30"
                  :disabled="!rules.autoProgression.enabled"
                  class="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <span class="text-sm text-gray-500">{{
                  t("common.seconds")
                }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Smart Scheduling -->
        <div class="bg-gray-50 rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h5 class="font-medium text-gray-900">
              {{ t("workflow.smartScheduling") }}
            </h5>
            <input
              v-model="rules.smartScheduling.enabled"
              type="checkbox"
              class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">{{
                t("workflow.cookingTimeSort")
              }}</span>
              <input
                v-model="rules.smartScheduling.cookingTimeBased"
                type="checkbox"
                :disabled="!rules.smartScheduling.enabled"
                class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">{{
                t("workflow.batchSimilar")
              }}</span>
              <input
                v-model="rules.smartScheduling.batchSimilar"
                type="checkbox"
                :disabled="!rules.smartScheduling.enabled"
                class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">{{
                t("workflow.prepTimeConsideration")
              }}</span>
              <input
                v-model="rules.smartScheduling.prepTimeConsidered"
                type="checkbox"
                :disabled="!rules.smartScheduling.enabled"
                class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
            </div>
          </div>
        </div>

        <!-- Quality Control -->
        <div class="bg-gray-50 rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h5 class="font-medium text-gray-900">
              {{ t("workflow.qualityControl") }}
            </h5>
            <input
              v-model="rules.qualityControl.enabled"
              type="checkbox"
              class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">{{
                t("workflow.autoQualityCheck")
              }}</span>
              <input
                v-model="rules.qualityControl.autoCheck"
                type="checkbox"
                :disabled="!rules.qualityControl.enabled"
                class="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
            </div>
            <div>
              <label class="block text-sm text-gray-600 mb-1">{{
                t("workflow.checkInterval")
              }}</label>
              <div class="flex items-center space-x-2">
                <input
                  v-model.number="rules.qualityControl.checkInterval"
                  type="number"
                  min="30"
                  max="300"
                  :disabled="
                    !rules.qualityControl.enabled ||
                    !rules.qualityControl.autoCheck
                  "
                  class="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <span class="text-sm text-gray-500">{{
                  t("common.seconds")
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Automation Statistics -->
    <div class="mb-6">
      <h4 class="text-md font-semibold text-gray-900 mb-4">
        {{ t("workflow.automationStats") }}
      </h4>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="text-center p-3 bg-green-50 rounded-lg">
          <div class="text-2xl font-bold text-green-600">
            {{ automationStats.tasksAutomated }}
          </div>
          <div class="text-sm text-green-600">
            {{ t("workflow.automatedTasks") }}
          </div>
        </div>
        <div class="text-center p-3 bg-blue-50 rounded-lg">
          <div class="text-2xl font-bold text-blue-600">
            {{ automationStats.timeSaved }}
          </div>
          <div class="text-sm text-blue-600">{{ t("workflow.timeSaved") }}</div>
        </div>
        <div class="text-center p-3 bg-teal-50 rounded-lg">
          <div class="text-2xl font-bold text-teal-600">
            {{ automationStats.efficiencyGain }}%
          </div>
          <div class="text-sm text-teal-600">
            {{ t("workflow.efficiencyImproved") }}
          </div>
        </div>
        <div class="text-center p-3 bg-orange-50 rounded-lg">
          <div class="text-2xl font-bold text-orange-600">
            {{ automationStats.errorReduction }}%
          </div>
          <div class="text-sm text-orange-600">
            {{ t("workflow.errorsReduced") }}
          </div>
        </div>
      </div>
    </div>

    <!-- Active Workflows -->
    <div class="mb-6">
      <h4 class="text-md font-semibold text-gray-900 mb-4">
        {{ t("workflow.activeWorkflows") }}
      </h4>

      <div class="space-y-3">
        <div
          v-for="workflow in activeWorkflows"
          :key="workflow.id"
          class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
        >
          <div class="flex items-center space-x-3">
            <div
              :class="[
                'w-3 h-3 rounded-full',
                workflow.status === 'running'
                  ? 'bg-green-500 animate-pulse'
                  : workflow.status === 'paused'
                    ? 'bg-yellow-500'
                    : 'bg-gray-400',
              ]"
            />
            <div>
              <div class="font-medium text-gray-900">
                {{ workflow.name }}
              </div>
              <div class="text-sm text-gray-600">
                {{ workflow.description }}
              </div>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <span class="text-sm text-gray-500"
              >{{ workflow.progress }}% {{ t("workflow.complete") }}</span
            >
            <button
              :class="[
                'px-3 py-1 text-xs rounded-lg',
                workflow.status === 'running'
                  ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                  : 'bg-green-100 text-green-700 hover:bg-green-200',
              ]"
              @click="toggleWorkflow(workflow.id)"
            >
              {{
                workflow.status === "running"
                  ? t("common.pause")
                  : t("common.start")
              }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="activeWorkflows.length === 0"
        class="text-center py-6 text-gray-500"
      >
        <CogIcon class="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p>{{ t("workflow.noActiveWorkflows") }}</p>
      </div>
    </div>
  </div>

  <!-- Control Actions -->
  <div class="flex justify-between items-center">
    <div class="flex space-x-3">
      <button
        class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        @click="saveWorkflowRules"
      >
        {{ t("workflow.saveRules") }}
      </button>

      <button
        class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        @click="resetToDefaults"
      >
        {{ t("workflow.resetToDefaults") }}
      </button>
    </div>

    <div class="flex space-x-3">
      <button
        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        @click="exportWorkflowConfig"
      >
        {{ t("workflow.exportConfig") }}
      </button>

      <button
        class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        @click="showWorkflowReport"
      >
        {{ t("workflow.viewReport") }}
      </button>
    </div>
  </div>

  <!-- Workflow Report Modal -->
  <div
    v-if="showReportModal"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
  >
    <div
      class="bg-white rounded-xl p-6 max-w-2xl max-h-96 overflow-y-auto mx-4"
    >
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-gray-900">
          {{ t("workflow.workflowReport") }}
        </h3>
        <button
          class="text-gray-400 hover:text-gray-600"
          @click="showReportModal = false"
        >
          <XMarkIcon class="w-5 h-5" />
        </button>
      </div>

      <div class="space-y-4">
        <div
          v-for="report in workflowReports"
          :key="report.id"
          class="border-b pb-3"
        >
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-900">
              {{ report.title }}
            </div>
            <div class="text-sm text-gray-500">
              {{ report.timestamp }}
            </div>
          </div>
          <div class="text-sm text-gray-600">
            {{ report.description }}
          </div>
          <div class="mt-2 flex space-x-4 text-sm">
            <span class="text-green-600"
              >{{ t("workflow.successLabel") }} {{ report.success }}</span
            >
            <span class="text-red-600"
              >{{ t("workflow.failureLabel") }} {{ report.failed }}</span
            >
            <span class="text-blue-600"
              >{{ t("workflow.savedLabel") }} {{ report.timeSaved }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from "vue";
import { Settings as CogIcon, X as XMarkIcon } from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import type { KitchenOrder } from "@/types";

// Props
interface Props {
  orders: KitchenOrder[];
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  "workflow-updated": [rules: WorkflowRules];
  "auto-assignment": [orderId: string | number, assigneeId: number];
  "auto-progression": [orderId: string | number, action: string];
}>();

// Types
interface WorkflowRules {
  autoAssignment: {
    enabled: boolean;
    skillBased: boolean;
    loadBalancing: boolean;
    priorityFirst: boolean;
  };
  autoProgression: {
    enabled: boolean;
    startDelay: number;
    completeDelay: number;
  };
  smartScheduling: {
    enabled: boolean;
    cookingTimeBased: boolean;
    batchSimilar: boolean;
    prepTimeConsidered: boolean;
  };
  qualityControl: {
    enabled: boolean;
    autoCheck: boolean;
    checkInterval: number;
  };
}

interface ActiveWorkflow {
  id: string;
  name: string;
  description: string;
  status: "running" | "paused" | "stopped";
  progress: number;
}

const { t } = useI18n();
const toast = useToast();

// State
const automationActive = ref(true);
const showReportModal = ref(false);

const rules = reactive<WorkflowRules>({
  autoAssignment: {
    enabled: true,
    skillBased: true,
    loadBalancing: true,
    priorityFirst: true,
  },
  autoProgression: {
    enabled: false,
    startDelay: 2,
    completeDelay: 5,
  },
  smartScheduling: {
    enabled: true,
    cookingTimeBased: true,
    batchSimilar: false,
    prepTimeConsidered: true,
  },
  qualityControl: {
    enabled: true,
    autoCheck: false,
    checkInterval: 120,
  },
});

const activeWorkflows = ref<ActiveWorkflow[]>([
  {
    id: "1",
    name: "智能訂單分配",
    description: "基於廚師技能和負載自動分配新訂單",
    status: "running",
    progress: 85,
  },
  {
    id: "2",
    name: "批次處理優化",
    description: "將相似訂單批次處理以提高效率",
    status: "running",
    progress: 60,
  },
  {
    id: "3",
    name: "品質監控",
    description: "自動監控訂單完成品質和時間",
    status: "paused",
    progress: 30,
  },
]);

const automationStats = reactive({
  tasksAutomated: 156,
  timeSaved: "2.3h",
  efficiencyGain: 23,
  errorReduction: 18,
});

const workflowReports = ref([
  {
    id: "1",
    title: "自動分配系統運行報告",
    description: "在過去1小時內成功自動分配了45個訂單",
    timestamp: "15:30",
    success: 45,
    failed: 2,
    timeSaved: "25分鐘",
  },
  {
    id: "2",
    title: "智能排程優化報告",
    description: "通過批次處理優化減少了30%的等待時間",
    timestamp: "14:45",
    success: 28,
    failed: 0,
    timeSaved: "18分鐘",
  },
]);

// Methods
const toggleAutomation = () => {
  automationActive.value = !automationActive.value;
  toast.success(
    automationActive.value
      ? t("workflow.automationEnabledToast")
      : t("workflow.automationDisabledToast"),
  );

  if (automationActive.value) {
    startAutomationProcesses();
  } else {
    stopAutomationProcesses();
  }
};

const toggleWorkflow = (workflowId: string) => {
  const workflow = activeWorkflows.value.find((w) => w.id === workflowId);
  if (workflow) {
    workflow.status = workflow.status === "running" ? "paused" : "running";
    toast.info(
      workflow.status === "running"
        ? t("workflow.workflowStarted", { name: workflow.name })
        : t("workflow.workflowPaused", { name: workflow.name }),
    );
  }
};

const saveWorkflowRules = () => {
  // Save rules to localStorage or API
  localStorage.setItem("kitchen-workflow-rules", JSON.stringify(rules));
  emit("workflow-updated", rules);
  toast.success(t("workflow.rulesSaved"));
};

const resetToDefaults = () => {
  Object.assign(rules, {
    autoAssignment: {
      enabled: true,
      skillBased: true,
      loadBalancing: true,
      priorityFirst: true,
    },
    autoProgression: {
      enabled: false,
      startDelay: 2,
      completeDelay: 5,
    },
    smartScheduling: {
      enabled: true,
      cookingTimeBased: true,
      batchSimilar: false,
      prepTimeConsidered: true,
    },
    qualityControl: {
      enabled: true,
      autoCheck: false,
      checkInterval: 120,
    },
  });
  toast.success(t("workflow.rulesReset"));
};

const exportWorkflowConfig = () => {
  const config = {
    rules,
    automationActive: automationActive.value,
    activeWorkflows: activeWorkflows.value,
    exportedAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `workflow-config-${new Date().toISOString().split("T")[0]}.json`;
  link.click();

  toast.success(t("workflow.configExported"));
};

const showWorkflowReport = () => {
  showReportModal.value = true;
};

const startAutomationProcesses = () => {
  // Start background processes for automation
  activeWorkflows.value.forEach((workflow) => {
    if (workflow.status === "paused") {
      workflow.status = "running";
    }
  });
};

const stopAutomationProcesses = () => {
  // Stop all running workflows
  activeWorkflows.value.forEach((workflow) => {
    if (workflow.status === "running") {
      workflow.status = "paused";
    }
  });
};

// Automation Logic
const processAutoAssignment = () => {
  if (!rules.autoAssignment.enabled || !automationActive.value) return;

  // Find unassigned orders
  const unassignedOrders = props.orders.filter(
    (order) => order.status === "confirmed" && !order.assignedChef,
  );

  unassignedOrders.forEach((order) => {
    if (rules.autoAssignment.priorityFirst && order.priority === "urgent") {
      // Assign to best available chef for urgent orders
      emit("auto-assignment", order.id, getBestChefForOrder(order));
    } else if (rules.autoAssignment.loadBalancing) {
      // Assign based on load balancing
      emit("auto-assignment", order.id, getLeastLoadedChef());
    }
  });
};

const processAutoProgression = () => {
  if (!rules.autoProgression.enabled || !automationActive.value) return;

  // Auto-start ready orders
  setTimeout(() => {
    const readyToStart = props.orders.filter(
      (order) => order.status === "confirmed" && order.assignedChef,
    );

    readyToStart.forEach((order) => {
      emit("auto-progression", order.id, "start_cooking");
    });
  }, rules.autoProgression.startDelay * 1000);

  // Auto-complete finished orders
  setTimeout(() => {
    const readyToComplete = props.orders.filter(
      (order) =>
        order.status === "preparing" &&
        order.estimatedTime &&
        order.elapsedTime >= order.estimatedTime,
    );

    readyToComplete.forEach((order) => {
      emit("auto-progression", order.id, "mark_ready");
    });
  }, rules.autoProgression.completeDelay * 1000);
};

const getBestChefForOrder = (_order: KitchenOrder): number => {
  // Simulate chef selection logic
  return Math.floor(Math.random() * 5) + 1;
};

const getLeastLoadedChef = (): number => {
  // Simulate load balancing logic
  return Math.floor(Math.random() * 5) + 1;
};

// Watchers
watch(
  () => props.orders,
  () => {
    if (automationActive.value) {
      processAutoAssignment();
      processAutoProgression();
    }
  },
  { deep: true },
);

// Lifecycle
onMounted(() => {
  // Load saved rules
  const savedRules = localStorage.getItem("kitchen-workflow-rules");
  if (savedRules) {
    Object.assign(rules, JSON.parse(savedRules));
  }

  // Start automation if enabled
  if (automationActive.value) {
    startAutomationProcesses();
  }

  // Update statistics periodically
  setInterval(() => {
    automationStats.tasksAutomated += Math.floor(Math.random() * 3);
    automationStats.efficiencyGain = Math.min(
      50,
      automationStats.efficiencyGain + Math.random(),
    );
  }, 30000);
});
</script>

<style scoped>
/* Custom animations */
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
