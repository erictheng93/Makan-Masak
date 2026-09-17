import { mount } from "@vue/test-utils";
import { ref } from "vue";
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

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => toast,
}));

vi.mock("@tanstack/vue-query", () => ({
  useQueryClient: () => queryClient,
  useQuery: () => ({
    data: ref(null),
    isLoading: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: cancelPending }),
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
  },
}));

function mountView() {
  return mount(OrderTrackingView, {
    props: {
      restaurantId: "restaurant-1",
      tableId: 7,
      orderId: "1001",
    },
    shallow: true,
  });
}

describe("OrderTrackingView guest realtime URL", () => {
  beforeEach(() => {
    websocketOptions.current = null;
    vi.mocked(orderApi.getGuestRealtimeToken).mockReset();
    localStorage.setItem("guest_auth_token", "guest-token");
    localStorage.setItem("makanmakan_table_qr:restaurant-1:7", "signed-qr");
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
