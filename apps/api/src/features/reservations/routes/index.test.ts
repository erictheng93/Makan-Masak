import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import app from "./index";

const currentUser = vi.hoisted(() => ({
  value: {
    id: "user-10",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
}));
const createReservation = vi.hoisted(() => vi.fn());
const getPublicReservationRestaurant = vi.hoisted(() => vi.fn());
const getReservationByCode = vi.hoisted(() => vi.fn());
const getAvailableSlots = vi.hoisted(() => vi.fn());
const getReservationById = vi.hoisted(() => vi.fn());
const cancelReservation = vi.hoisted(() => vi.fn());
const listReservations = vi.hoisted(() => vi.fn());
const updateReservation = vi.hoisted(() => vi.fn());
const confirmReservation = vi.hoisted(() => vi.fn());
const markArrived = vi.hoisted(() => vi.fn());
const markSeated = vi.hoisted(() => vi.fn());
const completeReservation = vi.hoisted(() => vi.fn());
const markNoShow = vi.hoisted(() => vi.fn());
const getReservationStats = vi.hoisted(() => vi.fn());
const createSlot = vi.hoisted(() => vi.fn());
const batchCreateSlots = vi.hoisted(() => vi.fn());
const idempotencyMiddleware = vi.hoisted(() =>
  vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
);
const rateLimitMiddleware = vi.hoisted(() =>
  vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
);

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", currentUser.value);
    await next();
  }),
  requireRole: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("../../../middleware/idempotency", () => ({
  idempotencyMiddleware,
}));

vi.mock("../../../middleware/rateLimiter", () => ({
  rateLimitMiddleware,
}));

vi.mock("@makanmasak/database", () => ({
  ReservationService: class {
    createReservation = createReservation;
    getPublicReservationRestaurant = getPublicReservationRestaurant;
    getReservationByCode = getReservationByCode;
    getAvailableSlots = getAvailableSlots;
    getReservationById = getReservationById;
    cancelReservation = cancelReservation;
    listReservations = listReservations;
    updateReservation = updateReservation;
    confirmReservation = confirmReservation;
    markArrived = markArrived;
    markSeated = markSeated;
    completeReservation = completeReservation;
    markNoShow = markNoShow;
    getReservationStats = getReservationStats;
    createSlot = createSlot;
    batchCreateSlots = batchCreateSlots;
  },
}));

function createEnv() {
  return {
    DB: {},
    CACHE_KV: {},
  };
}

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "reservation-1",
    restaurantId: "restaurant-1",
    customerName: "Ada",
    customerPhone: "0912345678",
    partySize: 4,
    reservationDate: "2026-06-08",
    reservationTime: "18:30",
    confirmationCode: "ABC123",
    status: "pending",
    ...overrides,
  };
}

async function withSilencedRouteError<T>(
  action: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

describe("reservations routes", () => {
  beforeEach(() => {
    currentUser.value = {
      id: "user-10",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
    createReservation.mockReset();
    getPublicReservationRestaurant.mockReset();
    getPublicReservationRestaurant.mockResolvedValue({ id: "restaurant-1" });
    getReservationByCode.mockReset();
    getAvailableSlots.mockReset();
    getReservationById.mockReset();
    cancelReservation.mockReset();
    listReservations.mockReset();
    updateReservation.mockReset();
    confirmReservation.mockReset();
    markArrived.mockReset();
    markSeated.mockReset();
    completeReservation.mockReset();
    markNoShow.mockReset();
    getReservationStats.mockReset();
    createSlot.mockReset();
    batchCreateSlots.mockReset();
  });

  it("creates public reservations and validates required fields", async () => {
    createReservation.mockResolvedValue(reservation());
    const env = createEnv();

    const response = await app.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify({
          restaurantId: "restaurant-1",
          customerName: "Ada",
          customerPhone: "0912345678",
          partySize: 4,
          reservationDate: "2026-06-08",
          reservationTime: "18:30",
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: "reservation-1", confirmationCode: "ABC123" },
    });
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        customerName: "Ada",
        customerPhone: "+886912345678",
      }),
    );

    const invalid = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify({ restaurantId: "restaurant-1" }),
        }),
        env as never,
      ),
    );
    expect(invalid.status).toBe(500);
    await expect(invalid.text()).resolves.toBe("Internal Server Error");
  });

  it("verifies reservation codes and returns availability slots", async () => {
    getReservationByCode.mockResolvedValue(reservation());
    getAvailableSlots.mockResolvedValue({
      date: "2026-06-08",
      partySize: 4,
      slots: [
        { time: "18:00", available: true },
        { time: "18:30", available: false },
      ],
    });
    const env = createEnv();

    const verifyResponse = await app.fetch(
      new Request("https://test/verify/ABC123"),
      env as never,
    );
    expect(verifyResponse.status).toBe(200);
    await expect(verifyResponse.json()).resolves.toMatchObject({
      data: { id: "reservation-1", confirmationCode: "ABC123" },
    });

    const availabilityResponse = await app.fetch(
      new Request(
        "https://test/availability?restaurantId=restaurant-1&date=2026-06-08&partySize=4&duration=120",
      ),
      env as never,
    );
    expect(availabilityResponse.status).toBe(200);
    await expect(availabilityResponse.json()).resolves.toMatchObject({
      data: {
        date: "2026-06-08",
        partySize: 4,
        slots: [
          { time: "18:00", available: true },
          { time: "18:30", available: false },
        ],
      },
    });
    expect(getAvailableSlots).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      date: "2026-06-08",
      partySize: 4,
      duration: 120,
    });
  });

  it("hardens public mutations against replay and anonymous mass assignment", async () => {
    const env = createEnv();
    const rejected = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/", {
          method: "POST",
          headers: { "Idempotency-Key": "reservation-create-1" },
          body: JSON.stringify({
            restaurantId: "restaurant-1",
            customerId: "another-customer",
            customerName: "Ada",
            customerPhone: "0912345678",
            partySize: 4,
            reservationDate: "2026-06-08",
            reservationTime: "18:30",
          }),
        }),
        env as never,
      ),
    );

    expect(rejected.status).toBe(500);
    expect(createReservation).not.toHaveBeenCalled();
    expect(rateLimitMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        keyPrefix: "public_reservation_create",
        maxRequests: 5,
        windowMs: 15 * 60 * 1000,
      }),
    );
    expect(rateLimitMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        keyPrefix: "public_reservation_lookup",
        maxRequests: 20,
        windowMs: 15 * 60 * 1000,
      }),
    );
    expect(rateLimitMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        keyPrefix: "public_reservation_availability",
        maxRequests: 30,
        windowMs: 60 * 1000,
      }),
    );
    expect(rateLimitMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        keyPrefix: "public_reservation_cancel",
        maxRequests: 10,
        windowMs: 15 * 60 * 1000,
      }),
    );
    expect(idempotencyMiddleware).toHaveBeenCalledWith({
      scope: "public-reservation-create",
    });
    expect(idempotencyMiddleware).toHaveBeenCalledWith({
      scope: "public-reservation-cancel",
    });
    expect(idempotencyMiddleware).toHaveBeenCalledWith({
      scope: "staff-reservation-create",
    });
  });

  it("creates staff reservations only in the caller's restaurant", async () => {
    createReservation.mockResolvedValue(reservation());
    const input = {
      restaurantId: "restaurant-1",
      customerName: "Ada",
      customerPhone: "0912345678",
      partySize: 4,
      reservationDate: "2026-06-08",
      reservationTime: "18:30",
    };

    const response = await app.fetch(
      new Request("https://test/staff", {
        method: "POST",
        headers: { "Idempotency-Key": "staff-create-1" },
        body: JSON.stringify(input),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(201);
    expect(createReservation).toHaveBeenCalledWith({
      ...input,
      customerPhone: "+886912345678",
    });

    createReservation.mockClear();
    const crossTenant = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/staff", {
          method: "POST",
          headers: { "Idempotency-Key": "staff-create-2" },
          body: JSON.stringify({ ...input, restaurantId: "restaurant-2" }),
        }),
        createEnv() as never,
      ),
    );
    expect(crossTenant.status).toBe(500);
    expect(createReservation).not.toHaveBeenCalled();

    currentUser.value = {
      id: "admin-1",
      username: "admin",
      role: 0,
      restaurantId: "restaurant-1",
    };
    createReservation.mockResolvedValueOnce(
      reservation({ restaurantId: "restaurant-2" }),
    );
    const adminResponse = await app.fetch(
      new Request("https://test/staff", {
        method: "POST",
        headers: { "Idempotency-Key": "staff-create-3" },
        body: JSON.stringify({ ...input, restaurantId: "restaurant-2" }),
      }),
      createEnv() as never,
    );
    expect(adminResponse.status).toBe(201);
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "restaurant-2" }),
    );

    createReservation.mockClear();
    const invalid = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/staff", {
          method: "POST",
          headers: { "Idempotency-Key": "staff-create-4" },
          body: JSON.stringify({ ...input, unexpected: true }),
        }),
        createEnv() as never,
      ),
    );
    expect(invalid.status).toBe(500);
    expect(createReservation).not.toHaveBeenCalled();
  });

  it("normalizes international phone numbers before public reservation creation", async () => {
    createReservation.mockResolvedValue(reservation());

    const response = await app.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify({
          restaurantId: "restaurant-1",
          customerName: "Mai",
          customerPhone: "+60 12-345 6789",
          partySize: 2,
          reservationDate: "2026-06-08",
          reservationTime: "18:30",
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(201);
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ customerPhone: "+60123456789" }),
    );
  });

  it("checks restaurant visibility before anonymous reservation creation", async () => {
    getPublicReservationRestaurant.mockResolvedValue(null);

    const response = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify({
            restaurantId: "missing-restaurant",
            customerName: "Ada",
            customerPhone: "0912345678",
            partySize: 4,
            reservationDate: "2026-06-08",
            reservationTime: "18:30",
          }),
        }),
        createEnv() as never,
      ),
    );

    // This bare route test does not install app-factory's ApiError handler;
    // the assertion below verifies that no write path is reached. The full API
    // handler turns the thrown RESTAURANT_NOT_FOUND error into a 404 response.
    expect(response.status).toBe(500);
    expect(createReservation).not.toHaveBeenCalled();
    expect(getPublicReservationRestaurant).toHaveBeenCalledWith(
      "missing-restaurant",
    );
  });

  it("cancels public reservations only with the matching confirmation code", async () => {
    getReservationById.mockResolvedValue(reservation());
    cancelReservation.mockResolvedValue(
      reservation({ status: "cancelled", cancellationReason: "changed plans" }),
    );
    const env = createEnv();

    const response = await app.fetch(
      new Request("https://test/reservation-1/cancel", {
        method: "DELETE",
        body: JSON.stringify({
          confirmationCode: "ABC123",
          reason: "changed plans",
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "reservation-1", status: "cancelled" },
    });
    // The verified reservation's own restaurantId is passed through so the
    // write is scoped to the tenant the confirmation code just proved.
    expect(cancelReservation).toHaveBeenCalledWith(
      "reservation-1",
      "changed plans",
      "restaurant-1",
    );

    getReservationById.mockResolvedValueOnce(reservation());
    const forbiddenResponse = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/reservation-1/cancel", {
          method: "DELETE",
          body: JSON.stringify({ confirmationCode: "WRONG" }),
        }),
        env as never,
      ),
    );
    expect(forbiddenResponse.status).toBe(500);
    await expect(forbiddenResponse.text()).resolves.toBe(
      "Internal Server Error",
    );
  });

  it("cancels staff reservations through the authenticated tenant-scoped route", async () => {
    getReservationById.mockResolvedValue(reservation());
    cancelReservation.mockResolvedValue(reservation({ status: "cancelled" }));

    const response = await app.fetch(
      new Request("https://test/reservation-1/cancel", {
        method: "POST",
        body: JSON.stringify({ reason: "Changed plans" }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "reservation-1", status: "cancelled" },
    });
    expect(cancelReservation).toHaveBeenCalledWith(
      "reservation-1",
      "Changed plans",
      "restaurant-1",
    );

    currentUser.value = {
      id: "user-20",
      username: "other-owner",
      role: 1,
      restaurantId: "restaurant-2",
    };
    cancelReservation.mockClear();
    const denied = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/reservation-1/cancel", {
          method: "POST",
          body: JSON.stringify({}),
        }),
        createEnv() as never,
      ),
    );

    expect(denied.status).toBe(500);
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  it("lists protected reservations with role-scoped filters", async () => {
    listReservations.mockResolvedValue({
      data: [reservation({ status: "confirmed" })],
      total: 1,
    });

    const response = await app.fetch(
      new Request("https://test/?restaurantId=other&status=confirmed&page=2"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: "reservation-1", status: "confirmed" }],
      pagination: { page: 2, limit: 20, total: 1, totalPages: 1 },
    });
    expect(listReservations).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        status: "confirmed",
        page: 2,
        limit: 20,
      }),
    );
  });

  it("reads and updates protected reservation details with restaurant scoping", async () => {
    getReservationById.mockResolvedValue(reservation());
    updateReservation.mockResolvedValue(reservation({ customerName: "Grace" }));
    const env = createEnv();

    const detailResponse = await app.fetch(
      new Request("https://test/reservation-1"),
      env as never,
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      data: { id: "reservation-1", restaurantId: "restaurant-1" },
    });

    const updateResponse = await app.fetch(
      new Request("https://test/reservation-1", {
        method: "PUT",
        body: JSON.stringify({ customerName: "Grace" }),
      }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: { id: "reservation-1", customerName: "Grace" },
    });
    expect(updateReservation).toHaveBeenCalledWith("reservation-1", {
      customerName: "Grace",
    });

    getReservationById.mockResolvedValueOnce(
      reservation({ restaurantId: "restaurant-2" }),
    );
    const scopedResponse = await withSilencedRouteError(() =>
      app.fetch(new Request("https://test/reservation-2"), env as never),
    );
    expect(scopedResponse.status).toBe(500);
    await expect(scopedResponse.text()).resolves.toBe("Internal Server Error");
  });

  it("runs status actions for protected reservations", async () => {
    getReservationById.mockResolvedValue(reservation());
    confirmReservation.mockResolvedValue(reservation({ status: "confirmed" }));
    markArrived.mockResolvedValue(reservation({ status: "arrived" }));
    markSeated.mockResolvedValue(reservation({ status: "seated" }));
    completeReservation.mockResolvedValue(reservation({ status: "completed" }));
    markNoShow.mockResolvedValue(reservation({ status: "no_show" }));
    const env = createEnv();

    const cases: Array<[string, typeof confirmReservation, string]> = [
      ["confirm", confirmReservation, "confirmed"],
      ["arrive", markArrived, "arrived"],
      ["seat", markSeated, "seated"],
      ["complete", completeReservation, "completed"],
      ["no-show", markNoShow, "no_show"],
    ];

    for (const [action, fn, status] of cases) {
      const response = await app.fetch(
        new Request(`https://test/reservation-1/${action}`, {
          method: "POST",
        }),
        env as never,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { status },
      });
      // Second argument is the tenant the route just authorized — the service
      // folds it into the UPDATE's WHERE instead of trusting this check alone.
      expect(fn).toHaveBeenCalledWith("reservation-1", "restaurant-1");
    }
  });

  it("denies every status transition for a reservation in another restaurant", async () => {
    getReservationById.mockResolvedValue(
      reservation({ restaurantId: "restaurant-2" }),
    );
    const cases: Array<[string, typeof confirmReservation]> = [
      ["confirm", confirmReservation],
      ["arrive", markArrived],
      ["seat", markSeated],
      ["complete", completeReservation],
      ["no-show", markNoShow],
    ];

    for (const [action, fn] of cases) {
      const response = await withSilencedRouteError(() =>
        app.fetch(
          new Request(`https://test/reservation-2/${action}`, {
            method: "POST",
          }),
          createEnv() as never,
        ),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("returns scoped stats and manages slots", async () => {
    getReservationStats.mockResolvedValue({ total: 8, confirmed: 5 });
    createSlot.mockResolvedValue({
      id: "slot-1",
      restaurantId: "restaurant-1",
    });
    batchCreateSlots.mockResolvedValue(7);
    const env = createEnv();

    const statsResponse = await app.fetch(
      new Request("https://test/stats/restaurant-1?date=2026-06-08"),
      env as never,
    );
    expect(statsResponse.status).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      data: { total: 8, confirmed: 5 },
    });
    expect(getReservationStats).toHaveBeenCalledWith(
      "restaurant-1",
      "2026-06-08",
    );

    const slotResponse = await app.fetch(
      new Request("https://test/slots", {
        method: "POST",
        body: JSON.stringify({
          restaurantId: "restaurant-1",
          date: "2026-06-08",
          time: "18:00",
        }),
      }),
      env as never,
    );
    expect(slotResponse.status).toBe(200);
    await expect(slotResponse.json()).resolves.toMatchObject({
      data: { id: "slot-1", restaurantId: "restaurant-1" },
    });

    const batchResponse = await app.fetch(
      new Request("https://test/slots/batch", {
        method: "POST",
        body: JSON.stringify({
          restaurantId: "restaurant-1",
          date: "2026-06-08",
          times: ["18:00", "18:30"],
        }),
      }),
      env as never,
    );
    expect(batchResponse.status).toBe(200);
    await expect(batchResponse.json()).resolves.toMatchObject({
      data: { created: 7 },
    });
  });
});
