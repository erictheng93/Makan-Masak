// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceBookingsView from "./ServiceBookingsView.vue";
import { serviceBookingsService } from "@/services/serviceBookingsService";

const i18nMock = vi.hoisted(() => {
  const locale = { value: "zh-TW" };
  const messages: Record<string, Record<string, string>> = {
    "zh-TW": {
      "serviceBookings.title": "服務預約管理",
      "serviceBookings.status.pending": "待處理",
    },
    "en-US": {
      "serviceBookings.title": "Service Bookings",
      "serviceBookings.status.pending": "Pending",
    },
  };

  return {
    locale,
    t: vi.fn((key: string) => messages[locale.value]?.[key] ?? key),
  };
});

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
  }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: i18nMock.locale,
    t: i18nMock.t,
  }),
}));

vi.mock("@/services/serviceBookingsService", () => ({
  serviceBookingsService: {
    listBookings: vi.fn(),
    confirmCash: vi.fn(),
    complete: vi.fn(),
    markNoShow: vi.fn(),
    cancel: vi.fn(),
  },
}));

const pendingBooking = {
  id: "booking-1",
  restaurantId: "restaurant-1",
  serviceItemId: 10,
  serviceNameSnapshot: "彩繪體驗",
  customerName: "王小明",
  customerPhone: "0911222333",
  customerEmail: "guest@example.test",
  bookingDate: "2026-06-10",
  bookingTime: "10:00",
  partySize: 2,
  status: "pending" as const,
  confirmationCode: "ABC123",
  paymentRequirement: "none" as const,
  depositRequiredCents: 0,
  balanceDueCents: 12000,
  amountDueCents: 12000,
  amountPaidCents: 0,
  paymentStatus: "unpaid" as const,
  paymentMethod: "none" as const,
  reminderOptIn: 0,
  calendarUid: "booking-1@makanmasak.com",
  specialRequests: "靠窗",
};

const confirmedBooking = {
  ...pendingBooking,
  id: "booking-2",
  status: "confirmed" as const,
  confirmationCode: "DEF456",
  balanceDueCents: 0,
  amountPaidCents: 12000,
  paymentStatus: "paid" as const,
  paymentMethod: "credits" as const,
  calendarUid: "booking-2@makanmasak.com",
};

describe("ServiceBookingsView", () => {
  function configureServiceMocks() {
    vi.clearAllMocks();
    i18nMock.locale.value = "zh-TW";
    vi.mocked(serviceBookingsService.listBookings).mockResolvedValue([
      pendingBooking,
      confirmedBooking,
    ]);
    vi.mocked(serviceBookingsService.confirmCash).mockResolvedValue({
      ...pendingBooking,
      status: "confirmed",
    });
    vi.mocked(serviceBookingsService.complete).mockResolvedValue({
      ...confirmedBooking,
      status: "completed",
    });
    vi.mocked(serviceBookingsService.markNoShow).mockResolvedValue({
      ...confirmedBooking,
      status: "no_show",
    });
    vi.mocked(serviceBookingsService.cancel).mockResolvedValue({
      ...pendingBooking,
      status: "cancelled",
    });
  }

  beforeEach(configureServiceMocks);

  // The first mount of this view in a worker is a one-off that used to land in
  // whichever timed body reached it first -- here the very first `it`, which is
  // why that one body was the file's slowest under `turbo run test` (#360,
  // continuing #351). Instrumented alone on a loaded 4-core box, "lists
  // bookings scoped to the current restaurant" spent mount 99ms, flush 131ms,
  // assertions 55ms of its 294ms, against a later body that mounts and flushes
  // the same way for 150ms.
  //
  // Vue render warm-up plus jsdom's first DOM build for this tree is re-usable
  // state, not per-test work, so pay it once here under the hook's own budget.
  // The mock setup is factored out of `beforeEach` so the warm-up can reuse it
  // rather than re-deriving the resolved values.
  beforeAll(async () => {
    configureServiceMocks();
    const warmup = mount(ServiceBookingsView);
    await flushPromises();
    warmup.unmount();
  }, 30_000);

  it("lists bookings scoped to the current restaurant", async () => {
    const wrapper = mount(ServiceBookingsView);
    await flushPromises();

    expect(serviceBookingsService.listBookings).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      date: expect.any(String),
      status: undefined,
    });
    expect(wrapper.text()).toContain("彩繪體驗");
    expect(wrapper.text()).toContain("王小明");
    expect(wrapper.text()).toContain("ABC123");
    expect(wrapper.findAll('[data-testid="service-booking-row"]')).toHaveLength(
      2,
    );
  });

  it("renders labels through i18n when locale changes", async () => {
    const wrapper = mount(ServiceBookingsView);
    await flushPromises();

    expect(wrapper.text()).toContain("服務預約管理");
    expect(wrapper.text()).toContain("待處理");

    i18nMock.locale.value = "en-US";
    await wrapper.vm.$forceUpdate();

    expect(wrapper.text()).toContain("Service Bookings");
    expect(wrapper.text()).toContain("Pending");
  });

  it("filters bookings by status and date", async () => {
    const wrapper = mount(ServiceBookingsView);
    await flushPromises();

    await wrapper
      .get('[data-testid="service-bookings-date"]')
      .setValue("2026-06-10");
    await wrapper
      .get('[data-testid="service-bookings-status"]')
      .setValue("confirmed");
    await flushPromises();

    expect(serviceBookingsService.listBookings).toHaveBeenLastCalledWith({
      restaurantId: "restaurant-1",
      date: "2026-06-10",
      status: "confirmed",
    });
  });

  it("runs booking lifecycle actions", async () => {
    const wrapper = mount(ServiceBookingsView);
    await flushPromises();

    await wrapper
      .get('[data-testid="booking-confirm-cash-booking-1"]')
      .trigger("click");
    await flushPromises();
    expect(serviceBookingsService.confirmCash).toHaveBeenCalledWith(
      "booking-1",
    );

    await wrapper
      .get('[data-testid="booking-complete-booking-2"]')
      .trigger("click");
    await flushPromises();
    expect(serviceBookingsService.complete).toHaveBeenCalledWith("booking-2");

    await wrapper
      .get('[data-testid="booking-no-show-booking-2"]')
      .trigger("click");
    await flushPromises();
    expect(serviceBookingsService.markNoShow).toHaveBeenCalledWith("booking-2");

    await wrapper
      .get('[data-testid="booking-cancel-booking-1"]')
      .trigger("click");
    await flushPromises();
    expect(serviceBookingsService.cancel).toHaveBeenCalledWith("booking-1");
  });
});
