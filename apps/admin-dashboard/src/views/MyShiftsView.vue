<template>
  <div
    class="ui-page min-h-full bg-ios-bg -mx-4 -my-4 px-4 py-6 sm:-mx-6 sm:px-6"
  >
    <div class="max-w-3xl mx-auto space-y-6">
      <!-- Page header -->
      <header>
        <h1 class="ui-page-heading text-2xl font-bold text-ios-text">
          {{ t("myShifts.title") }}
        </h1>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ t("myShifts.subtitle") }}
        </p>
      </header>

      <!-- Page-level error (module gate, session, network) -->
      <div
        v-if="loadError"
        data-testid="my-shifts-error"
        class="ui-panel flex items-start gap-3 rounded-2xl bg-white p-5 shadow-ios-card"
      >
        <ExclamationTriangleIcon class="h-5 w-5 shrink-0 text-ios-red" />
        <div class="flex-1">
          <p class="text-sm font-semibold text-ios-text">{{ loadError }}</p>
          <button
            class="mt-3 rounded-full bg-primary-700 px-4 py-1.5 text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95"
            @click="loadAll"
          >
            {{ t("myShifts.retry") }}
          </button>
        </div>
      </div>

      <!-- ── My upcoming shifts ───────────────────────────── -->
      <section>
        <h2
          class="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ios-secondary"
        >
          {{ t("myShifts.upcomingTitle") }}
        </h2>

        <div
          v-if="loading"
          class="ui-panel rounded-2xl bg-white p-8 shadow-ios-card"
        >
          <p class="text-center text-sm text-ios-secondary">
            {{ t("myShifts.loading") }}
          </p>
        </div>

        <div
          v-else-if="eligibleShifts.length === 0"
          data-testid="my-shifts-empty"
          class="ui-panel rounded-2xl bg-white p-8 text-center shadow-ios-card"
        >
          <CalendarIcon class="mx-auto h-10 w-10 text-ios-tertiary" />
          <p class="mt-3 text-sm font-semibold text-ios-text">
            {{ t("myShifts.noShifts") }}
          </p>
          <p class="mt-1 text-sm text-ios-secondary">
            {{ t("myShifts.noShiftsHint") }}
          </p>
        </div>

        <ul v-else class="space-y-3">
          <li
            v-for="shift in eligibleShifts"
            :key="shift.id"
            data-testid="my-shift-row"
            class="ui-panel flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-ios-card sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <p class="text-base font-semibold text-ios-text">
                {{ formatDate(shift.workDate, true) }}
              </p>
              <p class="mt-0.5 font-mono text-sm text-ios-secondary">
                {{ shift.startTime }} – {{ shift.endTime }}
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span
                v-if="pendingByScheduleId.has(shift.id)"
                data-status="swap-pending"
                class="rounded-full bg-ios-orange-soft px-3 py-1 text-xs font-semibold text-ios-orange-deep"
              >
                {{ t("myShifts.alreadyRequested") }}
              </span>
              <button
                v-else
                data-testid="request-swap-button"
                class="rounded-full bg-primary-700 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 ease-out hover:opacity-90 active:scale-95"
                @click="openForm(shift)"
              >
                {{ t("myShifts.requestSwap") }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── My swap requests ─────────────────────────────── -->
      <section>
        <h2
          class="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ios-secondary"
        >
          {{ t("myShifts.requestsTitle") }}
        </h2>

        <div
          v-if="!loading && myRequests.length === 0"
          data-testid="my-requests-empty"
          class="ui-panel rounded-2xl bg-white p-8 text-center shadow-ios-card"
        >
          <p class="text-sm text-ios-secondary">
            {{ t("myShifts.noRequests") }}
          </p>
        </div>

        <ul v-else-if="!loading" class="space-y-3">
          <li
            v-for="request in myRequests"
            :key="request.id"
            data-testid="my-request-row"
            :data-status="request.status"
            class="ui-panel rounded-2xl bg-white p-5 shadow-ios-card"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="rounded-full bg-ios-blue-soft px-3 py-1 text-xs font-semibold text-ios-blue-deep"
              >
                {{ t(`myShifts.type.${request.requestType}`) }}
              </span>
              <span
                class="rounded-full px-3 py-1 text-xs font-semibold"
                :class="statusPillClass(request.status)"
              >
                {{ t(`myShifts.status.${request.status}`) }}
              </span>
              <span class="ml-auto text-xs text-ios-secondary">
                {{ shiftLabel(request.requesterScheduleId) }}
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

            <button
              v-if="request.status === 'pending'"
              data-testid="cancel-request-button"
              class="mt-4 rounded-full bg-ios-bg px-4 py-2 text-sm font-semibold text-ios-red transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
              @click="cancelRequest(request)"
            >
              {{ t("myShifts.cancelRequest") }}
            </button>
          </li>
        </ul>
      </section>
    </div>

    <!-- ── Request form ───────────────────────────────────── -->
    <div
      v-if="formShift"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      @click.self="closeForm"
    >
      <div
        v-dialog-focus
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-form-title"
        tabindex="-1"
        data-testid="swap-form"
        class="ui-panel w-full max-w-md rounded-t-3xl bg-white p-6 shadow-ios-float sm:rounded-3xl"
        @keydown.esc.stop="closeForm"
      >
        <h3 id="swap-form-title" class="text-lg font-bold text-ios-text">
          {{ t("myShifts.formTitle") }}
        </h3>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ formatDate(formShift.workDate, true) }} ·
          {{ formShift.startTime }} – {{ formShift.endTime }}
        </p>

        <label
          class="mt-5 block text-xs font-semibold uppercase tracking-wide text-ios-secondary"
        >
          {{ t("myShifts.typeLabel") }}
        </label>
        <div class="mt-2 flex gap-2">
          <button
            v-for="option in requestTypes"
            :key="option"
            type="button"
            class="flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-all duration-200 ease-out"
            :class="
              form.requestType === option
                ? 'bg-primary-700 text-white'
                : 'bg-ios-bg text-ios-secondary'
            "
            @click="form.requestType = option"
          >
            {{ t(`myShifts.type.${option}`) }}
          </button>
        </div>

        <label
          class="mt-5 block text-xs font-semibold uppercase tracking-wide text-ios-secondary"
        >
          {{ t("myShifts.urgencyLabel") }}
        </label>
        <div class="mt-2 flex gap-2">
          <button
            v-for="option in urgencies"
            :key="option"
            type="button"
            class="flex-1 rounded-full px-2 py-2 text-sm font-semibold transition-all duration-200 ease-out"
            :class="
              form.urgency === option
                ? 'bg-primary-700 text-white'
                : 'bg-ios-bg text-ios-secondary'
            "
            @click="form.urgency = option"
          >
            {{ t(`myShifts.urgency.${option}`) }}
          </button>
        </div>

        <label
          for="swap-reason"
          class="mt-5 block text-xs font-semibold uppercase tracking-wide text-ios-secondary"
        >
          {{ t("myShifts.reasonLabel") }}
        </label>
        <textarea
          id="swap-reason"
          v-model="form.reason"
          data-testid="swap-reason"
          rows="3"
          maxlength="500"
          :placeholder="t('myShifts.reasonPlaceholder')"
          class="mt-2 w-full rounded-2xl bg-ios-bg px-4 py-3 text-sm text-ios-text placeholder:text-ios-tertiary focus:outline-none focus:ring-2 focus:ring-ios-blue"
        />

        <p
          v-if="formError"
          data-testid="swap-form-error"
          class="mt-3 text-sm font-semibold text-ios-red"
        >
          {{ formError }}
        </p>

        <div class="mt-6 flex gap-3">
          <button
            type="button"
            class="flex-1 rounded-full bg-ios-bg px-4 py-3 text-sm font-semibold text-ios-secondary transition-all duration-200 ease-out active:scale-95"
            :disabled="submitting"
            @click="closeForm"
          >
            {{ t("myShifts.cancel") }}
          </button>
          <button
            type="button"
            data-testid="swap-submit"
            :disabled="submitting"
            class="flex-1 rounded-full bg-primary-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95 disabled:opacity-50"
            @click="submit"
          >
            {{ submitting ? t("myShifts.submitting") : t("myShifts.submit") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Employee-facing shift swap entry (#320).
 *
 * The product decision recorded in docs/specs/2026-09-issue-320-shift-swap-entry.md
 * is *self-service, open request*: an employee raises a request against one of
 * their own shifts without naming a colleague, and a manager resolves it on the
 * advanced scheduling page (#314). That shape needs no new API — the requester
 * is bound to the session by the route handler (#99), and the only shifts this
 * page can reach are the caller's own within their own restaurant.
 */
import { vDialogFocus } from "@/utils/dialog-focus";
import { computed, onMounted, reactive, ref } from "vue";
import { useToast } from "vue-toastification";
import {
  CalendarIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { schedulingService } from "@/services/schedulingService";
import { unwrapApiList } from "@/services/api";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import type { EmployeeSchedule, SwapRequest } from "@/types/scheduling";

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();
const { formatDate } = useDateFormatter();
const { confirm: confirmModal } = useConfirmModal();

const requestTypes = ["swap", "cover", "drop"] as const;
const urgencies = ["low", "normal", "high", "urgent"] as const;

const loading = ref(true);
const loadError = ref("");
const submitting = ref(false);
const formError = ref("");
const schedules = ref<EmployeeSchedule[]>([]);
const myRequests = ref<SwapRequest[]>([]);
const formShift = ref<EmployeeSchedule | null>(null);

const form = reactive({
  requestType: "swap" as (typeof requestTypes)[number],
  urgency: "normal" as (typeof urgencies)[number],
  reason: "",
});

const restaurantId = computed(() => authStore.restaurantId || "");
const employeeId = computed(() => authStore.user?.id ?? "");

/** Local YYYY-MM-DD — workDate is a calendar date, so UTC would shift it. */
function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * A shift can be swapped only while it is still ahead and still standing.
 * The server scopes the rows to this employee and restaurant; this narrows
 * them to the ones an employee could actually hand over.
 */
const eligibleShifts = computed(() => {
  const today = isoDate(0);
  return schedules.value
    .filter(
      (shift) =>
        shift.workDate >= today &&
        shift.status !== "cancelled" &&
        shift.status !== "completed" &&
        shift.status !== "no_show",
    )
    .sort((a, b) =>
      a.workDate === b.workDate
        ? a.startTime.localeCompare(b.startTime)
        : a.workDate.localeCompare(b.workDate),
    );
});

/** Schedule ids already carrying an unresolved request, to hide the button. */
const pendingByScheduleId = computed(
  () =>
    new Set(
      myRequests.value
        .filter((r) => r.status === "pending" || r.status === "accepted")
        .map((r) => r.requesterScheduleId),
    ),
);

const scheduleById = computed(
  () => new Map(schedules.value.map((shift) => [shift.id, shift])),
);

function shiftLabel(scheduleId: number): string {
  const shift = scheduleById.value.get(scheduleId);
  // A request can outlive the window we load, so fall back to the raw id
  // rather than rendering an empty slot.
  if (!shift) return `#${scheduleId}`;
  return `${formatDate(shift.workDate)} ${shift.startTime}`;
}

function statusPillClass(status: SwapRequest["status"]): string {
  switch (status) {
    case "approved":
      return "bg-ios-green-soft text-ios-green-deep";
    case "rejected":
    case "expired":
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
    // roles 2-4, but a manager opening their own page would otherwise see the
    // whole restaurant's shifts.
    const [scheduleResponse, requestResponse] = await Promise.all([
      schedulingService.getSchedules({
        restaurantId: restaurantId.value,
        employeeId: employeeId.value,
        startDate: isoDate(-30),
        endDate: isoDate(60),
        limit: 100,
      }),
      schedulingService.getSwapRequests({
        restaurantId: restaurantId.value,
        requesterEmployeeId: employeeId.value,
        limit: 50,
      }),
    ]);

    schedules.value = unwrapApiList<EmployeeSchedule>(scheduleResponse);
    myRequests.value = unwrapApiList<SwapRequest>(requestResponse);
  } catch (err) {
    loadError.value = resolveUserFacingError(err, t, {
      fallbackKey: "myShifts.loadFailed",
    }).message;
  } finally {
    loading.value = false;
  }
}

function openForm(shift: EmployeeSchedule) {
  formShift.value = shift;
  form.requestType = "swap";
  form.urgency = "normal";
  form.reason = "";
  formError.value = "";
}

let isConfirmingClose = false;
async function closeForm() {
  if (submitting.value || isConfirmingClose) return;
  isConfirmingClose = true;
  try {
    if (
      (form.reason.trim() ||
        form.requestType !== "swap" ||
        form.urgency !== "normal") &&
      !(await confirmModal({
        type: "warning",
        title: t("myShifts.cancel"),
        message: t("confirmations.unsavedChanges"),
        confirmLabel: t("common.confirm"),
      }))
    )
      return;
    if (!submitting.value) formShift.value = null;
  } finally {
    isConfirmingClose = false;
  }
}

async function submit() {
  const shift = formShift.value;
  if (!shift) return;

  if (!form.reason.trim()) {
    formError.value = t("myShifts.reasonRequired");
    return;
  }

  submitting.value = true;
  formError.value = "";

  try {
    await schedulingService.createSwapRequest(restaurantId.value, {
      requesterScheduleId: shift.id,
      requestType: form.requestType,
      reason: form.reason.trim(),
      urgency: form.urgency,
      // No colleague is named: the manager resolves it. See the spec note above.
      isOpenRequest: true,
    });

    toast.success(t("myShifts.submitSuccess"));
    formShift.value = null;
    await loadAll();
  } catch (err) {
    formError.value = resolveUserFacingError(err, t, {
      fallbackKey: "myShifts.submitFailed",
    }).message;
  } finally {
    submitting.value = false;
  }
}

async function cancelRequest(request: SwapRequest) {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("myShifts.cancelRequest"),
    message: t("myShifts.cancelConfirm"),
    confirmLabel: t("myShifts.cancelRequest"),
  });
  if (!confirmed) return;

  try {
    await schedulingService.cancelSwapRequest(request.id);
    toast.success(t("myShifts.cancelSuccess"));
    await loadAll();
  } catch (err) {
    toast.error(
      resolveUserFacingError(err, t, { fallbackKey: "myShifts.cancelFailed" })
        .message,
    );
  }
}

onMounted(loadAll);
</script>
