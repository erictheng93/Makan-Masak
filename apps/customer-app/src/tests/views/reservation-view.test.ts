import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationView from "@/views/ReservationView.vue";
import { menuApi } from "@/services/menuApi";
import { reservationsApi } from "@/services/reservationsApi";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${params.count}`,
  }),
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: { getRestaurant: vi.fn() },
}));

vi.mock("@/services/reservationsApi", () => ({
  reservationsApi: {
    getAvailability: vi.fn(),
    create: vi.fn(),
    verify: vi.fn(),
    cancel: vi.fn(),
  },
}));

const reservation = {
  id: "reservation-1",
  restaurantId: "restaurant-1",
  customerName: "Ada",
  customerPhone: "0912345678",
  partySize: 2,
  reservationDate: "2026-09-23",
  reservationTime: "18:00",
  durationMinutes: 90,
  status: "confirmed",
  confirmationCode: "CONFIRM-1",
  createdAt: 1,
  updatedAt: 1,
};

function mountView() {
  return mount(ReservationView, {
    props: { restaurantId: "restaurant-1" },
  });
}

describe("ReservationView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(menuApi.getRestaurant).mockResolvedValue({
      id: "restaurant-1",
      name: "Demo Noodles",
      status: 1,
      planType: 0,
    } as never);
    vi.mocked(reservationsApi.getAvailability).mockResolvedValue({
      date: "2026-09-23",
      partySize: 2,
      slots: [
        {
          time: "18:00",
          available: true,
          remainingCapacity: 8,
          remainingTables: 2,
          occupancyRate: 0.2,
        },
        {
          time: "18:30",
          available: false,
          remainingCapacity: 0,
          remainingTables: 0,
          occupancyRate: 1,
        },
      ],
    });
    vi.mocked(reservationsApi.create).mockResolvedValue(reservation as never);
    vi.mocked(reservationsApi.verify).mockResolvedValue(reservation as never);
    vi.mocked(reservationsApi.cancel).mockResolvedValue({
      ...reservation,
      status: "cancelled",
    } as never);
  });

  it("loads a public restaurant and lets a diner select an available slot", async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(menuApi.getRestaurant).toHaveBeenCalledWith("restaurant-1");
    expect(reservationsApi.getAvailability).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      date: expect.any(String),
      partySize: 1,
    });
    expect(wrapper.text()).toContain("Demo Noodles");
    expect(wrapper.findAll('[data-testid="reservation-slot"]')).toHaveLength(2);
    expect(
      wrapper.get('[data-testid="reservation-slot"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("creates a reservation with a stable idempotency key and shows its confirmation", async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('[data-testid="reservation-name"]').setValue("Ada");
    await wrapper
      .get('[data-testid="reservation-phone"]')
      .setValue("0912345678");
    await wrapper.get('[data-testid="reservation-create"]').trigger("submit");
    await flushPromises();

    expect(reservationsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        customerName: "Ada",
        customerPhone: "0912345678",
        reservationTime: "18:00",
      }),
      expect.any(String),
    );
    expect(
      wrapper.get('[data-testid="reservation-confirmation"]').text(),
    ).toContain("CONFIRM-1");
  });

  it("rotates the create idempotency key after a completed reservation", async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('[data-testid="reservation-name"]').setValue("Ada");
    await wrapper
      .get('[data-testid="reservation-phone"]')
      .setValue("0912345678");
    await wrapper.get('[data-testid="reservation-create"]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-testid="reservation-create"]').trigger("submit");
    await flushPromises();

    const [, firstKey] = vi.mocked(reservationsApi.create).mock.calls[0] as [
      unknown,
      string,
    ];
    const [, secondKey] = vi.mocked(reservationsApi.create).mock.calls[1] as [
      unknown,
      string,
    ];
    expect(secondKey).not.toBe(firstKey);
  });

  it("keeps a failed write retry-safe but rotates the key for changed input", async () => {
    vi.mocked(reservationsApi.create)
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(reservation as never)
      .mockResolvedValueOnce(reservation as never);
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('[data-testid="reservation-name"]').setValue("Ada");
    await wrapper
      .get('[data-testid="reservation-phone"]')
      .setValue("0912345678");
    await wrapper.get('[data-testid="reservation-create"]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-testid="reservation-create"]').trigger("submit");
    await flushPromises();
    await wrapper
      .get('[data-testid="reservation-requests"]')
      .setValue("Window seat");
    await wrapper.get('[data-testid="reservation-create"]').trigger("submit");
    await flushPromises();

    const [, firstKey] = vi.mocked(reservationsApi.create).mock.calls[0] as [
      unknown,
      string,
    ];
    const [, retryKey] = vi.mocked(reservationsApi.create).mock.calls[1] as [
      unknown,
      string,
    ];
    const [, changedInputKey] = vi.mocked(reservationsApi.create).mock
      .calls[2] as [unknown, string];
    expect(retryKey).toBe(firstKey);
    expect(changedInputKey).not.toBe(retryKey);
  });

  it("looks up and cancels a reservation using the confirmation code", async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="reservation-verify-code"]')
      .setValue("CONFIRM-1");
    await wrapper.get('[data-testid="reservation-verify"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="reservation-cancel"]').trigger("click");
    await flushPromises();

    expect(reservationsApi.verify).toHaveBeenCalledWith("CONFIRM-1");
    expect(reservationsApi.cancel).toHaveBeenCalledWith(
      {
        reservationId: "reservation-1",
        confirmationCode: "CONFIRM-1",
      },
      expect.any(String),
    );
    expect(wrapper.text()).toContain("serviceBooking.cancelSuccess");
  });
});
