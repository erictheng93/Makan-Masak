<template>
  <div class="space-y-6">
    <div
      class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
    >
      <div>
        <h1 class="text-2xl font-bold text-gray-900">店家加入申請</h1>
        <p class="mt-1 text-sm text-gray-500">
          審核自助開店申請，核准後由平台資源啟用租戶。
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="statusFilter"
          data-testid="onboarding-status-filter"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          @change="loadApplications"
        >
          <option value="">全部狀態</option>
          <option value="submitted">待審核</option>
          <option value="provisioning">建置中</option>
          <option value="completed">已完成</option>
          <option value="rejected">已拒絕</option>
        </select>
        <button
          type="button"
          data-testid="refresh-onboarding-applications"
          class="w-fit rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          :disabled="isLoading"
          @click="loadApplications"
        >
          {{ isLoading ? "讀取中..." : "重新整理" }}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-lg bg-white p-4 shadow-ios-card">
        <div class="text-sm font-medium text-gray-500">申請總數</div>
        <div class="mt-1 text-2xl font-bold text-gray-900">{{ total }}</div>
      </div>
      <div class="rounded-lg bg-white p-4 shadow-ios-card">
        <div class="text-sm font-medium text-gray-500">待審核</div>
        <div
          data-testid="approvable-count"
          class="mt-1 text-2xl font-bold text-emerald-700"
        >
          {{ approvableCount }}
        </div>
      </div>
      <div class="rounded-lg bg-white p-4 shadow-ios-card">
        <div class="text-sm font-medium text-gray-500">已拒絕</div>
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
      class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </p>

    <section
      v-if="ownerHandoff"
      data-testid="approved-owner-account"
      class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"
    >
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div>
          <h2 class="font-semibold">
            {{ ownerHandoff.businessName }}：店主開通資訊
          </h2>
          <p class="mt-1 text-emerald-800">
            系統目前不寄信。請把帳號與設定密碼連結交給店主；連結 24
            小時內有效，使用一次後即失效。
          </p>
        </div>
        <button
          type="button"
          data-testid="dismiss-approved-owner-account"
          class="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
          @click="closeOwnerHandoff"
        >
          關閉
        </button>
      </div>

      <p
        v-if="!ownerHandoff.account"
        data-testid="owner-handoff-unavailable"
        class="mt-4 rounded-lg bg-white px-3 py-2 text-amber-800"
      >
        查無可用的設定密碼連結，店主可能已經設定過密碼。若店主無法登入，請切換到這家店，在「員工管理」替店主重設密碼。
      </p>

      <template v-else>
        <p
          v-if="isLinkExpired"
          data-testid="owner-link-expired"
          class="mt-4 rounded-lg bg-white px-3 py-2 text-amber-800"
        >
          這條設定密碼連結已過期，店主無法再使用。請切換到這家店，在「員工管理」替店主重設密碼。
        </p>

        <dl class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-xs font-medium text-emerald-700">帳號</dt>
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
                class="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                @click="copyField('username', ownerHandoff.account.username)"
              >
                {{ copiedField === "username" ? "已複製" : "複製" }}
              </button>
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-emerald-700">有效期限</dt>
            <dd
              data-testid="owner-handoff-expires-at"
              class="mt-1 break-all font-mono text-sm"
            >
              {{ formatDate(ownerHandoff.account.setupPasswordExpiresAt) }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-xs font-medium text-emerald-700">設定密碼連結</dt>
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
                class="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                :disabled="isLinkExpired"
                @click="
                  copyField('link', ownerHandoff.account.setupPasswordLink)
                "
              >
                {{ copiedField === "link" ? "已複製" : "複製" }}
              </button>
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-xs font-medium text-emerald-700">餐廳 / 使用者</dt>
            <dd class="mt-1 break-all font-mono text-sm">
              {{ ownerHandoff.account.restaurantId }} /
              {{ ownerHandoff.account.userId }}
            </dd>
          </div>
        </dl>
      </template>
    </section>

    <div
      v-if="isLoading"
      class="flex items-center justify-center rounded-lg bg-white py-12 text-gray-500 shadow-ios-card"
    >
      <div
        class="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600"
      />
    </div>

    <div
      v-else-if="applications.length === 0"
      data-testid="onboarding-empty"
      class="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500"
    >
      目前沒有符合條件的申請。
    </div>

    <div v-else class="overflow-hidden rounded-lg bg-white shadow-ios-card">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              店家
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              聯絡人
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              方案 / 網域
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              狀態
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              送出時間
            </th>
            <th
              class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              操作
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
            <td class="px-4 py-4 text-sm text-gray-700">
              <div>{{ application.contactName }}</div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ application.contactEmail }}
              </div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ application.contactPhone }}
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
              <div class="flex justify-end gap-2">
                <button
                  v-if="application.status === 'completed'"
                  type="button"
                  :data-testid="`owner-handoff-${application.id}`"
                  class="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  :disabled="actionId === application.id"
                  @click="showOwnerHandoff(application)"
                >
                  開通資訊
                </button>
                <button
                  type="button"
                  :data-testid="`approve-onboarding-${application.id}`"
                  class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  :disabled="
                    actionId === application.id ||
                    !isApprovableStatus(application.status)
                  "
                  @click="approveApplication(application)"
                >
                  核准
                </button>
                <button
                  type="button"
                  :data-testid="`reject-onboarding-${application.id}`"
                  class="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                  :disabled="
                    actionId === application.id ||
                    ['completed', 'provisioning'].includes(application.status)
                  "
                  @click="rejectApplication(application.id)"
                >
                  拒絕
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  onboardingApplicationsService,
  type OnboardingApplication,
  type OnboardingApplicationStatus,
  type ProvisionedOwnerAccount,
} from "@/services/onboardingApplicationsService";
import { useDateFormatter } from "@/composables/useDateFormatter";

const { formatDateTime } = useDateFormatter();

interface OwnerHandoff {
  applicationId: string;
  businessName: string;
  /** null when the server has no unused setup link left for this owner. */
  account: ProvisionedOwnerAccount | null;
}

type CopyableField = "username" | "link";

const statusFilter = ref<"" | OnboardingApplicationStatus>("submitted");
const applications = ref<OnboardingApplication[]>([]);
const total = ref(0);
const isLoading = ref(false);
const actionId = ref("");
const error = ref("");
const ownerHandoff = ref<OwnerHandoff | null>(null);
const copiedField = ref<"" | CopyableField>("");
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
    error.value = "店家加入申請暫時無法載入。";
  } finally {
    isLoading.value = false;
  }
}

function openOwnerHandoff(
  application: OnboardingApplication,
  account: ProvisionedOwnerAccount | undefined,
) {
  copiedField.value = "";
  ownerHandoff.value = {
    applicationId: application.id,
    businessName: application.businessName,
    account: account ?? null,
  };
}

function closeOwnerHandoff() {
  ownerHandoff.value = null;
  copiedField.value = "";
}

async function approveApplication(application: OnboardingApplication) {
  actionId.value = application.id;
  error.value = "";
  try {
    const result = await onboardingApplicationsService.approve(application.id);
    openOwnerHandoff(application, result.ownerAccount);
    await loadApplications();
  } catch (approveError) {
    console.error("Failed to approve onboarding application:", approveError);
    error.value = "核准失敗。請確認申請狀態仍可核准。";
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
    openOwnerHandoff(application, result.ownerAccount);
  } catch (handoffError) {
    console.error("Failed to load onboarding owner handoff:", handoffError);
    error.value = "無法取得開通資訊，請稍後再試。";
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
    error.value = "無法複製到剪貼簿，請手動選取文字複製。";
  }
}

async function rejectApplication(applicationId: string) {
  actionId.value = applicationId;
  error.value = "";
  try {
    await onboardingApplicationsService.reject(applicationId);
    await loadApplications();
  } catch (rejectError) {
    console.error("Failed to reject onboarding application:", rejectError);
    error.value = "拒絕申請失敗，請稍後再試。";
  } finally {
    actionId.value = "";
  }
}

function isApprovableStatus(status: OnboardingApplicationStatus) {
  return status === "submitted";
}

function statusLabel(status: OnboardingApplicationStatus) {
  return (
    {
      submitted: "待審核",
      provisioning: "建置中",
      completed: "已完成",
      rejected: "已拒絕",
    } satisfies Record<OnboardingApplicationStatus, string>
  )[status];
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
      trial: "試用",
      standard: "Standard",
      professional: "Professional",
      enterprise: "Enterprise",
    }[planId ?? "trial"] ?? "試用"
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
