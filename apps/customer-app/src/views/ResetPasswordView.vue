<template>
  <div class="customer-shell min-h-screen bg-ios-bg py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full mx-auto space-y-8">
      <div class="text-center">
        <div
          class="mx-auto w-16 h-16 bg-ios-blue rounded-2xl flex items-center justify-center mb-4 shadow-[0_4px_16px_rgba(0,122,255,0.24)]"
        >
          <span class="text-white font-bold text-2xl">M</span>
        </div>
        <h2 class="text-3xl font-bold text-ios-text">
          {{ t("auth.resetPasswordTitle") }}
        </h2>
      </div>

      <div
        class="bg-ios-card rounded-3xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] p-8"
      >
        <!-- 連結裡沒有 token，表單再怎麼填都送不出去 -->
        <p
          v-if="!token"
          data-testid="missing-token"
          role="alert"
          class="text-sm text-ios-red"
        >
          {{ t("auth.linkTokenMissing") }}
        </p>

        <div v-else-if="done" data-testid="success-panel">
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
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <p class="text-sm text-ios-secondary">
            {{ t("auth.resetPasswordSuccess") }}
          </p>
        </div>

        <form v-else class="space-y-5" @submit.prevent="handleSubmit">
          <p class="text-sm text-ios-secondary">
            {{ t("auth.resetPasswordHint") }}
          </p>

          <div>
            <label
              for="newPassword"
              class="block text-sm font-medium text-ios-text mb-2"
            >
              {{ t("auth.newPassword") }}
            </label>
            <input
              id="newPassword"
              v-model="form.newPassword"
              type="password"
              required
              autocomplete="new-password"
              data-testid="new-password-input"
              class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
              :placeholder="t('auth.enterNewPassword')"
            />
            <p v-if="errors.newPassword" class="mt-2 text-sm text-ios-red">
              {{ errors.newPassword }}
            </p>
            <p v-else class="mt-2 text-sm text-ios-secondary">
              {{ passwordRule }}
            </p>
          </div>

          <div>
            <label
              for="confirmPassword"
              class="block text-sm font-medium text-ios-text mb-2"
            >
              {{ t("auth.confirmNewPassword") }}
            </label>
            <input
              id="confirmPassword"
              v-model="form.confirmPassword"
              type="password"
              required
              autocomplete="new-password"
              data-testid="confirm-password-input"
              class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
              :placeholder="t('auth.confirmPasswordPlaceholder')"
            />
            <p v-if="errors.confirmPassword" class="mt-2 text-sm text-ios-red">
              {{ errors.confirmPassword }}
            </p>
          </div>

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
            {{
              isLoading ? t("common.loading") : t("auth.resetPasswordSubmit")
            }}
          </button>
        </form>

        <router-link
          v-if="!token"
          to="/forgot-password"
          class="mt-4 inline-flex min-h-11 items-center text-ios-blue"
          >{{ t("auth.forgotPasswordTitle") }}</router-link
        >
        <div class="mt-6 text-center">
          <router-link
            to="/login?mode=password"
            data-testid="back-to-login"
            class="text-sm text-ios-blue"
          >
            {{ t("auth.backToLogin") }}
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { customerIdentityApi } from "@/services/customerIdentityApi";
import { useI18n } from "@/composables/useI18n";

// Mirrors PASSWORD_MIN_LENGTH in apps/api/src/features/customer/routes.
const PASSWORD_MIN_LENGTH = 10;

const route = useRoute();
const { t, tWithParams } = useI18n();

// The reset mail links to /reset-password?token=… — that query string is the
// only place the token ever exists.
const token = computed(() => {
  const raw = route.query.token;
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : "";
  return typeof raw === "string" ? raw : "";
});

const isLoading = ref(false);
const done = ref(false);
const error = ref("");

const form = reactive({
  newPassword: "",
  confirmPassword: "",
});

const errors = reactive({
  newPassword: "",
  confirmPassword: "",
});

const passwordRule = computed(() =>
  tWithParams("validation.minLength", { min: PASSWORD_MIN_LENGTH }),
);

const validateForm = () => {
  errors.newPassword = "";
  errors.confirmPassword = "";

  let isValid = true;

  if (!form.newPassword) {
    errors.newPassword = t("auth.passwordRequired");
    isValid = false;
  } else if (form.newPassword.length < PASSWORD_MIN_LENGTH) {
    errors.newPassword = passwordRule.value;
    isValid = false;
  }

  if (form.confirmPassword !== form.newPassword) {
    errors.confirmPassword = t("auth.passwordMismatch");
    isValid = false;
  }

  return isValid;
};

const handleSubmit = async () => {
  error.value = "";
  if (!validateForm()) return;

  isLoading.value = true;

  try {
    await customerIdentityApi.resetPassword(token.value, form.newPassword);
    done.value = true;
  } catch (err: unknown) {
    void err;
    error.value = t("messages.networkError");
  } finally {
    isLoading.value = false;
  }
};
</script>
