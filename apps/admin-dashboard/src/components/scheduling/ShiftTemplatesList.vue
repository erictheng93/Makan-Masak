<template>
  <div class="w-full">
    <!-- Header -->
    <div
      class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 p-6 bg-white rounded-lg shadow"
    >
      <div class="flex-1">
        <div class="flex items-center gap-3 mb-2">
          <div class="p-2 bg-teal-100 rounded-lg">
            <QueueListIcon class="h-6 w-6 text-teal-600" />
          </div>
          <h2 class="text-2xl font-bold text-gray-900">
            {{ t("shiftTemplates.management") }}
          </h2>
        </div>
        <p v-if="!loading" class="text-sm text-gray-600">
          {{ t("shiftTemplates.totalCount", { count: templates.length }) }}
        </p>
      </div>
      <button
        class="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
        @click="$emit('add')"
      >
        <PlusIcon class="h-5 w-5" />
        <span>{{ t("shiftTemplates.addTemplate") }}</span>
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-20">
      <div
        class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"
      ></div>
      <p class="text-gray-600">{{ t("shiftTemplates.loading") }}</p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="templates.length === 0"
      class="text-center py-20 bg-white rounded-lg shadow"
    >
      <div class="flex items-center justify-center mb-6">
        <div class="p-6 bg-gray-100 rounded-full">
          <QueueListIcon class="h-16 w-16 text-gray-400" />
        </div>
      </div>
      <h3 class="text-xl font-bold text-gray-900 mb-3">
        {{ t("shiftTemplates.empty.title") }}
      </h3>
      <p class="text-gray-600 mb-8">{{ t("shiftTemplates.empty.subtitle") }}</p>
      <button
        class="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
        @click="$emit('add')"
      >
        <PlusIcon class="h-5 w-5" />
        <span>{{ t("shiftTemplates.addFirstTemplate") }}</span>
      </button>
    </div>

    <!-- Templates Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      <div
        v-for="template in templates"
        :key="template.id"
        class="bg-white rounded-lg border-2 border-l-4 border-gray-200 shadow hover:shadow-lg transition-all duration-200 hover:-translate-y-1 flex flex-col"
        :style="{ borderLeftColor: template.colorCode }"
      >
        <!-- Card Header -->
        <div
          class="flex items-center justify-between p-5 border-b border-gray-200 bg-gray-50"
        >
          <div
            class="flex items-center gap-2 px-4 py-2 rounded-lg border-2 font-bold"
            :style="{
              backgroundColor: template.colorCode + '15',
              color: template.colorCode,
              borderColor: template.colorCode,
            }"
          >
            <div
              class="w-2.5 h-2.5 rounded-full"
              :style="{ backgroundColor: template.colorCode }"
            ></div>
            <span>{{ template.name }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="p-2 rounded-lg hover:bg-blue-50 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              :title="t('shiftTemplates.editTemplate')"
              :aria-label="t('shiftTemplates.editTemplate')"
              @click="$emit('edit', template)"
            >
              <PencilIcon
                class="h-4 w-4 text-gray-400 group-hover:text-blue-600"
              />
            </button>
            <button
              class="p-2 rounded-lg hover:bg-red-50 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              :title="t('shiftTemplates.deleteTemplate')"
              :aria-label="t('shiftTemplates.deleteTemplate')"
              @click="handleDelete(template)"
            >
              <TrashIcon
                class="h-4 w-4 text-gray-400 group-hover:text-red-600"
              />
            </button>
          </div>
        </div>

        <!-- Card Content -->
        <div class="p-5 flex-1 space-y-4">
          <!-- Time Info -->
          <div class="grid grid-cols-2 gap-4">
            <div
              class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
            >
              <ClockIcon class="h-5 w-5 text-gray-500 flex-shrink-0" />
              <div class="flex flex-col min-w-0">
                <span
                  class="text-xs font-semibold text-gray-500 uppercase tracking-wide"
                  >{{ t("shiftTemplates.startTime") }}</span
                >
                <span class="text-base font-bold text-blue-600 font-mono">{{
                  template.startTime
                }}</span>
              </div>
            </div>
            <div
              class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
            >
              <ClockIcon class="h-5 w-5 text-gray-500 flex-shrink-0" />
              <div class="flex flex-col min-w-0">
                <span
                  class="text-xs font-semibold text-gray-500 uppercase tracking-wide"
                  >{{ t("shiftTemplates.endTime") }}</span
                >
                <span class="text-base font-bold text-blue-600 font-mono">{{
                  template.endTime
                }}</span>
              </div>
            </div>
          </div>

          <!-- Duration -->
          <div class="space-y-2">
            <div class="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                :style="{
                  width: `${(calculateDuration(template.startTime, template.endTime) / 24) * 100}%`,
                  backgroundColor: template.colorCode,
                }"
              ></div>
            </div>
            <div
              class="flex items-center gap-2 text-sm font-semibold text-gray-600"
            >
              <PlayIcon class="h-4 w-4 text-gray-500" />
              <span class="text-gray-900"
                >{{ calculateDuration(template.startTime, template.endTime) }}
                {{ t("shiftTemplates.hours") }}</span
              >
            </div>
          </div>

          <!-- Description -->
          <div
            v-if="template.description"
            class="flex gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
          >
            <DocumentTextIcon
              class="h-4 w-4 text-gray-500 flex-shrink-0 mt-0.5"
            />
            <p class="flex-1 text-sm text-gray-700 leading-relaxed">
              {{ template.description }}
            </p>
          </div>

          <!-- Metadata -->
          <div class="flex items-center gap-3 pt-4 border-t border-gray-200">
            <div class="flex items-center gap-2 text-xs text-gray-600">
              <ChartBarIcon class="h-4 w-4 text-gray-500" />
              <span>{{
                t("shiftTemplates.usageCount", {
                  count: template.usageCount || 0,
                })
              }}</span>
            </div>
            <div
              v-if="template.isDefault"
              class="flex items-center gap-1 px-2.5 py-1 bg-yellow-100 text-yellow-800 rounded-lg text-xs font-bold border border-yellow-200"
            >
              <StarIcon class="h-3 w-3 fill-current" />
              <span>{{ t("shiftTemplates.defaultTemplate") }}</span>
            </div>
          </div>
        </div>

        <!-- Card Footer -->
        <div class="p-4 bg-gray-50 border-t border-gray-200">
          <button
            class="flex items-center justify-center gap-2 w-full px-4 py-3 border-2 rounded-lg font-bold transition-all hover:-translate-y-0.5 hover:shadow"
            :style="{
              backgroundColor: template.colorCode + '15',
              color: template.colorCode,
              borderColor: template.colorCode,
            }"
            @click="$emit('use', template)"
          >
            <CheckIcon class="h-5 w-5" />
            <span>{{ t("shiftTemplates.useTemplate") }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@/i18n";
import { useConfirmModal } from "@/composables/useConfirmModal";
import type { ShiftTemplate } from "@/types/scheduling";
import {
  QueueListIcon,
  PlusIcon,
  ClockIcon,
  PlayIcon,
  DocumentTextIcon,
  ChartBarIcon,
  StarIcon,
  CheckIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";

interface Props {
  templates: ShiftTemplate[];
  loading?: boolean;
}

withDefaults(defineProps<Props>(), {
  loading: false,
});

const { t } = useI18n();
const { confirm: confirmModal } = useConfirmModal();

const emit = defineEmits<{
  add: [];
  edit: [template: ShiftTemplate];
  delete: [template: ShiftTemplate];
  use: [template: ShiftTemplate];
}>();

// Methods
const calculateDuration = (startTime: string, endTime: string): number => {
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);

  const startMinutes = startHour * 60 + startMin;
  let endMinutes = endHour * 60 + endMin;

  // Handle overnight shifts
  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }

  const durationMinutes = endMinutes - startMinutes;
  return Math.round((durationMinutes / 60) * 10) / 10; // Round to 1 decimal place
};

const handleDelete = async (template: ShiftTemplate) => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("shiftTemplates.deleteTemplate"),
    message: t("shiftTemplates.confirm.delete", { name: template.name }),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;
  emit("delete", template);
};
</script>
