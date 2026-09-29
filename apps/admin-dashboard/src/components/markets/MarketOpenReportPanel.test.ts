// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarketOpenReportPanel from "./MarketOpenReportPanel.vue";

const marketsService = vi.hoisted(() => ({
  getMarketOpenReport: vi.fn(),
  exportMarketOpenReportCsv: vi.fn(),
}));

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/services/marketsService", () => ({ marketsService }));

const report = {
  market: { id: "market-1", name: "Market", businessDayCutoffMinutes: 300 },
  from: "2026-09-22",
  to: "2026-09-28",
  daily: [
    {
      businessDate: "2026-09-25",
      restaurantId: "a",
      vendorName: "Stall",
      stallNumber: "A01",
      firstOpenedAtMs: Date.parse("2026-09-25T09:00:00Z"),
      lastClosedAtMs: Date.parse("2026-09-25T21:00:00Z"),
      autoClosed: true,
      openMinutes: 660,
      openedBy: "Owner",
      orderCount: 2,
      revenueCents: 20000,
      currency: "TWD",
      offsetMinutes: 480,
    },
  ],
  summary: [
    {
      restaurantId: "a",
      vendorName: "Stall",
      stallNumber: "A01",
      openDays: 1,
      expectedDays: 2,
      attendanceRate: 0.5,
      avgOpenMinutes: 660,
      orderCount: 2,
      revenueCents: 20000,
      currency: "TWD",
    },
  ],
};

describe("MarketOpenReportPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketsService.getMarketOpenReport.mockResolvedValue(report);
  });

  it("loads the last seven days and renders daily rows", async () => {
    const scope = { kind: "platform" as const, marketId: "market-1" };
    const wrapper = mount(MarketOpenReportPanel, { props: { scope } });
    await flushPromises();
    expect(marketsService.getMarketOpenReport).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    const row = wrapper.find('[data-testid="open-report-daily-a-2026-09-25"]');
    expect(row.text()).toContain("Stall");
    expect(row.attributes("data-auto-closed")).toBe("true");
  });

  it("switches to summary", async () => {
    const wrapper = mount(MarketOpenReportPanel, {
      props: { scope: { kind: "platform", marketId: "market-1" } },
    });
    await flushPromises();
    await wrapper
      .find('[data-testid="open-report-view-summary"]')
      .trigger("click");
    expect(
      wrapper.find('[data-testid="open-report-summary-a"]').text(),
    ).toContain("50%");
  });

  it("exports the selected view", async () => {
    marketsService.exportMarketOpenReportCsv.mockResolvedValue(
      new Blob(["a,b"], { type: "text/csv" }),
    );
    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn();
    const scope = {
      kind: "owner" as const,
      restaurantId: "shop-1",
      marketId: "market-1",
    };
    const wrapper = mount(MarketOpenReportPanel, { props: { scope } });
    await flushPromises();
    await wrapper.find('[data-testid="open-report-export"]').trigger("click");
    await flushPromises();
    expect(marketsService.exportMarketOpenReportCsv).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ from: expect.any(String) }),
      "daily",
    );
  });

  it("shows a load error instead of a table", async () => {
    marketsService.getMarketOpenReport.mockRejectedValue(
      new Error("bad range"),
    );
    const wrapper = mount(MarketOpenReportPanel, {
      props: { scope: { kind: "platform", marketId: "market-1" } },
    });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe(
      "marketOpenReport.loadFailed",
    );
  });

  it("clears old rows and ignores a superseded market response", async () => {
    let resolveOld!: (value: typeof report) => void;
    let resolveNew!: (value: typeof report) => void;
    marketsService.getMarketOpenReport
      .mockResolvedValueOnce(report)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );
    const wrapper = mount(MarketOpenReportPanel, {
      props: { scope: { kind: "platform", marketId: "market-1" } },
    });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="open-report-daily-a-2026-09-25"]').exists(),
    ).toBe(true);

    await wrapper.setProps({
      scope: { kind: "platform", marketId: "market-2" },
    });
    expect(
      wrapper.find('[data-testid="open-report-daily-a-2026-09-25"]').exists(),
    ).toBe(false);
    await wrapper.setProps({
      scope: { kind: "platform", marketId: "market-3" },
    });
    resolveNew({
      ...report,
      daily: [{ ...report.daily[0], vendorName: "New stall" }],
    });
    await flushPromises();
    resolveOld(report);
    await flushPromises();

    expect(
      wrapper.find('[data-testid="open-report-daily-a-2026-09-25"]').text(),
    ).toContain("New stall");
    expect(marketsService.getMarketOpenReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ marketId: "market-3" }),
      expect.objectContaining({ from: expect.any(String) }),
    );
  });

  it("shows an alert when CSV export fails", async () => {
    marketsService.exportMarketOpenReportCsv.mockRejectedValue(
      new Error("offline"),
    );
    const wrapper = mount(MarketOpenReportPanel, {
      props: { scope: { kind: "platform", marketId: "market-1" } },
    });
    await flushPromises();
    await wrapper.find('[data-testid="open-report-export"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe(
      "marketOpenReport.exportFailed",
    );
    expect(
      wrapper.find('[data-testid="open-report-daily-a-2026-09-25"]').exists(),
    ).toBe(true);
  });

  describe("default range", () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      vi.useRealTimers();
      process.env.TZ = originalTz;
    });

    it("ends on the viewer's local date, not the UTC date", async () => {
      // 07:00 in Taipei is still the previous day in UTC.
      process.env.TZ = "Asia/Taipei";
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-28T23:00:00Z"));

      mount(MarketOpenReportPanel, {
        props: { scope: { kind: "platform", marketId: "market-1" } },
      });
      await flushPromises();

      expect(marketsService.getMarketOpenReport).toHaveBeenCalledWith(
        expect.anything(),
        { from: "2026-09-23", to: "2026-09-29" },
      );
    });
  });

  it("does not reload when the parent re-renders with an equal scope", async () => {
    const text = ref("");
    const Parent = defineComponent({
      setup: () => () =>
        h("div", [
          h("span", text.value),
          h(MarketOpenReportPanel, {
            scope: { kind: "platform", marketId: "market-1" },
          }),
        ]),
    });
    mount(Parent);
    await flushPromises();

    for (const value of ["a", "ab", "abc"]) {
      text.value = value;
      await flushPromises();
    }

    expect(marketsService.getMarketOpenReport).toHaveBeenCalledOnce();
  });
});
