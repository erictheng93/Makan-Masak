// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Component } from "vue";
import type { QuotaMeter } from "@/services/planService";

const getQuotaMeters = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  user: { role: 1 } as { role: number } | null,
}));

vi.mock("@/stores/auth", () => ({ useAuthStore: () => authState }));
vi.mock("@/services/planService", () => ({ getQuotaMeters }));

let QuotaBanner: Component;
const mounted: Array<{ unmount: () => void }> = [];

function meter(overrides: Partial<QuotaMeter> = {}): QuotaMeter {
  return {
    meterKey: "orders.created",
    total: 2550,
    softLimit: 2400,
    hardLimit: 3000,
    state: "warning",
    enforced: true,
    ...overrides,
  };
}

async function mountBanner(meters: QuotaMeter[]) {
  getQuotaMeters.mockResolvedValue(meters);
  const wrapper = mount(QuotaBanner, {
    global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe("QuotaBanner", () => {
  beforeAll(async () => {
    QuotaBanner = (await import("./QuotaBanner.vue")).default;
  }, 30_000);

  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { role: 1 };
    sessionStorage.clear();
  });

  it("warns an owner with the percentage and figures, and can be dismissed", async () => {
    const wrapper = await mountBanner([meter()]);

    expect(getQuotaMeters).toHaveBeenCalledOnce();
    const banner = wrapper.get('[data-testid="quota-banner-orders.created"]');
    expect(banner.attributes("data-state")).toBe("warning");
    expect(banner.text()).toContain("本期訂單已使用 85%（2,550/3,000）");

    await wrapper.get('[data-testid="quota-banner-dismiss"]').trigger("click");

    expect(
      wrapper.find('[data-testid="quota-banner-orders.created"]').exists(),
    ).toBe(false);
  });

  it("says customers cannot order once over, with no way to dismiss", async () => {
    const wrapper = await mountBanner([meter({ total: 3000, state: "over" })]);

    const banner = wrapper.get('[data-testid="quota-banner-orders.created"]');
    expect(banner.attributes("data-state")).toBe("over");
    expect(banner.text()).toContain("已達訂單上限，顧客目前無法下單");
    expect(wrapper.find('[data-testid="quota-banner-dismiss"]').exists()).toBe(
      false,
    );
  });

  it("says receipts cannot print for the print meter", async () => {
    const wrapper = await mountBanner([
      meter({ meterKey: "print.jobs", state: "over" }),
    ]);

    expect(wrapper.text()).toContain("已達列印上限");
  });

  it("ignores meters that are fine or not enforced", async () => {
    const wrapper = await mountBanner([
      meter({ state: "ok" }),
      meter({ meterKey: "api.requests", state: "over", enforced: false }),
    ]);

    expect(wrapper.find('[data-testid^="quota-banner-"]').exists()).toBe(false);
  });

  it("stays hidden, and does not fetch, for anyone but the owner", async () => {
    authState.user = { role: 4 };

    const wrapper = await mountBanner([meter({ state: "over" })]);

    expect(getQuotaMeters).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid^="quota-banner-"]').exists()).toBe(false);
  });

  it("refetches when the billing page announces a plan change", async () => {
    await mountBanner([meter()]);

    window.dispatchEvent(new Event("plan-changed"));
    await flushPromises();

    expect(getQuotaMeters).toHaveBeenCalledTimes(2);
  });
});
