// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import GroupOrdersView from "./GroupOrdersView.vue";
import {
  groupOrdersService,
  type GroupOrder,
} from "@/services/groupOrdersService";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    user: { username: "Admin" },
  }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (amount: number) => `$${amount}` }),
}));

vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({
    formatDateTime: (value: string) => value,
    formatTime: (value: Date) => value.toISOString(),
  }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => toast,
}));

vi.mock("@/services/groupOrdersService", () => ({
  groupOrdersService: {
    getGroupOrders: vi.fn(),
    getGroupOrderStats: vi.fn(),
    recoverFinalization: vi.fn(),
    finalizeAsStaff: vi.fn(),
    createGroupOrder: vi.fn(),
    generateShareCode: vi.fn(),
    exportGroupOrders: vi.fn(),
  },
}));

const failedGroupOrder = (overrides: Partial<GroupOrder> = {}): GroupOrder => ({
  id: "group-1",
  shareCode: "GROUP1",
  masterOrderId: "order-1",
  tableNumber: "A1",
  status: "finalizing_failed",
  finalizeFailure: {
    code: "SPLIT_TOTAL_MISMATCH",
    splitError: "Totals do not match",
    failedAt: "2026-08-22T10:00:00.000Z",
    recoveryErrorDetails: [
      {
        code: "SPLIT_BILL_FAILED",
        splitError: "Retry did not complete",
        attemptedAt: "2026-08-22T10:05:00.000Z",
      },
    ],
  },
  hostName: "Admin",
  memberCount: 1,
  totalAmount: 120,
  subtotal: 120,
  serviceCharge: 0,
  taxAmount: 0,
  itemCount: 1,
  members: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      groupOrderId: "group-1",
      name: "Alex",
      itemCount: 1,
      totalAmount: 120,
      paymentStatus: "unpaid",
      joinedAt: "2026-08-22T09:00:00.000Z",
    },
  ],
  createdAt: "2026-08-22T09:00:00.000Z",
  completedAt: null,
  expiresAt: "2026-08-22T12:00:00.000Z",
  ...overrides,
});

const stats = {
  activeGroupOrders: 1,
  totalGroupOrders: 1,
  averageGroupSize: 1,
  averageOrderValue: 120,
  conversionRate: 0,
  popularTimeSlots: [],
  paymentMethodDistribution: {},
};

const apiError = (code: string, status: number) => ({
  response: {
    status,
    data: {
      error: {
        code,
        requestId: "request-1",
      },
    },
  },
});

describe("GroupOrdersView finalization recovery", () => {
  // The first mount of this view in a worker costs ~470ms against a loaded
  // machine while every later mount costs ~85ms -- Vue's render warm-up and
  // jsdom's first DOM build for this tree, paid once per test file. Left in
  // the first `it`, that one-off lands inside the 5s testTimeout and is what
  // tipped this file over under `turbo run test` (#351). Pay it here instead,
  // under the hook's own budget, so every timed body only re-renders.
  beforeAll(async () => {
    vi.mocked(groupOrdersService.getGroupOrders).mockResolvedValue([]);
    vi.mocked(groupOrdersService.getGroupOrderStats).mockResolvedValue(stats);
    const warmup = mount(GroupOrdersView);
    await flushPromises();
    warmup.unmount();
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(groupOrdersService.getGroupOrders).mockResolvedValue([
      failedGroupOrder(),
    ]);
    vi.mocked(groupOrdersService.getGroupOrderStats).mockResolvedValue(stats);
    vi.mocked(groupOrdersService.recoverFinalization).mockResolvedValue({
      masterOrderId: "order-1",
      status: "checkout",
    });
  });

  async function mountSelectedOrder(order = failedGroupOrder()) {
    vi.mocked(groupOrdersService.getGroupOrders).mockResolvedValue([order]);
    const wrapper = mount(GroupOrdersView);
    await flushPromises();
    await wrapper
      .get('[data-testid="group-order-details-group-1"]')
      .trigger("click");
    return wrapper;
  }

  it("shows recovery only for failed finalizations and renders retry history", async () => {
    const wrapper = await mountSelectedOrder();

    expect(
      wrapper.get('[data-testid="recover-finalization-group-1"]'),
    ).toBeTruthy();
    expect(wrapper.text()).toContain("SPLIT_BILL_FAILED");
    expect(wrapper.text()).toContain("2026-08-22T10:05:00.000Z");
  });

  // Split out of the test above, and one case per status rather than a loop:
  // this asserts the complementary case, and five mounts in a single body is
  // ~4s of the 5s budget once the machine is oversubscribed (#351). One mount
  // per body keeps each well under it.
  it.each([
    "active",
    "finalizing",
    "checkout",
    "completed",
    "cancelled",
  ] as const)(
    "hides the recovery control when the group order status is %s",
    async (status) => {
      const wrapper = await mountSelectedOrder(
        failedGroupOrder({ status, finalizeFailure: undefined }),
      );

      expect(
        wrapper.find('[data-testid="recover-finalization-group-1"]').exists(),
      ).toBe(false);
    },
  );

  it("calls recovery and refreshes the group orders after success", async () => {
    const wrapper = await mountSelectedOrder();
    vi.clearAllMocks();
    vi.mocked(groupOrdersService.getGroupOrders).mockResolvedValue([
      failedGroupOrder({ status: "checkout", finalizeFailure: undefined }),
    ]);
    vi.mocked(groupOrdersService.getGroupOrderStats).mockResolvedValue(stats);

    await wrapper
      .get('[data-testid="recover-finalization-group-1"]')
      .trigger("click");
    await flushPromises();

    expect(groupOrdersService.recoverFinalization).toHaveBeenCalledWith(
      "group-1",
    );
    expect(groupOrdersService.getGroupOrders).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "restaurant-1" }),
    );
    expect(groupOrdersService.getGroupOrderStats).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "restaurant-1" }),
    );
  });

  it("finalizes active groups through the authenticated staff route", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(groupOrdersService.getGroupOrders).mockResolvedValue([
      failedGroupOrder({ status: "active", finalizeFailure: undefined }),
    ]);
    vi.mocked(groupOrdersService.finalizeAsStaff).mockResolvedValue({
      masterOrderId: "order-1",
      status: "completed",
    });
    const wrapper = await mountSelectedOrder(
      failedGroupOrder({ status: "active", finalizeFailure: undefined }),
    );

    await wrapper
      .get('[data-testid="staff-finalize-group-1"]')
      .trigger("click");
    await flushPromises();

    expect(groupOrdersService.finalizeAsStaff).toHaveBeenCalledWith("group-1");
  });

  it("does not finalize when staff declines confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = await mountSelectedOrder(
      failedGroupOrder({ status: "active", finalizeFailure: undefined }),
    );

    await wrapper
      .get('[data-testid="staff-finalize-group-1"]')
      .trigger("click");

    expect(groupOrdersService.finalizeAsStaff).not.toHaveBeenCalled();
  });

  it("prevents double staff-finalize submissions while the first is pending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveFinalize: (() => void) | undefined;
    vi.mocked(groupOrdersService.finalizeAsStaff).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFinalize = () =>
            resolve({ masterOrderId: "order-1", status: "completed" });
        }),
    );
    const wrapper = await mountSelectedOrder(
      failedGroupOrder({ status: "active", finalizeFailure: undefined }),
    );
    const button = wrapper.get('[data-testid="staff-finalize-group-1"]');
    await button.trigger("click");
    await button.trigger("click");

    expect(groupOrdersService.finalizeAsStaff).toHaveBeenCalledTimes(1);
    expect(button.attributes("disabled")).toBeDefined();
    resolveFinalize?.();
    await flushPromises();
  });

  it("shows a toast when loading group orders fails", async () => {
    vi.mocked(groupOrdersService.getGroupOrders).mockRejectedValueOnce(
      new Error("offline"),
    );
    mount(GroupOrdersView);
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith("groupOrders.alerts.loadFailed");
  });

  it("shows a toast when staff finalization fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(groupOrdersService.finalizeAsStaff).mockRejectedValueOnce(
      new Error("offline"),
    );
    const wrapper = await mountSelectedOrder(
      failedGroupOrder({ status: "active", finalizeFailure: undefined }),
    );
    await wrapper
      .get('[data-testid="staff-finalize-group-1"]')
      .trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith(
      "groupOrders.alerts.finalizeFailed",
    );
  });

  it("distinguishes self-settled members from provider-confirmed revenue", async () => {
    const order = failedGroupOrder({
      memberCount: 2,
      members: [
        {
          id: "self-member",
          groupOrderId: "group-1",
          name: "Self payer",
          itemCount: 1,
          totalAmount: 60,
          paymentStatus: "paid",
          settledBy: "self",
          revenueRecognised: false,
          joinedAt: "2026-08-22T09:00:00.000Z",
        },
        {
          id: "provider-member",
          groupOrderId: "group-1",
          name: "Provider payer",
          itemCount: 1,
          totalAmount: 60,
          paymentStatus: "paid",
          settledBy: "provider",
          revenueRecognised: true,
          joinedAt: "2026-08-22T09:00:00.000Z",
        },
      ],
    });
    const wrapper = await mountSelectedOrder(order);

    expect(wrapper.text()).toContain("groupOrders.paymentStatus.selfSettled");
    expect(wrapper.text()).toContain("groupOrders.paymentStatus.paid");
    expect(wrapper.text()).toContain("1/2");
  });

  it("sends the selected member as the full-payment bearer", async () => {
    const wrapper = await mountSelectedOrder();
    vi.clearAllMocks();

    await wrapper
      .get('[data-testid="finalization-bearer-group-1"]')
      .setValue("22222222-2222-4222-8222-222222222222");
    await wrapper
      .get('[data-testid="recover-finalization-group-1"]')
      .trigger("click");
    await flushPromises();

    expect(groupOrdersService.recoverFinalization).toHaveBeenCalledWith(
      "group-1",
      { bearerMemberId: "22222222-2222-4222-8222-222222222222" },
    );
  });

  it("disables the recovery control while the request is in progress", async () => {
    let resolveRecovery: (() => void) | undefined;
    vi.mocked(groupOrdersService.recoverFinalization).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecovery = () =>
            resolve({ masterOrderId: "order-1", status: "checkout" });
        }),
    );
    const wrapper = await mountSelectedOrder();

    await wrapper
      .get('[data-testid="recover-finalization-group-1"]')
      .trigger("click");

    expect(
      wrapper
        .get('[data-testid="recover-finalization-group-1"]')
        .attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.text()).toContain("groupOrders.finalizeFailure.recovering");

    resolveRecovery?.();
    await flushPromises();
  });

  it.each([
    [
      "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS",
      409,
      "groupOrders.finalizeFailure.recoveryInProgress",
    ],
    [
      "GROUP_ORDER_FINALIZATION_RECOVERY_RECLAIMED",
      409,
      "groupOrders.finalizeFailure.recoveryReclaimed",
    ],
    ["BAD_REQUEST", 400, "groupOrders.finalizeFailure.recoveryRetryFailed"],
  ])(
    "shows localized recovery guidance for %s and refreshes retry history",
    async (code, status, expectedKey) => {
      vi.mocked(groupOrdersService.recoverFinalization).mockRejectedValueOnce(
        apiError(code, status),
      );
      const wrapper = await mountSelectedOrder();
      vi.clearAllMocks();
      vi.mocked(groupOrdersService.getGroupOrders).mockResolvedValue([
        failedGroupOrder(),
      ]);
      vi.mocked(groupOrdersService.getGroupOrderStats).mockResolvedValue(stats);

      await wrapper
        .get('[data-testid="recover-finalization-group-1"]')
        .trigger("click");
      await flushPromises();

      const error = wrapper.get('[data-testid="finalization-recovery-error"]');
      expect(error.text()).toContain(expectedKey);
      expect(error.text()).not.toContain("Request failed with status code");
      expect(groupOrdersService.getGroupOrders).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: "restaurant-1" }),
      );
    },
  );

  it("keeps the host recovery code the create response returns", async () => {
    // The response keys the group as `groupOrderId` and carries the two host
    // credentials; the view read `created.id` and dropped both, leaving a
    // staff-created group with no reachable host.
    const created = failedGroupOrder({ id: "group-1", status: "active" });
    vi.mocked(groupOrdersService.getGroupOrders).mockResolvedValue([created]);
    vi.mocked(groupOrdersService.createGroupOrder).mockResolvedValue({
      groupOrderId: "group-1",
      shareCode: "ABC123",
      expiresAt: "2026-06-08T01:00:00.000Z",
      host: created.members[0],
      memberToken: "member-token",
      recoveryCode: "recovery-abc",
    } as Awaited<ReturnType<typeof groupOrdersService.createGroupOrder>>);

    const wrapper = mount(GroupOrdersView);
    await flushPromises();

    await wrapper
      .get('[data-testid="open-create-group-order"]')
      .trigger("click");
    await wrapper.get('[data-testid="create-host-name"]').setValue("Host");
    await wrapper
      .get('[data-testid="submit-create-group-order"]')
      .trigger("click");
    await flushPromises();

    const field = wrapper.get('[data-testid="host-recovery-code"]');
    expect((field.element as HTMLInputElement).value).toBe("recovery-abc");
  });
});
