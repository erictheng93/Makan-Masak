import { describe, expect, it, vi } from "vitest";
import { ReservationService } from "./ReservationService";

describe("ReservationService confirmation credentials", () => {
  it("generates opaque, non-enumerable confirmation codes", () => {
    const service = new ReservationService({} as D1Database, {
      JWT_SECRET: "test",
    });
    const codes = Array.from({ length: 32 }, () =>
      (
        service as unknown as { generateConfirmationCode: () => string }
      ).generateConfirmationCode(),
    );

    expect(new Set(codes)).toHaveLength(codes.length);
    expect(codes.every((code) => /^[A-Z0-9]{24}$/.test(code))).toBe(true);
    expect(codes.some((code) => /^\d{6}$/.test(code))).toBe(false);
  });
});

describe("ReservationService.updateReservation table scope", () => {
  it("rejects a tableId that belongs to another restaurant", async () => {
    const service = new ReservationService({} as D1Database, {
      JWT_SECRET: "test",
    });
    const db = { get: vi.fn().mockResolvedValue(undefined), update: vi.fn() };
    Object.assign(service, {
      db,
      getReservationById: vi.fn().mockResolvedValue({ restaurantId: "r1" }),
    });

    await expect(
      service.updateReservation("res-1", { tableId: 99 }),
    ).rejects.toThrow("桌位不存在");
    expect(db.get).toHaveBeenCalledOnce();
    expect(db.update).not.toHaveBeenCalled();
  });
});
