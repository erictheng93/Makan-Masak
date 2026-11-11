<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useAIAnalytics } from "@/composables/useAIAnalytics";
import type { LLMProvider } from "@makanmasak/ai-analytics";

// Icons (using heroicons)
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  SparklesIcon,
} from "@heroicons/vue/24/outline";
import ShieldCheckIcon from "@heroicons/vue/24/outline/ShieldCheckIcon";

const { t } = useI18n();
const authStore = useAuthStore();
const { getConfig, saveConfig, testProvider, getAvailableModels } =
  useAIAnalytics();

// Form state
const form = ref({
  provider: "anthropic" as LLMProvider,
  apiKey: "",
  model: "",
  customBaseUrl: "",
});

const availableModels = ref<string[]>([]);
const testResult = ref<{
  success: boolean;
  latency?: number;
  error?: string;
} | null>(null);
const isTesting = ref(false);
const isSaving = ref(false);
const saveSuccess = ref(false);
const saveError = ref<string | null>(null);

const restaurantId = computed(() => authStore.restaurantId || "");

// Provider options with descriptions
const providers = computed(() => [
  {
    value: "anthropic",
    label: "Anthropic Claude",
    description: t("aiConfig.providerAnthropicDesc"),
    icon: "🤖",
  },
  {
    value: "openai",
    label: "OpenAI GPT",
    description: t("aiConfig.providerOpenaiDesc"),
    icon: "✨",
  },
  {
    value: "google",
    label: "Google Gemini",
    description: t("aiConfig.providerGoogleDesc"),
    icon: "🔮",
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    description: t("aiConfig.providerDeepseekDesc"),
    icon: "🚀",
  },
  {
    value: "custom",
    label: t("aiConfig.providerCustom"),
    description: t("aiConfig.providerCustomDesc"),
    icon: "⚙️",
  },
]);

const selectedProvider = computed(() =>
  providers.value.find(
    (p: { value: string }) => p.value === form.value.provider,
  ),
);

// Load configuration on mount
onMounted(async () => {
  const config = await getConfig(restaurantId.value);
  if (config?.config) {
    form.value.provider = config.config.provider;
    form.value.model = config.config.model || "";
    form.value.customBaseUrl = config.config.custom_base_url || "";
    // Don't load API key for security
  }
  await loadAvailableModels();
});

// Load available models when provider changes
const onProviderChange = async () => {
  form.value.model = "";
  await loadAvailableModels();
};

const loadAvailableModels = async () => {
  const models = await getAvailableModels(form.value.provider);
  availableModels.value = models;
  if (models.length > 0 && !form.value.model) {
    form.value.model = models[0];
  }
};

// Test connection
const handleTestConnection = async () => {
  if (!form.value.apiKey) {
    testResult.value = {
      success: false,
      error: t("aiConfig.pleaseEnterApiKey"),
    };
    return;
  }

  isTesting.value = true;
  testResult.value = null;

  const result = await testProvider({
    provider: form.value.provider,
    apiKey: form.value.apiKey,
    model: form.value.model || undefined,
    baseUrl: form.value.customBaseUrl || undefined,
  });

  testResult.value = result;
  isTesting.value = false;
};

// Save configuration
const handleSaveConfig = async () => {
  if (!form.value.apiKey) {
    saveError.value = t("aiConfig.pleaseEnterApiKey");
    return;
  }

  isSaving.value = true;
  saveSuccess.value = false;
  saveError.value = null;

  try {
    const result = await saveConfig({
      restaurantId: restaurantId.value,
      provider: form.value.provider,
      apiKey: form.value.apiKey,
      model: form.value.model || undefined,
      customBaseUrl: form.value.customBaseUrl || undefined,
    });

    if (result.success) {
      saveSuccess.value = true;
      setTimeout(() => {
        saveSuccess.value = false;
      }, 3000);
    } else {
      saveError.value = result.message || t("aiConfig.saveFailed");
    }
  } catch (err) {
    console.error("Save config error:", err);
    saveError.value =
      err instanceof Error ? err.message : t("aiConfig.saveError");
  } finally {
    isSaving.value = false;
  }
};
</script>

<template>
  <div class="ui-page min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-3xl mx-auto">
      <!-- Header -->
      <div class="mb-8">
        <div class="flex items-center space-x-3 mb-2">
          <SparklesIcon class="w-8 h-8 text-teal-700" />
          <h1 class="ui-page-heading text-3xl font-bold text-gray-900">
            {{ t("aiConfig.title") }}
          </h1>
        </div>
        <p class="text-gray-600 mb-4">{{ t("aiConfig.subtitle") }}</p>

        <!-- Quick Navigation -->
        <div
          class="flex items-center space-x-2 bg-white rounded-xl p-2 border border-gray-100 w-fit"
        >
          <router-link
            to="/dashboard/ai-analytics/insights"
            class="px-4 py-2 rounded-lg text-sm font-medium transition-all text-gray-600 hover:bg-gray-100"
          >
            {{ t("aiAnalytics.navInsights") }}
          </router-link>
          <router-link
            to="/dashboard/ai-analytics/products"
            class="px-4 py-2 rounded-lg text-sm font-medium transition-all text-gray-600 hover:bg-gray-100"
          >
            {{ t("aiAnalytics.navProducts") }}
          </router-link>
          <router-link
            to="/dashboard/ai-analytics/config"
            class="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-teal-600 text-white"
          >
            {{ t("aiAnalytics.navConfig") }}
          </router-link>
        </div>
      </div>

      <!-- Main Config Card -->
      <div
        class="ui-panel bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
      >
        <!-- Provider Selection -->
        <div class="p-8 border-b border-gray-100">
          <label class="block text-sm font-semibold text-gray-900 mb-4">
            {{ t("aiConfig.selectProvider") }}
          </label>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              v-for="provider in providers"
              :key="provider.value"
              type="button"
              class="relative flex items-start p-4 border-2 rounded-xl transition-all duration-200 hover:border-teal-300 hover:shadow-sm"
              :class="
                form.provider === provider.value
                  ? 'border-teal-600 bg-teal-50'
                  : 'border-gray-200 bg-white'
              "
              @click="
                form.provider = provider.value as LLMProvider;
                onProviderChange();
              "
            >
              <div class="flex-shrink-0 text-2xl mr-3">{{ provider.icon }}</div>
              <div class="flex-1 text-left">
                <div class="font-semibold text-gray-900">
                  {{ provider.label }}
                </div>
                <div class="text-xs text-gray-500 mt-1">
                  {{ provider.description }}
                </div>
              </div>
              <CheckCircleIcon
                v-if="form.provider === provider.value"
                class="w-5 h-5 text-teal-700 absolute top-4 right-4"
              />
            </button>
          </div>
        </div>

        <!-- Configuration Form -->
        <div class="p-8 space-y-6">
          <!-- Selected Provider Info -->
          <div class="bg-teal-50 rounded-xl p-4 flex items-center space-x-3">
            <div class="text-2xl">{{ selectedProvider?.icon }}</div>
            <div>
              <div class="font-semibold text-gray-900">
                {{ selectedProvider?.label }}
              </div>
              <div class="text-sm text-gray-600">
                {{ selectedProvider?.description }}
              </div>
            </div>
          </div>

          <!-- API Key Input -->
          <div>
            <label
              for="ai-provider-key"
              class="block text-sm font-semibold text-gray-900 mb-2"
            >
              API Key
            </label>
            <div class="relative">
              <ShieldCheckIcon
                class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
              />
              <input
                id="ai-provider-key"
                v-model="form.apiKey"
                :aria-describedby="
                  testResult ? 'ai-connection-result' : undefined
                "
                type="password"
                :placeholder="t('aiConfig.enterApiKey')"
                class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
              />
            </div>
            <p class="text-xs text-gray-500 mt-2">
              {{ t("aiConfig.apiKeyEncrypted") }}
            </p>
          </div>

          <!-- Model Selection (combobox: select from list or type custom) -->
          <div>
            <label
              for="aiproviderconfig-field-1"
              class="block text-sm font-semibold text-gray-900 mb-2"
            >
              {{ t("aiConfig.modelSelection") }}
            </label>
            <input
              id="aiproviderconfig-field-1"
              v-model="form.model"
              :aria-describedby="
                testResult ? 'ai-connection-result' : undefined
              "
              type="text"
              :list="`models-${form.provider}`"
              :placeholder="t('aiConfig.modelPlaceholder')"
              class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            />
            <datalist :id="`models-${form.provider}`">
              <option
                v-for="model in availableModels"
                :key="model"
                :value="model"
              />
            </datalist>
            <p class="text-xs text-gray-500 mt-2">
              {{ t("aiConfig.modelHint") }}
            </p>
          </div>

          <!-- Custom Base URL (for custom provider) -->
          <div v-if="form.provider === 'custom'">
            <label
              for="aiproviderconfig-field-2"
              class="block text-sm font-semibold text-gray-900 mb-2"
            >
              Base URL
            </label>
            <input
              id="aiproviderconfig-field-2"
              v-model="form.customBaseUrl"
              :aria-describedby="
                testResult ? 'ai-connection-result' : undefined
              "
              type="url"
              placeholder="https://your-api-endpoint.com"
              class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            />
          </div>

          <!-- Test Result -->
          <div
            v-if="testResult"
            id="ai-connection-result"
            role="status"
            class="rounded-xl p-4 flex items-center space-x-3 transition-all"
            :class="
              testResult.success
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            "
          >
            <CheckCircleIcon
              v-if="testResult.success"
              class="w-6 h-6 text-green-700"
            />
            <XCircleIcon v-else class="w-6 h-6 text-red-700" />
            <div class="flex-1">
              <div
                class="font-semibold"
                :class="testResult.success ? 'text-green-900' : 'text-red-900'"
              >
                {{
                  testResult.success
                    ? t("aiConfig.connectionSuccess")
                    : t("aiConfig.connectionFailed")
                }}
              </div>
              <div
                class="text-sm"
                :class="testResult.success ? 'text-green-700' : 'text-red-700'"
              >
                {{
                  testResult.success
                    ? t("aiConfig.responseLatency", {
                        ms: testResult.latency ?? 0,
                      })
                    : testResult.error || t("aiConfig.checkApiKeyAndNetwork")
                }}
              </div>
            </div>
          </div>

          <!-- Save Success Message -->
          <div
            v-if="saveSuccess"
            class="rounded-xl p-4 bg-green-50 border border-green-200 flex items-center space-x-3 animate-fade-in"
          >
            <CheckCircleIcon class="w-6 h-6 text-green-700" />
            <div class="text-green-900 font-semibold">
              {{ t("aiConfig.saveSuccess") }}
            </div>
          </div>

          <!-- Save Error Message -->
          <div
            v-if="saveError"
            class="rounded-xl p-4 bg-red-50 border border-red-200 flex items-center space-x-3 animate-fade-in"
          >
            <XCircleIcon class="w-6 h-6 text-red-700" />
            <div class="flex-1">
              <div class="text-red-900 font-semibold mb-1">
                {{ t("aiConfig.saveFailed") }}
              </div>
              <div class="text-red-700 text-sm">{{ saveError }}</div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex space-x-3 pt-4">
            <button
              :disabled="isTesting || !form.apiKey"
              class="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              @click="handleTestConnection"
            >
              <ArrowPathIcon
                class="w-5 h-5 inline mr-2"
                :class="{ 'animate-spin': isTesting }"
              />
              {{
                isTesting ? t("aiConfig.testing") : t("aiConfig.testConnection")
              }}
            </button>

            <button
              :disabled="isSaving || !form.apiKey"
              class="flex-1 px-6 py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-teal-500/30"
              @click="handleSaveConfig"
            >
              {{ isSaving ? t("aiConfig.saving") : t("aiConfig.saveConfig") }}
            </button>
          </div>
        </div>
      </div>

      <!-- Info Cards -->
      <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-white rounded-xl p-4 border border-gray-100">
          <div class="text-sm font-semibold text-gray-900 mb-1">
            {{ t("aiConfig.infoEncryption") }}
          </div>
          <div class="text-xs text-gray-600">
            {{ t("aiConfig.infoEncryptionDesc") }}
          </div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gray-100">
          <div class="text-sm font-semibold text-gray-900 mb-1">
            📊 {{ t("aiConfig.infoTracking") }}
          </div>
          <div class="text-xs text-gray-600">
            {{ t("aiConfig.infoTrackingDesc") }}
          </div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gray-100">
          <div class="text-sm font-semibold text-gray-900 mb-1">
            ⚡ {{ t("aiConfig.infoCaching") }}
          </div>
          <div class="text-xs text-gray-600">
            {{ t("aiConfig.infoCachingDesc") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in {
  animation: fade-in 0.3s ease-out;
}
</style>
