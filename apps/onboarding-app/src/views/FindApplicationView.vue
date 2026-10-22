<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { EnvelopeIcon } from "@heroicons/vue/24/outline";
import { ApiError, onboardingApi } from "@/services/api";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const email = ref("");
const isSending = ref(false);
const sent = ref(false);
const error = ref("");

async function submit() {
  error.value = "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    error.value = t("findApplication.invalidEmail");
    return;
  }
  isSending.value = true;
  try {
    await onboardingApi.requestStatusLink(email.value.trim());
    // The same confirmation whether or not the email applied: the server
    // does not say, and the page must not guess.
    sent.value = true;
  } catch (caught) {
    error.value =
      caught instanceof ApiError && caught.code === "RATE_LIMITED"
        ? t("apply.submitErrors.rateLimited")
        : t("findApplication.failed");
  } finally {
    isSending.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl" data-testid="onboarding-find-application">
    <div class="card">
      <div
        class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100"
      >
        <EnvelopeIcon class="h-9 w-9 text-primary-500" />
      </div>
      <h1 class="mb-2 text-center text-2xl font-bold text-gray-900">
        {{ t("findApplication.title") }}
      </h1>

      <p
        v-if="sent"
        class="mb-6 text-center text-gray-700"
        role="status"
        data-testid="find-application-sent"
      >
        {{ t("findApplication.sent") }}
      </p>

      <form v-else class="space-y-4" novalidate @submit.prevent="submit">
        <p class="text-center text-gray-600">
          {{ t("findApplication.subtitle") }}
        </p>
        <div>
          <label
            for="find-application-email"
            class="mb-1 block text-sm font-medium text-gray-700"
          >
            {{ t("findApplication.emailLabel") }}
          </label>
          <input
            id="find-application-email"
            v-model="email"
            type="email"
            autocomplete="email"
            class="input"
            data-testid="find-application-email"
            :aria-invalid="error ? 'true' : undefined"
            :aria-describedby="error ? 'find-application-error' : undefined"
          />
          <p
            v-if="error"
            id="find-application-error"
            class="mt-1 text-sm text-red-600"
            role="alert"
          >
            {{ error }}
          </p>
        </div>
        <button
          type="submit"
          class="btn btn-primary w-full"
          :disabled="isSending"
          data-testid="find-application-submit"
        >
          {{
            isSending
              ? t("findApplication.submitting")
              : t("findApplication.submit")
          }}
        </button>
      </form>

      <div class="mt-6 text-center">
        <RouterLink to="/" class="text-sm font-medium text-primary-700">
          {{ t("findApplication.backHome") }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>
