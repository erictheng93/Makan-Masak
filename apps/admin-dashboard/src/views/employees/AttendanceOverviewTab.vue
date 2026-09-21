<template>
  <div class="space-y-6">
    <div class="flex justify-end">
      <RouterLink
        :to="{ name: 'SchedulingAnalytics' }"
        data-testid="scheduling-analytics-link"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-white text-ios-blue border border-ios-blue/20 hover:bg-ios-blue/10 transition-colors"
      >
        {{ t("pages.schedulingAnalytics") }}
      </RouterLink>
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <div
        v-for="stat in attendanceStats"
        :key="stat.label"
        class="bg-ios-bg rounded-2xl p-4"
      >
        <p class="text-xs text-ios-text/40 mb-1">{{ stat.label }}</p>
        <p class="text-2xl font-bold" :class="stat.valueClass">
          {{ stat.value }}
        </p>
      </div>
    </div>

    <!-- Clock In / Out -->
    <div>
      <h3
        class="text-sm font-semibold text-ios-text mb-3 flex items-center gap-2"
      >
        <Clock class="w-4 h-4 text-ios-blue" />
        {{ t("employees.attendance.clockPanel") }}
      </h3>

      <div v-if="clockableEmployees.length > 0" class="max-w-[500px] mx-auto">
        <label
          class="block text-xs text-ios-text/40 mb-1"
          for="clock-target-select"
        >
          {{ t("employees.attendance.clockFor") }}
        </label>
        <select
          id="clock-target-select"
          v-model="clockTargetId"
          data-testid="clock-target-select"
          class="w-full mb-4 px-3 py-2 rounded-xl bg-ios-bg text-sm text-ios-text focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
        >
          <option
            v-for="emp in clockableEmployees"
            :key="emp.id"
            :value="emp.id"
          >
            {{ emp.fullName || emp.username }}
          </option>
        </select>

        <!-- Remount on target change: the panel loads its schedule onMounted. -->
        <ClockInOutPanel
          v-if="restaurantId && clockTargetId !== undefined"
          :key="String(clockTargetId)"
          :restaurant-id="restaurantId"
          :employee-id="clockTargetId"
          @clock-in="refreshAttendance"
          @clock-out="refreshAttendance"
        />
      </div>
      <div v-else class="text-center py-8">
        <Clock class="mx-auto w-8 h-8 text-ios-text/15 mb-2" />
        <p class="text-xs text-ios-text/30">
          {{ t("employees.attendance.noClockableStaff") }}
        </p>
      </div>
    </div>

    <!-- Currently Working -->
    <div>
      <h3
        class="text-sm font-semibold text-ios-text mb-3 flex items-center gap-2"
      >
        <div class="w-2 h-2 rounded-full bg-ios-green animate-pulse" />
        {{ t("employees.attendance.working") }}
        <span class="text-ios-text/30">({{ clockedInEmployees.length }})</span>
      </h3>
      <div
        v-if="clockedInLoading"
        class="flex items-center justify-center py-8"
      >
        <div
          class="w-6 h-6 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
        />
      </div>
      <div v-else-if="clockedInEmployees.length === 0" class="text-center py-8">
        <Clock class="mx-auto w-8 h-8 text-ios-text/15 mb-2" />
        <p class="text-xs text-ios-text/30">
          {{ t("employees.attendance.noOneWorking") }}
        </p>
      </div>
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="emp in clockedInEmployees"
          :key="emp.id"
          class="flex items-center gap-3 p-3 bg-emerald-50/50 rounded-xl cursor-pointer hover:bg-emerald-50 transition-colors"
          @click="navigateToDetail(emp.employeeId)"
        >
          <div class="relative">
            <div
              class="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-semibold text-emerald-700"
            >
              {{ getEmployeeInitials(emp) }}
            </div>
            <span
              class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-ios-green border-2 border-white rounded-full"
            >
              <span
                class="absolute inset-0 rounded-full bg-ios-green animate-ping opacity-40"
              />
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ios-text truncate">
              {{ emp.employeeName || `Employee #${emp.employeeId}` }}
            </p>
            <p class="text-xs text-emerald-600">
              {{ emp.clockInTime ? formatClockTime(emp.clockInTime) : "" }}
              {{
                emp.startTime && emp.endTime
                  ? `(${emp.startTime} - ${emp.endTime})`
                  : ""
              }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- On Leave Today -->
    <div>
      <h3
        class="text-sm font-semibold text-ios-text mb-3 flex items-center gap-2"
      >
        <div class="w-2 h-2 rounded-full bg-ios-orange" />
        {{ t("employees.attendance.onLeave") }}
        <span class="text-ios-text/30">({{ onLeaveEmployees.length }})</span>
      </h3>
      <div v-if="leaveLoading" class="flex items-center justify-center py-8">
        <div
          class="w-6 h-6 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
        />
      </div>
      <div v-else-if="onLeaveEmployees.length === 0" class="text-center py-8">
        <CalendarOff class="mx-auto w-8 h-8 text-ios-text/15 mb-2" />
        <p class="text-xs text-ios-text/30">
          {{ t("employees.attendance.noOneOnLeave") }}
        </p>
      </div>
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="emp in onLeaveEmployees"
          :key="emp.employeeId"
          class="flex items-center gap-3 p-3 bg-amber-50/50 rounded-xl"
        >
          <div
            class="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center"
          >
            <CalendarOff class="w-4 h-4 text-amber-700" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ios-text truncate">
              {{
                getEmployeeName(emp.employeeId) || `Employee #${emp.employeeId}`
              }}
            </p>
            <p class="text-xs text-amber-600">{{ emp.leaveTypeName }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useEmployeeList } from "@/composables/useEmployeeList";
import ClockInOutPanel from "@/components/scheduling/ClockInOutPanel.vue";
import { getInitials } from "@/composables/useEmployeeDisplay";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { Clock, CalendarOff } from "lucide-vue-next";
import type { EmployeeWithStatus } from "@/types/employee";
import type { UserId } from "@/types/api-user";

interface AttendanceSchedule {
  employeeName?: string;
}

defineProps<{
  usersWithStatus?: EmployeeWithStatus[];
  isLoading?: boolean;
}>();

const router = useRouter();
const { t } = useI18n();
const { formatTime } = useDateFormatter();
const authStore = useAuthStore();
const employeeList = useEmployeeList();

const restaurantId = computed(() => authStore.restaurantId);

const clockableEmployees = computed(() =>
  employeeList.users.value.filter((u) => u.isActive),
);

// This tab is ADMIN/OWNER only (router meta), so the panel is a manager
// surface: it defaults to the signed-in user clocking themselves, and 代打 for
// another employee is one select away. POST /schedules/:id/clock-in accepts a
// body employeeId only from a manager, and resolves the schedule within the
// caller's restaurant, so the selector cannot reach another tenant.
const clockTargetId = ref<UserId | undefined>(undefined);

watch(
  clockableEmployees,
  (list) => {
    if (clockTargetId.value !== undefined) return;
    const self = list.find((u) => u.id === authStore.user?.id);
    clockTargetId.value = self?.id ?? list[0]?.id;
  },
  { immediate: true },
);

// A clock action changes who counts as on shift, so the stats above it are
// stale until the clocked-in list is refetched.
const refreshAttendance = () => {
  employeeList.fetchClockedIn();
  // The roster rows carry clockInTime, which is what the present/absent counts
  // are derived from — refetching only the clocked-in list would leave them stale.
  employeeList.fetchTodaySchedules();
};

const clockedInEmployees = employeeList.clockedInList;
const clockedInLoading = employeeList.clockedInLoading;
const leaveLoading = employeeList.leaveLoading;

const onLeaveEmployees = computed(() => {
  const users = employeeList.usersWithStatus.value;
  return users
    .filter((u) => u.leaveStatus?.isOnLeave)
    .map((u) => ({
      employeeId: u.id,
      leaveTypeName: u.leaveStatus?.leaveType || "Leave",
    }));
});

/**
 * Attendance is measured against today's roster, not against headcount.
 *
 * The old denominator was every active employee, so a five-person shop that
 * rosters two could never exceed 40% and the three people who were never due
 * in were counted as absent. The numerator was `currentlyWorking`, which is
 * "clocked in and not yet out" — an instantaneous value, so every shop read
 * 0% after closing. Neither number moved when a shift was added to the roster.
 */
const attendanceStats = computed(() => {
  const totalActive = employeeList.users.value.filter((u) => u.isActive).length;

  // A cancelled shift is not an attendance obligation, so it leaves the
  // denominator. Everything else rostered for today stays in it.
  const rostered = employeeList.todaySchedules.value.filter(
    (schedule) => schedule.status !== "cancelled",
  );
  const rosteredIds = new Set(rostered.map((s) => s.employeeId));
  const scheduled = rosteredIds.size;

  // Present for the day means "clocked in at some point", so someone who has
  // already clocked out still counts. That is the difference from the
  // currently-working list rendered below.
  const presentIds = new Set(
    rostered.filter((s) => s.clockInTime).map((s) => s.employeeId),
  );
  const present = presentIds.size;

  const onLeaveIds = new Set(
    employeeList.usersWithStatus.value
      .filter((u) => u.leaveStatus?.isOnLeave)
      .map((u) => u.id),
  );

  // Absent means "was due in and did not come". Approved leave is not absence,
  // and neither is having no shift today.
  const absent = [...rosteredIds].filter(
    (id) => !presentIds.has(id) && !onLeaveIds.has(id),
  ).length;

  // With nobody rostered there is no rate to report. 0% would read as a
  // failure rather than as "no shifts today".
  const rate = scheduled > 0 ? Math.round((present / scheduled) * 100) : null;

  return [
    {
      label: t("employees.attendance.totalActive"),
      value: totalActive,
      valueClass: "text-ios-text",
    },
    {
      label: t("employees.attendance.scheduled"),
      value: scheduled,
      valueClass: "text-ios-text",
    },
    {
      label: t("employees.attendance.present"),
      value: present,
      valueClass: "text-emerald-600",
    },
    {
      label: t("employees.attendance.onLeave"),
      value: onLeaveIds.size,
      valueClass: "text-amber-600",
    },
    {
      label: t("employees.attendance.absent"),
      value: absent,
      valueClass: "text-red-500",
    },
    {
      label: t("employees.attendance.rate"),
      value: rate === null ? "—" : `${rate}%`,
      valueClass:
        rate === null
          ? "text-ios-text/30"
          : rate >= 80
            ? "text-emerald-600"
            : "text-amber-600",
    },
  ];
});

const getEmployeeInitials = (schedule: AttendanceSchedule) =>
  getInitials(schedule.employeeName || "");

const getEmployeeName = (employeeId: UserId) => {
  const user = employeeList.users.value.find((u) => u.id === employeeId);
  return user?.fullName || user?.username;
};

// Thin wrapper: keeps the fallback guard and converts the ISO string to a Date
// (formatTime treats a bare string as an "HH:mm" time-of-day, not a datetime).
const formatClockTime = (time: string) => {
  try {
    return formatTime(new Date(time));
  } catch {
    return time;
  }
};

const navigateToDetail = (employeeId: UserId) => {
  router.push(`/dashboard/employees/${employeeId}`);
};

onMounted(() => {
  // Data already loaded by parent EmployeeManagementView
  // Refresh clocked-in data specifically
  employeeList.fetchClockedIn();
  employeeList.fetchTodayLeaves();
  employeeList.fetchTodaySchedules();
});
</script>
