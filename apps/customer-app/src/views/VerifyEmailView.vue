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
          {{ t("auth.verifyEmailTitle") }}
        </h2>
      </div>

      <div
        role="status"
        aria-live="polite"
        class="bg-ios-card rounded-3xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] p-8 text-center"
      >
        <div v-if="state === 'pending'" data-testid="pending-panel">
          <span
            class="mx-auto block animate-spin rounded-full h-8 w-8 border-2 border-ios-blue border-t-transparent"
          />
          <p class="mt-4 text-sm text-ios-secondary">
            {{ t("auth.verifyEmailPending") }}
          </p>
        </div>

        <div v-else-if="state === 'verified'" data-testid="verified-panel">
          <div
            class="mx-auto w-12 h-12 rounded-full bg-ios-green/10 flex items-center justify-center mb-4"
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
            {{ t("auth.verifyEmailSuccess") }}
          </p>
        </div>

        <div v-else data-testid="failed-panel" role="alert">
          <div
            class="mx-auto w-12 h-12 rounded-full bg-ios-red/10 flex items-center justify-center mb-4"
          >
            <svg
              class="w-6 h-6 text-ios-red"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p class="text-sm text-ios-red">{{ error }}</p>
        </div>

        <router-link
          v-if="state !== 'pending'"
          to="/login?mode=password"
          data-testid="go-to-login"
          class="mt-6 block w-full bg-ios-blue text-white py-3.5 px-4 rounded-full font-semibold shadow-[0_4px_16px_rgba(0,122,255,0.24)] transition-all duration-200 ease-out hover:bg-ios-blue/90"
        >
          {{ t("auth.goToLogin") }}
        </router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { customerIdentityApi } from "@/services/customerIdentityApi";
import { useI18n } from "@/composables/useI18n";

const route = useRoute();
const { t } = useI18n();

const state = ref<"pending" | "verified" | "failed">("pending");
const error = ref("");

// The verification mail links to /verify-email?token=… — that query string is
// the only place the token ever exists.
const readToken = (): string => {
  const raw = route.query.token;
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : "";
  return typeof raw === "string" ? raw : "";
};

onMounted(async () => {
  const token = readToken();

  if (!token) {
    error.value = t("auth.linkTokenMissing");
    state.value = "failed";
    return;
  }

  try {
    await customerIdentityApi.verifyEmail(token);
    state.value = "verified";
  } catch (err: unknown) {
    void err;
    error.value = t("messages.networkError");
    state.value = "failed";
  }
});
</script>
