<template>
  <div>
    <!-- Phone: one scrollable chip row instead of a tall panel -->
    <div v-if="compact" class="mb-3 flex items-center gap-2">
      <div
        role="group"
        :aria-label="t('menu.categoryPanel.title')"
        data-testid="category-chip-row"
        class="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-1"
      >
        <button
          type="button"
          data-testid="category-chip-all"
          :aria-pressed="selectedCategoryId === null"
          :class="chipClass(selectedCategoryId === null)"
          @click="emit('select', null)"
        >
          {{ t("menu.categoryPanel.allItems") }}
        </button>
        <button
          v-for="category in localCategories"
          :key="category.id"
          type="button"
          data-testid="category-chip"
          :data-category-id="category.id"
          :aria-pressed="selectedCategoryId === category.id"
          :class="chipClass(selectedCategoryId === category.id)"
          @click="emit('select', category.id)"
        >
          {{ category.name }}
        </button>
      </div>
      <button
        type="button"
        data-testid="manage-categories-btn"
        :aria-label="t('menu.manageCategories')"
        :aria-expanded="managing"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ios-secondary shadow-[0_1px_6px_rgba(0,0,0,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-primary"
        @click="managing = !managing"
      >
        <Cog6ToothIcon class="h-5 w-5" aria-hidden="true" />
      </button>
    </div>

    <!-- Category List Card -->
    <div
      v-if="!compact || managing"
      class="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] overflow-hidden lg:sticky lg:top-7 mb-4 lg:mb-0"
    >
      <!-- Header -->
      <div class="flex justify-between items-center px-5 pt-5 pb-4">
        <h2 class="text-[17px] font-bold text-ios-text">
          {{ t("menu.categoryPanel.title") }}
        </h2>
        <button
          class="flex min-h-11 items-center gap-1 px-3.5 py-1.5 lg:min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-primary bg-ios-green-soft text-ios-green-deep rounded-full text-[13px] font-semibold hover:bg-green-200 transition-colors"
          data-testid="add-category-btn"
          @click="$emit('add-category')"
        >
          <PlusIcon class="h-3.5 w-3.5" />
          {{ t("menu.categoryPanel.add") }}
        </button>
      </div>

      <!-- "All items" row -->
      <div
        :class="[
          'flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors border-t border-black/[0.04]',
          selectedCategoryId === null
            ? 'bg-ios-primary/[0.06]'
            : 'hover:bg-black/[0.02]',
        ]"
        @click="$emit('select', null)"
      >
        <div
          class="w-9 h-9 rounded-[10px] bg-ios-bg flex items-center justify-center text-ios-secondary"
        >
          <Squares2X2Icon class="h-[18px] w-[18px]" />
        </div>
        <div>
          <div class="text-sm font-medium text-ios-secondary">
            {{ t("menu.categoryPanel.allItems") }}
          </div>
          <div class="text-xs text-ios-tertiary">
            {{ t("menu.categoryPanel.totalItems", { count: totalItems }) }}
          </div>
        </div>
      </div>

      <!-- Draggable category list -->
      <VueDraggable
        v-model="localCategories"
        handle=".drag-handle"
        ghost-class="opacity-40"
        :animation="200"
        @end="handleReorder"
      >
        <div
          v-for="category in localCategories"
          :key="category.id"
          :class="[
            'flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors relative group',
            selectedCategoryId === category.id
              ? 'bg-ios-primary/[0.06]'
              : 'hover:bg-ios-primary/[0.03]',
          ]"
          data-testid="category-row"
          :data-category-id="category.id"
          :data-hidden="isHidden(category) ? 'true' : 'false'"
          @click="emit('select', category.id)"
        >
          <!-- Active indicator bar -->
          <div
            v-if="selectedCategoryId === category.id"
            class="absolute left-0 top-2 bottom-2 w-[3px] bg-ios-primary rounded-r"
          />

          <!-- Drag handle (visible on hover) -->
          <div
            class="drag-handle w-4 flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity text-ios-tertiary"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </div>

          <!-- Category info -->
          <div
            :class="[
              'flex-1 min-w-0 transition-opacity duration-200',
              isHidden(category) ? 'opacity-50' : '',
            ]"
          >
            <div class="flex items-center gap-1.5 flex-wrap">
              <span
                :class="[
                  'text-sm font-semibold',
                  selectedCategoryId === category.id
                    ? 'text-ios-primary'
                    : 'text-ios-text',
                ]"
              >
                {{ category.name }}
              </span>
              <span
                class="text-[11px] font-medium text-ios-secondary bg-ios-bg px-1.5 py-px rounded-full"
              >
                {{ getItemsInCategory(category.id).length }}
              </span>
              <!-- A hidden category is still listed here on purpose: it used to
                   disappear from the owner's own dashboard along with all of its
                   items, leaving no way to un-hide it (#83). -->
              <span
                v-if="isHidden(category)"
                data-testid="category-hidden-badge"
                class="inline-flex items-center gap-1 text-[11px] font-semibold text-ios-orange-deep bg-ios-orange-soft px-2 py-px rounded-full"
              >
                <EyeSlashIcon class="h-3 w-3" />
                {{ t("menu.categoryPanel.hidden") }}
              </span>
            </div>
            <div class="text-xs text-ios-secondary mt-0.5">
              {{ getCategoryMeta(category) }}
            </div>
          </div>

          <!-- Hover actions -->
          <div
            :class="[
              'flex gap-1 transition-opacity focus-within:opacity-100',
              compact ? '' : 'opacity-0 group-hover:opacity-100',
            ]"
          >
            <button
              :class="[actionBtn, 'hover:bg-black/5 hover:text-ios-text']"
              :data-testid="`admin-category-edit-${category.id}`"
              :title="t('common.edit')"
              :aria-label="t('common.edit')"
              @click.stop="emit('edit-category', category)"
            >
              <PencilIcon class="h-3.5 w-3.5" />
            </button>
            <button
              :class="[actionBtn, 'hover:bg-ios-red-soft hover:text-ios-error']"
              :data-testid="`admin-category-delete-${category.id}`"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
              @click.stop="emit('delete-category', category)"
            >
              <TrashIcon class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </VueDraggable>
    </div>

    <!-- Category edit form is rendered as a modal by MenuView -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "@/i18n";
import { VueDraggable } from "vue-draggable-plus";
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  Squares2X2Icon,
  Cog6ToothIcon,
  EyeSlashIcon,
} from "@heroicons/vue/24/outline";
import type {
  CategoryData,
  MenuItemData,
} from "@/composables/useMenuManagement";

const { t } = useI18n();

const props = defineProps<{
  categories: CategoryData[];
  menuItems: MenuItemData[];
  selectedCategoryId: number | null;
  compact?: boolean;
}>();

const emit = defineEmits<{
  select: [categoryId: number | null];
  "add-category": [];
  "edit-category": [category: CategoryData];
  "delete-category": [category: CategoryData];
  reorder: [categories: CategoryData[]];
}>();

const managing = ref(false);

const chipClass = (active: boolean) => [
  "shrink-0 min-h-11 rounded-full px-4 text-[14px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-primary",
  active
    ? "bg-ios-primary text-white"
    : "bg-white text-ios-text shadow-[0_1px_6px_rgba(0,0,0,0.06)]",
];

// 44px hit area on touch (Apple HIG), the old 28px square from lg up.
const actionBtn =
  "w-11 h-11 lg:w-7 lg:h-7 flex items-center justify-center rounded-lg text-ios-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-primary";

// Local writable copy for VueDraggable v-model (props are readonly)
const localCategories = ref<CategoryData[]>([]);
watch(
  () => props.categories,
  (newVal) => {
    localCategories.value = [...newVal];
  },
  { immediate: true, deep: true },
);

const totalItems = computed(() => props.menuItems.length);

const getItemsInCategory = (categoryId: number) => {
  return props.menuItems.filter((item) => item.categoryId === categoryId);
};

/**
 * A category is "hidden" when either flag is off. `isVisible` is what the
 * category form toggles; `isActive` is set elsewhere but has the same effect on
 * the customer menu, so both render the same de-emphasised state (#83).
 * Exposed as `data-hidden` on the row so tests assert state, not styling.
 */
const isHidden = (category: CategoryData) =>
  category.isVisible === false || category.isActive === false;

const getCategoryMeta = (category: CategoryData) => {
  if (isHidden(category)) return t("menu.categoryPanel.hiddenHint");
  const items = getItemsInCategory(category.id);
  if (items.length === 0) return t("menu.categoryPanel.noItems");
  const available = items.filter((i) => i.isAvailable).length;
  if (available === items.length) return t("menu.categoryPanel.allAvailable");
  const unavailable = items.length - available;
  return t("menu.categoryPanel.mixedStatus", { available, unavailable });
};

// Called after drag-and-drop ends — emit the new order
const handleReorder = () => {
  emit("reorder", [...localCategories.value]);
};
</script>
