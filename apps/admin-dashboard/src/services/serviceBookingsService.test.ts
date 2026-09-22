import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "@/services/api";
import {
  serviceBookingsService,
  type ServiceBooking,
} from "./serviceBookingsService";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  unwrapApiPayload: vi.fn((payload) => payload.data ?? payload),
}));

describe("serviceBookingsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists and creates service booking slots", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { data: { slots: [{ id: "slot-1" }] } },
    } as never);
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { data: { slot: { id: "slot-2" } } },
    } as never);

    await expect(
      serviceBookingsService.listSlots({
        restaurantId: "restaurant-1",
        serviceItemId: 10,
        date: "2026-06-10",
      }),
    ).resolves.toEqual([{ id: "slot-1" }]);
    expect(api.get).toHaveBeenCalledWith("/service-bookings/slots", {
      restaurantId: "restaurant-1",
      serviceItemId: 10,
      date: "2026-06-10",
    });

    await expect(
      serviceBookingsService.createSlot({
        restaurantId: "restaurant-1",
        serviceItemId: 10,
        date: "2026-06-10",
        timeSlot: "10:00",
        maxCapacity: 2,
      }),
    ).resolves.toEqual({ id: "slot-2" });
    expect(api.post).toHaveBeenCalledWith("/service-bookings/slots", {
      restaurantId: "restaurant-1",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      maxCapacity: 2,
    });
  });

  it("batch creates and blocks slots", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: { data: { created: 2, slots: [] } },
      } as never)
      .mockResolvedValueOnce({
        data: { data: { slot: { id: "slot-1", isAvailable: 0 } } },
      } as never);

    await expect(
      serviceBookingsService.batchCreateSlots({
        restaurantId: "restaurant-1",
        serviceItemId: 10,
        startDate: "2026-06-10",
        endDate: "2026-06-11",
        timeSlots: ["10:00"],
        maxCapacity: 2,
      }),
    ).resolves.toEqual({ created: 2, slots: [] });
    expect(api.post).toHaveBeenCalledWith("/service-bookings/slots/batch", {
      restaurantId: "restaurant-1",
      serviceItemId: 10,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      timeSlots: ["10:00"],
      maxCapacity: 2,
    });

    await expect(
      serviceBookingsService.blockSlot({
        restaurantId: "restaurant-1",
        serviceItemId: 10,
        date: "2026-06-10",
        timeSlot: "10:00",
        blockReason: "Private event",
      }),
    ).resolves.toEqual({ id: "slot-1", isAvailable: 0 });
    expect(api.post).toHaveBeenCalledWith("/service-bookings/slots/block", {
      restaurantId: "restaurant-1",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      blockReason: "Private event",
    });
  });

  it("lists bookings and runs lifecycle actions", async () => {
    const payAtVenueBooking = {
      id: "booking-1",
      restaurantId: "restaurant-1",
      serviceItemId: 10,
      serviceNameSnapshot: "Table reservation",
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      partySize: 2,
      status: "pending",
      confirmationCode: "ABC123",
      paymentRequirement: "pay_at_venue",
      depositRequiredCents: 0,
      balanceDueCents: 0,
      amountDueCents: 2500,
      amountPaidCents: 0,
      paymentStatus: "unpaid",
      paymentMethod: "none",
      reminderOptIn: 0,
      calendarUid: "booking-1@makanmasak.service-bookings",
    } satisfies ServiceBooking;
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { data: { bookings: [payAtVenueBooking] } },
    } as never);
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: { data: { booking: { id: "booking-1", status: "confirmed" } } },
      } as never)
      .mockResolvedValueOnce({
        data: { data: { booking: { id: "booking-1", status: "completed" } } },
      } as never)
      .mockResolvedValueOnce({
        data: { data: { booking: { id: "booking-1", status: "no_show" } } },
      } as never);
    vi.mocked(api.delete).mockResolvedValueOnce({
      data: { data: { booking: { id: "booking-1", status: "cancelled" } } },
    } as never);

    await expect(
      serviceBookingsService.listBookings({
        restaurantId: "restaurant-1",
        date: "2026-06-10",
        status: "pending",
      }),
    ).resolves.toEqual([payAtVenueBooking]);
    expect(api.get).toHaveBeenCalledWith("/service-bookings", {
      restaurantId: "restaurant-1",
      date: "2026-06-10",
      status: "pending",
    });

    await serviceBookingsService.confirmCash("booking-1");
    await serviceBookingsService.complete("booking-1");
    await serviceBookingsService.markNoShow("booking-1");
    await serviceBookingsService.cancel("booking-1");

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/service-bookings/booking-1/confirm-cash",
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/service-bookings/booking-1/complete",
    );
    expect(api.post).toHaveBeenNthCalledWith(
      3,
      "/service-bookings/booking-1/no-show",
    );
    expect(api.delete).toHaveBeenCalledWith("/service-bookings/booking-1");
  });
});
