import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  AdvancedAnalyticsService,
  advancedAnalyticsMiddleware,
} from "./analytics";
import type { Env } from "../types/env";

describe("AdvancedAnalyticsService", () => {
  it("skips recording when Analytics Engine is not bound", async () => {
    const waitUntil = vi.fn();
    const service = new AdvancedAnalyticsService(
      undefined,
      { waitUntil } as unknown as ExecutionContext,
      {} as never,
    );

    await service.recordEvent({
      event: "api_request",
      dimensions: {},
      metrics: {},
    });

    expect(waitUntil).not.toHaveBeenCalled();
  });

  // Regression: this passed 20 indexes, so the runtime threw
  // `writeDataPoint(): Maximum of 1 indexes supported` on every request and the
  // dataset silently received nothing for as long as the code shipped. The
  // throw was caught and logged, so it never surfaced as a failure.
  it("writes exactly one index, keyed on restaurant", async () => {
    const writeDataPoint = vi.fn();
    const service = new AdvancedAnalyticsService(
      { writeDataPoint } as never,
      { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext,
      {} as never,
    );

    await service.recordEvent({
      event: "api_request",
      restaurant_id: 42,
      dimensions: { endpoint: "/api/v1/menu", status_code: "200" },
      metrics: { response_time: 120 },
    });

    expect(writeDataPoint).toHaveBeenCalledOnce();
    const [payload] = writeDataPoint.mock.calls[0] as [
      { indexes: string[]; blobs: string[]; doubles: number[] },
    ];
    expect(payload.indexes).toEqual(["42"]);
    expect(payload.indexes).toHaveLength(1);

    // The dimensions the query side reads must stay where it expects them:
    // blob1 event, blob8 endpoint, blob10 status, double2 response time.
    expect(payload.blobs[0]).toBe("api_request");
    expect(payload.blobs[7]).toBe("/api/v1/menu");
    expect(payload.blobs[9]).toBe("200");
    expect(payload.doubles[1]).toBe(120);
    expect(payload.blobs).toHaveLength(20);
    expect(payload.blobs.slice(15)).toEqual(Array(5).fill("unknown"));
  });

  it("falls back to a zero index when no restaurant is in scope", async () => {
    const writeDataPoint = vi.fn();
    const service = new AdvancedAnalyticsService(
      { writeDataPoint } as never,
      { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext,
      {} as never,
    );

    await service.recordEvent({
      event: "api_request",
      dimensions: {},
      metrics: {},
    });

    const [payload] = writeDataPoint.mock.calls[0] as [{ indexes: string[] }];
    expect(payload.indexes).toEqual(["0"]);
  });
});

describe("placement request analytics (#369)", () => {
  async function recordRequest(
    cf?: Record<string, unknown>,
    headers: Record<string, string> = {},
    binding: "ANALYTICS" | "ANALYTICS_ENGINE" = "ANALYTICS",
  ) {
    const writeDataPoint = vi.fn();
    const pending: Promise<unknown>[] = [];
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", advancedAnalyticsMiddleware());
    app.get("/api/v1/orders", (c) => {
      c.header("X-Cache", "BYPASS");
      return c.json({ success: true });
    });
    const request = new Request("https://example.test/api/v1/orders", {
      headers,
    });
    if (cf) Object.defineProperty(request, "cf", { value: cf });
    const response = await app.fetch(
      request,
      { [binding]: { writeDataPoint } } as unknown as Env,
      {
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      } as unknown as ExecutionContext,
    );
    await Promise.all(pending);
    expect(response.status).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledOnce();
    return writeDataPoint.mock.calls[0][0] as {
      blobs: string[];
      doubles: number[];
      indexes: string[];
    };
  }

  it.each(["ANALYTICS", "ANALYTICS_ENGINE"] as const)(
    "records CF geography and distinguishes probes through %s",
    async (binding) => {
      const payload = await recordRequest(
        { country: "TW", colo: "SJC", asn: 3462 },
        {
          "CF-IPCountry": "US",
          "cf-placement": "remote-NRT",
          "User-Agent": "MakanMasak-Placement-Probe/369 baseline",
        },
        binding,
      );
      expect(payload.blobs[0]).toBe("api_request");
      expect(payload.blobs[3]).toBe("TW");
      expect(payload.blobs[7]).toBe("/api/v1/orders");
      expect(payload.blobs[9]).toBe("200");
      expect(payload.blobs.slice(15)).toEqual([
        "SJC",
        "3462",
        "remote-NRT",
        "probe",
        "BYPASS",
      ]);
      expect(payload.blobs).toHaveLength(20);
      expect(payload.doubles).toHaveLength(20);
      expect(payload.indexes).toEqual(["0"]);
    },
  );

  it("keeps local requests working without CF metadata or headers", async () => {
    const payload = await recordRequest();
    expect(payload.blobs[3]).toBe("unknown");
    expect(payload.blobs.slice(15)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "organic",
      "BYPASS",
    ]);
  });

  it("falls back to country header and rejects invalid ASN/placement values", async () => {
    const payload = await recordRequest(
      { asn: -1 },
      { "CF-IPCountry": "MY", "cf-placement": "arbitrary-client-input" },
    );
    expect(payload.blobs[3]).toBe("MY");
    expect(payload.blobs[16]).toBe("unknown");
    expect(payload.blobs[17]).toBe("unknown");
  });
});
