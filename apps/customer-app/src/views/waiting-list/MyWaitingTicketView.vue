<template>
  <div class="min-h-screen bg-ios-bg text-ios-text">
    <main class="max-w-md mx-auto px-4 py-8 space-y-5">
      <section class="bg-white rounded-2xl shadow-card p-6 animate-slide-up">
        <div v-if="isLoading && !ticket" class="py-12 text-center">
          <div
            class="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-ios-blue/20 border-t-ios-blue animate-spin"
          />
          <p class="text-ios-secondary">
            {{ t("waitingList.ticket.loading") }}
          </p>
        </div>

        <div v-else-if="error && !ticket" class="py-12 text-center">
          <XCircleIcon class="mx-auto mb-4 h-12 w-12 text-ios-red" />
          <p class="font-medium text-ios-text">
            {{ t("waitingList.errors.ticketLoadFailed") }}
          </p>
        </div>

        <div v-else-if="ticket" class="space-y-6">
          <div class="text-center">
            <p class="text-sm text-ios-secondary">
              {{ t("waitingList.ticket.queueNumber") }}
            </p>
            <p
              data-testid="queue-number"
              class="mt-2 text-7xl font-bold tracking-wider text-ios-text"
            >
              {{ ticket.queueDisplay }}
            </p>
            <p
              data-testid="ticket-status"
              :class="[
                'mt-4 text-lg font-semibold transition-colors duration-200 ease-out',
                statusColorClass,
              ]"
            >
              {{ statusLabel }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-2xl bg-ios-bg p-4">
              <p class="text-xs text-ios-secondary">
                {{ t("waitingList.ticket.partiesAhead") }}
              </p>
              <p
                data-testid="parties-ahead"
                class="mt-1 text-2xl font-semibold text-ios-text"
              >
                {{ ticket.partiesAhead }}
              </p>
            </div>
            <div class="rounded-2xl bg-ios-bg p-4">
              <p class="text-xs text-ios-secondary">
                {{ t("waitingList.ticket.estimatedWait") }}
              </p>
              <p class="mt-1 text-2xl font-semibold text-ios-text">
                {{
                  tWithParams("waitingList.minutesShort", {
                    minutes: ticket.estimatedWaitMinutes ?? "-",
                  })
                }}
              </p>
            </div>
          </div>

          <div class="space-y-3 text-sm">
            <div class="flex justify-between gap-4">
              <span class="text-ios-secondary">{{
                t("waitingList.form.name")
              }}</span>
              <span class="font-medium text-ios-text">{{
                ticket.customerName
              }}</span>
            </div>
            <div class="flex justify-between gap-4">
              <span class="text-ios-secondary">{{
                t("waitingList.form.partySize")
              }}</span>
              <span class="font-medium text-ios-text">{{
                tWithParams("waitingList.form.partySizeOption", {
                  size: ticket.partySize,
                })
              }}</span>
            </div>
          </div>

          <p
            v-if="actionMessage"
            data-testid="action-message"
            class="text-sm text-ios-red"
          >
            {{ actionMessage }}
          </p>

          <div class="space-y-3">
            <button
              v-if="canPreOrder"
              data-testid="preorder-button"
              class="w-full rounded-full bg-ios-blue px-5 py-3.5 font-semibold text-white active:scale-[0.98] transition-transform duration-200 ease-out disabled:opacity-60"
              type="button"
              :disabled="isActing"
              @click="handlePreOrder"
            >
              {{ t("waitingList.ticket.preOrder") }}
            </button>
            <button
              v-if="canConfirmArrival"
              data-testid="confirm-arrival-button"
              class="w-full rounded-full bg-ios-green px-5 py-3.5 font-semibold text-white active:scale-[0.98] transition-transform duration-200 ease-out disabled:opacity-60"
              type="button"
              :disabled="isActing"
              @click="handleConfirmArrival"
            >
              {{ t("waitingList.ticket.confirmArrival") }}
            </button>
            <button
              v-if="canCancel"
              data-testid="cancel-ticket-button"
              class="w-full rounded-full bg-ios-red/10 px-5 py-3.5 font-semibold text-ios-red active:scale-[0.98] transition-transform duration-200 ease-out disabled:opacity-60"
              type="button"
              :disabled="isActing"
              @click="handleCancel"
            >
              {{ t("waitingList.ticket.cancel") }}
            </button>
            <template v-if="isTerminal">
              <button
                data-testid="rejoin-queue-button"
                class="w-full rounded-full bg-ios-blue px-5 py-3.5 font-semibold text-white active:scale-[0.98] transition-transform duration-200 ease-out"
                type="button"
                @click="handleRejoin"
              >
                {{ t("waitingList.ticket.rejoin") }}
              </button>
              <button
                data-testid="back-home-button"
                class="w-full rounded-full bg-white px-5 py-3.5 font-semibold text-ios-blue shadow-card-sm active:scale-[0.98] transition-transform duration-200 ease-out"
                type="button"
                @click="handleBackHome"
              >
                {{ t("waitingList.ticket.backHome") }}
              </button>
            </template>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { XCircleIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/composables/useI18n";
import {
  isTerminalWaitingStatus,
  useWaitingTicket,
  WAITING_LIST_LAST_TICKET_KEY,
} from "@/composables/useWaitingTicket";
import { waitingListApi } from "@/services/waitingListApi";
import { WaitingStatus } from "@makanmasak/shared-types";

const props = defineProps<{
  restaurantId: string;
  ticketId: string;
}>();

const router = useRouter();
const { t, tWithParams } = useI18n();
const { ticket, isLoading, error, isTerminal, refetch } = useWaitingTicket(
  props.ticketId,
);
const actionMessage = ref("");
const isActing = ref(false);

const statusLabel = computed(() =>
  ticket.value?.status
    ? t(`waitingList.status.${ticket.value.status}`)
    : t("waitingList.status.unknown"),
);

const statusColorClass = computed(() => {
  switch (ticket.value?.status) {
    case WaitingStatus.CALLED:
      return "text-ios-green animate-pulse";
    case WaitingStatus.EXPIRED:
      return "text-ios-red";
    case WaitingStatus.SEATED:
      return "text-ios-green";
    case WaitingStatus.CANCELLED:
      return "text-ios-secondary";
    default:
      return "text-ios-secondary";
  }
});

const canCancel = computed(
  () => !!ticket.value && !isTerminalWaitingStatus(ticket.value.status),
);

const canConfirmArrival = computed(
  () => ticket.value?.status === WaitingStatus.CALLED,
);

const canPreOrder = computed(
  () => !!ticket.value && !isTerminalWaitingStatus(ticket.value.status),
);

const handleCancel = async () => {
  if (!ticket.value) {
    return;
  }

  isActing.value = true;
  actionMessage.value = "";

  try {
    ticket.value = await waitingListApi.cancel(
      props.ticketId,
      ticket.value.customerPhone,
    );
    localStorage.removeItem(WAITING_LIST_LAST_TICKET_KEY);
  } catch {
    actionMessage.value = t("waitingList.errors.cancelFailed");
  } finally {
    isActing.value = false;
  }
};

const handleConfirmArrival = async () => {
  if (!ticket.value) {
    return;
  }

  isActing.value = true;
  actionMessage.value = "";

  try {
    ticket.value = await waitingListApi.confirmArrival(
      props.ticketId,
      ticket.value.customerPhone,
    );
    await refetch();
  } catch {
    actionMessage.value = t("waitingList.errors.confirmFailed");
  } finally {
    isActing.value = false;
  }
};

const handleRejoin = () => {
  void router.push(`/r/${props.restaurantId}/wait-list`);
};

const handleBackHome = () => {
  void router.push("/");
};

const handlePreOrder = () => {
  if (!ticket.value) {
    return;
  }

  void router.push({
    name: "ShopMenu",
    params: { restaurantId: props.restaurantId },
    query: {
      waitingTicketId: props.ticketId,
      phone: ticket.value.customerPhone.slice(-3),
    },
  });
};
</script>
