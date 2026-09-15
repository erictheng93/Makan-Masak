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
          {{ t("auth.forgotPasswordSubtitle") }}
        </p>
      </div>

      <!-- Success State -->
      <div v-if="success" class="mt-8 space-y-6">
        <div class="bg-green-50 border border-green-200 rounded-lg p-6">
          <div class="flex items-start">
            <div
              class="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center"
            >
              <CheckCircle class="w-6 h-6 text-green-600" />
            </div>
            <div class="ml-4 flex-1">
              <h3 class="text-lg font-medium text-green-900">
                {{ t("auth.emailSent") }}
              </h3>
              <p class="mt-2 text-sm text-green-600">
                {{ t("auth.emailSentMessage") }}
              </p>
            </div>
          </div>
        </div>

        <div class="text-center">
          <router-link
            to="/login"
            class="text-sm font-medium text-primary-600 hover:text-primary-500"
          >
            {{ t("auth.backToLogin") }}
          </router-link>
        </div>
      </div>

      <!-- Form State -->
      <form v-else class="mt-8 space-y-6" @submit.prevent="handleSubmit">
        <div class="space-y-4">
          <!-- Instructions -->
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div class="flex items-start">
              <Info class="w-5 h-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <p class="text-sm text-blue-800">
                  {{ t("auth.forgotPasswordInstruction") }}
                </p>
              </div>
            </div>
          </div>

          <!-- Email Input -->
          <div>
            <label for="email" class="form-label">{{ t("auth.email") }}</label>
            <input
              id="email"
              v-model="form.email"
              type="email"
              required
              autocomplete="email"
              class="form-input"
              :class="{ 'border-red-500': emailError }"
              :placeholder="t('auth.enterEmail')"
              :disabled="isLoading"
            />
            <p v-if="emailError" class="mt-1 text-sm text-red-600">
              {{ emailError }}
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
        <div class="space-y-4">
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
              {{ t("auth.sending") }}
            </span>
            <span v-else>{{ t("auth.sendResetEmail") }}</span>
          </button>

          <!-- Back to Login -->
          <div class="text-center">
            <router-link
              to="/login"
              class="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              {{ t("auth.backToLogin") }}
            </router-link>
          </div>
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
import { ref, reactive } from "vue";
import { useI18n } from "@/i18n";
import { CheckCircle, AlertCircle, Info } from "lucide-vue-next";
import { api } from "@/services/api";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const { t } = useI18n();

type ForgotPasswordResponse = {
  success: boolean;
  message?: string;
  error?: { code?: string; message?: string };
};

const passwordResetCodeKeys = {
  RESET_REQUEST_THROTTLED: "auth.resetRequestThrottled",
};

const isLoading = ref(false);
const success = ref(false);
const error = ref("");
const emailError = ref("");

const form = reactive({
  email: "",
});

const validateForm = () => {
  emailError.value = "";

  if (!form.email.trim()) {
    emailError.value = t("auth.emailRequired");
    return false;
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(form.email)) {
    emailError.value = t("auth.invalidEmail");
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
    // This auth endpoint returns a bare object (not the { success, data }
    // envelope), so use the raw axios instance whose response.data is the
    // payload type directly.
    const response = await api.instance.post<ForgotPasswordResponse>(
      "/auth/forgot-password",
      {
        identifier: form.email,
        method: "email",
      },
      {
        validateStatus: () => true,
      },
    );
    const data = response.data;

    if (data.success) {
      // The success copy is all local (auth.emailSent / emailSentMessage).
      // data.message is the API's untranslated English, so it is not shown.
      success.value = true;
    } else {
      error.value = resolveUserFacingError(
        { response: { status: response.status, data } },
        t,
        {
          codeKeys: passwordResetCodeKeys,
          fallbackKey: "auth.sendFailed",
        },
      ).message;
    }
  } catch (err) {
    console.error("Forgot password error:", err);
    error.value = t("auth.networkError");
  } finally {
    isLoading.value = false;
  }
};
</script>
