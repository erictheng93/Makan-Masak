<template>
  <section
    class="mb-4 rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="text-[15px] font-bold text-ios-text">
          {{ t("menu.imageImport.title") }}
        </h3>
        <p class="mt-1 text-[13px] text-ios-secondary">
          {{ t("menu.imageImport.temporaryNotice") }}
        </p>
      </div>
      <label
        class="cursor-pointer rounded-full bg-ios-bg px-3.5 py-2 text-[13px] font-semibold text-ios-text hover:bg-ios-separator"
      >
        {{ t("menu.imageImport.selectImages") }}
        <input
          class="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          @change="selectImages"
        />
      </label>
    </div>

    <p v-if="uploadError" class="mt-3 text-[13px] text-ios-error">
      {{ uploadError }}
    </p>
    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div class="rounded-xl bg-ios-bg p-3">
        <p class="mb-2 text-[13px] font-semibold text-ios-text">
          {{ t("menu.imageImport.sourceImages") }}
        </p>
        <div v-if="sourceImages.length" class="grid grid-cols-2 gap-2">
          <img
            v-for="src in sourceImages"
            :key="src"
            :src="src"
            :alt="t('menu.imageImport.sourceImagesAlt')"
            class="max-h-72 w-full rounded-lg object-contain bg-white"
          />
        </div>
        <p v-else class="py-10 text-center text-[13px] text-ios-secondary">
          {{ t("menu.imageImport.emptySource") }}
        </p>
      </div>

      <div class="min-w-0 space-y-4">
        <div>
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-[13px] font-semibold text-ios-text">
              {{ t("menu.form.category") }}
            </h4>
            <button
              type="button"
              data-testid="image-menu-import-add-category"
              class="text-[13px] font-semibold text-blue-600"
              @click="addCategory"
            >
              {{ t("menu.addCategory") }}
            </button>
          </div>
          <div class="space-y-2">
            <div
              v-for="category in draftCategories"
              :key="category.key"
              class="flex gap-2"
            >
              <input
                v-model="category.name"
                aria-label="分類名稱"
                class="min-w-0 flex-1 rounded-lg bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                placeholder="分類名稱"
              />
              <span
                v-if="categoryErrors[category.key]"
                class="text-[12px] text-ios-error"
              >
                {{ errorText(categoryErrors[category.key]) }}
              </span>
              <button
                type="button"
                class="rounded-lg px-2 text-[13px] text-ios-error hover:bg-red-50"
                aria-label="刪除分類"
                @click="removeCategory(category.key)"
              >
                {{ t("common.delete") }}
              </button>
            </div>
          </div>
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-[13px] font-semibold text-ios-text">
              {{ t("menu.title") }}
            </h4>
            <button
              type="button"
              data-testid="image-menu-import-add-item"
              class="text-[13px] font-semibold text-blue-600"
              @click="addItem"
            >
              {{ t("menu.addItem") }}
            </button>
          </div>
          <div class="space-y-3">
            <div
              v-for="(item, index) in draftItems"
              :key="item.id"
              class="rounded-xl border border-ios-separator p-3"
            >
              <div class="mb-2 flex justify-between">
                <span class="text-[12px] font-semibold text-ios-secondary">{{
                  t("menu.imageImport.row", { number: index + 1 })
                }}</span
                ><button
                  type="button"
                  class="text-[12px] text-ios-error"
                  @click="removeItem(item.id)"
                >
                  {{ t("common.delete") }}
                </button>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="text-[12px] text-ios-text/70"
                  >名稱<input
                    v-model="item.name"
                    class="mt-1 w-full rounded-lg bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                  /><span v-if="errors[item.id]?.name" class="text-ios-error">{{
                    errorText(errors[item.id]?.name)
                  }}</span></label
                >
                <label class="text-[12px] text-ios-text/70"
                  >{{ t("menu.imageImport.price", { symbol: currencySymbol })
                  }}<input
                    v-model="item.price"
                    :data-testid="`image-import-price-${item.id}`"
                    :inputmode="decimals > 0 ? 'decimal' : 'numeric'"
                    class="mt-1 w-full rounded-lg bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                  /><span
                    v-if="errors[item.id]?.price"
                    :data-testid="`image-import-price-error-${item.id}`"
                    class="text-ios-error"
                    >{{ errorText(errors[item.id]?.price) }}</span
                  ></label
                >
                <label class="text-[12px] text-ios-text/70"
                  >{{ t("menu.form.category")
                  }}<select
                    v-model="item.categoryKey"
                    class="mt-1 w-full rounded-lg bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                  >
                    <option value="">
                      {{ t("menu.form.selectCategory") }}
                    </option>
                    <option
                      v-for="category in categoryOptions"
                      :key="category.key"
                      :value="category.key"
                    >
                      {{ category.name }}
                    </option></select
                  ><span
                    v-if="errors[item.id]?.categoryKey"
                    class="text-ios-error"
                    >{{ errorText(errors[item.id]?.categoryKey) }}</span
                  ></label
                >
                <label class="text-[12px] text-ios-text/70"
                  >{{ t("menu.form.sortOrder")
                  }}<input
                    v-model="item.sortOrder"
                    inputmode="numeric"
                    class="mt-1 w-full rounded-lg bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                  /><span
                    v-if="errors[item.id]?.sortOrder"
                    class="text-ios-error"
                    >{{ errorText(errors[item.id]?.sortOrder) }}</span
                  ></label
                >
              </div>
              <label class="mt-2 block text-[12px] text-ios-text/70"
                >{{ t("menu.form.description")
                }}<textarea
                  v-model="item.description"
                  rows="2"
                  class="mt-1 w-full rounded-lg bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                />
              </label>
              <label
                class="mt-2 inline-flex items-center gap-2 text-[13px] text-ios-text"
                ><input v-model="item.isAvailable" type="checkbox" />{{
                  t("menu.available")
                }}</label
              >
            </div>
          </div>
        </div>
        <p v-if="publishError" class="text-[13px] text-ios-error">
          {{ publishError }}
        </p>
        <button
          type="button"
          data-testid="image-menu-import-publish"
          class="rounded-full bg-blue-600 px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
          :disabled="isPublishing || !sourceImages.length || !draftItems.length"
          @click="publish"
        >
          {{
            isPublishing
              ? t("menu.imageImport.publishing")
              : t("menu.imageImport.publish")
          }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import type { CategoryData } from "@/composables/useMenuManagement";
import type {
  ImageAssistedMenuItemDraft,
  ImageAssistedMenuErrorCode,
  ImageAssistedMenuItemErrors,
  ImageMenuCategoryErrors,
  ImageMenuCategoryDraft,
} from "@/utils/imageAssistedMenuImport";

const props = defineProps<{
  categories: CategoryData[];
  sourceImages: string[];
  isPublishing: boolean;
  uploadError?: string;
  publishError?: string;
  errors: ImageAssistedMenuItemErrors;
  categoryErrors: ImageMenuCategoryErrors;
}>();
const { t } = useI18n();
const { currencySymbol, decimals } = useCurrency();
const emit = defineEmits<{
  selectImages: [files: File[]];
  publish: [
    value: {
      categories: ImageMenuCategoryDraft[];
      items: ImageAssistedMenuItemDraft[];
    },
  ];
}>();
let nextId = 1;
const draftCategories = ref<ImageMenuCategoryDraft[]>([]);
const draftItems = ref<ImageAssistedMenuItemDraft[]>([]);
const categoryOptions = computed(() => [
  ...props.categories.map((category) => ({
    key: `existing-${category.id}`,
    name: category.name,
  })),
  ...draftCategories.value.filter((category) => category.name.trim()),
]);
const errorText = (
  code?: ImageAssistedMenuErrorCode | "categoryNameRequired",
) =>
  code
    ? t(`menu.imageImport.validation.${code}`, {
        symbol: currencySymbol.value,
        decimals: decimals.value,
      })
    : "";
const selectImages = (event: Event) => {
  const input = event.target as HTMLInputElement;
  emit("selectImages", Array.from(input.files ?? []));
  input.value = "";
};
const addCategory = () =>
  draftCategories.value.push({
    key: `new-${nextId++}`,
    name: "",
    sortOrder: props.categories.length + draftCategories.value.length,
  });
const removeCategory = (key: string) => {
  draftCategories.value = draftCategories.value.filter(
    (category) => category.key !== key,
  );
  draftItems.value.forEach((item) => {
    if (item.categoryKey === key) item.categoryKey = "";
  });
};
const addItem = () =>
  draftItems.value.push({
    id: `item-${nextId++}`,
    name: "",
    price: "",
    categoryKey: "",
    description: "",
    isAvailable: true,
    sortOrder: String(draftItems.value.length),
  });
const removeItem = (id: string) => {
  draftItems.value = draftItems.value.filter((item) => item.id !== id);
};
const publish = () =>
  emit("publish", {
    categories: draftCategories.value.map((category) => ({
      ...category,
      name: category.name.trim(),
    })),
    items: draftItems.value,
  });
</script>
