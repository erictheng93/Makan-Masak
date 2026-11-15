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
      netRevenueCents: 950_000,
      taxCents: 45_000,
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
    ).toContain("2 個班次沒有時薪，未計入");
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
      "過去的日期",
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

    await wrapper.get('[data-testid="pnl-range-export"]').trigger("click");

    expect(downloadCsv).toHaveBeenCalledOnce();
    const [csv, filename] = downloadCsv.mock.calls[0];
    expect(filename).toBe("pnl_2026-11-01_2026-11-03.csv");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\n");
    expect(lines[0]).toBe(
      "日期,訂單數,淨營收,銷貨成本,毛利,手續費與抽成,人事成本,營業費用,損益",
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
});
