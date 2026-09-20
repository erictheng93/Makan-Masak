<template>
  <div class="space-y-6">
    <div
      class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
    >
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          {{ t("platformOnboarding.title") }}
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          {{ t("platformOnboarding.subtitle") }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="statusFilter"
          data-testid="onboarding-status-filter"
          class="rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-primary-500/20"
          @change="loadApplications"
        >
          <option value="">{{ t("platformOnboarding.filter.all") }}</option>
          <option value="submitted">
            {{ t("platformOnboarding.status.submitted") }}
          </option>
          <option value="provisioning">
            {{ t("platformOnboarding.status.provisioning") }}
          </option>
          <option value="completed">
            {{ t("platformOnboarding.status.completed") }}
          </option>
          <option value="rejected">
            {{ t("platformOnboarding.status.rejected") }}
          </option>
        </select>
        <button
          type="button"
          data-testid="refresh-onboarding-applications"
          class="w-fit rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          :disabled="isLoading"
          @click="loadApplications"
        >
          {{
            isLoading
              ? t("platformOnboarding.loading")
              : t("platformOnboarding.refresh")
          }}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-2xl bg-white p-4 shadow-ios-card">
        <div class="text-sm font-medium text-gray-500">
          {{ t("platformOnboarding.stats.total") }}
        </div>
        <div class="mt-1 text-2xl font-bold text-gray-900">{{ total }}</div>
      </div>
      <div class="rounded-2xl bg-white p-4 shadow-ios-card">
        <div class="text-sm font-medium text-gray-500">
          {{ t("platformOnboarding.stats.pending") }}
        </div>
        <div
          data-testid="approvable-count"
          class="mt-1 text-2xl font-bold text-emerald-700"
        >
          {{ approvableCount }}
        </div>
      </div>
      <div class="rounded-2xl bg-white p-4 shadow-ios-card">
        <div class="text-sm font-medium text-gray-500">
          {{ t("platformOnboarding.stats.rejected") }}
        </div>
        <div
          data-testid="rejected-count"
          class="mt-1 text-2xl font-bold text-amber-700"
        >
          {{ rejectedCount }}
        </div>
      </div>
    </div>

    <p
      v-if="error"
      data-testid="onboarding-error"
      class="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </p>

    <section
      v-if="pendingMarket"
      data-testid="market-approval-pending"
      role="alert"
      class="rounded-2xl bg-orange-50 p-4 text-sm text-orange-800"
    >
      <p>
        {{
          t("platformOnboarding.market.provisionedPending", {
            business: pendingMarket.application.businessName,
          })
        }}
      </p>
      <p class="mt-2">
        {{
          t(
            pendingMarket.errorCode === "MARKET_VENDOR_CURRENCY_MISMATCH"
              ? "platformOnboarding.market.currencyMismatch"
              : "platformOnboarding.market.failed",
          )
        }}
      </p>
      <button
        type="button"
        data-testid="retry-market-approval"
        class="mt-3 min-h-11 rounded-full bg-white px-4 py-2 font-medium disabled:opacity-50"
        :disabled="Boolean(actionId)"
        @click="approveApplication(pendingMarket.application, true)"
      >
        {{ t("platformOnboarding.market.retry") }}
      </button>
    </section>

    <section
      v-if="ownerHandoff"
      data-testid="approved-owner-account"
      class="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950 shadow-ios-card"
    >
      <p data-testid="handoff-location" class="mb-3">
        {{ t("platformOnboarding.market.location") }}:
        {{ locationLabel(ownerHandoff.application) }}
      </p>
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div>
          <h2 class="font-semibold">
            {{
              t("platformOnboarding.handoff.title", {
                business: ownerHandoff.businessName,
              })
            }}
          </h2>
          <p class="mt-1 text-emerald-800">
            {{ t("platformOnboarding.handoff.manualNote") }}
          </p>
        </div>
        <button
          type="button"
          data-testid="dismiss-approved-owner-account"
          class="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
          @click="closeOwnerHandoff"
        >
          {{ t("platformOnboarding.handoff.dismiss") }}
        </button>
      </div>

      <p
        v-if="ownerHandoff.delivery"
        data-testid="owner-handoff-delivery"
        class="mt-4 rounded-2xl bg-white px-3 py-2"
        :class="
          ownerHandoff.delivery.status === 'failed'
            ? 'text-red-700'
            : 'text-emerald-800'
        "
      >
        {{
          t("platformOnboarding.handoff.delivery", {
            channel: deliveryChannelLabel(ownerHandoff.delivery.channel),
            status: deliveryStatusLabel(ownerHandoff.delivery.status),
          })
        }}
        <span v-if="ownerHandoff.delivery.errorMessage" class="break-all">
          — {{ ownerHandoff.delivery.errorMessage }}
        </span>
      </p>

      <p
        v-if="!ownerHandoff.account"
        data-testid="owner-handoff-unavailable"
        class="mt-4 rounded-2xl bg-white px-3 py-2 text-amber-800"
      >
        {{ t("platformOnboarding.handoff.unavailable") }}
      </p>

      <template v-else>
        <p
          v-if="isLinkExpired"
          data-testid="owner-link-expired"
          class="mt-4 rounded-2xl bg-white px-3 py-2 text-amber-800"
        >
          {{ t("platformOnboarding.handoff.expired") }}
        </p>

        <dl class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-xs font-medium text-emerald-700">
              {{ t("platformOnboarding.handoff.username") }}
            </dt>
            <dd class="mt-1 flex items-center gap-2">
              <span
                data-testid="owner-handoff-username"
                class="break-all font-mono text-sm"
              >
                {{ ownerHandoff.account.username }}
              </span>
              <button
                type="button"
                data-testid="copy-owner-username"
                class="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                @click="copyField('username', ownerHandoff.account.username)"
              >
                {{
                  copiedField === "username"
                    ? t("platformOnboarding.handoff.copied")
                    : t("platformOnboarding.handoff.copy")
                }}
              </button>
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-emerald-700">
              {{ t("platformOnboarding.handoff.expiresAt") }}
            </dt>
            <dd
              data-testid="owner-handoff-expires-at"
              class="mt-1 break-all font-mono text-sm"
            >
              {{ formatDate(ownerHandoff.account.setupPasswordExpiresAt) }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-xs font-medium text-emerald-700">
              {{ t("platformOnboarding.handoff.setupLink") }}
            </dt>
            <dd class="mt-1 flex items-start gap-2">
              <span
                data-testid="owner-handoff-setup-link"
                class="break-all font-mono text-sm"
              >
                {{ ownerHandoff.account.setupPasswordLink }}
              </span>
              <button
                type="button"
                data-testid="copy-owner-setup-link"
                class="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                :disabled="isLinkExpired"
                @click="
                  copyField('link', ownerHandoff.account.setupPasswordLink)
                "
              >
                {{
                  copiedField === "link"
                    ? t("platformOnboarding.handoff.copied")
                    : t("platformOnboarding.handoff.copy")
                }}
              </button>
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-xs font-medium text-emerald-700">
              {{ t("platformOnboarding.handoff.ids") }}
            </dt>
            <dd class="mt-1 break-all font-mono text-sm">
              {{ ownerHandoff.account.restaurantId }} /
              {{ ownerHandoff.account.userId }}
            </dd>
          </div>
        </dl>
      </template>

      <!--
        Regenerating rotates the owner's token, so any link already handed over
        stops working. It is offered only when there is nothing usable left to
        hand over, and still asks for confirmation first.
      -->
      <div v-if="canRegenerateSetupLink" class="mt-4">
        <button
          type="button"
          data-testid="regenerate-setup-link"
          class="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          :disabled="actionId === ownerHandoff.applicationId"
          @click="openRegenerateDialog"
        >
          {{
            actionId === ownerHandoff.applicationId
              ? t("platformOnboarding.handoff.regenerating")
              : t("platformOnboarding.handoff.regenerate")
          }}
        </button>
      </div>
    </section>

    <div
      v-if="isLoading"
      class="flex items-center justify-center rounded-2xl bg-white py-12 text-gray-500 shadow-ios-card"
    >
      <div
        class="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600"
      />
    </div>

    <div
      v-else-if="applications.length === 0"
      data-testid="onboarding-empty"
      class="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-ios-card"
    >
      {{ t("platformOnboarding.empty") }}
    </div>

    <div v-else class="overflow-hidden rounded-2xl bg-white shadow-ios-card">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              {{ t("platformOnboarding.table.business") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              {{ t("platformOnboarding.market.location") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              {{ t("platformOnboarding.table.contact") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              {{ t("platformOnboarding.table.planDomain") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              {{ t("platformOnboarding.table.status") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              {{ t("platformOnboarding.table.submittedAt") }}
            </th>
            <th
              class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              {{ t("platformOnboarding.table.actions") }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white">
          <tr v-for="application in applications" :key="application.id">
            <td class="px-4 py-4">
              <div class="font-medium text-gray-900">
                {{ application.businessName }}
              </div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ application.id }}
              </div>
              <div
                v-if="application.latitude && application.longitude"
                class="mt-1 text-xs text-gray-500"
              >
                {{ application.latitude.toFixed(5) }},
                {{ application.longitude.toFixed(5) }}
              </div>
            </td>
            <td
              data-testid="application-location"
              class="px-4 py-4 text-sm text-gray-700"
            >
              {{ locationLabel(application) }}
            </td>
            <td class="px-4 py-4 text-sm text-gray-700">
              <div>{{ application.contactName }}</div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ application.contactEmail }}
              </div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ application.contactPhone }}
              </div>
              <div
                v-if="application.rejectionReason"
                data-testid="onboarding-rejection-reason"
                class="mt-1 text-xs text-red-700"
              >
                {{
                  t("platformOnboarding.rejectionReason", {
                    reason: application.rejectionReason,
                  })
                }}
              </div>
            </td>
            <td class="px-4 py-4 text-sm text-gray-700">
              <div>{{ planLabel(application.planId) }}</div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ application.assignedSubdomain || "-" }}
              </div>
            </td>
            <td class="px-4 py-4">
              <span
                class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                :class="statusClass(application.status)"
              >
                {{ statusLabel(application.status) }}
              </span>
            </td>
            <td class="px-4 py-4 text-sm text-gray-700">
              {{ formatDate(application.createdAt) }}
            </td>
            <td class="px-4 py-4 text-right">
              <label
                v-if="
                  application.marketId && isApprovableStatus(application.status)
                "
                class="mb-2 flex min-h-11 items-center justify-end gap-2 text-sm text-gray-700"
              >
                <input
                  :data-testid="`approve-market-membership-${application.id}`"
                  type="checkbox"
                  :checked="marketChoices[application.id] !== false"
                  @change="
                    marketChoices[application.id] = (
                      $event.target as HTMLInputElement
                    ).checked
                  "
                />
                {{ t("platformOnboarding.market.approveTogether") }}
              </label>
              <div class="flex justify-end gap-2">
                <button
                  v-if="
                    application.marketId && application.status === 'completed'
                  "
                  type="button"
                  :data-testid="`approve-completed-market-${application.id}`"
                  class="min-h-11 rounded-full bg-orange-50 px-4 py-2 text-sm font-medium text-orange-800 disabled:opacity-50"
                  :disabled="Boolean(actionId)"
                  @click="approveApplication(application, true)"
                >
                  {{ t("platformOnboarding.market.retry") }}
                </button>
                <button
                  v-if="application.status === 'completed'"
                  type="button"
                  :data-testid="`owner-handoff-${application.id}`"
                  class="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  :disabled="actionId === application.id"
                  @click="showOwnerHandoff(application)"
                >
                  {{ t("platformOnboarding.actions.handoff") }}
                </button>
                <button
                  type="button"
                  :data-testid="`approve-onboarding-${application.id}`"
                  class="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  :disabled="
                    actionId === application.id ||
                    !isApprovableStatus(application.status)
                  "
                  @click="approveApplication(application)"
                >
                  {{ t("platformOnboarding.actions.approve") }}
                </button>
                <button
                  type="button"
                  :data-testid="`reject-onboarding-${application.id}`"
                  class="rounded-full bg-red-50 px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                  :disabled="
                    actionId === application.id ||
                    ['completed', 'provisioning', 'rejected'].includes(
                      application.status,
                    )
                  "
                  @click="openRejectDialog(application.id)"
                >
                  {{ t("platformOnboarding.actions.reject") }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="rejectingApplicationId"
      class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-application-title"
    >
      <form
        class="w-full max-w-md rounded-2xl bg-white p-6 shadow-ios-card"
        @submit.prevent="rejectApplication"
      >
        <h2
          id="reject-application-title"
          class="text-lg font-semibold text-gray-900"
        >
          {{ t("platformOnboarding.reject.title") }}
        </h2>
        <p class="mt-1 text-sm text-gray-600">
          {{ t("platformOnboarding.reject.description") }}
        </p>
        <label
          for="onboarding-rejection-reason"
          class="mt-4 block text-sm font-medium text-gray-700"
        >
          {{ t("platformOnboarding.reject.reasonLabel") }}
        </label>
        <textarea
          id="onboarding-rejection-reason"
          v-model="rejectionReason"
          data-testid="onboarding-rejection-reason-input"
          required
          minlength="2"
          maxlength="500"
          rows="3"
          class="mt-1 w-full rounded-2xl bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500/20"
        />
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            @click="closeRejectDialog"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="submit"
            data-testid="confirm-reject-onboarding"
            class="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="rejectionReason.trim().length < 2 || Boolean(actionId)"
          >
            {{ t("platformOnboarding.reject.confirm") }}
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="isRegenerateDialogOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="regenerate-setup-link-title"
    >
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-ios-card">
        <h2
          id="regenerate-setup-link-title"
          class="text-lg font-semibold text-gray-900"
        >
          {{ t("platformOnboarding.regenerate.title") }}
        </h2>
        <p class="mt-1 text-sm text-gray-600">
          {{ t("platformOnboarding.regenerate.description") }}
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            @click="closeRegenerateDialog"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            data-testid="confirm-regenerate-setup-link"
            class="rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            :disabled="Boolean(actionId)"
            @click="regenerateSetupLink"
          >
            {{ t("platformOnboarding.regenerate.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  onboardingApplicationsService,
  type CredentialDelivery,
  type OnboardingApplication,
  type OnboardingApplicationStatus,
  type ProvisionedOwnerAccount,
} from "@/services/onboardingApplicationsService";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const { formatDateTime } = useDateFormatter();

interface OwnerHandoff {
  applicationId: string;
  application: OnboardingApplication;
  businessName: string;
  /** null when the server has no unused setup link left for this owner. */
  account: ProvisionedOwnerAccount | null;
  /** How the credentials were delivered, so a failed email is visible here. */
  delivery: CredentialDelivery | null;
}

type CopyableField = "username" | "link";

const statusFilter = ref<"" | OnboardingApplicationStatus>("submitted");
const applications = ref<OnboardingApplication[]>([]);
const total = ref(0);
const isLoading = ref(false);
const actionId = ref("");
const error = ref("");
const marketChoices = ref<Record<string, boolean>>({});
const pendingMarket = ref<{
  application: OnboardingApplication;
  errorCode: string;
} | null>(null);

function locationLabel(application: OnboardingApplication) {
  return [
    application.countryCode ?? "—",
    application.city ?? "—",
    application.marketName || application.marketId,
    application.stallNumber
      ? `${t("platformOnboarding.market.stall")} ${application.stallNumber}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
const ownerHandoff = ref<OwnerHandoff | null>(null);
const copiedField = ref<"" | CopyableField>("");
const rejectingApplicationId = ref("");
const rejectionReason = ref("");
const isRegenerateDialogOpen = ref(false);
let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;

const approvableCount = computed(
  () =>
    applications.value.filter((application) =>
      isApprovableStatus(application.status),
    ).length,
);
const rejectedCount = computed(
  () =>
    applications.value.filter(
      (application) => application.status === "rejected",
    ).length,
);

// Evaluated when the panel opens, not ticking: the link lives for 24 hours, so
// a panel left open across expiry is not worth a timer.
const isLinkExpired = computed(() => {
  const expiresAt = ownerHandoff.value?.account?.setupPasswordExpiresAt;
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
});

const canRegenerateSetupLink = computed(
  () =>
    Boolean(ownerHandoff.value) &&
    (!ownerHandoff.value?.account || isLinkExpired.value),
);

async function loadApplications() {
  isLoading.value = true;
  error.value = "";
  try {
    const result = await onboardingApplicationsService.list({
      status: statusFilter.value || undefined,
      limit: 50,
    });
    applications.value = result.applications;
    total.value = result.total;
  } catch (loadError) {
    console.error("Failed to load onboarding applications:", loadError);
    error.value = t("platformOnboarding.errors.load");
  } finally {
    isLoading.value = false;
  }
}

function openOwnerHandoff(
  application: OnboardingApplication,
  account: ProvisionedOwnerAccount | undefined,
  delivery: CredentialDelivery | undefined,
) {
  copiedField.value = "";
  ownerHandoff.value = {
    applicationId: application.id,
    application,
    businessName: application.businessName,
    account: account ?? null,
    delivery: delivery ?? null,
  };
}

function closeOwnerHandoff() {
  ownerHandoff.value = null;
  copiedField.value = "";
}

async function approveApplication(
  application: OnboardingApplication,
  retryMarket = false,
) {
  actionId.value = application.id;
  error.value = "";
  try {
    const result = application.marketId
      ? await onboardingApplicationsService.approve(application.id, {
          approveMarketMembership:
            retryMarket || marketChoices.value[application.id] !== false,
        })
      : await onboardingApplicationsService.approve(application.id);
    pendingMarket.value =
      result.marketApproval?.status === "pending"
        ? {
            application: { ...application, status: "completed" },
            errorCode: result.marketApproval.errorCode,
          }
        : null;
    openOwnerHandoff(
      application,
      result.ownerAccount,
      result.credentialDelivery,
    );
    await loadApplications();
  } catch (approveError) {
    console.error("Failed to approve onboarding application:", approveError);
    error.value = t("platformOnboarding.errors.approve");
  } finally {
    actionId.value = "";
  }
}

/**
 * Approving a completed application is idempotent on the server: it returns
 * the owner account that was already provisioned instead of creating another.
 * That is what lets the handoff panel be reopened after it was dismissed.
 */
async function showOwnerHandoff(application: OnboardingApplication) {
  actionId.value = application.id;
  error.value = "";
  try {
    const result = await onboardingApplicationsService.approve(application.id);
    openOwnerHandoff(
      application,
      result.ownerAccount,
      result.credentialDelivery,
    );
  } catch (handoffError) {
    console.error("Failed to load onboarding owner handoff:", handoffError);
    error.value = t("platformOnboarding.errors.handoff");
  } finally {
    actionId.value = "";
  }
}

async function copyField(field: CopyableField, value: string) {
  try {
    if (!navigator.clipboard) {
      throw new Error("Clipboard API is unavailable");
    }
    await navigator.clipboard.writeText(value);
    copiedField.value = field;
    clearTimeout(copiedResetTimer);
    copiedResetTimer = setTimeout(() => {
      copiedField.value = "";
    }, 2000);
  } catch (copyError) {
    console.error("Failed to copy onboarding handoff field:", copyError);
    error.value = t("platformOnboarding.errors.copy");
  }
}

function openRejectDialog(applicationId: string) {
  rejectingApplicationId.value = applicationId;
  rejectionReason.value = "";
}

function closeRejectDialog() {
  rejectingApplicationId.value = "";
  rejectionReason.value = "";
}

async function rejectApplication() {
  const applicationId = rejectingApplicationId.value;
  const reason = rejectionReason.value.trim();
  if (!applicationId || !reason) return;
  actionId.value = applicationId;
  error.value = "";
  try {
    await onboardingApplicationsService.reject(applicationId, reason);
    closeRejectDialog();
    await loadApplications();
  } catch (rejectError) {
    console.error("Failed to reject onboarding application:", rejectError);
    error.value = t("platformOnboarding.errors.reject");
  } finally {
    actionId.value = "";
  }
}

function openRegenerateDialog() {
  isRegenerateDialogOpen.value = true;
}

function closeRegenerateDialog() {
  isRegenerateDialogOpen.value = false;
}

async function regenerateSetupLink() {
  const handoff = ownerHandoff.value;
  if (!handoff) return;
  actionId.value = handoff.applicationId;
  error.value = "";
  try {
    const result = await onboardingApplicationsService.regenerateSetupLink(
      handoff.applicationId,
    );
    ownerHandoff.value = {
      ...handoff,
      account: result.ownerAccount,
      delivery: result.credentialDelivery ?? null,
    };
    copiedField.value = "";
    closeRegenerateDialog();
  } catch (setupLinkError) {
    console.error(
      "Failed to regenerate onboarding setup link:",
      setupLinkError,
    );
    error.value = t("platformOnboarding.errors.regenerate");
  } finally {
    actionId.value = "";
  }
}

function isApprovableStatus(status: OnboardingApplicationStatus) {
  return status === "submitted";
}

function statusLabel(status: OnboardingApplicationStatus) {
  return t(`platformOnboarding.status.${status}`);
}

function deliveryChannelLabel(channel: CredentialDelivery["channel"]) {
  return t(`platformOnboarding.deliveryChannel.${channel}`);
}

function deliveryStatusLabel(status: CredentialDelivery["status"]) {
  return t(`platformOnboarding.deliveryStatus.${status}`);
}

function statusClass(status: OnboardingApplicationStatus) {
  return (
    {
      submitted: "bg-amber-50 text-amber-800",
      provisioning: "bg-blue-50 text-blue-800",
      completed: "bg-gray-100 text-gray-700",
      rejected: "bg-red-50 text-red-700",
    } satisfies Record<OnboardingApplicationStatus, string>
  )[status];
}

function planLabel(planId: OnboardingApplication["planId"]) {
  return (
    {
      trial: t("platformOnboarding.plan.trial"),
      standard: "Standard",
      professional: "Professional",
      enterprise: "Enterprise",
    }[planId ?? "trial"] ?? t("platformOnboarding.plan.trial")
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDateTime(date);
}

onMounted(loadApplications);
onBeforeUnmount(() => clearTimeout(copiedResetTimer));
</script>
