<template>
  <div class="ui-page ingredients-view">
    <div class="ui-toolbar flex justify-between items-center mb-8">
      <div>
        <h1 class="ui-page-heading text-2xl font-bold text-gray-900">
          {{ t("ingredients.title") }}
        </h1>
        <p class="text-gray-600">{{ t("ingredients.subtitle") }}</p>
      </div>
      <div class="ui-toolbar flex flex-wrap items-center gap-3">
        <button
          class="flex items-center px-4 py-2 bg-primary-700 text-white rounded-lg hover:bg-primary-800"
          @click="showForm = true"
        >
          {{ t("ingredients.addIngredient") }}
        </button>
        <button
          class="flex items-center px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          data-testid="open-recipes"
          @click="openRecipes"
        >
          {{ t("ingredients.recipes") }}
        </button>
        <button
          class="flex items-center px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          @click="showBulkImport = true"
        >
          {{ t("common.import") }}
        </button>
      </div>
    </div>

    <!-- Search & Filter -->
    <div class="ui-toolbar flex flex-wrap gap-4 mb-6 items-center">
      <label
        class="flex items-center gap-2 text-sm text-gray-700 whitespace-nowrap"
      >
        <input
          v-model="lowStockOnly"
          type="checkbox"
          data-testid="low-stock-filter"
          class="rounded border-gray-300"
          @change="
            page = 1;
            loadIngredients();
          "
        />
        {{ t("ingredients.lowStockOnly") }}
      </label>
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="t('common.search')"
        class="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        @input="debouncedLoad"
      />
      <select
        v-model="categoryFilter"
        class="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        @change="loadIngredients"
      >
        <option value="">{{ t("ingredients.allCategories") }}</option>
        <option v-for="cat in categories" :key="cat" :value="cat">
          {{ cat }}
        </option>
      </select>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-16">
      <div
        class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"
      ></div>
    </div>

    <!-- Table -->
    <IngredientTable
      v-else
      :items="ingredients"
      @edit="editIngredient"
      @delete="confirmDelete"
      @adjust="openAdjust"
    />

    <!-- Pagination -->
    <div v-if="total > limit" class="flex justify-center mt-6 gap-2">
      <button
        :disabled="page <= 1"
        class="px-3 py-1 border rounded text-sm disabled:opacity-50"
        @click="
          page--;
          loadIngredients();
        "
      >
        {{ t("common.previous") }}
      </button>
      <span class="px-3 py-1 text-sm text-gray-600">
        {{ page }} / {{ Math.ceil(total / limit) }}
      </span>
      <button
        :disabled="page >= Math.ceil(total / limit)"
        class="px-3 py-1 border rounded text-sm disabled:opacity-50"
        @click="
          page++;
          loadIngredients();
        "
      >
        {{ t("common.next") }}
      </button>
    </div>

    <!-- Add/Edit Form Modal -->
    <IngredientForm
      v-if="showForm"
      :ingredient="editingIngredient"
      @close="closeForm"
      @save="handleSave"
    />

    <!-- Bulk Import Modal -->
    <BulkImportDialog
      v-if="showBulkImport"
      :submitting="bulkImporting"
      :error="importError"
      @close="showBulkImport = false"
      @import="handleBulkImport"
    />

    <!-- Dish picker for recipe editing. RecipeEditor was a complete component
         that nothing imported, so menu_item_ingredients had no writer at all
         and every ingredient forecast came back empty. -->
    <div
      v-if="showRecipes"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      @click.self="showRecipes = false"
    >
      <div class="ui-panel bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div class="ui-toolbar flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("ingredients.recipes") }}
          </h3>
          <button
            class="text-gray-400 hover:text-gray-600"
            @click="showRecipes = false"
          >
            ✕
          </button>
        </div>

        <p
          v-if="recipeError"
          data-testid="recipe-error"
          role="alert"
          class="text-sm text-red-700 py-3"
        >
          {{ recipeError }}
        </p>
        <p v-if="recipesLoading" class="text-sm text-gray-500 py-6 text-center">
          {{ t("common.loading") }}
        </p>
        <p
          v-else-if="menuItems.length === 0 && !recipeError"
          class="text-sm text-gray-500 py-6 text-center"
        >
          {{ t("ingredients.noMenuItems") }}
        </p>
        <ul
          v-else-if="menuItems.length > 0"
          class="max-h-80 overflow-y-auto divide-y divide-gray-100"
        >
          <li v-for="item in menuItems" :key="item.id">
            <button
              class="ui-toolbar w-full flex items-center justify-between px-2 py-3 text-left hover:bg-gray-50"
              :data-testid="`edit-recipe-${item.id}`"
              @click="editRecipe(item)"
            >
              <span class="text-sm text-gray-900">{{ item.name }}</span>
              <span
                v-if="missingRecipeIds.has(item.id)"
                class="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
              >
                {{ t("ingredients.noRecipe") }}
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <StockAdjustDialog
      v-if="adjustingIngredient"
      :ingredient="adjustingIngredient"
      :submitting="adjusting"
      :error="adjustError"
      @close="adjustingIngredient = undefined"
      @submit="handleAdjust"
    />

    <RecipeEditor
      v-if="editingRecipeFor"
      :menu-item-id="editingRecipeFor.id"
      :menu-item-name="editingRecipeFor.name"
      :initial-entries="recipeEntries"
      :available-ingredients="recipeIngredients"
      :submitting="savingRecipe"
      :error="recipeSaveError"
      @close="editingRecipeFor = undefined"
      @save="handleSaveRecipe"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { ingredientApi } from "@/services/ingredientApi";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import { useConfirmModal } from "@/composables/useConfirmModal";
import IngredientTable from "@/components/ingredients/IngredientTable.vue";
import IngredientForm from "@/components/ingredients/IngredientForm.vue";
import BulkImportDialog from "@/components/ingredients/BulkImportDialog.vue";
import RecipeEditor from "@/components/ingredients/RecipeEditor.vue";
import StockAdjustDialog from "@/components/ingredients/StockAdjustDialog.vue";
import type {
  IngredientFormPayload,
  RecipeEntryResponse,
  ManualStockMovementReason,
} from "@makanmasak/shared-types";
import type {
  IngredientDefinitionResponse,
  CreateIngredientRequest,
} from "@makanmasak/shared-types";

const { t } = useI18n();
const { confirm: confirmModal } = useConfirmModal();
const authStore = useAuthStore();
const restaurantId = computed(() => authStore.restaurantId || "");

const loading = ref(false);
const ingredients = ref<IngredientDefinitionResponse[]>([]);
const categories = ref<string[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 50;
const searchQuery = ref("");
const categoryFilter = ref("");
const lowStockOnly = ref(false);
const showForm = ref(false);
const showBulkImport = ref(false);
const bulkImporting = ref(false);
const importError = ref("");

const adjustingIngredient = ref<IngredientDefinitionResponse | undefined>();
const adjusting = ref(false);
const adjustError = ref("");

function openAdjust(item: IngredientDefinitionResponse) {
  adjustError.value = "";
  adjustingIngredient.value = item;
}

async function handleAdjust(input: {
  delta: number;
  reason: ManualStockMovementReason;
  note: string | null;
}) {
  if (!restaurantId.value || !adjustingIngredient.value) return;
  adjusting.value = true;
  adjustError.value = "";
  try {
    await ingredientApi.adjustStock(
      restaurantId.value,
      adjustingIngredient.value.id,
      input,
    );
    adjustingIngredient.value = undefined;
    await loadIngredients();
  } catch (error) {
    console.error("Failed to adjust stock:", error);
    // INGREDIENT_STOCK_CONFLICT means someone else moved the stock between
    // this dialog opening and submitting; nothing was written, and the owner
    // needs to re-read the figure rather than retry blindly.
    adjustError.value = resolveUserFacingError(error, t, {
      codeKeys: {
        INGREDIENT_STOCK_CONFLICT: "ingredients.stockConflict",
      },
      fallbackKey: "ingredients.adjustFailed",
    }).message;
  } finally {
    adjusting.value = false;
  }
}

const showRecipes = ref(false);
const recipesLoading = ref(false);
const menuItems = ref<{ id: number; name: string }[]>([]);
const missingRecipeIds = ref<Set<number>>(new Set());
const editingRecipeFor = ref<{ id: number; name: string } | undefined>();
const recipeEntries = ref<RecipeEntryResponse[]>([]);
const recipeIngredients = ref<IngredientDefinitionResponse[]>([]);
const recipeError = ref("");
const recipeSaveError = ref("");
const savingRecipe = ref(false);

async function openRecipes() {
  if (!restaurantId.value) return;
  showRecipes.value = true;
  recipesLoading.value = true;
  recipeError.value = "";
  try {
    const [items, missing, allIngredients] = await Promise.all([
      ingredientApi.listMenuItems(restaurantId.value),
      ingredientApi.getMissingRecipes(restaurantId.value),
      ingredientApi.listAll(restaurantId.value),
    ]);
    menuItems.value = items;
    missingRecipeIds.value = new Set(missing.map((m) => m.id));
    recipeIngredients.value = allIngredients;
  } catch (error) {
    console.error("Failed to load menu items for recipes:", error);
    menuItems.value = [];
    recipeIngredients.value = [];
    recipeError.value = resolveUserFacingError(error, t, {
      fallbackKey: "common.loadFailed",
    }).message;
  } finally {
    recipesLoading.value = false;
  }
}

async function editRecipe(item: { id: number; name: string }) {
  if (!restaurantId.value) return;
  editingRecipeFor.value = undefined;
  recipeError.value = "";
  recipeSaveError.value = "";
  try {
    recipeEntries.value = await ingredientApi.getRecipe(
      restaurantId.value,
      item.id,
    );
    editingRecipeFor.value = item;
  } catch (error) {
    console.error("Failed to load recipe:", error);
    recipeError.value = resolveUserFacingError(error, t, {
      fallbackKey: "common.loadFailed",
    }).message;
  }
}

async function handleSaveRecipe(
  entries: {
    ingredientId: number;
    quantityPerServing: number;
    unit: string;
    isOptional: boolean;
  }[],
) {
  if (!restaurantId.value || !editingRecipeFor.value) return;
  const menuItemId = editingRecipeFor.value.id;
  savingRecipe.value = true;
  recipeSaveError.value = "";
  try {
    await ingredientApi.setRecipe(restaurantId.value, menuItemId, {
      ingredients: entries,
    });
    editingRecipeFor.value = undefined;
    // An empty save removes the recipe, so the badge has to be able to come
    // back as well as go away.
    const next = new Set(missingRecipeIds.value);
    if (entries.length > 0) next.delete(menuItemId);
    else next.add(menuItemId);
    missingRecipeIds.value = next;
  } catch (error) {
    console.error("Failed to save recipe:", error);
    // The editor stays open on failure, so the message has to render inside it
    // — the panel's own error sits behind the modal. Both rejections a user can
    // reach here are fixable in place: a quantity still at 0, or a unit edited
    // away from the stock unit.
    recipeSaveError.value = resolveUserFacingError(error, t, {
      fallbackKey: "ingredients.recipeSaveFailed",
    }).message;
  } finally {
    savingRecipe.value = false;
  }
}
const editingIngredient = ref<IngredientDefinitionResponse | undefined>();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedLoad() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    page.value = 1;
    loadIngredients();
  }, 300);
}

async function loadIngredients() {
  if (!restaurantId.value) return;
  loading.value = true;
  try {
    const result = await ingredientApi.list(restaurantId.value, {
      page: page.value,
      limit,
      search: searchQuery.value || undefined,
      category: categoryFilter.value || undefined,
      lowStock: lowStockOnly.value || undefined,
    });
    ingredients.value = result.items;
    total.value = result.total;
  } catch (error) {
    console.error("Failed to load ingredients:", error);
  } finally {
    loading.value = false;
  }
}

async function loadCategories() {
  if (!restaurantId.value) return;
  try {
    categories.value = await ingredientApi.getCategories(restaurantId.value);
  } catch (error) {
    console.error("Failed to load categories:", error);
  }
}

function editIngredient(item: IngredientDefinitionResponse) {
  editingIngredient.value = item;
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  editingIngredient.value = undefined;
}

async function handleSave(data: IngredientFormPayload) {
  if (!restaurantId.value) return;
  try {
    if (editingIngredient.value) {
      // Editing: null is meaningful here, it clears the column.
      await ingredientApi.update(
        restaurantId.value,
        editingIngredient.value.id,
        data,
      );
    } else {
      // Creating: the form emits undefined rather than null for blank optional
      // fields precisely because createIngredientSchema rejects null, so the
      // payload satisfies CreateIngredientRequest on this branch.
      await ingredientApi.create(
        restaurantId.value,
        data as CreateIngredientRequest,
      );
    }
    closeForm();
    await loadIngredients();
    await loadCategories();
  } catch (error) {
    console.error("Failed to save ingredient:", error);
  }
}

async function confirmDelete(item: IngredientDefinitionResponse) {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("common.delete"),
    message: t("ingredients.confirmDelete", { name: item.name }),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;
  try {
    await ingredientApi.remove(restaurantId.value, item.id);
    await loadIngredients();
  } catch (error) {
    console.error("Failed to delete ingredient:", error);
  }
}

async function handleBulkImport(items: CreateIngredientRequest[]) {
  if (!restaurantId.value) return;
  bulkImporting.value = true;
  importError.value = "";
  try {
    await ingredientApi.bulkImport(restaurantId.value, items);
    showBulkImport.value = false;
    await loadIngredients();
    await loadCategories();
  } catch (error) {
    console.error("Failed to bulk import:", error);
    importError.value = resolveUserFacingError(error, t, {
      fallbackKey: "ingredients.bulkImportFailed",
    }).message;
  } finally {
    // Always clears, so a rejected import leaves the dialog usable instead of
    // stuck on "submitting...".
    bulkImporting.value = false;
  }
}

onMounted(() => {
  loadIngredients();
  loadCategories();
});
</script>
