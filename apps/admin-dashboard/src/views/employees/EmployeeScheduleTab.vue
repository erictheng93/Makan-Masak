<template>
  <div class="ui-page space-y-6">
    <!-- Schedule Summary Stats -->
    <div class="admin-stat-strip grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="bg-ios-bg rounded-2xl p-4">
        <p class="text-xs text-ios-text/70">
          {{ t("employees.schedule.totalHours") }}
        </p>
        <p class="text-xl font-bold text-ios-text">
          {{ totalHours.toFixed(1) }}h
        </p>
      </div>
      <div class="bg-ios-bg rounded-2xl p-4">
        <p class="text-xs text-ios-text/70">
          {{ t("employees.schedule.overtime") }}
        </p>
        <p class="text-xl font-bold text-amber-700">
          {{ overtimeHours.toFixed(1) }}h
        </p>
      </div>
      <div class="bg-ios-bg rounded-2xl p-4">
        <p class="text-xs text-ios-text/70">
          {{ t("employees.schedule.completed") }}
        </p>
        <p class="text-xl font-bold text-emerald-700">{{ completedCount }}</p>
      </div>
      <div class="bg-ios-bg rounded-2xl p-4">
        <p class="text-xs text-ios-text/70">
          {{ t("employees.schedule.upcoming") }}
        </p>
        <p class="text-xl font-bold text-blue-700">{{ upcomingCount }}</p>
      </div>
    </div>

    <!-- Schedule List -->
    <div>
      <h3 class="text-sm font-semibold text-ios-text mb-3">
        {{ t("employees.schedule.shifts") }}
      </h3>

      <div
        v-if="schedulesLoading"
        class="flex items-center justify-center py-12"
      >
        <div
          class="w-6 h-6 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
        />
      </div>

      <div
        v-else-if="!schedules || schedules.length === 0"
        class="text-center py-12"
      >
        <Calendar class="mx-auto w-8 h-8 text-ios-text/15 mb-2" />
        <p class="text-xs text-ios-text/70">
          {{ t("employees.schedule.noShifts") }}
        </p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="schedule in sortedSchedules"
          :key="schedule.id"
          class="flex items-center gap-4 p-4 bg-ios-bg rounded-xl"
        >
          <!-- Date -->
          <div class="flex flex-col items-center w-14 flex-shrink-0">
            <span class="text-xs text-ios-text/70">{{
              getWeekday(schedule.workDate)
            }}</span>
            <span class="text-lg font-bold text-ios-text">{{
              getDay(schedule.workDate)
            }}</span>
            <span class="text-[10px] text-ios-text/70">{{
              getMonth(schedule.workDate)
            }}</span>
          </div>

          <!-- Divider -->
          <div class="w-px h-10 bg-ios-text/10" />

          <!-- Details -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <Clock class="w-3.5 h-3.5 text-ios-text/70" />
              <span class="text-sm font-medium text-ios-text">
                {{ schedule.startTime || "?" }} - {{ schedule.endTime || "?" }}
              </span>
            </div>
            <div
              v-if="schedule.actualHours"
              class="flex items-center gap-2 mt-1"
            >
              <Timer class="w-3.5 h-3.5 text-ios-text/70" />
              <span class="text-xs text-ios-text/70">
                {{ t("employees.schedule.worked") }}
                {{ schedule.actualHours.toFixed(1) }}h
                <span
                  v-if="schedule.overtimeHours"
                  class="rounded-full bg-ios-orange-soft px-2 py-1 text-ios-orange-deep"
                >
                  (+{{ schedule.overtimeHours.toFixed(1) }}h OT)
                </span>
              </span>
            </div>
          </div>

          <!-- Status -->
          <span
            class="px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0"
            :class="scheduleStatusClass(schedule.status)"
            :data-status="schedule.status"
          >
            {{ scheduleStatusText(schedule.status) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import type { Employee } from "@/types/employee";
import type { EmployeeSchedule } from "@/types/scheduling";
import { Calendar, Clock, Timer } from "lucide-vue-next";

const props = defineProps<{
  employee?: Employee | null;
  schedules?: EmployeeSchedule[];
  schedulesLoading?: boolean;
}>();

const { t } = useI18n();
const { getWeekdayName, getMonthName } = useDateFormatter();

const sortedSchedules = computed(() => {
  if (!props.schedules) return [];
  return [...props.schedules].sort(
    (a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime(),
  );
});

const totalHours = computed(() =>
  (props.schedules || []).reduce(
    (sum, s) => sum + (s.actualHours || s.scheduledHours || 0),
    0,
  ),
);

const overtimeHours = computed(() =>
  (props.schedules || []).reduce((sum, s) => sum + (s.overtimeHours || 0), 0),
);

const completedCount = computed(
  () => (props.schedules || []).filter((s) => s.status === "completed").length,
);

const upcomingCount = computed(() => {
  const now = new Date();
  return (props.schedules || []).filter(
    (s) => new Date(s.workDate) >= now && s.status !== "cancelled",
  ).length;
});

const getWeekday = (date: string) => {
  const d = new Date(date);
  return getWeekdayName(d, "short");
};

const getDay = (date: string) => new Date(date).getDate();

const getMonth = (date: string) =>
  getMonthName(new Date(date).getMonth(), "short");

const scheduleStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700",
    scheduled: "bg-blue-50 text-blue-700",
    confirmed: "bg-teal-50 text-teal-700",
    cancelled: "bg-red-50 text-red-700",
    no_show: "bg-red-50 text-red-700",
  };
  return classes[status] || "bg-gray-50 text-gray-700";
};

const scheduleStatusText = (status: string) => {
  const keys: Record<string, string> = {
    completed: "employees.activity.completed",
    scheduled: "employees.activity.scheduled",
    confirmed: "employees.activity.confirmed",
    cancelled: "employees.activity.cancelled",
    no_show: "employees.schedule.noShow",
  };
  return keys[status] ? t(keys[status]) : status;
};
</script>
