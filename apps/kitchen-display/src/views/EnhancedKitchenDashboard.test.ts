// @vitest-environment jsdom

import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOrders: vi.fn(),
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
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

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
        handleSSEEvent: vi.fn(),
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
      subscribe: vi.fn(() => "sub-1"),
      unsubscribe: vi.fn(),
      connect: mocks.connect,
      disconnect: vi.fn(),
    }),
  };
});

import EnhancedKitchenDashboard from "./EnhancedKitchenDashboard.vue";

describe("EnhancedKitchenDashboard realtime catch-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status!.value = "disconnected";
    mocks.connect.mockImplementation(async () => {
      mocks.status!.value = "connected";
    });
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
