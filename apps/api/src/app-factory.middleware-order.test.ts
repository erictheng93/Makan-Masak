import { beforeEach, describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./shared/utils/meter", () => ({ meterEmit }));

import { createApp } from "./app-factory";

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

describe("createApp API middleware registration", () => {
  beforeEach(() => {
    meterEmit.mockClear();
  });

  it("protects mounted coupon writes with CSRF and meters the request", async () => {
    const app = createApp(undefined, {
      disableEdgeCache: true,
      disableObservability: true,
    });

    const response = await app.fetch(
      new Request("https://api.test/api/v1/coupons", {
        method: "POST",
        headers: {
          Host: "api.test",
          Origin: "https://api.test",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
      { NODE_ENV: "test" } as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "CSRF_TOKEN_MISSING",
        message: "CSRF token is required for this request",
      },
    });
    // meterEmit no longer takes per-request metadata (#333), so the path is
    // asserted on the context it was handed rather than on an options bag.
    expect(meterEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.objectContaining({ path: "/api/v1/coupons" }),
      }),
      "api.requests",
    );
  });

  it("lets a fresh admin request a password reset while keeping reset protected", async () => {
    const app = createApp(undefined, {
      disableEdgeCache: true,
      disableObservability: true,
    });
    const env = { NODE_ENV: "test" } as never;
    const request = (path: string) =>
      new Request(`https://api.test/api/v1/auth/${path}`, {
        method: "POST",
        headers: { Host: "api.test", "Content-Type": "application/json" },
        body: "{}",
      });

    const forgot = await app.fetch(request("forgot-password"), env);
    expect(forgot.status).toBe(400);
    await expect(forgot.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    const reset = await app.fetch(request("reset-password"), env);
    expect(reset.status).toBe(403);
    await expect(reset.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST_ORIGIN" },
    });
  });

  it("keeps CORS headers on global rate limit 429 responses", async () => {
    const app = createApp(undefined, {
      disableEdgeCache: true,
      disableObservability: true,
    });
    const origin = "https://customer.makanmasak.com";
    const nativeLimiter = {
      limit: vi.fn(async () => ({ success: false })),
    } as unknown as RateLimit;

    const response = await app.fetch(
      new Request("https://api.test/api/v1/menu", {
        headers: {
          Origin: origin,
          "CF-Connecting-IP": "203.0.113.10",
        },
      }),
      {
        NODE_ENV: "production",
        CORS_ORIGIN: origin,
        GLOBAL_RATE_LIMITER: nativeLimiter,
      } as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-RateLimit-Remaining",
    );
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded",
        requestId: expect.any(String),
      },
    });
  });
});
