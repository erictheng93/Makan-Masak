<template>
  <div class="w-full">
    <!-- Toolbar -->
    <div class="bg-white rounded-lg shadow mb-6">
      <div class="p-4 space-y-4">
        <!-- Top Row -->
        <div class="flex flex-col md:flex-row gap-4">
          <!-- Search -->
          <div class="relative flex-1">
            <MagnifyingGlassIcon
              class="absolute left-3 top-3 h-4 w-4 text-gray-400"
            />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('scheduling.filters.searchEmployee')"
              class="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              v-if="searchQuery"
              :aria-label="t('a11y.clearSearch')"
              class="absolute right-3 top-3 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              @click="searchQuery = ''"
            >
              <XMarkIcon class="h-4 w-4" />
            </button>
          </div>

          <!-- Date Range -->
          <div
            class="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg"
          >
            <CalendarIcon class="h-4 w-4 text-gray-400" />
            <input
              v-model="startDate"
              type="date"
              class="border-none outline-none text-sm"
            />
            <span class="text-gray-400 text-sm">{{
              t("scheduling.filters.to")
            }}</span>
            <input
              v-model="endDate"
              type="date"
              class="border-none outline-none text-sm"
            />
          </div>
        </div>

        <!-- Bottom Row -->
        <div class="flex flex-col md:flex-row justify-between gap-4">
          <!-- Status Filter -->
          <select
            v-model="statusFilter"
            class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">{{ t("scheduling.filters.allStatus") }}</option>
            <option value="scheduled">{{ t("status.scheduled") }}</option>
            <option value="confirmed">{{ t("status.confirmed") }}</option>
            <option value="completed">{{ t("status.completed") }}</option>
            <option value="cancelled">{{ t("status.cancelled") }}</option>
          </select>

          <!-- Actions -->
          <div class="flex gap-2">
            <!-- Batch Actions -->
            <div class="relative">
              <button
                class="flex items-center gap-2 px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="selectedItems.length === 0"
                @click="showBatchMenu = !showBatchMenu"
              >
                <ClipboardDocumentListIcon class="h-4 w-4" />
                <span
                  >{{ t("scheduling.batch.title") }} ({{
                    selectedItems.length
                  }})</span
                >
              </button>

              <!-- Batch Menu -->
              <div
                v-if="showBatchMenu && selectedItems.length > 0"
                class="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10"
              >
                <button
                  class="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-50 transition-colors"
                  @click="batchConfirm"
                >
                  <CheckIcon class="h-4 w-4" />
                  <span>{{ t("scheduling.batch.confirmAll") }}</span>
                </button>
                <button
                  class="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-50 transition-colors"
                  @click="batchCancel"
                >
                  <XMarkIcon class="h-4 w-4" />
                  <span>{{ t("scheduling.batch.cancelAll") }}</span>
                </button>
                <button
                  class="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-50 transition-colors"
                  @click="batchExport"
                >
                  <ArrowDownTrayIcon class="h-4 w-4" />
                  <span>{{ t("scheduling.batch.exportSelected") }}</span>
                </button>
              </div>
            </div>

            <!-- Export Button -->
            <button
              class="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              @click="handleExport"
            >
              <ArrowDownTrayIcon class="h-4 w-4" />
              <span>{{ t("scheduling.exportReport") }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <div
        class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"
      ></div>
      <p class="mt-4 text-gray-600">{{ t("scheduling.loadingList") }}</p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="filteredSchedules.length === 0"
      class="text-center py-12 bg-white rounded-lg shadow"
    >
      <CalendarIcon class="h-16 w-16 text-gray-400 mx-auto mb-4" />
      <h3 class="text-lg font-semibold text-gray-900 mb-2">
        {{ t("scheduling.noData") }}
      </h3>
      <p class="text-gray-600">{{ t("scheduling.noDataHint") }}</p>
    </div>

    <!-- Schedules Table -->
    <div v-else class="bg-white rounded-lg shadow overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="w-12 px-6 py-3 text-center">
                <input
                  type="checkbox"
                  :checked="isAllSelected"
                  class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  @change="toggleSelectAll"
                />
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                @click="toggleSort('workDate')"
              >
                <div class="flex items-center gap-2">
                  <span>{{ t("scheduling.columns.date") }}</span>
                  <span v-if="sortBy === 'workDate'" class="text-blue-600">
                    {{ sortOrder === "asc" ? "↑" : "↓" }}
                  </span>
                </div>
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                @click="toggleSort('employeeName')"
              >
                <div class="flex items-center gap-2">
                  <span>{{ t("scheduling.columns.employee") }}</span>
                  <span v-if="sortBy === 'employeeName'" class="text-blue-600">
                    {{ sortOrder === "asc" ? "↑" : "↓" }}
                  </span>
                </div>
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("scheduling.columns.shift") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("scheduling.columns.time") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                @click="toggleSort('scheduledHours')"
              >
                <div class="flex items-center gap-2">
                  <span>{{ t("scheduling.columns.hours") }}</span>
                  <span
                    v-if="sortBy === 'scheduledHours'"
                    class="text-blue-600"
                  >
                    {{ sortOrder === "asc" ? "↑" : "↓" }}
                  </span>
                </div>
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("scheduling.columns.clockIn") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("scheduling.columns.clockOut") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("scheduling.columns.actualHours") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("scheduling.columns.status") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("common.actions") }}
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr
              v-for="schedule in paginatedSchedules"
              :key="schedule.id"
              :class="[
                'hover:bg-gray-50 transition-colors',
                isSelected(schedule.id) ? 'bg-blue-50' : '',
              ]"
            >
              <td class="px-6 py-4 whitespace-nowrap text-center">
                <input
                  type="checkbox"
                  :checked="isSelected(schedule.id)"
                  class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  @change="toggleSelect(schedule.id)"
                />
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ formatDate(schedule.workDate) }}
              </td>
              <td
                class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900"
              >
                {{ schedule.employeeName }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span
                  v-if="schedule.shiftTemplate"
                  class="px-3 py-1 text-xs font-medium rounded-full border"
                  :style="{
                    backgroundColor: schedule.shiftTemplate.colorCode + '20',
                    color: schedule.shiftTemplate.colorCode,
                    borderColor: schedule.shiftTemplate.colorCode,
                  }"
                >
                  {{ schedule.shiftTemplate.name }}
                </span>
                <span v-else class="text-gray-400 text-sm">-</span>
              </td>
              <td
                class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono"
              >
                {{ schedule.startTime }} - {{ schedule.endTime }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ schedule.scheduledHours }} {{ t("scheduling.hoursUnit") }}
              </td>
              <td
                class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono"
              >
                {{ formatClockTime(schedule.clockInTime) }}
              </td>
              <td
                class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono"
              >
                {{ formatClockTime(schedule.clockOutTime) }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{
                  schedule.actualHours != null
                    ? Math.round(schedule.actualHours * 10) / 10 + " h"
                    : "—"
                }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-block w-2 h-2 rounded-full"
                    :class="getClockStatusDotClass(schedule)"
                  ></span>
                  <span
                    :class="[
                      'px-3 py-1 text-xs font-medium rounded-full border',
                      getStatusClass(schedule.status),
                    ]"
                  >
                    {{ getStatusLabel(schedule.status) }}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <div class="flex gap-2">
                  <button
                    class="p-1 text-gray-400 hover:text-blue-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                    :title="t('common.edit')"
                    :aria-label="t('common.edit')"
                    @click="$emit('edit', schedule)"
                  >
                    <PencilIcon class="h-4 w-4" />
                  </button>
                  <button
                    class="p-1 text-gray-400 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                    :title="t('common.delete')"
                    :aria-label="t('common.delete')"
                    @click="$emit('delete', schedule)"
                  >
                    <TrashIcon class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div
        v-if="totalPages > 1"
        class="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50"
      >
        <div class="text-sm text-gray-700">
          {{
            t("scheduling.pagination.showing", {
              start: startIndex + 1,
              end: endIndex,
              total: filteredSchedules.length,
            })
          }}
        </div>

        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="currentPage === 1"
            :title="t('scheduling.pagination.firstPage')"
            @click="goToPage(1)"
          >
            ««
          </button>
          <button
            :aria-label="t('common.previousPage')"
            class="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :disabled="currentPage === 1"
            @click="goToPage(currentPage - 1)"
          >
            <ChevronLeftIcon class="h-4 w-4" />
          </button>

          <div class="flex gap-1">
            <button
              v-for="page in visiblePages"
              :key="page"
              :class="[
                'px-3 py-1 border rounded',
                page === currentPage
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 hover:bg-gray-100',
              ]"
              @click="goToPage(page)"
            >
              {{ page }}
            </button>
          </div>

          <button
            :aria-label="t('common.nextPage')"
            class="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :disabled="currentPage === totalPages"
            @click="goToPage(currentPage + 1)"
          >
            <ChevronRightIcon class="h-4 w-4" />
          </button>
          <button
            class="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="currentPage === totalPages"
            :title="t('scheduling.pagination.lastPage')"
            @click="goToPage(totalPages)"
          >
            »»
          </button>
        </div>

        <select
          v-model.number="pageSize"
          class="px-3 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option :value="10">
            10 / {{ t("scheduling.pagination.page") }}
          </option>
          <option :value="20">
            20 / {{ t("scheduling.pagination.page") }}
          </option>
          <option :value="50">
            50 / {{ t("scheduling.pagination.page") }}
          </option>
          <option :value="100">
            100 / {{ t("scheduling.pagination.page") }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useDateFormatter } from "@/composables/useDateFormatter";
import type { EmployeeSchedule } from "@/types/scheduling";
import { toCsv } from "@/utils/csv";

const { t } = useI18n();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
const { formatTime } = useDateFormatter();
import {
  MagnifyingGlassIcon,
  CalendarIcon,
  XMarkIcon,
  ClipboardDocumentListIcon,
  CheckIcon,
  ArrowDownTrayIcon,
  PencilIcon,
  TrashIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/vue/24/outline";

interface Props {
  schedules: EmployeeSchedule[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
});

const emit = defineEmits<{
  (e: "edit", schedule: EmployeeSchedule): void;
  (e: "delete", schedule: EmployeeSchedule): void;
  (e: "batchUpdate", ids: number[], action: string): void;
}>();

// State
const searchQuery = ref("");
const statusFilter = ref("");
const startDate = ref("");
const endDate = ref("");
const showBatchMenu = ref(false);
const selectedItems = ref<number[]>([]);

// Sorting
const sortBy = ref<"workDate" | "employeeName" | "scheduledHours">("workDate");
const sortOrder = ref<"asc" | "desc">("desc");

// Pagination
const currentPage = ref(1);
const pageSize = ref(20);

// Computed - Filtered and Sorted
const filteredSchedules = computed(() => {
  let result = props.schedules;

  // Search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(
      (s) => s.employeeName?.toLowerCase().includes(query) ?? false,
    );
  }

  // Status filter
  if (statusFilter.value) {
    result = result.filter((s) => s.status === statusFilter.value);
  }

  // Date range filter
  if (startDate.value) {
    result = result.filter(
      (s) => new Date(s.workDate) >= new Date(startDate.value),
    );
  }
  if (endDate.value) {
    result = result.filter(
      (s) => new Date(s.workDate) <= new Date(endDate.value),
    );
  }

  // Sorting
  return result.sort((a, b) => {
    let compareValue = 0;

    if (sortBy.value === "workDate") {
      compareValue =
        new Date(a.workDate).getTime() - new Date(b.workDate).getTime();
    } else if (sortBy.value === "employeeName") {
      compareValue = (a.employeeName || "").localeCompare(b.employeeName || "");
    } else if (sortBy.value === "scheduledHours") {
      compareValue = (a.scheduledHours || 0) - (b.scheduledHours || 0);
    }

    return sortOrder.value === "asc" ? compareValue : -compareValue;
  });
});

// Computed - Pagination
const totalPages = computed(() =>
  Math.ceil(filteredSchedules.value.length / pageSize.value),
);
const startIndex = computed(() => (currentPage.value - 1) * pageSize.value);
const endIndex = computed(() =>
  Math.min(startIndex.value + pageSize.value, filteredSchedules.value.length),
);

const paginatedSchedules = computed(() => {
  return filteredSchedules.value.slice(startIndex.value, endIndex.value);
});

const visiblePages = computed(() => {
  const pages: number[] = [];
  const maxVisible = 5;
  let start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2));
  const end = Math.min(totalPages.value, start + maxVisible - 1);

  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return pages;
});

// Computed - Selection
const isAllSelected = computed(() => {
  return (
    paginatedSchedules.value.length > 0 &&
    paginatedSchedules.value.every((s) => selectedItems.value.includes(s.id))
  );
});

// Watch - Reset page when filters change
watch([searchQuery, statusFilter, startDate, endDate, pageSize], () => {
  currentPage.value = 1;
});

// Methods - Sorting
const toggleSort = (field: "workDate" | "employeeName" | "scheduledHours") => {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    sortBy.value = field;
    sortOrder.value = "asc";
  }
};

// Methods - Selection
const toggleSelect = (id: number) => {
  const index = selectedItems.value.indexOf(id);
  if (index > -1) {
    selectedItems.value.splice(index, 1);
  } else {
    selectedItems.value.push(id);
  }
};

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    const currentPageIds = paginatedSchedules.value.map((s) => s.id);
    selectedItems.value = selectedItems.value.filter(
      (id) => !currentPageIds.includes(id),
    );
  } else {
    const currentPageIds = paginatedSchedules.value.map((s) => s.id);
    const newIds = currentPageIds.filter(
      (id) => !selectedItems.value.includes(id),
    );
    selectedItems.value.push(...newIds);
  }
};

const isSelected = (id: number): boolean => {
  return selectedItems.value.includes(id);
};

// Methods - Pagination
const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page;
  }
};

// Methods - Batch Operations
const batchConfirm = async () => {
  if (selectedItems.value.length === 0) return;

  const confirmed = await confirmModal({
    type: "warning",
    title: t("scheduling.batch.confirm"),
    message: t("scheduling.batch.confirmAction", {
      count: selectedItems.value.length,
    }),
    confirmLabel: t("common.confirm"),
  });
  if (!confirmed) return;
  emit("batchUpdate", selectedItems.value, "confirm");
  selectedItems.value = [];
  showBatchMenu.value = false;
};

const batchCancel = async () => {
  if (selectedItems.value.length === 0) return;

  const confirmed = await confirmModal({
    type: "danger",
    title: t("scheduling.batch.cancel"),
    message: t("scheduling.batch.cancelConfirm", {
      count: selectedItems.value.length,
    }),
    confirmLabel: t("common.cancel"),
  });
  if (!confirmed) return;
  emit("batchUpdate", selectedItems.value, "cancel");
  selectedItems.value = [];
  showBatchMenu.value = false;
};

const batchExport = () => {
  if (selectedItems.value.length === 0) return;

  const selectedSchedules = props.schedules.filter((s) =>
    selectedItems.value.includes(s.id),
  );
  exportToCSV(
    selectedSchedules,
    `${t("scheduling.exportFilename")}_${t("scheduling.exportSelected")}_${new Date().toISOString().split("T")[0]}.csv`,
  );
  showBatchMenu.value = false;
};

// Methods - Export
const handleExport = () => {
  exportToCSV(
    filteredSchedules.value,
    `${t("scheduling.exportFilename")}_${new Date().toISOString().split("T")[0]}.csv`,
  );
};

const exportToCSV = (data: EmployeeSchedule[], filename: string) => {
  if (data.length === 0) {
    toast.warning(t("scheduling.noExportData"));
    return;
  }

  const headers = [
    t("scheduling.columns.date"),
    t("scheduling.columns.weekday"),
    t("scheduling.columns.employee"),
    t("scheduling.columns.shift"),
    t("scheduling.columns.startTime"),
    t("scheduling.columns.endTime"),
    t("scheduling.columns.hours"),
    t("scheduling.columns.status"),
  ];
  const rows = data.map((schedule) => {
    const date = new Date(schedule.workDate);
    const dayNames = [
      t("weekdays.mini.sunday"),
      t("weekdays.mini.monday"),
      t("weekdays.mini.tuesday"),
      t("weekdays.mini.wednesday"),
      t("weekdays.mini.thursday"),
      t("weekdays.mini.friday"),
      t("weekdays.mini.saturday"),
    ];

    return [
      schedule.workDate,
      dayNames[date.getDay()],
      schedule.employeeName || "",
      schedule.shiftTemplate?.name || "-",
      schedule.startTime,
      schedule.endTime,
      schedule.scheduledHours?.toString() || "0",
      getStatusLabel(schedule.status),
    ];
  });

  const csvContent = toCsv([headers, ...rows]);

  const bom = "\uFEFF";
  const blob = new Blob([bom + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Methods - Formatting
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = [
    t("weekdays.mini.sunday"),
    t("weekdays.mini.monday"),
    t("weekdays.mini.tuesday"),
    t("weekdays.mini.wednesday"),
    t("weekdays.mini.thursday"),
    t("weekdays.mini.friday"),
    t("weekdays.mini.saturday"),
  ];
  const weekday = dayNames[date.getDay()];
  return `${month}/${day} (${weekday})`;
};

const getStatusLabel = (status: string): string => {
  const key = `status.${status}`;
  const translated = t(key);
  return translated !== key ? translated : status;
};

const formatClockTime = (timeStr: string | null | undefined): string => {
  if (!timeStr) return "—";
  try {
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return "—";
    // Pass the Date through — formatTime treats a string as an "HH:mm"
    // time-of-day, not an ISO datetime.
    return formatTime(date);
  } catch {
    return "—";
  }
};

const getClockStatusDotClass = (schedule: EmployeeSchedule): string => {
  const clockedIn = schedule.clockInTime;
  const clockedOut = schedule.clockOutTime;
  // Currently working: clocked in but not out
  if (clockedIn && !clockedOut) {
    return "bg-green-500 animate-pulse";
  }
  // No-show or late
  if (schedule.status === "no_show") {
    return "bg-red-500";
  }
  // Completed
  if (schedule.status === "completed") {
    return "bg-teal-500";
  }
  // Not yet started
  return "bg-gray-400";
};

const getStatusClass = (status: string): string => {
  const classes: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-800 border-blue-200",
    confirmed: "bg-green-100 text-green-800 border-green-200",
    completed: "bg-teal-100 text-teal-800 border-teal-200",
    cancelled: "bg-red-100 text-red-800 border-red-200",
    no_show: "bg-yellow-100 text-yellow-800 border-yellow-200",
  };
  return classes[status] || "bg-gray-100 text-gray-800 border-gray-200";
};
</script>
