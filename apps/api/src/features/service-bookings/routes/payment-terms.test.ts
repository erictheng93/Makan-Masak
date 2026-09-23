import { beforeEach, describe, expect, it, vi } from "vitest";

const createBooking = vi.hoisted(() => vi.fn());
const createRecurringBookings = vi.hoisted(() => vi.fn());

vi.mock("../services/ServiceBookingService", () => ({
  ServiceBookingService: class {
    createBooking = createBooking;
    createRecurringBookings = createRecurringBookings;
  },
}));

import app from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  createBooking.mockResolvedValue({ id: "booking-1", status: "pending" });
  createRecurringBookings.mockResolvedValue([]);
});

function request(path: string, body: unknown) {
  return app.request(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    { DB: {}, CACHE_KV: {} } as unknown as Record<string, unknown>,
  );
}

const bookingBody = {
  restaurantId: "restaurant-1",
  serviceItemId: 10,
  customerName: "Guest",
  customerPhone: "0911222333",
  bookingDate: "2026-06-05",
  bookingTime: "14:00",
};

describe("public service booking payment terms", () => {
  it.each([
    { paymentRequirement: "none" },
    { paymentRequirement: "deposit", depositAmountCents: 1 },
    { paymentRequirement: "prepay" },
    { paymentRequirement: "pay_at_venue" },
    { customerId: "another-customer" },
  ])("does not accept caller-controlled terms: %j", async (override) => {
    const response = await request("/", { ...bookingBody, ...override });

    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalledOnce();
    const input = createBooking.mock.calls[0][0] as Record<string, unknown>;
    expect(input).not.toHaveProperty("paymentRequirement");
    expect(input).not.toHaveProperty("depositAmountCents");
    expect(input).not.toHaveProperty("customerId");
  });

  it("does not accept caller-controlled terms for recurring bookings", async () => {
    const { bookingDate: _bookingDate, ...body } = bookingBody;
    const response = await request("/recurring", {
      ...body,
      startDate: "2026-06-05",
      count: 2,
      paymentRequirement: "none",
      customerId: "another-customer",
    });

    expect(response.status).toBe(201);
    const input = createRecurringBookings.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(input).not.toHaveProperty("paymentRequirement");
    expect(input).not.toHaveProperty("customerId");
  });
});
