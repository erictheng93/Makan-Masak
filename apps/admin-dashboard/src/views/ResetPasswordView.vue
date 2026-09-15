<template>
  <div
    class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8"
  >
    <div class="max-w-md w-full space-y-8">
      <!-- Header -->
      <div class="text-center">
        <div
          class="mx-auto w-16 h-16 bg-primary-600 rounded-xl flex items-center justify-center mb-4"
        >
          <span class="text-white font-bold text-2xl">M</span>
        </div>
        <h2 class="text-3xl font-bold text-gray-900">MakanMasak</h2>
        <p class="mt-2 text-sm text-gray-600">
          {{ t("auth.resetPasswordSubtitle") }}
        </p>
      </div>

      <!-- Verifying Token -->
      <div v-if="verifying" class="mt-8 space-y-6">
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div class="flex items-center justify-center">
            <div
              class="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent"
            />
            <p class="ml-3 text-sm text-blue-800">
              {{ t("auth.verifyingLink") }}
            </p>
          </div>
        </div>
      </div>

      <!-- Token Error -->
      <div v-else-if="tokenError" class="mt-8 space-y-6">
        <div class="bg-red-50 border border-red-200 rounded-lg p-6">
          <div class="flex items-start">
            <div
              class="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center"
            >
              <AlertCircle class="w-6 h-6 text-red-600" />
            </div>
            <div class="ml-4 flex-1">
              <h3 class="text-lg font-medium text-red-900">
                {{ t("auth.linkInvalid") }}
              </h3>
              <p class="mt-2 text-sm text-red-700">
                {{ tokenError }}
              </p>
              <p class="mt-3 text-sm text-red-600">
                {{ t("auth.linkInvalidMessage") }}
              </p>
            </div>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-3">
          <router-link
            to="/forgot-password"
            class="flex-1 btn-primary text-center"
          >
            {{ t("auth.resendResetEmail") }}
          </router-link>
          <router-link
            to="/login"
            class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 text-center"
          >
            {{ t("auth.returnToLogin") }}
          </router-link>
        </div>
      </div>

      <!-- Success State -->
      <div v-else-if="success" class="mt-8 space-y-6">
        <div class="bg-green-50 border border-green-200 rounded-lg p-6">
          <div class="flex items-start">
            <div
              class="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center"
            >
              <CheckCircle class="w-6 h-6 text-green-600" />
            </div>
            <div class="ml-4 flex-1">
              <h3 class="text-lg font-medium text-green-900">
                {{ t("auth.resetSuccess") }}
              </h3>
              <p class="mt-2 text-sm text-green-600">
                {{ t("auth.resetSuccessMessage") }}
              </p>
            </div>
          </div>
        </div>

        <div class="text-center">
          <router-link to="/login" class="w-full btn-primary inline-block">
            {{ t("auth.goToLogin") }}
          </router-link>
        </div>
      </div>

      <!-- Reset Password Form -->
      <form v-else class="mt-8 space-y-6" @submit.prevent="handleSubmit">
        <!-- User Info -->
        <div
          v-if="maskedEmail"
          class="bg-gray-50 rounded-lg p-4 border border-gray-200"
        >
          <div class="flex items-center">
            <div
              class="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center"
            >
              <User class="w-5 h-5 text-gray-600" />
            </div>
            <div class="ml-3">
              <p class="text-xs text-gray-500">{{ t("auth.resetAccount") }}</p>
              <p class="text-sm font-medium text-gray-900">{{ maskedEmail }}</p>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <!-- New Password -->
          <div>
            <label for="new-password" class="form-label">{{
              t("auth.newPassword")
            }}</label>
            <div class="relative">
              <input
                id="new-password"
                v-model="form.newPassword"
                :type="showPassword ? 'text' : 'password'"
                required
                autocomplete="new-password"
                class="form-input pr-10"
                :class="{ 'border-red-500': errors.newPassword }"
                :placeholder="t('auth.newPasswordPlaceholder')"
                :disabled="isLoading"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 pr-3 flex items-center"
                tabindex="-1"
                @click="showPassword = !showPassword"
              >
                <Eye v-if="showPassword" class="w-4 h-4 text-gray-400" />
                <EyeOff v-else class="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <p v-if="errors.newPassword" class="mt-1 text-sm text-red-600">
              {{ errors.newPassword }}
            </p>

            <!-- Password Strength Indicator -->
            <div v-if="form.newPassword" class="mt-2">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs text-gray-600">{{
                  t("auth.passwordStrength")
                }}</span>
                <span
                  class="text-xs font-medium"
                  :class="passwordStrengthTextColor"
                >
                  {{ passwordStrengthText }}
                </span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  class="h-2 rounded-full transition-all duration-300"
                  :class="passwordStrengthColor"
                  :style="{ width: `${(passwordStrength / 5) * 100}%` }"
                />
              </div>
              <ul class="mt-2 space-y-1">
                <li
                  class="text-xs flex items-center"
                  :class="
                    form.newPassword.length >= 6
                      ? 'text-green-600'
                      : 'text-gray-500'
                  "
                >
                  <Check
                    v-if="form.newPassword.length >= 6"
                    class="w-3 h-3 mr-1"
                  />
                  <X v-else class="w-3 h-3 mr-1" />
                  {{ t("auth.atLeast6Chars") }}
                </li>
                <li
                  class="text-xs flex items-center"
                  :class="
                    form.newPassword.length >= 8
                      ? 'text-green-600'
                      : 'text-gray-500'
                  "
                >
                  <Check
                    v-if="form.newPassword.length >= 8"
                    class="w-3 h-3 mr-1"
                  />
                  <X v-else class="w-3 h-3 mr-1" />
                  {{ t("auth.atLeast8Chars") }}
                </li>
                <li
                  class="text-xs flex items-center"
                  :class="
                    /[a-z]/.test(form.newPassword) &&
                    /[A-Z]/.test(form.newPassword)
                      ? 'text-green-600'
                      : 'text-gray-500'
                  "
                >
                  <Check
                    v-if="
                      /[a-z]/.test(form.newPassword) &&
                      /[A-Z]/.test(form.newPassword)
                    "
                    class="w-3 h-3 mr-1"
                  />
                  <X v-else class="w-3 h-3 mr-1" />
                  {{ t("auth.upperLowerCase") }}
                </li>
                <li
                  class="text-xs flex items-center"
                  :class="
                    /\d/.test(form.newPassword)
                      ? 'text-green-600'
                      : 'text-gray-500'
                  "
                >
                  <Check
                    v-if="/\d/.test(form.newPassword)"
                    class="w-3 h-3 mr-1"
                  />
                  <X v-else class="w-3 h-3 mr-1" />
                  {{ t("auth.containsNumber") }}
                </li>
                <li
                  class="text-xs flex items-center"
                  :class="
                    /[^a-zA-Z0-9]/.test(form.newPassword)
                      ? 'text-green-600'
                      : 'text-gray-500'
                  "
                >
                  <Check
                    v-if="/[^a-zA-Z0-9]/.test(form.newPassword)"
                    class="w-3 h-3 mr-1"
                  />
                  <X v-else class="w-3 h-3 mr-1" />
                  {{ t("auth.containsSpecialChar") }}
                </li>
              </ul>
            </div>
          </div>

          <!-- Confirm Password -->
          <div>
            <label for="confirm-password" class="form-label">{{
              t("auth.confirmPassword")
            }}</label>
            <div class="relative">
              <input
                id="confirm-password"
                v-model="form.confirmPassword"
                :type="showConfirmPassword ? 'text' : 'password'"
                required
                autocomplete="new-password"
                class="form-input pr-10"
                :class="{ 'border-red-500': errors.confirmPassword }"
                :placeholder="t('auth.confirmPasswordPlaceholder')"
                :disabled="isLoading"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 pr-3 flex items-center"
                tabindex="-1"
                @click="showConfirmPassword = !showConfirmPassword"
              >
                <Eye v-if="showConfirmPassword" class="w-4 h-4 text-gray-400" />
                <EyeOff v-else class="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <p v-if="errors.confirmPassword" class="mt-1 text-sm text-red-600">
              {{ errors.confirmPassword }}
            </p>
          </div>
        </div>

        <!-- Error Message -->
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

        <!-- Submit Button -->
        <div>
          <button
            type="submit"
            :disabled="isLoading || passwordStrength < 1"
            class="w-full btn-primary"
            :class="{
              'opacity-50 cursor-not-allowed':
                isLoading || passwordStrength < 1,
            }"
          >
            <span v-if="isLoading" class="flex items-center justify-center">
              <div
                class="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"
              />
              {{ t("auth.resetting") }}
            </span>
            <span v-else>{{ t("auth.resetPasswordBtn") }}</span>
          </button>
        </div>
      </form>

      <!-- Footer -->
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
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { api } from "@/services/api";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import {
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
  User,
  Check,
  X,
} from "lucide-vue-next";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

type ResetTokenVerificationResponse = {
  valid: boolean;
  email?: string;
  error?: { code?: string; message?: string };
};

type ResetPasswordResponse = {
  success: boolean;
  message?: string;
  error?: { code?: string; message?: string };
};

const passwordResetCodeKeys = {
  RESET_TOKEN_EXPIRED: "auth.resetTokenExpired",
  RESET_TOKEN_INVALID: "auth.resetTokenInvalid",
  WEAK_PASSWORD: "auth.weakPassword",
  RESET_REQUEST_THROTTLED: "auth.resetRequestThrottled",
};

const verifying = ref(true);
const tokenError = ref("");
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const isLoading = ref(false);
const success = ref(false);
const error = ref("");
const maskedEmail = ref("");
const token = ref("");

const form = reactive({
  newPassword: "",
  confirmPassword: "",
});

const errors = reactive({
  newPassword: "",
  confirmPassword: "",
});

// Password strength calculation
const passwordStrength = computed(() => {
  const password = form.newPassword;
  let strength = 0;

  if (password.length >= 6) strength++;
  if (password.length >= 8) strength++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
  if (/\d/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;

  return strength;
});

const passwordStrengthText = computed(() => {
  const strength = passwordStrength.value;
  if (strength <= 1) return t("auth.strengthWeak");
  if (strength <= 2) return t("auth.strengthMedium");
  if (strength <= 3) return t("auth.strengthGood");
  if (strength <= 4) return t("auth.strengthStrong");
  return t("auth.strengthVeryStrong");
});

const passwordStrengthColor = computed(() => {
  const strength = passwordStrength.value;
  if (strength <= 1) return "bg-red-500";
  if (strength <= 2) return "bg-orange-500";
  if (strength <= 3) return "bg-yellow-500";
  if (strength <= 4) return "bg-blue-500";
  return "bg-green-500";
});

const passwordStrengthTextColor = computed(() => {
  const strength = passwordStrength.value;
  if (strength <= 1) return "text-red-600";
  if (strength <= 2) return "text-orange-600";
  if (strength <= 3) return "text-yellow-600";
  if (strength <= 4) return "text-blue-600";
  return "text-green-600";
});

const verifyToken = async () => {
  try {
    // These auth endpoints return a bare object (not the { success, data }
    // envelope), so use the raw axios instance whose response.data is the
    // payload type directly.
    const response = await api.instance.get<ResetTokenVerificationResponse>(
      "/auth/reset-password/verify",
      {
        params: { token: token.value },
        validateStatus: () => true,
      },
    );
    const data = response.data;

    if (data.valid) {
      maskedEmail.value = data.email || "";
    } else {
      tokenError.value = resolveUserFacingError(
        { response: { status: response.status, data } },
        t,
        {
          codeKeys: passwordResetCodeKeys,
          fallbackKey: "auth.tokenInvalid",
        },
      ).message;
    }
  } catch (err) {
    console.error("Token verification error:", err);
    tokenError.value = t("auth.tokenVerifyError");
  } finally {
    verifying.value = false;
  }
};

const validateForm = () => {
  errors.newPassword = "";
  errors.confirmPassword = "";

  if (!form.newPassword) {
    errors.newPassword = t("auth.newPasswordRequired");
    return false;
  }

  if (form.newPassword.length < 6) {
    errors.newPassword = t("auth.passwordMin6");
    return false;
  }

  if (!form.confirmPassword) {
    errors.confirmPassword = t("auth.confirmPasswordRequired");
    return false;
  }

  if (form.newPassword !== form.confirmPassword) {
    errors.confirmPassword = t("auth.passwordMismatch");
    return false;
  }

  return true;
};

const handleSubmit = async () => {
  error.value = "";

  if (!validateForm()) {
    return;
  }

  isLoading.value = true;

  try {
    const response = await api.instance.post<ResetPasswordResponse>(
      "/auth/reset-password",
      {
        token: token.value,
        newPassword: form.newPassword,
        confirmPassword: form.confirmPassword,
      },
      {
        validateStatus: () => true,
      },
    );
    const data = response.data;

    if (data.success) {
      // The success copy is all local (auth.resetSuccess / resetSuccessMessage).
      // data.message is the API's untranslated English, so it is not shown.
      success.value = true;

      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } else {
      error.value = resolveUserFacingError(
        { response: { status: response.status, data } },
        t,
        {
          codeKeys: passwordResetCodeKeys,
          fallbackKey: "auth.resetFailed",
        },
      ).message;
    }
  } catch (err) {
    console.error("Reset password error:", err);
    error.value = t("auth.networkError");
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  const tokenParam = route.query.token as string;

  if (!tokenParam) {
    tokenError.value = t("auth.missingToken");
    verifying.value = false;
    return;
  }

  token.value = tokenParam;
  verifyToken();
});
</script>
