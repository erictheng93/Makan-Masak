/**
 * The customer reservation endpoint is deliberately public: a diner does not
 * have a staff session, so applying the staff subscription gate to it would
 * turn every legitimate booking into NO_RESTAURANT. This test locks that
 * boundary while still proving all staff reservation routes are gated.
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

vi.mock("@makanmasak/database", () => ({
  PLAN_DEFAULT_MODULES: {
    basic: { reservations: false },
  },
  ReservationService: class {
    listReservations = listReservations;
    createReservation = createReservation;
    getPublicReservationRestaurant = getPublicReservationRestaurant;
    getReservationById = getReservationById;
    cancelReservation = cancelReservation;
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

  it("allows a public diner to create a reservation without touching staff auth or subscriptions", async () => {
    createReservation.mockResolvedValue({
      id: "reservation-1",
      restaurantId: "rest-basic",
      status: "pending",
    });

    const response = await request(
      "/",
      "POST",
      {
        DB: poisonedBinding("DB"),
        CACHE_KV: poisonedBinding("CACHE_KV"),
      },
      {
        restaurantId: "rest-basic",
        customerName: "Guest",
        customerPhone: "0911222333",
        partySize: 2,
        reservationDate: "2026-10-01",
        reservationTime: "18:30",
      },
    );

    expect(response.status).toBe(201);
    expect(authMiddlewareCalls.count).toBe(0);
    expect(createReservation).toHaveBeenCalledOnce();
  });

  it("returns a sanitized 404 before a missing restaurant can reach slot allocation", async () => {
    getPublicReservationRestaurant.mockResolvedValue(null);

    const response = await request(
      "/",
      "POST",
      {
        DB: poisonedBinding("DB"),
        CACHE_KV: poisonedBinding("CACHE_KV"),
      },
      {
        restaurantId: "missing-restaurant",
        customerName: "Guest",
        customerPhone: "0911222333",
        partySize: 2,
        reservationDate: "2026-10-01",
        reservationTime: "18:30",
      },
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
