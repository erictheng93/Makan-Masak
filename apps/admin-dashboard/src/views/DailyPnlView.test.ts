// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import type { DailyPnl, PnlRange } from "@/services/pnlService";

const getDaily = vi.hoisted(() => vi.fn());
const addExpense = vi.hoisted(() => vi.fn());
const deleteExpense = vi.hoisted(() => vi.fn());
const getRange = vi.hoisted(() => vi.fn());
const getRates = vi.hoisted(() => vi.fn());
const saveRates = vi.hoisted(() => vi.fn());
const downloadCsv = vi.hoisted(() => vi.fn());
const downloadXlsx = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const authState = vi.hoisted(() => ({
  restaurantId: "shop-1" as string | null,
}));

// `@/i18n` is deliberately not mocked (see ReviewsView.test.ts): the literals
// below are the zh-TW source strings, so a missing key cannot pass as present.
vi.mock("vue-toastification", () => ({ useToast: () => toast }));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => authState }));
vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm }),
}));
vi.mock("@/services/pnlService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pnlService")>()),
  pnlService: {
    getDaily,
    addExpense,
    deleteExpense,
    getRange,
    getRates,
    saveRates,
  },
}));
vi.mock("@/utils/pnl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/pnl")>()),
  downloadCsv,
  downloadXlsx,
}));

let DailyPnlView: Component;

function statement(overrides: Partial<DailyPnl> = {}): DailyPnl {
  return {
    date: "2026-11-12",
    currency: "TWD",
    revenue: {
      grossSalesCents: 1_000_000,
      discountCents: 50_000,
      refundCents: 0,
      collectedCents: 950_000,
      netRevenueCents: 950_000,
      taxCents: 0,
      serviceChargeCents: 90_000,
      orderCount: 12,
    },
    cogs: { totalCents: 400_000, itemsMissingCost: 0 },
    grossProfitCents: 550_000,
    expenses: {
      totalCents: 200_000,
      byCategory: [{ category: "rent", amountCents: 200_000 }],
      items: [
        {
          id: "exp-1",
          category: "rent",
          amountCents: 200_000,
          note: "11 月場租",
          createdAtMs: 1_757_000_000_000,
        },
      ],
    },
    fees: {
      paymentFeeCents: 25_000,
      platformCommissionCents: 15_000,
      configured: true,
    },
    labor: { costCents: 60_000, shifts: 3, shiftsMissingRate: 0 },
    netProfitCents: 250_000,
    ...overrides,
  };
}

function rangeResult(): PnlRange {
  const empty = {
    orderCount: 0,
    netRevenueCents: 0,
    cogsCents: 0,
    grossProfitCents: 0,
    feesCents: 0,
    laborCents: 0,
    expensesCents: 0,
    netProfitCents: 0,
  };
  return {
    from: "2026-11-01",
    to: "2026-11-03",
    currency: "TWD",
    days: [
      {
        ...empty,
        date: "2026-11-01",
        orderCount: 5,
        netRevenueCents: 500_000,
        cogsCents: 200_000,
        grossProfitCents: 300_000,
        feesCents: 20_000,
        laborCents: 60_000,
        expensesCents: 10_000,
        netProfitCents: 210_000,
      },
      { ...empty, date: "2026-11-02" },
      {
        ...empty,
        date: "2026-11-03",
        orderCount: 1,
        netRevenueCents: 10_000,
        cogsCents: 5_000,
        grossProfitCents: 5_000,
        laborCents: 60_000,
        netProfitCents: -55_000,
      },
    ],
    totals: {
      orderCount: 6,
      netRevenueCents: 510_000,
      cogsCents: 205_000,
      grossProfitCents: 305_000,
      feesCents: 20_000,
      laborCents: 120_000,
      expensesCents: 10_000,
      netProfitCents: 155_000,
    },
  };
}

/** An axios-shaped rejection carrying the unified error envelope. */
function apiError(code: string) {
  return { response: { data: { success: false, error: { code } } } };
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(DailyPnlView, {
    global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
  });
  await flushPromises();
  return wrapper;
}

describe("DailyPnlView", () => {
  // Pays the first mount (real i18n runtime, icons, SFC transform) under the
  // hook's own budget instead of a 5s test body (#211).
  beforeAll(async () => {
    getDaily.mockResolvedValue(statement());
    DailyPnlView = (await import("./DailyPnlView.vue")).default;
    const warmup = mount(DailyPnlView, {
      global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
    });
    await flushPromises();
    warmup.unmount();
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    authState.restaurantId = "shop-1";
    getDaily.mockResolvedValue(statement());
    addExpense.mockResolvedValue({});
    deleteExpense.mockResolvedValue(undefined);
    getRange.mockResolvedValue(rangeResult());
    getRates.mockResolvedValue({
      paymentFeeBps: { ecpay: 150 },
      platformCommissionBps: {},
      paymentMethods: ["cash", "ecpay", "mystery_pay"],
      platforms: ["uber_eats"],
      effectiveFrom: "2026-11-01",
      history: [
        {
          effectiveFrom: "2026-11-01",
          paymentFeeBps: { ecpay: 150 },
          platformCommissionBps: {},
        },
        {
          effectiveFrom: "1970-01-01",
          paymentFeeBps: { ecpay: 200, cash: 0 },
          platformCommissionBps: { uber_eats: 3000 },
        },
      ],
    });
    saveRates.mockResolvedValue({});
    confirm.mockResolvedValue(true);
  });

  it("fetches today's statement and renders it in the shop currency", async () => {
    const wrapper = await mountView();

    expect(getDaily).toHaveBeenCalledOnce();
    expect(getDaily).toHaveBeenCalledWith("shop-1", expect.any(String));
    expect(wrapper.get('[data-testid="pnl-gross-sales"]').text()).toBe(
      "NT$10,000",
    );
    expect(wrapper.get('[data-testid="pnl-net-revenue"]').text()).toBe(
      "NT$9,500",
    );
    expect(wrapper.get('[data-testid="pnl-cogs"]').text()).toContain(
      "NT$4,000",
    );
    expect(wrapper.get('[data-testid="pnl-gross-profit"]').text()).toBe(
      "NT$5,500",
    );
    expect(wrapper.get('[data-testid="pnl-gross-margin"]').text()).toBe(
      "57.9%",
    );
    expect(wrapper.get('[data-testid="pnl-expenses-total"]').text()).toContain(
      "NT$2,000",
    );
    expect(wrapper.get('[data-testid="pnl-order-count"]').text()).toContain(
      "12",
    );
    expect(wrapper.get('[data-testid="pnl-net-amount"]').text()).toBe(
      "NT$2,500",
    );
    expect(
      wrapper.get('[data-testid="pnl-net-profit"]').attributes(),
    ).toMatchObject({ "data-status": "profit" });
    expect(wrapper.get('[data-testid="pnl-net-label"]').text()).toBe("盈");
  });

  it("formats with the statement's own currency, not a global default", async () => {
    getDaily.mockResolvedValue(
      statement({
        currency: "MYR",
        revenue: { ...statement().revenue, grossSalesCents: 1250 },
      }),
    );
    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="pnl-gross-sales"]').text()).toBe(
      "RM 12.50",
    );
    expect(
      wrapper.get('[data-testid="pnl-expense-amount"]').attributes("step"),
    ).toBe("0.01");
  });

  it("shows the missing-cost warning only when items lack a cost", async () => {
    let wrapper = await mountView();
    expect(wrapper.find('[data-testid="pnl-missing-cost"]').exists()).toBe(
      false,
    );
    wrapper.unmount();

    getDaily.mockResolvedValue(
      statement({ cogs: { totalCents: 0, itemsMissingCost: 3 } }),
    );
    wrapper = await mountView();
    expect(wrapper.get('[data-testid="pnl-missing-cost"]').text()).toContain(
      "3 項售出品項未設定成本，毛利可能被高估",
    );
  });

  it("marks a loss with a label and a minus sign, not colour alone", async () => {
    getDaily.mockResolvedValue(statement({ netProfitCents: -120_000 }));
    const wrapper = await mountView();

    expect(
      wrapper.get('[data-testid="pnl-net-profit"]').attributes(),
    ).toMatchObject({ "data-status": "loss" });
    expect(wrapper.get('[data-testid="pnl-net-label"]').text()).toBe("虧");
    expect(wrapper.get('[data-testid="pnl-net-amount"]').text()).toBe(
      "−NT$1,200",
    );
  });

  it("still renders the statement for an empty day, with a dash margin", async () => {
    getDaily.mockResolvedValue(
      statement({
        revenue: {
          grossSalesCents: 0,
          discountCents: 0,
          refundCents: 0,
          collectedCents: 0,
          netRevenueCents: 0,
          taxCents: 0,
          serviceChargeCents: 0,
          orderCount: 0,
        },
        cogs: { totalCents: 0, itemsMissingCost: 0 },
        grossProfitCents: 0,
        expenses: { totalCents: 0, byCategory: [], items: [] },
        netProfitCents: 0,
      }),
    );
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="pnl-statement"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="pnl-gross-margin"]').text()).toBe("—");
    expect(wrapper.get('[data-testid="pnl-net-amount"]').text()).toBe("NT$0");
  });

  it("offers a retry after a load failure", async () => {
    getDaily.mockRejectedValueOnce(new Error("boom"));
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="pnl-error"]').exists()).toBe(true);

    await wrapper.get('[data-testid="pnl-retry"]').trigger("click");
    await flushPromises();

    expect(getDaily).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="pnl-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pnl-statement"]').exists()).toBe(true);
  });

  it("refetches when the date changes and refuses future dates", async () => {
    const wrapper = await mountView();
    const input = wrapper.get('[data-testid="pnl-date"]');
    expect(input.attributes("max")).toBeTruthy();

    await input.setValue("2026-01-05");
    await flushPromises();
    expect(getDaily).toHaveBeenLastCalledWith("shop-1", "2026-01-05");

    getDaily.mockClear();
    await input.setValue("2999-01-01");
    await flushPromises();
    expect(getDaily).toHaveBeenCalledOnce();
    expect(getDaily).not.toHaveBeenCalledWith("shop-1", "2999-01-01");
  });

  it("adds an expense in cents and refetches the statement", async () => {
    const wrapper = await mountView();
    getDaily.mockClear();

    await wrapper
      .get('[data-testid="pnl-expense-category"]')
      .setValue("utilities");
    await wrapper.get('[data-testid="pnl-expense-amount"]').setValue("1250");
    await wrapper.get('[data-testid="pnl-expense-note"]').setValue("  電費 ");
    await wrapper.get('[data-testid="pnl-expense-form"]').trigger("submit");
    await flushPromises();

    expect(addExpense).toHaveBeenCalledOnce();
    expect(addExpense).toHaveBeenCalledWith(
      "shop-1",
      expect.objectContaining({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        category: "utilities",
        amountCents: 125_000,
        note: "電費",
      }),
    );
    expect(getDaily).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it("rejects a non-positive amount without calling the service", async () => {
    const wrapper = await mountView();

    await wrapper.get('[data-testid="pnl-expense-form"]').trigger("submit");
    await flushPromises();

    expect(addExpense).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("maps CURRENCY_PRECISION to its own translated toast", async () => {
    addExpense.mockRejectedValueOnce(apiError("CURRENCY_PRECISION"));
    const wrapper = await mountView();

    await wrapper.get('[data-testid="pnl-expense-amount"]').setValue("5");
    await wrapper.get('[data-testid="pnl-expense-form"]').trigger("submit");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith("金額不符合此幣別的最小單位。");
  });

  it("confirms before deleting, then deletes and refetches", async () => {
    const wrapper = await mountView();
    getDaily.mockClear();

    await wrapper
      .get('[data-testid="pnl-expense-delete-exp-1"]')
      .trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ type: "danger" }),
    );
    expect(deleteExpense).toHaveBeenCalledWith("shop-1", "exp-1");
    expect(getDaily).toHaveBeenCalledOnce();
  });

  it("does not delete when the confirmation is declined", async () => {
    confirm.mockResolvedValue(false);
    const wrapper = await mountView();

    await wrapper
      .get('[data-testid="pnl-expense-delete-exp-1"]')
      .trigger("click");
    await flushPromises();

    expect(deleteExpense).not.toHaveBeenCalled();
  });

  it("maps EXPENSE_NOT_FOUND to a toast and refetches the truth", async () => {
    deleteExpense.mockRejectedValueOnce(apiError("EXPENSE_NOT_FOUND"));
    const wrapper = await mountView();
    getDaily.mockClear();

    await wrapper
      .get('[data-testid="pnl-expense-delete-exp-1"]')
      .trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith("找不到這筆費用，可能已被刪除。");
    expect(getDaily).toHaveBeenCalledOnce();
  });

  it("asks for a restaurant when none is selected", async () => {
    authState.restaurantId = null;
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="pnl-no-restaurant"]').exists()).toBe(
      true,
    );
    expect(getDaily).not.toHaveBeenCalled();
  });

  it("renders fee and labor lines between gross profit and expenses", async () => {
    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="pnl-payment-fee"]').text()).toBe(
      "NT$250",
    );
    expect(wrapper.get('[data-testid="pnl-platform-commission"]').text()).toBe(
      "NT$150",
    );
    expect(wrapper.get('[data-testid="pnl-labor"]').text()).toContain("NT$600");
    expect(wrapper.find('[data-testid="pnl-fees-unconfigured"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="pnl-labor-missing-rate"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).toContain("已自動計入");
  });

  it("prompts for rates instead of zero lines when none are configured", async () => {
    getDaily.mockResolvedValue(
      statement({
        fees: {
          paymentFeeCents: 0,
          platformCommissionCents: 0,
          configured: false,
        },
      }),
    );
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="pnl-payment-fee"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get('[data-testid="pnl-fees-unconfigured"]').text(),
    ).toContain("尚未設定手續費率");
    await wrapper.get('[data-testid="pnl-fees-setup"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="pnl-rates-form"]').exists()).toBe(true);
  });

  it("notes shifts that have no hourly rate", async () => {
    getDaily.mockResolvedValue(
      statement({
        labor: { costCents: 0, shifts: 2, shiftsMissingRate: 2 },
      }),
    );
    const wrapper = await mountView();

    expect(
      wrapper.get('[data-testid="pnl-labor-missing-rate"]').text(),
    ).toContain("2 個班次的員工與班別都沒有設定時薪，未計入");
  });

  it("converts 2.75% to 275 bps, saves, then refetches the statement", async () => {
    const wrapper = await mountView();
    getDaily.mockClear();

    await wrapper.get('[data-testid="pnl-rates-open"]').trigger("click");
    await flushPromises();
    const ecpay = wrapper.get('[data-testid="pnl-rate-payment-ecpay"]');
    expect((ecpay.element as HTMLInputElement).value).toBe("1.5");
    // Unknown keys fall back to the raw key as their label.
    expect(wrapper.get('[data-testid="pnl-rates-form"]').text()).toContain(
      "mystery_pay",
    );
    expect(wrapper.get('[data-testid="pnl-rates"]').text()).toContain(
      "生效日之前的日期沿用當時的費率",
    );

    expect(wrapper.get('[data-testid="pnl-rates-form"]').text()).toContain(
      "現金",
    );
    await wrapper
      .get('[data-testid="pnl-rate-payment-mystery_pay"]')
      .setValue("0.5");
    await ecpay.setValue("2.75");
    await wrapper
      .get('[data-testid="pnl-rate-platform-uber_eats"]')
      .setValue("30");
    await wrapper.get('[data-testid="pnl-rates-form"]').trigger("submit");
    await flushPromises();

    expect(saveRates).toHaveBeenCalledOnce();
    expect(saveRates).toHaveBeenCalledWith("shop-1", {
      paymentFeeBps: { cash: 0, ecpay: 275, mystery_pay: 50 },
      platformCommissionBps: { uber_eats: 3000 },
      effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(toast.success).toHaveBeenCalledOnce();
    expect(getDaily).toHaveBeenCalledOnce();
  });

  it("refuses a rate above 100% without calling the service", async () => {
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-rates-open"]').trigger("click");
    await flushPromises();

    await wrapper.get('[data-testid="pnl-rate-payment-ecpay"]').setValue("101");
    await wrapper.get('[data-testid="pnl-rates-form"]').trigger("submit");
    await flushPromises();

    expect(saveRates).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("fetches a range, renders totals and per-day rows, and flags losses", async () => {
    const wrapper = await mountView();

    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="pnl-mode-range"]').attributes("aria-pressed"),
    ).toBe("true");
    expect(getRange).toHaveBeenCalledOnce();
    const [id, from, to] = getRange.mock.calls[0];
    expect(id).toBe("shop-1");
    expect(from <= to).toBe(true);
    expect(
      wrapper.get('[data-testid="pnl-range-total-netRevenue"]').text(),
    ).toBe("NT$5,100");
    expect(wrapper.get('[data-testid="pnl-range-total-labor"]').text()).toBe(
      "NT$1,200",
    );
    expect(wrapper.get('[data-testid="pnl-range-net"]').text()).toContain(
      "NT$1,550",
    );
    expect(wrapper.findAll("tbody tr")).toHaveLength(3);
    const loss = wrapper.get('[data-testid="pnl-range-row-2026-11-03"]');
    expect(loss.text()).toContain("虧");
    expect(loss.text()).toContain("−NT$550");
  });

  it("shows the range error with retry, and no retry for PNL_RANGE_INVALID", async () => {
    getRange.mockRejectedValueOnce(new Error("boom"));
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="pnl-range-error"]').exists()).toBe(true);
    await wrapper.get('[data-testid="pnl-range-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="pnl-range-table"]').exists()).toBe(true);

    getRange.mockRejectedValueOnce(apiError("PNL_RANGE_INVALID"));
    await wrapper.get('[data-testid="pnl-range-from"]').setValue("2026-10-01");
    await flushPromises();
    expect(wrapper.get('[data-testid="pnl-range-error"]').text()).toContain(
      "最長 92 天",
    );
    expect(wrapper.find('[data-testid="pnl-range-retry"]').exists()).toBe(
      false,
    );
  });

  it("clamps a range longer than 92 days and says so", async () => {
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();
    getRange.mockClear();

    await wrapper.get('[data-testid="pnl-range-to"]').setValue("2026-11-10");
    await flushPromises();
    getRange.mockClear();
    await wrapper.get('[data-testid="pnl-range-from"]').setValue("2025-01-01");
    await flushPromises();

    expect(getRange).toHaveBeenLastCalledWith(
      "shop-1",
      "2026-08-11",
      "2026-11-10",
    );
    expect(wrapper.get('[data-testid="pnl-range-clamped"]').text()).toContain(
      "92",
    );
  });

  it("switches to that day when a range row is clicked", async () => {
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();
    getDaily.mockClear();

    await wrapper
      .get('[data-testid="pnl-range-row-2026-11-01"]')
      .trigger("click");
    await flushPromises();

    expect(
      (wrapper.get('[data-testid="pnl-date"]').element as HTMLInputElement)
        .value,
    ).toBe("2026-11-01");
    expect(getDaily).toHaveBeenLastCalledWith("shop-1", "2026-11-01");
    expect(wrapper.find('[data-testid="pnl-statement"]').exists()).toBe(true);
  });

  it("exports the range as BOM-prefixed CSV in plain major units", async () => {
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();

    await wrapper.get('[data-testid="pnl-export-csv"]').trigger("click");

    expect(downloadCsv).toHaveBeenCalledOnce();
    const [csv, filename] = downloadCsv.mock.calls[0];
    expect(filename).toBe("pnl_2026-11-01_2026-11-03.csv");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\n");
    expect(lines[0]).toBe(
      "日期,訂單數,淨營收（未稅）,銷貨成本,毛利,手續費與抽成,人事成本,營業費用,損益",
    );
    expect(lines[1]).toBe("2026-11-01,5,5000,2000,3000,200,600,100,2100");
    expect(lines[3]).toBe("2026-11-03,1,100,50,50,0,600,0,-550");
    expect(lines[4]).toBe("區間合計,6,5100,2050,3050,200,1200,100,1550");
    // A symbol or thousands separator would force quoting.
    expect(csv).not.toMatch(/NT\$|"/);
  });

  it("maps EXPENSE_DATE_IN_FUTURE to a translated toast", async () => {
    addExpense.mockRejectedValueOnce(apiError("EXPENSE_DATE_IN_FUTURE"));
    const wrapper = await mountView();

    await wrapper.get('[data-testid="pnl-expense-amount"]').setValue("5");
    await wrapper.get('[data-testid="pnl-expense-form"]').trigger("submit");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith("不能新增未來日期的費用。");
  });

  it("renders a zero net profit as neutral, neither 盈 nor 虧", async () => {
    getDaily.mockResolvedValue(statement({ netProfitCents: 0 }));
    const wrapper = await mountView();

    expect(
      wrapper.get('[data-testid="pnl-net-profit"]').attributes(),
    ).toMatchObject({ "data-status": "even" });
    expect(wrapper.get('[data-testid="pnl-net-label"]').text()).toBe("持平");
  });

  it("marks zero-profit range totals and rows as even", async () => {
    const result = rangeResult();
    result.totals.netProfitCents = 0;
    getRange.mockResolvedValue(result);
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="pnl-range-net"]').attributes("data-status"),
    ).toBe("even");
    const emptyDay = wrapper.get('[data-testid="pnl-range-row-2026-11-02"]');
    expect(emptyDay.find('[data-status="even"]').exists()).toBe(true);
    expect(emptyDay.text()).not.toContain("盈");
    expect(emptyDay.text()).not.toContain("虧");
  });

  it("puts net profit right after the date column in the range table", async () => {
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();

    const heads = wrapper.findAll("thead th").map((th) => th.text());
    expect(heads.slice(0, 2)).toEqual(["日期", "損益"]);
    const cells = wrapper
      .get('[data-testid="pnl-range-row-2026-11-03"]')
      .findAll("th, td");
    expect(cells[1].attributes("data-status")).toBe("loss");
  });

  it("titles the entry card 費用明細 and states the empty case once", async () => {
    getDaily.mockResolvedValue(
      statement({ expenses: { totalCents: 0, byCategory: [], items: [] } }),
    );
    const wrapper = await mountView();

    expect(wrapper.text().split("本日尚無營業費用").length - 1).toBe(1);
    expect(wrapper.text()).toContain("費用明細");
  });

  it("hides the collected and tax rows when no tax was collected", async () => {
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="pnl-collected"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pnl-tax"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pnl-collected-note"]').exists()).toBe(
      false,
    );
    expect(wrapper.get('[data-testid="pnl-statement"]').text()).toContain(
      "= 淨營收",
    );
    expect(wrapper.get('[data-testid="pnl-statement"]').text()).not.toContain(
      "未稅",
    );
  });

  it("shows 實收金額, 代收稅額 and the ex-tax net when tax was collected", async () => {
    getDaily.mockResolvedValue(
      statement({
        revenue: {
          ...statement().revenue,
          collectedCents: 950_000,
          taxCents: 45_000,
          netRevenueCents: 905_000,
        },
        grossProfitCents: 505_000,
      }),
    );
    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="pnl-collected"]').text()).toBe(
      "NT$9,500",
    );
    expect(wrapper.get('[data-testid="pnl-tax"]').text()).toBe("NT$450");
    expect(wrapper.get('[data-testid="pnl-net-revenue"]').text()).toBe(
      "NT$9,050",
    );
    const text = wrapper.get('[data-testid="pnl-statement"]').text();
    expect(text).toContain("= 淨營收（未稅）");
    expect(text).toContain("數據分析");
    // Gross margin is on the ex-tax net revenue: 5050 / 9050.
    expect(wrapper.get('[data-testid="pnl-gross-margin"]').text()).toBe(
      "55.8%",
    );
  });

  it("exports the single day as label/amount rows plus the entries, neutralising formulas", async () => {
    getDaily.mockResolvedValue(
      statement({
        expenses: {
          totalCents: 300_000,
          byCategory: [{ category: "rent", amountCents: 300_000 }],
          items: [
            {
              id: "e1",
              category: "rent",
              amountCents: 100_000,
              note: '=HYPERLINK("http://evil","x")',
              createdAtMs: 1,
            },
            {
              id: "e2",
              category: "rent",
              amountCents: 200_000,
              note: "@SUM(A1)",
              createdAtMs: 2,
            },
          ],
        },
      }),
    );
    const wrapper = await mountView();

    await wrapper.get('[data-testid="pnl-export-csv"]').trigger("click");

    expect(downloadCsv).toHaveBeenCalledOnce();
    const [csv, filename] = downloadCsv.mock.calls[0];
    expect(filename).toBe("pnl_2026-11-12.csv");
    const lines: string[] = csv.slice(1).split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "銷售總額,10000",
        "實收金額,9500",
        "代收稅額,0",
        "淨營收（未稅）,9500",
        "毛利率,57.9%",
        "金流手續費（估算）,250",
        "人事成本（排班）,600",
        "營業費用,3000",
        "本日損益,2500",
        "類別,備註（選填）,金額",
      ]),
    );
    // Revenue lines come before COGS, which comes before the net profit.
    expect(lines.findIndex((l) => l.startsWith("銷售總額"))).toBeLessThan(
      lines.findIndex((l) => l.startsWith("本日損益")),
    );
    expect(lines).toContain(`租金,"'=HYPERLINK(""http://evil"",""x"")",1000`);
    expect(lines).toContain("租金,'@SUM(A1),2000");
  });

  it("hands the Excel builder real numeric cells for both modes", async () => {
    getDaily.mockResolvedValue(
      statement({
        expenses: {
          totalCents: 100_000,
          byCategory: [{ category: "rent", amountCents: 100_000 }],
          items: [
            {
              id: "e1",
              category: "rent",
              amountCents: 100_000,
              note: "+1+1",
              createdAtMs: 1,
            },
          ],
        },
      }),
    );
    const wrapper = await mountView();

    await wrapper.get('[data-testid="pnl-export-xlsx"]').trigger("click");
    await flushPromises();
    const [rows, filename] = downloadXlsx.mock.calls[0];
    expect(filename).toBe("pnl_2026-11-12.xlsx");
    expect(rows).toEqual(
      expect.arrayContaining([
        ["銷售總額", 10_000],
        ["本日損益", 2_500],
        ["租金", "'+1+1", 1_000],
      ]),
    );

    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="pnl-export-xlsx"]').trigger("click");
    await flushPromises();
    const [rangeRows, rangeName] = downloadXlsx.mock.calls[1];
    expect(rangeName).toBe("pnl_2026-11-01_2026-11-03.xlsx");
    expect(rangeRows[0][2]).toBe("淨營收（未稅）");
    expect(rangeRows[1]).toEqual([
      "2026-11-01",
      5,
      5000,
      2000,
      3000,
      200,
      600,
      100,
      2100,
    ]);
    expect(rangeRows[4][0]).toBe("區間合計");
  });

  it("offers export and print in both modes and prints via window.print", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const wrapper = await mountView();

    await wrapper.get('[data-testid="pnl-print"]').trigger("click");
    expect(print).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-testid="pnl-print-period"]').text()).toBe(
      (wrapper.get('[data-testid="pnl-date"]').element as HTMLInputElement)
        .value,
    );

    await wrapper.get('[data-testid="pnl-mode-range"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="pnl-export-csv"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pnl-export-xlsx"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="pnl-print-period"]').text()).toBe(
      "2026-11-01 – 2026-11-03",
    );
    await wrapper.get('[data-testid="pnl-print"]').trigger("click");
    expect(print).toHaveBeenCalledTimes(2);
    print.mockRestore();
  });

  it("renders the rate history and loads a chosen version into the form", async () => {
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-rates-open"]').trigger("click");
    await flushPromises();

    const history = wrapper.get('[data-testid="pnl-rates-history"]');
    expect(history.text()).toContain("2026-11-01");
    expect(history.text()).toContain("最初");
    expect(history.text()).toContain("Uber Eats 30%");
    expect(history.text()).not.toContain("1970-01-01");

    await wrapper
      .get('[data-testid="pnl-rates-history-1970-01-01"]')
      .trigger("click");
    const ecpay = wrapper.get('[data-testid="pnl-rate-payment-ecpay"]');
    expect((ecpay.element as HTMLInputElement).value).toBe("2");
    expect(
      (
        wrapper.get('[data-testid="pnl-rate-platform-uber_eats"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("30");
    expect(
      (
        wrapper.get('[data-testid="pnl-rates-effective-from"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("1970-01-01");

    await wrapper.get('[data-testid="pnl-rates-form"]').trigger("submit");
    await flushPromises();
    expect(saveRates).toHaveBeenCalledWith(
      "shop-1",
      expect.objectContaining({ effectiveFrom: "1970-01-01" }),
    );
  });

  it("sends the chosen effective date", async () => {
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-rates-open"]').trigger("click");
    await flushPromises();

    await wrapper
      .get('[data-testid="pnl-rates-effective-from"]')
      .setValue("2026-11-05");
    await wrapper.get('[data-testid="pnl-rates-form"]').trigger("submit");
    await flushPromises();

    expect(saveRates).toHaveBeenCalledWith(
      "shop-1",
      expect.objectContaining({ effectiveFrom: "2026-11-05" }),
    );
  });

  it.each([
    ["PNL_RATES_DATE_INVALID", "生效日不可晚於今天。"],
    [
      "PNL_RATES_TOO_MANY_VERSIONS",
      "費率版本已達上限（60 筆），請改用既有的生效日。",
    ],
  ])("maps %s to a translated toast", async (code, message) => {
    saveRates.mockRejectedValueOnce(apiError(code));
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-rates-open"]').trigger("click");
    await flushPromises();

    await wrapper.get('[data-testid="pnl-rates-form"]').trigger("submit");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith(message);
  });

  it("maps PNL_RATES_CONFLICT to a toast and reloads the stored rates", async () => {
    saveRates.mockRejectedValueOnce(apiError("PNL_RATES_CONFLICT"));
    const wrapper = await mountView();
    await wrapper.get('[data-testid="pnl-rates-open"]').trigger("click");
    await flushPromises();
    expect(getRates).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-testid="pnl-rate-payment-ecpay"]').setValue("9");
    await wrapper.get('[data-testid="pnl-rates-form"]').trigger("submit");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith(
      "費率剛被其他人更新，請重新載入後再試。",
    );
    expect(getRates).toHaveBeenCalledTimes(2);
    expect(
      (
        wrapper.get('[data-testid="pnl-rate-payment-ecpay"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("1.5");
  });

  it("links the missing-wage note to Employees", async () => {
    getDaily.mockResolvedValue(
      statement({ labor: { costCents: 0, shifts: 2, shiftsMissingRate: 2 } }),
    );
    const wrapper = await mountView();
    expect(wrapper.find('[data-testid="pnl-labor-set-wage"]').exists()).toBe(
      true,
    );
  });
});
