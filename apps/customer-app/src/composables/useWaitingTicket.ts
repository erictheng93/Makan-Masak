import { computed, onMounted, onUnmounted, ref } from "vue";
import { waitingListApi } from "@/services/waitingListApi";
import {
  WaitingStatus,
  type WaitingListResponse,
} from "@makanmasak/shared-types";

const DEFAULT_POLL_MS = 10000;
const CALLED_POLL_MS = 5000;

export const WAITING_LIST_LAST_TICKET_KEY = "wl:lastTicket";

export interface LastWaitingTicket {
  ticketId: string;
  restaurantId: string;
  customerPhone: string;
}

export const terminalWaitingStatuses = new Set<WaitingStatus>([
  WaitingStatus.SEATED,
  WaitingStatus.CANCELLED,
  WaitingStatus.EXPIRED,
  WaitingStatus.NO_SHOW,
]);

export const isTerminalWaitingStatus = (
  status?: WaitingStatus | string,
): boolean => {
  return terminalWaitingStatuses.has(status as WaitingStatus);
};

export function useWaitingTicket(ticketId: string) {
  const ticket = ref<WaitingListResponse | null>(null);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);
  const intervalMs = ref(DEFAULT_POLL_MS);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const isTerminal = computed(() =>
    isTerminalWaitingStatus(ticket.value?.status),
  );

  const clearPolling = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const syncPollingInterval = () => {
    if (isTerminal.value || document.hidden) {
      clearPolling();
      return;
    }

    const nextInterval =
      ticket.value?.status === WaitingStatus.CALLED
        ? CALLED_POLL_MS
        : DEFAULT_POLL_MS;

    if (intervalId !== null && intervalMs.value === nextInterval) {
      return;
    }

    clearPolling();
    intervalMs.value = nextInterval;
    intervalId = setInterval(() => {
      void fetchTicket().catch(() => undefined);
    }, nextInterval);
  };

  const fetchTicket = async () => {
    isLoading.value = true;
    error.value = null;

    try {
      ticket.value = await waitingListApi.getById(ticketId);
      localStorage.setItem(
        WAITING_LIST_LAST_TICKET_KEY,
        JSON.stringify({
          ticketId: ticket.value.id,
          restaurantId: ticket.value.restaurantId,
          customerPhone: ticket.value.customerPhone,
        } satisfies LastWaitingTicket),
      );

      if (isTerminalWaitingStatus(ticket.value.status)) {
        localStorage.removeItem(WAITING_LIST_LAST_TICKET_KEY);
      }

      syncPollingInterval();
    } catch (caught) {
      error.value =
        caught instanceof Error ? caught : new Error(String(caught));
      throw caught;
    } finally {
      isLoading.value = false;
    }
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      clearPolling();
      return;
    }

    void fetchTicket().catch(() => undefined);
  };

  onMounted(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden) {
      void fetchTicket().catch(() => undefined);
      syncPollingInterval();
    }
  });

  onUnmounted(() => {
    clearPolling();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  return {
    ticket,
    isLoading,
    error,
    intervalMs,
    isTerminal,
    refetch: fetchTicket,
    stopPolling: clearPolling,
  };
}
