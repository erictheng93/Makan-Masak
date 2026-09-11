import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

const drizzleMocks = vi.hoisted(() => ({
  db: { select: vi.fn() },
}));
const serviceMocks = vi.hoisted(() => ({
  listPublicReviews: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => drizzleMocks.db),
}));

vi.mock("../services/ReviewService", () => ({
  ReviewService: function ReviewService() {
    return serviceMocks;
  },
}));

import { restaurants } from "@makanmasak/database";
import { createSelectFixtureDb } from "@makanmasak/database/testing";
import routes from "./public";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

const RESTAURANT_ID = "01900000-0000-7000-8000-0000000000a1";

const page = {
  reviews: [
    {
      id: "review-1",
      rating: 5,
      content: "好吃",
      createdAt: 1760000000000,
      authorName: "王**",
      reply: null,
    },
  ],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
};

/** `restaurants` is the only table this route reads directly (the existence check). */
function mockRestaurantRows(...queue: (unknown[] | Error)[]) {
  const fixtureDb = createSelectFixtureDb(
    { restaurants },
    { restaurants: queue },
  );
  drizzleMocks.db.select.mockImplementation(fixtureDb.select);
}

function call(path: string) {
  return routes.fetch(new Request(`https://restaurants.test${path}`), {
    DB: {},
  } as unknown as Env);
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
  mockRestaurantRows([{ id: RESTAURANT_ID }]);
  serviceMocks.listPublicReviews.mockResolvedValue(page);
});

describe("GET /:id/reviews", () => {
  it("returns the public list with no authentication at all", async () => {
    const res = await call(`/${RESTAURANT_ID}/reviews`);

    expect(res.status).toBe(200);
    await expect(readJson(res)).resolves.toEqual({ success: true, data: page });
    expect(serviceMocks.listPublicReviews).toHaveBeenCalledOnce();
    // Defaults: the public list is shorter than the owner's.
    expect(serviceMocks.listPublicReviews).toHaveBeenCalledWith(
      RESTAURANT_ID,
      1,
      10,
    );
  });

  it("passes the requested page and size through", async () => {
    const res = await call(`/${RESTAURANT_ID}/reviews?page=3&limit=25`);

    expect(res.status).toBe(200);
    expect(serviceMocks.listPublicReviews).toHaveBeenCalledWith(
      RESTAURANT_ID,
      3,
      25,
    );
  });

  it("answers 404 for an unknown restaurant rather than an empty page", async () => {
    // An id that returns 200 for anything is indistinguishable from a typo.
    mockRestaurantRows([]);

    const res = await call(`/${RESTAURANT_ID}/reviews`);

    expect(res.status).toBe(404);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "RESTAURANT_NOT_FOUND" },
    });
    expect(serviceMocks.listPublicReviews).not.toHaveBeenCalled();
  });

  it("refuses a page size above the public ceiling", async () => {
    const res = await call(`/${RESTAURANT_ID}/reviews?limit=200`);

    expect(res.status).toBe(400);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(serviceMocks.listPublicReviews).not.toHaveBeenCalled();
  });

  it("accepts the TEXT restaurant id the platform actually hands out", async () => {
    // commonSchemas.idParam still requires digits; this route must not.
    const res = await call("/shop-abc/reviews");

    expect(res.status).toBe(200);
    expect(serviceMocks.listPublicReviews).toHaveBeenCalledWith(
      "shop-abc",
      1,
      10,
    );
  });
});
