// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import type {
  PlanImpact,
  PlanOption,
  PlanOverview,
} from "@/services/planService";

const getPlan = vi.hoisted(() => vi.fn());
const getImpact = vi.hoisted(() => vi.fn());
const changePlan = vi.hoisted(() => vi.fn());
const cancelPending = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());
const refreshModules = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const authState = vi.hoisted(() => ({
  user: { role: 1 } as { role: number } | null,
  restaurantId: "shop-1" as string | null,
}));

// `@/i18n` is deliberately not mocked: the literals below are zh-TW source
// strings, so a missing key cannot pass as present.
vi.mock("@/stores/auth", () => ({ useAuthStore: () => authState }));
vi.mock("vue-toastification", () => ({ useToast: () => toast }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ hash: "" }),
}));
vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm }),
}));
vi.mock("@makanmasak/shared/composables/useModuleAccess", () => ({
  useModuleAccess: () => ({ refresh: refreshModules }),
}));
vi.mock("@/services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/api")>()),
  api: { get: apiGet },
}));
vi.mock("@/services/planService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/planService")>()),
  planService: { getPlan, getImpact, changePlan, cancelPending },
}));

let BillingView: Component;

const NOW = 1_800_000_000_000;

function option(overrides: Partial<PlanOption> = {}): PlanOption {
  return {
    tier: "basic",
    action: "upgrade",
    effective: "immediately",
    effectiveAt: null,
    modules: ["menu_management", "pos"],
    gainedModules: ["pos"],
    lostModules: [],
    quotas: {
      "orders.created": { soft: 800, hard: 1000 },
      "print.jobs": null,
      "ai.requests": { soft: 0, hard: 0 },
      "storage.bytes": { soft: 1, hard: 5_000_000_000 },
    },
    ...overrides,
  };
}

function overview(overrides: Partial<PlanOverview> = {}): PlanOverview {
  return {
    restaurantId: "shop-1",
    currentTier: "trial",
    isActive: true,
    trialEndsAt: NOW + 5 * 86_400_000,
    trialExpired: false,
    cycle: { startAt: NOW, endAt: NOW + 30 * 86_400_000, kind: "trial" },
    pendingChange: null,
    options: [
      option({ tier: "trial", action: "current", effective: null }),
      option({ tier: "basic" }),
      option({
        tier: "pro",
        gainedModules: ["pos", "analytics"],
        modules: ["menu_management", "pos", "receipt_printing", "ai_analytics"],
      }),
      option({ tier: "enterprise" }),
    ],
    ...overrides,
  };
}

function impact(overrides: Partial<PlanImpact> = {}): PlanImpact {
  return { toTier: "pro", lostModules: [], items: [], ...overrides };
}

/** An axios-shaped rejection carrying the unified error envelope. */
function apiError(code: string, status = 409) {
  return { response: { status, data: { success: false, error: { code } } } };
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(BillingView, {
    global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
  });
  await flushPromises();
  return wrapper;
}

const action = (wrapper: VueWrapper, tier: string) =>
  wrapper.get(`[data-testid="plan-action-${tier}"]`);

describe("BillingView plan section", () => {
  beforeAll(async () => {
    getPlan.mockResolvedValue(overview());
    apiGet.mockResolvedValue({ data: { data: {} } });
    BillingView = (await import("./BillingView.vue")).default;
    (await mountView()).unmount();
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { role: 1 };
    authState.restaurantId = "shop-1";
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    apiGet.mockImplementation(async (url: string) => ({
      data: {
        data:
          url === "/me/modules"
            ? { planTier: "trial", isActive: true, effectiveModules: {} }
            : { meters: [] },
      },
    }));
    getPlan.mockResolvedValue(overview());
    getImpact.mockResolvedValue(impact());
    changePlan.mockResolvedValue(overview({ currentTier: "pro" }));
    cancelPending.mockResolvedValue(overview());
    refreshModules.mockResolvedValue(undefined);
    confirm.mockResolvedValue(true);
  });

  it("renders one card per option with limits, modules and a current marker", async () => {
    const wrapper = await mountView();

    expect(getPlan).toHaveBeenCalledOnce();
    const tiers = wrapper
      .findAll('[data-testid^="plan-card-"]')
      .map((card) => card.attributes("data-testid"));
    expect(tiers).toEqual([
      "plan-card-trial",
      "plan-card-basic",
      "plan-card-pro",
      "plan-card-enterprise",
    ]);

    const trial = wrapper.get('[data-testid="plan-card-trial"]');
    expect(trial.text()).toContain("試用版");
    expect(trial.find('[data-testid="plan-current-marker"]').text()).toBe(
      "目前方案",
    );
    expect(trial.find('[data-testid="plan-action-trial"]').exists()).toBe(
      false,
    );

    const basic = wrapper.get('[data-testid="plan-card-basic"]');
    expect(
      basic.get('[data-testid="plan-basic-limit-orders"]').text(),
    ).toContain("1,000");
    // Basic has neither printing nor AI: "not included", never "unlimited".
    expect(
      basic.get('[data-testid="plan-basic-limit-print"]').text(),
    ).toContain("不含");
    expect(basic.get('[data-testid="plan-basic-limit-ai"]').text()).toContain(
      "不含",
    );
    expect(
      wrapper.get('[data-testid="plan-pro-limit-print"]').text(),
    ).toContain("不限");
    expect(
      basic.get('[data-testid="plan-basic-limit-storage"]').text(),
    ).toContain("5 GB");
    expect(basic.get('[data-testid="plan-basic-module-pos"]').text()).toContain(
      "POS",
    );
    expect(action(wrapper, "basic").text()).toBe("立即升級");
  });

  it("labels a downgrade with its effective date", async () => {
    getPlan.mockResolvedValue(
      overview({
        currentTier: "pro",
        options: [
          option({
            tier: "basic",
            action: "downgrade",
            effective: "cycle_end",
            effectiveAt: NOW + 10 * 86_400_000,
          }),
          option({ tier: "pro", action: "current", effective: null }),
        ],
      }),
    );

    const wrapper = await mountView();

    expect(action(wrapper, "basic").text()).toMatch(/^排定降級，.+ 生效$/);
  });

  it("disables unavailable plans and says why", async () => {
    getPlan.mockResolvedValue(
      overview({
        currentTier: "basic",
        options: [
          option({
            tier: "trial",
            action: "unavailable",
            unavailableReason: "trial_not_reenterable",
            effective: null,
          }),
          option({
            tier: "enterprise",
            action: "unavailable",
            unavailableReason: "region",
            effective: null,
          }),
        ],
      }),
    );

    const wrapper = await mountView();

    expect(action(wrapper, "trial").attributes("disabled")).toBeDefined();
    expect(
      wrapper.get('[data-testid="plan-unavailable-trial"]').text(),
    ).toContain("無法再回到試用版");
    expect(action(wrapper, "enterprise").attributes("disabled")).toBeDefined();
    expect(
      wrapper.get('[data-testid="plan-unavailable-enterprise"]').text(),
    ).toContain("所在的地區尚未提供");
  });

  it("confirms with the impact, then changes the plan and refreshes module access", async () => {
    getImpact.mockResolvedValue(
      impact({
        toTier: "basic",
        lostModules: ["analytics"],
        items: [
          { key: "future_reservations", count: 12, blocking: false },
          { key: "active_coupons", count: 0, blocking: false },
        ],
      }),
    );
    const wrapper = await mountView();

    await action(wrapper, "basic").trigger("click");
    await flushPromises();

    expect(getImpact).toHaveBeenCalledWith("basic", null);
    expect(confirm).toHaveBeenCalledOnce();
    const modal = confirm.mock.calls[0][0];
    expect(modal).toEqual(
      expect.objectContaining({
        title: "變更為標準版",
        confirmDisabled: false,
        message: expect.stringContaining("立即生效"),
        // It loses analytics, so it is a change, not a pure upgrade.
        confirmLabel: "確認變更",
      }),
    );
    expect(modal.message).toContain("本期用量將從 0 重新計算");
    expect(modal.message).toContain("無法再回到試用版");
    expect(modal.sections).toEqual([
      { heading: "新增的功能", items: ["POS 收銀"] },
      { heading: "將失去的功能", items: ["數據分析"] },
      { heading: "變更後的影響", items: ["12 筆未來的訂位將無法在後台查看"] },
    ]);

    expect(changePlan).toHaveBeenCalledOnce();
    expect(changePlan).toHaveBeenCalledWith("basic", null);
    expect(refreshModules).toHaveBeenCalledOnce();
    expect(getPlan).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("方案已變更為標準版");
  });

  it("blocks the confirmation on a blocking item and offers the POS link", async () => {
    getImpact.mockResolvedValue(
      impact({
        items: [{ key: "open_cash_shift", count: 1, blocking: true }],
      }),
    );
    const wrapper = await mountView();

    await action(wrapper, "basic").trigger("click");
    await flushPromises();

    const modal = confirm.mock.calls[0][0];
    expect(modal.confirmDisabled).toBe(true);
    expect(modal.link).toEqual({
      to: { name: "POSCheckout" },
      label: "前往 POS 結束班次",
    });
    expect(modal.sections.at(-1)).toEqual({
      heading: "需要先處理",
      items: ["有 1 個尚未結束的收銀班次，請先到 POS 結束班次再降級"],
      blocking: true,
    });
  });

  it("does not change anything when the owner declines", async () => {
    confirm.mockResolvedValue(false);
    const wrapper = await mountView();

    await action(wrapper, "pro").trigger("click");
    await flushPromises();

    expect(changePlan).not.toHaveBeenCalled();
    expect(refreshModules).not.toHaveBeenCalled();
  });

  it("shows a scheduled downgrade and cancels it after confirmation", async () => {
    getPlan.mockResolvedValue(
      overview({
        currentTier: "pro",
        pendingChange: {
          toTier: "basic",
          effectiveAt: NOW + 10 * 86_400_000,
          requestedAt: NOW,
          deferredReason: null,
        },
      }),
    );
    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="billing-pending-text"]').text()).toMatch(
      /^已排定於 .+ 降級為 標準版$/,
    );

    getPlan.mockResolvedValue(overview({ currentTier: "pro" }));
    await wrapper
      .get('[data-testid="billing-pending-cancel"]')
      .trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalledOnce();
    expect(cancelPending).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith("已取消降級");
    expect(
      wrapper.find('[data-testid="billing-pending-change"]').exists(),
    ).toBe(false);
  });

  it("says a deferred downgrade is waiting for the cash shift", async () => {
    getPlan.mockResolvedValue(
      overview({
        currentTier: "pro",
        pendingChange: {
          toTier: "basic",
          effectiveAt: NOW,
          requestedAt: NOW,
          deferredReason: "open_cash_shift",
        },
      }),
    );

    const wrapper = await mountView();

    expect(
      wrapper.get('[data-testid="billing-pending-text"]').text(),
    ).toContain("收銀班次");
    expect(
      wrapper.find('[data-testid="billing-pending-pos-link"]').exists(),
    ).toBe(true);
  });

  it.each([
    ["PLAN_UNCHANGED", "您已經在使用這個方案。"],
    ["PLAN_TRIAL_NOT_REENTERABLE", "無法回到試用版。"],
    ["PLAN_NOT_AVAILABLE_IN_REGION", "此方案在您所在的地區尚未提供。"],
    ["SUBSCRIPTION_INACTIVE", "訂閱目前已停用，無法變更方案，請聯絡客服。"],
    [
      "PLAN_CHANGE_BLOCKED_OPEN_SHIFT",
      "仍有未結束的收銀班次，請先到 POS 結束班次再降級。",
    ],
  ])("translates %s", async (code, message) => {
    changePlan.mockRejectedValue(apiError(code));
    const wrapper = await mountView();

    await action(wrapper, "basic").trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(message);
    expect(refreshModules).not.toHaveBeenCalled();
  });

  it("refetches the plan after a conflict", async () => {
    changePlan.mockRejectedValue(apiError("PLAN_CHANGE_CONFLICT"));
    const wrapper = await mountView();
    expect(getPlan).toHaveBeenCalledTimes(1);

    await action(wrapper, "basic").trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("已被其他人變更"),
    );
    expect(getPlan).toHaveBeenCalledTimes(2);
  });

  it("refetches when there turns out to be nothing to cancel", async () => {
    getPlan.mockResolvedValue(
      overview({
        pendingChange: {
          toTier: "basic",
          effectiveAt: NOW,
          requestedAt: NOW,
          deferredReason: null,
        },
      }),
    );
    cancelPending.mockRejectedValue(apiError("PLAN_NO_PENDING_CHANGE", 404));
    const wrapper = await mountView();

    await wrapper
      .get('[data-testid="billing-pending-cancel"]')
      .trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith(
      "目前沒有排定的降級，已為您更新畫面。",
    );
    expect(getPlan).toHaveBeenCalledTimes(2);
  });

  it("points the help link at the published guide", async () => {
    const wrapper = await mountView();

    expect(
      wrapper.get('[data-testid="billing-plans-guide"]').attributes("href"),
    ).toMatch(/\/guide\/system-handbook\.html#modules-heading$/);
  });

  it("calls a pure gain an upgrade, and a paid plan that loses features a change", async () => {
    const wrapper = await mountView();
    expect(action(wrapper, "basic").text()).toBe("立即升級");

    getPlan.mockResolvedValue(
      overview({
        options: [
          option({ tier: "basic", lostModules: ["analytics", "coupons"] }),
        ],
      }),
    );
    const lossy = await mountView();
    expect(action(lossy, "basic").text()).toBe("立即變更");

    getImpact.mockResolvedValue(impact({ lostModules: [] }));
    await action(wrapper, "basic").trigger("click");
    await flushPromises();
    expect(confirm.mock.calls[0][0].confirmLabel).toBe("確認升級");
  });

  it("labels a scheduled downgrade's confirm button and restarts usage on the effective date", async () => {
    getPlan.mockResolvedValue(
      overview({
        currentTier: "pro",
        options: [
          option({
            tier: "basic",
            action: "downgrade",
            effective: "cycle_end",
            effectiveAt: NOW + 10 * 86_400_000,
          }),
        ],
      }),
    );
    getImpact.mockResolvedValue(impact({ lostModules: ["analytics"] }));
    const wrapper = await mountView();

    await action(wrapper, "basic").trigger("click");
    await flushPromises();

    const modal = confirm.mock.calls[0][0];
    expect(modal.confirmLabel).toBe("確認排定降級");
    expect(modal.message).toContain("新方案的用量自生效日起重新計算");
  });

  it("turns the pending target's card button into a cancel action", async () => {
    getPlan.mockResolvedValue(
      overview({
        currentTier: "pro",
        pendingChange: {
          toTier: "basic",
          effectiveAt: NOW + 10 * 86_400_000,
          requestedAt: NOW,
          deferredReason: null,
        },
        options: [
          option({
            tier: "basic",
            action: "downgrade",
            effective: "cycle_end",
            effectiveAt: NOW + 10 * 86_400_000,
          }),
          option({ tier: "pro", action: "current", effective: null }),
        ],
      }),
    );
    const wrapper = await mountView();

    expect(action(wrapper, "basic").text()).toBe("取消降級");
    await action(wrapper, "basic").trigger("click");
    await flushPromises();

    expect(getImpact).not.toHaveBeenCalled();
    expect(cancelPending).toHaveBeenCalledOnce();
  });

  it("refetches the plan after PLAN_UNCHANGED", async () => {
    changePlan.mockRejectedValue(apiError("PLAN_UNCHANGED"));
    const wrapper = await mountView();

    await action(wrapper, "basic").trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith("您已經在使用這個方案。");
    expect(getPlan).toHaveBeenCalledTimes(2);
  });

  it("names the acting shop for a platform admin", async () => {
    authState.user = { role: 0 };
    authState.restaurantId = "shop-9";
    const wrapper = await mountView();

    expect(getPlan).toHaveBeenCalledWith("shop-9");
    await action(wrapper, "basic").trigger("click");
    await flushPromises();
    expect(getImpact).toHaveBeenCalledWith("basic", "shop-9");
    expect(changePlan).toHaveBeenCalledWith("basic", "shop-9");
  });

  it("asks an admin with no shop to pick one instead of failing", async () => {
    authState.user = { role: 0 };
    authState.restaurantId = null;
    const wrapper = await mountView();

    expect(getPlan).not.toHaveBeenCalled();
    expect(
      wrapper.get('[data-testid="billing-plans-no-restaurant"]').text(),
    ).toBe("請先選擇餐廳。");
    expect(wrapper.find('[data-testid="billing-plans-error"]').exists()).toBe(
      false,
    );
  });
});
