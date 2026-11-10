// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosHeaders, type AxiosResponse } from "axios";
import type { ApiResponse, Coupon } from "@makanmasak/shared-types";
import CouponDistributeModal from "./CouponDistributeModal.vue";
import { api } from "@/services/api";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const extractApiErrorCode = vi.hoisted(() => vi.fn());

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({ formatDate: (value: string) => value }),
}));
vi.mock("vue-toastification", () => ({ useToast: () => toast }));
vi.mock("@/utils/errorHandler", () => ({
  extractApiErrorCode,
  markErrorHandled: vi.fn(),
}));
vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

function apiResponse<T>(data: T): AxiosResponse<ApiResponse<T>> {
  return {
    data: { success: true, data },
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

const coupon: Coupon = {
  id: 7,
  code: "GIVEAWAY",
  name: "Giveaway",
  discountType: "fixed",
  discountValue: 5,
  minOrderAmount: 0,
  usedCount: 0,
  validFrom: "2026-01-01T00:00:00.000Z",
  validTo: "2099-01-01T00:00:00.000Z",
  isActive: true,
  isVisible: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("CouponDistributeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(apiResponse([]));
    vi.mocked(api.post).mockResolvedValue(
      apiResponse({ issued: 4, skipped: 1, targeted: 5 }),
    );
  });

  it("shows the empty state when the coupon has never been distributed", async () => {
    const wrapper = mount(CouponDistributeModal, { props: { coupon } });
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith("/coupons/7/distributions");
    expect(
      wrapper.find('[data-testid="distribute-history-empty"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="distribute-history"]').exists()).toBe(
      false,
    );
  });

  it("renders one row per past batch", async () => {
    vi.mocked(api.get).mockResolvedValue(
      apiResponse([
        {
          id: 1,
          targetType: "new_user",
          totalDistributed: 12,
          totalUsed: 3,
          distributedAt: "2026-08-01T00:00:00.000Z",
        },
      ]),
    );
    const wrapper = mount(CouponDistributeModal, { props: { coupon } });
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="distribute-history"] tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("couponDistribute.targets.newUser");
    expect(rows[0].text()).toContain("12");
  });

  it("will not submit a specific-customer batch with no customers listed", async () => {
    const wrapper = mount(CouponDistributeModal, { props: { coupon } });
    await flushPromises();

    await wrapper
      .get('[data-testid="distribute-target-type"]')
      .setValue("user");
    const submit = wrapper.get('[data-testid="distribute-submit"]');
    expect(submit.attributes("disabled")).toBeDefined();

    await submit.trigger("click");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("sends the criteria the chosen audience needs and reports the counts", async () => {
    const wrapper = mount(CouponDistributeModal, { props: { coupon } });
    await flushPromises();

    await wrapper.get('[data-testid="distribute-target-type"]').setValue("vip");
    await wrapper.get('[data-testid="distribute-min-orders"]').setValue("3");
    await wrapper.get('[data-testid="distribute-submit"]').trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith(
      "/coupons/7/distribute",
      expect.objectContaining({
        distributionType: "manual",
        targetType: "vip",
        targetCriteria: { minOrders: 3 },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("couponDistribute.done"),
    );
    expect(wrapper.emitted("distributed")).toHaveLength(1);
  });

  it("explains an unsupported audience rather than a generic failure", async () => {
    extractApiErrorCode.mockReturnValue(
      "COUPON_DISTRIBUTION_TARGET_UNSUPPORTED",
    );
    vi.mocked(api.post).mockRejectedValue(new Error("400"));

    const wrapper = mount(CouponDistributeModal, { props: { coupon } });
    await flushPromises();
    await wrapper.get('[data-testid="distribute-submit"]').trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith(
      "couponDistribute.targetUnsupported",
    );
    expect(wrapper.emitted("distributed")).toBeUndefined();
  });
});
