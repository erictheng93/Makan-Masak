<template>
  <div class="customer-shell min-h-screen bg-ios-bg py-12 px-4 sm:px-6 lg:px-8">
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
          {{ t("auth.memberRegister") }}
        </p>
      </div>

      <div
        class="bg-ios-card rounded-3xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] p-8"
      >
        <!-- 驗證信已寄出 -->
        <div
          v-if="outcome === 'email_sent'"
          data-testid="email-sent-panel"
          role="status"
        >
          <div
            class="w-12 h-12 rounded-full bg-ios-green/10 flex items-center justify-center mb-4"
          >
            <svg
              class="w-6 h-6 text-ios-green"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 class="text-xl font-semibold text-ios-text">
            {{ t("auth.verificationEmailSentTitle") }}
          </h3>
          <p class="mt-2 text-sm text-ios-secondary">
            {{
              tWithParams("auth.verificationEmailSentDesc", {
                identifier: submittedIdentifier,
              })
            }}
          </p>
          <router-link
            to="/login?mode=password"
            class="mt-6 block w-full bg-ios-blue text-white py-3.5 px-4 rounded-full font-semibold text-center shadow-[0_4px_16px_rgba(0,122,255,0.24)] transition-all duration-200 ease-out hover:bg-ios-blue/90"
          >
            {{ t("auth.goToLogin") }}
          </router-link>
        </div>

        <!-- 帳號建好了，但驗證信寄不出去（502 VERIFICATION_EMAIL_FAILED） -->
        <div
          v-else-if="outcome === 'email_failed'"
          data-testid="email-failed-panel"
        >
          <div
            class="w-12 h-12 rounded-full bg-ios-orange/10 flex items-center justify-center mb-4"
          >
            <svg
              class="w-6 h-6 text-ios-orange"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
          <h3 class="text-xl font-semibold text-ios-text">
            {{ t("auth.verificationEmailFailedTitle") }}
          </h3>
          <p class="mt-2 text-sm text-ios-secondary">
            {{ t("auth.verificationEmailFailedDesc") }}
          </p>

          <p
            v-if="resendNotice"
            data-testid="resend-notice"
            class="mt-4 text-sm rounded-2xl px-4 py-3"
            :class="
              resendFailed
                ? 'bg-ios-red/10 text-ios-red'
                : 'bg-ios-green/10 text-ios-green'
            "
          >
            {{ resendNotice }}
          </p>

          <button
            type="button"
            data-testid="resend-verification"
            :disabled="isResending"
            class="mt-6 w-full bg-ios-blue text-white py-3.5 px-4 rounded-full font-semibold shadow-[0_4px_16px_rgba(0,122,255,0.24)] transition-all duration-200 ease-out hover:bg-ios-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleResend"
          >
            {{
              isResending
                ? t("auth.resendVerificationSending")
                : t("auth.resendVerification")
            }}
          </button>
        </div>

        <!-- 註冊表單 -->
        <form v-else class="space-y-5" @submit.prevent="handleSubmit">
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
              :aria-invalid="!!errors.identifier"
              :aria-describedby="
                errors.identifier ? 'identifier-error' : undefined
              "
              type="text"
              required
              autocomplete="username"
              data-testid="identifier-input"
              class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
              :placeholder="t('auth.identifierPlaceholder')"
            />
            <p
              v-if="errors.identifier"
              id="identifier-error"
              role="alert"
              class="mt-2 text-sm text-ios-red"
            >
              {{ errors.identifier }}
            </p>
          </div>

          <div>
            <label
              for="displayName"
              class="block text-sm font-medium text-ios-text mb-2"
            >
              {{ t("auth.displayName") }}
            </label>
            <input
              id="displayName"
              v-model="form.displayName"
              :aria-invalid="!!errors.displayName"
              :aria-describedby="
                errors.displayName ? 'displayName-error' : undefined
              "
              type="text"
              required
              autocomplete="name"
              data-testid="display-name-input"
              class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
              :placeholder="t('auth.displayNamePlaceholder')"
            />
            <p
              v-if="errors.displayName"
              id="displayName-error"
              role="alert"
              class="mt-2 text-sm text-ios-red"
            >
              {{ errors.displayName }}
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
              :aria-invalid="!!errors.password"
              :aria-describedby="
                errors.password ? 'password-error' : 'password-rule'
              "
              type="password"
              required
              autocomplete="new-password"
              data-testid="password-input"
              class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
              :placeholder="t('auth.passwordPlaceholder')"
            />
            <p
              v-if="errors.password"
              id="password-error"
              role="alert"
              class="mt-2 text-sm text-ios-red"
            >
              {{ errors.password }}
            </p>
            <p
              v-else
              id="password-rule"
              class="mt-2 text-sm text-ios-secondary"
            >
              {{ passwordRule }}
            </p>
          </div>

          <div
            v-if="error"
            data-testid="auth-error"
            role="alert"
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
              {{ t("auth.registering") }}
            </span>
            <span v-else>{{ t("auth.register") }}</span>
          </button>
        </form>

        <div v-if="outcome === 'form'" class="mt-6 text-center">
          <p class="text-sm text-ios-secondary">
            {{ t("auth.hasAccount") }}
            <router-link
              to="/login"
              data-testid="login-link"
              class="font-medium text-ios-blue"
            >
              {{ t("auth.loginNow") }}
            </router-link>
          </p>
        </div>

        <!-- 訪客繼續 -->
        <div v-if="outcome === 'form'" class="mt-4 text-center">
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
import { ref, reactive, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { customerIdentityApi } from "@/services/customerIdentityApi";
import { useI18n } from "@/composables/useI18n";

// Mirrors PASSWORD_MIN_LENGTH in apps/api/src/features/customer/routes.
const PASSWORD_MIN_LENGTH = 10;

const router = useRouter();
const authStore = useAuthStore();
const { t, tWithParams } = useI18n();
// The year was hard-coded alongside the English notice; both were the same bug.
const currentYear = new Date().getFullYear();

const outcome = ref<"form" | "email_sent" | "email_failed">("form");
const isLoading = ref(false);
const isResending = ref(false);
const error = ref("");
const resendNotice = ref("");
const resendFailed = ref(false);
const submittedIdentifier = ref("");

const form = reactive({
  identifier: "",
  password: "",
  displayName: "",
});

const errors = reactive({
  identifier: "",
  password: "",
  displayName: "",
});

const passwordRule = computed(() =>
  tWithParams("validation.minLength", { min: PASSWORD_MIN_LENGTH }),
);

const validateForm = () => {
  errors.identifier = "";
  errors.password = "";
  errors.displayName = "";

  let isValid = true;

  if (!form.identifier.trim()) {
    errors.identifier = t("auth.identifierRequired");
    isValid = false;
  }

  if (!form.displayName.trim()) {
    errors.displayName = t("auth.displayNameRequired");
    isValid = false;
  }

  if (!form.password) {
    errors.password = t("auth.passwordRequired");
    isValid = false;
  } else if (form.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = passwordRule.value;
    isValid = false;
  }

  return isValid;
};

const handleSubmit = async () => {
  if (!validateForm()) return;

  isLoading.value = true;
  error.value = "";
  const identifier = form.identifier.trim();

  try {
    const result = await authStore.register({
      identifier,
      password: form.password,
      displayName: form.displayName.trim(),
    });

    if (!result.success) {
      // The account was created; only its verification email failed to leave.
      // Re-registering would just hit IDENTITY_EXISTS, so the only way forward
      // is a resend — say so instead of showing a bare error.
      if (result.code === "VERIFICATION_EMAIL_FAILED") {
        submittedIdentifier.value = identifier;
        outcome.value = "email_failed";
        return;
      }

      error.value = result.error || t("auth.registerFailed");
      return;
    }

    submittedIdentifier.value = identifier;

    if (result.data.verificationMethod === "phone") {
      // Registration already sent the code; go straight to entering it.
      router.push({
        path: "/login",
        query: { phone: identifier, otpSent: "1" },
      });
      return;
    }

    outcome.value = "email_sent";
  } catch {
    error.value = t("auth.registerError");
  } finally {
    isLoading.value = false;
  }
};

const handleResend = async () => {
  isResending.value = true;
  resendNotice.value = "";

  try {
    await customerIdentityApi.resendVerification(submittedIdentifier.value);
    resendFailed.value = false;
    resendNotice.value = t("auth.resendVerificationSent");
  } catch {
    resendFailed.value = true;
    resendNotice.value = t("auth.resendVerificationFailed");
  } finally {
    isResending.value = false;
  }
};

// 如果已登入，自動跳轉
onMounted(async () => {
  if (authStore.isAuthenticated) {
    const isValid = await authStore.checkAuth();
    if (isValid) {
      router.push("/orders");
    }
  }
});
</script>
