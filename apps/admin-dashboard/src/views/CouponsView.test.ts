// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import CouponsView from "./CouponsView.vue";
import { AxiosHeaders, type AxiosResponse } from "axios";
import type { ApiResponse } from "@/types";
import { api } from "@/services/api";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["info"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));
const extractApiErrorCode = vi.hoisted(() => vi.fn());
// Mutable so a test can take the module away without re-mocking the module.
const moduleAccess = vi.hoisted(() => ({
  effectiveModules: { coupons: true } as Record<string, boolean>,
  isLoaded: true,
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (amount: number) => `$${amount}` }),
}));
vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({ formatDate: (value: string) => value }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: { role: 0 } }),
}));
vi.mock("vue-toastification", () => ({ useToast: () => toast }));
vi.mock("@/utils/errorHandler", () => ({
  extractApiErrorCode,
  // useAsyncAction marks the failures it shows so the interceptor skips them.
  markErrorHandled: vi.fn(),
}));
vi.mock("@makanmasak/shared/stores/moduleAccess", () => ({
  useModuleAccessStore: () => moduleAccess,
}));
vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/composables/useAsyncModals", async () => {
  const { defineComponent } = await import("vue");
  return {
    useAsyncModals: () => ({
      CouponFormModal: defineComponent({
        name: "CouponFormModal",
        emits: ["save", "close"],
        template:
          '<button data-testid="coupon-form-save" @click="$emit(\'save\', {})" />',
      }),
      CouponStatsModal: defineComponent({ template: "<div />" }),
    }),
  };
});

function coupon() {
  return {
    id: 1,
    code: "SAVE10",
    name: "Save 10",
    discountType: "percentage",
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: 0,
    usageLimit: null,
    usedCount: 0,
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: "2026-09-01T00:00:00.000Z",
    isActive: true,
    isVisible: true,
  };
}

// api.get resolves a full AxiosResponse whose body is the { success, data }
// envelope; the mock has to produce the same thing.
function apiGetResponse<T>(
  body: ApiResponse<T>,
): AxiosResponse<ApiResponse<T>> {
  return {
    data: body,
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function couponResponse(total = 1, data = [coupon()]) {
  return apiGetResponse({
    success: true,
    data,
    pagination: {
      page: 1,
      limit: 20,
      total,
      totalPages: Math.ceil(total / 20),
    },
  });
}

function summaryResponse() {
  return apiGetResponse<Record<string, never>>({ success: true, data: {} });
}

function mountCoupons() {
  return mount(CouponsView);
}

// `findAll("button").find(...)` over this view's rendered tree, reused by the
// warm-up and by the body that walks the filters.
function paginationNext(wrapper: ReturnType<typeof mountCoupons>) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes("coupons.pagination.next"));
}

describe("CouponsView", () => {
  function configureCouponMocks() {
    vi.clearAllMocks();
    moduleAccess.effectiveModules = { coupons: true };
    moduleAccess.isLoaded = true;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/coupons/stats/summary") {
        return Promise.resolve(summaryResponse());
      }
      return Promise.resolve(couponResponse(21));
    });
    vi.mocked(api.post).mockResolvedValue({} as never);
  }

  beforeEach(configureCouponMocks);

  afterEach(() => vi.useRealTimers());

  // `resets pagination before requesting status, discount, and search filters`
  // is the first `it` in the file and was its slowest body by 2.2x -- 1,535ms
  // in the #351 sweep, 695ms in the package suite measured here against 318ms
  // for the next-worst (#360). Instrumented alone on a loaded 4-core box, its
  // ~540ms of real work broke down as:
  //
  //   mount               133-310ms   <- one-off
  //   flush                 30-81ms
  //   findAll("button")     26-68ms   <- one-off (first tree scan + text())
  //   pagination round      26-30ms
  //   status round          18-33ms
  //   discount round        31-75ms
  //   search round          11-52ms + assertions
  //
  // So roughly half of it was the first mount and the first whole-tree button
  // scan, and the rest is four genuine interaction rounds. The one-off half is
  // re-usable state, not per-test work, so a `beforeAll` pays it once under the
  // hook's own budget -- going through the same mount + flush + paginate path
  // the body uses, so the first `trigger("click")` is warm too.
  //
  // The four rounds stay in one body on purpose: each filter has to be applied
  // on top of the previous one for the assertions to say that the earlier
  // filters survive a pagination reset, which is the regression this test
  // exists for. Splitting them would either drop that or re-run the earlier
  // rounds in every split, which is no cheaper.
  beforeAll(async () => {
    configureCouponMocks();
    const warmup = mountCoupons();
    await flushPromises();
    await paginationNext(warmup)!.trigger("click");
    await flushPromises();
    warmup.unmount();
  }, 30_000);

  // `vi.useFakeTimers()` inside the filter body swaps the global timers for the
  // rest of that test; `afterEach` restores them. Nothing here leaks into the
  // warm-up, which runs before the first `beforeEach`.
  afterAll(() => vi.useRealTimers());

  it("resets pagination before requesting status, discount, and search filters", async () => {
    const wrapper = mountCoupons();
    await flushPromises();
    const next = paginationNext(wrapper);
    await next!.trigger("click");
    await flushPromises();

    const selects = wrapper.findAll("select");
    await selects[0].setValue("active");
    await flushPromises();
    expect(api.get).toHaveBeenLastCalledWith(
      "/coupons",
      expect.objectContaining({ page: "1", status: "active" }),
    );

    await next!.trigger("click");
    await selects[1].setValue("fixed");
    await flushPromises();
    expect(api.get).toHaveBeenLastCalledWith(
      "/coupons",
      expect.objectContaining({
        page: "1",
        status: "active",
        discountType: "fixed",
      }),
    );

    await next!.trigger("click");
    vi.useFakeTimers();
    await wrapper.find("input").setValue("SAVE");
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(api.get).toHaveBeenLastCalledWith(
      "/coupons",
      expect.objectContaining({
        page: "1",
        status: "active",
        discountType: "fixed",
        search: "SAVE",
      }),
    );
  });

  it("renders a loading row and then an empty row", async () => {
    let resolveCoupons:
      | ((value: AxiosResponse<ApiResponse<unknown>>) => void)
      | undefined;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/coupons/stats/summary") {
        return Promise.resolve(summaryResponse());
      }
      return new Promise((resolve) => {
        resolveCoupons = resolve;
      });
    });
    const wrapper = mount(CouponsView);
    await nextTick();
    expect(wrapper.text()).toContain("common.loading");

    resolveCoupons?.(couponResponse(0, []));
    await flushPromises();
    expect(wrapper.text()).toContain("common.noData");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  });

  it("explains a plan without the module instead of requesting the list", async () => {
    moduleAccess.effectiveModules = { coupons: false };
    const wrapper = mount(CouponsView);
    await flushPromises();

    expect(wrapper.text()).toContain("coupons.moduleUnavailable.title");
    expect(api.get).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("waits for the module store before requesting anything", async () => {
    moduleAccess.isLoaded = false;
    mount(CouponsView);
    await flushPromises();

    expect(api.get).not.toHaveBeenCalled();
  });

  it("shows one localized toast for a duplicate coupon code", async () => {
    extractApiErrorCode.mockReturnValue("COUPON_CODE_EXISTS");
    vi.mocked(api.post).mockRejectedValue({
      message: "Request failed with status code 409",
      response: { data: { error: { code: "COUPON_CODE_EXISTS" } } },
    });
    const wrapper = mount(CouponsView);
    await flushPromises();
    await wrapper.find("button").trigger("click");
    await wrapper.get('[data-testid="coupon-form-save"]').trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("coupons.messages.codeExists");
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringContaining("Request failed"),
    );
  });

  describe("status toggle", () => {
    const listCalls = () =>
      vi.mocked(api.get).mock.calls.filter(([url]) => url === "/coupons");
    const rowButton = (
      wrapper: ReturnType<typeof mountCoupons>,
      label: string,
    ) => wrapper.findAll("button").find((b) => b.text().includes(label))!;

    it("flips the row at once, sends one request on a double tap, and skips the list refetch", async () => {
      let resolve!: (value: unknown) => void;
      vi.mocked(api.post).mockReturnValue(
        new Promise((r) => (resolve = r)) as never,
      );
      const wrapper = mountCoupons();
      await flushPromises();
      const before = listCalls().length;

      const button = rowButton(wrapper, "coupons.actions.deactivate");
      await button.trigger("click");
      await button.trigger("click");

      expect(api.post).toHaveBeenCalledOnce();
      expect(api.post).toHaveBeenCalledWith("/coupons/1/deactivate");
      // The row flipped, so the pending button is now the "activate" one.
      expect(
        rowButton(wrapper, "common.saving").attributes("disabled"),
      ).toBeDefined();

      resolve({
        data: { success: true, data: { ...coupon(), isActive: false } },
      });
      await flushPromises();

      expect(wrapper.text()).toContain("coupons.actions.activate");
      expect(listCalls()).toHaveLength(before);
      expect(toast.success).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            message: "coupons.messages.deactivateSuccess",
          }),
        }),
        expect.anything(),
      );
    });

    it("Undo performs the reverse call", async () => {
      vi.mocked(api.put).mockResolvedValue({} as never);
      const wrapper = mountCoupons();
      await flushPromises();
      await rowButton(wrapper, "coupons.actions.deactivate").trigger("click");
      await flushPromises();

      toast.success.mock.calls.at(-1)![0].listeners.undo();
      await flushPromises();

      expect(api.put).toHaveBeenCalledOnce();
      expect(api.put).toHaveBeenCalledWith("/coupons/1", { isActive: true });
      expect(toast.dismiss).toHaveBeenCalledOnce();
      expect(wrapper.text()).toContain("coupons.actions.deactivate");
    });

    it("reverts the row and shows the server message when the call fails", async () => {
      vi.mocked(api.post).mockRejectedValue({
        response: {
          status: 409,
          data: { error: { code: "X", message: "Coupon is in use" } },
        },
      });
      const wrapper = mountCoupons();
      await flushPromises();
      await rowButton(wrapper, "coupons.actions.deactivate").trigger("click");
      await flushPromises();

      expect(toast.error).toHaveBeenCalledOnce();
      expect(toast.error).toHaveBeenCalledWith("Coupon is in use");
      expect(wrapper.text()).toContain("coupons.actions.deactivate");
      expect(wrapper.text()).not.toContain("coupons.actions.activate");
    });
  });

  describe("compact viewport", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("renders each coupon as a card with every action reachable", async () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn().mockReturnValue({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
      );
      const wrapper = mountCoupons();
      await flushPromises();

      expect(wrapper.find("table").exists()).toBe(false);
      const card = wrapper.get('[data-testid="coupon-card"]');
      for (const text of [
        "Save 10",
        "SAVE10",
        "10%",
        "coupons.table.unlimited",
        "coupons.actions.stats",
        "coupons.actions.edit",
        "coupons.actions.distribute",
        "coupons.actions.deactivate",
        "coupons.actions.delete",
      ]) {
        expect(card.text()).toContain(text);
      }
    });
  });
});
