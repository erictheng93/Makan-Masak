import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/services/api";
import { serviceBookingsApi } from "@/services/serviceBookingsApi";

vi.mock("@/services/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("serviceBookingsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gets service booking availability", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      slots: [{ timeSlot: "10:00", remaining: 2, isAvailable: true }],
    });

    await expect(
      serviceBookingsApi.getAvailability({
        serviceItemId: 10,
        date: "2026-06-10",
      }),
    ).resolves.toEqual([
      { timeSlot: "10:00", remaining: 2, isAvailable: true },
    ]);
    expect(apiClient.get).toHaveBeenCalledWith(
      "/service-bookings/availability",
      {
        serviceItemId: 10,
        date: "2026-06-10",
      },
    );
  });

  it("creates a pay-at-venue booking and pays compatible bookings with credits", async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({
        booking: { id: "booking-1", confirmationCode: "ABC123" },
      })
      .mockResolvedValueOnce({
        booking: { id: "booking-1", status: "confirmed" },
      });

    await expect(
      serviceBookingsApi.createBooking({
        restaurantId: "restaurant-1",
        serviceItemId: 10,
        customerName: "王小明",
        customerPhone: "0911222333",
        bookingDate: "2026-06-10",
        bookingTime: "10:00",
        paymentRequirement: "pay_at_venue",
      }),
    ).resolves.toMatchObject({ id: "booking-1" });
    expect(apiClient.post).toHaveBeenNthCalledWith(1, "/service-bookings", {
      restaurantId: "restaurant-1",
      serviceItemId: 10,
      customerName: "王小明",
      customerPhone: "0911222333",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      paymentRequirement: "pay_at_venue",
    });

    await expect(
      serviceBookingsApi.payWithCredits({
        bookingId: "booking-1",
        creditCardPublicId: "credit-public-1",
        pin: "1234",
      }),
    ).resolves.toMatchObject({ status: "confirmed" });
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      "/service-bookings/booking-1/pay",
      {
        creditCardPublicId: "credit-public-1",
        pin: "1234",
      },
    );
  });

  it("verifies and cancels by confirmation code", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      booking: { id: "booking-1", confirmationCode: "ABC123" },
    });
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      booking: { id: "booking-1", status: "cancelled" },
    });

    await expect(serviceBookingsApi.verify("ABC123")).resolves.toMatchObject({
      id: "booking-1",
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      "/service-bookings/verify/ABC123",
    );

    await expect(
      serviceBookingsApi.cancelByCode("ABC123"),
    ).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      "/service-bookings/verify/ABC123/cancel",
    );
  });
});
