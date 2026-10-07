import { describe, expect, it, vi } from "vitest";
import { checkRealtimeRateLimit, rateLimitResponse } from "./rateLimiter";

function buildLimiter(success = true) {
  return { limit: vi.fn(async () => ({ success })) };
}

describe("checkRealtimeRateLimit", () => {
  it("keys attempts by room type and client address, never by room id", async () => {
    const limiter = buildLimiter();
    const request = new Request("https://realtime.example/customer/t1", {
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });

    await expect(
      checkRealtimeRateLimit(
        request,
        { WS_CONNECT_RATE_LIMITER: limiter },
        "customer",
      ),
    ).resolves.toBe(true);
    expect(limiter.limit).toHaveBeenCalledOnce();
    expect(limiter.limit).toHaveBeenCalledWith({
      key: "customer:203.0.113.10",
    });
  });

  it("rejects when the binding reports the bucket is spent", async () => {
    const limiter = buildLimiter(false);
    const request = new Request("https://realtime.example/admin/r1");

    await expect(
      checkRealtimeRateLimit(
        request,
        { WS_CONNECT_RATE_LIMITER: limiter },
        "admin",
      ),
    ).resolves.toBe(false);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "admin:unknown" });
  });

  it("allows every attempt when the binding is absent", async () => {
    const request = new Request("https://realtime.example/customer/t1");

    await expect(checkRealtimeRateLimit(request, {}, "customer")).resolves.toBe(
      true,
    );
  });

  it("answers 429 with a Retry-After matching the binding period", async () => {
    const response = rateLimitResponse();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({
      code: "REALTIME_RATE_LIMITED",
    });
  });
});
