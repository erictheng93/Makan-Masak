// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketOpenTodayCard from "./MarketOpenTodayCard.vue";

const authState = vi.hoisted(() => ({
  user: { id: 10, role: 1 },
  restaurantId: "shop-1" as string | null,
}));
const marketsService = vi.hoisted(() => ({
  listRestaurantMemberships: vi.fn(),
  setMarketOpenToday: vi.fn(),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: { time: string }) =>
      params ? `${key}:${params.time}` : key,
  }),
}));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => authState }));
vi.mock("@/services/marketsService", () => ({ marketsService }));
vi.mock("vue-router", () => ({
  RouterLink: { template: "<a><slot /></a>" },
}));

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    restaurantId: "shop-1",
    marketId: "market-1",
    isPrimary: true,
    joinedAt: 0,
    isOpenToday: false,
    openedAt: null,
    businessDate: "2026-09-28",
    timezone: "Asia/Taipei",
    nextBusinessDayStartMs: Date.parse("2026-09-28T21:00:00.000Z"),
    market: {
      id: "market-1",
      slug: "fengjia",
      name: "逢甲夜市",
      type: "night_market",
      city: "台中市",
      district: "西屯區",
    },
    ...overrides,
  };
}

describe("MarketOpenTodayCard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authState.user = { id: 10, role: 1 };
    authState.restaurantId = "shop-1";
  });

  it("opens the stall with one tap", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([membership()]);
    marketsService.setMarketOpenToday.mockResolvedValue({
      isOpenToday: true,
      openedAt: Date.now(),
      businessDate: "2026-09-28",
    });

    const wrapper = mount(MarketOpenTodayCard);
    await flushPromises();
    expect(
      wrapper
        .find('[data-testid="market-open-market-1"]')
        .attributes("data-status"),
    ).toBe("closed");
    await wrapper
      .find('[data-testid="market-open-button-market-1"]')
      .trigger("click");
    await flushPromises();

    expect(marketsService.setMarketOpenToday).toHaveBeenCalledWith(
      "shop-1",
      "market-1",
      true,
    );
    expect(
      wrapper
        .find('[data-testid="market-open-market-1"]')
        .attributes("data-status"),
    ).toBe("open");
  });

  it("asks before closing early", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([
      membership({ isOpenToday: true, openedAt: Date.now() }),
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    const wrapper = mount(MarketOpenTodayCard);
    await flushPromises();
    await wrapper
      .find('[data-testid="market-close-button-market-1"]')
      .trigger("click");

    expect(confirm).toHaveBeenCalledOnce();
    expect(marketsService.setMarketOpenToday).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("closes only after confirmation", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([
      membership({ isOpenToday: true, openedAt: Date.now() }),
    ]);
    marketsService.setMarketOpenToday.mockResolvedValue({
      isOpenToday: false,
      openedAt: null,
      businessDate: "2026-09-28",
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    const wrapper = mount(MarketOpenTodayCard);
    await flushPromises();
    await wrapper
      .find('[data-testid="market-close-button-market-1"]')
      .trigger("click");
    await flushPromises();

    expect(marketsService.setMarketOpenToday).toHaveBeenCalledWith(
      "shop-1",
      "market-1",
      false,
    );
    expect(
      wrapper
        .find('[data-testid="market-open-market-1"]')
        .attributes("data-status"),
    ).toBe("closed");
    confirm.mockRestore();
  });

  it("stays hidden for shops not in any market and for staff roles", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([]);
    const empty = mount(MarketOpenTodayCard);
    await flushPromises();
    expect(empty.find('[data-testid="market-open-today-card"]').exists()).toBe(
      false,
    );

    authState.user = { id: 11, role: 4 };
    const cashier = mount(MarketOpenTodayCard);
    await flushPromises();
    expect(marketsService.listRestaurantMemberships).toHaveBeenCalledOnce();
    expect(
      cashier.find('[data-testid="market-open-today-card"]').exists(),
    ).toBe(false);
  });

  it("reloads at the next market business-day cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T20:59:00.000Z"));
    try {
      marketsService.listRestaurantMemberships
        .mockResolvedValueOnce([
          membership({
            isOpenToday: true,
            openedAt: Date.parse("2026-09-28T13:05:00.000Z"),
          }),
        ])
        .mockResolvedValueOnce([
          membership({
            businessDate: "2026-09-29",
            nextBusinessDayStartMs: Date.parse("2026-09-29T21:00:00.000Z"),
          }),
        ]);
      const wrapper = mount(MarketOpenTodayCard);
      await flushPromises();
      expect(
        wrapper
          .find('[data-testid="market-open-market-1"]')
          .attributes("data-status"),
      ).toBe("open");

      await vi.advanceTimersByTimeAsync(60_000);
      await flushPromises();

      expect(marketsService.listRestaurantMemberships).toHaveBeenCalledTimes(2);
      expect(
        wrapper
          .find('[data-testid="market-open-market-1"]')
          .attributes("data-status"),
      ).toBe("closed");
      expect(
        wrapper.find('[data-testid="market-open-button-market-1"]').exists(),
      ).toBe(true);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule a rollover after unmounting during a fetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T20:59:00.000Z"));
    try {
      let resolveMemberships!: (value: ReturnType<typeof membership>[]) => void;
      marketsService.listRestaurantMemberships.mockReturnValue(
        new Promise((resolve) => {
          resolveMemberships = resolve;
        }),
      );
      const wrapper = mount(MarketOpenTodayCard);
      wrapper.unmount();
      resolveMemberships([membership()]);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(marketsService.listRestaurantMemberships).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the stall's opening time as 24-hour HH:mm", async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      marketsService.listRestaurantMemberships.mockResolvedValue([
        membership({
          isOpenToday: true,
          openedAt: "2026-09-28T13:05:00.000Z",
          timezone: "Asia/Tokyo",
        }),
      ]);
      const wrapper = mount(MarketOpenTodayCard);
      await flushPromises();

      expect(
        wrapper.find('[data-testid="market-open-market-1"]').text(),
      ).toContain("dashboard.marketOpenToday.openSince:22:05");
      wrapper.unmount();
    } finally {
      process.env.TZ = previousTimeZone;
    }
  });

  it("shows an error and keeps the state when opening fails", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([membership()]);
    marketsService.setMarketOpenToday.mockRejectedValue(new Error("offline"));

    const wrapper = mount(MarketOpenTodayCard);
    await flushPromises();
    await wrapper
      .find('[data-testid="market-open-button-market-1"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toBe(
      "dashboard.marketOpenToday.error",
    );
    expect(
      wrapper
        .find('[data-testid="market-open-market-1"]')
        .attributes("data-status"),
    ).toBe("closed");
  });
});
