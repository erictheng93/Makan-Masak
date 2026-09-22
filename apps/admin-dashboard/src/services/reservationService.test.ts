import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { ReservationService } from "./reservationService";

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("ReservationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches an idempotency key when staff create a reservation", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { id: "reservation-1" },
    } as never);

    await ReservationService.createReservation({
      restaurantId: "restaurant-1",
      customerName: "Ada",
      customerPhone: "0912345678",
      partySize: 2,
      reservationDate: "2026-09-23",
      reservationTime: "18:00",
    });

    expect(api.post).toHaveBeenCalledWith(
      "/reservations/staff",
      expect.objectContaining({
        restaurantId: "restaurant-1",
        customerName: "Ada",
      }),
      {
        headers: {
          "Idempotency-Key": expect.any(String),
        },
      },
    );
  });
});
