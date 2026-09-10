<template>
  <div class="min-h-screen bg-ios-bg py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full mx-auto space-y-8">
      <div class="text-center">
        <div
          class="mx-auto w-16 h-16 bg-ios-blue rounded-2xl flex items-center justify-center mb-4 shadow-[0_4px_16px_rgba(0,122,255,0.24)]"
        >
          <span class="text-white font-bold text-2xl">M</span>
        </div>
        <h2 class="text-3xl font-bold text-ios-text">
          {{ t("auth.forgotPasswordTitle") }}
        </h2>
      </div>

      <div
        class="bg-ios-card rounded-3xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] p-8"
      >
        <!-- 手機門號沒有信箱可查，改在原地收驗證碼 -->
        <div v-if="otpPhone" data-testid="otp-panel" class="space-y-5">
          <div
            class="w-12 h-12 rounded-full bg-ios-blue/10 flex items-center justify-center"
          >
            <svg
              class="w-6 h-6 text-ios-blue"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 01-11.6 7.15L3 21l1.85-6.4A8 8 0 1121 12z"
              />
            </svg>
          </div>
          <!-- 與 Email 版同樣是「若該帳號存在」句型，不透露門號是否註冊過 -->
          <p class="text-sm text-ios-secondary">
            {{ t("auth.forgotPasswordOtpSent") }}
          </p>

          <form class="space-y-5" @submit.prevent="handleVerifyOtp">
            <div>
              <label
                for="otp"
                class="block text-sm font-medium text-ios-text mb-2"
              >
                {{ t("auth.otp") }}
              </label>
              <input
                id="otp"
                v-model="otp"
                type="text"
                inputmode="numeric"
                maxlength="6"
                required
                autocomplete="one-time-code"
                data-testid="otp-input"
                class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
                :placeholder="t('auth.otpPlaceholder')"
              />
              <p
                v-if="otpError"
                data-testid="otp-error"
                class="mt-2 text-sm text-ios-red"
              >
                {{ otpError }}
              </p>
              <p v-else class="mt-2 text-sm text-ios-secondary">
                {{ t("auth.forgotPasswordOtpHint") }}
              </p>
              <component
                :is="DevOtpEcho"
                v-if="DevOtpEcho && otpEcho"
                :otp="otpEcho"
              />
            </div>

            <button
              type="submit"
              :disabled="isLoading"
              data-testid="verify-otp-button"
              class="w-full bg-ios-blue text-white py-3.5 px-4 rounded-full font-semibold shadow-[0_4px_16px_rgba(0,122,255,0.24)] transition-all duration-200 ease-out hover:bg-ios-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{
                isLoading
                  ? t("common.loading")
                  : t("auth.forgotPasswordVerifyOtp")
              }}
            </button>
          </form>
        </div>

        <!-- 送出後的答覆對「帳號存在」與否完全一致，前端不得再細分 -->
        <div v-else-if="sent" data-testid="sent-panel">
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
          <p class="text-sm text-ios-secondary">
            {{ t("auth.forgotPasswordSent") }}
          </p>
        </div>

        <form v-else class="space-y-5" @submit.prevent="handleSubmit">
          <p class="text-sm text-ios-secondary">
            {{ t("auth.forgotPasswordHint") }}
          </p>

          <div>
            <label
              for="identifier"
              class="block text-sm font-medium text-ios-text mb-2"
            >
              {{ t("auth.identifier") }}
            </label>
            <input
              id="identifier"
              v-model="identifier"
              type="text"
              required
              autocomplete="username"
              data-testid="identifier-input"
              class="w-full px-4 py-3 bg-ios-bg rounded-2xl text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
              :placeholder="t('auth.identifierPlaceholder')"
            />
            <p v-if="fieldError" class="mt-2 text-sm text-ios-red">
              {{ fieldError }}
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
              isLoading ? t("common.loading") : t("auth.forgotPasswordSubmit")
            }}
          </button>
        </form>

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
import { defineAsyncComponent, ref } from "vue";
import { useRouter } from "vue-router";
import { customerIdentityApi } from "@/services/customerIdentityApi";
import { useI18n } from "@/composables/useI18n";

const { t } = useI18n();
const router = useRouter();

// The same split the API applies in parseAuthIdentifier: an "@" makes it an
// email, everything else is parsed as a phone number. Keeping the two in step
// is what lets this screen know, before the answer comes back, whether the
// diner is about to receive a mail link or an SMS code — the response itself
// says only `{ sent: true }`, deliberately, for both.
const isEmailIdentifier = (value: string): boolean => value.includes("@");

const errorCode = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

// Dev-only echo of the code the local no-op SMS provider never sends.
const DevOtpEcho = import.meta.env.DEV
  ? defineAsyncComponent(() => import("@/components/DevOtpEcho.vue"))
  : null;

const identifier = ref("");
const isLoading = ref(false);
const sent = ref(false);
/** Non-empty once a reset code has been requested for this phone number. */
const otpPhone = ref("");
const otp = ref("");
const otpEcho = ref("");
const error = ref("");
const fieldError = ref("");
const otpError = ref("");

const handleSubmit = async () => {
  error.value = "";
  fieldError.value = "";

  const trimmed = identifier.value.trim();
  if (!trimmed) {
    fieldError.value = t("auth.identifierRequired");
    return;
  }

  isLoading.value = true;

  try {
    const result = await customerIdentityApi.forgotPassword(trimmed);
    if (isEmailIdentifier(trimmed)) {
      sent.value = true;
    } else {
      // A phone account has no inbox to send anyone to: the code arrives by
      // SMS and is entered here (#353).
      otpPhone.value = trimmed;
      if (import.meta.env.DEV) {
        otpEcho.value = result.devOtp ?? "";
      }
    }
  } catch (err: unknown) {
    void err;
    error.value = t("messages.networkError");
  } finally {
    isLoading.value = false;
  }
};

const handleVerifyOtp = async () => {
  // Everything this step can go wrong with belongs on the code field, so the
  // identifier form's `error` banner is deliberately not reused here.
  otpError.value = "";

  if (!/^\d{6}$/.test(otp.value)) {
    otpError.value = t("auth.otpRequired");
    return;
  }

  isLoading.value = true;

  try {
    const { resetToken } = await customerIdentityApi.verifyPasswordResetOtp(
      otpPhone.value,
      otp.value,
    );
    // Hands over to ResetPasswordView, which reads the token from the query
    // exactly as it does for the emailed link.
    router.push({ path: "/reset-password", query: { token: resetToken } });
  } catch (err: unknown) {
    // A rejected code is this endpoint's answer, not a transport failure. The
    // diner stays on the code field and types the next one; sending them back
    // to the identifier step would cost them another SMS.
    otpError.value =
      errorCode(err) === "INVALID_OTP"
        ? t("auth.forgotPasswordOtpInvalid")
        : t("messages.networkError");
  } finally {
    isLoading.value = false;
  }
};
</script>
