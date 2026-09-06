<template>
  <div class="min-h-full bg-ios-bg -mx-4 -my-4 px-4 py-6 sm:-mx-6 sm:px-6">
    <div class="max-w-3xl mx-auto space-y-6">
      <!-- Page header -->
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-ios-text">
            {{ t("leaves.myLeaves") }}
          </h1>
          <p class="mt-1 text-sm text-ios-secondary">
            {{ t("myLeaves.subtitle") }}
          </p>
        </div>
        <!-- Disabled rather than opening a dialog whose type selector would be
             empty: leave type is required there, so the submit button could
             never enable and the dialog gave no clue why (#307). -->
        <button
          data-testid="my-leaves-apply"
          :disabled="loading || leaveTypes.length === 0"
          :title="leaveTypes.length === 0 ? t('leaves.manage.noTypesHint') : ''"
          class="rounded-full bg-ios-blue px-4 py-2 text-sm font-semibold text-white transition-all duration-200 ease-out hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          @click="showRequestDialog = true"
        >
          {{ t("leaves.request.new") }}
        </button>
      </header>

      <!-- Page-level error (module gate, session, network) -->
      <div
        v-if="loadError"
        data-testid="my-leaves-error"
        class="flex items-start gap-3 rounded-2xl bg-white p-5 shadow-ios-card"
      >
        <ExclamationTriangleIcon class="h-5 w-5 shrink-0 text-ios-red" />
        <div class="flex-1">
          <p class="text-sm font-semibold text-ios-text">{{ loadError }}</p>
          <button
            class="mt-3 rounded-full bg-ios-blue px-4 py-1.5 text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95"
            @click="loadAll"
          >
            {{ t("leaves.manage.retry") }}
          </button>
        </div>
      </div>

      <!-- ── My leave balances ────────────────────────────── -->
      <section>
        <h2
          class="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ios-secondary"
        >
          {{ t("leaves.balance.title") }}
        </h2>

        <div v-if="loading" class="rounded-2xl bg-white p-8 shadow-ios-card">
          <p class="text-center text-sm text-ios-secondary">
            {{ t("myShifts.loading") }}
          </p>
        </div>

        <div
          v-else-if="balances.length === 0"
          data-testid="my-leaves-no-balances"
          class="rounded-2xl bg-white p-8 text-center shadow-ios-card"
        >
          <CalendarIcon class="mx-auto h-10 w-10 text-ios-tertiary" />
          <p class="mt-3 text-sm font-semibold text-ios-text">
            {{ t("myLeaves.noBalances") }}
          </p>
          <p class="mt-1 text-sm text-ios-secondary">
            {{ t("myLeaves.noBalancesHint") }}
          </p>
        </div>

        <ul v-else class="grid gap-3 sm:grid-cols-2">
          <li
            v-for="balance in balances"
            :key="balance.id"
            data-testid="my-leave-balance"
            class="rounded-2xl bg-white p-5 shadow-ios-card"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-ios-text">
                {{ balance.leaveType?.name || t("leaves.balance.unknownType") }}
              </span>
              <span
                v-if="balance.leaveType?.isPaid"
                class="ml-auto rounded-full bg-ios-green-soft px-2 py-0.5 text-[10px] font-semibold text-ios-green-deep"
              >
                {{ t("employees.leave.paid") }}
              </span>
            </div>

            <p class="mt-3 flex items-baseline gap-1">
              <span class="text-2xl font-bold text-ios-blue">
                {{ balance.remainingDays }}
              </span>
              <span class="text-sm text-ios-secondary">
                / {{ balance.totalDays }} {{ t("leaves.balance.days") }}
              </span>
            </p>

            <p class="mt-2 flex gap-3 text-xs text-ios-secondary">
              <span>
                {{ t("leaves.balance.used") }}: {{ balance.usedDays }}
              </span>
              <span v-if="balance.pendingDays > 0" class="text-ios-orange-deep">
                {{ t("leaves.balance.pending") }}: {{ balance.pendingDays }}
              </span>
            </p>
          </li>
        </ul>
      </section>

      <!-- ── My leave requests ────────────────────────────── -->
      <section>
        <h2
          class="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ios-secondary"
        >
          {{ t("leaves.request.myRequests") }}
        </h2>

        <div
          v-if="!loading && myRequests.length === 0"
          data-testid="my-leaves-empty"
          class="rounded-2xl bg-white p-8 text-center shadow-ios-card"
        >
          <p class="text-sm text-ios-secondary">
            {{ t("leaves.list.noRequests") }}
          </p>
        </div>

        <ul v-else-if="!loading" class="space-y-3">
          <li
            v-for="request in myRequests"
            :key="request.id"
            data-testid="my-leave-request"
            :data-status="request.status"
            class="rounded-2xl bg-white p-5 shadow-ios-card"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="rounded-full bg-ios-blue-soft px-3 py-1 text-xs font-semibold text-ios-blue-deep"
              >
                {{ request.leaveType?.name || t("leaves.balance.unknownType") }}
              </span>
              <span
                class="rounded-full px-3 py-1 text-xs font-semibold"
                :class="statusPillClass(request.status)"
              >
                {{ t(`leaves.status.${request.status}`) }}
              </span>
              <span class="ml-auto text-xs text-ios-secondary">
                {{ formatDateRange(request.startDate, request.endDate) }} ·
                {{ request.totalDays }} {{ t("leaves.balance.days") }}
              </span>
            </div>

            <p class="mt-3 text-sm leading-relaxed text-ios-text">
              {{ request.reason }}
            </p>

            <p
              v-if="request.rejectionReason"
              class="mt-2 text-sm text-ios-red-deep"
            >
              {{ t("myShifts.rejectionReason") }}: {{ request.rejectionReason }}
            </p>
            <p
              v-if="request.cancellationReason"
              class="mt-2 text-sm text-ios-secondary"
            >
              {{ t("myLeaves.cancellationReason") }}:
              {{ request.cancellationReason }}
            </p>

            <!-- Cancel: a reason is mandatory (cancelLeaveRequestSchema), so
                 the input is the action rather than a follow-up prompt. -->
            <template v-if="canCancel(request)">
              <button
                v-if="cancellingId !== request.id"
                data-testid="my-leave-cancel-open"
                class="mt-4 rounded-full bg-ios-bg px-4 py-2 text-sm font-semibold text-ios-red transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
                @click="openCancel(request.id)"
              >
                {{ t("myLeaves.cancelRequest") }}
              </button>

              <div v-else class="mt-4 space-y-2">
                <input
                  v-model="cancelReason"
                  type="text"
                  maxlength="500"
                  data-testid="my-leave-cancel-reason"
                  :placeholder="t('leaveActions.cancelReasonPrompt')"
                  class="w-full rounded-xl bg-ios-bg px-4 py-2.5 text-sm text-ios-text placeholder:text-ios-tertiary focus:outline-none focus:ring-2 focus:ring-ios-red"
                  @keydown.enter="submitCancel"
                  @keydown.esc="closeCancel"
                />
                <div class="flex gap-2">
                  <button
                    data-testid="my-leave-cancel-confirm"
                    :disabled="submitting || !cancelReason.trim()"
                    class="flex-1 rounded-full bg-ios-red px-4 py-2 text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    @click="submitCancel"
                  >
                    {{ t("myLeaves.confirmCancel") }}
                  </button>
                  <button
                    class="rounded-full px-4 py-2 text-sm font-semibold text-ios-secondary transition-all duration-200 ease-out hover:bg-ios-bg active:scale-95"
                    @click="closeCancel"
                  >
                    {{ t("myLeaves.dismiss") }}
                  </button>
                </div>
              </div>
            </template>
          </li>
        </ul>
      </section>
    </div>

    <LeaveRequestDialog
      :is-open="showRequestDialog"
      :leave-types="leaveTypes"
      :balances="balances"
      @close="showRequestDialog = false"
      @submit="submitRequest"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Employee-facing leave self-service (#344).
 *
 * `LeavesTab` under /dashboard/employees is the manager surface and is gated
 * ADMIN/OWNER by its parent route, so before this page a chef, service crew or
 * cashier had no leave UI at all -- they could not see a balance, file a
 * request, or withdraw one. The API had always been built for them: the list,
 * detail and cancel handlers each carry an explicit "not a manager, so only
 * your own request" branch that nothing could reach. This is the same
 * self-service shape as MyShiftsView (#320) and needs no new endpoint.
 *
 * The dead LeaveView.vue this replaces mixed self-service with an approval
 * queue and a calendar that duplicated LeavesTab, and pushed to a
 * /dashboard/leaves/:id route that never existed. Neither is reproduced here:
 * a request row already carries everything that detail page would have shown.
 */
import { computed, onMounted, ref } from "vue";
import { useToast } from "vue-toastification";
import {
  CalendarIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { leavesService } from "@/services/leavesService";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import LeaveRequestDialog from "@/components/leaves/LeaveRequestDialog.vue";
import type { LeaveRequestFormData } from "@/components/leaves/LeaveRequestDialog.vue";
import type { LeaveBalance, LeaveRequest } from "@/services/leavesService";

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();
const { formatDateRange } = useDateFormatter();

const loading = ref(true);
const loadError = ref("");
const submitting = ref(false);
const showRequestDialog = ref(false);

const leaveTypes = ref<Awaited<ReturnType<typeof leavesService.getLeaveTypes>>>(
  [],
);
const balances = ref<LeaveBalance[]>([]);
const myRequests = ref<LeaveRequest[]>([]);

const cancellingId = ref<number | null>(null);
const cancelReason = ref("");

const restaurantId = computed(() => authStore.restaurantId || "");
const employeeId = computed(() => authStore.user?.id ?? "");

/** Local YYYY-MM-DD — startDate is a calendar date, so UTC would shift it. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Mirrors LeaveService.cancelLeaveRequest: pending always, approved only while
 * it has not started — cancelling a started approved leave would refund days
 * already taken. The server decides "today" in the shop's timezone (#329),
 * which the browser cannot know, so this only hides an action that is certain
 * to be refused; a borderline one still goes to the server and surfaces its
 * message.
 */
function canCancel(request: LeaveRequest): boolean {
  if (request.status === "pending") return true;
  return request.status === "approved" && request.startDate > today();
}

function statusPillClass(status: LeaveRequest["status"]): string {
  switch (status) {
    case "approved":
      return "bg-ios-green-soft text-ios-green-deep";
    case "rejected":
      return "bg-ios-red-soft text-ios-red-deep";
    case "cancelled":
      return "bg-ios-bg text-ios-secondary";
    default:
      return "bg-ios-orange-soft text-ios-orange-deep";
  }
}

async function loadAll() {
  if (!restaurantId.value || !employeeId.value) {
    loading.value = false;
    loadError.value = t("myShifts.noRestaurant");
    return;
  }

  loading.value = true;
  loadError.value = "";

  try {
    // employeeId is passed explicitly: the API pins it to the session user for
    // roles 2-4, but a manager opening their own page would otherwise get the
    // whole restaurant's requests.
    const [types, requests, ownBalances] = await Promise.all([
      leavesService.getLeaveTypes(restaurantId.value),
      leavesService.getRequests(restaurantId.value, {
        employeeId: employeeId.value,
      }),
      leavesService.getBalances({
        employeeId: employeeId.value,
        year: new Date().getFullYear(),
      }),
    ]);

    leaveTypes.value = types;
    myRequests.value = [...requests].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    balances.value = ownBalances;
  } catch (err) {
    loadError.value = resolveUserFacingError(err, t, {
      fallbackKey: "leaves.messages.loadFailed",
    }).message;
  } finally {
    loading.value = false;
  }
}

async function submitRequest(formData: LeaveRequestFormData) {
  const leaveTypeId = Number(formData.leaveTypeId);
  if (!Number.isFinite(leaveTypeId)) {
    toast.error(t("leaves.manage.selectValidType"));
    return;
  }

  try {
    await leavesService.createRequest(restaurantId.value, {
      leaveTypeId,
      startDate: formData.startDate,
      endDate: formData.endDate,
      // A period per end of the range: a single "period" key is not in the
      // endpoint's schema, so Zod strips it and every half day is filed as a
      // full day (#330).
      startPeriod: formData.startPeriod || "full",
      endPeriod: formData.endPeriod || "full",
      reason: formData.reason,
      // Forwarded for the same reason LeavesTab forwards it: the dialog's
      // documentation link is dropped on the floor otherwise (#343).
      attachmentUrl: formData.attachmentUrl,
    });
    showRequestDialog.value = false;
    toast.success(t("leaves.messages.submitSuccess"));
    await loadAll();
  } catch (err) {
    toast.error(
      resolveUserFacingError(err, t, {
        fallbackKey: "leaves.messages.submitFailed",
      }).message,
    );
  }
}

function openCancel(requestId: number) {
  cancellingId.value = requestId;
  cancelReason.value = "";
}

function closeCancel() {
  cancellingId.value = null;
  cancelReason.value = "";
}

async function submitCancel() {
  const requestId = cancellingId.value;
  const reason = cancelReason.value.trim();
  if (requestId === null || !reason || submitting.value) return;

  submitting.value = true;
  try {
    await leavesService.cancelRequest(requestId, reason);
    closeCancel();
    toast.success(t("leaves.messages.cancelSuccess"));
    await loadAll();
  } catch (err) {
    toast.error(
      resolveUserFacingError(err, t, {
        fallbackKey: "leaves.messages.cancelFailed",
      }).message,
    );
  } finally {
    submitting.value = false;
  }
}

onMounted(loadAll);
</script>
