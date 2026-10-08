// @vitest-environment jsdom

import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOrders: vi.fn(),
  info: vi.fn(),
  handleSSEEvent: vi.fn(),
  subscriptions: new Map<string, (event: unknown) => void>(),
  unsubscribe: vi.fn(),
  connect: vi.fn(),
  status: null as null | { value: string },
}));

vi.mock("pinia", async (importOriginal) => {
  const { toRefs } = await import("vue");
  return {
    ...(await importOriginal<typeof import("pinia")>()),
    storeToRefs: (store: object) => toRefs(store as Record<string, unknown>),
  };
});

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: mocks.info }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      `${key}:${params?.name ?? ""}`,
  }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    isChef: true,
    restaurantId: "r1",
    user: { name: "Chef" },
  }),
}));
vi.mock("@/stores/settings", () => ({
  // Auto-refresh off: the reconnect catch-up is the only thing that fetches.
  useSettingsStore: () => ({ autoRefresh: false, refreshInterval: 30 }),
}));
vi.mock("@/stores/orders", async () => {
  const { reactive } = await import("vue");
  return {
    useOrdersStore: () =>
      reactive({
        orders: [],
        stats: {},
        loading: false,
        error: null,
        fetchOrders: mocks.fetchOrders,
        handleSSEEvent: mocks.handleSSEEvent,
      }),
  };
});
vi.mock("@/stores/orderManagement", () => ({
  useOrderManagementStore: () => ({
    filterOrders: (orders: unknown[]) => orders,
    sortOrders: (orders: unknown[]) => orders,
    updateOrderPriorities: (orders: unknown[]) => orders,
  }),
}));
vi.mock("@/composables/useAudioNotifications", () => ({
  useAudioNotifications: () => ({ handleSSEEvent: vi.fn() }),
}));
vi.mock("@/services/realtimeService", async () => {
  const { ref, computed } = await import("vue");
  const status = ref("disconnected");
  mocks.status = status;
  return {
    useKitchenRealtimeService: () => ({
      status,
      isConnected: computed(() => status.value === "connected"),
      subscribe: vi.fn(
        (types: string[], callback: (event: unknown) => void) => {
          const id = types.join(",");
          mocks.subscriptions.set(id, callback);
          return id;
        },
      ),
      unsubscribe: mocks.unsubscribe,
      connect: mocks.connect,
      disconnect: vi.fn(),
    }),
  };
});

import EnhancedKitchenDashboard from "./EnhancedKitchenDashboard.vue";

describe("EnhancedKitchenDashboard realtime catch-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscriptions.clear();
    mocks.status!.value = "disconnected";
    mocks.connect.mockImplementation(async () => {
      mocks.status!.value = "connected";
    });
  });

  it("does not subscribe or connect after unmount during initial order loading", async () => {
    let finish!: () => void;
    mocks.fetchOrders.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = shallowMount(EnhancedKitchenDashboard, {
      props: { restaurantId: "r1" },
    });
    wrapper.unmount();
    finish();
    await flushPromises();
    expect(mocks.subscriptions.size).toBe(0);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("shows menu supply notifications without invoking the order reducer", async () => {
    const wrapper = shallowMount(EnhancedKitchenDashboard, {
      props: { restaurantId: "r1" },
    });
    await flushPromises();
    const callback = mocks.subscriptions.get("menu_availability_update");
    expect(callback).toBeTypeOf("function");
    callback?.({
      type: "menu_availability_update",
      restaurantId: "other",
      data: { menuItemName: "Laksa", isAvailable: false },
    });
    expect(mocks.info).not.toHaveBeenCalled();
    callback?.({
      type: "menu_availability_update",
      restaurantId: "r1",
      data: { menuItemName: "Laksa", isAvailable: false },
    });
    expect(mocks.info).toHaveBeenCalledWith("realtime.menuUnavailable:Laksa");
    callback?.({
      type: "menu_availability_update",
      restaurantId: "r1",
      data: { menuItemName: "Laksa", isAvailable: true, inventoryCount: 0 },
    });
    expect(mocks.info).toHaveBeenLastCalledWith(
      "realtime.menuUnavailable:Laksa",
    );
    expect(mocks.handleSSEEvent).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledWith("menu_availability_update");
  });

  it("refetches orders when the socket reconnects, not on the first connect", async () => {
    const wrapper = shallowMount(EnhancedKitchenDashboard, {
      props: { restaurantId: "r1" },
    });
    await flushPromises();

    // Initial load only; the first "connected" must not fetch a second time.
    expect(mocks.connect).toHaveBeenCalledWith("r1");
    expect(mocks.fetchOrders).toHaveBeenCalledOnce();

    mocks.status!.value = "reconnecting";
    await flushPromises();
    mocks.status!.value = "connected";
    await flushPromises();

    expect(mocks.fetchOrders).toHaveBeenCalledTimes(2);
    expect(mocks.fetchOrders).toHaveBeenLastCalledWith("r1");
    wrapper.unmount();
  });
});
