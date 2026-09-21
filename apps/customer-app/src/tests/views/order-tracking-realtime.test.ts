import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderTrackingView from "@/views/OrderTrackingView.vue";
import { orderApi } from "@/services/orderApi";
import { RealtimeEventType } from "@makanmasak/shared-types";

const websocketOptions = vi.hoisted(() => ({
  current: null as null | {
    getUrl: () => Promise<string>;
    onMessage: (message: unknown) => void;
  },
}));

const routerPush = vi.hoisted(() => vi.fn());
const orderQueryData = ref<Record<string, unknown> | null>(null);
const queryClient = vi.hoisted(() => ({
  setQueryData: vi.fn(),
  getQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
// A plain `{ value }` stands in for the mutation's isPending ref.
const cancelPending = vi.hoisted(() => ({ value: false }));
const mutationOptions = vi.hoisted(() => ({
  current: null as null | { mutationFn: () => Promise<unknown> },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => toast,
}));

vi.mock("@tanstack/vue-query", () => ({
  useQueryClient: () => queryClient,
  useQuery: () => ({
    data: orderQueryData,
    isLoading: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  }),
  useMutation: (options: { mutationFn: () => Promise<unknown> }) => {
    mutationOptions.current = options;
    return { mutate: vi.fn(), isPending: cancelPending };
  },
}));

vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: (options: {
    getUrl: () => Promise<string>;
    onMessage: (message: unknown) => void;
  }) => {
    websocketOptions.current = options;
    return {
      connectionStatus: ref("disconnected"),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  },
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string) => key,
  }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (value: number) => String(value) }),
}));

vi.mock("@/services/orderApi", () => ({
  orderApi: {
    getGuestRealtimeToken: vi.fn(),
    getGuestOrder: vi.fn(),
    getOrder: vi.fn(),
    cancelOrder: vi.fn(),
    cancelGuestOrder: vi.fn(),
  },
}));

function mountView(props: Record<string, unknown> = {}) {
  return mount(OrderTrackingView, {
    props: {
      restaurantId: "restaurant-1",
      tableId: 7,
      orderId: "1001",
      ...props,
    },
    shallow: true,
  });
}

describe("OrderTrackingView guest realtime URL", () => {
  beforeEach(() => {
    websocketOptions.current = null;
    routerPush.mockReset();
    orderQueryData.value = null;
    queryClient.setQueryData.mockReset();
    queryClient.invalidateQueries.mockReset();
    queryClient.setQueryData.mockImplementation(
      (_key: unknown, updater: (current: unknown) => unknown) => {
        orderQueryData.value = updater(orderQueryData.value) as Record<
          string,
          unknown
        >;
      },
    );
    localStorage.clear();
    vi.mocked(orderApi.getGuestRealtimeToken).mockReset();
    localStorage.setItem("guest_auth_token", "guest-token");
    localStorage.setItem("makanmakan_table_qr:restaurant-1:7", "signed-qr");
  });

  it("uses the guest order token when a shop order has no signed table QR", async () => {
    vi.mocked(orderApi.getGuestRealtimeToken).mockResolvedValue({
      token: "realtime-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      wsUrl:
        "wss://realtime.example.test/customer/order:1001?token=realtime-token",
    });
    const wrapper = mountView({ tableId: 0, isShopOrder: true });

    await expect(websocketOptions.current?.getUrl()).resolves.toBe(
      "wss://realtime.example.test/customer/order:1001?token=realtime-token",
    );
    expect(orderApi.getGuestRealtimeToken).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      orderId: "1001",
      guestToken: "guest-token",
    });
    wrapper.unmount();
  });

  // A group member joins by invite link, never scans the table QR, and holds
  // only the order-scoped guest token that /tracking-token handed out (#396).
  it("uses the guest order token when a table order has no signed table QR", async () => {
    localStorage.clear();
    localStorage.setItem("guest_auth_token:1001", "member-guest-token");
    vi.mocked(orderApi.getGuestRealtimeToken).mockResolvedValue({
      token: "realtime-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      wsUrl:
        "wss://realtime.example.test/customer/order:1001?token=realtime-token",
    });
    const wrapper = mountView();

    await expect(websocketOptions.current?.getUrl()).resolves.toBe(
      "wss://realtime.example.test/customer/order:1001?token=realtime-token",
    );
    expect(orderApi.getGuestRealtimeToken).toHaveBeenCalledOnce();
    expect(orderApi.getGuestRealtimeToken).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      orderId: "1001",
      guestToken: "member-guest-token",
    });
    wrapper.unmount();
  });

  it("hides the table row and returns shop orders to the shop menu", async () => {
    orderQueryData.value = {
      id: "1001",
      orderNumber: "ORD-1001",
      createdAt: "2026-09-18T00:00:00.000Z",
      items: [],
      subtotal: 0,
      total: 0,
      status: "pending",
      table: null,
    };
    const wrapper = mountView({ tableId: 0, isShopOrder: true });

    expect(wrapper.text()).not.toContain("orderTracking.tableNumber");
    await wrapper.get('[data-testid="continue-ordering"]').trigger("click");
    expect(routerPush).toHaveBeenCalledWith(
      "/restaurant/restaurant-1/shop/menu",
    );
    wrapper.unmount();
  });

  it("updates a shop order's visible status from its order-scoped websocket event", async () => {
    orderQueryData.value = {
      id: "1001",
      orderNumber: "ORD-1001",
      createdAt: "2026-09-18T00:00:00.000Z",
      items: [],
      subtotal: 0,
      total: 0,
      status: "pending",
      table: null,
    };
    const wrapper = mountView({ tableId: 0, isShopOrder: true });

    websocketOptions.current?.onMessage({
      type: "order_status_update",
      timestamp: "2026-09-18T00:01:00.000Z",
      data: { orderId: "1001", status: "preparing" },
    });
    await nextTick();

    expect(wrapper.text()).toContain("orderTracking.status.preparing");
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["order", "1001"],
    });
    wrapper.unmount();
  });

  it("uses and caches the order-scoped WebSocket URL returned by the API", async () => {
    vi.mocked(orderApi.getGuestRealtimeToken).mockResolvedValue({
      token: "realtime-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      wsUrl:
        "wss://realtime.example.test/customer/order:1001?token=realtime-token",
    });
    const wrapper = mountView();

    const url = await websocketOptions.current?.getUrl();

    expect(url).toBe(
      "wss://realtime.example.test/customer/order:1001?token=realtime-token",
    );
    expect(
      JSON.parse(
        localStorage.getItem(
          "makanmakan_guest_realtime_token:restaurant-1:7:1001",
        ) ?? "{}",
      ),
    ).toMatchObject({
      token: "realtime-token",
      wsUrl:
        "wss://realtime.example.test/customer/order:1001?token=realtime-token",
    });
    wrapper.unmount();
  });

  it("reuses the cached order-scoped WebSocket URL", async () => {
    localStorage.setItem(
      "makanmakan_guest_realtime_token:restaurant-1:7:1001",
      JSON.stringify({
        token: "realtime-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
        wsUrl:
          "wss://realtime.example.test/customer/order:1001?token=realtime-token",
      }),
    );
    const wrapper = mountView();

    const url = await websocketOptions.current?.getUrl();

    expect(url).toBe(
      "wss://realtime.example.test/customer/order:1001?token=realtime-token",
    );
    expect(orderApi.getGuestRealtimeToken).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("OrderTrackingView realtime events", () => {
  const event = (type: RealtimeEventType, data: Record<string, unknown>) => ({
    type,
    eventId: "evt-1",
    timestamp: 1789646758873,
    restaurantId: "restaurant-1",
    data: { orderNumber: "ZSNE-7M3M", ...data },
  });

  beforeEach(() => {
    websocketOptions.current = null;
    cancelPending.value = false;
    queryClient.setQueryData.mockReset();
    queryClient.getQueryData.mockReset();
    queryClient.invalidateQueries.mockReset();
    toast.info.mockReset();
  });

  // The page listens on this order's customer room. Staff cancelling used to
  // reach only the staff rooms, and this handler dropped anything that was not
  // a status update, so an open page kept offering "取消訂單" until reloaded
  // (production, 2026-09-17).
  it("refetches and tells the diner when staff cancel the order", () => {
    queryClient.getQueryData.mockReturnValue({ id: "1001", status: "pending" });
    const wrapper = mountView();

    websocketOptions.current?.onMessage(
      event(RealtimeEventType.ORDER_CANCELLED, {
        orderId: "1001",
        reason: "Cancelled by user",
      }),
    );

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["order", "1001"],
    });
    expect(toast.info).toHaveBeenCalledWith("toast.orderCancelledByRestaurant");
    wrapper.unmount();
  });

  // The diner's own cancel button already confirms with toast.orderCancelled;
  // the server now echoes that cancellation to this page as well.
  it("does not announce a cancellation the diner is making themselves", () => {
    cancelPending.value = true;
    queryClient.getQueryData.mockReturnValue({ id: "1001", status: "pending" });
    const wrapper = mountView();

    websocketOptions.current?.onMessage(
      event(RealtimeEventType.ORDER_CANCELLED, { orderId: "1001" }),
    );

    expect(queryClient.invalidateQueries).toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does not announce a cancellation the page already shows", () => {
    queryClient.getQueryData.mockReturnValue({
      id: "1001",
      status: "cancelled",
    });
    const wrapper = mountView();

    websocketOptions.current?.onMessage(
      event(RealtimeEventType.ORDER_CANCELLED, { orderId: "1001" }),
    );

    expect(toast.info).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  // Staff edits (items added, a quantity changed, a discount) are republished
  // as NEW_ORDER. On this page it can only mean the order changed.
  it("refetches when staff change the order's lines", () => {
    const wrapper = mountView();

    websocketOptions.current?.onMessage(
      event(RealtimeEventType.NEW_ORDER, {
        orderId: "1001",
        items: [],
        totalAmount: 120,
      }),
    );

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["order", "1001"],
    });
    expect(toast.info).toHaveBeenCalledWith("toast.orderUpdatedByRestaurant");
    wrapper.unmount();
  });

  it("ignores events about another order", () => {
    const wrapper = mountView();

    for (const type of [
      RealtimeEventType.ORDER_CANCELLED,
      RealtimeEventType.NEW_ORDER,
      RealtimeEventType.ORDER_STATUS_UPDATE,
    ]) {
      websocketOptions.current?.onMessage(
        event(type, { orderId: "2002", status: "ready" }),
      );
    }

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("OrderTrackingView cancel button", () => {
  beforeEach(() => {
    vi.mocked(orderApi.cancelOrder).mockReset();
    vi.mocked(orderApi.cancelGuestOrder).mockReset();
    localStorage.setItem("guest_auth_token", "gt_guest-token");
  });

  // POST /orders/:id/cancel is staff-only, so a diner who ordered through a
  // table QR got 「你沒有執行此操作的權限」 (403). The page already reads a guest
  // order through /guest-orders; cancelling has to take the same route.
  it("cancels through the guest endpoint when the diner ordered as a guest", async () => {
    const wrapper = mountView();

    await mutationOptions.current?.mutationFn();

    expect(orderApi.cancelGuestOrder).toHaveBeenCalledWith("1001");
    expect(orderApi.cancelOrder).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
