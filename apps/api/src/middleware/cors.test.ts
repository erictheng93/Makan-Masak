import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { corsMiddleware } from "./cors";

function createApp() {
  const app = new Hono();
  app.use("*", corsMiddleware);
  app.get("/api/v1/menu/:restaurantId", (c) =>
    c.json({ success: true, restaurantId: c.req.param("restaurantId") }),
  );
  return app;
}

describe("corsMiddleware", () => {
  it("allows customer app client headers during browser preflight", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://api.test/api/v1/menu/restaurant-1", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3001",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": [
            "content-type",
            "x-client-version",
            "x-client-platform",
            "x-request-id",
            "x-restaurant-id",
            "x-table-id",
            "x-guest-device-id",
          ].join(", "),
        },
      }),
      {
        NODE_ENV: "development",
      },
    );

    const allowedHeaders = response.headers
      .get("Access-Control-Allow-Headers")
      ?.toLowerCase();

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3001",
    );
    expect(allowedHeaders).toContain("x-client-version");
    expect(allowedHeaders).toContain("x-client-platform");
    expect(allowedHeaders).toContain("x-request-id");
    expect(allowedHeaders).toContain("x-restaurant-id");
    expect(allowedHeaders).toContain("x-table-id");
    expect(allowedHeaders).toContain("x-guest-device-id");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-Request-ID",
    );
  });

  it("allows the payment idempotency key and the till headers during preflight", async () => {
    const app = createApp();

    // CashierView settles through POST /payments with an Idempotency-Key and
    // names the till on refunds. Refusing any of these in the preflight means
    // the request is never sent, which the page can only report as
    // "Network Error".
    const response = await app.fetch(
      new Request("https://api.test/api/v1/payments", {
        method: "OPTIONS",
        headers: {
          Origin: "https://admin.makanmasak.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "authorization, content-type, idempotency-key, x-csrf-token, x-register-id, x-shift-id",
        },
      }),
      {
        NODE_ENV: "production",
        CORS_ORIGIN: "https://admin.makanmasak.com",
      },
    );

    const allowedHeaders = response.headers
      .get("Access-Control-Allow-Headers")
      ?.toLowerCase()
      .split(",")
      .map((header) => header.trim());

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://admin.makanmasak.com",
    );
    expect(allowedHeaders).toEqual(
      expect.arrayContaining([
        "idempotency-key",
        "x-register-id",
        "x-shift-id",
      ]),
    );
  });

  it("does not send a browser policy that disables same-origin QR scanning", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://api.test/api/v1/menu/restaurant-1", {
        headers: {
          Origin: "https://makanmasak.com",
        },
      }),
      {
        NODE_ENV: "production",
      },
    );

    const permissionsPolicy = response.headers.get("Permissions-Policy");

    expect(permissionsPolicy).toContain("camera=(self)");
    expect(permissionsPolicy).not.toContain("camera=()");
  });
});
