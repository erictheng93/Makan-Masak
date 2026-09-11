import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AuthCustomer } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

const drizzleMocks = vi.hoisted(() => ({
  db: { select: vi.fn() },
}));
const serviceMocks = vi.hoisted(() => ({
  resolveOrderItems: vi.fn(),
  submitOrderReview: vi.fn(),
  getOrderReview: vi.fn(),
}));
const identityMocks = vi.hoisted(() => ({
  resolveOrderIdentity: vi.fn(),
}));
const authState = vi.hoisted((): { customer: AuthCustomer | null } => ({
  customer: null,
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => drizzleMocks.db),
}));

/**
 * Only the optional customer middleware is stubbed, and only to skip JWT
 * verification plus the customer lookup it does against D1. Everything the
 * route actually decides — which of the two accepted identities owns this
 * order — lives in `authorizeOrderReviewer` and runs for real here, including
 * the guest-token comparison against KV. `getGuestBearerToken` is likewise not
 * stubbed: it is what decides whether a bearer token is a guest token at all,
 * and stubbing it would let a staff JWT be mistaken for one.
 */
vi.mock("../../../middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../middleware/auth")>();
  return {
    ...actual,
    optionalCanonicalCustomerAuthMiddleware: vi.fn(async (c, next) => {
      if (authState.customer) c.set("customer", authState.customer);
      await next();
    }),
  };
});

vi.mock("../../../shared/services/order-identity", () => ({
  resolveOrderIdentity: identityMocks.resolveOrderIdentity,
}));

vi.mock("../services/ReviewService", () => ({
  ReviewService: function ReviewService() {
    return serviceMocks;
  },
}));

import { orders } from "@makanmasak/database";
import { createSelectFixtureDb } from "@makanmasak/database/testing";
import routes from "./order-reviews";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

const ORDER_ID = "01900000-0000-7000-8000-000000000001";
const CUSTOMER: AuthCustomer = {
  id: "01900000-0000-7000-8000-0000000000c1",
  displayName: "王小明",
  status: "active",
};
const GUEST_TOKEN = `gt_${"b".repeat(64)}`;
const CUSTOMER_JWT = "Bearer eyJhbGciOiJIUzI1NiJ9.stub.signature";

const orderRow = {
  id: ORDER_ID,
  restaurantId: "restaurant-1",
  status: "delivered",
  customerId: CUSTOMER.id,
};

/**
 * `orders` is the only table the route reads directly (the ownership lookup);
 * the queue is positional within that table, so one entry per request.
 * A missing or exhausted fixture throws and names the table rather than
 * quietly resolving to `[]`.
 */
function mockOrderRows(...queue: (unknown[] | Error)[]) {
  const fixtureDb = createSelectFixtureDb({ orders }, { orders: queue });
  drizzleMocks.db.select.mockImplementation(fixtureDb.select);
}

function createEnv(kv: Record<string, unknown> = {}) {
  const values = new Map(
    Object.entries(kv).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  const get = vi.fn(async (key: string, _type?: string) => {
    const raw = values.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  });
  return {
    env: { DB: {}, CACHE_KV: { get } } as unknown as Env,
    kvGet: get,
  };
}

function call(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    authorization?: string;
    env?: Env;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.authorization) headers.authorization = options.authorization;

  return routes.fetch(
    new Request(`https://orders.test${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    options.env ?? createEnv().env,
  );
}

async function readJson(res: Response) {
  return (await res.json()) as {
    success: boolean;
    data?: unknown;
    error?: { code?: string; message?: string };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.customer = null;
  identityMocks.resolveOrderIdentity.mockResolvedValue({
    id: ORDER_ID,
    publicId: ORDER_ID,
    orderNumber: "ORD-1",
    restaurantId: "restaurant-1",
  });
  serviceMocks.resolveOrderItems.mockResolvedValue([]);
  mockOrderRows([orderRow]);
});

describe("authorising the reviewer", () => {
  it("refuses a request with no credentials at all", async () => {
    const res = await call(`/${ORDER_ID}/review`);

    expect(res.status).toBe(401);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "MISSING_AUTH_TOKEN" },
    });
    // The order is never even looked up: an anonymous caller must not be able
    // to probe which order ids exist.
    expect(identityMocks.resolveOrderIdentity).not.toHaveBeenCalled();
  });

  it("resolves an order number the same way the tracking routes do", async () => {
    authState.customer = CUSTOMER;
    serviceMocks.getOrderReview.mockResolvedValue({ id: "review-1" });

    const res = await call("/ORD-1/review", {
      authorization: CUSTOMER_JWT,
    });

    expect(res.status).toBe(200);
    expect(identityMocks.resolveOrderIdentity).toHaveBeenCalledWith(
      expect.anything(),
      "ORD-1",
      expect.objectContaining({ requireRestaurantForAliases: false }),
    );
    // The resolved id, not the alias the caller typed, is what reaches the
    // service.
    expect(serviceMocks.getOrderReview).toHaveBeenCalledWith(ORDER_ID);
  });

  it("answers 404 for an identifier that matches no order", async () => {
    identityMocks.resolveOrderIdentity.mockRejectedValue(
      new ApiError("ORDER_NOT_FOUND", "Order not found", 404),
    );

    const res = await call("/ORD-nope/review", {
      authorization: CUSTOMER_JWT,
    });

    expect(res.status).toBe(404);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "ORDER_NOT_FOUND" },
    });
  });

  it("answers 404 when the identifier resolves but the row has since gone", async () => {
    mockOrderRows([]);

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: CUSTOMER_JWT,
    });

    expect(res.status).toBe(404);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "ORDER_NOT_FOUND" },
    });
  });

  it("refuses a signed-in diner who did not place this order", async () => {
    authState.customer = { ...CUSTOMER, id: "some-other-customer" };

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: CUSTOMER_JWT,
    });

    expect(res.status).toBe(403);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "ORDER_ACCESS_DENIED" },
    });
  });

  it("refuses a signed-in diner on a guest order, which belongs to nobody", async () => {
    authState.customer = CUSTOMER;
    mockOrderRows([{ ...orderRow, customerId: null }]);

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: CUSTOMER_JWT,
    });

    expect(res.status).toBe(403);
  });

  it("accepts the guest holding this order's token", async () => {
    const { env, kvGet } = createEnv({
      [`guest_token:${GUEST_TOKEN}`]: {
        orderId: ORDER_ID,
        restaurantId: "restaurant-1",
      },
    });
    mockOrderRows([{ ...orderRow, customerId: null }]);
    serviceMocks.getOrderReview.mockResolvedValue({ id: "review-1" });

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: `Bearer ${GUEST_TOKEN}`,
      env,
    });

    expect(res.status).toBe(200);
    expect(kvGet).toHaveBeenCalledWith(`guest_token:${GUEST_TOKEN}`, "json");
  });

  it("refuses a guest token that has expired out of KV", async () => {
    mockOrderRows([{ ...orderRow, customerId: null }]);

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: `Bearer ${GUEST_TOKEN}`,
    });

    expect(res.status).toBe(403);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "ORDER_ACCESS_DENIED" },
    });
  });

  it("refuses a guest token minted for a different order", async () => {
    const { env } = createEnv({
      [`guest_token:${GUEST_TOKEN}`]: {
        orderId: "01900000-0000-7000-8000-00000000ffff",
        restaurantId: "restaurant-1",
      },
    });
    mockOrderRows([{ ...orderRow, customerId: null }]);

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: `Bearer ${GUEST_TOKEN}`,
      env,
    });

    // Possession of a token for a different order is not a weaker form of
    // access to this one.
    expect(res.status).toBe(403);
  });

  it("refuses a bearer token that is neither a customer JWT nor a guest token", async () => {
    const { env, kvGet } = createEnv();
    mockOrderRows([{ ...orderRow, customerId: null }]);

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: "Bearer staff-access-token",
      env,
    });

    expect(res.status).toBe(403);
    // A staff token must not even be looked up as a guest token.
    expect(kvGet).not.toHaveBeenCalled();
  });
});

describe("POST /:id/review", () => {
  const submitted = {
    id: "review-1",
    orderId: ORDER_ID,
    rating: 4,
    items: [],
  };

  beforeEach(() => {
    authState.customer = CUSTOMER;
    serviceMocks.submitOrderReview.mockResolvedValue(submitted);
  });

  it("resolves the rated dishes against the order, then writes the review", async () => {
    serviceMocks.resolveOrderItems.mockResolvedValue([
      { menuItemId: 7, rating: 5 },
    ]);

    const res = await call(`/${ORDER_ID}/review`, {
      method: "POST",
      authorization: CUSTOMER_JWT,
      body: {
        rating: 4,
        content: "上菜很快",
        items: [{ menuItemId: 7, rating: 5 }],
      },
    });

    expect(res.status).toBe(201);
    await expect(readJson(res)).resolves.toEqual({
      success: true,
      data: submitted,
    });

    expect(serviceMocks.resolveOrderItems).toHaveBeenCalledOnce();
    expect(serviceMocks.resolveOrderItems).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ items: [{ menuItemId: 7, rating: 5 }] }),
    );
    expect(serviceMocks.submitOrderReview).toHaveBeenCalledOnce();
    expect(serviceMocks.submitOrderReview).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORDER_ID, restaurantId: "restaurant-1" }),
      expect.objectContaining({
        rating: 4,
        content: "上菜很快",
        items: [{ menuItemId: 7, rating: 5 }],
        customerId: CUSTOMER.id,
      }),
    );
  });

  it("accepts the legacy body the customer app already sends", async () => {
    const res = await call(`/${ORDER_ID}/review`, {
      method: "POST",
      authorization: CUSTOMER_JWT,
      body: {
        rating: 5,
        comment: "很好吃",
        itemRatings: [{ orderItemId: 12, rating: 4, comment: "還行" }],
      },
    });

    expect(res.status).toBe(201);
    expect(serviceMocks.resolveOrderItems).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({
        itemRatings: [{ orderItemId: 12, rating: 4, comment: "還行" }],
      }),
    );
    expect(serviceMocks.submitOrderReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: "很好吃" }),
    );
  });

  it("prefers content over comment when a client sends both", async () => {
    await call(`/${ORDER_ID}/review`, {
      method: "POST",
      authorization: CUSTOMER_JWT,
      body: { rating: 5, content: "canonical", comment: "legacy" },
    });

    expect(serviceMocks.submitOrderReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: "canonical" }),
    );
  });

  it("stores no text when neither field is sent", async () => {
    await call(`/${ORDER_ID}/review`, {
      method: "POST",
      authorization: CUSTOMER_JWT,
      body: { rating: 5 },
    });

    expect(serviceMocks.submitOrderReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: null }),
    );
  });

  it("attributes a guest review to whoever the order already named", async () => {
    authState.customer = null;
    const { env } = createEnv({
      [`guest_token:${GUEST_TOKEN}`]: {
        orderId: ORDER_ID,
        restaurantId: "restaurant-1",
      },
    });
    mockOrderRows([{ ...orderRow, customerId: null }]);

    await call(`/${ORDER_ID}/review`, {
      method: "POST",
      authorization: `Bearer ${GUEST_TOKEN}`,
      body: { rating: 5 },
      env,
    });

    expect(serviceMocks.submitOrderReview).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: null }),
      expect.objectContaining({ customerId: null }),
    );
  });

  it("rejects a rating outside 1-5 before touching the order", async () => {
    const res = await call(`/${ORDER_ID}/review`, {
      method: "POST",
      authorization: CUSTOMER_JWT,
      body: { rating: 0 },
    });

    expect(res.status).toBe(400);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(serviceMocks.submitOrderReview).not.toHaveBeenCalled();
  });

  it("rejects more rated dishes than any order could hold", async () => {
    const res = await call(`/${ORDER_ID}/review`, {
      method: "POST",
      authorization: CUSTOMER_JWT,
      body: {
        rating: 5,
        items: Array.from({ length: 51 }, (_, index) => ({
          menuItemId: index + 1,
          rating: 5,
        })),
      },
    });

    expect(res.status).toBe(400);
    expect(serviceMocks.submitOrderReview).not.toHaveBeenCalled();
  });

  it("lets a service refusal through with its own status", async () => {
    serviceMocks.submitOrderReview.mockRejectedValue(
      new ApiError(
        "ORDER_NOT_REVIEWABLE",
        "Only a completed order can be reviewed",
        409,
        { status: "pending" },
      ),
    );

    const res = await call(`/${ORDER_ID}/review`, {
      method: "POST",
      authorization: CUSTOMER_JWT,
      body: { rating: 5 },
    });

    expect(res.status).toBe(409);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "ORDER_NOT_REVIEWABLE" },
    });
  });
});

describe("GET /:id/review", () => {
  beforeEach(() => {
    authState.customer = CUSTOMER;
  });

  it("returns the review this diner left", async () => {
    const review = { id: "review-1", rating: 4, reply: null };
    serviceMocks.getOrderReview.mockResolvedValue(review);

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: CUSTOMER_JWT,
    });

    expect(res.status).toBe(200);
    await expect(readJson(res)).resolves.toEqual({
      success: true,
      data: review,
    });
    expect(serviceMocks.getOrderReview).toHaveBeenCalledOnce();
    expect(serviceMocks.getOrderReview).toHaveBeenCalledWith(ORDER_ID);
  });

  it("answers 404 when the order has not been reviewed", async () => {
    serviceMocks.getOrderReview.mockResolvedValue(null);

    const res = await call(`/${ORDER_ID}/review`, {
      authorization: CUSTOMER_JWT,
    });

    expect(res.status).toBe(404);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "REVIEW_NOT_FOUND" },
    });
  });
});
