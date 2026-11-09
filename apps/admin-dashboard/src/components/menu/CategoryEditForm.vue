<template>
  <!-- Modal overlay -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    @click.self="$emit('cancel')"
  >
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

    <!-- Modal card -->
    <div
      data-category-form
      data-testid="admin-category-form"
      class="relative bg-white rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] p-6 w-full max-w-md mx-4"
    >
      <div class="flex items-center gap-2 mb-5">
        <span class="w-2 h-2 rounded-full bg-ios-success" />
        <h3 class="text-[17px] font-bold text-ios-text">
          {{ isEditing ? t("menu.editCategory") : t("menu.addCategory") }}
        </h3>
      </div>

      <form @submit.prevent="handleSubmit">
        <div class="space-y-4">
          <div>
            <label
              class="block text-xs font-semibold text-ios-secondary uppercase tracking-wider mb-1.5"
            >
              {{ t("menu.form.categoryName") }}
              <span class="text-ios-error">*</span>
            </label>
            <input
              ref="nameInput"
              v-model="form.name"
              data-testid="admin-category-name-input"
              type="text"
              required
              :placeholder="t('menu.form.categoryNamePlaceholder')"
              class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-sm text-ios-text outline-none transition-all duration-200 focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white placeholder:text-ios-tertiary"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label
                class="block text-xs font-semibold text-ios-secondary uppercase tracking-wider mb-1.5"
              >
                {{ t("menu.form.nameEn") }}
              </label>
              <input
                v-model="form.nameEn"
                data-testid="admin-category-name-en-input"
                type="text"
                placeholder="English name"
                class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-sm text-ios-text outline-none transition-all duration-200 focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white placeholder:text-ios-tertiary"
              />
            </div>
            <div>
              <label
                class="block text-xs font-semibold text-ios-secondary uppercase tracking-wider mb-1.5"
              >
                {{ t("menu.form.sortOrder") }}
              </label>
              <input
                v-model.number="form.sortOrder"
                data-testid="admin-category-sort-order-input"
                type="number"
                min="0"
                class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-sm text-ios-text outline-none transition-all duration-200 focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white placeholder:text-ios-tertiary"
              />
            </div>
          </div>

          <div>
            <label
              class="block text-xs font-semibold text-ios-secondary uppercase tracking-wider mb-1.5"
            >
              {{ t("menu.form.description") }}
            </label>
            <input
              v-model="form.description"
              data-testid="admin-category-description-input"
              type="text"
              :placeholder="t('menu.form.descriptionPlaceholder')"
              class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-sm text-ios-text outline-none transition-all duration-200 focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white placeholder:text-ios-tertiary"
            />
          </div>

          <!--
            Visibility toggle. Categories could already be hidden through the
            API, but nothing in the dashboard could turn it back on — and a
            hidden category took all of its items off the owner's own menu
            screen with it (#83).
          -->
          <div
            class="flex items-center justify-between gap-4 bg-ios-bg rounded-xl px-3.5 py-3"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-ios-text">
                {{ t("menu.form.categoryVisible") }}
              </div>
              <div class="text-xs text-ios-secondary mt-0.5">
                {{
                  form.isVisible
                    ? t("menu.form.categoryVisibleHint")
                    : t("menu.form.categoryHiddenHint")
                }}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              data-testid="admin-category-visible-toggle"
              :aria-checked="form.isVisible ? 'true' : 'false'"
              :aria-label="t('menu.form.categoryVisible')"
              :class="[
                'relative shrink-0 w-[51px] h-[31px] rounded-full transition-colors duration-200 ease-out outline-none focus-visible:shadow-[0_0_0_3px_rgba(0,122,255,0.25)]',
                form.isVisible ? 'bg-ios-success' : 'bg-ios-separator',
              ]"
              @click="form.isVisible = !form.isVisible"
            >
              <span
                :class="[
                  'absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-out',
                  form.isVisible ? 'translate-x-[20px]' : 'translate-x-0',
                ]"
              />
            </button>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-5">
          <button
            type="button"
            data-testid="admin-category-cancel"
            class="px-4 py-2 rounded-full text-[13px] font-medium text-ios-secondary hover:bg-black/[0.04] transition-colors"
            @click="$emit('cancel')"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="submit"
            data-testid="admin-category-submit"
            :disabled="saving"
            :aria-busy="saving"
            class="px-5 py-2 rounded-full text-[13px] font-semibold bg-ios-primary text-white hover:bg-blue-600 transition-colors disabled:opacity-60"
          >
            {{
              saving
                ? t("common.saving")
                : isEditing
                  ? t("menu.form.update")
                  : t("menu.form.add")
            }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useI18n } from "@/i18n";
import type { CategoryData } from "@/composables/useMenuManagement";

const { t } = useI18n();

const props = defineProps<{
  editingCategory?: CategoryData | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  save: [
    form: {
      name: string;
      nameEn: string;
      description: string;
      sortOrder: number;
      isVisible: boolean;
    },
    editingId?: number,
  ];
  cancel: [];
}>();

const nameInput = ref<HTMLInputElement>();

const form = ref({
  name: "",
  nameEn: "",
  description: "",
  sortOrder: 0,
  isVisible: true,
});

const isEditing = ref(false);

watch(
  () => props.editingCategory,
  (cat) => {
    if (cat) {
      isEditing.value = true;
      form.value = {
        name: cat.name,
        nameEn: cat.nameEn || "",
        description: cat.description || "",
        sortOrder: cat.sortOrder,
        // Only an explicit false means hidden — an older payload that omits the
        // flag must not silently hide the category on the next save.
        isVisible: cat.isVisible !== false,
      };
    } else {
      isEditing.value = false;
      form.value = {
        name: "",
        nameEn: "",
        description: "",
        sortOrder: 0,
        isVisible: true,
      };
    }
    nextTick(() => nameInput.value?.focus());
  },
  { immediate: true },
);

const handleSubmit = () => {
  if (props.saving) return;
  emit("save", { ...form.value }, props.editingCategory?.id);
};
</script>
