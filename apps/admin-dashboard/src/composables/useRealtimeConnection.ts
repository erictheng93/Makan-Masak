import { computed, readonly, ref } from "vue";
import {
  ORDER_STATUSES,
  RealtimeEventType,
  type OrderStatus,
  type RealtimeEvent,
} from "@makanmasak/shared-types";
import { isTokenExpired } from "@makanmasak/utils";
import { useAuthStore } from "@/stores/auth";
import { useNotificationStore } from "@/stores/notification";
import { useOrderStore } from "@/stores/order";
import { useWebSocketService } from "@/services/websocketService";

const reconnectAttempts = ref(0);
const subscriptionIds = ref<string[]>([]);

const realtimeEventTypes = [
  RealtimeEventType.NEW_ORDER,
  RealtimeEventType.ORDER_STATUS_UPDATE,
  RealtimeEventType.ORDER_ITEM_STATUS_UPDATE,
  RealtimeEventType.ORDER_CANCELLED,
  RealtimeEventType.MENU_AVAILABILITY_UPDATE,
  RealtimeEventType.MENU_ITEM_UPDATE,
  RealtimeEventType.SYSTEM_NOTIFICATION,
  RealtimeEventType.RESTAURANT_STATUS_UPDATE,
];

export function buildRealtimeWebSocketUrl(
  restaurantId: string | number,
  token: string,
): string {
  const baseUrl = import.meta.env.VITE_REALTIME_WS_URL;
  if (!baseUrl) {
    throw new Error("VITE_REALTIME_WS_URL is required");
  }

  const url = new URL(`/admin/${restaurantId}`, baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function useRealtimeConnection() {
  const authStore = useAuthStore();
  const notificationStore = useNotificationStore();
  const orderStore = useOrderStore();
  const realtimeService = useWebSocketService();

  const isConnected = computed(() => realtimeService.isConnected.value);
  const status = computed(() => realtimeService.status.value);

  const connect = async () => {
    if (!authStore.isAuthenticated || !authStore.restaurantId) {
      return;
    }

    let token = authStore.token;
    if (!token) {
      console.warn("Realtime: No auth token available, skipping connection");
      return;
    }

    if (isTokenExpired(token, 30)) {
      const refreshed = await authStore.refreshToken({
        clearOnAuthFailure: false,
      });
      if (!refreshed) {
        console.warn(
          "Realtime: Token expired and refresh failed, skipping connection",
        );
        return;
      }
      token = authStore.token;
      if (!token) return;
    }

    ensureSubscriptions();
    await realtimeService.connect(String(authStore.restaurantId));
  };

  const disconnect = () => {
    clearSubscriptions();
    realtimeService.disconnect();
    reconnectAttempts.value = 0;
  };

  const ensureSubscriptions = () => {
    if (subscriptionIds.value.length > 0) {
      return;
    }

    const subscriptionId = realtimeService.subscribe(
      realtimeEventTypes,
      handleRealtimeEvent,
    );
    subscriptionIds.value = [subscriptionId];
  };

  const clearSubscriptions = () => {
    for (const subscriptionId of subscriptionIds.value) {
      realtimeService.unsubscribe(subscriptionId);
    }
    subscriptionIds.value = [];
  };

  const handleRealtimeEvent = (event: RealtimeEvent) => {
    switch (event.type) {
      case RealtimeEventType.NEW_ORDER:
      case RealtimeEventType.ORDER_STATUS_UPDATE:
      case RealtimeEventType.ORDER_ITEM_STATUS_UPDATE:
      case RealtimeEventType.ORDER_CANCELLED:
        handleOrderEvent(event);
        break;
      case RealtimeEventType.MENU_AVAILABILITY_UPDATE:
      case RealtimeEventType.MENU_ITEM_UPDATE:
        handleMenuUpdate(event.data);
        break;
      case RealtimeEventType.SYSTEM_NOTIFICATION:
        handleSystemNotification(event.data);
        break;
      case RealtimeEventType.RESTAURANT_STATUS_UPDATE:
        handleRestaurantStatusUpdate(event.data);
        break;
      default:
        console.log("Unknown realtime event type:", event.type);
    }
  };

  const handleOrderEvent = (event: RealtimeEvent) => {
    const data = event.data as Record<string, unknown>;
    const order =
      data.order !== null && typeof data.order === "object"
        ? (data.order as Record<string, unknown>)
        : data;

    const orderId =
      typeof order.id === "string"
        ? order.id
        : typeof order.orderId === "string"
          ? order.orderId
          : undefined;

    // ORDER_ITEM_STATUS_UPDATE carries an *item* status (OrderItemStatus); it
    // says nothing about the order's own status, so it must not be merged as
    // one.
    if (orderId && event.type !== RealtimeEventType.ORDER_ITEM_STATUS_UPDATE) {
      const status =
        event.type === RealtimeEventType.ORDER_CANCELLED
          ? ("cancelled" as OrderStatus)
          : (ORDER_STATUSES as readonly string[]).includes(
                order.status as string,
              )
            ? (order.status as OrderStatus)
            : undefined;

      const merged = orderStore.applyOrderStatusEvent(orderId, status);
      // Only a NEW_ORDER is legitimately absent from the loaded list. Anything
      // else that misses is an order outside the current page -- leave it be
      // rather than refetching on every event the shop isn't looking at.
      if (!merged && event.type === RealtimeEventType.NEW_ORDER) {
        void orderStore.refetchOrders();
      }
    }

    if (event.type === RealtimeEventType.NEW_ORDER) {
      maybeNotifyNewOrder(data);
    }

    if (event.type === RealtimeEventType.ORDER_STATUS_UPDATE) {
      maybeNotifyReadyOrder(data);
    }
  };

  const maybeNotifyNewOrder = (data: Record<string, unknown>) => {
    const userRole = authStore.userRole;
    if (userRole !== 0 && userRole !== 1 && userRole !== 2) {
      return;
    }

    notificationStore.addNotification({
      type: "info",
      title: "New order",
      message: `Table ${data.tableName ?? data.tableNumber ?? "-"} placed order #${data.orderNumber ?? data.orderId ?? data.id}`,
      sound: true,
    });
  };

  const maybeNotifyReadyOrder = (data: Record<string, unknown>) => {
    const userRole = authStore.userRole;
    if (
      data.status !== "ready" ||
      (userRole !== 0 && userRole !== 1 && userRole !== 3)
    ) {
      return;
    }

    notificationStore.addNotification({
      type: "success",
      title: "Order ready",
      message: `Order #${data.orderNumber ?? data.orderId ?? data.id} is ready`,
      sound: true,
    });
  };

  const handleMenuUpdate = (_data: unknown) => {
    notificationStore.addNotification({
      type: "info",
      title: "Menu updated",
      message: "Menu data has changed. Refresh if the latest menu is needed.",
    });
  };

  const handleSystemNotification = (data: Record<string, unknown>) => {
    const type =
      data.level === "success" ||
      data.level === "warning" ||
      data.level === "error"
        ? data.level
        : "info";
    notificationStore.addNotification({
      type,
      title:
        typeof data.title === "string" ? data.title : "System notification",
      message: typeof data.message === "string" ? data.message : "",
      persistent: data.persistent === true || data.persistUntilRead === true,
    });
  };

  const handleRestaurantStatusUpdate = (data: Record<string, unknown>) => {
    notificationStore.addNotification({
      type: "info",
      title: "Restaurant status updated",
      message:
        typeof data.message === "string"
          ? data.message
          : "Restaurant realtime status changed.",
    });
  };

  return {
    isConnected: readonly(isConnected),
    status: readonly(status),
    connect,
    disconnect,
    reconnectAttempts: readonly(reconnectAttempts),
  };
}

export default useRealtimeConnection;
