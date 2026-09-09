<template>
  <div class="bg-white rounded-2xl p-6 shadow-sm">
    <h3 class="text-lg font-semibold text-ios-text mb-5">
      {{ t("feedback.form.title") }}
    </h3>

    <form class="space-y-5" @submit.prevent="handleSubmit">
      <!-- Category -->
      <div>
        <label class="block text-sm font-medium text-ios-text mb-2">
          {{ t("feedback.form.category") }}
          <span class="text-ios-red">*</span>
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="cat in categories"
            :key="cat.value"
            type="button"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200"
            :class="
              form.category === cat.value
                ? 'bg-ios-blue text-white shadow-sm'
                : 'bg-gray-100 text-ios-text/85 hover:bg-gray-200'
            "
            :data-testid="`feedback-category-${cat.value}`"
            @click="form.category = cat.value"
          >
            <component :is="cat.icon" class="w-3.5 h-3.5" />
            {{ t(`feedback.categories.${cat.value}`) }}
          </button>
        </div>
      </div>

      <!-- Priority & Module row -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-ios-text mb-2">
            {{ t("feedback.form.priority") }}
          </label>
          <div class="flex items-center gap-5">
            <button
              v-for="p in priorities"
              :key="p.value"
              type="button"
              class="flex flex-col items-center gap-1.5 group"
              @click="selectPriority(p.value)"
            >
              <span
                class="w-9 h-9 rounded-full transition-all duration-200"
                :class="
                  form.priority === p.value
                    ? 'ring-2 ring-offset-2 shadow-md scale-110'
                    : 'opacity-40 group-hover:opacity-70 group-hover:scale-105'
                "
                :style="{
                  backgroundColor: p.color,
                  '--tw-ring-color': p.color,
                }"
              />
              <span
                class="text-[10px] font-medium transition-colors duration-200"
                :class="
                  form.priority === p.value
                    ? 'text-ios-text'
                    : 'text-ios-secondary'
                "
              >
                {{ t(`feedback.priorities.${p.value}`) }}
              </span>
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-ios-text mb-2">
            {{ t("feedback.form.relatedModule") }}
          </label>
          <select
            v-model="form.relatedModule"
            data-testid="feedback-module"
            class="w-full px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all"
          >
            <option v-for="mod in modules" :key="mod" :value="mod">
              {{ t(`feedback.modules.${mod}`) }}
            </option>
          </select>
        </div>
      </div>

      <!-- Subject -->
      <div>
        <label class="block text-sm font-medium text-ios-text mb-2">
          {{ t("feedback.form.subject") }}
          <span class="text-ios-red">*</span>
        </label>
        <input
          v-model="form.subject"
          data-testid="feedback-subject"
          type="text"
          :placeholder="t('feedback.form.subjectPlaceholder')"
          maxlength="200"
          class="w-full px-4 py-2.5 bg-gray-50 border-0 rounded-xl text-sm text-ios-text placeholder-ios-secondary focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all"
        />
        <p class="mt-1 text-xs text-ios-secondary text-right">
          {{ form.subject.length }}/200
        </p>
      </div>

      <!-- Description -->
      <div>
        <label class="block text-sm font-medium text-ios-text mb-2">
          {{ t("feedback.form.description") }}
          <span class="text-ios-red">*</span>
        </label>
        <textarea
          v-model="form.description"
          data-testid="feedback-description"
          :placeholder="t('feedback.form.descriptionPlaceholder')"
          rows="5"
          maxlength="5000"
          class="w-full px-4 py-2.5 bg-gray-50 border-0 rounded-xl text-sm text-ios-text placeholder-ios-secondary focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all resize-none"
        />
        <p class="mt-1 text-xs text-ios-secondary text-right">
          {{ form.description.length }}/5000
        </p>
      </div>

      <!-- Actions -->
      <div class="flex gap-3 pt-1">
        <button
          type="button"
          class="flex-1 py-2.5 rounded-full text-sm font-medium bg-gray-100 text-ios-text/85 hover:bg-gray-200 transition-all duration-200"
          @click="$emit('cancel')"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          type="submit"
          data-testid="feedback-submit"
          :disabled="isSubmitting || !isValid"
          class="flex-1 py-2.5 rounded-full text-sm font-semibold bg-ios-blue text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          <span v-if="isSubmitting">{{ t("common.submitting") }}</span>
          <span v-else>{{ t("feedback.form.submit") }}</span>
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from "vue";
import {
  Bug,
  Lightbulb,
  MousePointerClick,
  Zap,
  CreditCard,
  HelpCircle,
} from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useFeedback, type FeedbackItem } from "@/composables/useFeedback";

const emit = defineEmits<{
  cancel: [];
  submitted: [feedback: FeedbackItem];
}>();

const { t } = useI18n();
const { isSubmitting, submitFeedback } = useFeedback();

const form = reactive({
  category: "" as string,
  priority: "medium" as string,
  relatedModule: "other" as string,
  subject: "",
  description: "",
});

const categories = [
  { value: "bug_report", icon: Bug },
  { value: "feature_request", icon: Lightbulb },
  { value: "usability", icon: MousePointerClick },
  { value: "performance", icon: Zap },
  { value: "billing", icon: CreditCard },
  { value: "other", icon: HelpCircle },
];

const priorities = [
  { value: "low", color: "#34C759" },
  { value: "medium", color: "#FFD60A" },
  { value: "high", color: "#FF9500" },
  { value: "urgent", color: "#FF3B30" },
];

const categoryPriorityDefaults: Record<string, string> = {
  bug_report: "high",
  performance: "high",
  billing: "urgent",
  feature_request: "medium",
  usability: "medium",
  other: "low",
};

let priorityManuallySet = false;

watch(
  () => form.category,
  (cat) => {
    if (cat && categoryPriorityDefaults[cat] && !priorityManuallySet) {
      form.priority = categoryPriorityDefaults[cat];
    }
  },
);

function selectPriority(value: string) {
  form.priority = value;
  priorityManuallySet = true;
}

const modules = [
  "menu",
  "orders",
  "pos",
  "tables",
  "reservations",
  "scheduling",
  "analytics",
  "settings",
  "integrations",
  "other",
];

const isValid = computed(
  () =>
    form.category &&
    form.subject.trim().length >= 5 &&
    form.description.trim().length >= 10,
);

async function handleSubmit() {
  if (!isValid.value) return;
  const result = await submitFeedback({
    subject: form.subject.trim(),
    description: form.description.trim(),
    category: form.category,
    priority: form.priority,
    relatedModule: form.relatedModule,
  });
  emit("submitted", result);
}
</script>
