<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
    @click.self="$emit('update:show', false)"
  >
    <div class="bg-white rounded-2xl shadow-xl max-w-md w-full" @click.stop>
      <!-- 標題區域 -->
      <div class="px-6 py-4 border-b border-gray-200">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("manualInput.title") }}
          </h3>
          <button
            class="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            @click="$emit('update:show', false)"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      <!-- 表單內容 -->
      <div class="px-6 py-4 space-y-4">
        <!-- 餐廳名稱搜尋 -->
        <div class="relative">
          <label
            for="restaurant-name"
            class="block text-sm font-medium text-gray-700 mb-2"
          >
            {{ t("manualInput.restaurantName") }}
          </label>
          <input
            id="restaurant-name"
            v-model="searchQuery"
            data-testid="restaurant-search-input"
            type="text"
            :placeholder="t('manualInput.restaurantNamePlaceholder')"
            class="w-full px-3 py-2 bg-ios-bg rounded-xl focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
            :class="{ 'ring-2 ring-ios-red': error }"
            autocomplete="off"
            @input="handleSearchInput"
          />
          <p v-if="error" class="mt-1 text-sm text-red-600">
            {{ error }}
          </p>

          <!-- 搜尋結果下拉 -->
          <div
            v-if="showDropdown && searchResults.length > 0"
            class="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"
          >
            <button
              v-for="restaurant in searchResults"
              :key="restaurant.restaurantId"
              data-testid="restaurant-search-result"
              class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
              @click="selectRestaurant(restaurant)"
            >
              <div
                v-if="restaurant.imageUrl"
                class="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0"
              >
                <img
                  :src="restaurant.imageUrl"
                  :alt="restaurant.name"
                  class="w-full h-full object-cover"
                />
              </div>
              <div
                v-else
                class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0"
              >
                <span class="text-sm">🍽️</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-900 truncate">
                  {{ restaurant.name }}
                </div>
                <div
                  v-if="publicDistrict(restaurant.district)"
                  class="text-xs text-gray-500 truncate"
                >
                  {{ publicDistrict(restaurant.district) }}
                </div>
              </div>
            </button>
          </div>

          <!-- 無結果提示 -->
          <div
            v-if="
              showDropdown &&
              searchQuery.length >= 2 &&
              searchResults.length === 0 &&
              !isSearching
            "
            class="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3"
          >
            <p class="text-sm text-gray-500 text-center">
              {{ t("manualInput.noResults") }}
            </p>
          </div>

          <!-- 搜尋中提示 -->
          <div
            v-if="isSearching"
            class="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 flex items-center justify-center"
          >
            <div
              class="animate-spin rounded-full h-4 w-4 border-b-2 border-ios-blue mr-2"
            />
            <span class="text-sm text-gray-500">{{
              t("manualInput.searching")
            }}</span>
          </div>
        </div>

        <!-- 已選餐廳顯示 -->
        <div
          v-if="selectedRestaurant"
          class="flex items-center gap-3 p-3 bg-ios-blue/10 rounded-xl"
        >
          <div
            v-if="selectedRestaurant.imageUrl"
            class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0"
          >
            <img
              :src="selectedRestaurant.imageUrl"
              :alt="selectedRestaurant.name"
              class="w-full h-full object-cover"
            />
          </div>
          <div
            v-else
            class="w-10 h-10 rounded-xl bg-ios-blue/10 flex items-center justify-center flex-shrink-0"
          >
            <span class="text-lg">🍽️</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-gray-900 truncate">
              {{ selectedRestaurant.name }}
            </div>
            <div
              v-if="selectedRestaurant.district || selectedRestaurant.type"
              class="text-xs text-gray-500 truncate"
            >
              {{
                [selectedRestaurant.type, selectedRestaurant.district]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </div>
          </div>
          <button
            class="text-gray-400 hover:text-gray-600 transition-colors"
            @click="clearSelection"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- 提示文字 -->
        <div class="bg-blue-50 p-3 rounded-lg">
          <div class="flex items-start">
            <svg
              class="w-5 h-5 text-blue-400 mt-0.5 mr-2 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div class="text-sm text-blue-800">
              <p class="font-medium mb-1">{{ t("manualInput.helpTitle") }}</p>
              <p>{{ t("manualInput.helpDesc") }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 按鈕區域 -->
      <div class="px-6 py-4 bg-gray-50 rounded-b-2xl space-y-3">
        <button
          data-testid="confirm-manual-input-btn"
          :disabled="!selectedRestaurant || loading"
          class="w-full bg-ios-blue hover:bg-ios-blue/90 disabled:bg-ios-tertiary text-white font-semibold py-3.5 px-4 rounded-full transition-colors flex items-center justify-center"
          @click="handleConfirm"
        >
          <div
            v-if="loading"
            class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"
          />
          {{ loading ? t("manualInput.verifying") : t("common.confirm") }}
        </button>

        <button
          :disabled="loading"
          class="w-full bg-ios-bg hover:bg-ios-separator disabled:opacity-50 text-ios-text font-semibold py-3.5 px-4 rounded-full transition-colors"
          @click="$emit('update:show', false)"
        >
          {{ t("common.cancel") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import { menuApi } from "@/services/menuApi";

const { t } = useI18n();

interface RestaurantResult {
  restaurantId: string;
  name: string;
  type: string | null;
  district: string | null;
  imageUrl: string | null;
}

// Props
const props = defineProps<{
  show: boolean;
  loading?: boolean;
}>();

// Emits
const emits = defineEmits<{
  "update:show": [value: boolean];
  "restaurant-selected": [data: { restaurantId: string }];
}>();

function publicDistrict(district: string | null): string | null {
  const value = district?.trim();
  return value && !value.toLowerCase().startsWith("onboarding-") ? value : null;
}

// State
const searchQuery = ref("");
const searchResults = ref<RestaurantResult[]>([]);
const selectedRestaurant = ref<RestaurantResult | null>(null);
const isSearching = ref(false);
const showDropdown = ref(false);
const error = ref("");

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

// Debounced search
const handleSearchInput = () => {
  selectedRestaurant.value = null;
  error.value = "";

  if (searchTimeout) clearTimeout(searchTimeout);

  if (searchQuery.value.length < 2) {
    searchResults.value = [];
    showDropdown.value = false;
    return;
  }

  showDropdown.value = true;
  searchTimeout = setTimeout(() => {
    performSearch();
  }, 300);
};

const performSearch = async () => {
  if (searchQuery.value.length < 2) return;

  isSearching.value = true;
  try {
    searchResults.value = await menuApi.searchRestaurants(searchQuery.value);
  } catch {
    searchResults.value = [];
  } finally {
    isSearching.value = false;
  }
};

const selectRestaurant = (restaurant: RestaurantResult) => {
  selectedRestaurant.value = restaurant;
  searchQuery.value = restaurant.name;
  showDropdown.value = false;
  error.value = "";
};

const clearSelection = () => {
  selectedRestaurant.value = null;
  searchQuery.value = "";
  searchResults.value = [];
  error.value = "";
};

// Methods
const handleConfirm = () => {
  if (!selectedRestaurant.value) {
    error.value = t("manualInput.restaurantRequired");
    return;
  }

  emits("restaurant-selected", {
    restaurantId: selectedRestaurant.value.restaurantId,
  });
  emits("update:show", false);
};

// 重置表單
const resetForm = () => {
  searchQuery.value = "";
  searchResults.value = [];
  selectedRestaurant.value = null;
  isSearching.value = false;
  showDropdown.value = false;
  error.value = "";
};

// 監聽 show 屬性變化，重置表單
watch(
  () => props.show,
  (newShow) => {
    if (!newShow) {
      resetForm();
    }
  },
);
</script>
