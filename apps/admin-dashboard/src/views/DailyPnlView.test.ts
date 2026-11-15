// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import type { DailyPnl } from "@/services/pnlService";

const getDaily = vi.hoisted(() => vi.fn());
const addExpense = vi.hoisted(() => vi.fn());
const deleteExpense = vi.hoisted(() => vi.fn());
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
  pnlService: { getDaily, addExpense, deleteExpense },
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
    netProfitCents: 350_000,
    ...overrides,
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
      "NT$3,500",
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
});
