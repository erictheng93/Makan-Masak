/**
 * The customer reservation endpoints are public: a diner has no staff session,
 * so they are gated on the restaurant named in the request instead. A diner
 * cannot start a reservation (or browse slots) at a shop whose plan lacks the
 * module, but can still look up and cancel one made before the downgrade.
 * Staff reservation routes stay gated on the staff member's own restaurant.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";

const currentUser = vi.hoisted(() => ({
  value: {
    id: "user-1",
    username: "owner",
    role: 1,
    restaurantId: "rest-basic",
  } as AuthUser,
}));
const authMiddlewareCalls = vi.hoisted(() => ({ count: 0 }));
const listReservations = vi.hoisted(() => vi.fn());
const createReservation = vi.hoisted(() => vi.fn());
const getPublicReservationRestaurant = vi.hoisted(() => vi.fn());
const getReservationById = vi.hoisted(() => vi.fn());
const cancelReservation = vi.hoisted(() => vi.fn());
const getReservationByCode = vi.hoisted(() => vi.fn());
const getAvailableSlots = vi.hoisted(() => vi.fn());

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    authMiddlewareCalls.count += 1;
    c.set("user", currentUser.value);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../../../middleware/idempotency", () => ({
  idempotencyMiddleware: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

vi.mock("../../../middleware/rateLimiter", () => ({
  rateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

vi.mock("@makanmasak/database", async (importOriginal) => ({
  // Real plan table and region defaults: the gate decides as in production.
  ...(await importOriginal<typeof import("@makanmasak/database")>()),
  ReservationService: class {
    listReservations = listReservations;
    createReservation = createReservation;
    getPublicReservationRestaurant = getPublicReservationRestaurant;
    getReservationById = getReservationById;
    cancelReservation = cancelReservation;
    getReservationByCode = getReservationByCode;
    getAvailableSlots = getAvailableSlots;
  },
}));

import app from "./index";

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

class FakeKv {
  constructor(
    private readonly subscriptions: Record<
      string,
      {
        isActive: boolean;
        planTier: "trial" | "basic" | "pro" | "enterprise";
        moduleOverrides: Record<string, boolean>;
        trialEndsAt: null;
      }
    >,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    return (this.subscriptions[key.replace("subscription:", "")] ??
      null) as T | null;
  }

  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

function poisonedBinding(label: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`${label} must not be read (${String(property)})`);
      },
    },
  );
}

function envWithPlan(restaurantId: string, planTier: "basic" | "pro") {
  return {
    DB: poisonedBinding("DB"),
    CACHE_KV: new FakeKv({
      [restaurantId]: {
        isActive: true,
        planTier,
        moduleOverrides: {},
        trialEndsAt: null,
      },
    }),
  };
}

function dinerBooking(restaurantId: string) {
  return {
    restaurantId,
    customerName: "Guest",
    customerPhone: "0911222333",
    partySize: 2,
    reservationDate: "2026-10-01",
    reservationTime: "18:30",
  };
}

function request(
  path: string,
  method: string,
  env: Record<string, unknown>,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
    },
    env as never,
  );
}

describe("reservation staff gate and public customer boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMiddlewareCalls.count = 0;
    currentUser.value = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-basic",
    };
    getPublicReservationRestaurant.mockResolvedValue({ id: "rest-basic" });
    getReservationById.mockReset();
    cancelReservation.mockReset();
  });

  it("denies a basic-tier owner on protected reservation routes", async () => {
    const response = await request("/", "GET", {
      DB: poisonedBinding("DB"),
      CACHE_KV: new FakeKv({
        "rest-basic": {
          isActive: true,
          planTier: "basic",
          moduleOverrides: {},
          trialEndsAt: null,
        },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_ENABLED" },
    });
    expect(listReservations).not.toHaveBeenCalled();
  });

  it("lets a diner create a reservation at a shop with the module, without staff auth", async () => {
    getPublicReservationRestaurant.mockResolvedValue({ id: "rest-pro" });
    createReservation.mockResolvedValue({
      id: "reservation-1",
      restaurantId: "rest-pro",
      status: "pending",
    });

    const response = await request(
      "/",
      "POST",
      envWithPlan("rest-pro", "pro"),
      dinerBooking("rest-pro"),
    );

    expect(response.status).toBe(201);
    expect(authMiddlewareCalls.count).toBe(0);
    expect(createReservation).toHaveBeenCalledOnce();
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "rest-pro" }),
    );
  });

  it("refuses a new reservation at a shop whose plan lacks the module", async () => {
    const response = await request(
      "/",
      "POST",
      envWithPlan("rest-basic", "basic"),
      dinerBooking("rest-basic"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_ENABLED" },
    });
    expect(createReservation).not.toHaveBeenCalled();
  });

  it("stops advertising slots at a shop whose plan lacks the module", async () => {
    const response = await request(
      "/availability?restaurantId=rest-basic&date=2026-10-01&partySize=2",
      "GET",
      envWithPlan("rest-basic", "basic"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_ENABLED" },
    });
    expect(getAvailableSlots).not.toHaveBeenCalled();
  });

  it("returns a sanitized 404 before a missing restaurant can reach slot allocation", async () => {
    getPublicReservationRestaurant.mockResolvedValue(null);

    const response = await request(
      "/",
      "POST",
      envWithPlan("missing-restaurant", "pro"),
      dinerBooking("missing-restaurant"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "RESTAURANT_NOT_FOUND",
        message: "Restaurant not found",
      },
    });
    expect(createReservation).not.toHaveBeenCalled();
  });

  it("still looks up and cancels an existing reservation after the module is gone", async () => {
    const existing = {
      id: "reservation-1",
      restaurantId: "rest-basic",
      confirmationCode: "VALID-CODE",
    };
    getReservationByCode.mockResolvedValue(existing);
    getReservationById.mockResolvedValue(existing);
    cancelReservation.mockResolvedValue({ ...existing, status: "cancelled" });

    // Poisoned bindings: neither path may consult the subscription.
    const env = {
      DB: poisonedBinding("DB"),
      CACHE_KV: poisonedBinding("CACHE_KV"),
    };
    const lookup = await request("/verify/VALID-CODE", "GET", env);
    const cancel = await request("/reservation-1/cancel", "DELETE", env, {
      confirmationCode: "VALID-CODE",
    });

    expect(lookup.status).toBe(200);
    expect(cancel.status).toBe(200);
    expect(getReservationByCode).toHaveBeenCalledWith("VALID-CODE");
    expect(cancelReservation).toHaveBeenCalledWith(
      "reservation-1",
      undefined,
      "rest-basic",
    );
  });

  it("keeps an invalid public cancellation confirmation as a 403", async () => {
    getReservationById.mockResolvedValue({
      id: "reservation-1",
      restaurantId: "rest-basic",
      confirmationCode: "VALID-CODE",
    });

    const response = await request(
      "/reservation-1/cancel",
      "DELETE",
      {
        DB: poisonedBinding("DB"),
        CACHE_KV: poisonedBinding("CACHE_KV"),
      },
      { confirmationCode: "WRONG-CODE" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    expect(cancelReservation).not.toHaveBeenCalled();
  });
});
