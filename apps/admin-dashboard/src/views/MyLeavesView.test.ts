// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, type Component } from "vue";

/**
 * #344 was "this view has no route, so nobody ever renders it". A test that
 * imports the file directly would have passed on the dead LeaveView too, so
 * these pull the view out of the real router by path — exactly what a click on
 * the sidebar link does. If the route is ever dropped again, this file fails.
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

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    user: { id: "user-chef-2", role: 2 },
  }),
}));

const getLeaveTypes = vi.fn();
const getRequests = vi.fn();
const getBalances = vi.fn();
const createRequest = vi.fn();
const cancelRequest = vi.fn();

vi.mock("@/services/leavesService", () => ({
  leavesService: {
    getLeaveTypes: (...args: unknown[]) => getLeaveTypes(...args),
    getRequests: (...args: unknown[]) => getRequests(...args),
    getBalances: (...args: unknown[]) => getBalances(...args),
    createRequest: (...args: unknown[]) => createRequest(...args),
    cancelRequest: (...args: unknown[]) => cancelRequest(...args),
  },
}));

/**
 * The real dialog is ~900 lines of date arithmetic owned by #307/#330/#343 and
 * is not what these tests are about; the stub keeps the contract (props in,
 * `submit` out) without importing that graph.
 */
const LeaveRequestDialogStub = defineComponent({
  name: "LeaveRequestDialog",
  props: {
    isOpen: { type: Boolean, default: false },
    leaveTypes: { type: Array, default: () => [] },
    balances: { type: Array, default: () => [] },
  },
  emits: ["close", "submit"],
  template: '<div data-testid="leave-request-dialog" />',
});

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildLeaveType(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    restaurantId: "restaurant-1",
    code: "ANNUAL",
    name: "特休",
    accrualType: "yearly",
    accrualAmount: 14,
    requiresApproval: true,
    requiresDocumentation: false,
    isPaid: true,
    isActive: true,
    ...overrides,
  };
}

function buildBalance(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    employeeId: "user-chef-2",
    leaveTypeId: 5,
    restaurantId: "restaurant-1",
    year: 2026,
    totalDays: 14,
    usedDays: 2,
    pendingDays: 1,
    remainingDays: 11,
    leaveType: { id: 5, name: "特休", color: null, isPaid: true },
    ...overrides,
  };
}

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 88,
    restaurantId: "restaurant-1",
    employeeId: "user-chef-2",
    leaveTypeId: 5,
    startDate: isoDate(7),
    endDate: isoDate(8),
    startPeriod: "full",
    endPeriod: "full",
    totalDays: 2,
    reason: "家庭旅遊",
    attachmentUrl: null,
    status: "pending",
    approvalChain: "[]",
    rejectionReason: null,
    cancellationReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    leaveType: { id: 5, name: "特休", color: null, isPaid: true },
    ...overrides,
  };
}

/** The route's own lazy loader. #211: pay the router graph once, in beforeAll. */
let MyLeavesView: Component;

beforeAll(async () => {
  const { router } = await import("@/router");
  const resolved = router.resolve("/dashboard/my-leaves");

  expect(resolved.name).toBe("MyLeaves");
  // Every staff role, not just managers: that is the whole point of #344.
  expect(resolved.meta.roles).toEqual([0, 1, 2, 3, 4]);

  const record = resolved.matched[resolved.matched.length - 1];
  const loader = record.components?.default as () => Promise<{
    default: Component;
  }>;
  MyLeavesView = (await loader()).default;
}, 30_000);

function mountView() {
  return mount(MyLeavesView, {
    global: { stubs: { LeaveRequestDialog: LeaveRequestDialogStub } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getLeaveTypes.mockResolvedValue([buildLeaveType()]);
  getRequests.mockResolvedValue([buildRequest()]);
  getBalances.mockResolvedValue([buildBalance()]);
  createRequest.mockResolvedValue(buildRequest());
  cancelRequest.mockResolvedValue(undefined);
});

describe("MyLeavesView (admin dashboard)", () => {
  it("is what /dashboard/my-leaves loads, and asks only for the signed-in employee's leave", async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(getRequests).toHaveBeenCalledWith(
      "restaurant-1",
      expect.objectContaining({ employeeId: "user-chef-2" }),
    );
    expect(getBalances).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "user-chef-2" }),
    );
    expect(wrapper.findAll('[data-testid="my-leave-balance"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="my-leave-request"]')).toHaveLength(1);
  });

  it("cancels with a reason, which the endpoint requires", async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper.find('[data-testid="my-leave-cancel-open"]').trigger("click");
    await wrapper
      .find('[data-testid="my-leave-cancel-reason"]')
      .setValue("行程取消");
    await wrapper
      .find('[data-testid="my-leave-cancel-confirm"]')
      .trigger("click");
    await flushPromises();

    // cancelLeaveRequestSchema is `{ reason: nonEmptyString }`, so the empty
    // body the deleted service method sent was a guaranteed 400 (#344).
    expect(cancelRequest).toHaveBeenCalledOnce();
    expect(cancelRequest).toHaveBeenCalledWith(88, "行程取消");
    expect(toastSuccess).toHaveBeenCalledWith("leaves.messages.cancelSuccess");
    // Success reloads.
    expect(getRequests).toHaveBeenCalledTimes(2);
  });

  it("will not send a cancellation without a reason", async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper.find('[data-testid="my-leave-cancel-open"]').trigger("click");
    await wrapper
      .find('[data-testid="my-leave-cancel-confirm"]')
      .trigger("click");
    await flushPromises();

    expect(cancelRequest).not.toHaveBeenCalled();
  });

  it("offers cancel only where the server would accept it", async () => {
    getRequests.mockResolvedValue([
      buildRequest({ id: 1, status: "pending" }),
      buildRequest({ id: 2, status: "approved", startDate: isoDate(5) }),
      // Approved and already started: cancelling would refund days already
      // taken, so LeaveService refuses it (#329).
      buildRequest({ id: 3, status: "approved", startDate: isoDate(-1) }),
      buildRequest({ id: 4, status: "rejected" }),
      buildRequest({ id: 5, status: "cancelled" }),
    ]);

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="my-leave-request"]')).toHaveLength(5);
    expect(
      wrapper.findAll('[data-testid="my-leave-cancel-open"]'),
    ).toHaveLength(2);
  });

  it("forwards the dialog's documentation link when filing a request", async () => {
    const wrapper = mountView();
    await flushPromises();

    wrapper.findComponent(LeaveRequestDialogStub).vm.$emit("submit", {
      leaveTypeId: "5",
      startDate: isoDate(3),
      endDate: isoDate(3),
      startPeriod: "am",
      endPeriod: "am",
      reason: "看診需要半天",
      attachmentUrl: "https://example.com/note.pdf",
    });
    await flushPromises();

    expect(createRequest).toHaveBeenCalledOnce();
    const [restaurantId, payload] = createRequest.mock.calls[0];
    expect(restaurantId).toBe("restaurant-1");
    expect(payload).toEqual(
      expect.objectContaining({
        leaveTypeId: 5,
        // A period per end of the range, not one shared key (#330).
        startPeriod: "am",
        endPeriod: "am",
        // #343: the dialog's link used to be dropped on the floor.
        attachmentUrl: "https://example.com/note.pdf",
      }),
    );
    // The employee is bound to the session by the route handler.
    expect(payload).not.toHaveProperty("employeeId");
  });

  it("surfaces a failed load instead of rendering an empty page", async () => {
    getRequests.mockRejectedValue({ response: { status: 403 } });
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('[data-testid="my-leaves-error"]').exists()).toBe(true);
  });
});
