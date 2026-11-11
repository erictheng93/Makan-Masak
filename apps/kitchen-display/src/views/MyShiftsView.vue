<template>
  <div class="kitchen-page ui-page bg-ios-bg min-h-screen">
    <!-- Header -->
    <div class="kitchen-page-heading ui-page-heading px-4 pt-6 pb-4">
      <button
        class="w-11 h-11 rounded-full bg-white shadow-card-sm flex items-center justify-center flex-shrink-0"
        :aria-label="t('common.back')"
        @click="$router.back()"
      >
        <ArrowLeft class="w-5 h-5 text-ios-text" />
      </button>
      <h1 class="text-2xl font-extrabold text-ios-text">
        {{ t("myShifts.title") }}
      </h1>
    </div>

    <div class="px-4 pb-10 max-w-2xl mx-auto space-y-6">
      <p class="text-sm text-ios-secondary px-1">
        {{ t("myShifts.subtitle") }}
      </p>

      <!-- Page-level error (module gate, session, network) -->
      <div
        v-if="loadError"
        data-testid="my-shifts-error"
        class="bg-white rounded-2xl shadow-card-sm p-5"
      >
        <p class="text-[15px] font-semibold text-ios-text">{{ loadError }}</p>
        <button
          class="mt-3 rounded-full bg-blue-700 px-4 py-2 text-sm font-semibold text-white active:scale-95 transition-all duration-200"
          @click="loadAll"
        >
          {{ t("myShifts.retry") }}
        </button>
      </div>

      <!-- ── Upcoming shifts ──────────────────────────────── -->
      <section>
        <div
          class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 tracking-wide"
        >
          {{ t("myShifts.upcomingTitle") }}
        </div>

        <div
          v-if="loading"
          class="bg-white rounded-2xl shadow-card-sm p-8 text-center"
        >
          <p class="text-sm text-ios-secondary">{{ t("myShifts.loading") }}</p>
        </div>

        <div
          v-else-if="eligibleShifts.length === 0"
          data-testid="my-shifts-empty"
          class="bg-white rounded-2xl shadow-card-sm p-8 text-center"
        >
          <p class="text-[15px] font-semibold text-ios-text">
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
            class="bg-white rounded-2xl shadow-card-sm p-5 flex items-center justify-between gap-3"
          >
            <div class="min-w-0">
              <p class="text-[15px] font-semibold text-ios-text">
                {{ shift.workDate }}
              </p>
              <p class="mt-0.5 text-sm text-ios-secondary font-mono">
                {{ shift.startTime }} – {{ shift.endTime }}
              </p>
            </div>
            <span
              v-if="pendingScheduleIds.has(shift.id)"
              data-status="swap-pending"
              class="rounded-full bg-ios-orange-soft px-3 py-1 text-xs font-semibold text-ios-orange-deep flex-shrink-0"
            >
              {{ t("myShifts.alreadyRequested") }}
            </span>
            <button
              v-else
              data-testid="request-swap-button"
              class="rounded-full bg-blue-700 px-4 py-2 text-sm font-semibold text-white flex-shrink-0 active:scale-95 transition-all duration-200"
              @click="openForm(shift)"
            >
              {{ t("myShifts.requestSwap") }}
            </button>
          </li>
        </ul>
      </section>

      <!-- ── My requests ──────────────────────────────────── -->
      <section>
        <div
          class="text-xs font-semibold text-ios-secondary uppercase px-4 mb-1.5 tracking-wide"
        >
          {{ t("myShifts.requestsTitle") }}
        </div>

        <div
          v-if="!loading && myRequests.length === 0"
          data-testid="my-requests-empty"
          class="bg-white rounded-2xl shadow-card-sm p-8 text-center"
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
            class="bg-white rounded-2xl shadow-card-sm p-5"
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

            <p class="mt-3 text-sm text-ios-text leading-relaxed">
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
              class="mt-4 rounded-full bg-ios-bg px-4 py-2 text-sm font-semibold text-ios-red active:scale-95 transition-all duration-200"
              @click="cancelRequest(request)"
            >
              {{ t("myShifts.cancelRequest") }}
            </button>
          </li>
        </ul>
      </section>
    </div>

    <!-- ── Request form ───────────────────────────────────── -->
    <Dialog
      :open="!!formShift"
      :initial-focus="formHeading"
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30"
      @close="closeForm"
    >
      <DialogPanel
        v-if="formShift"
        data-testid="swap-form"
        class="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-card-lg max-h-[90dvh] overflow-y-auto"
      >
        <DialogTitle as="template">
          <h2
            ref="formHeading"
            tabindex="-1"
            class="text-lg font-bold text-ios-text"
          >
            {{ t("myShifts.formTitle") }}
          </h2>
        </DialogTitle>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ formShift.workDate }} · {{ formShift.startTime }} –
          {{ formShift.endTime }}
        </p>

        <div
          class="mt-5 text-xs font-semibold text-ios-secondary uppercase tracking-wide"
        >
          {{ t("myShifts.typeLabel") }}
        </div>
        <div class="mt-2 flex gap-2">
          <button
            v-for="option in requestTypes"
            :key="option"
            class="flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-all duration-200"
            :class="
              form.requestType === option
                ? 'bg-blue-700 text-white'
                : 'bg-ios-bg text-ios-secondary'
            "
            @click="form.requestType = option"
          >
            {{ t(`myShifts.type.${option}`) }}
          </button>
        </div>

        <div
          class="mt-5 text-xs font-semibold text-ios-secondary uppercase tracking-wide"
        >
          {{ t("myShifts.urgencyLabel") }}
        </div>
        <div class="mt-2 flex gap-2">
          <button
            v-for="option in urgencies"
            :key="option"
            class="flex-1 rounded-full px-2 py-2 text-sm font-semibold transition-all duration-200"
            :class="
              form.urgency === option
                ? 'bg-blue-700 text-white'
                : 'bg-ios-bg text-ios-secondary'
            "
            @click="form.urgency = option"
          >
            {{ t(`myShifts.urgency.${option}`) }}
          </button>
        </div>

        <label
          for="swap-reason"
          class="mt-5 block text-xs font-semibold text-ios-secondary uppercase tracking-wide"
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
            class="flex-1 rounded-full bg-ios-bg px-4 py-3 text-sm font-semibold text-ios-secondary active:scale-95 transition-all duration-200"
            @click="closeForm"
          >
            {{ t("myShifts.cancel") }}
          </button>
          <button
            data-testid="swap-submit"
            :disabled="submitting"
            class="flex-1 rounded-full bg-blue-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 active:scale-95 transition-all duration-200"
            @click="submit"
          >
            {{ submitting ? t("myShifts.submitting") : t("myShifts.submit") }}
          </button>
        </div>
      </DialogPanel>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * Chef-facing shift swap entry (#320).
 *
 * Role 2 never reaches the admin dashboard — LoginView there logs chefs out
 * and points them here — so the employee swap entry has to exist in this app
 * too, not only in admin-dashboard's MyShiftsView.
 *
 * Product decision (docs/specs/2026-09-issue-320-shift-swap-entry.md):
 * self-service *open* requests only. No colleague is named, so nothing here
 * reads another employee's schedule.
 */
import { computed, onMounted, reactive, ref } from "vue";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/vue";
import { ArrowLeft } from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import {
  schedulingApi,
  type MyShift,
  type MySwapRequest,
  type SwapRequestType,
  type SwapUrgency,
} from "@/services/schedulingApi";

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();

const requestTypes: SwapRequestType[] = ["swap", "cover", "drop"];
const urgencies: SwapUrgency[] = ["low", "normal", "high", "urgent"];

const loading = ref(true);
const loadError = ref("");
const submitting = ref(false);
const formError = ref("");
const shifts = ref<MyShift[]>([]);
const myRequests = ref<MySwapRequest[]>([]);
const formShift = ref<MyShift | null>(null);
const formHeading = ref<HTMLElement | null>(null);

const form = reactive({
  requestType: "swap" as SwapRequestType,
  urgency: "normal" as SwapUrgency,
  reason: "",
});

/** Local YYYY-MM-DD — workDate is a calendar date, so UTC would shift it. */
function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const eligibleShifts = computed(() => {
  const today = isoDate(0);
  return shifts.value
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

const pendingScheduleIds = computed(
  () =>
    new Set(
      myRequests.value
        .filter((r) => r.status === "pending" || r.status === "accepted")
        .map((r) => r.requesterScheduleId),
    ),
);

const shiftById = computed(
  () => new Map(shifts.value.map((shift) => [shift.id, shift])),
);

function shiftLabel(scheduleId: number): string {
  const shift = shiftById.value.get(scheduleId);
  // A request can outlive the window we load, so fall back to the raw id.
  return shift ? `${shift.workDate} ${shift.startTime}` : `#${scheduleId}`;
}

function statusPillClass(status: MySwapRequest["status"]): string {
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
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) {
    loading.value = false;
    loadError.value = t("myShifts.noRestaurant");
    return;
  }

  loading.value = true;
  loadError.value = "";

  try {
    const [shiftRows, requestRows] = await Promise.all([
      schedulingApi.getMyShifts(
        String(restaurantId),
        isoDate(-30),
        isoDate(60),
      ),
      schedulingApi.getMySwapRequests(String(restaurantId)),
    ]);
    shifts.value = shiftRows;
    myRequests.value = requestRows;
  } catch (error) {
    loadError.value = resolveUserFacingError(error, t, {
      fallbackKey: "myShifts.loadFailed",
    }).message;
  } finally {
    loading.value = false;
  }
}

function openForm(shift: MyShift) {
  formShift.value = shift;
  form.requestType = "swap";
  form.urgency = "normal";
  form.reason = "";
  formError.value = "";
}

function closeForm() {
  formShift.value = null;
}

async function submit() {
  const shift = formShift.value;
  const restaurantId = authStore.restaurantId;
  if (!shift || !restaurantId) return;

  if (!form.reason.trim()) {
    formError.value = t("myShifts.reasonRequired");
    return;
  }

  submitting.value = true;
  formError.value = "";

  try {
    await schedulingApi.createSwapRequest(String(restaurantId), {
      requesterScheduleId: shift.id,
      requestType: form.requestType,
      urgency: form.urgency,
      reason: form.reason.trim(),
      isOpenRequest: true,
    });
    toast.success(t("myShifts.submitSuccess"));
    closeForm();
    await loadAll();
  } catch (error) {
    formError.value = resolveUserFacingError(error, t, {
      fallbackKey: "myShifts.submitFailed",
    }).message;
  } finally {
    submitting.value = false;
  }
}

async function cancelRequest(request: MySwapRequest) {
  try {
    await schedulingApi.cancelSwapRequest(request.id);
    toast.success(t("myShifts.cancelSuccess"));
    await loadAll();
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "myShifts.cancelFailed",
      }).message,
    );
  }
}

onMounted(loadAll);
</script>
