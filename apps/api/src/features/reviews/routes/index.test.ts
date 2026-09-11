import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

const serviceMocks = vi.hoisted(() => ({
  listRestaurantReviews: vi.fn(),
  getRestaurantSummary: vi.fn(),
  replyToReview: vi.fn(),
}));

const authState = vi.hoisted((): { user: AuthUser | null } => ({
  user: null,
}));

/**
 * Only `authMiddleware` is stubbed, and only to skip JWT verification and the
 * user lookup it does against D1 — both of which have their own tests and are
 * driven end-to-end in `src/__tests__/integration/reviews.real.integration.test.ts`.
 *
 * `requireRole` is deliberately NOT stubbed. A passthrough stub silently
 * swallows the role gate, so no test could ever observe a role being rejected
 * — and the same stub is what makes a tenancy guard look covered while never
 * running (the reason `assertRestaurantScope` lives in the handler at all).
 * The real `requireRole` only reads `c.get("user")`, which the stub sets, so
 * leaving `authState.user` null models "no identity reached the handler" and
 * the 401 below comes from production code rather than from this file.
 */
vi.mock("../../../middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../middleware/auth")>();
  return {
    ...actual,
    authMiddleware: vi.fn(async (c, next) => {
      if (authState.user) c.set("user", authState.user);
      await next();
    }),
  };
});

vi.mock("../services/ReviewService", () => ({
  ReviewService: function ReviewService() {
    return serviceMocks;
  },
}));

import { authMiddleware } from "../../../middleware/auth";
import routes from "./index";

// Same shape as the app-factory's unified handler, minus sanitisation. Without
// it Hono's default handler flattens every thrown ApiError to a bare 500, which
// makes "rejected with 403 FORBIDDEN" and "blew up" indistinguishable.
routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

const OWNER: AuthUser = {
  id: "user-owner",
  publicId: "user-owner",
  username: "owner",
  role: 1,
  restaurantId: "restaurant-1",
};
const ADMIN: AuthUser = {
  id: "user-admin",
  publicId: "user-admin",
  username: "admin",
  role: 0,
  // A platform admin is assigned to no restaurant at all.
  restaurantId: undefined,
};
const CHEF: AuthUser = {
  id: "user-chef",
  publicId: "user-chef",
  username: "chef",
  role: 2,
  restaurantId: "restaurant-1",
};

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ...overrides,
  } as Env;
}

function call(
  path: string,
  options: { method?: string; body?: unknown; env?: Env } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  return routes.fetch(
    new Request(`https://reviews.test${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    options.env ?? createEnv(),
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
  authState.user = OWNER;
});

describe("reviews owner routes — mounting", () => {
  it("puts every route behind authMiddleware", () => {
    // Structural rather than behavioural: the stub above cannot prove a JWT is
    // required, but it can prove the route chain still contains the middleware
    // that requires one. A route added without it would fail here.
    const paths = [
      ["GET", "/:restaurantId"],
      ["GET", "/:restaurantId/summary"],
      ["POST", "/:restaurantId/:reviewId/reply"],
    ] as const;

    for (const [method, path] of paths) {
      const guarded = routes.routes.some(
        (route) =>
          route.method === method &&
          route.path === path &&
          route.handler === authMiddleware,
      );
      expect(guarded, `${method} ${path} is not behind authMiddleware`).toBe(
        true,
      );
    }
  });
});

describe("GET /:restaurantId", () => {
  it("lists the restaurant's reviews for its owner", async () => {
    const payload = {
      reviews: [{ id: "review-1", rating: 5 }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    serviceMocks.listRestaurantReviews.mockResolvedValue(payload);

    const res = await call("/restaurant-1");

    expect(res.status).toBe(200);
    await expect(readJson(res)).resolves.toEqual({
      success: true,
      data: payload,
    });
    expect(serviceMocks.listRestaurantReviews).toHaveBeenCalledOnce();
    expect(serviceMocks.listRestaurantReviews).toHaveBeenCalledWith(
      "restaurant-1",
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it("passes every filter through to the service, parsed", async () => {
    serviceMocks.listRestaurantReviews.mockResolvedValue({
      reviews: [],
      pagination: { page: 2, limit: 5, total: 0, totalPages: 0 },
    });

    const res = await call(
      "/restaurant-1?page=2&limit=5&rating=4&replied=false&from=1760000000000&to=1760086400000",
    );

    expect(res.status).toBe(200);
    expect(serviceMocks.listRestaurantReviews).toHaveBeenCalledWith(
      "restaurant-1",
      expect.objectContaining({
        page: 2,
        limit: 5,
        rating: 4,
        replied: false,
        from: 1760000000000,
        to: 1760086400000,
      }),
    );
  });

  it("treats a bare ?replied as 'replied', which is what a hand-serialised checkbox sends", async () => {
    serviceMocks.listRestaurantReviews.mockResolvedValue({
      reviews: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await call("/restaurant-1?replied=");

    expect(serviceMocks.listRestaurantReviews).toHaveBeenCalledWith(
      "restaurant-1",
      expect.objectContaining({ replied: true }),
    );
  });

  it("rejects an out-of-range rating filter before it reaches the service", async () => {
    const res = await call("/restaurant-1?rating=9");

    expect(res.status).toBe(400);
    await expect(readJson(res)).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(serviceMocks.listRestaurantReviews).not.toHaveBeenCalled();
  });

  it("rejects a request that carried no identity", async () => {
    authState.user = null;

    const res = await call("/restaurant-1");

    expect(res.status).toBe(401);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
    expect(serviceMocks.listRestaurantReviews).not.toHaveBeenCalled();
  });

  it("rejects a kitchen role: no staff role has a reviews surface", async () => {
    authState.user = CHEF;

    const res = await call("/restaurant-1");

    expect(res.status).toBe(403);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "INSUFFICIENT_ROLE" },
    });
    expect(serviceMocks.listRestaurantReviews).not.toHaveBeenCalled();
  });

  it("rejects an owner reaching for another restaurant", async () => {
    const res = await call("/restaurant-2");

    expect(res.status).toBe(403);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    expect(serviceMocks.listRestaurantReviews).not.toHaveBeenCalled();
  });

  it("lets an admin read any restaurant", async () => {
    authState.user = ADMIN;
    serviceMocks.listRestaurantReviews.mockResolvedValue({
      reviews: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await call("/restaurant-9");

    expect(res.status).toBe(200);
    expect(serviceMocks.listRestaurantReviews).toHaveBeenCalledWith(
      "restaurant-9",
      expect.objectContaining({ page: 1 }),
    );
  });

  describe("single-tenant deployments", () => {
    it("allow the one restaurant the deployment is for", async () => {
      serviceMocks.listRestaurantReviews.mockResolvedValue({
        reviews: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const res = await call("/restaurant-1", {
        env: createEnv({
          DEPLOYMENT_MODE: "independent",
          TENANT_ID: "restaurant-1",
        }),
      });

      expect(res.status).toBe(200);
    });

    it("refuse any other restaurant, admin included", async () => {
      authState.user = ADMIN;

      const res = await call("/restaurant-2", {
        env: createEnv({
          DEPLOYMENT_MODE: "independent",
          TENANT_ID: "restaurant-1",
        }),
      });

      expect(res.status).toBe(403);
      expect(serviceMocks.listRestaurantReviews).not.toHaveBeenCalled();
    });

    it("refuse everything when the deployment names no tenant", async () => {
      const res = await call("/restaurant-1", {
        env: createEnv({ DEPLOYMENT_MODE: "independent" }),
      });

      expect(res.status).toBe(403);
      expect(serviceMocks.listRestaurantReviews).not.toHaveBeenCalled();
    });
  });
});

describe("GET /:restaurantId/summary", () => {
  it("returns the distribution and the reply backlog", async () => {
    const summary = {
      average: 4.5,
      count: 2,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 1, "5": 1 },
      unrepliedCount: 1,
    };
    serviceMocks.getRestaurantSummary.mockResolvedValue(summary);

    const res = await call("/restaurant-1/summary");

    expect(res.status).toBe(200);
    await expect(readJson(res)).resolves.toEqual({
      success: true,
      data: summary,
    });
    expect(serviceMocks.getRestaurantSummary).toHaveBeenCalledOnce();
    expect(serviceMocks.getRestaurantSummary).toHaveBeenCalledWith(
      "restaurant-1",
    );
  });

  it("applies the same tenancy guard as the list", async () => {
    const res = await call("/restaurant-2/summary");

    expect(res.status).toBe(403);
    expect(serviceMocks.getRestaurantSummary).not.toHaveBeenCalled();
  });

  it("applies the same role gate as the list", async () => {
    authState.user = CHEF;

    const res = await call("/restaurant-1/summary");

    expect(res.status).toBe(403);
    expect(serviceMocks.getRestaurantSummary).not.toHaveBeenCalled();
  });
});

describe("POST /:restaurantId/:reviewId/reply", () => {
  it("attaches the reply and credits the replying user", async () => {
    const replied = { id: "review-1", reply: { content: "謝謝光臨" } };
    serviceMocks.replyToReview.mockResolvedValue(replied);

    const res = await call("/restaurant-1/review-1/reply", {
      method: "POST",
      body: { content: "謝謝光臨" },
    });

    expect(res.status).toBe(200);
    await expect(readJson(res)).resolves.toEqual({
      success: true,
      data: replied,
    });
    expect(serviceMocks.replyToReview).toHaveBeenCalledOnce();
    expect(serviceMocks.replyToReview).toHaveBeenCalledWith(
      "restaurant-1",
      "review-1",
      OWNER.id,
      "謝謝光臨",
    );
  });

  it("answers 404 when the review is not this restaurant's", async () => {
    // The service returns null for both "no such review" and "not yours";
    // saying which would confirm an id exists elsewhere.
    serviceMocks.replyToReview.mockResolvedValue(null);

    const res = await call("/restaurant-1/review-9/reply", {
      method: "POST",
      body: { content: "謝謝光臨" },
    });

    expect(res.status).toBe(404);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "REVIEW_NOT_FOUND" },
    });
  });

  it("rejects an empty reply", async () => {
    const res = await call("/restaurant-1/review-1/reply", {
      method: "POST",
      body: { content: "   " },
    });

    expect(res.status).toBe(400);
    await expect(readJson(res)).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(serviceMocks.replyToReview).not.toHaveBeenCalled();
  });

  it("rejects a reply longer than the shared ceiling", async () => {
    const res = await call("/restaurant-1/review-1/reply", {
      method: "POST",
      body: { content: "字".repeat(1001) },
    });

    expect(res.status).toBe(400);
    expect(serviceMocks.replyToReview).not.toHaveBeenCalled();
  });

  it("applies the tenancy guard before writing anything", async () => {
    const res = await call("/restaurant-2/review-1/reply", {
      method: "POST",
      body: { content: "偷回覆" },
    });

    expect(res.status).toBe(403);
    expect(serviceMocks.replyToReview).not.toHaveBeenCalled();
  });

  it("applies the role gate before writing anything", async () => {
    authState.user = CHEF;

    const res = await call("/restaurant-1/review-1/reply", {
      method: "POST",
      body: { content: "回覆" },
    });

    expect(res.status).toBe(403);
    expect(serviceMocks.replyToReview).not.toHaveBeenCalled();
  });
});
