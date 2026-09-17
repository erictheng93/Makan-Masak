import { flushPromises, mount } from "@vue/test-utils";
import { reactive, ref, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KitchenStats } from "@/services/kitchenStatisticsService";
import InteractiveStatsPanel from "./InteractiveStatsPanel.vue";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  computeStatistics: vi.fn().mockResolvedValue(undefined),
}));
let auth: { restaurantId: string | undefined };
vi.mock("@/stores/auth", () => ({ useAuthStore: () => auth }));
vi.mock("@/services/authApi", () => ({ default: { get: mocks.get } }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("en-US") }),
}));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/services/kitchenStatisticsService", () => ({
  kitchenStatisticsService: {
    autoRefresh: ref(false),
    isLoading: ref(false),
    lastUpdated: ref(new Date()),
    computeStatistics: mocks.computeStatistics,
    currentStats: {
      orders: {
        totalOrders: 1,
        completedOrders: 1,
        pendingOrders: 0,
        cookingOrders: 0,
        averageCookingTime: 1,
        averageWaitTime: 1,
        completionRate: 100,
        orderTrends: [],
      },
      performance: {
        efficiency: 100,
        averageOrderValue: 1234.56,
        ordersPerHour: 1,
        peakHours: [],
        slowestItems: [],
        fastestItems: [],
      },
      chefs: [],
      items: [
        {
          itemName: "Noodles",
          orderCount: 1,
          averageCookTime: 1,
          successRate: 100,
          popularityTrend: "stable",
          revenueContribution: 1234.56,
        },
      ],
      customer: {
        averageRating: 5,
        complaintRate: 0,
        repeatCustomerRate: 0,
        satisfactionTrends: [],
      },
      realTime: {
        activeOrders: 1,
        waitingTime: 1,
        systemLoad: 1,
        lastUpdate: new Date(),
      },
    } satisfies KitchenStats,
  },
}));

function response(currency?: string) {
  return { data: { success: true, data: { settings: { currency } } } };
}
beforeEach(() => {
  mocks.get.mockReset();
  mocks.computeStatistics.mockClear();
  auth = reactive({ restaurantId: "shop-a" });
});

describe("kitchen statistics restaurant currency", () => {
  it.each([
    ["TWD", "NT$1,235"],
    ["MYR", "RM 1,234.56"],
    ["VND", "1.235 ₫"],
  ])(
    "formats average order value and item revenue in %s regardless of UI locale",
    async (code, expected) => {
      mocks.get.mockResolvedValue(response(code));
      const wrapper = mount(InteractiveStatsPanel);
      await flushPromises();
      expect(mocks.get).toHaveBeenCalledWith("/restaurants/shop-a");
      expect(mocks.computeStatistics).toHaveBeenCalledOnce();
      expect(wrapper.text()).toContain(expected);
      const items = wrapper
        .findAll("button")
        .find((button) => button.text() === "interactiveStats.itemAnalysis")!;
      await items.trigger("click");
      expect(wrapper.text().split(expected)).toHaveLength(3);
      expect(wrapper.text()).not.toContain("$" + expected);
      wrapper.unmount();
    },
  );

  it("ignores a previous restaurant's late response and resets on logout", async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    mocks.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const wrapper = mount(InteractiveStatsPanel);
    auth.restaurantId = "shop-b";
    mocks.get.mockResolvedValueOnce(response("VND"));
    await flushPromises();
    expect(mocks.get).toHaveBeenLastCalledWith("/restaurants/shop-b");
    expect(wrapper.text()).toContain("1.235 ₫");
    resolveOld(response("MYR"));
    await flushPromises();
    expect(wrapper.text()).toContain("1.235 ₫");
    auth.restaurantId = undefined;
    await nextTick();
    expect(wrapper.text()).toContain("NT$1,235");
    expect(mocks.get).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it.each([undefined, "USD"])(
    "uses the platform default for missing or unsupported currency (%s)",
    async (currency) => {
      mocks.get.mockResolvedValue(response(currency));
      const wrapper = mount(InteractiveStatsPanel);
      await flushPromises();
      expect(wrapper.text()).toContain("NT$1,235");
      expect(mocks.get).toHaveBeenCalledOnce();
      wrapper.unmount();
    },
  );

  it("keeps statistics usable if the restaurant request fails", async () => {
    mocks.get.mockRejectedValue(new Error("offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(InteractiveStatsPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("NT$1,235");
    expect(log).toHaveBeenCalledWith(
      "Failed to load restaurant currency:",
      expect.any(Error),
    );
    expect(mocks.get).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
