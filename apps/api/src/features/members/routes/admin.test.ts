import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";
import app from "./admin";
import { ApiError } from "../../../shared/utils/api-error";

const CUSTOMER_ID = "01972f31-05a2-7b8c-a4f8-0000000000c1";

const mocks = vi.hoisted(() => ({
  currentUser: {
    id: "admin-1",
    username: "platform",
    role: 0,
    restaurantId: null,
  } as unknown as AuthUser,
  list: vi.fn(),
  get: vi.fn(),
  listRestaurants: vi.fn(),
  revealContact: vi.fn(),
  enforcePiiRevealThrottle: vi.fn(),
}));

/**
 * `admin.ts` carries no `authMiddleware` of its own -- it is mounted under the
 * `/admin/*` prefix that already ran it, and every route declares
 * `requireRole([0])`. Standing in for that prefix is what puts `user` on the
 * context here, so these tests say nothing about whether role 0 is actually
 * enforced; that is the prefix's job and the real-integration suite's.
 * Validation stays real, because the request schemas are most of what these
 * handlers do.
 */
vi.mock("../../../middleware/auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../../middleware/auth")
  >("../../../middleware/auth");
  return {
    ...actual,
    requireRole: () => async (c: Context, next: Next) => {
      c.set("user", mocks.currentUser);
      await next();
    },
  };
});

vi.mock("@makanmasak/database", () => ({
  PlatformCustomerDirectoryService: vi.fn(
    function PlatformCustomerDirectoryService() {
      return {
        list: mocks.list,
        get: mocks.get,
        listRestaurants: mocks.listRestaurants,
        revealContact: mocks.revealContact,
      };
    },
  ),
}));

vi.mock("../services/pii-reveal-throttle", () => ({
  enforcePiiRevealThrottle: mocks.enforcePiiRevealThrottle,
}));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409 | 429,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function createEnv() {
  return { DB: {} };
}

async function readError(response: Response) {
  return (await response.json()) as {
    success: false;
    error: { code: string; message: string };
  };
}

async function readData<T>(response: Response) {
  return (await response.json()) as { success: true; data: T };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforcePiiRevealThrottle.mockResolvedValue(undefined);
});

describe("platform customer directory", () => {
  it("reshapes the service result into a pagination envelope", async () => {
    mocks.list.mockResolvedValue({
      customers: [{ customerId: CUSTOMER_ID }],
      total: 1,
      page: 1,
      limit: 100,
      pages: 1,
    });

    const response = await app.fetch(
      new Request("https://test/?page=1&limit=100&sort=spent"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: [{ customerId: CUSTOMER_ID }],
      pagination: { total: 1, page: 1, limit: 100, pages: 1 },
    });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 100, sort: "spent" }),
    );
  });

  it("rejects a sort the directory cannot order by", async () => {
    const response = await app.fetch(
      new Request("https://test/?sort=whatever"),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns one customer", async () => {
    mocks.get.mockResolvedValue({ customerId: CUSTOMER_ID, status: "active" });

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}`),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(
      (await readData<{ customerId: string }>(response)).data.customerId,
    ).toBe(CUSTOMER_ID);
    expect(mocks.get).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("404s a customer that does not exist", async () => {
    mocks.get.mockResolvedValue(null);

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}`),
      createEnv() as never,
    );

    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("CUSTOMER_NOT_FOUND");
  });

  it("returns the cross-tenant spend slices no tenant endpoint may produce", async () => {
    mocks.listRestaurants.mockResolvedValue([
      { restaurantId: "r-1", totalSpentCents: 900 },
    ]);

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/restaurants`),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(
      (await readData<Array<{ restaurantId: string }>>(response)).data,
    ).toHaveLength(1);
    expect(mocks.listRestaurants).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("404s the restaurant slices of a customer that does not exist", async () => {
    // `null` and `[]` mean different things here: no such customer versus a
    // customer who has never ordered anywhere. Only the first is a 404.
    mocks.listRestaurants.mockResolvedValue(null);

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/restaurants`),
      createEnv() as never,
    );

    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("CUSTOMER_NOT_FOUND");
  });

  it("distinguishes a customer with no orders from one that is missing", async () => {
    mocks.listRestaurants.mockResolvedValue([]);

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/restaurants`),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect((await readData<unknown[]>(response)).data).toEqual([]);
  });
});

describe("platform reveal-contact", () => {
  it("reveals contact details and audits the actor's request headers", async () => {
    mocks.revealContact.mockResolvedValue({
      outcome: "revealed",
      contact: {
        customerId: CUSTOMER_ID,
        phone: "0912345678",
        email: "a@example.com",
      },
    });

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/reveal-contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.9",
          "User-Agent": "vitest",
        },
        body: JSON.stringify({ reason: "billing dispute" }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    const body = await readData<{ phone: string; revealedAt: number }>(
      response,
    );
    expect(body.data.phone).toBe("0912345678");
    expect(typeof body.data.revealedAt).toBe("number");
    expect(mocks.revealContact).toHaveBeenCalledWith(
      CUSTOMER_ID,
      {
        userId: "admin-1",
        ipAddress: "203.0.113.9",
        userAgent: "vitest",
      },
      "billing dispute",
    );
  });

  it("audits null actor headers when the request carries none", async () => {
    mocks.revealContact.mockResolvedValue({
      outcome: "revealed",
      contact: { customerId: CUSTOMER_ID, phone: null, email: null },
    });

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/reveal-contact`, {
        method: "POST",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    // The audit row is the record of who copied customer contact data out; a
    // missing proxy header must land as null, not the string "undefined".
    expect(mocks.revealContact).toHaveBeenCalledWith(
      CUSTOMER_ID,
      { userId: "admin-1", ipAddress: null, userAgent: null },
      undefined,
    );
  });

  it("404s a reveal against a customer that does not exist", async () => {
    mocks.revealContact.mockResolvedValue({ outcome: "not-found" });

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/reveal-contact`, {
        method: "POST",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("CUSTOMER_NOT_FOUND");
  });

  it("does not reveal contact details for a deleted customer", async () => {
    mocks.revealContact.mockResolvedValue({ outcome: "deleted" });

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/reveal-contact`, {
        method: "POST",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("CUSTOMER_DELETED");
  });

  it("rejects a reason too short to be a justification", async () => {
    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/reveal-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "x" }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    expect(mocks.revealContact).not.toHaveBeenCalled();
  });

  it("never reaches the service when the throttle rejects", async () => {
    mocks.enforcePiiRevealThrottle.mockRejectedValue(
      new ApiError("RATE_LIMIT_EXCEEDED", "Too many reveals", 429),
    );

    const response = await app.fetch(
      new Request(`https://test/${CUSTOMER_ID}/reveal-contact`, {
        method: "POST",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(429);
    expect(mocks.revealContact).not.toHaveBeenCalled();
  });
});
