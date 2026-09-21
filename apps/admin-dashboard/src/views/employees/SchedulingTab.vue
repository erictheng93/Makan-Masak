<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3">
      <!-- Date navigation -->
      <div
        class="flex items-center gap-1 bg-white rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-2 py-1"
      >
        <button
          data-testid="nav-prev"
          class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-ios-bg transition-colors text-ios-text/60 hover:text-ios-text"
          @click="shiftRange(-1)"
        >
          <ChevronLeft class="w-4 h-4" />
        </button>
        <span
          class="text-sm font-semibold text-ios-text min-w-[120px] text-center px-1"
        >
          {{ rangeLabel }}
        </span>
        <button
          data-testid="nav-next"
          class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-ios-bg transition-colors text-ios-text/60 hover:text-ios-text"
          @click="shiftRange(1)"
        >
          <ChevronRight class="w-4 h-4" />
        </button>
      </div>

      <!-- Today shortcut -->
      <button
        v-if="!isCurrentPeriod"
        class="px-3 py-1.5 text-xs font-medium rounded-full bg-ios-blue/10 text-ios-blue hover:bg-ios-blue/20 transition-colors"
        @click="goToToday"
      >
        {{ t("employees.scheduling.today") }}
      </button>

      <!-- View mode toggle -->
      <div class="flex bg-ios-bg rounded-full p-0.5">
        <button
          v-for="mode in ['week', 'month'] as const"
          :key="mode"
          class="px-3 py-1 text-xs font-semibold rounded-full transition-all"
          :class="
            viewMode === mode
              ? 'bg-white text-ios-text shadow-sm'
              : 'text-ios-text/50 hover:text-ios-text/70'
          "
          :data-active="viewMode === mode"
          @click="viewMode = mode"
        >
          {{
            mode === "week"
              ? t("employees.scheduling.week")
              : t("employees.scheduling.month")
          }}
        </button>
      </div>

      <RouterLink
        :to="{ name: 'AdvancedScheduling' }"
        data-testid="advanced-scheduling-link"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-white text-ios-blue border border-ios-blue/20 hover:bg-ios-blue/10 transition-colors"
      >
        {{ t("employees.scheduling.advancedScheduling") }}
      </RouterLink>

      <RouterLink
        :to="{ name: 'SchedulingAnalytics' }"
        data-testid="scheduling-analytics-link"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-white text-ios-blue border border-ios-blue/20 hover:bg-ios-blue/10 transition-colors"
      >
        {{ t("pages.schedulingAnalytics") }}
      </RouterLink>

      <!-- Manage templates button -->
      <button
        class="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors shadow-sm"
        @click="showTemplateManager = true"
      >
        <Settings class="w-3.5 h-3.5" />
        {{ t("employees.scheduling.manageTemplates") }}
      </button>
    </div>

    <!-- Loading skeleton -->
    <div
      v-if="loading"
      class="flex items-center justify-center py-16 text-ios-text/40"
    >
      <div class="flex flex-col items-center gap-3">
        <div
          class="w-8 h-8 border-2 border-ios-blue/30 border-t-ios-blue rounded-full animate-spin"
        />
        <p class="text-sm">{{ t("employees.scheduling.loading") }}</p>
      </div>
    </div>

    <!-- Error state -->
    <div
      v-else-if="loadError"
      class="bg-ios-red/5 border border-ios-red/20 rounded-2xl p-6 text-center"
    >
      <p class="text-sm text-ios-red">{{ loadError }}</p>
      <button
        class="mt-3 px-4 py-1.5 text-sm font-medium rounded-full bg-ios-red/10 text-ios-red hover:bg-ios-red/20 transition-colors"
        @click="loadAll"
      >
        {{ t("employees.scheduling.retry") }}
      </button>
    </div>

    <!-- Main grid + sidebar layout -->
    <template v-else>
      <!-- Conflict bar -->
      <SchedulingConflictBar :conflicts="conflicts" />

      <div class="flex gap-4 items-start">
        <!-- Calendar grid (takes remaining space) -->
        <div class="flex-1 min-w-0">
          <SchedulingCalendarGrid
            :schedules="schedules"
            :shift-templates="shiftTemplates"
            :date-range="dateRange"
            :view-mode="viewMode"
            @assign="handleAssign"
            @remove="handleRemove"
            @cell-click="handleCellClick"
          />
        </div>

        <!-- Right sidebar -->
        <div class="w-48 shrink-0">
          <UnassignedSidebar
            :employees="unassignedEmployees"
            :schedules="schedules"
            :leave-requests="leaveRequests"
            :selected-date="selectedDate"
            :shift-templates="shiftTemplates"
            :weekly-hours="weeklyHoursMap"
            @drag-start="onEmployeeDragStart"
          />
        </div>
      </div>
    </template>

    <!-- Assign confirmation modal (quick inline) -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="pendingAssignment"
          class="fixed inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          @click.self="pendingAssignment = null"
        >
          <div
            class="bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] p-6 w-72"
          >
            <h3 class="text-base font-bold text-ios-text mb-1">
              {{ t("employees.scheduling.confirmAssign") }}
            </h3>
            <p class="text-sm text-ios-text/60 mb-4">
              {{
                t("employees.scheduling.assignMessage", {
                  name: pendingAssignment.employeeName,
                  date: pendingAssignment.date,
                  template: pendingAssignment.templateName,
                })
              }}
            </p>
            <div class="flex gap-2">
              <button
                class="flex-1 px-3 py-2 text-sm font-medium rounded-full bg-ios-bg text-ios-text/60 hover:bg-ios-separator transition-colors"
                @click="pendingAssignment = null"
              >
                {{ t("employees.scheduling.cancel") }}
              </button>
              <button
                class="flex-1 px-3 py-2 text-sm font-semibold rounded-full bg-ios-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
                :disabled="assigning"
                @click="confirmAssign"
              >
                {{
                  assigning
                    ? t("employees.scheduling.assigning")
                    : t("employees.scheduling.confirm")
                }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Employee picker modal (click-to-assign) -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="cellClickTarget"
          class="fixed inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          @click.self="cellClickTarget = null"
        >
          <div
            class="bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] p-5 w-72 max-h-80 flex flex-col"
          >
            <h3 class="text-base font-bold text-ios-text mb-3">
              {{ t("employees.scheduling.selectEmployee") }}
            </h3>
            <div
              v-if="availableForCell.length === 0"
              class="text-sm text-ios-text/40 text-center py-4"
            >
              {{ t("employees.scheduling.noAvailableEmployees") }}
            </div>
            <div v-else class="flex flex-col gap-1 overflow-y-auto">
              <button
                v-for="emp in availableForCell"
                :key="emp.id"
                class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left hover:bg-ios-bg transition-colors"
                @click="selectEmployeeForCell(emp.id, emp.name)"
              >
                <span class="font-medium text-ios-text">{{ emp.name }}</span>
              </button>
            </div>
            <button
              class="mt-3 px-3 py-2 text-sm font-medium rounded-full bg-ios-bg text-ios-text/60 hover:bg-ios-separator transition-colors"
              @click="cellClickTarget = null"
            >
              {{ t("employees.scheduling.cancel") }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Shift template manager modal -->
    <ShiftTemplateManager
      :is-open="showTemplateManager"
      :templates="shiftTemplates"
      :restaurant-id="restaurantId"
      @close="showTemplateManager = false"
      @template-created="onTemplateCreated"
      @template-updated="onTemplateUpdated"
      @template-deleted="onTemplateDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { ChevronLeft, ChevronRight, Settings } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useAuthStore } from "@/stores/auth";
import { useEmployeeList } from "@/composables/useEmployeeList";
import { toLocalDateStr } from "@/utils/dateUtils";
import { schedulingService } from "@/services/schedulingService";
import { leavesService } from "@/services/leavesService";
import type { Employee } from "@/types/employee";
import type { UserId } from "@/types/api-user";
import type { ShiftTemplate, EmployeeSchedule } from "@/types/scheduling";
import type { LeaveRequest } from "@/services/leavesService";
import SchedulingCalendarGrid from "@/components/scheduling/SchedulingCalendarGrid.vue";
import UnassignedSidebar from "@/components/scheduling/UnassignedSidebar.vue";
import ShiftTemplateManager from "@/components/scheduling/ShiftTemplateManager.vue";
import SchedulingConflictBar from "@/components/scheduling/SchedulingConflictBar.vue";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

// ── Auth / restaurant ────────────────────────────────────
const { t } = useI18n();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
const authStore = useAuthStore();
const restaurantId = computed(() => authStore.restaurantId ?? "");

// ── Employee list ────────────────────────────────────────
const { users, fetchUsers } = useEmployeeList();

// ── View mode & date range ───────────────────────────────
const viewMode = ref<"week" | "month">("week");

function getWeekStart(d: Date): Date {
  const copy = new Date(d);
  const dow = copy.getDay(); // 0=Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + mondayOffset);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getMonthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

const anchorDate = ref(new Date()); // pivot date for navigation

const dateRange = computed<{ start: Date; end: Date }>(() => {
  if (viewMode.value === "week") {
    const start = getWeekStart(anchorDate.value);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  } else {
    const start = getMonthStart(anchorDate.value);
    const end = getMonthEnd(anchorDate.value);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
});

const rangeLabel = computed(() => {
  const { start, end } = dateRange.value;
  if (viewMode.value === "week") {
    const sm = start.getMonth() + 1;
    const sd = start.getDate();
    const em = end.getMonth() + 1;
    const ed = end.getDate();
    return sm === em ? `${sm}/${sd} - ${ed}` : `${sm}/${sd} - ${em}/${ed}`;
  } else {
    return t("employees.scheduling.monthLabel", {
      year: start.getFullYear(),
      month: start.getMonth() + 1,
    });
  }
});

const isCurrentPeriod = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today >= dateRange.value.start && today <= dateRange.value.end;
});

function shiftRange(dir: 1 | -1) {
  const copy = new Date(anchorDate.value);
  if (viewMode.value === "week") {
    copy.setDate(copy.getDate() + dir * 7);
  } else {
    copy.setMonth(copy.getMonth() + dir);
  }
  anchorDate.value = copy;
}

function goToToday() {
  anchorDate.value = new Date();
}

// ── Data ─────────────────────────────────────────────────
const shiftTemplates = ref<ShiftTemplate[]>([]);
const schedules = ref<EmployeeSchedule[]>([]);
const leaveRequests = ref<LeaveRequest[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

const selectedDate = ref<string | null>(null);

async function loadAll() {
  if (!restaurantId.value) return;
  loading.value = true;
  loadError.value = null;
  try {
    const startDateStr = toLocalDateStr(dateRange.value.start);
    const endDateStr = toLocalDateStr(dateRange.value.end);

    const [templates, sched, leaves] = await Promise.all([
      schedulingService.getShiftTemplates(restaurantId.value),
      schedulingService.getSchedules({
        restaurantId: restaurantId.value,
        startDate: startDateStr,
        endDate: endDateStr,
      }),
      leavesService.getRequests(restaurantId.value, {
        status: "approved",
        startDate: startDateStr,
        endDate: endDateStr,
      }),
    ]);

    shiftTemplates.value = templates;
    schedules.value = sched?.data ?? (Array.isArray(sched) ? sched : []);
    leaveRequests.value = leaves ?? [];
  } catch (e: unknown) {
    loadError.value = resolveUserFacingError(e, t, {
      fallbackKey: "employees.scheduling.loadFailed",
    }).message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([fetchUsers(), loadAll()]);
});

// Reload when date range changes
watch(dateRange, () => {
  loadAll();
});

/**
 * Whether this person can still be put on a shift.
 *
 * A departure is recorded by deactivating the account: the row is kept for its
 * order history, its sessions are revoked and it can no longer log in. Both
 * staff pickers below read the same unfiltered user list the roster does, so
 * without this they went on offering people who had left the restaurant --
 * shown with a green dot, and assignable.
 */
const isSchedulable = (employee: Employee): boolean =>
  employee.isActive && employee.status !== "suspended" && !employee.isArchived;

// ── Computed: unassigned employees ───────────────────────
const unassignedEmployees = computed(() => {
  const startStr = toLocalDateStr(dateRange.value.start);
  const endStr = toLocalDateStr(dateRange.value.end);

  // Employees that have at least one schedule in this period
  const assignedIds = new Set(
    schedules.value
      .filter((s) => s.workDate >= startStr && s.workDate <= endStr)
      .map((s) => s.employeeId),
  );

  return users.value
    .filter(isSchedulable)
    .filter((u) => !assignedIds.has(u.id))
    .map((u) => ({
      id: u.id,
      name: u.fullName || u.username,
      fullName: u.fullName,
      role: u.role,
    }));
});

// ── Computed: weekly hours per employee ──────────────────
const weeklyHoursMap = computed<Record<UserId, number>>(() => {
  const map: Record<UserId, number> = {};
  for (const s of schedules.value) {
    if (s.scheduledHours) {
      map[s.employeeId] = (map[s.employeeId] ?? 0) + s.scheduledHours;
    }
  }
  return map;
});

// ── Computed: conflicts ──────────────────────────────────
const conflicts = computed(() => {
  const list: Array<{
    type: string;
    message: string;
    severity: "warning" | "error";
  }> = [];

  const startStr = toLocalDateStr(dateRange.value.start);
  const endStr = toLocalDateStr(dateRange.value.end);

  // Compute scheduled days per employee
  const daysPerEmployee: Record<UserId, Set<string>> = {};
  for (const s of schedules.value) {
    if (s.workDate >= startStr && s.workDate <= endStr) {
      if (!daysPerEmployee[s.employeeId])
        daysPerEmployee[s.employeeId] = new Set();
      daysPerEmployee[s.employeeId].add(s.workDate);
    }
  }

  // Check for employees scheduled 6+ days
  for (const [empId, days] of Object.entries(daysPerEmployee)) {
    if (days.size >= 6) {
      const emp = users.value.find((u) => u.id === empId);
      const name =
        emp?.fullName ||
        emp?.username ||
        t("employees.scheduling.employeeFallback", { id: empId });
      list.push({
        type: "consecutive_days",
        message: t("employees.scheduling.consecutiveDays", {
          name,
          days: days.size,
        }),
        severity: "warning",
      });
    }
  }

  // Check for understaffed slots (template cells with 0 employees on weekdays)
  if (viewMode.value === "week") {
    const cursor = new Date(dateRange.value.start);
    while (cursor <= dateRange.value.end) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        // weekday
        const dateStr = toLocalDateStr(cursor);
        for (const tpl of shiftTemplates.value) {
          const assigned = schedules.value.filter(
            (s) => s.shiftTemplateId === tpl.id && s.workDate === dateStr,
          ).length;
          if (assigned < (tpl.minEmployees ?? 1)) {
            const dayLabel = t(`employees.scheduling.weekday${dow}`);
            list.push({
              type: "understaffed",
              message: t("employees.scheduling.understaffed", {
                day: dayLabel,
                template: tpl.name,
                assigned,
                required: tpl.minEmployees ?? 1,
              }),
              severity: "warning",
            });
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Limit to 8 most important
  return list.slice(0, 8);
});

// ── Drag-and-drop assign ─────────────────────────────────
interface PendingAssignment {
  templateId: number;
  templateName: string;
  date: string;
  employeeId: UserId;
  employeeName: string;
}

const pendingAssignment = ref<PendingAssignment | null>(null);
const assigning = ref(false);
const cellClickTarget = ref<{ templateId: number; dateStr: string } | null>(
  null,
);

const availableForCell = computed(() => {
  if (!cellClickTarget.value) return [];
  const { templateId, dateStr } = cellClickTarget.value;
  const assignedIds = new Set(
    schedules.value
      .filter((s) => s.shiftTemplateId === templateId && s.workDate === dateStr)
      .map((s) => s.employeeId),
  );
  return users.value
    .filter(isSchedulable)
    .filter((u) => !assignedIds.has(u.id))
    .map((u) => ({ id: u.id, name: u.fullName || u.username, role: u.role }));
});

function handleAssign(templateId: number, date: string, employeeId: UserId) {
  const template = shiftTemplates.value.find((t) => t.id === templateId);
  const employee = users.value.find((u) => u.id === employeeId);
  if (!template || !employee) return;

  pendingAssignment.value = {
    templateId,
    templateName: template.name,
    date,
    employeeId,
    employeeName: employee.fullName || employee.username,
  };
}

async function confirmAssign() {
  if (!pendingAssignment.value || !restaurantId.value) return;
  const { templateId, date, employeeId } = pendingAssignment.value;
  const template = shiftTemplates.value.find((t) => t.id === templateId);
  if (!template) return;

  assigning.value = true;
  try {
    const newSchedule = await schedulingService.createSchedule(
      restaurantId.value,
      {
        employeeId,
        shiftTemplateId: templateId,
        workDate: date,
        startTime: template.startTime,
        endTime: template.endTime,
        scheduledHours: template.durationMinutes / 60,
      },
    );
    const employee = users.value.find((u) => u.id === employeeId);
    const enrichedSchedule = {
      ...newSchedule,
      employeeName: employee?.fullName || employee?.username || "",
      employee: employee
        ? { id: employee.id, fullName: employee.fullName || employee.username }
        : undefined,
    };
    schedules.value = [...schedules.value, enrichedSchedule];
    pendingAssignment.value = null;
  } catch (e: unknown) {
    toast.error(
      resolveUserFacingError(e, t, {
        fallbackKey: "employees.scheduling.assignFailed",
      }).message,
    );
  } finally {
    assigning.value = false;
  }
}

async function handleRemove(scheduleId: number) {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("employees.scheduling.confirmRemove"),
    message: t("employees.scheduling.confirmRemove"),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;
  try {
    await schedulingService.deleteSchedule(scheduleId);
    schedules.value = schedules.value.filter((s) => s.id !== scheduleId);
  } catch (e: unknown) {
    toast.error(
      resolveUserFacingError(e, t, {
        fallbackKey: "employees.scheduling.removeFailed",
      }).message,
    );
  }
}

function handleCellClick(templateId: number, date: string) {
  selectedDate.value = date;
  cellClickTarget.value = { templateId, dateStr: date };
}

function selectEmployeeForCell(employeeId: UserId, employeeName: string) {
  if (!cellClickTarget.value) return;
  const { templateId, dateStr } = cellClickTarget.value;
  const template = shiftTemplates.value.find((t) => t.id === templateId);
  if (!template) return;
  pendingAssignment.value = {
    templateId,
    templateName: template.name,
    date: dateStr,
    employeeId,
    employeeName,
  };
  cellClickTarget.value = null;
}

function onEmployeeDragStart(_employeeId: UserId) {
  // handled by dataTransfer in UnassignedSidebar
}

// ── Template manager callbacks ───────────────────────────
const showTemplateManager = ref(false);

function onTemplateCreated(template: ShiftTemplate) {
  shiftTemplates.value = [...shiftTemplates.value, template];
}

function onTemplateUpdated(template: ShiftTemplate) {
  shiftTemplates.value = shiftTemplates.value.map((t) =>
    t.id === template.id ? template : t,
  );
}

function onTemplateDeleted(id: number) {
  shiftTemplates.value = shiftTemplates.value.filter((t) => t.id !== id);
}
</script>
