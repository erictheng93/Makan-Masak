<template>
  <div
    class="ui-page min-h-screen flex items-center justify-center bg-ios-bg py-12 px-4 sm:px-6 lg:px-8"
  >
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <div
          class="mx-auto w-16 h-16 bg-primary-600 rounded-xl flex items-center justify-center mb-4"
        >
          <span class="text-white font-bold text-2xl">M</span>
        </div>
        <p class="text-sm font-semibold text-primary-700">MakanMasak</p>
        <h1 class="ui-page-heading mt-3 text-2xl font-bold text-ios-text">
          {{ t("auth.adminLogin") }}
        </h1>

        <div
          v-if="shopSlug"
          data-testid="login-shop"
          class="mt-4 flex flex-col items-center gap-1"
        >
          <img
            v-if="shopLogoUrl"
            :src="shopLogoUrl"
            alt=""
            class="w-12 h-12 rounded-full object-cover"
          />
          <p class="text-base font-semibold text-gray-900">
            {{ t("auth.shopSigningIn", { shop: shopName || shopSlug }) }}
          </p>
          <button
            v-if="!isShopRoute"
            type="button"
            data-testid="login-shop-clear"
            class="text-sm font-medium text-primary-700 hover:text-primary-700"
            @click="clearShop"
          >
            {{ t("auth.shopNotYours") }}
          </button>
        </div>
        <div
          v-else-if="shopInvalid"
          data-testid="login-shop-invalid"
          class="mt-4 rounded-2xl bg-orange-50 p-4 text-sm text-orange-800"
        >
          <p>{{ t("auth.shopInvalidLink") }}</p>
          <router-link
            to="/login"
            class="mt-2 inline-block font-medium text-primary-700 hover:text-primary-700"
          >
            {{ t("auth.shopPlainLogin") }}
          </router-link>
        </div>
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
            <p v-if="errors.username" class="mt-1 text-sm text-red-700">
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
                :aria-label="
                  showPassword ? t('a11y.hidePassword') : t('a11y.showPassword')
                "
                type="button"
                class="absolute inset-y-0 right-0 pr-3 flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                @click="showPassword = !showPassword"
              >
                <Eye v-if="showPassword" class="w-4 h-4 text-gray-400" />
                <EyeOff v-else class="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <p v-if="errors.password" class="mt-1 text-sm text-red-700">
              {{ errors.password }}
            </p>
            <div class="ui-toolbar flex items-center justify-end mt-2">
              <router-link
                :to="forgotPasswordTo"
                class="text-sm font-medium text-primary-700 hover:text-primary-700"
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
            <AlertCircle class="w-5 h-5 text-red-700 mr-2" />
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

      <div aria-live="polite">
        <p
          v-if="oauthMessage"
          :role="oauthMessage.kind === 'error' ? 'alert' : 'status'"
          data-testid="oauth-message"
          :data-kind="oauthMessage.kind"
          class="rounded-2xl bg-white p-4 text-sm shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
          :class="
            oauthMessage.kind === 'error' ? 'text-ios-red' : 'text-ios-text'
          "
        >
          {{ oauthMessage.text }}
        </p>
      </div>

      <section
        v-if="providers.length > 0"
        data-testid="oauth-section"
        class="rounded-3xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)] space-y-3"
        :aria-busy="oauthBusy"
      >
        <p class="text-center text-sm text-ios-text/60">
          {{ t("auth.oauth.divider") }}
        </p>
        <button
          v-for="provider in providers"
          :key="provider"
          type="button"
          :data-testid="`oauth-${provider}`"
          :disabled="oauthBusy"
          class="w-full rounded-full bg-ios-bg px-4 py-3 text-sm font-semibold text-ios-text transition-colors duration-200 ease-out hover:bg-ios-bg/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue disabled:opacity-50"
          @click="startOAuth(provider)"
        >
          {{ t(`auth.oauth.${provider}`) }}
        </button>
      </section>

      <!-- Chef redirect prompt -->
      <div
        v-if="showChefRedirect"
        class="rounded-2xl bg-emerald-50 border border-emerald-200 p-6 text-center space-y-3"
      >
        <div class="text-3xl">👨‍🍳</div>
        <p class="font-semibold text-emerald-800">廚師帳號請使用廚房顯示系統</p>
        <p class="text-sm text-emerald-700">
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
import { ref, reactive, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import {
  KITCHEN_DISPLAY_URL,
  LOGIN_REDIRECT_QUERY,
  readLoginRedirect,
} from "@/utils/loginRedirect";
import { useI18n } from "@/i18n";
import { api } from "@/services/api";
import {
  fetchStaffOAuthProviders,
  oauthErrorMessageKey,
  staffOAuthStartUrl,
  type StaffOAuthProvider,
} from "@/services/staffOAuthService";
import { getApiErrorStatus } from "@makanmasak/shared/utils/unknown";
import {
  clearRememberedShop,
  getRememberedShop,
  parseShopSlug,
} from "@/utils/loginShop";
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

// /s/:slug is "shop mode"; on plain /login a remembered slug plays the same role.
const isShopRoute = route.name === "ShopLogin";
const routeSlug = parseShopSlug(route.params.slug);
const shopSlug = ref<string | null>(
  isShopRoute ? routeSlug : getRememberedShop(),
);
const shopName = ref("");
const shopLogoUrl = ref<string | null>(null);
const shopInvalid = ref(isShopRoute && !routeSlug);

const forgotPasswordTo = computed(() =>
  shopSlug.value
    ? { path: "/forgot-password", query: { shop: shopSlug.value } }
    : "/forgot-password",
);

const clearShop = () => {
  clearRememberedShop();
  shopSlug.value = null;
};

const loadShopContext = async () => {
  const slug = shopSlug.value;
  if (!slug) return;
  try {
    const response = await api.get<{
      slug: string;
      name: string;
      logoUrl: string | null;
    }>(`/restaurants/login-context/${slug}`);
    shopName.value = response.data?.data?.name ?? "";
    shopLogoUrl.value = response.data?.data?.logoUrl ?? null;
  } catch (e) {
    if (getApiErrorStatus(e) !== 404) return; // offline: still send the shop
    shopSlug.value = null;
    if (isShopRoute) shopInvalid.value = true;
    else clearRememberedShop(); // a stale remembered shop must not block login
  }
};

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

const providers = ref<StaffOAuthProvider[]>([]);
const oauthBusy = ref(false);
const oauthMessage = ref<{ kind: "error" | "notice"; text: string } | null>(
  null,
);

/** Back to this very login page (so /s/:slug returns to itself) and its redirect. */
const oauthReturnPath = () => {
  const redirect = readLoginRedirect(route.query[LOGIN_REDIRECT_QUERY]);
  return redirect
    ? `${route.path}?${LOGIN_REDIRECT_QUERY}=${encodeURIComponent(redirect)}`
    : route.path;
};

const startOAuth = (provider: StaffOAuthProvider) => {
  window.location.assign(staffOAuthStartUrl(provider, oauthReturnPath()));
};

/** Handles ?oauth_code / ?oauth_error on return from the provider. */
const handleOAuthReturn = async () => {
  const first = (v: unknown) => (typeof v === "string" ? v : undefined);
  const code = first(route.query.oauth_code);
  const failure = first(route.query.oauth_error);
  if (!code && !failure) return;

  // Strip first: a reload or Back must never resubmit a single-use code.
  const { oauth_code: _c, oauth_error: _e, ...query } = route.query;
  await router.replace({ path: route.path, query });

  if (failure && !code) {
    oauthMessage.value = {
      kind: failure === "declined" ? "notice" : "error",
      text: t(oauthErrorMessageKey(failure)),
    };
    return;
  }
  if (!code) return;

  oauthBusy.value = true;
  oauthMessage.value = { kind: "notice", text: t("auth.oauth.signingIn") };
  const result = await authStore.loginWithOAuth(code);
  oauthBusy.value = false;
  if (result.success) {
    oauthMessage.value = null;
    router.push(postLoginTarget());
  } else {
    oauthMessage.value = { kind: "error", text: result.error };
  }
};

// Chef redirect state — shown when a chef tries to log in here
const showChefRedirect = ref(false);

const handleSubmit = async () => {
  if (!validateForm()) return;

  isLoading.value = true;
  error.value = "";

  try {
    const result = await authStore.login(
      form.username,
      form.password,
      shopSlug.value ?? undefined,
    );

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
  void loadShopContext();
  void fetchStaffOAuthProviders().then((list) => (providers.value = list));
  void handleOAuthReturn();
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
