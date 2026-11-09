/**
 * Route-level cross-tenant scope tests for service-bookings staff routes.
 *
 * The staff routes are role-gated (requireRole) AND restaurant-scoped
 * (loadBookingInScope): a non-admin may only touch their own restaurant's
 * bookings. role 0 (admin) is unscoped. The 9 real-D1 service tests call the
 * service directly and do NOT exercise this route guard — this file is the
 * merge-blocker coverage for the cross-tenant IDOR fix.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Context, Next } from "hono";

// Mutable current user injected by the mocked auth middleware.
const auth = vi.hoisted(() => ({
  user: {
    id: "user-1",
    username: "owner",
    role: 1,
    restaurantId: "rest-A" as string | number | undefined,
  },
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("user", auth.user);
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

// This file exercises restaurant-scope (IDOR) enforcement, not subscription
// enforcement — bypass the module gate here, matching the sibling
// reservations/waiting-list/ai-analytics route test convention. The gate's
// own service-bookings wiring is covered in module-gate.test.ts.
vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

// Service stub: getById returns a booking in restaurant "rest-B"; mutations are
// spies so we can assert they never run when scope denies access.
const getById = vi.hoisted(() => vi.fn());
const cancelBooking = vi.hoisted(() => vi.fn());
const confirmCash = vi.hoisted(() => vi.fn());
const createSlot = vi.hoisted(() => vi.fn());
const batchCreateSlots = vi.hoisted(() => vi.fn());
const blockSlot = vi.hoisted(() => vi.fn());
const getSlot = vi.hoisted(() => vi.fn());
const deleteSlot = vi.hoisted(() => vi.fn());

vi.mock("../services/ServiceBookingService", () => ({
  MAX_BATCH_SLOT_CREATION_COUNT: 1000,
  ServiceBookingService: class {
    getById = getById;
    cancelBooking = cancelBooking;
    confirmCash = confirmCash;
    createSlot = createSlot;
    batchCreateSlots = batchCreateSlots;
    blockSlot = blockSlot;
    getSlot = getSlot;
    deleteSlot = deleteSlot;
  },
}));

import app from "./index";
import { ApiError } from "../../../shared/utils/api-error";

// The feature app is mounted under the global onError in production; replicate
// the ApiError → status mapping here so thrown forbidden()/notFound() surface as
// their real HTTP status instead of an unhandled 500.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

const BOOKING_B = {
  id: "bk-1",
  restaurantId: "rest-B",
  status: "confirmed",
};

beforeEach(() => {
  vi.clearAllMocks();
  getById.mockResolvedValue(BOOKING_B);
  cancelBooking.mockResolvedValue({ ...BOOKING_B, status: "cancelled" });
  confirmCash.mockResolvedValue({ ...BOOKING_B, status: "confirmed" });
  createSlot.mockResolvedValue({
    id: "slot-1",
    restaurantId: "rest-B",
    serviceItemId: 10,
    date: "2026-06-10",
    timeSlot: "10:00",
    maxCapacity: 2,
    currentBookings: 0,
    isAvailable: 1,
  });
  batchCreateSlots.mockResolvedValue({ created: 2, slots: [] });
  blockSlot.mockResolvedValue({
    id: "slot-1",
    restaurantId: "rest-B",
    serviceItemId: 10,
    date: "2026-06-10",
    timeSlot: "10:00",
    maxCapacity: 2,
    currentBookings: 0,
    isAvailable: 0,
  });
  getSlot.mockResolvedValue({ id: "slot-1", restaurantId: "rest-B" });
  deleteSlot.mockResolvedValue(undefined);
  auth.user = {
    id: "user-1",
    username: "owner",
    role: 1,
    restaurantId: "rest-A",
  };
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

describe("service-bookings staff route scoping", () => {
  it("forbids a non-admin from reading another restaurant's booking", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-A",
    };
    const res = await req("/bk-1");
    expect(res.status).toBe(403);
  });

  it("forbids a non-admin from cancelling another restaurant's booking", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-A",
    };
    const res = await req("/bk-1", "DELETE");
    expect(res.status).toBe(403);
    expect(cancelBooking).not.toHaveBeenCalled();
  });

  it("forbids a non-admin from confirming another restaurant's booking", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 4,
      restaurantId: "rest-A",
    };
    const res = await req("/bk-1/confirm-cash", "POST");
    expect(res.status).toBe(403);
    expect(confirmCash).not.toHaveBeenCalled();
  });

  it("allows a staff member to read their own restaurant's booking", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-B",
    };
    const res = await req("/bk-1");
    expect(res.status).toBe(200);
  });

  it("allows an admin (role 0) to act across restaurants", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 0,
      restaurantId: undefined,
    };
    const res = await req("/bk-1", "DELETE");
    expect(res.status).toBe(200);
    expect(cancelBooking).toHaveBeenCalledWith("bk-1");
  });

  it("forbids a non-admin from creating slots for another restaurant", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-A",
    };
    const res = await req("/slots", "POST", {
      restaurantId: "rest-B",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      maxCapacity: 2,
    });
    expect(res.status).toBe(403);
    expect(createSlot).not.toHaveBeenCalled();
  });

  it("allows a staff member to create slots for their own restaurant", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-B",
    };
    const res = await req("/slots", "POST", {
      restaurantId: "rest-B",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      maxCapacity: 2,
    });
    expect(res.status).toBe(201);
    expect(createSlot).toHaveBeenCalledWith({
      restaurantId: "rest-B",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      maxCapacity: 2,
      isAvailable: true,
    });
  });

  it("forbids a non-admin from batch creating slots for another restaurant", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-A",
    };
    const res = await req("/slots/batch", "POST", {
      restaurantId: "rest-B",
      serviceItemId: 10,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      timeSlots: ["10:00"],
      maxCapacity: 2,
    });
    expect(res.status).toBe(403);
    expect(batchCreateSlots).not.toHaveBeenCalled();
  });

  it("rejects batch slot creation when date count times time slots is too large", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-B",
    };
    const timeSlots = Array.from(
      { length: 96 },
      (_, index) =>
        `${String(Math.floor(index / 4)).padStart(2, "0")}:${String(
          (index % 4) * 15,
        ).padStart(2, "0")}`,
    );
    const res = await req("/slots/batch", "POST", {
      restaurantId: "rest-B",
      serviceItemId: 10,
      startDate: "2026-06-01",
      endDate: "2026-06-11",
      timeSlots,
      maxCapacity: 2,
    });

    expect(res.status).toBe(400);
    expect(batchCreateSlots).not.toHaveBeenCalled();
  });

  it("forbids a non-admin from blocking slots for another restaurant", async () => {
    auth.user = {
      id: "user-1",
      username: "owner",
      role: 1,
      restaurantId: "rest-A",
    };
    const res = await req("/slots/block", "POST", {
      restaurantId: "rest-B",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      blockReason: "holiday",
    });
    expect(res.status).toBe(403);
    expect(blockSlot).not.toHaveBeenCalled();
  });

  it("forbids a non-admin from deleting another restaurant's slot", async () => {
    const res = await req("/slots/slot-1", "DELETE");
    expect(res.status).toBe(403);
    expect(getSlot).toHaveBeenCalledWith("slot-1");
    expect(deleteSlot).not.toHaveBeenCalled();
  });

  it("lets an owner delete a slot of their own restaurant", async () => {
    getSlot.mockResolvedValue({ id: "slot-1", restaurantId: "rest-A" });
    const res = await req("/slots/slot-1", "DELETE");
    expect(res.status).toBe(200);
    expect(deleteSlot).toHaveBeenCalledWith("slot-1");
  });

  it("returns 404 for a slot that does not exist", async () => {
    getSlot.mockResolvedValue(null);
    const res = await req("/slots/missing", "DELETE");
    expect(res.status).toBe(404);
    expect(deleteSlot).not.toHaveBeenCalled();
  });
});
