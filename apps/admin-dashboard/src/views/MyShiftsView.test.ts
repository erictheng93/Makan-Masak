// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";

/**
 * #320 asked for the entry an employee can actually reach, and explicitly ruled
 * out "a zero-importer component". So these tests never import the view
 * directly: they pull it out of the real router by path, the same way a click
 * on the sidebar link would, and then drive it to a submitted request.
 */

vi.mock("@/i18n", async () => {
  const { ref } = await import("vue");
  // useDateFormatter reads `locale`, so a t-only stub throws on render.
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: ref("zh-TW") }), t };
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

const confirmModal = vi.fn();
vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: confirmModal }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    user: { id: "user-service-3", role: 3 },
  }),
}));

const getSchedules = vi.fn();
const getSwapRequests = vi.fn();
const createSwapRequest = vi.fn();
const cancelSwapRequest = vi.fn();

vi.mock("@/services/schedulingService", () => ({
  schedulingService: {
    getSchedules: (...args: unknown[]) => getSchedules(...args),
    getSwapRequests: (...args: unknown[]) => getSwapRequests(...args),
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
    restaurantId: "restaurant-1",
    employeeId: "user-service-3",
    shiftTemplateId: null,
    workDate: isoDate(3),
    startTime: "09:00",
    endTime: "17:00",
    breakDurationMinutes: 30,
    scheduledHours: 7.5,
    clockInTime: null,
    clockOutTime: null,
    actualHours: null,
    overtimeHours: null,
    status: "scheduled",
    notes: null,
    managerNotes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdBy: "user-owner-1",
    updatedBy: null,
    ...overrides,
  };
}

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    restaurantId: "restaurant-1",
    requesterEmployeeId: "user-service-3",
    requesterScheduleId: 41,
    targetEmployeeId: null,
    targetScheduleId: null,
    requestType: "swap",
    reason: "家中有事",
    urgency: "normal",
    status: "pending",
    isOpenRequest: true,
    acceptedBy: null,
    acceptedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}

/**
 * The route's own lazy loader, so the test binds to the entry rather than to
 * the file path. #211: pay the router graph once, under its own budget.
 */
let MyShiftsView: Component;

beforeAll(async () => {
  const { router } = await import("@/router");
  const resolved = router.resolve("/dashboard/my-shifts");

  expect(resolved.name).toBe("MyShifts");
  expect(resolved.meta.roles).toEqual([0, 1, 2, 3, 4]);

  const record = resolved.matched[resolved.matched.length - 1];
  const loader = record.components?.default as () => Promise<{
    default: Component;
  }>;
  MyShiftsView = (await loader()).default;
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  confirmModal.mockResolvedValue(true);
  getSchedules.mockResolvedValue({ data: [buildShift()] });
  getSwapRequests.mockResolvedValue({ data: [] });
  createSwapRequest.mockResolvedValue(buildRequest());
  cancelSwapRequest.mockResolvedValue(buildRequest({ status: "cancelled" }));
});

describe("MyShiftsView (admin dashboard)", () => {
  it("is what /dashboard/my-shifts loads, and asks only for the signed-in employee's shifts", async () => {
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    expect(getSchedules).toHaveBeenCalledOnce();
    expect(getSchedules).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        employeeId: "user-service-3",
      }),
    );
    expect(getSwapRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        requesterEmployeeId: "user-service-3",
      }),
    );
    expect(wrapper.findAll('[data-testid="my-shift-row"]')).toHaveLength(1);
  });

  it("names the swap dialog, contains keyboard focus and restores its trigger", async () => {
    const wrapper = mount(MyShiftsView, { attachTo: document.body });
    await flushPromises();
    const trigger = wrapper.get('[data-testid="request-swap-button"]');
    (trigger.element as HTMLButtonElement).focus();
    await trigger.trigger("click");
    await flushPromises();
    const dialog = wrapper.get('[role="dialog"]');
    expect(dialog.attributes("aria-modal")).toBe("true");
    expect(dialog.attributes("aria-labelledby")).toBeTruthy();
    expect(dialog.element.contains(document.activeElement)).toBe(true);
    const last = dialog.get('[data-testid="swap-submit"]');
    (last.element as HTMLButtonElement).focus();
    await last.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).not.toBe(last.element);
    expect(dialog.element.contains(document.activeElement)).toBe(true);
    await dialog.trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("submits a swap request bound to the session, never naming a requester", async () => {
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    await wrapper.find('[data-testid="request-swap-button"]').trigger("click");
    expect(wrapper.find('[data-testid="swap-form"]').exists()).toBe(true);

    await wrapper.find('[data-testid="swap-reason"]').setValue("家中有事");
    await wrapper.find('[data-testid="swap-submit"]').trigger("click");
    await flushPromises();

    expect(createSwapRequest).toHaveBeenCalledOnce();
    const [restaurantId, payload] = createSwapRequest.mock.calls[0];
    expect(restaurantId).toBe("restaurant-1");
    expect(payload).toEqual({
      requesterScheduleId: 41,
      requestType: "swap",
      reason: "家中有事",
      urgency: "normal",
      isOpenRequest: true,
    });
    // #99: the requester comes from the session. A body field would be ignored
    // by the API, so shipping one would only mislead the next reader.
    expect(payload).not.toHaveProperty("requesterEmployeeId");

    expect(toastSuccess).toHaveBeenCalledWith("myShifts.submitSuccess");
    expect(wrapper.find('[data-testid="swap-form"]').exists()).toBe(false);
    // Success reloads, so both lists were fetched twice.
    expect(getSchedules).toHaveBeenCalledTimes(2);
  });

  it("asks before discarding an edited swap and ignores Escape while submitting", async () => {
    const wrapper = mount(MyShiftsView);
    await flushPromises();
    await wrapper.get('[data-testid="request-swap-button"]').trigger("click");
    await wrapper.get('[data-testid="swap-reason"]').setValue("家中有事");
    confirmModal.mockResolvedValueOnce(false);
    await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(confirmModal).toHaveBeenCalledWith(
      expect.objectContaining({ message: "confirmations.unsavedChanges" }),
    );
    expect(wrapper.find('[data-testid="swap-form"]').exists()).toBe(true);
    let decide!: (value: boolean) => void;
    confirmModal.mockReturnValueOnce(
      new Promise((resolve) => {
        decide = resolve;
      }),
    );
    await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
    await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
    expect(confirmModal).toHaveBeenCalledTimes(2);
    decide(false);
    await flushPromises();
    let complete!: (value: unknown) => void;
    createSwapRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    await wrapper.get('[data-testid="swap-submit"]').trigger("click");
    await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[data-testid="swap-form"]').exists()).toBe(true);
    complete(buildRequest());
    await flushPromises();
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

  it("keeps the form open and explains a rejected submission", async () => {
    createSwapRequest.mockRejectedValue({ response: { status: 409 } });
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    await wrapper.find('[data-testid="request-swap-button"]').trigger("click");
    await wrapper.find('[data-testid="swap-reason"]').setValue("排班衝突");
    await wrapper.find('[data-testid="swap-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="swap-form"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="swap-form-error"]').text()).toBe(
      "errorPresentation.conflict",
    );
  });

  it("hides shifts that are past or already spoken for", async () => {
    getSchedules.mockResolvedValue({
      data: [
        buildShift({ id: 41 }),
        buildShift({ id: 42, workDate: isoDate(-2) }),
        buildShift({ id: 43, workDate: isoDate(5), status: "cancelled" }),
        buildShift({ id: 44, workDate: isoDate(6) }),
      ],
    });
    getSwapRequests.mockResolvedValue({
      data: [buildRequest({ requesterScheduleId: 44 })],
    });

    const wrapper = mount(MyShiftsView);
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="my-shift-row"]');
    // 42 is in the past and 43 is cancelled, so neither is listed at all.
    expect(rows).toHaveLength(2);
    // 44 already carries a pending request, so it shows a badge, not a button.
    expect(wrapper.findAll('[data-testid="request-swap-button"]')).toHaveLength(
      1,
    );
    expect(wrapper.find('[data-status="swap-pending"]').exists()).toBe(true);
  });

  it("shows the empty state rather than a blank page", async () => {
    getSchedules.mockResolvedValue({ data: [] });
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    expect(wrapper.find('[data-testid="my-shifts-empty"]').text()).toContain(
      "myShifts.noShifts",
    );
    expect(wrapper.find('[data-testid="my-requests-empty"]').exists()).toBe(
      true,
    );
  });

  it("explains a disabled staff_management module instead of failing silently", async () => {
    getSchedules.mockRejectedValue({ response: { status: 403 } });
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    expect(wrapper.find('[data-testid="my-shifts-error"]').text()).toContain(
      "errorPresentation.permissionDenied",
    );
  });

  it("cancels a pending request the employee raised", async () => {
    getSwapRequests.mockResolvedValue({ data: [buildRequest()] });
    const wrapper = mount(MyShiftsView);
    await flushPromises();

    await wrapper
      .find('[data-testid="cancel-request-button"]')
      .trigger("click");
    await flushPromises();

    expect(confirmModal).toHaveBeenCalledOnce();
    expect(cancelSwapRequest).toHaveBeenCalledWith(7);
    expect(toastSuccess).toHaveBeenCalledWith("myShifts.cancelSuccess");
  });
});
