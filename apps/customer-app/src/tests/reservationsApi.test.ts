import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/services/api";
import { reservationsApi } from "@/services/reservationsApi";

vi.mock("@/services/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("reservationsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gets public availability with the selected party size", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      date: "2026-09-23",
      partySize: 2,
      slots: [],
    });

    await reservationsApi.getAvailability({
      restaurantId: "restaurant-1",
      date: "2026-09-23",
      partySize: 2,
    });

    expect(apiClient.get).toHaveBeenCalledWith("/reservations/availability", {
      restaurantId: "restaurant-1",
      date: "2026-09-23",
      partySize: 2,
    });
  });

  it("uses a caller-stable idempotency key for public writes", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "reservation-1" });
    vi.mocked(apiClient.delete).mockResolvedValueOnce({
      id: "reservation-1",
      status: "cancelled",
    });

    await reservationsApi.create(
      {
        restaurantId: "restaurant-1",
        customerName: "Ada",
        customerPhone: "0912345678",
        partySize: 2,
        reservationDate: "2026-09-23",
        reservationTime: "18:30",
      },
      "create-1",
    );
    await reservationsApi.cancel(
      {
        reservationId: "reservation-1",
        confirmationCode: "CONFIRM-1",
        reason: "Changed plans",
      },
      "cancel-1",
    );

    expect(apiClient.post).toHaveBeenCalledWith(
      "/reservations",
      expect.not.objectContaining({ customerId: expect.anything() }),
      { headers: { "Idempotency-Key": "create-1" } },
    );
    expect(apiClient.delete).toHaveBeenCalledWith(
      "/reservations/reservation-1/cancel",
      { confirmationCode: "CONFIRM-1", reason: "Changed plans" },
      { headers: { "Idempotency-Key": "cancel-1" } },
    );
  });

  it("encodes confirmation codes before sending them in a path", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ id: "reservation-1" });

    await reservationsApi.verify("A/B C");

    expect(apiClient.get).toHaveBeenCalledWith(
      "/reservations/verify/A%2FB%20C",
    );
  });
});
