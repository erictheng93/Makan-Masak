/**
 * Subscription-gate wiring for service-bookings routes.
 *
 * Regression coverage for the bug where the staff/admin half of this router
 * (`app.use("/*", authMiddleware)` at the "Staff / admin" boundary) had no
 * `moduleGate("reservations")` next to it, unlike its structural siblings
 * (reservations/routes/index.ts, waiting-list/routes/index.ts). That let a
 * `basic`-tier shop owner use the entire 預約服務 booking product for free.
 *
 * Unlike index.test.ts / scope.test.ts, this file does NOT mock
 * "../../../middleware/moduleGate" — it exercises the real middleware so a
 * missing/misplaced `app.use("/*", moduleGate(...))` line fails these tests.
 * The gate's own tier x module matrix is exhaustively covered in
 * middleware/moduleGate.test.ts; this file only proves the wiring: which
 * tiers get through on a staff route, that a diner cannot START a booking
 * at a shop without the module, and that an existing booking can still be
 * read, cancelled and paid there (those routes never touch the gate).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";

// Mutable current user injected by the mocked auth middleware.
const currentUser = vi.hoisted(() => {
  const value: AuthUser = {
    id: "user-1",
    username: "owner",
    role: 1,
    restaurantId: "rest-basic",
  };
  return { value };
});

// Spy so the public-route test can prove authMiddleware (and therefore the
// moduleGate registered right after it) never ran.
const authMiddlewareCalls = vi.hoisted(() => ({ count: 0 }));

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

vi.mock("../../../middleware/rateLimiter", () => ({
  rateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

const listByRestaurant = vi.hoisted(() => vi.fn());
const createBooking = vi.hoisted(() => vi.fn());
const createRecurringBookings = vi.hoisted(() => vi.fn());
const joinWaitlist = vi.hoisted(() => vi.fn());
const getByConfirmationCode = vi.hoisted(() => vi.fn());
const cancelByConfirmationCode = vi.hoisted(() => vi.fn());
const payWithCredits = vi.hoisted(() => vi.fn());

vi.mock("../services/ServiceBookingService", () => ({
  MAX_BATCH_SLOT_CREATION_COUNT: 1000,
  ServiceBookingService: vi.fn(function ServiceBookingService() {
    return {
      listByRestaurant,
      createBooking,
      createRecurringBookings,
      joinWaitlist,
      getByConfirmationCode,
      cancelByConfirmationCode,
      payWithCredits,
    };
  }),
}));

import app from "./index";
import { ApiError } from "../../../shared/utils/api-error";

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

/** A binding that explodes on any property access — proves a code path never touches it. */
function poisonedBinding(label: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `${label} was accessed (property ${String(prop)}) but must not be`,
        );
      },
    },
  );
}

interface CachedSubscription {
  isActive: boolean;
  planTier: "trial" | "basic" | "pro" | "enterprise";
  moduleOverrides: Record<string, boolean>;
  trialEndsAt: number | null;
}

/** Minimal KV stand-in pre-seeded with `subscription:<restaurantId>` entries. */
class FakeKv {
  constructor(private readonly data: Record<string, CachedSubscription>) {}
  async get<T>(key: string): Promise<T | null> {
    const restaurantId = key.replace(/^subscription:/, "");
    const value = this.data[restaurantId];
    return (value as unknown as T) ?? null;
  }
  async put(): Promise<void> {
    // no-op: all fixtures below are pre-seeded cache hits.
  }
  async delete(): Promise<void> {
    // unused in this file
  }
}

function subscription(
  planTier: CachedSubscription["planTier"],
  moduleOverrides: Record<string, boolean> = {},
): CachedSubscription {
  return { isActive: true, planTier, moduleOverrides, trialEndsAt: null };
}

/** Real moduleGate reads only CACHE_KV on a cache hit; DB stays poisoned to prove that. */
function envWithSubscription(
  restaurantId: string,
  planTier: CachedSubscription["planTier"],
  moduleOverrides: Record<string, boolean> = {},
) {
  return {
    DB: poisonedBinding("DB"),
    CACHE_KV: new FakeKv({
      [restaurantId]: subscription(planTier, moduleOverrides),
    }),
  } as unknown as Record<string, unknown>;
}

/** Env for the public-route test: any touch to either binding is a bug. */
function poisonedEnv() {
  return {
    DB: poisonedBinding("DB"),
    CACHE_KV: poisonedBinding("CACHE_KV"),
  } as unknown as Record<string, unknown>;
}

function req(
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

beforeEach(() => {
  vi.clearAllMocks();
  authMiddlewareCalls.count = 0;
  currentUser.value = {
    id: "user-1",
    username: "owner",
    role: 1,
    restaurantId: "rest-basic",
  };
});

describe("service-bookings staff routes are gated on the reservations module", () => {
  it("denies a basic-tier owner with 403 MODULE_NOT_ENABLED", async () => {
    currentUser.value = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-basic",
    };

    const res = await req(
      "/",
      "GET",
      envWithSubscription("rest-basic", "basic"),
    );
    const json = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };

    expect(res.status).toBe(403);
    expect(json).toMatchObject({
      success: false,
      error: { code: "MODULE_NOT_ENABLED" },
    });
    expect(listByRestaurant).not.toHaveBeenCalled();
  });

  it("allows a pro-tier owner through to the staff route", async () => {
    currentUser.value = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-pro",
    };
    listByRestaurant.mockResolvedValue([{ id: "bk-1" }]);

    const res = await req("/", "GET", envWithSubscription("rest-pro", "pro"));

    expect(res.status).toBe(200);
    expect(listByRestaurant).toHaveBeenCalledOnce();
    expect(listByRestaurant).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "rest-pro" }),
    );
  });

  it("allows an enterprise-tier owner through to the staff route", async () => {
    currentUser.value = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-ent",
    };
    listByRestaurant.mockResolvedValue([{ id: "bk-1" }]);

    const res = await req(
      "/",
      "GET",
      envWithSubscription("rest-ent", "enterprise"),
    );

    expect(res.status).toBe(200);
    expect(listByRestaurant).toHaveBeenCalledOnce();
    expect(listByRestaurant).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "rest-ent" }),
    );
  });
});

const bookingBody = {
  serviceItemId: 10,
  customerName: "Guest",
  customerPhone: "0911222333",
  bookingDate: "2026-06-05",
  bookingTime: "14:00",
};

describe("public service-bookings routes and the reservations module", () => {
  it("lets a diner book at a shop whose plan includes reservations, without staff auth", async () => {
    createBooking.mockResolvedValue({ id: "booking-1", status: "pending" });

    const res = await req("/", "POST", envWithSubscription("rest-pro", "pro"), {
      ...bookingBody,
      restaurantId: "rest-pro",
    });

    expect(res.status).toBe(201);
    expect(createBooking).toHaveBeenCalledOnce();
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "rest-pro" }),
    );
    expect(authMiddlewareCalls.count).toBe(0);
  });

  it.each([
    ["/", bookingBody],
    [
      "/recurring",
      {
        ...bookingBody,
        bookingDate: undefined,
        startDate: "2026-06-05",
        count: 2,
      },
    ],
    ["/waitlist", bookingBody],
  ])("refuses POST %s at a shop without the module", async (path, body) => {
    const res = await req(
      path,
      "POST",
      envWithSubscription("rest-basic", "basic"),
      { ...body, restaurantId: "rest-basic" },
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_ENABLED" },
    });
    expect(createBooking).not.toHaveBeenCalled();
    expect(createRecurringBookings).not.toHaveBeenCalled();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("refuses a voucher where the shop has reservations but not coupons", async () => {
    const res = await req(
      "/",
      "POST",
      envWithSubscription("rest-basic", "basic", { reservations: true }),
      { ...bookingBody, restaurantId: "rest-basic", voucherCode: "SAVE10" },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "VOUCHER_NOT_APPLICABLE" },
    });
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("still serves an existing booking's lookup, cancel and payment with the module gone", async () => {
    getByConfirmationCode.mockResolvedValue({ id: "booking-1" });
    cancelByConfirmationCode.mockResolvedValue({ id: "booking-1" });
    payWithCredits.mockResolvedValue({ id: "booking-1" });

    // Poisoned bindings: none of these paths may consult the subscription.
    const lookup = await req("/verify/CODE-1", "GET", poisonedEnv());
    const cancel = await req(
      "/verify/CODE-1/cancel",
      "POST",
      poisonedEnv(),
      {},
    );
    const pay = await req("/booking-1/pay", "POST", poisonedEnv(), {
      creditCardPublicId: "card-1",
    });

    expect([lookup.status, cancel.status, pay.status]).toEqual([200, 200, 200]);
    expect(getByConfirmationCode).toHaveBeenCalledWith(
      "CODE-1",
      expect.objectContaining({ requireContact: false }),
    );
    expect(cancelByConfirmationCode).toHaveBeenCalledOnce();
    expect(payWithCredits).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "booking-1" }),
    );
  });
});
