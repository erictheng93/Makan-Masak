import { defineStore } from "pinia";
import { ref, computed, readonly } from "vue";
import type { Order, OrderStatus } from "@/types";
import { api, unwrapApiList } from "@/services/api";
import { t } from "@/i18n";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

interface FetchOrdersParams {
  status?: OrderStatus[];
  page?: number;
  limit?: number;
  date?: string;
  orderType?: "shop" | "table" | "seat";
  fulfillmentType?: "dine_in" | "takeaway" | "delivery";
  orderSource?: string;
  search?: string;
}

export const useOrderStore = defineStore("order", () => {
  const orders = ref<Order[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const pagination = ref({ page: 1, limit: 20, total: 0, totalPages: 1 });
  let latestFetchRequest = 0;
  // What the list on screen was fetched with, so a background refresh (a
  // realtime NEW_ORDER, a poll) reloads the same filters and page instead of
  // resetting them.
  let lastFetchParams: FetchOrdersParams | undefined;

  // Computed properties
  const pendingOrders = computed(() =>
    orders.value.filter((order) => order.status === "pending"),
  );

  const confirmedOrders = computed(() =>
    orders.value.filter((order) => order.status === "confirmed"),
  );

  const preparingOrders = computed(() =>
    orders.value.filter((order) => order.status === "preparing"),
  );

  const readyOrders = computed(() =>
    orders.value.filter((order) => order.status === "ready"),
  );

  const completedOrders = computed(() =>
    orders.value.filter((order) =>
      (["delivered", "paid"] as OrderStatus[]).includes(order.status),
    ),
  );

  const pendingOrdersCount = computed(() => pendingOrders.value.length);
  const activeOrdersCount = computed(
    () =>
      orders.value.filter((order) =>
        (
          ["pending", "confirmed", "preparing", "ready"] as OrderStatus[]
        ).includes(order.status),
      ).length,
  );

  // Actions
  const fetchOrders = async (params?: FetchOrdersParams) => {
    lastFetchParams = params;
    const requestId = ++latestFetchRequest;
    isLoading.value = true;
    error.value = null;

    try {
      const queryParams = new URLSearchParams();

      if (params?.status) {
        queryParams.append("status", params.status.join(","));
      }
      if (params?.page) {
        queryParams.append("page", params.page.toString());
      }
      if (params?.limit) {
        queryParams.append("limit", params.limit.toString());
      }
      if (params?.date) {
        queryParams.append("date", params.date);
      }
      if (params?.orderType) queryParams.append("orderType", params.orderType);
      if (params?.fulfillmentType)
        queryParams.append("fulfillmentType", params.fulfillmentType);
      if (params?.orderSource)
        queryParams.append("orderSource", params.orderSource);
      if (params?.search) queryParams.append("search", params.search);

      const response = await api.get<Order[]>(
        `/orders?${queryParams.toString()}`,
      );

      if (requestId !== latestFetchRequest) return;

      if (response.data.success && response.data.data) {
        // Defensive: handle double-wrapped cache responses where
        // response.data.data may be {success, data: Order[], ...} instead of Order[]
        const payload = response.data.data;
        orders.value = unwrapApiList<Order>(payload);
        pagination.value = response.data.pagination ?? {
          page: params?.page ?? 1,
          limit: params?.limit ?? 20,
          total: orders.value.length,
          totalPages: 1,
        };
      }
    } catch (err: unknown) {
      if (requestId !== latestFetchRequest) return;

      // The resolver deliberately drops the server's sentence; keep it here,
      // where it helps whoever is reading the console rather than the shop.
      console.error("Failed to fetch orders:", err);
      error.value = resolveUserFacingError(err, t, {
        fallbackKey: "orderStore.fetchFailed",
      }).message;
    } finally {
      if (requestId === latestFetchRequest) {
        isLoading.value = false;
      }
    }
  };

  const refetchOrders = () => fetchOrders(lastFetchParams);

  const updateOrderStatus = async (orderId: string, status: OrderStatus) => {
    try {
      const response = await api.put(`/orders/${orderId}/status`, { status });

      if (response.data.success) {
        const orderIndex = orders.value.findIndex((o) => o.id === orderId);
        if (orderIndex > -1) {
          orders.value[orderIndex].status = status;
          orders.value[orderIndex].updatedAt = Date.now();

          if (status === "delivered") {
            orders.value[orderIndex].completedAt = new Date().toISOString();
          }
        }
        return true;
      }
      return false;
    } catch (err: unknown) {
      console.error("Failed to update order status:", err);
      error.value = resolveUserFacingError(err, t, {
        fallbackKey: "orderStore.updateStatusFailed",
      }).message;
      return false;
    }
  };

  const updateOrder = (updatedOrder: Order) => {
    const index = orders.value.findIndex(
      (order) => order.id === updatedOrder.id,
    );
    if (index > -1) {
      orders.value[index] = updatedOrder;
    } else {
      // Add new order to the beginning of the list
      orders.value.unshift(updatedOrder);
    }
  };

  /**
   * Merge a realtime order event into the list.
   *
   * Realtime payloads are event summaries, not `Order`s: every order event in
   * packages/shared-types/src/realtime-events.ts keys on `orderId` and carries
   * no `id`, `table`, `customerInfo`, `totalAmount` or `createdAt`. Passing one
   * to `updateOrder` therefore missed on `id` and took its `unshift` branch,
   * growing a ghost row that rendered 外帶 / 匿名客戶 / NT$非數值 / Invalid Date
   * beside the real order. Assigning on a match would be just as wrong -- it
   * would overwrite a complete row with the summary -- so merge the one field
   * the event actually carries and report a miss instead of inventing a row.
   */
  const applyOrderStatusEvent = (orderId: string, status?: OrderStatus) => {
    const index = orders.value.findIndex((order) => order.id === orderId);
    if (index === -1) return false;

    if (status) {
      orders.value[index].status = status;
      orders.value[index].updatedAt = Date.now();
    }
    return true;
  };

  const removeOrder = (orderId: string) => {
    const index = orders.value.findIndex((order) => order.id === orderId);
    if (index > -1) {
      orders.value.splice(index, 1);
    }
  };

  const getOrderById = (orderId: string) => {
    return orders.value.find((order) => order.id === orderId);
  };

  const getOrdersByTable = (tableId: number) => {
    return orders.value.filter((order) => order.tableId === tableId);
  };

  const getOrdersByStatus = (status: OrderStatus) => {
    return orders.value.filter((order) => order.status === status);
  };

  const getTotalRevenue = (status?: OrderStatus) => {
    const filteredOrders = status
      ? orders.value.filter((order) => order.status === status)
      : orders.value.filter((order) => order.status === "delivered");

    return filteredOrders.reduce(
      (total, order) => total + order.totalAmount,
      0,
    );
  };

  const clearOrders = () => {
    orders.value = [];
    error.value = null;
  };

  // Kitchen specific actions
  const confirmOrder = (orderId: string) => {
    return updateOrderStatus(orderId, "confirmed");
  };

  const startPreparing = (orderId: string) => {
    return updateOrderStatus(orderId, "preparing");
  };

  const markReady = (orderId: string) => {
    return updateOrderStatus(orderId, "ready");
  };

  const completeOrder = (orderId: string) => {
    return updateOrderStatus(orderId, "delivered");
  };

  const cancelOrder = async (orderId: string, reason?: string) => {
    try {
      // ApiServiceCompat.delete(url, data) already wraps `data` into the axios
      // `{ data }` config, so pass the raw payload — passing `{ data: {...} }`
      // here would double-wrap and put the body on the wire as
      // `{"data":{"reason":...}}`, which the server ignores.
      const response = await api.delete(
        `/orders/${orderId}`,
        reason ? { reason } : undefined,
      );

      if (response.data.success) {
        const orderIndex = orders.value.findIndex((o) => o.id === orderId);
        if (orderIndex > -1) {
          orders.value[orderIndex].status = "cancelled";
          orders.value[orderIndex].updatedAt = Date.now();
        }
        return true;
      }
      return false;
    } catch (err: unknown) {
      console.error("Failed to cancel order:", err);
      error.value = resolveUserFacingError(err, t, {
        fallbackKey: "orderStore.cancelFailed",
      }).message;
      return false;
    }
  };

  /**
   * Order modification (#273). All three share one shape: send the version the
   * UI is holding, replace the local row with whatever the server returns, and
   * surface a failure as `error` rather than a thrown exception, matching
   * cancelOrder above.
   *
   * They return the updated order rather than a boolean because the caller
   * needs the new `version` to make its next edit, and re-fetching the list to
   * get it would race with the edit that is already in flight.
   */
  const applyServerOrder = (payload: unknown): Order | null => {
    const order = payload as Order | undefined;
    if (!order?.id) return null;
    updateOrder(order);
    return order;
  };

  const withOrderItemMutation = async (
    action: () => Promise<{ data: { success?: boolean; data?: unknown } }>,
    fallbackKey: string,
  ): Promise<Order | null> => {
    try {
      const response = await action();
      if (!response.data.success) return null;
      return applyServerOrder(response.data.data);
    } catch (err: unknown) {
      console.error(fallbackKey, err);
      error.value = resolveUserFacingError(err, t, { fallbackKey }).message;
      return null;
    }
  };

  const addOrderItems = async (
    orderId: string,
    items: Array<{ menuItemId: number; quantity: number; notes?: string }>,
    expectedVersion?: number,
  ) =>
    withOrderItemMutation(
      () => api.post(`/orders/${orderId}/items`, { items, expectedVersion }),
      "orderStore.addItemsFailed",
    );

  const changeOrderItemQuantity = async (
    orderId: string,
    itemId: number,
    quantity: number,
    expectedVersion?: number,
  ) =>
    withOrderItemMutation(
      () =>
        api.patch(`/orders/${orderId}/items/${itemId}`, {
          quantity,
          expectedVersion,
        }),
      "orderStore.changeItemFailed",
    );

  const removeOrderItem = async (
    orderId: string,
    itemId: number,
    expectedVersion?: number,
  ) => {
    // DELETE carries no body, so the version travels as a query parameter.
    const query =
      expectedVersion == null ? "" : `?expectedVersion=${expectedVersion}`;
    return withOrderItemMutation(
      () => api.delete(`/orders/${orderId}/items/${itemId}${query}`),
      "orderStore.removeItemFailed",
    );
  };

  return {
    orders: readonly(orders),
    isLoading: readonly(isLoading),
    error: readonly(error),
    pagination: readonly(pagination),
    pendingOrders,
    confirmedOrders,
    preparingOrders,
    readyOrders,
    completedOrders,
    pendingOrdersCount,
    activeOrdersCount,
    fetchOrders,
    refetchOrders,
    updateOrderStatus,
    updateOrder,
    applyOrderStatusEvent,
    removeOrder,
    getOrderById,
    getOrdersByTable,
    getOrdersByStatus,
    getTotalRevenue,
    clearOrders,
    confirmOrder,
    startPreparing,
    markReady,
    completeOrder,
    cancelOrder,
    addOrderItems,
    changeOrderItemQuantity,
    removeOrderItem,
  };
});
