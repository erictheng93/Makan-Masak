<template>
  <div class="ui-page space-y-6">
    <!-- Quick Stats -->
    <div class="admin-stat-strip grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="bg-ios-bg rounded-2xl p-4">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"
          >
            <Clock class="w-5 h-5 text-blue-700" />
          </div>
          <div>
            <p class="text-xs text-ios-text/70">
              {{ t("employees.profile.upcomingShifts") }}
            </p>
            <p class="text-xl font-bold text-ios-text">
              {{ upcomingShiftsCount }}
            </p>
          </div>
        </div>
      </div>
      <div class="bg-ios-bg rounded-2xl p-4">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"
          >
            <CalendarCheck class="w-5 h-5 text-emerald-700" />
          </div>
          <div>
            <p class="text-xs text-ios-text/70">
              {{ t("employees.profile.completedShifts") }}
            </p>
            <p class="text-xl font-bold text-emerald-700">
              {{ completedShiftsCount }}
            </p>
          </div>
        </div>
      </div>
      <div class="bg-ios-bg rounded-2xl p-4">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"
          >
            <CalendarOff class="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <p class="text-xs text-ios-text/70">
              {{ t("employees.profile.pendingLeave") }}
            </p>
            <p class="text-xl font-bold text-amber-700">
              {{ pendingLeaveCount }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Basic Info Card -->
    <div>
      <h3 class="text-sm font-semibold text-ios-text mb-3">
        {{ t("employees.profile.basicInfo") }}
      </h3>
      <div class="bg-ios-bg rounded-2xl divide-y divide-white/80">
        <div class="ui-toolbar flex justify-between items-center px-4 py-3">
          <span class="text-sm text-ios-text/70">{{
            t("users.modal.usernameLabel")
          }}</span>
          <span
            class="min-w-0 max-w-full [overflow-wrap:anywhere] text-sm font-medium text-ios-text"
            >{{ employee?.username }}</span
          >
        </div>
        <div class="ui-toolbar flex justify-between items-center px-4 py-3">
          <span class="text-sm text-ios-text/70">{{
            t("users.modal.fullNameLabel")
          }}</span>
          <span
            class="min-w-0 max-w-full [overflow-wrap:anywhere] text-sm font-medium text-ios-text"
            >{{ employee?.fullName || "-" }}</span
          >
        </div>
        <div class="ui-toolbar flex justify-between items-center px-4 py-3">
          <span class="text-sm text-ios-text/70">Email</span>
          <span
            class="min-w-0 max-w-full [overflow-wrap:anywhere] text-sm font-medium text-ios-text"
            >{{ employee?.email || "-" }}</span
          >
        </div>
        <div class="ui-toolbar flex justify-between items-center px-4 py-3">
          <span class="text-sm text-ios-text/70">{{
            t("users.table.joinDate")
          }}</span>
          <span
            class="min-w-0 max-w-full [overflow-wrap:anywhere] text-sm font-medium text-ios-text"
            >{{
              employee?.createdAt ? formatDate(employee.createdAt) : "-"
            }}</span
          >
        </div>
        <div class="ui-toolbar flex justify-between items-center px-4 py-3">
          <span class="text-sm text-ios-text/70">{{
            t("users.table.lastLogin")
          }}</span>
          <span
            class="min-w-0 max-w-full [overflow-wrap:anywhere] text-sm font-medium text-ios-text"
            >{{
              employee?.lastLoginAt
                ? formatDateTime(employee.lastLoginAt)
                : t("users.table.neverLoggedIn")
            }}</span
          >
        </div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div>
      <h3 class="text-sm font-semibold text-ios-text mb-3">
        {{ t("employees.profile.recentActivity") }}
      </h3>
      <div
        v-if="schedulesLoading || leavesLoading"
        class="flex items-center justify-center py-8"
      >
        <div
          class="w-6 h-6 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
        />
      </div>
      <div v-else-if="recentActivity.length === 0" class="text-center py-8">
        <Activity class="mx-auto w-8 h-8 text-ios-text/15 mb-2" />
        <p class="text-xs text-ios-text/70">
          {{ t("employees.profile.noActivity") }}
        </p>
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="(item, idx) in recentActivity"
          :key="idx"
          class="flex items-center gap-3 p-3 bg-ios-bg rounded-xl"
        >
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            :class="item.bgClass"
          >
            <component
              :is="item.icon"
              class="w-4 h-4"
              :class="item.iconClass"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm text-ios-text">{{ item.title }}</p>
            <p class="text-xs text-ios-text/70">{{ item.subtitle }}</p>
          </div>
          <span
            class="px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0"
            :class="item.badgeClass"
          >
            {{ item.badge }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import type { Employee, LeaveBalance, LeaveRequest } from "@/types/employee";
import type { EmployeeSchedule } from "@/types/scheduling";
import { Clock, CalendarCheck, CalendarOff, Activity } from "lucide-vue-next";

const props = defineProps<{
  employee?: Employee | null;
  schedules?: EmployeeSchedule[];
  leaveBalances?: LeaveBalance[];
  leaveRequests?: LeaveRequest[];
  schedulesLoading?: boolean;
  leavesLoading?: boolean;
}>();

const { t } = useI18n();
const { formatDate, formatDateTime } = useDateFormatter();

const upcomingShiftsCount = computed(() => {
  const now = new Date();
  return (props.schedules || []).filter((s) => {
    const workDate = new Date(s.workDate);
    return workDate >= now && s.status !== "cancelled";
  }).length;
});

const completedShiftsCount = computed(() => {
  return (props.schedules || []).filter((s) => s.status === "completed").length;
});

const pendingLeaveCount = computed(() => {
  return (props.leaveRequests || []).filter((r) => r.status === "pending")
    .length;
});

const recentActivity = computed(() => {
  const items: Array<{
    title: string;
    subtitle: string;
    badge: string;
    badgeClass: string;
    icon: Component;
    bgClass: string;
    iconClass: string;
    date: Date;
  }> = [];

  // Recent schedules
  for (const s of (props.schedules || []).slice(0, 5)) {
    const statusMap: Record<string, { badge: string; badgeClass: string }> = {
      completed: {
        badge: t("employees.activity.completed"),
        badgeClass: "bg-emerald-50 text-emerald-700",
      },
      scheduled: {
        badge: t("employees.activity.scheduled"),
        badgeClass: "bg-blue-50 text-blue-700",
      },
      confirmed: {
        badge: t("employees.activity.confirmed"),
        badgeClass: "bg-teal-50 text-teal-700",
      },
      cancelled: {
        badge: t("employees.activity.cancelled"),
        badgeClass: "bg-red-50 text-red-700",
      },
    };
    const status = statusMap[s.status] || {
      badge: s.status,
      badgeClass: "bg-gray-50 text-gray-700",
    };
    items.push({
      title: `${t("employees.activity.shift")} ${s.startTime || ""} - ${s.endTime || ""}`,
      subtitle: formatDate(s.workDate),
      ...status,
      icon: Clock,
      bgClass: "bg-blue-50",
      iconClass: "text-blue-700",
      date: new Date(s.workDate),
    });
  }

  // Recent leave requests
  for (const r of (props.leaveRequests || []).slice(0, 5)) {
    const statusMap: Record<string, { badge: string; badgeClass: string }> = {
      pending: {
        badge: t("employees.activity.pending"),
        badgeClass: "bg-amber-50 text-amber-700",
      },
      approved: {
        badge: t("employees.activity.approved"),
        badgeClass: "bg-emerald-50 text-emerald-700",
      },
      rejected: {
        badge: t("employees.activity.rejected"),
        badgeClass: "bg-red-50 text-red-700",
      },
      cancelled: {
        badge: t("employees.activity.cancelled"),
        badgeClass: "bg-gray-50 text-gray-700",
      },
    };
    const status = statusMap[r.status] || {
      badge: r.status,
      badgeClass: "bg-gray-50 text-gray-700",
    };
    items.push({
      title: `${t("employees.activity.leave")} ${r.leaveType?.name || ""}`,
      subtitle: `${formatDate(r.startDate)} - ${formatDate(r.endDate)}`,
      ...status,
      icon: CalendarOff,
      bgClass: "bg-amber-50",
      iconClass: "text-amber-700",
      date: new Date(r.createdAt),
    });
  }

  // Sort by date desc and take top 8
  return items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 8);
});
</script>
