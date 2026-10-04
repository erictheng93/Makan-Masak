import { staffAuthDatabase } from "../__tests__/staff-auth-fixture";
import { describe, expect, it } from "vitest";
import { sign } from "hono/jwt";
import { Hono } from "hono";
import analyticsRouter from "./analytics";
import type { Env } from "../types/env";

const JWT_SECRET = "test-jwt-secret-with-at-least-32-chars";
const ADMIN_UUID = "01890a5d-ac96-774b-bcce-b302099a8057";

async function adminToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: ADMIN_UUID,
      username: "admin",
      role: 0,
      restaurantId: null,
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
  );
}

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/analytics", analyticsRouter);
  return app;
}

describe("GET /analytics/export", () => {
  it("returns 501 Not Implemented with the worker error shape (no fabricated URL)", async () => {
    const app = buildApp();
    const token = await adminToken();

    const response = await app.fetch(
      new Request("https://images.test/analytics/export?format=json", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { JWT_SECRET, DB: staffAuthDatabase() } as unknown as Env,
    );

    expect(response.status).toBe(501);
    const body = (await response.json()) as {
      success: boolean;
      error: string;
      data?: unknown;
    };
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
    // The old stub fabricated a download_url on a domain this worker never serves.
    expect(body).not.toHaveProperty("data");
    expect(JSON.stringify(body)).not.toContain("download_url");
    expect(JSON.stringify(body)).not.toContain("makanmasak.com");
  });
});
