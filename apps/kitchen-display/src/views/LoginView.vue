<template>
  <div class="bg-ios-bg min-h-screen flex items-center justify-center p-4">
    <div class="max-w-sm w-full">
      <!-- App Icon & Title -->
      <div class="flex flex-col items-center mb-8">
        <div
          class="w-20 h-20 rounded-[22px] bg-gradient-to-br from-ios-blue to-ios-green shadow-[0_8px_30px_rgba(0,122,255,0.08)] flex items-center justify-center mb-4"
        >
          <ChefHat class="w-10 h-10 text-white" />
        </div>
        <h1 class="text-2xl font-extrabold text-ios-text mb-1">
          {{ t("login.title") }}
        </h1>
        <p class="text-sm text-ios-secondary">{{ t("login.subtitle") }}</p>
        <div v-if="shopName" class="mt-3 text-center" data-testid="login-shop">
          <p class="text-base font-semibold text-ios-text">{{ shopName }}</p>
          <button
            v-if="!routeSlug"
            type="button"
            data-testid="login-shop-clear"
            class="text-sm text-ios-blue min-h-[44px]"
            @click="clearShop"
          >
            {{ t("login.notYourShop") }}
          </button>
        </div>
      </div>

      <!-- Login Form Card -->
      <div class="bg-white rounded-2xl p-6 shadow-card">
        <form class="space-y-4" @submit.prevent="handleLogin">
          <!-- Username Field -->
          <div>
            <label
              for="username"
              class="text-sm font-semibold text-ios-text mb-1.5 block"
            >
              {{ t("login.username") }}
            </label>
            <div class="relative">
              <div
                class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"
              >
                <User class="w-4.5 h-4.5 text-ios-tertiary" />
              </div>
              <input
                id="username"
                v-model="credentials.username"
                type="text"
                required
                autocomplete="username"
                :placeholder="t('login.usernamePlaceholder')"
                :disabled="isLoading"
                class="w-full bg-ios-bg rounded-xl py-3.5 pl-10 pr-4 text-base text-ios-text placeholder-ios-tertiary outline-none focus:ring-2 focus:ring-ios-blue/30 transition-all"
              />
            </div>
          </div>

          <!-- Password Field -->
          <div>
            <label
              for="password"
              class="text-sm font-semibold text-ios-text mb-1.5 block"
            >
              {{ t("login.password") }}
            </label>
            <div class="relative">
              <div
                class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"
              >
                <Lock class="w-4.5 h-4.5 text-ios-tertiary" />
              </div>
              <input
                id="password"
                v-model="credentials.password"
                :type="showPassword ? 'text' : 'password'"
                required
                autocomplete="current-password"
                :placeholder="t('login.passwordPlaceholder')"
                :disabled="isLoading"
                class="w-full bg-ios-bg rounded-xl py-3.5 pl-10 pr-10 text-base text-ios-text placeholder-ios-tertiary outline-none focus:ring-2 focus:ring-ios-blue/30 transition-all"
              />
              <button
                type="button"
                :disabled="isLoading"
                class="absolute inset-y-0 right-0 pr-3.5 flex items-center"
                @click="showPassword = !showPassword"
              >
                <Eye
                  v-if="showPassword"
                  class="w-4.5 h-4.5 text-ios-tertiary hover:text-ios-secondary transition-colors"
                />
                <EyeOff
                  v-else
                  class="w-4.5 h-4.5 text-ios-tertiary hover:text-ios-secondary transition-colors"
                />
              </button>
            </div>
          </div>

          <!-- Error Message -->
          <div
            v-if="errorMessage"
            class="flex items-center gap-2 bg-ios-red/10 rounded-xl px-4 py-3"
          >
            <AlertTriangle class="w-4 h-4 text-ios-red flex-shrink-0" />
            <span class="text-ios-red text-sm">{{ errorMessage }}</span>
          </div>

          <!-- Login Button -->
          <button
            type="submit"
            :disabled="isLoading || !canSubmit"
            class="w-full bg-ios-blue text-white rounded-full py-4 font-bold text-base min-h-[44px] flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 active:scale-[0.98] transition-transform mt-2"
          >
            <div
              v-if="isLoading"
              class="w-4.5 h-4.5 border-2 border-white border-t-transparent rounded-full animate-spin"
            />
            <span>{{
              isLoading ? t("login.loggingIn") : t("login.loginButton")
            }}</span>
          </button>
        </form>

        <!-- Footer -->
        <p class="text-xs text-ios-secondary mt-5 text-center">
          {{ t("login.roleNote") }}
        </p>
      </div>

      <!-- System Info -->
      <div class="mt-6 text-center text-xs text-ios-secondary space-y-1">
        <p>{{ t("login.systemInfo") }}</p>
        <p>{{ t("login.helpNote") }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "vue-toastification";
import {
  ChefHat,
  User,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
} from "lucide-vue-next";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useI18n } from "@/i18n";
import { resolveKitchenLoginError } from "@/utils/login-error";
import { authApi } from "@/services/authApi";
import { clearRememberedShop, getRememberedShop } from "@/utils/login-shop";

// Composables
const router = useRouter();
const route = useRoute();
const toast = useToast();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const { t } = useI18n();

// State
const credentials = ref({
  username: "",
  password: "",
});

const showPassword = ref(false);
const errorMessage = ref("");
const isLoading = ref(false);

// /s/:slug is the shop's own link; on /login a remembered slug stands in.
const routeSlug = computed(() =>
  typeof route.params.slug === "string" ? route.params.slug : null,
);
const shopSlug = ref<string | null>(routeSlug.value ?? getRememberedShop());
const shopName = ref("");
const shopInvalid = ref(false);

const clearShop = () => {
  clearRememberedShop();
  shopSlug.value = null;
  shopName.value = "";
};

const loadShop = async () => {
  if (!shopSlug.value) return;
  try {
    shopName.value = (await authApi.getLoginContext(shopSlug.value)).name;
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    if (status !== 404) return; // offline etc.: still allow a sign-in attempt
    if (routeSlug.value) {
      shopInvalid.value = true;
      errorMessage.value = t("login.shopNotFound");
    } else {
      clearShop(); // remembered shop no longer exists
    }
  }
};

// Computed
const canSubmit = computed(() => {
  return (
    credentials.value.username.trim() !== "" &&
    credentials.value.password.trim() !== "" &&
    !isLoading.value &&
    !shopInvalid.value
  );
});

// Methods
const handleLogin = async () => {
  if (!canSubmit.value) return;

  errorMessage.value = "";
  isLoading.value = true;

  try {
    await authStore.login({
      username: credentials.value.username.trim(),
      password: credentials.value.password,
      ...(shopSlug.value ? { shop: shopSlug.value } : {}),
    });

    toast.success(t("login.loginSuccess"));

    // 導向廚房界面
    const restaurantId = authStore.restaurantId;
    if (restaurantId) {
      await router.push(`/kitchen/${restaurantId}`);
    } else {
      // Reported directly rather than thrown: the catch below classifies API
      // failures, and this one is a missing field on a successful login.
      errorMessage.value = t("login.fetchRestaurantError");
    }
  } catch (error: unknown) {
    console.error("Login failed:", error);
    errorMessage.value = resolveKitchenLoginError(error, t);

    // 清除密碼欄位
    credentials.value.password = "";
  } finally {
    isLoading.value = false;
  }
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && canSubmit.value) {
    handleLogin();
  }
};

// 生命週期
let focusTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  // 初始化設定
  settingsStore.initialize();
  void loadShop();

  // 檢查是否已登入
  if (authStore.isAuthenticated) {
    const restaurantId = authStore.restaurantId;
    if (restaurantId) {
      await router.push(`/kitchen/${restaurantId}`);
      return;
    }
  }

  // 設置鍵盤監聽
  document.addEventListener("keydown", handleKeyDown);

  // 聚焦到用戶名稱欄位
  focusTimer = setTimeout(() => {
    const usernameInput = document.getElementById("username");
    if (usernameInput) {
      usernameInput.focus();
    }
  }, 100);
});

// 清理 — the focus timer must not outlive the view (it touched `document`
// after a test unmounted the page, failing CI with an uncaught error).
onUnmounted(() => {
  clearTimeout(focusTimer);
  document.removeEventListener("keydown", handleKeyDown);
});
</script>
