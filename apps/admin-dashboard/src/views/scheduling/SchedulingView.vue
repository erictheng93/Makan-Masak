<template>
  <div class="users-view">
    <!-- 頁面標題和操作 -->
    <div
      class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
    >
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          {{ t("scheduling.managementTitle") }}
        </h1>
        <p class="text-gray-600">
          {{ t("scheduling.managementSubtitle") }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="flex items-center whitespace-nowrap px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          :disabled="isRefreshing"
          @click="refreshData"
        >
          <ArrowPathIcon class="h-4 w-4 mr-2" />
          {{ t("common.refresh") }}
        </button>
        <button
          class="flex items-center whitespace-nowrap px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          @click="showCreateTemplateModal"
        >
          <PlusIcon class="h-4 w-4 mr-2" />
          {{ t("scheduling.addTemplate") }}
        </button>
        <button
          class="flex items-center whitespace-nowrap px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          @click="showCreateScheduleModal"
        >
          <PlusIcon class="h-4 w-4 mr-2" />
          {{ t("scheduling.createSchedule") }}
        </button>
      </div>
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-2 bg-blue-100 rounded-lg">
            <CalendarIcon class="h-6 w-6 text-blue-600" />
          </div>
          <div class="ml-4">
            <h3 class="text-sm font-semibold text-gray-900">
              {{ t("scheduling.monthlySchedules") }}
            </h3>
            <p class="text-xl font-bold text-blue-600">
              {{ schedulesLoading ? "—" : schedules.length }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-2 bg-green-100 rounded-lg">
            <CalendarIcon class="h-6 w-6 text-green-600" />
          </div>
          <div class="ml-4">
            <h3 class="text-sm font-semibold text-gray-900">
              {{ t("shiftTemplates.title") }}
            </h3>
            <p class="text-xl font-bold text-green-600">
              {{ templatesLoading ? "—" : shiftTemplates.length }}
            </p>
          </div>
        </div>
      </div>

      <div v-if="conflicts.length > 0" class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-2 bg-yellow-100 rounded-lg">
            <ExclamationTriangleIcon class="h-6 w-6 text-yellow-600" />
          </div>
          <div class="ml-4">
            <h3 class="text-sm font-semibold text-gray-900">
              {{ t("scheduling.pendingConflicts") }}
            </h3>
            <p class="text-xl font-bold text-yellow-600">
              {{ conflicts.length }}
            </p>
          </div>
        </div>
      </div>

      <div
        v-if="swapRequests.length > 0"
        class="bg-white rounded-lg shadow p-6"
      >
        <div class="flex items-center">
          <div class="p-2 bg-teal-100 rounded-lg">
            <ArrowPathIcon class="h-6 w-6 text-teal-600" />
          </div>
          <div class="ml-4">
            <h3 class="text-sm font-semibold text-gray-900">
              {{ t("scheduling.pendingSwaps") }}
            </h3>
            <p class="text-xl font-bold text-teal-600">
              {{ swapRequests.filter((r) => r.status === "pending").length }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Currently Working Employees -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-gray-900">
          {{ t("scheduling.currentlyWorking") }}
        </h3>
        <span
          class="px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full"
        >
          {{
            clockedInLoading
              ? "—"
              : t("scheduling.peopleCount", {
                  count: clockedInEmployees.length,
                })
          }}
        </span>
      </div>
      <div
        v-if="clockedInLoading"
        class="flex items-center justify-center py-4 text-gray-400"
      >
        <div
          class="animate-spin h-5 w-5 border-2 border-green-500 border-t-transparent rounded-full mr-2"
        ></div>
        <span class="text-sm">{{ t("common.loading") }}</span>
      </div>
      <div
        v-else-if="clockedInEmployees.length === 0"
        class="text-center py-4 text-gray-500"
      >
        {{ t("scheduling.noEmployeesWorking") }}
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="emp in clockedInEmployees"
          :key="emp.id"
          class="flex items-center space-x-3 p-3 bg-green-50 rounded-lg"
        >
          <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <div>
            <div class="font-medium text-gray-900">
              {{
                emp.employeeName ||
                t("scheduling.employeeNumber", { id: emp.employeeId })
              }}
            </div>
            <div class="text-xs text-gray-500">
              {{
                t("scheduling.since", {
                  time: formatClockTime(emp.clockInTime),
                })
              }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error Banner -->
    <div
      v-if="error"
      class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center justify-between"
    >
      <div class="flex items-center">
        <ExclamationCircleIcon class="h-5 w-5 text-red-600 mr-3" />
        <span class="text-sm text-red-800 font-medium">{{ error }}</span>
      </div>
      <button class="text-red-600 hover:text-red-800" @click="error = null">
        <XMarkIcon class="h-5 w-5" />
      </button>
    </div>

    <!-- Tab Navigation -->
    <div class="bg-white rounded-lg shadow mb-6">
      <div class="border-b border-gray-200">
        <nav
          class="-mb-px flex overflow-x-auto space-x-8 px-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
          aria-label="Tabs"
          tabindex="0"
        >
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :class="[
              'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center transition-colors',
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ]"
            @click="switchTab(tab.id)"
          >
            <component :is="getIconComponent(tab.icon)" class="h-5 w-5 mr-2" />
            {{ tab.label }}
            <span
              v-if="tab.badge"
              :class="[
                'ml-2 py-0.5 px-2 rounded-full text-xs font-medium',
                activeTab === tab.id
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-gray-100 text-gray-600',
              ]"
            >
              {{ tab.badge }}
            </span>
          </button>
        </nav>
      </div>
    </div>

    <!-- Tab Content -->
    <div class="bg-white rounded-lg shadow p-6">
      <!-- Calendar View -->
      <div v-if="activeTab === 'calendar'">
        <SchedulingCalendar
          :schedules="schedules"
          :loading="schedulesLoading"
          @date-select="handleDateSelect"
          @schedule-click="handleScheduleClick"
        />
      </div>

      <!-- List View -->
      <div v-if="activeTab === 'list'">
        <SchedulingList
          :schedules="schedules"
          :loading="schedulesLoading"
          @edit="handleEditSchedule"
          @delete="handleDeleteSchedule"
        />
      </div>

      <!-- Shift Templates -->
      <div v-if="activeTab === 'templates'">
        <ShiftTemplatesList
          :templates="shiftTemplates"
          :loading="templatesLoading"
          @edit="handleEditTemplate"
          @delete="handleDeleteTemplate"
        />
      </div>

      <!-- Conflicts -->
      <div v-if="activeTab === 'conflicts'">
        <SchedulingConflicts
          :conflicts="conflicts"
          :loading="conflictsLoading"
          @resolve="handleResolveConflict"
        />
      </div>

      <!-- Swap Requests -->
      <div v-if="activeTab === 'swaps'">
        <SwapRequests
          :requests="swapRequests"
          :loading="swapsLoading"
          @approve="handleApproveSwap"
          @reject="handleRejectSwap"
        />
      </div>
    </div>

    <!-- Create/Edit Schedule Modal -->
    <ScheduleFormModal
      v-if="showScheduleModal"
      :schedule="selectedSchedule"
      :shift-templates="shiftTemplates"
      @save="handleSaveSchedule"
      @close="closeScheduleModal"
    />

    <!-- Create/Edit Shift Template Modal -->
    <ShiftTemplateFormModal
      v-model="showTemplateFormModal"
      :template="selectedTemplate"
      :restaurant-id="restaurantId"
      @save="handleSaveTemplate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, type Component } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useAuthStore } from "@/stores/auth";
import { unwrapApiList } from "@/services/api";
import { schedulingService } from "@/services/schedulingService";
import type {
  EmployeeSchedule,
  ShiftTemplate,
  SchedulingConflict,
  SwapRequest,
  CreateScheduleData,
} from "@/types/scheduling";
import {
  CalendarIcon,
  PlusIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  XMarkIcon,
  ListBulletIcon,
} from "@heroicons/vue/24/outline";
import SchedulingCalendar from "@/components/scheduling/SchedulingCalendar.vue";
import SchedulingList from "@/components/scheduling/SchedulingList.vue";
import ShiftTemplatesList from "@/components/scheduling/ShiftTemplatesList.vue";
import SchedulingConflicts from "@/components/scheduling/SchedulingConflicts.vue";
import SwapRequests from "@/components/scheduling/SwapRequests.vue";
import ScheduleFormModal from "@/components/scheduling/ScheduleFormModal.vue";
import ShiftTemplateFormModal from "@/components/scheduling/ShiftTemplateFormModal.vue";
import type { ShiftTemplateSaveData } from "@/components/scheduling/ShiftTemplateFormModal.vue";

// i18n
const { t } = useI18n();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
const { formatTime } = useDateFormatter();

// Auth
const authStore = useAuthStore();

// Per-section loading states (tiered progressive loading)
const schedulesLoading = ref(true);
const templatesLoading = ref(true);
const conflictsLoading = ref(true);
const swapsLoading = ref(true);
const clockedInLoading = ref(true);
const isRefreshing = computed(
  () =>
    schedulesLoading.value ||
    templatesLoading.value ||
    conflictsLoading.value ||
    swapsLoading.value ||
    clockedInLoading.value,
);
const error = ref<string | null>(null);
const activeTab = ref("calendar");
const schedules = ref<EmployeeSchedule[]>([]);
const shiftTemplates = ref<ShiftTemplate[]>([]);
const conflicts = ref<SchedulingConflict[]>([]);
const swapRequests = ref<SwapRequest[]>([]);
const clockedInEmployees = ref<EmployeeSchedule[]>([]);
const showScheduleModal = ref(false);
const selectedSchedule = ref<EmployeeSchedule | null>(null);
const showTemplateFormModal = ref(false);
const selectedTemplate = ref<ShiftTemplate | null>(null);

// Get restaurant ID from auth store — use authStore.restaurantId which handles admin managing other restaurants
const restaurantId = computed(() => authStore.restaurantId || "");

// Icon mapping for tabs
const getIconComponent = (icon: string) => {
  const iconMap: Record<string, Component> = {
    calendar: CalendarIcon,
    list: ListBulletIcon,
    templates: CalendarIcon,
    conflicts: ExclamationTriangleIcon,
    swaps: ArrowPathIcon,
  };
  return iconMap[icon] || CalendarIcon;
};

// Tabs
const tabs = computed(() => [
  {
    id: "calendar",
    label: t("scheduling.calendar"),
    icon: "calendar",
    badge: null,
  },
  {
    id: "list",
    label: t("scheduling.list"),
    icon: "list",
    badge: schedules.value.length || null,
  },
  {
    id: "templates",
    label: t("shiftTemplates.title"),
    icon: "templates",
    badge: shiftTemplates.value.length || null,
  },
  {
    id: "conflicts",
    label: t("scheduling.conflictWarnings"),
    icon: "conflicts",
    badge: conflicts.value.filter((c) => c.severity === "error").length || null,
  },
  {
    id: "swaps",
    label: t("swapRequests.title"),
    icon: "swaps",
    badge:
      swapRequests.value.filter((r) => r.status === "pending").length || null,
  },
]);

// Methods
const switchTab = (tabId: string) => {
  activeTab.value = tabId;
};

const refreshData = async () => {
  error.value = null;
  await Promise.all([
    fetchSchedules(),
    fetchShiftTemplates(),
    fetchConflicts(),
    fetchSwapRequests(),
    fetchClockedIn(),
  ]);
};

const fetchSchedules = async () => {
  schedulesLoading.value = true;
  try {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const response = await schedulingService.getSchedules({
      restaurantId: restaurantId.value,
      startDate: formatDate(today),
      endDate: formatDate(endDate),
      limit: 100,
    });

    schedules.value = unwrapApiList<EmployeeSchedule>(response);
  } catch (err) {
    console.error("Failed to fetch schedules:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to load schedules";
  } finally {
    schedulesLoading.value = false;
  }
};

const fetchShiftTemplates = async () => {
  templatesLoading.value = true;
  try {
    shiftTemplates.value = await schedulingService.getShiftTemplates(
      restaurantId.value,
    );
  } catch (err) {
    console.error("Failed to fetch shift templates:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to load shift templates";
  } finally {
    templatesLoading.value = false;
  }
};

const fetchConflicts = async () => {
  conflictsLoading.value = true;
  try {
    const response = await schedulingService.getConflicts({
      restaurantId: restaurantId.value,
      status: "unresolved",
      limit: 50,
    });
    conflicts.value = unwrapApiList<SchedulingConflict>(response);
  } catch (err) {
    console.error("Failed to fetch conflicts:", err);
    conflicts.value = [];
  } finally {
    conflictsLoading.value = false;
  }
};

const fetchSwapRequests = async () => {
  swapsLoading.value = true;
  try {
    const response = await schedulingService.getSwapRequests({
      restaurantId: restaurantId.value,
      status: "pending",
      limit: 50,
    });
    swapRequests.value = unwrapApiList<SwapRequest>(response);
  } catch (err) {
    console.error("Failed to fetch swap requests:", err);
    swapRequests.value = [];
  } finally {
    swapsLoading.value = false;
  }
};

const fetchClockedIn = async () => {
  clockedInLoading.value = true;
  try {
    const response = await schedulingService.getClockedInEmployees(
      restaurantId.value,
    );
    clockedInEmployees.value = response;
  } catch (err) {
    console.error("Failed to fetch clocked-in employees:", err);
    clockedInEmployees.value = [];
  } finally {
    clockedInLoading.value = false;
  }
};

const formatClockTime = (timeStr: string | null | undefined): string => {
  if (!timeStr) return "—";
  try {
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return "—";
    return formatTime(date);
  } catch {
    return "—";
  }
};

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const showCreateScheduleModal = () => {
  selectedSchedule.value = null;
  showScheduleModal.value = true;
};

const closeScheduleModal = () => {
  showScheduleModal.value = false;
  selectedSchedule.value = null;
};

const handleDateSelect = (date: string) => {
  console.log("Date selected:", date);
  // TODO: Filter schedules by date or open create modal
};

const handleScheduleClick = (schedule: EmployeeSchedule) => {
  selectedSchedule.value = schedule;
  showScheduleModal.value = true;
};

const handleEditSchedule = (schedule: EmployeeSchedule) => {
  selectedSchedule.value = schedule;
  showScheduleModal.value = true;
};

const handleDeleteSchedule = async (schedule: EmployeeSchedule) => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("scheduling.deleteSchedule"),
    message: t("scheduling.confirmDeleteSchedule"),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;

  try {
    await schedulingService.deleteSchedule(schedule.id);
    await refreshData();
  } catch (err) {
    console.error("Failed to delete schedule:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to delete schedule";
    toast.error(t("scheduling.deleteScheduleFailed"));
  }
};

const handleSaveSchedule = async (scheduleData: CreateScheduleData) => {
  try {
    if (selectedSchedule.value?.id) {
      await schedulingService.updateSchedule(
        selectedSchedule.value.id,
        scheduleData,
      );
    } else {
      await schedulingService.createSchedule(restaurantId.value, scheduleData);
    }

    closeScheduleModal();
    await refreshData();
  } catch (err) {
    console.error("Failed to save schedule:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to save schedule";
    toast.error(t("scheduling.saveScheduleFailed"));
  }
};

const handleEditTemplate = (template: ShiftTemplate) => {
  selectedTemplate.value = template;
  showTemplateFormModal.value = true;
};

const showCreateTemplateModal = () => {
  selectedTemplate.value = null;
  showTemplateFormModal.value = true;
};

const handleSaveTemplate = async (templateData: ShiftTemplateSaveData) => {
  try {
    if (selectedTemplate.value?.id) {
      await schedulingService.updateShiftTemplate(
        selectedTemplate.value.id,
        templateData,
      );
    } else {
      await schedulingService.createShiftTemplate(
        restaurantId.value,
        templateData,
      );
    }

    showTemplateFormModal.value = false;
    selectedTemplate.value = null;
    await refreshData();
  } catch (err) {
    console.error("Failed to save template:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to save template";
    toast.error(t("scheduling.saveTemplateFailed"));
  }
};

const handleDeleteTemplate = async (template: ShiftTemplate) => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("scheduling.deleteTemplate"),
    message: t("scheduling.confirmDeleteTemplate", { name: template.name }),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;

  try {
    await schedulingService.deleteShiftTemplate(template.id);
    await refreshData();
  } catch (err) {
    console.error("Failed to delete template:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to delete template";
    toast.error(t("scheduling.deleteTemplateFailed"));
  }
};

const handleResolveConflict = async (conflict: SchedulingConflict) => {
  const userId = authStore.user?.id;
  if (!userId) {
    toast.error(t("scheduling.cannotGetUserInfo"));
    return;
  }

  const resolutionNotes = prompt(t("scheduling.enterResolutionNotes"));
  if (resolutionNotes) {
    try {
      await schedulingService.resolveConflict(
        conflict.id,
        userId,
        resolutionNotes,
      );
      await refreshData();
    } catch (err) {
      console.error("Failed to resolve conflict:", err);
      error.value =
        err instanceof Error ? err.message : "Failed to resolve conflict";
      toast.error(t("scheduling.resolveConflictFailed"));
    }
  }
};

const handleApproveSwap = async (request: SwapRequest) => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("swapRequests.actions.approve"),
    message: t("swapRequests.actions.approveConfirm"),
    confirmLabel: t("swapRequests.actions.approve"),
  });
  if (!confirmed) return;

  const managerId = authStore.user?.id;
  if (!managerId) {
    toast.error(t("scheduling.cannotGetManagerInfo"));
    return;
  }

  try {
    await schedulingService.approveSwapRequest(request.id, managerId);
    await refreshData();
  } catch (err) {
    console.error("Failed to approve swap request:", err);
    error.value = err instanceof Error ? err.message : "Failed to approve swap";
    toast.error(t("scheduling.approveSwapFailed"));
  }
};

const handleRejectSwap = async (request: SwapRequest) => {
  const reason = prompt(t("scheduling.enterRejectReason"));
  if (reason) {
    const managerId = authStore.user?.id;
    if (!managerId) {
      toast.error(t("scheduling.cannotGetManagerInfo"));
      return;
    }

    try {
      await schedulingService.rejectSwapRequest(request.id, managerId, reason);
      await refreshData();
    } catch (err) {
      console.error("Failed to reject swap request:", err);
      error.value =
        err instanceof Error ? err.message : "Failed to reject swap";
      toast.error(t("scheduling.rejectSwapFailed"));
    }
  }
};

// Lifecycle — tiered progressive loading
onMounted(async () => {
  // Tier 1: await critical path — default calendar tab needs this
  await fetchSchedules();

  // Tier 2 & 3: fire-and-forget — UI renders immediately, data fills in
  fetchClockedIn();
  fetchShiftTemplates();
  fetchConflicts();
  fetchSwapRequests();
});
</script>
