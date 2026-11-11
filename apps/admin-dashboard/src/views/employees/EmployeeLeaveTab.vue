<template>
  <div class="ui-page space-y-6">
    <!-- Leave Balances -->
    <div>
      <h3 class="text-sm font-semibold text-ios-text mb-3">
        {{ t("employees.leave.balances") }}
      </h3>

      <div v-if="leavesLoading" class="flex items-center justify-center py-8">
        <div
          class="w-6 h-6 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
        />
      </div>

      <div
        v-else-if="!leaveBalances || leaveBalances.length === 0"
        class="text-center py-8"
      >
        <CalendarOff class="mx-auto w-8 h-8 text-ios-text/15 mb-2" />
        <p class="text-xs text-ios-text/70">
          {{ t("employees.leave.noBalances") }}
        </p>
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="balance in leaveBalances"
          :key="balance.id"
          class="bg-ios-bg rounded-2xl p-4"
        >
          <div class="flex items-center gap-2 mb-3">
            <div
              class="w-3 h-3 rounded-full"
              :style="{
                backgroundColor: balance.leaveType?.color || '#007AFF',
              }"
            />
            <span class="text-sm font-medium text-ios-text">
              {{ balance.leaveType?.name || t("employees.leave.unknown") }}
            </span>
            <span
              v-if="balance.leaveType?.isPaid"
              class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium"
            >
              {{ t("employees.leave.paid") }}
            </span>
          </div>

          <!-- Balance Display -->
          <div class="flex items-baseline gap-1 mb-2">
            <span class="text-2xl font-bold text-ios-blue">{{
              balance.remainingDays
            }}</span>
            <span class="text-sm text-ios-text/70"
              >/ {{ balance.totalDays }} {{ t("employees.leave.days") }}</span
            >
          </div>

          <!-- Progress Bar -->
          <div class="h-2 bg-white rounded-full overflow-hidden mb-2">
            <div
              class="h-full rounded-full transition-all"
              :style="{ width: usagePercent(balance) + '%' }"
              :class="progressColor(usagePercent(balance))"
            />
          </div>

          <!-- Details -->
          <div class="ui-toolbar flex justify-between text-xs text-ios-text/70">
            <span>{{ t("employees.leave.used") }}: {{ balance.usedDays }}</span>
            <span v-if="balance.pendingDays > 0" class="text-amber-700">
              {{ t("employees.leave.pending") }}: {{ balance.pendingDays }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Leave Requests -->
    <div>
      <h3 class="text-sm font-semibold text-ios-text mb-3">
        {{ t("employees.leave.requests") }}
      </h3>

      <div v-if="leavesLoading" class="flex items-center justify-center py-8">
        <div
          class="w-6 h-6 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
        />
      </div>

      <div
        v-else-if="!leaveRequests || leaveRequests.length === 0"
        class="text-center py-8"
      >
        <FileText class="mx-auto w-8 h-8 text-ios-text/15 mb-2" />
        <p class="text-xs text-ios-text/70">
          {{ t("employees.leave.noRequests") }}
        </p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="request in leaveRequests"
          :key="request.id"
          class="flex items-center gap-4 p-4 bg-ios-bg rounded-xl"
        >
          <!-- Type Indicator -->
          <div
            class="w-1 h-12 rounded-full flex-shrink-0"
            :style="{ backgroundColor: request.leaveType?.color || '#007AFF' }"
          />

          <!-- Details -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-ios-text">
                {{ request.leaveType?.name || t("employees.leave.unknown") }}
              </span>
            </div>
            <p class="text-xs text-ios-text/70 mt-0.5">
              {{ formatDate(request.startDate) }} -
              {{ formatDate(request.endDate) }}
              <span
                v-if="
                  request.startPeriod !== 'full' || request.endPeriod !== 'full'
                "
                class="ml-1"
              >
                ({{ periodText(request.startPeriod) }} -
                {{ periodText(request.endPeriod) }})
              </span>
            </p>
            <p
              v-if="request.reason"
              class="text-xs text-ios-text/70 mt-0.5 break-words"
            >
              {{ request.reason }}
            </p>
          </div>

          <!-- Status -->
          <span
            class="px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0"
            :class="requestStatusClass(request.status)"
            :data-status="request.status"
          >
            {{ requestStatusText(request.status) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import type { Employee, LeaveBalance, LeaveRequest } from "@/types/employee";
import { CalendarOff, FileText } from "lucide-vue-next";

defineProps<{
  employee?: Employee | null;
  leaveBalances?: LeaveBalance[];
  leaveRequests?: LeaveRequest[];
  leavesLoading?: boolean;
}>();

const { t } = useI18n();
const { formatDate } = useDateFormatter();

const usagePercent = (balance: LeaveBalance) => {
  if (balance.totalDays <= 0) return 0;
  return Math.min(
    100,
    Math.round(
      ((balance.usedDays + balance.pendingDays) / balance.totalDays) * 100,
    ),
  );
};

const progressColor = (percent: number) => {
  if (percent >= 90) return "bg-ios-red";
  if (percent >= 70) return "bg-ios-orange";
  return "bg-ios-green";
};

const periodText = (period: string) => {
  const map: Record<string, string> = {
    full: t("employees.leave.fullDay"),
    am: t("employees.leave.morning"),
    pm: t("employees.leave.afternoon"),
  };
  return map[period] || period;
};

const requestStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    rejected: "bg-red-50 text-red-700",
    cancelled: "bg-gray-100 text-gray-600",
    withdrawn: "bg-gray-100 text-gray-600",
  };
  return classes[status] || "bg-gray-50 text-gray-700";
};

const requestStatusText = (status: string) => {
  const keys: Record<string, string> = {
    pending: "employees.activity.pending",
    approved: "employees.activity.approved",
    rejected: "employees.activity.rejected",
    cancelled: "employees.activity.cancelled",
    withdrawn: "employees.leave.withdrawn",
  };
  return keys[status] ? t(keys[status]) : status;
};
</script>
