import { beforeEach, describe, expect, it, vi } from "vitest";

const createBooking = vi.hoisted(() => vi.fn());

vi.mock("../services/ServiceBookingService", () => ({
  ServiceBookingService: class {
    createBooking = createBooking;
  },
}));

import app from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  createBooking.mockResolvedValue({
    id: "booking-1",
    employeeId: "7",
    status: "pending",
  });
});

function req(path: string, method = "GET", body?: unknown) {
  return app.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
    },
    {
      DB: {},
      CACHE_KV: {},
    } as unknown as Record<string, unknown>,
  );
}

describe("service booking create route employee assignment", () => {
  it("passes optional employeeId through to booking creation", async () => {
    const res = await req("/", "POST", {
      restaurantId: "restaurant-1",
      serviceItemId: 10,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      employeeId: "7",
    });

    expect(res.status).toBe(201);
    expect(createBooking).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      serviceItemId: 10,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      employeeId: "7",
    });
  });
});
