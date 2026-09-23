<template>
  <div class="min-h-screen bg-ios-bg text-ios-text">
    <main class="max-w-md mx-auto px-4 py-8 space-y-5">
      <section class="bg-white rounded-2xl shadow-card p-6 animate-slide-up">
        <div class="flex items-center gap-3 mb-6">
          <div
            class="w-11 h-11 rounded-full bg-ios-blue/10 flex items-center justify-center text-ios-blue"
          >
            <QueueListIcon class="w-6 h-6" />
          </div>
          <div>
            <h1 class="text-2xl font-semibold text-ios-text">
              {{ t("waitingList.join.title") }}
            </h1>
            <p class="text-sm text-ios-secondary">
              {{ t("waitingList.join.subtitle") }}
            </p>
          </div>
        </div>

        <form class="space-y-4" @submit.prevent="handleJoin">
          <label class="block">
            <span class="text-sm font-medium text-ios-text">{{
              t("waitingList.form.name")
            }}</span>
            <input
              v-model.trim="customerName"
              data-testid="customer-name-input"
              class="mt-2 w-full rounded-2xl border-0 bg-ios-bg px-4 py-3 text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue transition-shadow duration-200 ease-out"
              autocomplete="name"
              :placeholder="t('waitingList.form.namePlaceholder')"
              required
            />
          </label>

          <label class="block">
            <span class="text-sm font-medium text-ios-text">{{
              t("waitingList.form.phone")
            }}</span>
            <input
              v-model.trim="customerPhone"
              data-testid="customer-phone-input"
              class="mt-2 w-full rounded-2xl border-0 bg-ios-bg px-4 py-3 text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue transition-shadow duration-200 ease-out"
              inputmode="tel"
              autocomplete="tel"
              :placeholder="t('waitingList.form.phonePlaceholder')"
              required
            />
          </label>

          <label class="block">
            <span class="text-sm font-medium text-ios-text">{{
              t("waitingList.form.partySize")
            }}</span>
            <select
              v-model.number="partySize"
              data-testid="party-size-select"
              class="mt-2 w-full rounded-2xl border-0 bg-ios-bg px-4 py-3 text-ios-text focus:ring-2 focus:ring-ios-blue transition-shadow duration-200 ease-out"
            >
              <option v-for="size in partySizes" :key="size" :value="size">
                {{ tWithParams("waitingList.form.partySizeOption", { size }) }}
              </option>
            </select>
          </label>

          <label class="block">
            <span class="text-sm font-medium text-ios-text">{{
              t("waitingList.form.notes")
            }}</span>
            <textarea
              v-model.trim="notes"
              data-testid="notes-input"
              class="mt-2 w-full rounded-2xl border-0 bg-ios-bg px-4 py-3 text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue transition-shadow duration-200 ease-out"
              rows="3"
              :placeholder="t('waitingList.form.notesPlaceholder')"
            />
          </label>

          <p
            v-if="formMessage"
            data-testid="form-message"
            class="text-sm text-ios-red"
          >
            {{ formMessage }}
          </p>

          <!-- Joining silently enrolled the customer in push. While web push is
               unlaunched that enrollment is skipped, so say so rather than let
               them assume a notification is coming. There is no control to grey
               out here -- the opt-in was implicit -- so this is a note, and it
               carries data-disabled but not aria-disabled, which belongs on
               widgets rather than static text. -->
          <p
            v-if="pushUnavailable"
            data-testid="waiting-list-push-unavailable"
            data-disabled="true"
            class="text-sm text-ios-secondary"
          >
            {{ PUSH_UNAVAILABLE_NOTE }}
          </p>

          <div class="space-y-3 pt-2">
            <button
              data-testid="join-button"
              class="w-full rounded-full bg-ios-blue px-5 py-3.5 font-semibold text-white active:scale-[0.98] transition-transform duration-200 ease-out disabled:opacity-60"
              type="submit"
              :disabled="isSubmitting"
            >
              {{ t("waitingList.join.submit") }}
            </button>
            <button
              data-testid="lookup-button"
              class="w-full rounded-full bg-white px-5 py-3.5 font-semibold text-ios-blue shadow-card-sm active:scale-[0.98] transition-transform duration-200 ease-out disabled:opacity-60"
              type="button"
              :disabled="isSubmitting"
              @click="handleLookup"
            >
              {{ t("waitingList.join.lookup") }}
            </button>
            <button
              data-testid="history-button"
              class="w-full rounded-full bg-white px-5 py-3.5 font-semibold text-ios-text shadow-card-sm active:scale-[0.98] transition-transform duration-200 ease-out disabled:opacity-60"
              type="button"
              :disabled="isSubmitting"
              @click="handleHistory"
            >
              {{ t("waitingList.join.history") }}
            </button>
          </div>
        </form>
      </section>

      <section
        v-if="queueStatus || waitEstimate"
        data-testid="queue-summary"
        class="bg-white rounded-2xl shadow-card p-5 grid grid-cols-2 gap-4 animate-slide-up"
      >
        <div>
          <p class="text-xs text-ios-secondary">
            {{ t("waitingList.join.nowWaiting") }}
          </p>
          <p class="mt-1 text-2xl font-semibold text-ios-text">
            {{ queueStatus?.totalWaiting ?? "-" }}
          </p>
        </div>
        <div>
          <p class="text-xs text-ios-secondary">
            {{ t("waitingList.join.estimatedWait") }}
          </p>
          <p class="mt-1 text-2xl font-semibold text-ios-text">
            {{
              tWithParams("waitingList.minutesShort", {
                minutes:
                  waitEstimate?.estimatedWaitMinutes ??
                  queueStatus?.averageWaitMinutes ??
                  "-",
              })
            }}
          </p>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { QueueListIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/composables/useI18n";
import {
  isTerminalWaitingStatus,
  WAITING_LIST_LAST_TICKET_KEY,
  type LastWaitingTicket,
} from "@/composables/useWaitingTicket";
import { waitingListApi } from "@/services/waitingListApi";
import { hasCustomerAccessToken } from "@/services/customerAccessToken";
import customerPushService from "@/utils/push-notifications";
import { useFeatureAvailability } from "@/composables/useFeatureAvailability";
import type {
  JoinWaitingListRequest,
  QueueStatus,
  WaitingListResponse,
  WaitTimeEstimateResult,
} from "@makanmasak/shared-types";

const props = defineProps<{
  restaurantId: string;
}>();

const router = useRouter();
const { t, tWithParams } = useI18n();
const { isDisabled } = useFeatureAvailability();

/**
 * TODO(i18n): hard-coded zh-TW because the customer-app locale files were being
 * edited in a concurrent change when this landed, and no existing key carries a
 * "not yet available" string. Move to a `waitingList.*` key with the rest.
 */
const PUSH_UNAVAILABLE_NOTE =
  "推播通知尚未開放，請留在本頁或用手機號碼查詢候位";

const pushUnavailable = computed(() => isDisabled("customerWebPush"));

const customerName = ref("");
const customerPhone = ref("");
const partySize = ref(2);
const notes = ref("");
const queueStatus = ref<QueueStatus | null>(null);
const waitEstimate = ref<WaitTimeEstimateResult | null>(null);
const formMessage = ref("");
const isSubmitting = ref(false);

const partySizes = [1, 2, 3, 4, 5, 6, 7, 8];

const normalizedPhone = computed(() =>
  customerPhone.value.replace(/[-\s]/g, ""),
);

const isValidPhone = () => /^09\d{8}$/.test(normalizedPhone.value);

const ticketPath = (ticketId: string) =>
  `/r/${props.restaurantId}/wait-list/${ticketId}`;

const persistTicket = (ticket: WaitingListResponse) => {
  const lastTicket: LastWaitingTicket = {
    ticketId: ticket.id,
    restaurantId: ticket.restaurantId,
    customerPhone: ticket.customerPhone,
  };
  localStorage.setItem(
    WAITING_LIST_LAST_TICKET_KEY,
    JSON.stringify(lastTicket),
  );
};

const routeToTicket = (ticket: WaitingListResponse) => {
  persistTicket(ticket);
  void router.push(ticketPath(ticket.id));
};

const enrollWaitingListPush = async () => {
  // Web push is built but unlaunched. Joining must not raise a permission
  // prompt or send a subscribe request for notifications the API cannot
  // deliver; the note above the buttons is what tells the customer instead.
  if (pushUnavailable.value || !hasCustomerAccessToken()) {
    return;
  }

  try {
    const permission = await customerPushService.requestPermission();
    if (permission === "granted") {
      await customerPushService.subscribe();
    }
  } catch (error) {
    console.warn("Waiting-list push enrollment failed:", error);
  }
};

const validatePhoneOrMessage = () => {
  if (isValidPhone()) {
    formMessage.value = "";
    return true;
  }

  formMessage.value = t("waitingList.errors.invalidPhone");
  return false;
};

const handleJoin = async () => {
  if (!validatePhoneOrMessage()) {
    return;
  }

  isSubmitting.value = true;
  formMessage.value = "";

  try {
    const request: JoinWaitingListRequest = {
      restaurantId: props.restaurantId,
      customerName: customerName.value,
      customerPhone: normalizedPhone.value,
      partySize: partySize.value,
      notes: notes.value || undefined,
    };
    const ticket = await waitingListApi.join(request);
    // The ticket first: awaiting enrollment left a diner who had not answered
    // the browser's permission prompt on a disabled form, with the number they
    // had just taken neither shown nor saved.
    routeToTicket(ticket);
    void enrollWaitingListPush();
  } catch {
    formMessage.value = t("waitingList.errors.joinFailed");
  } finally {
    isSubmitting.value = false;
  }
};

const handleLookup = async () => {
  if (!validatePhoneOrMessage()) {
    return;
  }

  isSubmitting.value = true;
  formMessage.value = "";

  try {
    const ticket = await waitingListApi.lookup(
      props.restaurantId,
      normalizedPhone.value,
    );
    routeToTicket(ticket);
  } catch {
    formMessage.value = t("waitingList.errors.lookupFailed");
  } finally {
    isSubmitting.value = false;
  }
};

const handleHistory = () => {
  void router.push(`/r/${props.restaurantId}/wait-list/history`);
};

const loadQueueSnapshot = async () => {
  queueStatus.value = await waitingListApi.getQueueStatus(props.restaurantId);
  waitEstimate.value = await waitingListApi.estimateWait(
    props.restaurantId,
    partySize.value,
  );
};

const restoreLastTicket = async (): Promise<boolean> => {
  const raw = localStorage.getItem(WAITING_LIST_LAST_TICKET_KEY);
  if (!raw) {
    return false;
  }

  try {
    const parsed = JSON.parse(raw) as LastWaitingTicket;
    if (parsed.restaurantId !== props.restaurantId) {
      return false;
    }

    const ticket = await waitingListApi.getById(parsed.ticketId);
    if (isTerminalWaitingStatus(ticket.status)) {
      localStorage.removeItem(WAITING_LIST_LAST_TICKET_KEY);
      return false;
    }

    await router.replace(ticketPath(ticket.id));
    return true;
  } catch {
    localStorage.removeItem(WAITING_LIST_LAST_TICKET_KEY);
    return false;
  }
};

watch(partySize, () => {
  void waitingListApi
    .estimateWait(props.restaurantId, partySize.value)
    .then((estimate) => {
      waitEstimate.value = estimate;
      formMessage.value = "";
    })
    .catch(() => {
      waitEstimate.value = null;
      formMessage.value = t("waitingList.errors.estimateFailed");
    });
});

onMounted(async () => {
  const restored = await restoreLastTicket();
  if (!restored) {
    await loadQueueSnapshot();
  }
});
</script>
