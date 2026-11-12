import { onBeforeUnmount, watch } from "vue";
import { RealtimeEventType } from "@makanmasak/shared-types";
import { useWebSocketService } from "@/services/websocketService";

const ORDER_EVENTS = [
  RealtimeEventType.NEW_ORDER,
  RealtimeEventType.ORDER_STATUS_UPDATE,
  RealtimeEventType.ORDER_ITEM_STATUS_UPDATE,
  RealtimeEventType.ORDER_CANCELLED,
];
const DEBOUNCE_MS = 1_000;

/**
 * Refetches when the realtime socket says an order changed, so a view does not
 * have to poll while the socket is up. Pass `isLive` to the view's poller.
 *
 * Also refetches whenever the socket (re)connects: events sent while it was
 * down are gone, and the server drops the event that hits an expired token.
 */
export function useLiveOrderRefresh(refresh: () => unknown) {
  const ws = useWebSocketService();
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Debounced: one order moving through the kitchen emits a burst of events.
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, DEBOUNCE_MS);
  };

  const subscriptionId = ws.subscribe(ORDER_EVENTS, schedule);
  const stopWatch = watch(ws.isConnected, (connected) => {
    if (connected) schedule();
  });

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    ws.unsubscribe(subscriptionId);
    stopWatch();
  });

  return { isLive: () => ws.isConnected.value };
}
