import { describe, expect, it, vi } from "vitest";
import type { RealtimeAuthPayload } from "@makanmasak/shared-types";
import {
  checkClientRateLimit,
  checkIpRateLimit,
  clientRateLimitKey,
  rateLimitResponse,
} from "./rateLimiter";

function buildLimiter(success = true) {
  return { limit: vi.fn(async () => ({ success })) };
}

function buildPayload(
  overrides: Partial<RealtimeAuthPayload> = {},
): RealtimeAuthPayload {
  return {
    roomType: "customer",
    roomId: "order:o1",
    restaurantId: "r1",
    role: "customer",
    exp: 0,
    iat: 0,
    ...overrides,
  } as RealtimeAuthPayload;
}

describe("checkIpRateLimit", () => {
  it("keys the flood ceiling by client address alone", async () => {
    const limiter = buildLimiter();
    const request = new Request("https://realtime.example/customer/t1", {
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });

    await expect(
      checkIpRateLimit(request, { WS_IP_RATE_LIMITER: limiter }),
    ).resolves.toBe(true);
    expect(limiter.limit).toHaveBeenCalledOnce();
    expect(limiter.limit).toHaveBeenCalledWith({ key: "203.0.113.10" });
  });

  it("rejects when the binding reports the bucket is spent", async () => {
    const limiter = buildLimiter(false);

    await expect(
      checkIpRateLimit(new Request("https://realtime.example/admin/r1"), {
        WS_IP_RATE_LIMITER: limiter,
      }),
    ).resolves.toBe(false);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "unknown" });
  });

  it("allows every attempt when the binding is absent", async () => {
    await expect(
      checkIpRateLimit(new Request("https://realtime.example/customer/t1"), {}),
    ).resolves.toBe(true);
  });
});

describe("checkClientRateLimit", () => {
  it("gives two guests on one IP separate budgets", () => {
    const first = buildPayload({ roomId: "order:o1" });
    const second = buildPayload({ roomId: "order:o2" });

    expect(clientRateLimitKey(first)).not.toBe(clientRateLimitKey(second));
  });

  it.each([
    [{ sid: "s1", userId: "u1" }, "s1"],
    [{ memberId: "m1", seatId: "seat-1" }, "m1"],
    [{ seatId: "seat-1" }, "seat-1"],
    [{ userId: "u1" }, "u1"],
    [{}, "guest"],
  ])("names the client from %o", (fields, who) => {
    expect(clientRateLimitKey(buildPayload(fields))).toBe(
      `customer:order:o1:${who}`,
    );
  });

  it("checks the client key against the binding", async () => {
    const limiter = buildLimiter(false);

    await expect(
      checkClientRateLimit(buildPayload({ sid: "s1" }), {
        WS_CLIENT_RATE_LIMITER: limiter,
      }),
    ).resolves.toBe(false);
    expect(limiter.limit).toHaveBeenCalledWith({
      key: "customer:order:o1:s1",
    });
  });

  it("allows every attempt when the binding is absent", async () => {
    await expect(checkClientRateLimit(buildPayload(), {})).resolves.toBe(true);
  });
});

describe("rateLimitResponse", () => {
  it("answers 429 with a Retry-After matching the binding period", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = rateLimitResponse("ip");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(console.warn).toHaveBeenCalledWith("Realtime connect rate limited", {
      layer: "ip",
    });
    await expect(response.json()).resolves.toMatchObject({
      code: "REALTIME_RATE_LIMITED",
    });
  });
});
