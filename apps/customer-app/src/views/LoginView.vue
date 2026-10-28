<template>
  <div class="min-h-screen bg-ios-bg py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full mx-auto space-y-8">
      <!-- Logo 和標題 -->
      <div class="text-center">
        <div
          class="mx-auto w-16 h-16 bg-ios-blue rounded-2xl flex items-center justify-center mb-4 shadow-[0_4px_16px_rgba(0,122,255,0.24)]"
        >
          <span class="text-white font-bold text-2xl">M</span>
        </div>
        <h2 class="text-3xl font-bold text-ios-text">MakanMasak</h2>
        <p class="mt-2 text-sm text-ios-secondary">
          {{ t("auth.memberLogin") }}
        </p>
      </div>

      <div
        class="bg-ios-card rounded-3xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] p-8"
      >
        <!-- 登入方式切換 -->
        <div class="flex gap-1 bg-ios-bg rounded-full p-1 mb-6">
          <button
            v-for="option in modeOptions"
            :key="option.value"
            type="button"
            :data-testid="`tab-${option.value}`"
            :data-active="mode === option.value"
            :aria-pressed="mode === option.value"
            class="flex-1 rounded-full py-2 text-sm font-medium transition-all duration-200 ease-out"
            :class="
              mode === option.value
                ? 'bg-ios-card text-ios-text shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                : 'text-ios-secondary'
            "
            @click="switchMode(option.value)"
          >
            {{ t(option.labelKey) }}
          </button>
        </div>

        <form class="space-y-5" @submit.prevent="handleSubmit">
          <!-- 簡訊驗證碼 -->
          <template v-if="mode === 'otp'">
            <div>
              <label
                for="phone"
                class="block text-sm font-medium text-ios-text mb-2"
              >
                {{ t("auth.phone") }}
              </label>
              <input
                id="phone"
                v-model="form.phone"
                type="tel"
                required
                autocomplete="tel"
                data-testid="phone-input"
                class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
                placeholder="0912 345 678"
              />
              <p v-if="errors.phone" class="mt-2 text-sm text-ios-red">
                {{ errors.phone }}
              </p>
            </div>

            <div v-if="otpRequested">
              <label
                for="otp"
                class="block text-sm font-medium text-ios-text mb-2"
              >
                {{ t("auth.otp") }}
              </label>
              <input
                id="otp"
                v-model="form.otp"
                type="text"
                inputmode="numeric"
                maxlength="6"
                required
                autocomplete="one-time-code"
                data-testid="otp-input"
                class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
                placeholder="123456"
              />
              <p v-if="errors.otp" class="mt-2 text-sm text-ios-red">
                {{ errors.otp }}
              </p>
              <p
                v-if="fromRegistration"
                data-testid="registration-otp-notice"
                class="mt-2 text-sm text-ios-secondary"
              >
                {{ t("auth.otpSentForRegistration") }}
              </p>
              <component
                :is="DevOtpEcho"
                v-if="DevOtpEcho && otpEcho"
                :otp="otpEcho"
              />
            </div>
          </template>

          <!-- 密碼 -->
          <template v-else>
            <div>
              <label
                for="identifier"
                class="block text-sm font-medium text-ios-text mb-2"
              >
                {{ t("auth.identifier") }}
              </label>
              <input
                id="identifier"
                v-model="form.identifier"
                type="text"
                required
                autocomplete="username"
                data-testid="identifier-input"
                class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
                :placeholder="t('auth.identifierPlaceholder')"
              />
              <p v-if="errors.identifier" class="mt-2 text-sm text-ios-red">
                {{ errors.identifier }}
              </p>
            </div>

            <div>
              <label
                for="password"
                class="block text-sm font-medium text-ios-text mb-2"
              >
                {{ t("auth.password") }}
              </label>
              <input
                id="password"
                v-model="form.password"
                type="password"
                required
                autocomplete="current-password"
                data-testid="password-input"
                class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
                :placeholder="t('auth.passwordPlaceholder')"
              />
              <p v-if="errors.password" class="mt-2 text-sm text-ios-red">
                {{ errors.password }}
              </p>
            </div>
          </template>

          <!-- 錯誤提示：兩種方式共用同一句，登入失敗永遠不透露帳號是否存在 -->
          <div
            v-if="error"
            data-testid="auth-error"
            class="bg-ios-red/10 rounded-2xl px-4 py-3"
          >
            <p class="text-sm text-ios-red">{{ error }}</p>
          </div>

          <button
            type="submit"
            :disabled="isLoading"
            data-testid="submit"
            class="w-full bg-ios-blue text-white py-3.5 px-4 rounded-full font-semibold shadow-[0_4px_16px_rgba(0,122,255,0.24)] transition-all duration-200 ease-out hover:bg-ios-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span v-if="isLoading" class="flex items-center justify-center">
              <span
                class="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2"
              />
              {{ t("auth.loggingIn") }}
            </span>
            <span v-else>{{ t(submitLabelKey) }}</span>
          </button>
        </form>

        <div v-if="mode === 'password'" class="mt-4 text-center">
          <router-link
            to="/forgot-password"
            data-testid="forgot-password-link"
            class="text-sm text-ios-blue"
          >
            {{ t("auth.forgotPassword") }}
          </router-link>
        </div>

        <div class="mt-6 text-center">
          <p class="text-sm text-ios-secondary">
            {{ t("auth.noAccount") }}
            <router-link
              to="/register"
              data-testid="register-link"
              class="font-medium text-ios-blue"
            >
              {{ t("auth.registerNow") }}
            </router-link>
          </p>
        </div>

        <!-- 訪客繼續 -->
        <div class="mt-4 text-center">
          <router-link to="/menu" class="text-sm text-ios-secondary">
            {{ t("auth.guestBrowse") }}
          </router-link>
        </div>
      </div>

      <div class="text-center">
        <p class="text-xs text-ios-tertiary">
          {{ tWithParams("footer.copyright", { year: currentYear }) }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, defineAsyncComponent } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "vue-toastification";
import { useI18n } from "@/composables/useI18n";
import { isOtpRecoveryRequest, safeRedirectPath } from "@/utils/login-recovery";

type LoginMode = "otp" | "password";

type RequestOtpData = {
  devOtp?: string;
};

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const { t, tWithParams } = useI18n();
const toast = useToast();
// The year was hard-coded alongside the English notice; both were the same bug.
const currentYear = new Date().getFullYear();
const DevOtpEcho = import.meta.env.DEV
  ? defineAsyncComponent(() => import("@/components/DevOtpEcho.vue"))
  : null;

const modeOptions: Array<{ value: LoginMode; labelKey: string }> = [
  { value: "otp", labelKey: "auth.tabOtp" },
  { value: "password", labelKey: "auth.tabPassword" },
];

const mode = ref<LoginMode>("otp");
const isLoading = ref(false);
const error = ref("");
const otpRequested = ref(false);
const fromRegistration = ref(false);
const otpEcho = ref("");

const form = reactive({
  phone: "",
  otp: "",
  identifier: "",
  password: "",
});

const errors = reactive({
  phone: "",
  otp: "",
  identifier: "",
  password: "",
});

const submitLabelKey = computed(() => {
  if (mode.value === "password") return "auth.login";
  return otpRequested.value ? "auth.login" : "auth.requestOtp";
});

const clearErrors = () => {
  error.value = "";
  errors.phone = "";
  errors.otp = "";
  errors.identifier = "";
  errors.password = "";
};

const switchMode = (next: LoginMode) => {
  if (mode.value === next) return;
  mode.value = next;
  clearErrors();
};

const firstQueryValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }
  return typeof value === "string" ? value : "";
};

const validateOtpForm = () => {
  if (!form.phone.trim()) {
    errors.phone = t("auth.phoneRequired");
    return false;
  }

  if (otpRequested.value && !/^\d{6}$/.test(form.otp)) {
    errors.otp = t("auth.otpRequired");
    return false;
  }

  return true;
};

const validatePasswordForm = () => {
  let isValid = true;

  if (!form.identifier.trim()) {
    errors.identifier = t("auth.identifierRequired");
    isValid = false;
  }

  if (!form.password) {
    errors.password = t("auth.passwordRequired");
    isValid = false;
  }

  return isValid;
};

const goToNextView = () => {
  const redirect = safeRedirectPath(firstQueryValue(route.query.redirect));
  router.push(redirect || "/profile");
};

const submitOtp = async () => {
  if (!otpRequested.value) {
    const result = await authStore.requestOtp(form.phone);
    if (result.success) {
      otpRequested.value = true;
      if (import.meta.env.DEV) {
        otpEcho.value =
          (result.data as RequestOtpData | undefined)?.devOtp ?? "";
      }
      return;
    }
    error.value = result.error || t("auth.loginFailed");
    return;
  }

  const result = await authStore.verifyOtp(form.phone, form.otp);
  if (result.success) {
    // A signed-in customer normally keeps their account (the API links an
    // unowned phone to it); only a phone owned by another account switches.
    if (result.switchedAccount) {
      toast.info(t("auth.otpRecoverySwitchedAccount"));
    }
    goToNextView();
    return;
  }
  error.value = result.error || t("auth.loginFailed");
};

const submitPassword = async () => {
  const result = await authStore.loginWithPassword(
    form.identifier.trim(),
    form.password,
  );
  if (result.success) {
    goToNextView();
    return;
  }
  // Whatever the backend said, verbatim. It answers "unknown account" and
  // "wrong password" with one identical sentence on purpose — splitting them
  // apart here would hand an attacker an account-enumeration oracle.
  error.value = result.error || t("auth.loginFailed");
};

const handleSubmit = async () => {
  clearErrors();

  const valid =
    mode.value === "otp" ? validateOtpForm() : validatePasswordForm();
  if (!valid) return;

  isLoading.value = true;

  try {
    if (mode.value === "otp") {
      await submitOtp();
    } else {
      await submitPassword();
    }
  } catch {
    error.value = t("auth.loginError");
  } finally {
    isLoading.value = false;
  }
};

onMounted(async () => {
  if (firstQueryValue(route.query.mode) === "password") {
    mode.value = "password";
  }

  form.identifier = firstQueryValue(route.query.identifier);
  form.phone = firstQueryValue(route.query.phone);

  // Registration with a phone identifier already sent a code. Landing straight
  // on the code field keeps that SMS the only one the diner is charged for.
  if (form.phone && firstQueryValue(route.query.otpSent) === "1") {
    mode.value = "otp";
    otpRequested.value = true;
    fromRegistration.value = true;
  }

  // An explicit phone-recovery request must not be bounced by an existing
  // session (see isOtpRecoveryRequest); completing the OTP replaces it.
  if (authStore.isAuthenticated && !isOtpRecoveryRequest(route.query)) {
    const isValid = await authStore.checkAuth();
    if (isValid) {
      router.push("/orders");
    }
  }
});
</script>
