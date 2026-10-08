<template>
  <div
    class="min-h-screen flex items-center justify-center bg-ios-bg py-12 px-4 sm:px-6 lg:px-8"
  >
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <div
          class="mx-auto w-16 h-16 bg-primary-600 rounded-xl flex items-center justify-center mb-4"
        >
          <span class="text-white font-bold text-2xl">M</span>
        </div>
        <h2 class="text-3xl font-bold text-gray-900">MakanMasak</h2>
        <p class="mt-2 text-sm text-gray-600">{{ t("auth.adminLogin") }}</p>
      </div>

      <form class="mt-8 space-y-6" @submit.prevent="handleSubmit">
        <div class="space-y-4">
          <div>
            <label for="username" class="form-label">{{
              t("auth.username")
            }}</label>
            <input
              id="username"
              v-model="form.username"
              type="text"
              required
              autocomplete="username"
              class="form-input"
              :class="{ 'border-red-500': errors.username }"
              :placeholder="t('auth.enterUsername')"
            />
            <p v-if="errors.username" class="mt-1 text-sm text-red-600">
              {{ errors.username }}
            </p>
          </div>

          <div>
            <label for="password" class="form-label">{{
              t("auth.password")
            }}</label>
            <div class="relative">
              <input
                id="password"
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                required
                autocomplete="current-password"
                class="form-input pr-10"
                :class="{ 'border-red-500': errors.password }"
                :placeholder="t('auth.enterPassword')"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 pr-3 flex items-center"
                @click="showPassword = !showPassword"
              >
                <Eye v-if="showPassword" class="w-4 h-4 text-gray-400" />
                <EyeOff v-else class="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <p v-if="errors.password" class="mt-1 text-sm text-red-600">
              {{ errors.password }}
            </p>
            <div class="flex items-center justify-end mt-2">
              <router-link
                to="/forgot-password"
                class="text-sm font-medium text-primary-600 hover:text-primary-500"
              >
                {{ t("auth.forgotPasswordLink") }}
              </router-link>
            </div>
          </div>
        </div>

        <div
          v-if="error"
          class="bg-red-50 border border-red-200 rounded-lg p-4"
        >
          <div class="flex items-center">
            <AlertCircle class="w-5 h-5 text-red-400 mr-2" />
            <p class="text-sm text-red-800">
              {{ error }}
            </p>
          </div>
        </div>

        <div>
          <button
            type="submit"
            :disabled="isLoading"
            class="w-full btn-primary"
            :class="{ 'opacity-50 cursor-not-allowed': isLoading }"
          >
            <span v-if="isLoading" class="flex items-center justify-center">
              <div
                class="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"
              />
              {{ t("auth.loggingIn") }}
            </span>
            <span v-else>{{ t("auth.login") }}</span>
          </button>
        </div>
      </form>

      <!-- Chef redirect prompt -->
      <div
        v-if="showChefRedirect"
        class="rounded-2xl bg-emerald-50 border border-emerald-200 p-6 text-center space-y-3"
      >
        <div class="text-3xl">👨‍🍳</div>
        <p class="font-semibold text-emerald-800">廚師帳號請使用廚房顯示系統</p>
        <p class="text-sm text-emerald-600">
          此管理後台不適用於廚師角色，請前往專用的廚房看板系統。
        </p>
        <a
          :href="KITCHEN_DISPLAY_URL"
          class="inline-block w-full py-3 px-4 rounded-full bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
        >
          前往廚房顯示系統 →
        </a>
      </div>

      <div class="text-center">
        <p class="text-xs text-gray-500">
          © 2026 MakanMasak. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import {
  KITCHEN_DISPLAY_URL,
  LOGIN_REDIRECT_QUERY,
  readLoginRedirect,
} from "@/utils/loginRedirect";
import { useI18n } from "@/i18n";
import { UserRole } from "@/types";
import { Eye, EyeOff, AlertCircle } from "lucide-vue-next";
import { getInitialLoginCredentials } from "./loginDefaults";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

/**
 * Return the user to the page the guard interrupted, falling back to the role's
 * landing page. Without this an admin whose session lapsed on
 * /dashboard/monitoring came back at /dashboard/platform.
 */
const postLoginTarget = () =>
  readLoginRedirect(route.query[LOGIN_REDIRECT_QUERY]) ??
  authStore.getDefaultRoute();

const showPassword = ref(false);
const isLoading = ref(false);
const error = ref("");

const form = reactive(getInitialLoginCredentials());

const errors = reactive({
  username: "",
  password: "",
});

const validateForm = () => {
  errors.username = "";
  errors.password = "";

  if (!form.username.trim()) {
    errors.username = t("auth.enterUsername");
    return false;
  }

  if (!form.password) {
    errors.password = t("auth.enterPassword");
    return false;
  }

  if (form.password.length < 6) {
    errors.password = t("auth.passwordMinLength");
    return false;
  }

  return true;
};

// Chef redirect state — shown when a chef tries to log in here
const showChefRedirect = ref(false);

const handleSubmit = async () => {
  if (!validateForm()) return;

  isLoading.value = true;
  error.value = "";

  try {
    const result = await authStore.login(form.username, form.password);

    if (result.success) {
      const role = authStore.user?.role;
      if (role === UserRole.CHEF) {
        // Chef should use Kitchen Display, not Admin Dashboard.
        // Log them out here and show redirect prompt instead of
        // silently redirecting (which would require logging in twice).
        await authStore.logout();
        showChefRedirect.value = true;
        return;
      }
      router.push(postLoginTarget());
    } else {
      error.value = result.error || t("auth.loginFailed");
    }
  } catch {
    error.value = t("auth.loginError");
  } finally {
    isLoading.value = false;
  }
};

// Clear errors when user types
// const clearErrors = () => {
//   errors.username = ''
//   errors.password = ''
//   error.value = ''
// }

// Auto-redirect if already authenticated
onMounted(() => {
  if (authStore.isAuthenticated) {
    if (authStore.user?.role === UserRole.CHEF) {
      // Chef shouldn't be in admin dashboard — show redirect
      authStore.logout();
      showChefRedirect.value = true;
      return;
    }
    router.push(postLoginTarget());
  }
});
</script>
