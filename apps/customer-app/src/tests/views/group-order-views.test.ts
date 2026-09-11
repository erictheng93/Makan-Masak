import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, RouterLinkStub, flushPromises } from "@vue/test-utils";

const push = vi.hoisted(() => vi.fn());
const groupApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

const groupOrderMock = vi.hoisted(() => ({
  groupOrder: { value: null as Record<string, unknown> | null },
  isLoading: { value: false },
  error: { value: null as string | null },
  isConnected: { value: false },
  recoveryCode: { value: null as string | null },
  isHost: { value: true },
  myItems: { value: [] as unknown[] },
  totalAmount: { value: 0 },
  myShare: { value: 0 },
  onlineMembers: { value: [] as unknown[] },
  loadGroupOrder: vi.fn(),
  joinGroupOrder: vi.fn(),
  connectToGroupOrder: vi.fn(),
  disconnectRealtime: vi.fn(),
  updateCartItem: vi.fn(),
  removeFromCart: vi.fn(),
  submitOrder: vi.fn(),
  setSplitBillMode: vi.fn(),
  setAutoSubmitOnExpiry: vi.fn(),
  autoSubmitOnExpiry: { value: false },
  setFeeMode: vi.fn(),
  setChargeRates: vi.fn(),
  mySubtotal: { value: 10 },
  myServiceCharge: { value: 1 },
  myTax: { value: 0.5 },
  splitBills: { value: [] as unknown[] },
  mySplitBill: { value: undefined as unknown },
  isSettling: { value: false },
  settledCount: { value: 0 },
  settleMyShare: vi.fn(),
  sessionExpired: { value: false },
  currentMemberId: { value: "m-1" },
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();

  return {
    ...actual,
    useRouter: () => ({ push }),
    useRoute: () => ({ params: {} }),
  };
});

vi.mock("@/services/api", () => ({ apiClient: groupApi }));

vi.mock("@/composables/useGroupOrder", () => ({
  useGroupOrder: () => groupOrderMock,
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${JSON.stringify(params)}`,
    currentLanguage: { value: "zh-TW" },
  }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `$${value}`,
    formatPrice: (value: number) => `$${value}`,
  }),
}));

vi.mock("vue-i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-i18n")>();

  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  };
});

import GroupOrderJoinView from "@/views/GroupOrderJoinView.vue";
import GroupOrderView from "@/views/GroupOrderView.vue";
import GroupCartPanel from "@/components/group/GroupCartPanel.vue";

const mountOptions = {
  global: { stubs: { RouterLink: RouterLinkStub } },
};

function previewPayload(overrides: Record<string, unknown> = {}) {
  return {
    groupOrderId: "go-1",
    restaurantId: "rest-1",
    hostName: "Alex",
    memberCount: 2,
    fulfillmentType: "dine_in",
    expiresAt: new Date("2026-06-07T00:45:00.000Z").toISOString(),
    status: "active",
    ...overrides,
  };
}

function loadedGroupOrder(status = "active") {
  return {
    id: "go-1",
    restaurantId: "rest-1",
    shareCode: "ABC12345",
    hostId: "m-1",
    hostName: "Alex",
    status,
    members: [{ id: "m-1", name: "Alex", isHost: true, isOnline: true }],
    cartItems: [],
    splitBillConfig: { mode: "by_item" },
    feeMode: "proportional",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("GroupOrderJoinView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groupOrderMock.groupOrder.value = null;
  });

  it("shows the preview without joining", async () => {
    groupApi.get.mockResolvedValueOnce(previewPayload());

    const wrapper = mount(GroupOrderJoinView, {
      ...mountOptions,
      props: { shareCode: "ABC12345" },
    });
    await flushPromises();

    expect(groupApi.get).toHaveBeenCalledWith("/orders/group/join/ABC12345");
    expect(wrapper.text()).toContain("Alex");
    expect(wrapper.text()).toContain("2");
    // Landing on a shared link must not enrol the visitor. Design decision 4:
    // they see who is ordering and decide, and a link opened by accident costs
    // nothing.
    expect(groupOrderMock.joinGroupOrder).not.toHaveBeenCalled();
  });

  it("requires an explicit action and a name before joining", async () => {
    groupApi.get.mockResolvedValueOnce(previewPayload());

    const wrapper = mount(GroupOrderJoinView, {
      ...mountOptions,
      props: { shareCode: "ABC12345" },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="join-name-input"]').exists()).toBe(
      false,
    );

    await wrapper.find('[data-testid="join-confirm-button"]').trigger("click");
    expect(wrapper.find('[data-testid="join-name-input"]').exists()).toBe(true);
    expect(groupOrderMock.joinGroupOrder).not.toHaveBeenCalled();
  });

  it("navigates to the loaded group order id after joining, never undefined", async () => {
    groupApi.get.mockResolvedValueOnce(previewPayload());
    groupOrderMock.joinGroupOrder.mockImplementationOnce(async () => {
      groupOrderMock.groupOrder.value = loadedGroupOrder();
      return true;
    });

    const wrapper = mount(GroupOrderJoinView, {
      ...mountOptions,
      props: { shareCode: "ABC12345" },
    });
    await flushPromises();

    await wrapper.find('[data-testid="join-confirm-button"]').trigger("click");
    await wrapper.find('[data-testid="join-name-input"]').setValue("Sam");
    await wrapper.find('[data-testid="join-submit-button"]').trigger("click");
    await flushPromises();

    expect(groupOrderMock.joinGroupOrder).toHaveBeenCalledWith(
      "ABC12345",
      "Sam",
    );
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "GroupOrder",
        params: { groupOrderId: "go-1" },
      }),
    );
  });

  it("renders a not-found state for an unknown or expired share code", async () => {
    // What apiClient throws: an ApiException carrying the status. The bare
    // Error("404") this used to pass modelled the old string match, not the
    // client.
    groupApi.get.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { status: 404, code: "NOT_FOUND" }),
    );

    const wrapper = mount(GroupOrderJoinView, {
      ...mountOptions,
      props: { shareCode: "NOPE0000" },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="join-not-found"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="join-confirm-button"]').exists()).toBe(
      false,
    );
  });

  it("does not collapse transient preview failures into not found", async () => {
    groupApi.get.mockRejectedValueOnce(
      Object.assign(new Error("Server unavailable"), { status: 500 }),
    );

    const wrapper = mount(GroupOrderJoinView, {
      ...mountOptions,
      props: { shareCode: "ABC12345" },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="join-not-found"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="join-preview-error"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="join-retry-button"]').exists()).toBe(
      true,
    );
  });
});

describe("GroupOrderView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groupOrderMock.groupOrder.value = loadedGroupOrder();
  });

  it("loads the group order and opens realtime on mount", async () => {
    mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    expect(groupOrderMock.loadGroupOrder).toHaveBeenCalledWith("go-1");
    expect(groupOrderMock.connectToGroupOrder).toHaveBeenCalledWith("go-1");
  });

  it("closes realtime on unmount", async () => {
    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    wrapper.unmount();

    // A socket left open after the view is gone keeps receiving another
    // table's traffic and holds a Durable Object session for nobody.
    expect(groupOrderMock.disconnectRealtime).toHaveBeenCalled();
  });

  /**
   * Auto-submit decides whether an unattended table still gets billed, so the
   * control belongs to the host alone. A member seeing it would either be
   * confused by a switch that 403s, or — worse if the guard ever slipped —
   * able to commit the table to an order nobody confirmed.
   */
  it("shows the auto-submit toggle to the host", async () => {
    groupOrderMock.isHost.value = true;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="auto-submit-toggle"]').exists()).toBe(
      true,
    );
  });

  it("hides the auto-submit toggle from a member who is not the host", async () => {
    groupOrderMock.isHost.value = false;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="auto-submit-toggle"]').exists()).toBe(
      false,
    );

    groupOrderMock.isHost.value = true;
  });

  it("asks the composable to flip the setting when the host toggles it", async () => {
    groupOrderMock.isHost.value = true;
    groupOrderMock.autoSubmitOnExpiry.value = false;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    await wrapper.find('[data-testid="auto-submit-toggle"]').trigger("click");
    await flushPromises();

    expect(groupOrderMock.setAutoSubmitOnExpiry).toHaveBeenCalledWith(true);
  });

  it("renders the cart panel while the group is still active", async () => {
    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    expect(wrapper.findComponent(GroupCartPanel).exists()).toBe(true);
    expect(wrapper.find('[data-testid="group-order-locked"]').exists()).toBe(
      false,
    );
  });

  /**
   * Only the methods finalize can carry out on its own are offered. `custom`
   * and `single_payer` need per-member amounts that a group order has nowhere
   * to store, so offering them would let the host pick a preference that makes
   * the order fail to finalize much later.
   */
  it("offers only the split methods finalize can honour", async () => {
    groupOrderMock.isHost.value = true;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    const panel = wrapper.findComponent(GroupCartPanel);
    const labels = panel
      .findAll('[data-testid^="split-mode-"]')
      .map((button) => button.attributes("data-testid"));

    expect(labels).toEqual([
      "split-mode-equal",
      "split-mode-by_item",
      "split-mode-proportional",
    ]);
  });

  it("asks the composable to change the split mode when the host picks one", async () => {
    groupOrderMock.isHost.value = true;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    await wrapper.find('[data-testid="split-mode-equal"]').trigger("click");
    await flushPromises();

    expect(groupOrderMock.setSplitBillMode).toHaveBeenCalledWith("equal");
  });

  /**
   * A diner deciding whether to add another dish needs the number they will
   * actually be asked for, and the service charge is the part they are most
   * likely to feel cheated by if it only appears at the end. Showing the lines
   * separately is what makes the total arguable rather than surprising.
   */
  it("breaks my share down instead of showing one number", async () => {
    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    const panel = wrapper.findComponent(GroupCartPanel);
    expect(panel.find('[data-testid="my-subtotal"]').exists()).toBe(true);
    expect(panel.find('[data-testid="my-service-charge"]').exists()).toBe(true);
    expect(panel.find('[data-testid="my-tax"]').exists()).toBe(true);
    expect(panel.find('[data-testid="my-share"]').exists()).toBe(true);
  });

  it("hides the fee lines the restaurant does not charge", async () => {
    groupOrderMock.myServiceCharge.value = 0;
    groupOrderMock.myTax.value = 0;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    const panel = wrapper.findComponent(GroupCartPanel);
    // A restaurant that charges neither should not show two zero rows.
    expect(panel.find('[data-testid="my-service-charge"]').exists()).toBe(
      false,
    );
    expect(panel.find('[data-testid="my-tax"]').exists()).toBe(false);
    expect(panel.find('[data-testid="my-share"]').exists()).toBe(true);

    groupOrderMock.myServiceCharge.value = 1;
    groupOrderMock.myTax.value = 0.5;
  });

  it("shows the host who-pays-the-fee selector", async () => {
    groupOrderMock.isHost.value = true;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    const modes = wrapper
      .findAll('[data-testid^="fee-mode-"]')
      .map((button) => button.attributes("data-testid"));

    expect(modes).toEqual([
      "fee-mode-proportional",
      "fee-mode-equal",
      "fee-mode-host",
    ]);
  });

  it("hides the who-pays-the-fee selector from a member", async () => {
    groupOrderMock.isHost.value = false;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="fee-mode-host"]').exists()).toBe(false);

    groupOrderMock.isHost.value = true;
  });

  it("asks the composable to change who carries the fee", async () => {
    groupOrderMock.isHost.value = true;

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    await wrapper.find('[data-testid="fee-mode-host"]').trigger("click");
    await flushPromises();

    expect(groupOrderMock.setFeeMode).toHaveBeenCalledWith("host");
  });

  it.each(["finalizing", "finalizing_failed", "checkout"])(
    "locks editing once the group order reaches %s",
    async (status) => {
      groupOrderMock.groupOrder.value = loadedGroupOrder(status);

      const wrapper = mount(GroupOrderView, {
        ...mountOptions,
        props: { groupOrderId: "go-1" },
      });
      await flushPromises();

      // The order is being turned into a real one, or already has been.
      // Showing an editable cart invites changes that will never reach it.
      expect(wrapper.find('[data-testid="group-order-locked"]').exists()).toBe(
        true,
      );
      expect(wrapper.findComponent(GroupCartPanel).exists()).toBe(false);
    },
  );

  // `completed` means the order reached the restaurant, which is exactly when
  // the table settles up. Hiding the panel there would hide settlement itself.
  it("keeps the panel visible once the order has been sent, for settling", async () => {
    groupOrderMock.groupOrder.value = loadedGroupOrder("completed");

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="group-order-locked"]').exists()).toBe(
      false,
    );
    const panel = wrapper.findComponent(GroupCartPanel);
    expect(panel.exists()).toBe(true);
    // The cart is read-only by then: the order it belongs to is already placed.
    expect(panel.props("orderStatus")).toBe("completed");
  });

  it("locks editing for any future non-active status", async () => {
    groupOrderMock.groupOrder.value = loadedGroupOrder("paused_for_review");

    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="group-order-locked"]').exists()).toBe(
      true,
    );
    expect(wrapper.findComponent(GroupCartPanel).exists()).toBe(false);
  });
});

describe("GroupOrderView — submitting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groupOrderMock.groupOrder.value = loadedGroupOrder();
    groupOrderMock.isHost.value = true;
  });

  async function mountView() {
    const wrapper = mount(GroupOrderView, {
      ...mountOptions,
      props: { groupOrderId: "go-1" },
    });
    await flushPromises();
    return wrapper;
  }

  it("offers the host a way to submit while the group is active", async () => {
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="group-order-submit"]').exists()).toBe(
      true,
    );
  });

  it("does not offer submitting to anyone but the host", async () => {
    groupOrderMock.isHost.value = false;

    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="group-order-submit"]').exists()).toBe(
      false,
    );
  });

  it("withdraws the control once the group order is no longer active", async () => {
    groupOrderMock.groupOrder.value = loadedGroupOrder("finalizing");

    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="group-order-submit"]').exists()).toBe(
      false,
    );
  });

  it("submits through the composable", async () => {
    groupOrderMock.submitOrder.mockResolvedValueOnce(undefined);

    const wrapper = await mountView();
    await wrapper.find('[data-testid="group-order-submit"]').trigger("click");
    await flushPromises();

    expect(groupOrderMock.submitOrder).toHaveBeenCalledOnce();
  });

  it("cannot be fired twice while the first submit is in flight", async () => {
    let release: () => void = () => {};
    groupOrderMock.submitOrder.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );

    const wrapper = await mountView();
    const button = wrapper.find('[data-testid="group-order-submit"]');
    await button.trigger("click");

    // A double tap must not produce two real orders. The composable's
    // clientMutationId would catch it server-side, but the host should never
    // get that far.
    expect(button.attributes("disabled")).toBeDefined();
    await button.trigger("click");
    expect(groupOrderMock.submitOrder).toHaveBeenCalledOnce();

    release();
    await flushPromises();
  });

  it("names the host when someone else tries to submit", async () => {
    groupOrderMock.submitOrder.mockRejectedValueOnce(
      Object.assign(new Error("Only the group host can lock this order"), {
        isHostOnly: true,
      }),
    );

    const wrapper = await mountView();
    await wrapper.find('[data-testid="group-order-submit"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.find('[data-testid="group-order-submit-error"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="group-order-placed-warning"]').exists(),
    ).toBe(false);
  });

  it("names the rule the host tripped instead of saying submitting failed", async () => {
    // Finalizing runs the group cart through the same createOrder as checkout,
    // so its refusals arrive with codes the order-submit registry already has
    // copy for — the host is the only person who can act on them (#359).
    groupOrderMock.submitOrder.mockRejectedValueOnce(
      Object.assign(new Error("Insufficient inventory for 滷肉飯"), {
        code: "INSUFFICIENT_INVENTORY",
        status: 409,
      }),
    );

    const wrapper = await mountView();
    await wrapper.find('[data-testid="group-order-submit"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.find('[data-testid="group-order-submit-error"]').text(),
    ).toContain("toast.orderSubmitInsufficientInventory");
  });

  it("falls back to the group's own copy for a failure carrying no known code", async () => {
    groupOrderMock.submitOrder.mockRejectedValueOnce(new Error("boom"));

    const wrapper = await mountView();
    await wrapper.find('[data-testid="group-order-submit"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.find('[data-testid="group-order-submit-error"]').text(),
    ).toContain("group.submitFailed");
  });

  it("tells the host the order reached the restaurant even though submitting failed", async () => {
    groupOrderMock.submitOrder.mockRejectedValueOnce(
      Object.assign(new Error("Split total does not match order total"), {
        orderAlreadyPlaced: true,
      }),
    );

    const wrapper = await mountView();
    await wrapper.find('[data-testid="group-order-submit"]').trigger("click");
    await flushPromises();

    // finalize creates the real order before splitting the bill. Reporting this
    // as a plain failure sends the host to re-submit, or away from a table
    // whose food is already being cooked.
    const warning = wrapper.find('[data-testid="group-order-placed-warning"]');
    expect(warning.exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="group-order-submit-error"]').exists(),
    ).toBe(false);
  });
});

describe("group ordering routes", () => {
  it("registers the join route on the same shape getShareLink builds", async () => {
    const { default: router } = await import("@/router");
    const join = router
      .getRoutes()
      .find((route) => route.name === "GroupOrderJoin");

    // getShareLink() emits /group/:shareCode. If the route disagrees, every
    // link a host shares resolves to nothing.
    expect(join?.path).toBe("/group/:shareCode");
  });

  it("registers the group order route keyed by group order id", async () => {
    const { default: router } = await import("@/router");
    const view = router
      .getRoutes()
      .find((route) => route.name === "GroupOrder");

    expect(view?.path).toBe("/group/order/:groupOrderId");
  });

  it("resolves a shared link to the join view", async () => {
    const { default: router } = await import("@/router");
    const resolved = router.resolve("/group/ABC12345");

    expect(resolved.name).toBe("GroupOrderJoin");
    expect(resolved.params).toMatchObject({ shareCode: "ABC12345" });
  });
});
