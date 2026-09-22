// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceView from "./ServiceView.vue";
import { api } from "@/services/api";

const authState = vi.hoisted(() => ({
  restaurantId: "restaurant-1",
  user: { id: 3, username: "service-crew" },
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({
    // Mirrors Intl: an unparseable date formats as "Invalid Date".
    formatTime: (value: Date) =>
      Number.isNaN(new Date(value).getTime()) ? "Invalid Date" : "12:00",
    formatTimeWithSeconds: () => "12:00:00",
  }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => authState,
}));

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  unwrapApiData: (response: { data: { data: unknown } }) => response.data.data,
}));

const readyOrder = {
  id: "order-1",
  orderNumber: "ORD-1",
  orderType: "table",
  status: "ready",
  table: { number: "A1" },
  readyAt: Date.parse("2026-08-21T12:00:00.000Z"),
  updatedAt: Date.parse("2026-08-21T12:00:00.000Z"),
  customerInfo: { name: "Ada", phone: "0912345678" },
  items: [],
};
let deliveryClaimed = false;

describe("ServiceView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    authState.restaurantId = "restaurant-1";
    authState.user = { id: 3, username: "service-crew" };
    deliveryClaimed = false;
    // api.get takes `paramsOrConfig?: unknown`; optional-chaining it narrows to
    // `{}`, which has no `status`. Cast to the shape ServiceView actually sends.
    vi.mocked(api.get).mockImplementation(
      async (_url: string, paramsOrConfig?: unknown) => {
        const options = paramsOrConfig as
          | { status?: string; restaurantId?: string }
          | undefined;
        const orders =
          options?.status === "ready" && options.restaurantId === "restaurant-1"
            ? [
                {
                  ...readyOrder,
                  ...(deliveryClaimed
                    ? {
                        deliveryAssignedTo: "3",
                        deliveryStartTime: Date.parse(
                          "2026-08-21T12:01:00.000Z",
                        ),
                      }
                    : {}),
                },
              ]
            : [];
        return { data: { data: orders } } as never;
      },
    );
    vi.mocked(api.put).mockResolvedValue({ data: { data: {} } } as never);
    vi.mocked(api.post).mockImplementation(async () => {
      deliveryClaimed = true;
      return {
        data: {
          data: {
            ...readyOrder,
            deliveryAssignedTo: "3",
            deliveryStartTime: Date.parse("2026-08-21T12:01:00.000Z"),
          },
        },
      } as never;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  async function startDeliveryOn(wrapper: VueWrapper) {
    const startButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "serviceView.startDelivery");
    expect(startButton).toBeDefined();
    await startButton!.trigger("click");
    expect(wrapper.text()).toContain("serviceView.confirmDelivery");
  }

  async function clickRefresh(wrapper: VueWrapper) {
    const refreshButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "serviceView.refresh");
    expect(refreshButton).toBeDefined();
    await refreshButton!.trigger("click");
    await flushPromises();
  }

  it("uses only server-supported statuses for service delivery", async () => {
    const wrapper = mount(ServiceView);
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith("/orders", {
      status: "ready",
      restaurantId: "restaurant-1",
    });

    const startButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "serviceView.startDelivery");
    expect(startButton).toBeDefined();
    await startButton!.trigger("click");

    expect(api.post).toHaveBeenCalledWith("/orders/order-1/delivery-claim");
    expect(wrapper.text()).toContain("serviceView.confirmDelivery");

    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "serviceView.confirmDelivery");
    expect(confirmButton).toBeDefined();
    await confirmButton!.trigger("click");

    expect(api.put).toHaveBeenCalledWith("/orders/order-1/status", {
      status: "delivered",
      notes: "Delivered by service crew",
    });

    wrapper.unmount();
  });

  // The list is rebuilt from the server on every refresh. Delivery phase lives
  // only on this device, so it has to be re-applied or the crew's in-progress
  // order silently reverts to「開始配送」and loses its start time.
  it("keeps the delivering phase across a refresh", async () => {
    const wrapper = mount(ServiceView);
    await flushPromises();

    await startDeliveryOn(wrapper);
    await clickRefresh(wrapper);

    expect(wrapper.text()).toContain("serviceView.confirmDelivery");
    expect(wrapper.text()).not.toContain("serviceView.startDelivery");
    expect(api.put).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("waits for the server claim when a paginated response omits the order", async () => {
    const wrapper = mount(ServiceView);
    await flushPromises();
    await startDeliveryOn(wrapper);

    vi.mocked(api.get).mockImplementation(
      async (_url: string, paramsOrConfig?: unknown) => {
        const options = paramsOrConfig as { status?: string } | undefined;
        if (options?.status === "ready") {
          return {
            data: {
              data: [],
              pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
            },
          } as never;
        }
        return { data: { data: [] } } as never;
      },
    );
    await clickRefresh(wrapper);

    expect(wrapper.text()).not.toContain("serviceView.confirmDelivery");

    vi.mocked(api.get).mockImplementation(
      async (_url: string, paramsOrConfig?: unknown) => {
        const options = paramsOrConfig as { status?: string } | undefined;
        return {
          data: {
            data:
              options?.status === "ready"
                ? [
                    {
                      ...readyOrder,
                      deliveryAssignedTo: "3",
                      deliveryStartTime: Date.parse("2026-08-21T12:01:00.000Z"),
                    },
                  ]
                : [],
          },
        } as never;
      },
    );
    await clickRefresh(wrapper);

    expect(wrapper.text()).toContain("serviceView.confirmDelivery");
    expect(wrapper.text()).not.toContain("serviceView.startDelivery");
    wrapper.unmount();
  });

  it("restores the delivering phase after a reload", async () => {
    const first = mount(ServiceView);
    await flushPromises();
    await startDeliveryOn(first);
    first.unmount();

    const reloaded = mount(ServiceView);
    await flushPromises();

    expect(reloaded.text()).toContain("serviceView.confirmDelivery");
    expect(reloaded.text()).not.toContain("serviceView.startDelivery");

    reloaded.unmount();
  });

  it("drops the server claim once the server records the delivery", async () => {
    const wrapper = mount(ServiceView);
    await flushPromises();

    await startDeliveryOn(wrapper);
    vi.mocked(api.put).mockImplementation(async () => {
      deliveryClaimed = false;
      return { data: { data: {} } } as never;
    });
    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "serviceView.confirmDelivery");
    await confirmButton!.trigger("click");
    await flushPromises();

    // A later refresh must show the state returned by the server.
    await clickRefresh(wrapper);
    expect(wrapper.text()).toContain("serviceView.startDelivery");
    expect(wrapper.text()).not.toContain("serviceView.confirmDelivery");

    wrapper.unmount();
  });

  it("does not restore a delivery phase saved by a different crew member", async () => {
    const first = mount(ServiceView);
    await flushPromises();
    await startDeliveryOn(first);
    first.unmount();

    authState.user = { id: 4, username: "other-service-crew" };
    const otherCrew = mount(ServiceView);
    await flushPromises();

    expect(otherCrew.text()).not.toContain("serviceView.startDelivery");
    expect(otherCrew.text()).not.toContain("serviceView.confirmDelivery");

    otherCrew.unmount();
  });

  it("does not restore a delivery phase saved for a different restaurant", async () => {
    const first = mount(ServiceView);
    await flushPromises();
    await startDeliveryOn(first);
    first.unmount();

    authState.restaurantId = "restaurant-2";
    const otherRestaurant = mount(ServiceView);
    await flushPromises();

    expect(otherRestaurant.text()).not.toContain("serviceView.startDelivery");
    expect(otherRestaurant.text()).not.toContain("serviceView.confirmDelivery");

    otherRestaurant.unmount();
  });

  describe("found on production, 2026-09-22", () => {
    it("picks up newly ready orders without the crew pressing refresh", async () => {
      // Nothing on the service station listened for updates: an order the
      // kitchen finished stayed invisible until someone tapped Refresh.
      vi.useFakeTimers();
      const wrapper = mount(ServiceView);
      await flushPromises();
      const readyCalls = () =>
        vi
          .mocked(api.get)
          .mock.calls.filter(
            ([, options]) =>
              (options as { status?: string })?.status === "ready",
          ).length;
      const before = readyCalls();

      await vi.advanceTimersByTimeAsync(15_000);
      expect(readyCalls()).toBe(before + 1);

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(readyCalls()).toBe(before + 1);
    });

    it("shows the delivery time on today's timeline, not Invalid Date", async () => {
      vi.mocked(api.get).mockImplementation(
        async (_url: string, paramsOrConfig?: unknown) => {
          const options = paramsOrConfig as { status?: string } | undefined;
          const orders =
            options?.status === "delivered"
              ? [
                  {
                    ...readyOrder,
                    id: "order-9",
                    orderNumber: "ORD-9",
                    status: "delivered",
                    deliveredAt: Date.parse("2026-08-21T12:05:00.000Z"),
                  },
                ]
              : [];
          return { data: { data: orders } } as never;
        },
      );
      const wrapper = mount(ServiceView);
      await flushPromises();

      expect(wrapper.text()).toContain("ORD-9");
      expect(wrapper.text()).not.toContain("Invalid Date");
      wrapper.unmount();
    });

    it("does not show an on-time rate or rating that nothing measures", async () => {
      // Both were constants (92% and 4.8/5), shown as if they were today's.
      const wrapper = mount(ServiceView);
      await flushPromises();

      expect(wrapper.text()).not.toContain("serviceView.onTimeRate");
      expect(wrapper.text()).not.toContain("serviceView.customerRating");
      wrapper.unmount();
    });
  });
});
