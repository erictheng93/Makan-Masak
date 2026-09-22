import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import ServiceBookingView from "@/views/ServiceBookingView.vue";
import { restaurantContactApi } from "@/services/restaurantContactApi";
import { serviceBookingsApi } from "@/services/serviceBookingsApi";
import { i18n } from "@/i18n";
import { menuApi } from "@/services/menuApi";
import { createPinia, setActivePinia } from "pinia";
import { useAppStore } from "@/stores/app";
import type { Restaurant } from "@makanmasak/shared-types";

const routerPush = vi.hoisted(() => vi.fn());
const storedValueCreditsDisabled = vi.hoisted(() => ({ value: false }));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      key === "serviceBooking.payAtCounter"
        ? `Please pay the staff at the venue (${params.amount} due). Confirmation code: ${params.code}`
        : `${key}:${Object.values(params).join(",")}`,
    currentLanguage: ref("zh-TW"),
    hasTranslation: () => true,
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}));

vi.mock("@/composables/useFeatureAvailability", () => ({
  useFeatureAvailability: () => ({
    isDisabled: (feature: string) =>
      feature === "storedValueCredits" && storedValueCreditsDisabled.value,
  }),
}));

vi.mock("@/services/restaurantContactApi", () => ({
  restaurantContactApi: {
    listServiceItems: vi.fn(),
  },
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: {
    getRestaurant: vi.fn(),
  },
}));

vi.mock("@/services/serviceBookingsApi", () => ({
  serviceBookingsApi: {
    getAvailability: vi.fn(),
    createBooking: vi.fn(),
    payWithCredits: vi.fn(),
    verify: vi.fn(),
    cancelByCode: vi.fn(),
  },
}));

const serviceItem = {
  id: 10,
  restaurantId: "restaurant-1",
  name: "彩繪體驗",
  description: "夜市手作活動",
  serviceType: "activity" as const,
  priceCents: 12000,
  durationMinutes: 60,
  requiresBooking: true,
  sortOrder: 0,
  isActive: true,
  isPublic: true,
  createdAt: 1786_000_000_000,
  updatedAt: 1786_000_000_000,
};

const pendingBooking = {
  id: "booking-1",
  restaurantId: "restaurant-1",
  serviceItemId: 10,
  serviceNameSnapshot: "彩繪體驗",
  priceCentsSnapshot: 12000,
  customerName: "王小明",
  customerPhone: "0911222333",
  bookingDate: "2026-06-10",
  bookingTime: "10:00",
  partySize: 2,
  status: "pending" as const,
  confirmationCode: "ABC123",
  voucherDiscountCents: 0,
  paymentRequirement: "prepay" as const,
  depositRequiredCents: 0,
  balanceDueCents: 0,
  amountDueCents: 12000,
  amountPaidCents: 0,
  paymentStatus: "unpaid" as const,
  paymentMethod: "none" as const,
  reminderOptIn: 0,
  calendarUid: "booking-1@makanmakan.service-bookings",
};

function mountView() {
  return mount(ServiceBookingView, {
    props: {
      restaurantId: "restaurant-1",
      serviceItemId: 10,
    },
    global: {
      plugins: [i18n, pinia],
    },
  });
}

let pinia = createPinia();

describe("ServiceBookingView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.mocked(menuApi.getRestaurant).mockResolvedValue({
      id: "restaurant-1",
      settings: { currency: "TWD" },
    } as unknown as Restaurant);
    routerPush.mockReset();
    storedValueCreditsDisabled.value = false;
    vi.mocked(restaurantContactApi.listServiceItems).mockResolvedValue([
      serviceItem,
    ]);
    vi.mocked(serviceBookingsApi.getAvailability).mockResolvedValue([
      { timeSlot: "10:00", remaining: 2, isAvailable: true },
      { timeSlot: "11:00", remaining: 0, isAvailable: false },
    ]);
    vi.mocked(serviceBookingsApi.createBooking).mockResolvedValue(
      pendingBooking,
    );
    vi.mocked(serviceBookingsApi.payWithCredits).mockResolvedValue({
      ...pendingBooking,
      status: "confirmed",
      paymentStatus: "paid",
      paymentMethod: "credits",
      amountPaidCents: 12000,
    });
    vi.mocked(serviceBookingsApi.verify).mockResolvedValue({
      ...pendingBooking,
      status: "confirmed",
      paymentStatus: "paid",
      paymentMethod: "credits",
    });
    vi.mocked(serviceBookingsApi.cancelByCode).mockResolvedValue({
      ...pendingBooking,
      status: "cancelled",
    });
  });

  it("loads service details and availability slots", async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(restaurantContactApi.listServiceItems).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(serviceBookingsApi.getAvailability).toHaveBeenCalledWith({
      serviceItemId: 10,
      date: expect.any(String),
    });
    expect(wrapper.text()).toContain("彩繪體驗");
    expect(
      wrapper.findAll('[data-testid="service-booking-slot"]'),
    ).toHaveLength(2);
  });

  describe("price currency", () => {
    it("formats the service price in this restaurant's currency when opened cold", async () => {
      vi.mocked(menuApi.getRestaurant).mockResolvedValue({
        id: "restaurant-1",
        settings: { currency: "MYR" },
      } as unknown as Restaurant);

      const wrapper = mountView();
      await flushPromises();

      expect(menuApi.getRestaurant).toHaveBeenCalledWith("restaurant-1");
      expect(wrapper.text()).toContain("RM 120.00");
      expect(wrapper.text()).not.toContain("NT$");
    });

    it("does not borrow the currency of a different restaurant in the store", async () => {
      useAppStore(pinia).currentRestaurant = {
        id: "restaurant-2",
        settings: { currency: "MYR" },
      } as unknown as Restaurant;

      const wrapper = mountView();
      await flushPromises();

      expect(menuApi.getRestaurant).toHaveBeenCalledWith("restaurant-1");
      expect(wrapper.text()).toContain("NT$120");
      expect(wrapper.text()).not.toContain("RM");
    });

    it("reuses the store's restaurant when it is this one", async () => {
      useAppStore(pinia).currentRestaurant = {
        id: "restaurant-1",
        settings: { currency: "VND" },
      } as unknown as Restaurant;

      const wrapper = mountView();
      await flushPromises();

      expect(menuApi.getRestaurant).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("120 ₫");
    });
  });

  describe("default booking date", () => {
    // Pinned here, not in vitest.config.ts: CI runs in UTC, where the local
    // day and the UTC day are the same and the old code passes too.
    const originalTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = "Asia/Taipei";
    });
    afterAll(() => {
      process.env.TZ = originalTz;
      vi.useRealTimers();
    });

    it("is the diner's calendar day, not the UTC one, just after midnight", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      // 01:30 on 18 Sep in Taipei is still 17 Sep in UTC.
      vi.setSystemTime(new Date("2026-09-17T17:30:00.000Z"));

      mountView();
      await flushPromises();
      vi.useRealTimers();

      expect(serviceBookingsApi.getAvailability).toHaveBeenCalledWith({
        serviceItemId: 10,
        date: "2026-09-18",
      });
    });
  });

  it("creates, pays, verifies, and cancels a service booking", async () => {
    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="service-booking-name"]')
      .setValue("王小明");
    await wrapper
      .get('[data-testid="service-booking-phone"]')
      .setValue("0911222333");
    await wrapper
      .get('[data-testid="service-booking-email"]')
      .setValue("guest@example.test");
    await wrapper.get('[data-testid="service-booking-party-size"]').setValue(2);
    await wrapper
      .get('[data-testid="service-booking-create"]')
      .trigger("submit");
    await flushPromises();

    expect(serviceBookingsApi.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        serviceItemId: 10,
        customerName: "王小明",
        customerPhone: "0911222333",
        customerEmail: "guest@example.test",
        bookingTime: "10:00",
        partySize: 2,
      }),
    );
    expect(
      wrapper.get('[data-testid="service-booking-confirmation"]').text(),
    ).toContain("ABC123");

    await wrapper
      .get('[data-testid="service-booking-credit-id"]')
      .setValue("credit-public-1");
    await wrapper
      .get('[data-testid="service-booking-credit-pin"]')
      .setValue("1234");
    await wrapper.get('[data-testid="service-booking-pay"]').trigger("click");
    await flushPromises();

    expect(serviceBookingsApi.payWithCredits).toHaveBeenCalledWith({
      bookingId: "booking-1",
      creditCardPublicId: "credit-public-1",
      pin: "1234",
    });
    expect(wrapper.text()).toContain("serviceBooking.paySuccess");

    await wrapper
      .get('[data-testid="service-booking-verify-code"]')
      .setValue("ABC123");
    await wrapper
      .get('[data-testid="service-booking-verify"]')
      .trigger("click");
    await flushPromises();

    expect(serviceBookingsApi.verify).toHaveBeenCalledWith("ABC123", {
      requireContact: true,
      customerEmail: "guest@example.test",
    });
    expect(
      wrapper.get('[data-testid="service-booking-verified"]').text(),
    ).toContain("serviceBooking.bookingStatus.confirmed");

    await wrapper
      .get('[data-testid="service-booking-cancel"]')
      .trigger("click");
    await flushPromises();

    expect(serviceBookingsApi.cancelByCode).toHaveBeenCalledWith("ABC123", {
      requireContact: true,
      customerEmail: "guest@example.test",
    });
    expect(wrapper.text()).toContain("serviceBooking.cancelSuccess");
  });

  it("does not offer stored-value payment while credits are disabled", async () => {
    storedValueCreditsDisabled.value = true;
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('[data-testid="service-booking-pay"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="service-booking-credit-id"]').exists(),
    ).toBe(false);
  });

  it.each([
    ["prepay", "TWD", "NT$120"],
    ["deposit", "MYR", "RM 120.00"],
    ["pay_at_venue", "TWD", "NT$120"],
  ] as const)(
    "explains how to pay an unpaid %s booking at the counter in %s",
    async (paymentRequirement, currency, amount) => {
      storedValueCreditsDisabled.value = true;
      vi.mocked(menuApi.getRestaurant).mockResolvedValue({
        id: "restaurant-1",
        settings: { currency },
      } as unknown as Restaurant);
      vi.mocked(serviceBookingsApi.createBooking).mockResolvedValue({
        ...pendingBooking,
        paymentRequirement,
      });
      const wrapper = mountView();
      await flushPromises();

      await wrapper
        .get('[data-testid="service-booking-name"]')
        .setValue("王小明");
      await wrapper
        .get('[data-testid="service-booking-phone"]')
        .setValue("0911222333");
      await wrapper
        .get('[data-testid="service-booking-create"]')
        .trigger("submit");
      await flushPromises();

      const confirmation = wrapper.get(
        '[data-testid="service-booking-confirmation"]',
      );
      expect(confirmation.text()).toContain(
        `Please pay the staff at the venue (${amount} due). Confirmation code: ABC123`,
      );
      expect(confirmation.text()).not.toContain(
        "serviceBooking.bookingStatus.pending",
      );
      expect(wrapper.find('[data-testid="service-booking-pay"]').exists()).toBe(
        false,
      );

      vi.mocked(serviceBookingsApi.verify).mockResolvedValue({
        ...pendingBooking,
        paymentRequirement,
      });
      await wrapper
        .get('[data-testid="service-booking-verify-code"]')
        .setValue("ABC123");
      await wrapper
        .get('[data-testid="service-booking-verify"]')
        .trigger("click");
      await flushPromises();

      expect(
        wrapper.get('[data-testid="service-booking-verified"]').text(),
      ).toContain(
        `Please pay the staff at the venue (${amount} due). Confirmation code: ABC123`,
      );
    },
  );

  it("does not show an amount for a booking with no payment requirement", async () => {
    vi.mocked(serviceBookingsApi.createBooking).mockResolvedValue({
      ...pendingBooking,
      paymentRequirement: "none",
      status: "confirmed",
    });
    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="service-booking-name"]')
      .setValue("王小明");
    await wrapper
      .get('[data-testid="service-booking-phone"]')
      .setValue("0911222333");
    await wrapper
      .get('[data-testid="service-booking-create"]')
      .trigger("submit");
    await flushPromises();

    const confirmation = wrapper.get(
      '[data-testid="service-booking-confirmation"]',
    );
    expect(confirmation.text()).not.toContain("serviceBooking.amountDue");
    expect(confirmation.text()).not.toContain("serviceBooking.payAtCounter");
    expect(confirmation.text()).toContain(
      "serviceBooking.bookingStatus.confirmed",
    );
  });

  it("keeps a paid booking on its confirmed status when credits are disabled", async () => {
    storedValueCreditsDisabled.value = true;
    vi.mocked(serviceBookingsApi.createBooking).mockResolvedValue({
      ...pendingBooking,
      status: "confirmed",
      paymentStatus: "paid",
      paymentMethod: "cash",
      amountPaidCents: 12000,
    });
    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="service-booking-name"]')
      .setValue("王小明");
    await wrapper
      .get('[data-testid="service-booking-phone"]')
      .setValue("0911222333");
    await wrapper
      .get('[data-testid="service-booking-create"]')
      .trigger("submit");
    await flushPromises();

    const confirmation = wrapper.get(
      '[data-testid="service-booking-confirmation"]',
    );
    expect(confirmation.text()).toContain(
      "serviceBooking.bookingStatus.confirmed",
    );
    expect(confirmation.text()).not.toContain("serviceBooking.payAtCounter");
  });

  it("does not offer credits for an unpaid pay-at-venue booking", async () => {
    vi.mocked(serviceBookingsApi.createBooking).mockResolvedValue({
      ...pendingBooking,
      paymentRequirement: "pay_at_venue",
    });
    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="service-booking-name"]')
      .setValue("王小明");
    await wrapper
      .get('[data-testid="service-booking-phone"]')
      .setValue("0911222333");
    await wrapper
      .get('[data-testid="service-booking-create"]')
      .trigger("submit");
    await flushPromises();

    expect(wrapper.find('[data-testid="service-booking-pay"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain(
      "Please pay the staff at the venue (NT$120 due). Confirmation code: ABC123",
    );
  });
});
