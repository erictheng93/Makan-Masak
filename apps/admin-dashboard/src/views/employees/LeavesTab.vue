<template>
  <div class="space-y-4">
    <!-- Sub-tab navigation -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :data-testid="`leaves-tab-${tab.key}`"
          class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all"
          :class="
            activeTab === tab.key
              ? 'bg-ios-blue text-white shadow-sm'
              : 'bg-ios-bg text-ios-text/60 hover:text-ios-text hover:bg-ios-separator'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <!-- Badge for pending count -->
          <span
            v-if="tab.key === 'queue' && pendingCount > 0"
            class="min-w-[18px] h-[18px] px-1 text-xs font-bold rounded-full flex items-center justify-center"
            :class="
              activeTab === 'queue'
                ? 'bg-white/25 text-white'
                : 'bg-ios-red text-white'
            "
          >
            {{ pendingCount }}
          </span>
        </button>
      </div>
      <!-- Disabled rather than opening a dialog whose type selector would be
           empty. Leave type is required there, so the submit button could
           never enable and the dialog gave no clue why (#307). -->
      <button
        data-testid="leaves-apply"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="leaveTypes.length === 0"
        :title="leaveTypes.length === 0 ? t('leaves.manage.noTypesHint') : ''"
        @click="showRequestDialog = true"
      >
        <Plus class="w-3.5 h-3.5" />
        {{ t("leaves.manage.apply") }}
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <div
        class="w-8 h-8 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
      />
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="bg-ios-red/10 rounded-2xl px-4 py-3 text-sm text-ios-red"
    >
      {{ error }}
      <button
        class="ml-2 underline text-ios-red/70 hover:text-ios-red"
        @click="loadData"
      >
        {{ t("leaves.manage.retry") }}
      </button>
    </div>

    <template v-else>
      <!-- Tab: Approval Queue -->
      <LeaveApprovalQueue
        v-if="activeTab === 'queue'"
        :requests="pendingRequests"
        :balances="balances"
        :team-leaves="allRequests"
        :staffing-threshold="STAFFING_THRESHOLD"
        @approve="handleApprove"
        @reject="handleReject"
      />

      <!-- Tab: All Requests History -->
      <LeaveHistoryList
        v-else-if="activeTab === 'history'"
        :requests="allRequests"
        :leave-types="leaveTypes"
      />

      <!-- Tab: Balance Overview -->
      <LeaveBalanceOverview
        v-else-if="activeTab === 'balance'"
        :balances="balances"
        :employees="employeeList"
        @accrue="handleAccrue"
      />

      <!-- Tab: Leave types. The routes behind this have always existed; with
           nothing calling them a new tenant had no way to create the first
           type, and without one no leave request could be submitted (#307). -->
      <div v-else-if="activeTab === 'types'" class="space-y-4">
        <div
          v-if="leaveTypes.length === 0"
          data-testid="leaves-no-types"
          class="bg-white rounded-2xl shadow-sm px-5 py-6 text-center"
        >
          <p class="text-ios-text font-semibold">
            {{ t("leaves.manage.noTypes") }}
          </p>
          <p class="text-sm text-ios-text/60 mt-1">
            {{ t("leaves.manage.noTypesHint") }}
          </p>
        </div>

        <div
          v-else
          class="bg-white rounded-2xl shadow-sm divide-y divide-ios-separator"
        >
          <div
            v-for="type in leaveTypes"
            :key="type.id"
            data-testid="leave-type-row"
            class="flex items-center justify-between px-5 py-3"
          >
            <div>
              <p class="text-sm font-semibold text-ios-text">
                {{ type.name }}
                <span class="ml-2 text-xs font-normal text-ios-text/40">{{
                  type.code
                }}</span>
              </p>
              <p class="text-xs text-ios-text/60 mt-0.5">
                {{
                  t(`leaves.manage.accrual${accrualLabel(type.accrualType)}`)
                }}
                · {{ type.accrualAmount }}
              </p>
            </div>
            <button
              :data-testid="`leave-type-delete-${type.id}`"
              class="text-xs text-ios-red hover:underline"
              @click="handleDeleteType(type)"
            >
              {{ t("common.delete") }}
            </button>
          </div>
        </div>

        <form
          class="bg-white rounded-2xl shadow-sm px-5 py-4 space-y-3"
          @submit.prevent="handleCreateType"
        >
          <p class="text-sm font-semibold text-ios-text">
            {{ t("leaves.manage.createType") }}
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-ios-text/60 mb-1">{{
                t("leaves.manage.code")
              }}</label>
              <input
                v-model="typeForm.code"
                data-testid="leave-type-code"
                required
                maxlength="20"
                class="w-full px-3 py-2 rounded-xl bg-ios-bg text-sm"
              />
              <p class="text-xs text-ios-text/40 mt-1">
                {{ t("leaves.manage.codeHint") }}
              </p>
            </div>
            <div>
              <label class="block text-xs text-ios-text/60 mb-1">{{
                t("leaves.manage.name")
              }}</label>
              <input
                v-model="typeForm.name"
                data-testid="leave-type-name"
                required
                maxlength="50"
                class="w-full px-3 py-2 rounded-xl bg-ios-bg text-sm"
              />
            </div>
            <div>
              <label class="block text-xs text-ios-text/60 mb-1">{{
                t("leaves.manage.accrualType")
              }}</label>
              <select
                v-model="typeForm.accrualType"
                data-testid="leave-type-accrual"
                class="w-full px-3 py-2 rounded-xl bg-ios-bg text-sm"
              >
                <option value="yearly">
                  {{ t("leaves.manage.accrualYearly") }}
                </option>
                <option value="monthly">
                  {{ t("leaves.manage.accrualMonthly") }}
                </option>
                <option value="none">
                  {{ t("leaves.manage.accrualNone") }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-ios-text/60 mb-1">{{
                t("leaves.manage.accrualAmount")
              }}</label>
              <input
                v-model.number="typeForm.accrualAmount"
                data-testid="leave-type-amount"
                type="number"
                min="0"
                step="0.5"
                class="w-full px-3 py-2 rounded-xl bg-ios-bg text-sm"
              />
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm text-ios-text">
            <input
              v-model="typeForm.requiresApproval"
              data-testid="leave-type-requires-approval"
              type="checkbox"
            />
            {{ t("leaves.manage.requiresApproval") }}
          </label>
          <button
            type="submit"
            data-testid="leave-type-save"
            :disabled="isSavingType"
            class="px-4 py-2 rounded-full text-sm font-semibold bg-ios-blue text-white disabled:opacity-40"
          >
            {{ t("leaves.manage.save") }}
          </button>
        </form>
      </div>
    </template>

    <LeaveRequestDialog
      :is-open="showRequestDialog"
      :leave-types="leaveTypes"
      :balances="myBalances"
      @close="showRequestDialog = false"
      @submit="handleLeaveRequest"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Plus } from "lucide-vue-next";
import { useAuthStore } from "@/stores/auth";
import { t } from "@/i18n";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import { leavesService } from "@/services/leavesService";
import { api as apiClient } from "@/services/api";
import { useEmployeeList } from "@/composables/useEmployeeList";
import LeaveApprovalQueue from "@/components/leaves/LeaveApprovalQueue.vue";
import LeaveHistoryList from "@/components/leaves/LeaveHistoryList.vue";
import LeaveBalanceOverview from "@/components/leaves/LeaveBalanceOverview.vue";
import LeaveRequestDialog from "@/components/leaves/LeaveRequestDialog.vue";
import type { LeaveRequestFormData } from "@/components/leaves/LeaveRequestDialog.vue";
import type {
  LeaveRequest,
  LeaveBalance,
  LeaveType,
} from "@/services/leavesService";

const STAFFING_THRESHOLD = 3;

type TabKey = "queue" | "history" | "balance" | "types";

const tabs = computed<Array<{ key: TabKey; label: string }>>(() => [
  { key: "queue", label: t("leaves.manage.queue") },
  { key: "history", label: t("leaves.manage.history") },
  { key: "balance", label: t("leaves.manage.balance") },
  { key: "types", label: t("leaves.manage.types") },
]);

const authStore = useAuthStore();
const { users, fetchUsers } = useEmployeeList();

const activeTab = ref<TabKey>("queue");
const isLoading = ref(false);
const error = ref<string | null>(null);
const showRequestDialog = ref(false);

const leaveTypes = ref<LeaveType[]>([]);
const balances = ref<LeaveBalance[]>([]);
const allRequests = ref<LeaveRequest[]>([]);

// The dialog always files for the signed-in user, so it must only ever see
// that user's balances -- `balances` holds the whole restaurant's.
const myBalances = computed(() => {
  const me = authStore.user?.id;
  if (!me) return [];
  return balances.value.filter((b) => String(b.employeeId) === String(me));
});

const pendingRequests = computed(() =>
  allRequests.value.filter((r) => r.status === "pending"),
);

const pendingCount = computed(() => pendingRequests.value.length);

const employeeList = computed(() =>
  users.value.map((u) => ({
    id: u.id,
    name: u.fullName || u.username,
  })),
);

const typeForm = ref({
  code: "",
  name: "",
  accrualType: "yearly" as "yearly" | "monthly" | "none",
  accrualAmount: 0,
  requiresApproval: true,
});
const isSavingType = ref(false);

function accrualLabel(accrualType: LeaveType["accrualType"]) {
  return accrualType === "yearly"
    ? "Yearly"
    : accrualType === "monthly"
      ? "Monthly"
      : "None";
}

const handleCreateType = async () => {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId || isSavingType.value) return;

  isSavingType.value = true;
  error.value = null;
  try {
    // The code column is uppercase letters and underscores only, and the
    // server rejects anything else. Normalise here so an owner typing
    // "annual leave" gets ANNUAL_LEAVE rather than a validation error naming
    // a regex.
    await leavesService.createLeaveType(String(restaurantId), {
      ...typeForm.value,
      code: typeForm.value.code
        .trim()
        .toUpperCase()
        .replace(/[^A-Z_]+/g, "_")
        .replace(/^_+|_+$/g, ""),
      name: typeForm.value.name.trim(),
    });
    typeForm.value = {
      code: "",
      name: "",
      accrualType: "yearly",
      accrualAmount: 0,
      requiresApproval: true,
    };
    await loadData();
  } catch (e) {
    error.value = resolveUserFacingError(e, t, {
      fallbackKey: "leaves.manage.createFailed",
    }).message;
  } finally {
    isSavingType.value = false;
  }
};

const handleDeleteType = async (type: LeaveType) => {
  if (!window.confirm(t("leaves.manage.deleteConfirm"))) return;
  error.value = null;
  try {
    await leavesService.deleteLeaveType(type.id);
    await loadData();
  } catch (e) {
    error.value = resolveUserFacingError(e, t, {
      fallbackKey: "leaves.manage.deleteFailed",
    }).message;
  }
};

const loadData = async () => {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;

  isLoading.value = true;
  error.value = null;

  try {
    const [types, reqs, allBalances] = await Promise.all([
      leavesService.getLeaveTypes(restaurantId),
      leavesService.getRequests(restaurantId),
      leavesService.getRestaurantBalances(String(restaurantId)),
    ]);
    leaveTypes.value = types;
    allRequests.value = reqs;
    balances.value = allBalances;
  } catch (e) {
    error.value = resolveUserFacingError(e, t, {
      fallbackKey: "leaves.messages.loadFailed",
    }).message;
    console.error("Failed to load leaves data:", e);
  } finally {
    isLoading.value = false;
  }
};

const handleApprove = async (requestId: number) => {
  try {
    await leavesService.approveRequest(requestId);
    // Optimistically update status
    const req = allRequests.value.find((r) => r.id === requestId);
    if (req) req.status = "approved";
  } catch (e) {
    console.error("Failed to approve request:", e);
    error.value = resolveUserFacingError(e, t, {
      fallbackKey: "leaves.messages.approveFailed",
    }).message;
    await loadData(); // Refresh on error
  }
};

const handleReject = async (requestId: number, reason?: string) => {
  try {
    await leavesService.rejectRequest(requestId, reason);
    // Optimistically update status
    const req = allRequests.value.find((r) => r.id === requestId);
    if (req) {
      req.status = "rejected";
      if (reason) req.rejectionReason = reason;
    }
  } catch (e) {
    console.error("Failed to reject request:", e);
    error.value = resolveUserFacingError(e, t, {
      fallbackKey: "leaves.messages.rejectFailed",
    }).message;
    await loadData(); // Refresh on error
  }
};

const handleLeaveRequest = async (formData: LeaveRequestFormData) => {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;

  const leaveTypeId =
    typeof formData.leaveTypeId === "number"
      ? formData.leaveTypeId
      : Number(formData.leaveTypeId);
  if (!Number.isFinite(leaveTypeId)) {
    error.value = t("leaves.manage.selectValidType");
    return;
  }

  try {
    await leavesService.createRequest(String(restaurantId), {
      leaveTypeId,
      startDate: formData.startDate,
      endDate: formData.endDate,
      // The endpoint takes a period per end of the range; a single "period"
      // key is not in its schema, so Zod stripped it and every half-day
      // request was filed as a full day (#330).
      startPeriod: formData.startPeriod || "full",
      endPeriod: formData.endPeriod || "full",
      reason: formData.reason,
      // The dialog used to hand over File[] that nothing forwarded, so every
      // documented request was filed with attachment_url = null (#343). The
      // column is a single URL; pass it through, omitted when blank.
      attachmentUrl: formData.attachmentUrl,
    });
    showRequestDialog.value = false;
    await loadData();
  } catch (e) {
    error.value = resolveUserFacingError(e, t, {
      fallbackKey: "leaves.messages.submitFailed",
    }).message;
  }
};

const handleAccrue = async () => {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;
  try {
    await apiClient.post(`/leaves/${restaurantId}/balances/accrue`, {
      year: new Date().getFullYear(),
    });
    await loadData();
  } catch (e) {
    error.value = resolveUserFacingError(e, t, {
      fallbackKey: "leaves.messages.initFailed",
    }).message;
  }
};

onMounted(() => {
  // Both can run concurrently — loadData no longer depends on users being loaded
  fetchUsers();
  loadData();
});
</script>
