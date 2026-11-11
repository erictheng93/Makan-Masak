<template>
  <div class="ui-page min-h-screen bg-ios-bg p-6 space-y-6">
    <!-- Back Button -->
    <button
      class="flex items-center gap-1.5 text-sm text-ios-blue hover:text-blue-700 transition-colors"
      @click="router.push('/dashboard/employees')"
    >
      <ChevronLeft class="w-4 h-4" />
      {{ t("employees.detail.back") }}
    </button>

    <!-- Employee Header Card -->
    <div
      class="ui-panel bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6"
    >
      <div v-if="employeeLoading" class="flex items-center justify-center py-8">
        <div
          class="w-8 h-8 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
        />
      </div>
      <div
        v-else-if="employee"
        class="flex flex-col sm:flex-row items-start sm:items-center gap-5"
      >
        <!-- Avatar -->
        <div class="relative">
          <div
            class="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold"
            :class="avatarClass(employee.role)"
          >
            {{ getInitials(employee) }}
          </div>
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <h1 class="ui-page-heading text-xl font-bold text-ios-text">
            {{ employee.fullName || employee.username }}
          </h1>
          <p class="text-sm text-ios-text/70 mt-0.5">
            @{{ employee.username }}
          </p>
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <span
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
              :class="roleBadgeClass(employee.role)"
            >
              <component :is="roleIcon(employee.role)" class="w-3 h-3" />
              {{ roleText(employee.role) }}
            </span>
            <span
              class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
              :class="statusBadgeClass(employee.status)"
            >
              {{ statusText(employee.status) }}
            </span>
          </div>
        </div>

        <!-- Quick Info -->
        <div
          class="min-w-0 max-w-full flex flex-col gap-1.5 text-xs text-ios-text/70"
        >
          <div
            v-if="employee.email"
            class="min-w-0 max-w-full flex items-start gap-1.5"
          >
            <Mail class="w-3.5 h-3.5 shrink-0" />
            <span class="min-w-0 [overflow-wrap:anywhere]">{{
              employee.email
            }}</span>
          </div>
          <div class="min-w-0 max-w-full flex items-start gap-1.5">
            <Calendar class="w-3.5 h-3.5 shrink-0" />
            <span class="min-w-0 [overflow-wrap:anywhere]"
              >{{ t("employees.detail.joined") }}
              {{ formatDate(employee.createdAt) }}</span
            >
          </div>
          <div
            v-if="employee.lastLoginAt"
            class="min-w-0 max-w-full flex items-start gap-1.5"
          >
            <Clock class="w-3.5 h-3.5 shrink-0" />
            <span class="min-w-0 [overflow-wrap:anywhere]"
              >{{ t("employees.detail.lastLogin") }}
              {{ formatDateTime(employee.lastLoginAt) }}</span
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Sub-tab Navigation -->
    <div
      class="ui-panel bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      <nav class="ui-tabs overflow-x-auto flex border-b border-ios-bg px-6">
        <router-link
          v-for="tab in subTabs"
          :key="tab.name"
          :to="tab.path"
          class="shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors -mb-px"
          :class="
            isActiveTab(tab.path)
              ? 'border-ios-blue text-ios-blue'
              : 'border-transparent text-ios-text/70 hover:text-ios-text/70'
          "
          :data-active="isActiveTab(tab.path)"
        >
          <component :is="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </router-link>
      </nav>

      <div class="p-6">
        <router-view
          :employee="employee"
          :schedules="schedules"
          :leave-balances="leaveBalances"
          :leave-requests="leaveRequests"
          :schedules-loading="schedulesLoading"
          :leaves-loading="leavesLoading"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useEmployeeData } from "@/composables/useEmployeeData";
import type { Employee } from "@/types/employee";
import {
  useEmployeeDisplay,
  getInitials as getInitialsHelper,
  avatarClass,
  roleIcon,
  roleBadgeClass,
  statusBadgeClass,
} from "@/composables/useEmployeeDisplay";
import {
  ChevronLeft,
  User as UserIcon,
  Calendar,
  CalendarDays,
  CalendarOff,
  Clock,
  Mail,
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { formatDate, formatDateTime } = useDateFormatter();

const employeeId = () => {
  const id = route.params.id;
  return typeof id === "string" && id ? id : undefined;
};

const {
  employee,
  schedules,
  leaveBalances,
  leaveRequests,
  employeeLoading,
  schedulesLoading,
  leavesLoading,
} = useEmployeeData(employeeId);

const { roleText, statusText } = useEmployeeDisplay();

const subTabs = computed(() => {
  const id = route.params.id;
  return [
    {
      name: "profile",
      path: `/dashboard/employees/${id}`,
      label: t("employees.detail.tabs.profile"),
      icon: UserIcon,
    },
    {
      name: "schedule",
      path: `/dashboard/employees/${id}/schedule`,
      label: t("employees.detail.tabs.schedule"),
      icon: CalendarDays,
    },
    {
      name: "leave",
      path: `/dashboard/employees/${id}/leave`,
      label: t("employees.detail.tabs.leave"),
      icon: CalendarOff,
    },
  ];
});

const isActiveTab = (path: string) => {
  if (path === `/dashboard/employees/${route.params.id}`) {
    return route.path === path;
  }
  return route.path === path || route.path.startsWith(path + "/");
};

// Helpers
const getInitials = (emp: Employee) => getInitialsHelper(emp);
</script>
