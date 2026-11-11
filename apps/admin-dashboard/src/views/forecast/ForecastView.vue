<template>
  <div class="ui-page forecast-view">
    <div class="ui-toolbar flex justify-between items-center mb-8">
      <div>
        <h1 class="ui-page-heading text-2xl font-bold text-gray-900">
          {{ t("forecast.title") }}
        </h1>
        <p class="text-gray-600">{{ t("forecast.subtitle") }}</p>
      </div>
      <div class="ui-toolbar flex flex-wrap items-center gap-3">
        <button
          class="flex items-center px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          :disabled="loading"
          @click="loadForecast"
        >
          <ArrowPathIcon class="h-4 w-4 mr-2" />
          {{ t("common.refresh") }}
        </button>
        <button
          class="flex items-center px-4 py-2 bg-primary-700 text-white rounded-lg hover:bg-primary-800 transition-colors"
          :disabled="generating"
          @click="generateForecast"
        >
          <span v-if="generating" class="animate-spin mr-2">⏳</span>
          {{ t("forecast.generate") }}
        </button>
      </div>
    </div>

    <!-- Stale data warning -->
    <div
      v-if="isStale"
      class="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800"
    >
      ⚠️ {{ t("forecast.staleWarning") }}
    </div>

    <p
      v-if="feedback"
      class="mb-4 rounded-lg border px-3 py-2 text-sm"
      :class="
        feedback.kind === 'error'
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-blue-200 bg-blue-50 text-blue-800'
      "
      role="status"
    >
      {{ feedback.message }}
    </p>

    <!-- Date Picker -->
    <div class="mb-6">
      <ForecastDatePicker
        :start-date="startDate"
        :end-date="endDate"
        @update:start-date="startDate = $event"
        @update:end-date="endDate = $event"
      />
    </div>

    <!-- Tabs -->
    <div class="border-b border-gray-200 mb-6">
      <nav class="flex gap-6">
        <button
          class="pb-3 text-sm font-medium border-b-2 transition-colors"
          :class="
            activeTab === 'forecast'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          "
          @click="activeTab = 'forecast'"
        >
          {{ t("forecast.forecastTab") }}
        </button>
        <button
          class="pb-3 text-sm font-medium border-b-2 transition-colors"
          :class="
            activeTab === 'accuracy'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          "
          @click="
            activeTab = 'accuracy';
            loadAccuracy();
          "
        >
          {{ t("forecast.accuracyTab") }}
        </button>
        <!-- Hidden without the inventory module: this tab's forecast read and
             its procurement list both 403 without it. -->
        <button
          v-if="hasIngredientForecast"
          data-testid="forecast-ingredient-tab"
          class="pb-3 text-sm font-medium border-b-2 transition-colors"
          :class="
            activeTab === 'ingredients'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          "
          @click="
            activeTab = 'ingredients';
            loadIngredientForecast();
          "
        >
          {{ t("forecast.ingredientTab") }}
        </button>
      </nav>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-16">
      <div
        class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"
      ></div>
    </div>

    <!-- Forecast Tab -->
    <template v-else-if="activeTab === 'forecast'">
      <ForecastAlerts :alerts="alerts" class="mb-6" />
      <p
        v-if="forecastLoaded && forecastItems.length === 0"
        class="mb-4 text-sm text-gray-600"
      >
        {{ t("forecast.emptyForecastHistory") }}
      </p>
      <ForecastTable :items="forecastItems" />
    </template>

    <!-- Accuracy Tab -->
    <template v-else-if="activeTab === 'accuracy'">
      <ForecastAccuracyTab :items="accuracyItems" :loading="accuracyLoading" />
    </template>

    <!-- Ingredient Forecast Tab -->
    <template v-else-if="activeTab === 'ingredients'">
      <div v-if="ingredientLoading" class="flex justify-center py-16">
        <div
          class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"
        ></div>
      </div>
      <template v-else>
        <p
          v-if="ingredientError"
          class="mb-4 text-sm text-red-700"
          role="alert"
        >
          {{ ingredientError }}
        </p>
        <template v-if="!ingredientError">
          <IngredientForecastTable
            :items="ingredientForecastItems"
            class="mb-6"
          />
          <ProcurementList
            :items="ingredientForecastItems"
            :ingredient-details="ingredientDetailsMap"
          />
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "@/i18n";
import { ArrowPathIcon } from "@heroicons/vue/24/outline";
import { forecastApi } from "@/services/forecastApi";
import { ingredientApi } from "@/services/ingredientApi";
import { useAuthStore } from "@/stores/auth";
import { useModuleAccessStore } from "@makanmasak/shared/stores/moduleAccess";
import ForecastDatePicker from "@/components/forecast/ForecastDatePicker.vue";
import ForecastTable from "@/components/forecast/ForecastTable.vue";
import ForecastAlerts from "@/components/forecast/ForecastAlerts.vue";
import ForecastAccuracyTab from "@/components/forecast/ForecastAccuracyTab.vue";
import IngredientForecastTable from "@/components/forecast/IngredientForecastTable.vue";
import ProcurementList from "@/components/forecast/ProcurementList.vue";
import type {
  ForecastItemResult,
  ForecastAccuracyItem,
  ForecastAlert,
  IngredientForecastItem,
} from "@makanmasak/shared-types";

const { t } = useI18n();
const authStore = useAuthStore();

const loading = ref(false);
const generating = ref(false);
const accuracyLoading = ref(false);
const ingredientLoading = ref(false);
const isStale = ref(false);
const feedback = ref<{ kind: "success" | "error"; message: string } | null>(
  null,
);
const ingredientError = ref("");
const forecastLoaded = ref(false);
const activeTab = ref<"forecast" | "accuracy" | "ingredients">("forecast");

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const startDate = ref(formatLocalDate(tomorrow));
const endDate = ref(formatLocalDate(tomorrow));

const forecastItems = ref<ForecastItemResult[]>([]);
const alerts = ref<ForecastAlert[]>([]);
const accuracyItems = ref<ForecastAccuracyItem[]>([]);
const ingredientForecastItems = ref<IngredientForecastItem[]>([]);
const ingredientDetailsMap = ref(
  new Map<number, { supplier: string | null; costPerUnit: number | null }>(),
);

const restaurantId = computed(() => authStore.restaurantId || "");

// Ingredient forecasting and the procurement list live behind the `inventory`
// module, while the rest of this view only needs `analytics`. Without this
// check a pro-tier shop would hit 403s the moment it pressed Generate.
const moduleAccess = useModuleAccessStore();
const hasIngredientForecast = computed(
  () => moduleAccess.effectiveModules?.inventory === true,
);

async function loadForecast(): Promise<boolean> {
  if (!restaurantId.value) return false;
  loading.value = true;
  forecastLoaded.value = false;
  try {
    const forecasts = await forecastApi.getForecast(restaurantId.value, {
      startDate: startDate.value,
      endDate: endDate.value,
    });
    forecastItems.value = forecasts.flatMap((f) => f.items);
    isStale.value = forecasts.some((f) => f.stale);

    const alertsData = await forecastApi.getAlerts(restaurantId.value);
    alerts.value = alertsData;
    forecastLoaded.value = true;
    if (feedback.value?.kind === "error") feedback.value = null;
    return true;
  } catch (error) {
    console.error("Failed to load forecast:", error);
    feedback.value = { kind: "error", message: t("forecast.loadFailed") };
    return false;
  } finally {
    loading.value = false;
  }
}

async function generateForecast() {
  if (!restaurantId.value || generating.value) return;
  generating.value = true;
  feedback.value = null;
  try {
    if (hasIngredientForecast.value) {
      await forecastApi.generateIngredientForecast(restaurantId.value, {
        startDate: startDate.value,
        endDate: endDate.value,
      });
    } else {
      await forecastApi.generate(restaurantId.value, {
        startDate: startDate.value,
        endDate: endDate.value,
      });
    }
    const loaded = await loadForecast();
    if (hasIngredientForecast.value && activeTab.value === "ingredients") {
      await loadIngredientForecast();
    }
    if (loaded) {
      feedback.value = { kind: "success", message: t("forecast.generated") };
    }
  } catch (error) {
    console.error("Failed to generate forecast:", error);
    feedback.value = { kind: "error", message: t("forecast.generateFailed") };
  } finally {
    generating.value = false;
  }
}

async function loadAccuracy() {
  if (!restaurantId.value) return;
  accuracyLoading.value = true;
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    accuracyItems.value = await forecastApi.getAccuracy(restaurantId.value, {
      startDate: formatLocalDate(start),
      endDate: formatLocalDate(end),
    });
  } catch (error) {
    console.error("Failed to load accuracy:", error);
  } finally {
    accuracyLoading.value = false;
  }
}

async function loadIngredientForecast() {
  if (!restaurantId.value) return;
  // Guarded for the same reason as generateForecast: both the forecast read
  // and the procurement list's /ingredients call require the inventory module.
  if (!hasIngredientForecast.value) return;
  ingredientLoading.value = true;
  ingredientError.value = "";
  try {
    const forecasts = await forecastApi.getIngredientForecast(
      restaurantId.value,
      {
        startDate: startDate.value,
        endDate: endDate.value,
      },
    );
    ingredientForecastItems.value = forecasts.flatMap((f) => f.ingredients);

    // Load ingredient details for procurement list. The endpoint caps `limit`
    // at 100, so this has to page; ingredientApi.listAll owns that loop.
    const ingredients = await ingredientApi.listAll(restaurantId.value);
    const detailsMap = new Map<
      number,
      { supplier: string | null; costPerUnit: number | null }
    >();
    for (const ing of ingredients) {
      detailsMap.set(ing.id, {
        supplier: ing.supplier,
        costPerUnit: ing.costPerUnit,
      });
    }
    ingredientDetailsMap.value = detailsMap;
  } catch (error) {
    console.error("Failed to load ingredient forecast:", error);
    ingredientForecastItems.value = [];
    ingredientDetailsMap.value = new Map();
    ingredientError.value = t("forecast.ingredientLoadFailed");
  } finally {
    ingredientLoading.value = false;
  }
}

watch([startDate, endDate], () => {
  if (activeTab.value === "forecast") loadForecast();
  else if (activeTab.value === "ingredients") loadIngredientForecast();
});

onMounted(() => loadForecast());
</script>
