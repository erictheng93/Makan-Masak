import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  attachCSRFToken,
  csrfProtection,
  generateCSRFTokenHandler,
} from "./csrf";
import { ApiError } from "../shared/utils/api-error";

const CSRF_TOKEN = "a".repeat(64);

function installApiErrorHandler(app: Hono) {
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        error.status as never,
      );
    }
    throw error;
  });
}

function createApp() {
  const app = new Hono();
  app.use("*", csrfProtection({ useDoubleSubmit: true }));
  app.put("/api/v1/orders/:id/status", (c) =>
    c.json({ success: true, orderId: c.req.param("id") }),
  );
  installApiErrorHandler(app);
  return app;
}

describe("csrfProtection", () => {
  it("allows configured development frontend origins before token validation", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://api.test/api/v1/orders/42/status", {
        method: "PUT",
        headers: {
          Host: "api.test",
          Origin: "http://localhost:3001",
          "Content-Type": "application/json",
          "X-CSRF-Token": CSRF_TOKEN,
          Cookie: `csrf_token=${CSRF_TOKEN}`,
        },
        body: JSON.stringify({ status: "confirmed" }),
      }),
      { NODE_ENV: "development" },
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      orderId: "42",
    });
    expect(response.status).toBe(200);
  });

  it("allows explicit development frontend origins before token validation", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://api.test/api/v1/orders/42/status", {
        method: "PUT",
        headers: {
          Host: "api.test",
          Origin: "http://localhost:3011",
          "Content-Type": "application/json",
          "X-CSRF-Token": CSRF_TOKEN,
          Cookie: `csrf_token=${CSRF_TOKEN}`,
        },
        body: JSON.stringify({ status: "confirmed" }),
      }),
      {
        NODE_ENV: "development",
        DEV_CORS_ORIGINS: "http://localhost:3011",
      },
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      orderId: "42",
    });
    expect(response.status).toBe(200);
  });

  it("sets a host-only CSRF cookie the browser can read back", async () => {
    const app = new Hono();
    app.get("/csrf", generateCSRFTokenHandler);

    const response = await app.fetch(new Request("https://api.test/csrf"), {
      NODE_ENV: "production",
    });
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("__Host-mm_csrf=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");

    // Double-submit needs document.cookie to see this value. Marking it
    // HttpOnly silently disabled the client's post-reload fallback and left
    // every state-changing request 403ing after a page load (#66).
    expect(setCookie).not.toContain("HttpOnly");
  });

  it("returns the unified error envelope when a CSRF token is missing", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://api.test/api/v1/orders/42/status", {
        method: "PUT",
        headers: {
          Host: "api.test",
          Origin: "https://api.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "confirmed" }),
      }),
      { NODE_ENV: "production" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "CSRF_TOKEN_MISSING",
        message: "CSRF token is required for this request",
      },
    });
  });

  it("returns the unified error envelope for invalid request origins", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://api.test/api/v1/orders/42/status", {
        method: "PUT",
        headers: {
          Host: "api.test",
          Origin: "https://evil.test",
          "Content-Type": "application/json",
          "X-CSRF-Token": CSRF_TOKEN,
          Cookie: `csrf_token=${CSRF_TOKEN}`,
        },
        body: JSON.stringify({ status: "confirmed" }),
      }),
      { NODE_ENV: "production" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "INVALID_REQUEST_ORIGIN",
        message: "Request origin does not match expected host",
      },
    });
  });
});

describe("attachCSRFToken", () => {
  // This is the middleware actually mounted on /auth/*, and it is the only
  // thing that hands a token to a browser. The header seeds the client's
  // in-memory cache; the cookie is the fallback after a reload. If the two
  // ever carry different values, or the cookie stops being readable,
  // double-submit fails closed and every post-reload write 403s (#66).
  async function issueToken() {
    const app = new Hono();
    app.use("/auth/*", attachCSRFToken());
    app.post("/auth/login", (c) => c.json({ success: true }));

    return app.fetch(
      new Request("https://api.test/auth/login", { method: "POST" }),
      { NODE_ENV: "production" },
    );
  }

  it("returns the same token in the header and the cookie", async () => {
    const response = await issueToken();

    const header = response.headers.get("x-csrf-token");
    const cookieValue = (response.headers.get("set-cookie") ?? "").match(
      /__Host-mm_csrf=([^;]+)/,
    )?.[1];

    expect(header).toMatch(/^[a-f0-9]{64}$/);
    expect(cookieValue).toBe(header);
  });

  it("leaves the cookie readable so the post-reload fallback works", async () => {
    const response = await issueToken();

    expect(response.headers.get("set-cookie")).not.toContain("HttpOnly");
  });

  it("outlives the refresh cookie it has to travel with", async () => {
    const response = await issueToken();

    // Restoring a session posts to /auth/refresh, which is CSRF protected. A
    // CSRF cookie shorter-lived than __Host-mm_staff_refresh (7 days) meant a
    // valid refresh cookie could not be spent after an hour idle (#66).
    const maxAge = Number(
      (response.headers.get("set-cookie") ?? "").match(/Max-Age=(\d+)/)?.[1],
    );

    expect(maxAge).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
  });
});

describe("csrfProtection excludePaths", () => {
  /**
   * Regression coverage for the exclusion patterns added when CSRF was moved
   * ahead of the feature mounts. Public customer flows (join a waiting list,
   * book, pay) carry no session cookie and must stay reachable, but the staff
   * routes that live under the same prefixes must NOT be swept in with them —
   * a bare "/api/v1/waiting-list" prefix would have exempted POST /:id/call.
   */
  function appWithExclusions() {
    const app = new Hono();
    app.use(
      "*",
      csrfProtection({
        useDoubleSubmit: true,
        excludePaths: [
          "/api/v1/waiting-list$",
          "/api/v1/waiting-list/*$",
          "/api/v1/waiting-list/*/confirm",
        ],
        excludeRoutes: [
          {
            path: "/api/v1/reservations/*/cancel$",
            methods: ["DELETE"],
          },
        ],
      }),
    );
    app.post("/api/v1/waiting-list", (c) => c.json({ ok: "join" }));
    app.delete("/api/v1/waiting-list/:id", (c) => c.json({ ok: "cancel" }));
    app.post("/api/v1/waiting-list/:id/confirm", (c) =>
      c.json({ ok: "confirm" }),
    );
    app.post("/api/v1/waiting-list/:id/call", (c) => c.json({ ok: "call" }));
    app.post("/api/v1/waiting-list/:id/seat", (c) => c.json({ ok: "seat" }));
    app.delete("/api/v1/reservations/:id/cancel", (c) =>
      c.json({ ok: "customer-cancel" }),
    );
    app.post("/api/v1/reservations/:id/cancel", (c) =>
      c.json({ ok: "staff-cancel" }),
    );
    installApiErrorHandler(app);
    return app;
  }

  function post(app: Hono, path: string, method = "POST") {
    return app.fetch(
      new Request(`https://api.test${path}`, {
        method,
        headers: { Host: "api.test", "Content-Type": "application/json" },
        body: "{}",
      }),
      { NODE_ENV: "production" } as never,
    );
  }

  it("exempts the public join and confirm routes", async () => {
    const app = appWithExclusions();

    expect((await post(app, "/api/v1/waiting-list")).status).toBe(200);
    expect((await post(app, "/api/v1/waiting-list/42/confirm")).status).toBe(
      200,
    );
  });

  /**
   * The diner's own cancel. It sits at the feature root with an id and no
   * further segment, which neither "/api/v1/waiting-list$" (exact, no id) nor
   * "/api/v1/waiting-list/*" (would also swallow /:id/call) can express —
   * production answered 403 CSRF_TOKEN_MISSING to every 取消候位.
   */
  it("exempts the diner cancelling their own ticket", async () => {
    const app = appWithExclusions();

    expect((await post(app, "/api/v1/waiting-list/42", "DELETE")).status).toBe(
      200,
    );
  });

  it("still protects the staff route under the same prefix", async () => {
    const app = appWithExclusions();

    // No CSRF token: an exact-match exclusion must not cascade to children.
    expect((await post(app, "/api/v1/waiting-list/42/call")).status).toBe(403);
    expect((await post(app, "/api/v1/waiting-list/42/seat")).status).toBe(403);
  });

  it("only exempts the public reservation cancellation method", async () => {
    const app = appWithExclusions();

    expect(
      (await post(app, "/api/v1/reservations/42/cancel", "DELETE")).status,
    ).toBe(200);
    expect(
      (await post(app, "/api/v1/reservations/42/cancel", "POST")).status,
    ).toBe(403);
  });
});
