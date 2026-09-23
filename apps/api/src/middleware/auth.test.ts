import { Hono } from "hono";
import type { ErrorHandler } from "hono";
import { sign } from "hono/jwt";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sign as signJsonWebToken } from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../shared/utils/api-error";
import {
  authMiddleware,
  canonicalCustomerAuthMiddleware,
  customerAuthMiddleware,
  customerOrderAuthMiddleware,
  optionalAuth,
  optionalCanonicalCustomerAuthMiddleware,
  requireRole,
  requireRestaurantAccess,
  verifyJwtToken,
} from "./auth";
import type { AuthUser } from "./auth";

const JWT_SECRET = "test-jwt-secret-with-at-least-32-chars";

const apiErrorHandler: ErrorHandler = (error, c) => {
  if (error instanceof ApiError) {
    return c.json(
      { success: false, error: { code: error.code, message: error.message } },
      error.status as ContentfulStatusCode,
    );
  }
  throw error;
};

const staffUserId = "018f0000-0000-7000-8000-000000000777";

function createStaffDb(row: Record<string, unknown> | null) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => row),
      })),
    })),
  };
}

function createCustomerDb(row: Record<string, unknown> | null) {
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  return {
    run,
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => (sql.includes("FROM customers") ? row : null)),
        run,
      })),
    })),
  };
}

async function staffToken(role: number) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: staffUserId,
      username: `role-${role}`,
      role,
      restaurantId: "rest-1",
      tv: 1,
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
  );
}

async function adminTokenWithoutRestaurant() {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: staffUserId,
      username: "admin",
      role: 0,
      restaurantId: null,
      tv: 1,
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
  );
}

async function staffPublicIdToken(role: number) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: staffUserId,
      username: `role-${role}`,
      role,
      restaurantId: "rest-1",
      tv: 1,
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
  );
}

async function customerToken(sub = "customer-1") {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub,
      type: "customer",
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
  );
}

async function customerBindingToken() {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      type: "customer_bind",
      provider: "line",
      providerUid: "line-user-1",
      iat: now,
      exp: now + 600,
    },
    JWT_SECRET,
  );
}

function strictAtob(encoded: string): string {
  if (encoded.length % 4 !== 0) {
    throw new DOMException(
      "atob() called with invalid base64-encoded data",
      "InvalidCharacterError",
    );
  }

  return Buffer.from(encoded, "base64").toString("binary");
}

describe("authMiddleware", () => {
  it("accepts active staff tokens and attaches the user", async () => {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/protected", authMiddleware);
    app.get("/protected", (c) => c.json({ user: c.get("user") }));

    const response = await app.fetch(
      new Request("https://api.test/protected", {
        headers: { Authorization: `Bearer ${await staffToken(1)}` },
      }),
      {
        JWT_SECRET,
        DB: createStaffDb({
          id: staffUserId,
          username: "role-1",
          role: 1,
          restaurant_id: "rest-db",
          is_active: 1,
          token_version: 1,
        }),
      } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      user: {
        id: staffUserId,
        publicId: staffUserId,
        role: 1,
        restaurantId: "rest-db",
      },
    });
    expect(response.status).toBe(200);
  });

  it("accepts jsonwebtoken-signed login tokens when atob requires padded base64", async () => {
    const originalAtob = globalThis.atob;
    vi.stubGlobal("atob", strictAtob);
    try {
      const now = Math.floor(Date.now() / 1000);
      const token = signJsonWebToken(
        {
          sub: staffUserId,
          username: "role-1",
          role: 1,
          restaurantId: "rest-1",
          tv: 1,
          iat: now,
          exp: now + 3600,
        },
        JWT_SECRET,
        { algorithm: "HS256" },
      );

      const app = new Hono();
      app.onError(apiErrorHandler);
      app.use("/protected", authMiddleware);
      app.get("/protected", (c) => c.json({ user: c.get("user") }));

      const response = await app.fetch(
        new Request("https://api.test/protected", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        {
          JWT_SECRET,
          DB: createStaffDb({
            id: staffUserId,
            username: "role-1",
            role: 1,
            restaurant_id: "rest-db",
            is_active: 1,
            token_version: 1,
          }),
        } as never,
      );

      await expect(response.json()).resolves.toMatchObject({
        user: {
          id: staffUserId,
          publicId: staffUserId,
          role: 1,
          restaurantId: "rest-db",
        },
      });
      expect(response.status).toBe(200);
    } finally {
      vi.stubGlobal("atob", originalAtob);
    }
  });

  it("accepts UUID-principal staff tokens and attaches the legacy user id", async () => {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/protected", authMiddleware);
    app.get("/protected", (c) => c.json({ user: c.get("user") }));

    const response = await app.fetch(
      new Request("https://api.test/protected", {
        headers: { Authorization: `Bearer ${await staffPublicIdToken(1)}` },
      }),
      {
        JWT_SECRET,
        DB: createStaffDb({
          id: staffUserId,
          username: "role-1",
          role: 1,
          restaurant_id: "rest-db",
          is_active: 1,
          token_version: 1,
        }),
      } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      user: {
        id: staffUserId,
        publicId: staffUserId,
        role: 1,
        restaurantId: "rest-db",
      },
    });
    expect(response.status).toBe(200);
  });

  it("accepts platform admin tokens without a restaurant", async () => {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/protected", authMiddleware);
    app.get("/protected", (c) => c.json({ user: c.get("user") }));

    const response = await app.fetch(
      new Request("https://api.test/protected", {
        headers: {
          Authorization: `Bearer ${await adminTokenWithoutRestaurant()}`,
        },
      }),
      {
        JWT_SECRET,
        DB: createStaffDb({
          id: staffUserId,
          username: "admin",
          role: 0,
          restaurant_id: null,
          is_active: 1,
          token_version: 1,
        }),
      } as never,
    );

    const body = await response.json<{ user: AuthUser | null }>();

    expect(body).toMatchObject({
      user: {
        id: staffUserId,
        publicId: staffUserId,
        role: 0,
      },
    });
    expect(body.user).not.toHaveProperty("restaurantId");
    expect(response.status).toBe(200);
  });

  it("rejects legacy role 5 customer tokens on staff routes", async () => {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/protected", authMiddleware);
    app.get("/protected", (c) => c.json({ ok: true }));

    const response = await app.fetch(
      new Request("https://api.test/protected", {
        headers: { Authorization: `Bearer ${await staffToken(5)}` },
      }),
      { JWT_SECRET, DB: createStaffDb(null) } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TOKEN_INVALID" },
    });
    expect(response.status).toBe(401);
  });

  it("allows legacy role 5 tokens through customerAuthMiddleware", async () => {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/customer", customerAuthMiddleware);
    app.get("/customer", (c) => c.json({ user: c.get("user") }));

    const response = await app.fetch(
      new Request("https://api.test/customer", {
        headers: { Authorization: `Bearer ${await staffToken(5)}` },
      }),
      {
        JWT_SECRET,
        DB: createStaffDb({
          id: staffUserId,
          username: "role-5",
          role: 5,
          restaurant_id: null,
          is_active: 1,
          token_version: 1,
        }),
      } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      user: { id: staffUserId, publicId: staffUserId, role: 5 },
    });
    expect(response.status).toBe(200);
  });
});

describe("requireRestaurantAccess", () => {
  function appWithUser(user: AuthUser) {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/restaurants/:restaurantId/*", (c, next) => {
      c.set("user", user);
      return next();
    });
    app.use("/restaurants/:restaurantId/*", requireRestaurantAccess());
    app.get("/restaurants/:restaurantId/menu", (c) => c.json({ ok: true }));
    return app;
  }

  it("SaaS mode: allows an owner to access their own restaurant", async () => {
    const app = appWithUser({
      id: staffUserId,
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    });

    const response = await app.fetch(
      new Request("https://api.test/restaurants/rest-1/menu"),
      { DEPLOYMENT_MODE: "saas" } as never,
    );

    expect(response.status).toBe(200);
  });

  it("SaaS mode: denies an owner accessing a different restaurant", async () => {
    const app = appWithUser({
      id: staffUserId,
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    });

    const response = await app.fetch(
      new Request("https://api.test/restaurants/rest-2/menu"),
      { DEPLOYMENT_MODE: "saas" } as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("SaaS mode: lets a platform admin bypass the restaurant check", async () => {
    const app = appWithUser({
      id: staffUserId,
      username: "admin",
      role: 0,
      restaurantId: undefined,
    });

    const response = await app.fetch(
      new Request("https://api.test/restaurants/rest-2/menu"),
      { DEPLOYMENT_MODE: "saas" } as never,
    );

    expect(response.status).toBe(200);
  });

  it("independent mode: allows access to the configured tenant only", async () => {
    const app = appWithUser({
      id: staffUserId,
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    });

    const response = await app.fetch(
      new Request("https://api.test/restaurants/tenant-a/menu"),
      { DEPLOYMENT_MODE: "independent", TENANT_ID: "tenant-a" } as never,
    );

    expect(response.status).toBe(200);
  });

  it("independent mode: denies any restaurantId other than the configured tenant, even for an admin", async () => {
    const app = appWithUser({
      id: staffUserId,
      username: "admin",
      role: 0,
      restaurantId: undefined,
    });

    const response = await app.fetch(
      new Request("https://api.test/restaurants/tenant-b/menu"),
      { DEPLOYMENT_MODE: "independent", TENANT_ID: "tenant-a" } as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("independent mode: denies every request when TENANT_ID is not configured", async () => {
    const app = appWithUser({
      id: staffUserId,
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    });

    const response = await app.fetch(
      new Request("https://api.test/restaurants/rest-1/menu"),
      { DEPLOYMENT_MODE: "independent" } as never,
    );

    expect(response.status).toBe(403);
  });
});

describe("requireRole", () => {
  function appWithUser(user: AuthUser) {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/protected", (c, next) => {
      c.set("user", user);
      return next();
    });
    app.use("/protected", requireRole([0, 1, 2, 3, 4]));
    app.get("/protected", (c) => c.json({ ok: true }));
    return app;
  }

  it.each([1, 2, 3, 4])(
    "denies a tenant-scoped role without a restaurant assignment (role %i)",
    async (role) => {
      const app = appWithUser({
        id: staffUserId,
        username: "unassigned-staff",
        role,
        restaurantId: undefined,
      });

      const response = await app.fetch(
        new Request("https://api.test/protected"),
        {} as never,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "FORBIDDEN" },
      });
    },
  );

  it("denies a tenant-scoped role with a blank restaurant assignment", async () => {
    const app = appWithUser({
      id: staffUserId,
      username: "unassigned-owner",
      role: 1,
      restaurantId: "  ",
    });

    const response = await app.fetch(
      new Request("https://api.test/protected"),
      {} as never,
    );

    expect(response.status).toBe(403);
  });

  it("allows a platform admin without a restaurant assignment", async () => {
    const app = appWithUser({
      id: staffUserId,
      username: "admin",
      role: 0,
      restaurantId: undefined,
    });

    const response = await app.fetch(
      new Request("https://api.test/protected"),
      {} as never,
    );

    expect(response.status).toBe(200);
  });
});

describe("verifyJwtToken", () => {
  it("rejects expired tokens by default", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJsonWebToken(
      {
        sub: staffUserId,
        username: "role-1",
        role: 1,
        iat: now - 7200,
        exp: now - 3600,
      },
      JWT_SECRET,
      { algorithm: "HS256" },
    );

    expect(() => verifyJwtToken(token, JWT_SECRET)).toThrow("jwt expired");
  });
});

describe("canonicalCustomerAuthMiddleware", () => {
  it("accepts canonical customer tokens and refreshes last_seen", async () => {
    const db = createCustomerDb({
      id: "customer-1",
      display_name: "Ada",
      primary_phone: "0912345678",
      primary_email: null,
      status: "active",
    });
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/me", canonicalCustomerAuthMiddleware);
    app.get("/me", (c) => c.json({ customer: c.get("customer") }));

    const response = await app.fetch(
      new Request("https://api.test/me", {
        headers: { Authorization: `Bearer ${await customerToken()}` },
      }),
      { JWT_SECRET, DB: db } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      customer: { id: "customer-1", displayName: "Ada" },
    });
    expect(db.run).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it("rejects customer binding tokens", async () => {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/me", canonicalCustomerAuthMiddleware);
    app.get("/me", (c) => c.json({ customer: c.get("customer") }));

    const response = await app.fetch(
      new Request("https://api.test/me", {
        headers: { Authorization: `Bearer ${await customerBindingToken()}` },
      }),
      { JWT_SECRET, DB: createCustomerDb(null) } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TOKEN_INVALID" },
    });
    expect(response.status).toBe(401);
  });
});

describe("customerOrderAuthMiddleware", () => {
  it("accepts canonical customer sessions on the member order path", async () => {
    const db = createCustomerDb({
      id: "customer-1",
      display_name: "Ada",
      primary_phone: "0912345678",
      primary_email: null,
      status: "active",
    });
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/orders", customerOrderAuthMiddleware);
    app.post("/orders", (c) =>
      c.json({ user: c.get("user"), customer: c.get("customer") }),
    );

    const response = await app.fetch(
      new Request("https://api.test/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${await customerToken()}` },
      }),
      { JWT_SECRET, DB: db } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      user: { id: "customer-1", role: 5 },
      customer: { id: "customer-1", displayName: "Ada" },
    });
    expect(response.status).toBe(200);
  });

  it("continues accepting legacy role-5 sessions on the member order path", async () => {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.use("/orders", customerOrderAuthMiddleware);
    app.post("/orders", (c) => c.json({ user: c.get("user") }));

    const response = await app.fetch(
      new Request("https://api.test/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${await staffToken(5)}` },
      }),
      {
        JWT_SECRET,
        DB: createStaffDb({
          id: staffUserId,
          username: "role-5",
          role: 5,
          restaurant_id: null,
          is_active: 1,
          token_version: 1,
        }),
      } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      user: { id: staffUserId, role: 5 },
    });
    expect(response.status).toBe(200);
  });
});

describe("optionalAuth", () => {
  function activeStaffRow(overrides: Record<string, unknown> = {}) {
    return {
      id: staffUserId,
      username: "role-1",
      role: 1,
      restaurant_id: "rest-db",
      is_active: 1,
      token_version: 1,
      ...overrides,
    };
  }

  function publicApp() {
    const app = new Hono();
    app.use("/public", optionalAuth);
    app.get("/public", (c) => c.json({ user: c.get("user") ?? null }));
    return app;
  }

  async function expiredStaffToken(role: number) {
    const now = Math.floor(Date.now() / 1000);
    return sign(
      {
        sub: staffUserId,
        username: `role-${role}`,
        role,
        restaurantId: "rest-1",
        tv: 1,
        iat: now - 7200,
        exp: now - 3600,
      },
      JWT_SECRET,
    );
  }

  async function fetchPublic(
    token: string,
    row: Record<string, unknown> | null,
  ) {
    const response = await publicApp().fetch(
      new Request("https://api.test/public", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { JWT_SECRET, DB: createStaffDb(row) } as never,
    );
    return {
      response,
      body: await response.json<{ user: AuthUser | null }>(),
    };
  }

  it("attaches the user for a valid active staff token", async () => {
    const { response, body } = await fetchPublic(
      await staffToken(1),
      activeStaffRow(),
    );

    expect(response.status).toBe(200);
    expect(body.user).toMatchObject({
      id: staffUserId,
      role: 1,
      restaurantId: "rest-db",
    });
  });

  it("stays anonymous for an expired staff token", async () => {
    const { response, body } = await fetchPublic(
      await expiredStaffToken(1),
      activeStaffRow(),
    );

    expect(response.status).toBe(200);
    expect(body.user).toBeNull();
  });

  it("stays anonymous when the staff account has been deactivated", async () => {
    const { response, body } = await fetchPublic(
      await staffToken(1),
      activeStaffRow({ is_active: 0 }),
    );

    expect(response.status).toBe(200);
    expect(body.user).toBeNull();
  });

  it("stays anonymous when the token version has been revoked", async () => {
    const { response, body } = await fetchPublic(
      await staffToken(1),
      activeStaffRow({ token_version: 2 }),
    );

    expect(response.status).toBe(200);
    expect(body.user).toBeNull();
  });

  it("stays anonymous when the staff principal no longer exists", async () => {
    const { response, body } = await fetchPublic(await staffToken(1), null);

    expect(response.status).toBe(200);
    expect(body.user).toBeNull();
  });

  it("stays anonymous when no Authorization header is present", async () => {
    const response = await publicApp().fetch(
      new Request("https://api.test/public"),
      { JWT_SECRET, DB: createStaffDb(activeStaffRow()) } as never,
    );

    await expect(response.json()).resolves.toEqual({ user: null });
    expect(response.status).toBe(200);
  });
});

describe("optionalCanonicalCustomerAuthMiddleware", () => {
  it("continues anonymously when the bearer token is not canonical customer JWT", async () => {
    const app = new Hono();
    app.use("/public", optionalCanonicalCustomerAuthMiddleware);
    app.get("/public", (c) =>
      c.json({ hasCustomer: Boolean(c.get("customer")) }),
    );

    const response = await app.fetch(
      new Request("https://api.test/public", {
        headers: { Authorization: `Bearer ${await staffToken(1)}` },
      }),
      { JWT_SECRET, DB: createCustomerDb(null) } as never,
    );

    await expect(response.json()).resolves.toEqual({ hasCustomer: false });
    expect(response.status).toBe(200);
  });
});
