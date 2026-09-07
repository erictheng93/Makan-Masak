<template>
  <div
    class="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden"
  >
    <!-- Grid Header: dates -->
    <div class="overflow-x-auto">
      <table class="w-full border-collapse min-w-[600px]">
        <thead>
          <tr class="border-b border-ios-bg">
            <!-- Shift name column header -->
            <th
              class="w-28 px-4 py-3 text-left text-xs font-semibold text-ios-text/40 uppercase tracking-wide bg-ios-bg/50"
            >
              班次
            </th>
            <!-- Date column headers -->
            <th
              v-for="col in dateColumns"
              :key="col.dateStr"
              class="px-3 py-3 text-center text-xs font-semibold min-w-[100px]"
              :class="
                col.isToday
                  ? 'text-ios-blue bg-ios-blue/5'
                  : 'text-ios-text/50 bg-transparent'
              "
            >
              <div class="flex flex-col items-center gap-0.5">
                <span class="text-[10px] uppercase tracking-wide">{{
                  col.weekday
                }}</span>
                <span
                  class="w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold"
                  :class="
                    col.isToday ? 'bg-ios-blue text-white' : 'text-ios-text'
                  "
                >
                  {{ col.day }}
                </span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- One row per shift template -->
          <tr
            v-for="template in shiftTemplates"
            :key="template.id"
            class="border-b border-ios-bg last:border-0"
          >
            <!-- Shift template name -->
            <td class="px-4 py-3 bg-ios-bg/30">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs font-semibold text-ios-text">{{
                  template.name
                }}</span>
                <span class="text-[10px] text-ios-text/40">
                  {{ template.startTime }}–{{ template.endTime }}
                </span>
              </div>
            </td>
            <!-- One cell per date -->
            <td
              v-for="col in dateColumns"
              :key="col.dateStr"
              class="px-2 py-2 align-top transition-colors"
              :class="[
                col.isToday ? 'bg-ios-blue/5' : '',
                isDragOver(template.id, col.dateStr) ? 'bg-ios-green/10' : '',
              ]"
              @dragover.prevent="onDragOver(template.id, col.dateStr)"
              @dragleave="onDragLeave"
              @drop.prevent="onDrop(template.id, col.dateStr, $event)"
              @click="$emit('cell-click', template.id, col.dateStr)"
            >
              <!-- Assigned employee pills -->
              <div class="flex flex-col gap-1 min-h-[40px]">
                <template
                  v-if="getCellSchedules(template.id, col.dateStr).length > 0"
                >
                  <div
                    v-for="schedule in getCellSchedules(
                      template.id,
                      col.dateStr,
                    )"
                    :key="schedule.id"
                    class="group flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-default select-none transition-all"
                    :style="{
                      backgroundColor: template.colorCode + '22',
                      color: template.colorCode,
                    }"
                    :title="employeeLabel(schedule)"
                  >
                    <span class="truncate max-w-[70px]">{{
                      employeeLabel(schedule)
                    }}</span>
                    <button
                      class="opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0 hover:bg-black/10 rounded-full p-0.5"
                      :title="'移除排班'"
                      @click.stop="$emit('remove', schedule.id)"
                    >
                      <X class="w-2.5 h-2.5" />
                    </button>
                  </div>
                </template>
                <!-- Empty cell placeholder -->
                <div
                  v-else
                  class="h-[32px] rounded-lg border-2 border-dashed border-ios-text/10 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
                  @click.stop="$emit('cell-click', template.id, col.dateStr)"
                >
                  <Plus class="w-3 h-3 text-ios-text/30" />
                </div>
              </div>
            </td>
          </tr>

          <!-- Empty state when no templates -->
          <tr v-if="shiftTemplates.length === 0">
            <td
              :colspan="dateColumns.length + 1"
              class="py-12 text-center text-ios-text/40 text-sm"
            >
              尚無班次範本，請先新增班次範本
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { X, Plus } from "lucide-vue-next";
import type { ShiftTemplate, EmployeeSchedule } from "@/types/scheduling";
import type { UserId } from "@/types/api-user";
import { toLocalDateStr } from "@/utils/dateUtils";

const { t } = useI18n();

/**
 * A past shift still names whoever worked it, including someone who has since
 * left -- the roster hides them, the history does not. Without the marker the
 * cell reads as though they are still on staff (#337).
 */
function employeeLabel(schedule: EmployeeSchedule): string {
  const name = schedule.employee?.fullName || schedule.employeeName || "";
  if (!name || !schedule.employee?.isArchived) return name;
  return `${name}（${t("users.roster.archived")}）`;
}

const props = defineProps<{
  schedules: EmployeeSchedule[];
  shiftTemplates: ShiftTemplate[];
  dateRange: { start: Date; end: Date };
  viewMode: "week" | "month";
}>();

const emit = defineEmits<{
  (e: "assign", templateId: number, date: string, employeeId: UserId): void;
  (e: "remove", scheduleId: number): void;
  (e: "cell-click", templateId: number, date: string): void;
}>();

// --- Date columns ---
const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];

const dateColumns = computed(() => {
  const cols: Array<{
    dateStr: string;
    weekday: string;
    day: number;
    isToday: boolean;
  }> = [];
  const todayStr = toLocalDateStr(new Date());
  const cursor = new Date(props.dateRange.start);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(props.dateRange.end);
  end.setHours(23, 59, 59, 999);

  while (cursor <= end) {
    const dateStr = toLocalDateStr(cursor);
    cols.push({
      dateStr,
      weekday: `週${WEEKDAYS_ZH[cursor.getDay()]}`,
      day: cursor.getDate(),
      isToday: dateStr === todayStr,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cols;
});

// --- Cell data ---
const scheduleIndex = computed(() => {
  const idx = new Map<string, EmployeeSchedule[]>();
  for (const s of props.schedules) {
    const key = `${s.shiftTemplateId}::${s.workDate}`;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key)!.push(s);
  }
  return idx;
});

function getCellSchedules(
  templateId: number,
  dateStr: string,
): EmployeeSchedule[] {
  return scheduleIndex.value.get(`${templateId}::${dateStr}`) ?? [];
}

// --- Drag and drop ---
const dragOverCell = ref<{ templateId: number; dateStr: string } | null>(null);

function isDragOver(templateId: number, dateStr: string): boolean {
  return (
    dragOverCell.value?.templateId === templateId &&
    dragOverCell.value?.dateStr === dateStr
  );
}

function onDragOver(templateId: number, dateStr: string) {
  dragOverCell.value = { templateId, dateStr };
}

function onDragLeave() {
  dragOverCell.value = null;
}

function onDrop(templateId: number, dateStr: string, event: DragEvent) {
  dragOverCell.value = null;
  const employeeIdStr = event.dataTransfer?.getData("employeeId");
  if (!employeeIdStr) return;
  emit("assign", templateId, dateStr, employeeIdStr);
}
</script>
