<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useOnboardingStore } from "@/stores/onboarding";
import {
  CheckCircleIcon,
  EnvelopeIcon,
  ClockIcon,
  DocumentDuplicateIcon,
} from "@heroicons/vue/24/outline";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import {
  getApplicationSecretFromHash,
  getApplicationStatusPath,
} from "@/utils/application-status";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const toast = useToast();
const store = useOnboardingStore();
const statusPath = computed(() => {
  const secret = getApplicationSecretFromHash(route.hash);
  return store.applicationId && secret
    ? getApplicationStatusPath(store.applicationId, secret)
    : null;
});
const statusUrl = computed(() =>
  statusPath.value ? `${window.location.origin}${statusPath.value}` : null,
);

// Redirect if no submitted application data
onMounted(() => {
  if (!store.applicationId) {
    router.push("/apply");
  }
});

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success(t("common.toast.copiedToClipboard"));
};

const planLabels = computed<Record<string, string>>(() => ({
  trial: t("plans.trial"),
  standard: t("plans.standard"),
  professional: t("plans.professional"),
  enterprise: t("plans.enterprise"),
}));

const getPlanLabel = (planId: string) => {
  return planLabels.value[planId] || planLabels.value.trial;
};

const handleStartNew = () => {
  store.reset();
  router.push("/");
};
</script>

<template>
  <div class="max-w-2xl mx-auto text-center" data-testid="onboarding-success">
    <!-- Progress -->
    <div class="flex items-center justify-center mb-8">
      <div class="flex items-center">
        <div
          class="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center font-medium"
        >
          ✓
        </div>
        <div class="w-24 h-1 bg-primary-600" />
        <div
          class="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center font-medium"
        >
          ✓
        </div>
      </div>
    </div>

    <!-- Success Message -->
    <div class="card">
      <div
        class="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6"
      >
        <CheckCircleIcon class="h-10 w-10 text-green-600" />
      </div>

      <h1 class="text-2xl font-bold text-gray-900 mb-2">
        {{ t("success.title") }}
      </h1>
      <p class="text-gray-600 mb-8">
        {{ t("success.subtitleLine1") }}<br />
        {{ t("success.subtitleLine2") }}
      </p>

      <!-- 申請摘要 -->
      <div class="bg-gray-50 rounded-lg p-6 text-left mb-8">
        <h3 class="font-medium text-gray-900 mb-4">
          {{ t("success.summary.title") }}
        </h3>
        <dl class="space-y-3 text-sm">
          <div class="flex justify-between items-center">
            <dt class="text-gray-500">
              {{ t("success.summary.applicationId") }}
            </dt>
            <dd class="text-gray-900 font-mono text-xs flex items-center">
              {{ store.applicationId || "-" }}
              <button
                v-if="store.applicationId"
                type="button"
                class="ml-2 text-gray-400 hover:text-gray-600"
                @click="copyToClipboard(store.applicationId!)"
              >
                <DocumentDuplicateIcon class="h-4 w-4" />
              </button>
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">
              {{ t("success.summary.businessName") }}
            </dt>
            <dd class="text-gray-900 font-medium">
              {{ store.application?.businessName || "-" }}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">
              {{ t("success.summary.contactEmail") }}
            </dt>
            <dd class="text-gray-900">
              {{ store.application?.contactEmail || "-" }}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">{{ t("success.summary.plan") }}</dt>
            <dd class="text-gray-900">
              {{ getPlanLabel(store.application?.planId || "standard") }}
            </dd>
          </div>
          <div class="flex justify-between items-center">
            <dt class="text-gray-500">{{ t("success.summary.subdomain") }}</dt>
            <dd class="text-gray-900 font-medium flex items-center">
              {{ store.assignedSubdomain || "-" }}.makanmasak.com
              <button
                v-if="store.assignedSubdomain"
                type="button"
                class="ml-2 text-gray-400 hover:text-gray-600"
                @click="
                  copyToClipboard(`${store.assignedSubdomain}.makanmasak.com`)
                "
              >
                <DocumentDuplicateIcon class="h-4 w-4" />
              </button>
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">{{ t("success.summary.status") }}</dt>
            <dd class="text-amber-700 font-medium">
              {{ t("success.summary.pendingReview") }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- 接下來 -->
      <div class="space-y-4 text-left">
        <h3 class="font-medium text-gray-900">
          {{ t("success.nextSteps.title") }}
        </h3>
        <div class="space-y-4">
          <div class="flex items-start">
            <div class="flex-shrink-0 p-2 bg-primary-100 rounded-lg">
              <EnvelopeIcon class="h-5 w-5 text-primary-600" />
            </div>
            <div class="ml-4">
              <p class="font-medium text-gray-900">
                {{ t("success.nextSteps.email.title") }}
              </p>
              <p class="text-sm text-gray-500">
                {{ t("success.nextSteps.email.description") }}
              </p>
            </div>
          </div>
          <div class="flex items-start">
            <div class="flex-shrink-0 p-2 bg-primary-100 rounded-lg">
              <ClockIcon class="h-5 w-5 text-primary-600" />
            </div>
            <div class="ml-4">
              <p class="font-medium text-gray-900">
                {{ t("success.nextSteps.deploy.title") }}
              </p>
              <p class="text-sm text-gray-500">
                {{ t("success.nextSteps.deploy.description") }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="statusUrl"
        class="mt-8 rounded-lg border border-primary-200 bg-primary-50 p-4 text-left"
        data-testid="onboarding-status-link"
      >
        <p class="text-sm font-medium text-gray-900">
          {{ t("success.statusLink.savePrompt") }}
        </p>
        <p class="mt-2 break-all font-mono text-xs text-gray-700">
          {{ statusUrl }}
        </p>
        <button
          type="button"
          class="btn btn-secondary mt-3"
          data-testid="copy-onboarding-status-link"
          @click="copyToClipboard(statusUrl)"
        >
          <DocumentDuplicateIcon class="mr-2 h-4 w-4" />
          {{ t("success.statusLink.copy") }}
        </button>
      </div>

      <!-- 按鈕 -->
      <div class="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
        <a v-if="statusPath" :href="statusPath" class="btn btn-primary">
          {{ t("success.button.viewStatus") }}
        </a>
        <button type="button" class="btn btn-secondary" @click="handleStartNew">
          {{ t("success.button.backHome") }}
        </button>
      </div>
    </div>

    <!-- 聯絡資訊 -->
    <div class="mt-6 text-sm text-gray-500">
      {{ t("success.contact.prompt") }}
      <a
        href="mailto:support@makanmasak.com"
        class="text-primary-600 hover:underline"
      >
        support@makanmasak.com
      </a>
    </div>
  </div>
</template>
