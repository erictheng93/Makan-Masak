<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "@/i18n";
// import { VueDraggable } from 'vue-draggable-plus' // Reserved for drag-and-drop functionality
import {
  PlusIcon,
  XMarkIcon,
  Cog6ToothIcon,
  ArrowsPointingOutIcon,
  LockClosedIcon,
  LockOpenIcon,
} from "@heroicons/vue/24/outline";
import type {
  DashboardLayout,
  Widget,
  WidgetType,
  LayoutPreset,
} from "@/types/monitoring-layout";
import {
  WIDGET_TYPES,
  LAYOUT_PRESETS,
  generateWidgetId,
  WIDGET_SIZE_PRESETS,
  findNextAvailablePosition,
} from "@/types/monitoring-layout";

// Props
interface Props {
  modelValue: DashboardLayout;
  editMode?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editMode: false,
});

// Emits
const emit = defineEmits<{
  "update:modelValue": [layout: DashboardLayout];
  "add-widget": [type: WidgetType];
  "remove-widget": [widgetId: string];
  "configure-widget": [widgetId: string];
  save: [layout: DashboardLayout];
  cancel: [];
}>();

const { t } = useI18n();

// State
const localLayout = ref<DashboardLayout>({ ...props.modelValue });
const showWidgetPicker = ref(false);
const showPresetPicker = ref(false);
const selectedWidget = ref<string | null>(null);

// Computed
const gridStyle = computed(() => ({
  display: "grid",
  gridTemplateColumns: `repeat(${localLayout.value.gridColumns}, 1fr)`,
  gap: "16px",
  minHeight: "600px",
}));

const widgetsByCategory = computed(() => {
  const categories: Record<string, typeof WIDGET_TYPES> = {};
  WIDGET_TYPES.forEach((widget) => {
    if (!categories[widget.category]) {
      categories[widget.category] = [];
    }
    categories[widget.category].push(widget);
  });
  return categories;
});

const categoryLabels = computed<Record<string, string>>(() => ({
  overview: t("dashboardEditor.categoryOverview"),
  performance: t("dashboardEditor.categoryPerformance"),
  alerts: t("dashboardEditor.categoryAlerts"),
  metrics: t("dashboardEditor.categoryMetrics"),
  charts: t("dashboardEditor.categoryCharts"),
}));

// Watch
watch(
  () => props.modelValue,
  (newValue) => {
    localLayout.value = { ...newValue };
  },
  { deep: true },
);

// Methods
function addWidget(type: WidgetType) {
  const widgetMeta = WIDGET_TYPES.find((w) => w.type === type);
  if (!widgetMeta) return;

  const dimensions = WIDGET_SIZE_PRESETS[widgetMeta.defaultSize];
  const position = findNextAvailablePosition(
    localLayout.value.widgets,
    dimensions,
    localLayout.value.gridColumns,
  );

  const newWidget: Widget = {
    id: generateWidgetId(),
    type,
    title: widgetMeta.name,
    position,
    dimensions,
    config: widgetMeta.defaultConfig,
    visible: true,
    locked: false,
  };

  localLayout.value.widgets.push(newWidget);
  showWidgetPicker.value = false;
  emit("update:modelValue", localLayout.value);
  emit("add-widget", type);
}

function removeWidget(widgetId: string) {
  const index = localLayout.value.widgets.findIndex((w) => w.id === widgetId);
  if (index > -1) {
    localLayout.value.widgets.splice(index, 1);
    emit("update:modelValue", localLayout.value);
    emit("remove-widget", widgetId);
  }
}

function toggleWidgetLock(widgetId: string) {
  const widget = localLayout.value.widgets.find((w) => w.id === widgetId);
  if (widget) {
    widget.locked = !widget.locked;
    emit("update:modelValue", localLayout.value);
  }
}

function configureWidget(widgetId: string) {
  emit("configure-widget", widgetId);
}

function applyPreset(preset: LayoutPreset) {
  localLayout.value = {
    ...localLayout.value,
    widgets: [...preset.layout.widgets],
  };
  showPresetPicker.value = false;
  emit("update:modelValue", localLayout.value);
}

function getWidgetStyle(widget: Widget) {
  return {
    gridColumn: `span ${widget.dimensions.width}`,
    gridRow: `span ${widget.dimensions.height}`,
  };
}

function handleSave() {
  emit("save", localLayout.value);
}

function handleCancel() {
  emit("cancel");
}
</script>

<template>
  <div class="dashboard-layout-editor">
    <!-- 工具欄 -->
    <div
      v-if="editMode"
      class="toolbar bg-white border-b border-gray-200 p-4 mb-4"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button
            class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            @click="showWidgetPicker = true"
          >
            <PlusIcon class="w-4 h-4" />
            {{ t("dashboardEditor.addWidget") }}
          </button>
          <button
            class="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            @click="showPresetPicker = true"
          >
            {{ t("dashboardEditor.loadPreset") }}
          </button>
        </div>

        <div class="flex items-center gap-2">
          <button
            class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            @click="handleCancel"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            @click="handleSave"
          >
            {{ t("dashboardEditor.saveLayout") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 網格佈局 -->
    <div class="grid-container" :style="gridStyle">
      <div
        v-for="widget in localLayout.widgets"
        :key="widget.id"
        :style="getWidgetStyle(widget)"
        :class="[
          'widget-container bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden',
          editMode && 'edit-mode',
          selectedWidget === widget.id && 'selected',
        ]"
        @click="selectedWidget = widget.id"
      >
        <!-- Widget 標題欄 -->
        <div
          class="widget-header flex items-center justify-between p-3 bg-gray-50 border-b border-gray-200"
        >
          <h3 class="text-sm font-medium text-gray-900">{{ widget.title }}</h3>
          <div v-if="editMode" class="flex items-center gap-1">
            <button
              class="p-1 text-gray-500 hover:text-gray-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              :title="
                widget.locked
                  ? t('dashboardEditor.unlock')
                  : t('dashboardEditor.lock')
              "
              :aria-label="
                widget.locked
                  ? t('dashboardEditor.unlock')
                  : t('dashboardEditor.lock')
              "
              @click.stop="toggleWidgetLock(widget.id)"
            >
              <LockClosedIcon v-if="widget.locked" class="w-4 h-4" />
              <LockOpenIcon v-else class="w-4 h-4" />
            </button>
            <button
              class="p-1 text-gray-500 hover:text-gray-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              :title="t('dashboardEditor.configure')"
              :aria-label="t('dashboardEditor.configure')"
              @click.stop="configureWidget(widget.id)"
            >
              <Cog6ToothIcon class="w-4 h-4" />
            </button>
            <button
              class="p-1 text-red-500 hover:text-red-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              :title="t('dashboardEditor.remove')"
              :aria-label="t('dashboardEditor.remove')"
              @click.stop="removeWidget(widget.id)"
            >
              <XMarkIcon class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Widget 內容 -->
        <div class="widget-content p-4">
          <!-- 預留位置 - 在實際應用中這裡會渲染對應的小部件組件 -->
          <div class="flex items-center justify-center h-full text-gray-400">
            <div class="text-center">
              <ArrowsPointingOutIcon class="w-8 h-8 mx-auto mb-2" />
              <p class="text-sm">{{ widget.type }}</p>
              <p class="text-xs mt-1">
                {{ widget.dimensions.width }} × {{ widget.dimensions.height }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 空狀態 -->
      <div
        v-if="localLayout.widgets.length === 0"
        class="col-span-full flex flex-col items-center justify-center py-16 text-gray-400"
      >
        <ArrowsPointingOutIcon class="w-16 h-16 mb-4" />
        <p class="text-lg font-medium">{{ t("dashboardEditor.noWidgets") }}</p>
        <p class="text-sm mt-2">{{ t("dashboardEditor.noWidgetsHint") }}</p>
      </div>
    </div>

    <!-- 小部件選擇器 -->
    <Teleport to="body">
      <div
        v-if="showWidgetPicker"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        @click.self="showWidgetPicker = false"
      >
        <div
          class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] overflow-y-auto"
        >
          <div
            class="flex items-center justify-between p-6 border-b border-gray-200"
          >
            <h2 class="text-xl font-semibold text-gray-900">
              {{ t("dashboardEditor.selectWidget") }}
            </h2>
            <button
              :aria-label="t('common.close')"
              class="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              @click="showWidgetPicker = false"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="p-6 space-y-6">
            <div
              v-for="(widgets, category) in widgetsByCategory"
              :key="category"
            >
              <h3 class="text-sm font-medium text-gray-900 mb-3">
                {{ categoryLabels[category] }}
              </h3>
              <div class="grid grid-cols-2 gap-3">
                <button
                  v-for="widget in widgets"
                  :key="widget.type"
                  class="p-4 text-left border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
                  @click="addWidget(widget.type)"
                >
                  <p class="font-medium text-gray-900">{{ widget.name }}</p>
                  <p class="text-xs text-gray-500 mt-1 line-clamp-2">
                    {{ widget.description }}
                  </p>
                  <p class="text-xs text-blue-600 mt-2">
                    {{ t("dashboardEditor.defaultSize") }}:
                    {{ widget.defaultSize }}
                  </p>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 預設選擇器 -->
    <Teleport to="body">
      <div
        v-if="showPresetPicker"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        @click.self="showPresetPicker = false"
      >
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl">
          <div
            class="flex items-center justify-between p-6 border-b border-gray-200"
          >
            <h2 class="text-xl font-semibold text-gray-900">
              {{ t("dashboardEditor.selectPresetLayout") }}
            </h2>
            <button
              :aria-label="t('common.close')"
              class="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              @click="showPresetPicker = false"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="p-6 grid grid-cols-2 gap-4">
            <button
              v-for="preset in LAYOUT_PRESETS"
              :key="preset.id"
              class="p-4 text-left border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
              @click="applyPreset(preset)"
            >
              <p class="font-medium text-gray-900">{{ preset.name }}</p>
              <p class="text-sm text-gray-600 mt-2">{{ preset.description }}</p>
              <p class="text-xs text-gray-500 mt-2">
                {{
                  t("dashboardEditor.widgetCount", {
                    count: preset.layout.widgets.length,
                  })
                }}
              </p>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dashboard-layout-editor {
  min-height: 100%;
}

.grid-container {
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
}

.widget-container {
  position: relative;
  min-height: 150px;
  transition: all 0.2s;
}

.widget-container.edit-mode {
  cursor: move;
}

.widget-container.edit-mode:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.widget-container.selected {
  border-color: #007aff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.widget-content {
  height: calc(100% - 49px);
  overflow: auto;
}
</style>
