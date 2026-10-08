import { describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./shared/utils/meter", () => ({ meterEmit }));

import { createApp } from "./app-factory";

/**
 * The feature-adoption registry test asserts a gate is registered for each
 * prefix by reading the source. That proves the wiring exists; it does not
 * prove a request is actually refused. These go through the real app.
 */
function request(
  path: string,
  env: Record<string, string> = {},
  method = "GET",
) {
  const app = createApp(undefined, {
    disableEdgeCache: true,
    disableObservability: true,
  });

  return app.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers: { Host: "api.test" },
    }),
    { NODE_ENV: "test", ...env } as never,
  );
}

describe("unlaunched feature gates", () => {
  // A gate registered as "/x/*" has to refuse "/x" as well, or the bare-prefix
  // route slips through -- POST /api/v1/market-checkouts, the endpoint that
  // starts the whole flow, is exactly that shape.
  it("refuses the bare prefix, not just sub-paths", async () => {
    const bare = await request("/api/v1/credits");
    const sub = await request("/api/v1/credits/anything");

    expect(bare.status).toBe(404);
    expect(sub.status).toBe(404);
    await expect(bare.json()).resolves.toMatchObject({
      error: { code: "ROUTE_NOT_FOUND" },
    });
  });

  // Registered ahead of every auth middleware, so an unlaunched feature reads
  // as absent rather than as protected. /backup sits behind authMiddleware and
  // would otherwise answer 401 -- telling an anonymous caller that a feature
  // nobody has launched exists and needs credentials.
  it("refuses a feature that defaults off, before auth can answer 401", async () => {
    for (const path of ["/api/v1/backup/list", "/api/v1/credits/topup"]) {
      const response = await request(path);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "ROUTE_NOT_FOUND" },
      });
    }
  });

  it("stops refusing once the flag turns the feature on", async () => {
    const path = "/api/v1/credits/topup-webhooks/stripe";

    expect((await request(path, {}, "POST")).status).toBe(404);

    // Past the gate now: the route exists, so whatever it answers -- CSRF,
    // validation, anything -- it is no longer the gate's 404.
    const opened = await request(
      path,
      { STORED_VALUE_CREDITS_ENABLED: "true" },
      "POST",
    );
    expect(opened.status).not.toBe(404);
  });

  it("refuses a default-on feature once its flag is turned off", async () => {
    const paths = [
      "/api/v1/market-checkouts/some-id",
      "/api/v1/pos/market-checkouts/some-id/pay",
    ];

    for (const path of paths) {
      expect((await request(path, {}, "POST")).status).not.toBe(404);
      expect(
        (await request(path, { MARKET_CHECKOUTS_ENABLED: "false" }, "POST"))
          .status,
      ).toBe(404);
    }
  });

  it("refuses the service-booking credit payment route by default", async () => {
    const path = "/api/v1/service-bookings/some-id/pay";

    expect((await request(path, {}, "POST")).status).toBe(404);
    expect(
      (await request(path, { STORED_VALUE_CREDITS_ENABLED: "true" }, "POST"))
        .status,
    ).not.toBe(404);
  });

  // Customer subscriptions need their own flag so missing customer delivery
  // configuration does not disable staff push in /push.
  it("keeps customer push off while leaving staff push independently enabled", async () => {
    const path = "/api/v1/customer/push-subscriptions";

    // Behind customer auth, so without the gate this answers 401, not 404.
    expect((await request(path)).status).toBe(404);

    const enabled = await request(path, {
      CUSTOMER_WEB_PUSH_ENABLED: "true",
    });
    expect(enabled.status).not.toBe(404);

    const staffPath = "/api/v1/push/subscribe";
    expect(
      (await request(staffPath, { CUSTOMER_WEB_PUSH_ENABLED: "false" }, "POST"))
        .status,
    ).not.toBe(404);

    const disabledStaff = await request(
      staffPath,
      {
        WEB_PUSH_ENABLED: "false",
      },
      "POST",
    );
    expect(disabledStaff.status).toBe(404);
    await expect(disabledStaff.json()).resolves.toMatchObject({
      error: { code: "ROUTE_NOT_FOUND" },
    });
  });

  it("leaves the rest of the customer routes alone", async () => {
    // Gating one sub-path must not take the whole customer feature down.
    const response = await request("/api/v1/customer/me", {
      WEB_PUSH_ENABLED: "false",
    });

    expect(response.status).not.toBe(404);
  });
});
