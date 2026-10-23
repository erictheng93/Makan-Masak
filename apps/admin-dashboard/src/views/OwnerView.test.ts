// @vitest-environment jsdom

import { flushPromises, shallowMount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OwnerView from "./OwnerView.vue";

const apiGet = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ restaurantId: "rest-1" }));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => authState }));
vi.mock("@/services/api", () => ({
  api: { get: apiGet },
  unwrapApiList: (payload: unknown) =>
    Array.isArray(payload) ? payload : ((payload as { data?: [] })?.data ?? []),
}));
vi.mock("@/services/ownerService", () => ({
  ownerService: {
    listEmergencyAlerts: vi.fn().mockResolvedValue([]),
    getQuickActionRoute: vi.fn(),
  },
}));
vi.mock("@/services/schedulingService", () => ({
  schedulingService: { getClockedInEmployees: vi.fn().mockResolvedValue([]) },
}));

const ok = (data: unknown) => ({ data: { success: true, data } });
const dashboard = ok({
  summary: {
    todayRevenue: 0,
    todayOrders: 0,
    monthRevenue: 0,
    monthOrders: 0,
    growthRates: { revenueGrowth: 0, orderGrowth: 0 },
  },
});

function respondWith(overrides: Record<string, () => Promise<unknown>> = {}) {
  apiGet.mockImplementation((url: string) => {
    const key = Object.keys(overrides).find((k) => url.startsWith(k));
    if (key) return overrides[key]();
    if (url.startsWith("/analytics/dashboard"))
      return Promise.resolve(dashboard);
    if (url.startsWith("/users/stats"))
      return Promise.resolve(
        ok({
          summary: { total_users: 0, active_users: 0, inactive_users: 0 },
        }),
      );
    if (url.startsWith("/monitoring/health"))
      return Promise.resolve({ data: { overall: "healthy", components: {} } });
    return Promise.resolve(ok([]));
  });
}

async function mountView() {
  const wrapper = shallowMount(OwnerView, {
    global: { stubs: { SetupChecklistCard: true } },
  });
  await flushPromises();
  return wrapper;
}

describe("OwnerView data loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows no error banner when every request succeeds", async () => {
    respondWith();
    const wrapper = await mountView();

    expect(wrapper.text()).not.toContain("owner.fetchError");
    wrapper.unmount();
  });

  it("keeps the dashboard up when the health probe is rejected", async () => {
    respondWith({
      "/monitoring/health": () => Promise.reject(new Error("probe down")),
    });
    const wrapper = await mountView();

    expect(wrapper.text()).not.toContain("owner.fetchError");
    wrapper.unmount();
  });

  it("still reports a failure of a core request", async () => {
    respondWith({
      "/orders/active": () => Promise.reject(new Error("orders down")),
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain("owner.fetchError");
    wrapper.unmount();
  });

  it("accepts a 503 health report as data rather than a failure", async () => {
    respondWith();
    const wrapper = await mountView();

    const healthCall = apiGet.mock.calls.find(([url]) =>
      String(url).startsWith("/monitoring/health"),
    );
    const { validateStatus } = healthCall?.[1] as {
      validateStatus: (status: number) => boolean;
    };
    expect(validateStatus(200)).toBe(true);
    expect(validateStatus(503)).toBe(true);
    expect(validateStatus(500)).toBe(false);
    expect(validateStatus(404)).toBe(false);
    wrapper.unmount();
  });
});
