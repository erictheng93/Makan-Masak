<template>
  <div class="ui-page space-y-6">
    <!-- Header -->
    <div>
      <h1 class="ui-page-heading text-2xl font-bold text-gray-900">
        {{ t("platform.title") }}
      </h1>
      <p class="mt-1 text-sm text-gray-500">
        {{ t("platform.description") }}
      </p>
    </div>

    <!-- Stats Row -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="ui-panel bg-white rounded-2xl shadow-ios-card p-4">
        <div class="text-sm font-medium text-gray-500">
          {{ t("platform.totalRestaurants") }}
        </div>
        <div class="mt-1 text-2xl font-bold text-gray-900">
          {{ restaurants.length }}
        </div>
      </div>
      <div class="ui-panel bg-white rounded-2xl shadow-ios-card p-4">
        <div class="text-sm font-medium text-gray-500">
          {{ t("platform.active") }}
        </div>
        <div class="mt-1 text-2xl font-bold text-green-700">
          {{ activeCount }}
        </div>
      </div>
      <div class="ui-panel bg-white rounded-2xl shadow-ios-card p-4">
        <div class="text-sm font-medium text-gray-500">
          {{ t("platform.inactive") }}
        </div>
        <div class="mt-1 text-2xl font-bold text-gray-400">
          {{ restaurants.length - activeCount }}
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div
      v-if="isLoading"
      class="flex items-center justify-center py-12 text-gray-500"
    >
      <div
        class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"
      />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="restaurants.length === 0"
      class="ui-panel text-center py-12 bg-white rounded-2xl shadow-ios-card"
    >
      <Store class="mx-auto h-12 w-12 text-gray-400" />
      <h3 class="mt-2 text-sm font-medium text-gray-900">
        {{ t("platform.noRestaurants") }}
      </h3>
      <p class="mt-1 text-sm text-gray-500">
        {{ t("platform.noRestaurantsDesc") }}
      </p>
    </div>

    <!-- Restaurant Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="restaurant in restaurants"
        :key="restaurant.id"
        class="ui-panel bg-white rounded-2xl shadow-ios-card p-5 hover:shadow-ios-float transition-shadow"
      >
        <div class="ui-toolbar flex items-start justify-between">
          <div class="min-w-0 flex-1">
            <h3
              :title="restaurant.name"
              class="text-lg font-semibold text-gray-900 line-clamp-2 break-words"
            >
              {{ restaurant.name }}
            </h3>
            <p
              v-if="restaurant.address"
              class="mt-1 text-sm text-gray-500 break-words"
            >
              {{ restaurant.address }}
            </p>
          </div>
          <span
            class="ml-3 flex-shrink-0 text-xs px-2 py-1 rounded-full font-medium"
            :class="
              restaurant.isActive !== false
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            "
          >
            {{
              restaurant.isActive !== false
                ? t("platform.active")
                : t("platform.inactive")
            }}
          </span>
        </div>

        <button
          class="mt-4 w-full px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-full hover:bg-primary-700 transition-colors"
          @click="manageRestaurant(restaurant)"
        >
          {{ t("platform.manage") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { api, unwrapApiList } from "@/services/api";
import { Store } from "lucide-vue-next";

interface RestaurantItem {
  id: number | string;
  name: string;
  address?: string;
  isActive?: boolean;
}

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();

const restaurants = ref<RestaurantItem[]>([]);
const isLoading = ref(true);

const activeCount = computed(
  () => restaurants.value.filter((r) => r.isActive !== false).length,
);

const fetchRestaurants = async () => {
  isLoading.value = true;
  try {
    const response = await api.get<RestaurantItem[]>("/restaurants");
    if (response.data.success && response.data.data) {
      // Handle both direct array and nested {success, data: [...]} response formats
      const payload = response.data.data;
      restaurants.value = unwrapApiList<RestaurantItem>(payload);
    }
  } catch (error) {
    console.error("Failed to fetch restaurants:", error);
  } finally {
    isLoading.value = false;
  }
};

const manageRestaurant = (restaurant: RestaurantItem) => {
  authStore.selectRestaurant(String(restaurant.id), restaurant.name);
  router.push("/dashboard");
};

onMounted(() => {
  fetchRestaurants();
});
</script>
