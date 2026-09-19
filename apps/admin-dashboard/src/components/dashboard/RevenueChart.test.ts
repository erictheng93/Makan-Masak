// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import RevenueChart from "./RevenueChart.vue";
import {
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "@/composables/useCurrency";

type TickCallback = (value: number) => string;
type TooltipCallback = (context: {
  parsed: { y: number };
  dataIndex: number;
}) => string[];

const chartConfigs = vi.hoisted(() => [] as unknown[]);

vi.mock("chart.js", () => {
  class Chart {
    static register = vi.fn();
    constructor(_ctx: unknown, config: unknown) {
      chartConfigs.push(config);
    }
    destroy() {}
  }
  return {
    Chart,
    CategoryScale: {},
    LinearScale: {},
    PointElement: {},
    LineElement: {},
    Title: {},
    Tooltip: {},
    Legend: {},
    Filler: {},
  };
});

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.value ? `${key}:${String(params.value)}` : key,
  }),
}));

function latestCallbacks() {
  const config = chartConfigs.at(-1) as {
    options: {
      scales: { y: { ticks: { callback: TickCallback } } };
      plugins: { tooltip: { callbacks: { label: TooltipCallback } } };
    };
  };
  return {
    tick: config.options.scales.y.ticks.callback,
    tooltip: config.options.plugins.tooltip.callbacks.label,
  };
}

async function renderChart() {
  const wrapper = mount(RevenueChart, {
    props: {
      period: "daily",
      data: [{ label: "9/18", value: 1234.5, date: "2026-09-18" }],
    },
  });
  await flushPromises();
  return wrapper;
}

describe("RevenueChart currency", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
  });
  afterEach(() => {
    clearRestaurantCurrency();
    chartConfigs.length = 0;
  });

  it("labels the axis and tooltip in NT$ with no decimals for a TWD shop", async () => {
    const wrapper = await renderChart();
    const { tick, tooltip } = latestCallbacks();
    expect(tick(35000)).toBe("NT$35,000");
    expect(tooltip({ parsed: { y: 1234.5 }, dataIndex: 0 })[0]).toBe(
      "charts.revenueChart.revenueValue:NT$1,235",
    );
    wrapper.unmount();
  });

  it("uses RM with two decimals for an MYR shop", async () => {
    setRestaurantCurrency("MYR");
    const wrapper = await renderChart();
    const { tick, tooltip } = latestCallbacks();
    expect(tick(1000)).toBe("RM 1,000.00");
    expect(tooltip({ parsed: { y: 1234.5 }, dataIndex: 0 })[0]).toBe(
      "charts.revenueChart.revenueValue:RM 1,234.50",
    );
    wrapper.unmount();
  });

  it("redraws when the shop currency arrives after the data", async () => {
    const wrapper = await renderChart();
    const drawn = chartConfigs.length;
    setRestaurantCurrency("VND");
    await flushPromises();
    expect(chartConfigs.length).toBeGreaterThan(drawn);
    expect(latestCallbacks().tick(350000)).toBe("350.000 ₫");
    wrapper.unmount();
  });
});
