<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowPathIcon, CheckCircleIcon } from "@heroicons/vue/24/outline";
import {
  ApiError,
  onboardingApi,
  type ApplicationDetails,
} from "@/services/api";
import { useI18n } from "@/i18n";
import { getApplicationSecretFromHash } from "@/utils/application-status";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const application = ref<ApplicationDetails | null>(null);
const error = ref<string | null>(null);
const isLoading = ref(false);

const applicationId = computed(() => String(route.params.applicationId || ""));
const applicationSecret = computed(() =>
  getApplicationSecretFromHash(route.hash),
);
const statusLabel = computed(() => {
  const status = application.value?.status || "submitted";
  return t(`status.labels.${status}`);
});

async function refresh() {
  if (!applicationId.value || !applicationSecret.value) {
    error.value = t("status.error.missingLink");
    return;
  }

  isLoading.value = true;
  error.value = null;
  try {
    application.value = await onboardingApi.getApplication(
      applicationId.value,
      applicationSecret.value,
    );
  } catch (caught) {
    error.value =
      caught instanceof ApiError &&
      caught.code === "APPLICATION_SECRET_REQUIRED"
        ? t("status.error.invalidLink")
        : t("status.error.unavailable");
  } finally {
    isLoading.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <div class="mx-auto max-w-2xl" data-testid="onboarding-application-status">
    <div class="card text-center">
      <div
        class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100"
      >
        <CheckCircleIcon class="h-10 w-10 text-primary-700" />
      </div>
      <h1 class="mb-2 text-2xl font-bold text-gray-900">
        {{ t("status.title") }}
      </h1>
      <p class="mb-8 text-gray-600">{{ t("status.subtitle") }}</p>

      <div v-if="isLoading" class="py-8 text-sm text-gray-500">
        {{ t("status.loading") }}
      </div>

      <div
        v-else-if="error"
        class="rounded-lg border border-red-200 bg-red-50 p-4 text-left text-sm text-red-700"
        role="alert"
      >
        {{ error }}
      </div>

      <template v-else-if="application">
        <dl class="mb-8 space-y-4 rounded-lg bg-gray-50 p-6 text-left text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">{{ t("status.businessName") }}</dt>
            <dd class="font-medium text-gray-900">
              {{ application.businessName }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">{{ t("status.currentStatus") }}</dt>
            <dd class="font-medium text-primary-800">{{ statusLabel }}</dd>
          </div>
          <div
            v-if="
              application.status === 'rejected' && application.rejectionReason
            "
            class="space-y-1"
          >
            <dt class="text-gray-500">{{ t("status.rejectionReason") }}</dt>
            <dd class="text-gray-900">{{ application.rejectionReason }}</dd>
          </div>
        </dl>

        <p class="mb-6 text-sm text-gray-500">{{ t("status.lastUpdated") }}</p>
      </template>

      <div class="flex flex-col justify-center gap-4 sm:flex-row">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="isLoading"
          @click="refresh"
        >
          <ArrowPathIcon
            class="mr-2 h-4 w-4"
            :class="{ 'animate-spin': isLoading }"
          />
          {{ t("status.refresh") }}
        </button>
        <button type="button" class="btn btn-primary" @click="router.push('/')">
          {{ t("status.backHome") }}
        </button>
      </div>
    </div>
  </div>
</template>
