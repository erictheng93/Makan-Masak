<template>
  <div class="w-full">
    <!-- Calendar Header -->
    <div class="flex items-center justify-between mb-6">
      <button
        :aria-label="t('a11y.previousMonth')"
        class="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
        :disabled="loading"
        @click="previousMonth"
      >
        <ChevronLeftIcon class="h-5 w-5" />
      </button>

      <div class="flex items-center gap-4">
        <h2 class="text-xl font-bold text-gray-900">{{ currentMonthYear }}</h2>
        <button
          v-if="!isCurrentMonth"
          class="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
          @click="goToToday"
        >
          <CalendarIcon class="h-4 w-4" />
          <span>{{ t("scheduling.calendarView.goToToday") }}</span>
        </button>
      </div>

      <button
        :aria-label="t('a11y.nextMonth')"
        class="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
        :disabled="loading"
        @click="nextMonth"
      >
        <ChevronRightIcon class="h-5 w-5" />
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <div
        class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"
      ></div>
      <p class="mt-4 text-gray-600">
        {{ t("scheduling.calendarView.loading") }}
      </p>
    </div>

    <!-- Calendar Grid -->
    <div v-else class="bg-white rounded-lg border border-gray-200">
      <!-- Weekday Headers -->
      <div class="grid grid-cols-7 border-b border-gray-200">
        <div
          v-for="day in weekdays"
          :key="day"
          class="py-3 text-center text-sm font-semibold text-gray-700"
        >
          {{ day }}
        </div>
      </div>

      <!-- Calendar Days -->
      <div class="grid grid-cols-7">
        <div
          v-for="day in calendarDays"
          :key="day.date"
          :class="[
            'min-h-[100px] border-b border-r border-gray-200 p-2 cursor-pointer transition-colors',
            day.isOtherMonth ? 'bg-gray-50' : 'bg-white hover:bg-gray-50',
            day.isToday ? 'bg-blue-50 ring-2 ring-blue-500 ring-inset' : '',
            day.isWeekend && !day.isOtherMonth ? 'bg-gray-50' : '',
          ]"
          @click="selectDate(day.date)"
          @mouseenter="hoveredDate = day.date"
          @mouseleave="hoveredDate = null"
        >
          <div class="flex flex-col h-full">
            <div class="flex items-center justify-between mb-1">
              <span
                :class="[
                  'text-sm font-medium',
                  day.isOtherMonth ? 'text-gray-400' : 'text-gray-900',
                  day.isToday ? 'text-blue-600 font-bold' : '',
                ]"
              >
                {{ day.dayNumber }}
              </span>
              <span
                v-if="day.isToday"
                class="text-xs px-1.5 py-0.5 bg-blue-600 text-white rounded"
              >
                {{ t("scheduling.calendarView.today") }}
              </span>
            </div>

            <div v-if="day.scheduleCount > 0" class="flex-1">
              <div
                :class="[
                  'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
                  getScheduleBadgeClass(day.scheduleCount),
                ]"
              >
                <ClipboardDocumentListIcon class="h-3 w-3" />
                <span>{{
                  t("scheduling.calendarView.scheduleCount", {
                    count: day.scheduleCount,
                  })
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Calendar Legend -->
    <div class="flex items-center justify-center gap-6 mt-6 text-sm">
      <div class="flex items-center gap-2">
        <div
          class="w-4 h-4 bg-blue-50 ring-2 ring-blue-500 ring-inset rounded"
        ></div>
        <span class="text-gray-700">{{
          t("scheduling.calendarView.legendToday")
        }}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-4 h-4 bg-green-100 rounded"></div>
        <span class="text-gray-700">{{
          t("scheduling.calendarView.legendHasSchedule")
        }}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-4 h-4 bg-gray-50 rounded border border-gray-200"></div>
        <span class="text-gray-700">{{
          t("scheduling.calendarView.legendWeekend")
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "@/i18n";
import type { EmployeeSchedule } from "@/types/scheduling";

const { t } = useI18n();
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
} from "@heroicons/vue/24/outline";

interface Props {
  schedules: EmployeeSchedule[];
  loading?: boolean;
}

interface CalendarDay {
  dayNumber: number;
  date: string;
  isOtherMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  scheduleCount: number;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
});

const emit = defineEmits<{
  dateSelect: [date: string];
  scheduleClick: [schedule: EmployeeSchedule];
}>();

// State
const currentDate = ref(new Date());
const hoveredDate = ref<string | null>(null);

// Computed
const currentMonthYear = computed(() => {
  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth() + 1;
  return `${year}年 ${month}月`;
});

const isCurrentMonth = computed(() => {
  const today = new Date();
  return (
    currentDate.value.getFullYear() === today.getFullYear() &&
    currentDate.value.getMonth() === today.getMonth()
  );
});

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

const calendarDays = computed(() => {
  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  const days: CalendarDay[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Previous month days
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const dayNumber = prevMonthLastDay - i;
    const date = new Date(year, month - 1, dayNumber);
    const formattedDate = formatDate(date);
    days.push({
      dayNumber,
      date: formattedDate,
      isOtherMonth: true,
      isToday: false,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      scheduleCount: getScheduleCount(formattedDate),
    });
  }

  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const date = new Date(year, month, i);
    const formattedDate = formatDate(date);
    days.push({
      dayNumber: i,
      date: formattedDate,
      isOtherMonth: false,
      isToday: isSameDay(date, today),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      scheduleCount: getScheduleCount(formattedDate),
    });
  }

  // Next month days
  const remainingDays = 42 - days.length; // 6 weeks * 7 days
  for (let i = 1; i <= remainingDays; i++) {
    const date = new Date(year, month + 1, i);
    const formattedDate = formatDate(date);
    days.push({
      dayNumber: i,
      date: formattedDate,
      isOtherMonth: true,
      isToday: false,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      scheduleCount: getScheduleCount(formattedDate),
    });
  }

  return days;
});

// Methods
const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isSameDay = (date1: Date, date2: Date): boolean => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

const getScheduleCount = (date: string): number => {
  return props.schedules.filter((s) => s.workDate === date).length;
};

const previousMonth = () => {
  currentDate.value = new Date(
    currentDate.value.getFullYear(),
    currentDate.value.getMonth() - 1,
    1,
  );
};

const nextMonth = () => {
  currentDate.value = new Date(
    currentDate.value.getFullYear(),
    currentDate.value.getMonth() + 1,
    1,
  );
};

const selectDate = (date: string) => {
  emit("dateSelect", date);
};

const goToToday = () => {
  currentDate.value = new Date();
};

const getScheduleBadgeClass = (count: number) => {
  if (count >= 5) return "bg-red-100 text-red-700";
  if (count >= 3) return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
};
</script>
