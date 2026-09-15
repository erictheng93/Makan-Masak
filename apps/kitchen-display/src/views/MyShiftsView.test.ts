// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";

/**
 * #320's employee entry, in the app role 2 actually uses. The admin dashboard
 * logs chefs out on sight (its LoginView), so a swap entry that existed only
 * there would be unreachable for the whole kitchen.
 *
 * The view is pulled out of the real route table rather than imported by path,
 * so a route that stops pointing here fails the test instead of passing it.
 */

vi.mock("@/i18n", async () => {
  const { ref } = await import("vue");
  return {
    useI18n: () => ({
      t: (key: string) => key,
      // KitchenHeader also drives the language switcher from this composable.
      locale: ref("zh-TW"),
      localeConfig: ref({ flag: "TW" }),
      switchLocale: vi.fn(),
      supportedLocales: [],
    }),
  };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("vue-toastification", () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "restaurant-1" }),
}));

const getMyShifts = vi.fn();
const getMySwapRequests = vi.fn();
const createSwapRequest = vi.fn();
const cancelSwapRequest = vi.fn();

vi.mock("@/services/schedulingApi", () => ({
  schedulingApi: {
    getMyShifts: (...args: unknown[]) => getMyShifts(...args),
    getMySwapRequests: (...args: unknown[]) => getMySwapRequests(...args),
    createSwapRequest: (...args: unknown[]) => createSwapRequest(...args),
    cancelSwapRequest: (...args: unknown[]) => cancelSwapRequest(...args),
  },
}));

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildShift(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    workDate: isoDate(3),
    startTime: "09:00",
    endTime: "17:00",
    status: "scheduled",
    ...overrides,
  };
}

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    requesterScheduleId: 41,
    requestType: "swap",
    reason: "家中有事",
    urgency: "normal",
    status: "pending",
    rejectionReason: null,
    ...overrides,
  };
}

let MyShiftsView: Component;
let KitchenHeader: Component;

beforeAll(async () => {
  const routes = (await import("@/router")).default;
  const route = routes.find((entry) => entry.path === "/my-shifts");

  expect(route).toBeDefined();
  // A chef, and only while signed in — the same gate the kitchen board uses.
  expect(route!.meta).toMatchObject({ requiresAuth: true, requiredRole: 2 });

  const loader = route!.component as () => Promise<{ default: Component }>;
  MyShiftsView = (await loader()).default;

  // Warmed here for the same reason MyShiftsView is (#211): the first
  // await import() of a component graph pays its whole transform cost, and
  // inside a test body that cost lands on the 5s testTimeout. It passed
  // standalone and timed out at 5017ms under a loaded verify:push, which is
  // the signature of that mistake rather than of a real defect.
  KitchenHeader = (await import("@/components/layout/KitchenHeader.vue"))
    .default;
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  getMyShifts.mockResolvedValue([buildShift()]);
  getMySwapRequests.mockResolvedValue([]);
  createSwapRequest.mockResolvedValue(undefined);
  cancelSwapRequest.mockResolvedValue(undefined);
});

describe("MyShiftsView (kitchen display)", () => {
  it("is what /my-shifts loads, and lists the chef's own upcoming shifts", async () => {
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    expect(getMyShifts).toHaveBeenCalledWith(
      "restaurant-1",
      expect.any(String),
      expect.any(String),
    );
    expect(getMySwapRequests).toHaveBeenCalledWith("restaurant-1");
    expect(wrapper.findAll('[data-testid="my-shift-row"]')).toHaveLength(1);
  });

  it("submits an open swap request without naming a colleague", async () => {
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    await wrapper.find('[data-testid="request-swap-button"]').trigger("click");
    await wrapper.find('[data-testid="swap-reason"]').setValue("要看醫生");
    await wrapper.find('[data-testid="swap-submit"]').trigger("click");
    await flushPromises();

    expect(createSwapRequest).toHaveBeenCalledOnce();
    const [restaurantId, payload] = createSwapRequest.mock.calls[0];
    expect(restaurantId).toBe("restaurant-1");
    expect(payload).toEqual({
      requesterScheduleId: 41,
      requestType: "swap",
      urgency: "normal",
      reason: "要看醫生",
      isOpenRequest: true,
    });
    // The requester is the session (#99), and no target employee is chosen.
    expect(payload).not.toHaveProperty("requesterEmployeeId");
    expect(payload).not.toHaveProperty("targetEmployeeId");

    expect(toastSuccess).toHaveBeenCalledWith("myShifts.submitSuccess");
    expect(wrapper.find('[data-testid="swap-form"]').exists()).toBe(false);
  });

  it("refuses to submit without a reason", async () => {
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    await wrapper.find('[data-testid="request-swap-button"]').trigger("click");
    await wrapper.find('[data-testid="swap-submit"]').trigger("click");
    await flushPromises();

    expect(createSwapRequest).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="swap-form-error"]').text()).toBe(
      "myShifts.reasonRequired",
    );
  });

  it("shows an empty state and an error state rather than a blank screen", async () => {
    getMyShifts.mockResolvedValue([]);
    const empty = mount(MyShiftsView);
    await flushPromises();
    expect(empty.find('[data-testid="my-shifts-empty"]').exists()).toBe(true);
    expect(empty.find('[data-testid="my-requests-empty"]').exists()).toBe(true);

    getMyShifts.mockRejectedValue({ response: { status: 403 } });
    const failed = mount(MyShiftsView);
    await flushPromises();
    expect(failed.find('[data-testid="my-shifts-error"]').text()).toContain(
      "errorPresentation.permissionDenied",
    );
  });

  it("hides the button on a shift that already has a pending request", async () => {
    getMySwapRequests.mockResolvedValue([buildRequest()]);
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    expect(wrapper.find('[data-status="swap-pending"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="request-swap-button"]').exists()).toBe(
      false,
    );
  });

  it("cancels a pending request", async () => {
    getMySwapRequests.mockResolvedValue([buildRequest()]);
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    await wrapper
      .find('[data-testid="cancel-request-button"]')
      .trigger("click");
    await flushPromises();

    expect(cancelSwapRequest).toHaveBeenCalledWith(7);
    expect(toastSuccess).toHaveBeenCalledWith("myShifts.cancelSuccess");
  });
});

describe("KitchenHeader entry point", () => {
  it("carries the button that reaches the swap page", async () => {
    const wrapper = mount(KitchenHeader, {
      props: {
        restaurantName: "阿嬤的店",
        currentTime: new Date("2026-09-05T10:00:00Z"),
        stats: {
          pendingCount: 0,
          preparingCount: 0,
          readyCount: 0,
          completedToday: 0,
          averageCookingTime: 0,
          averageWaitingTime: 0,
          efficiency: 0,
          urgentOrders: 0,
        },
      },
    });

    await wrapper.find('[data-testid="open-my-shifts"]').trigger("click");

    // EnhancedKitchenDashboard turns this into router.push("/my-shifts").
    expect(wrapper.emitted("open-my-shifts")).toHaveLength(1);
  });
});
