import { describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./shared/utils/meter", () => ({ meterEmit }));

import { createApp } from "./app-factory";

const CHECKOUT_ID = "018ffb9a-7b8a-7c3d-9f23-123456789abc";
const root = "/api/v1/market-checkouts";
const app = createApp(undefined, {
  disableEdgeCache: true,
  disableObservability: true,
});

async function requestWithoutCsrf(
  method: string,
  path: string,
  browser = true,
) {
  const readsCheckout =
    path === `${root}/${CHECKOUT_ID}/voucher` ||
    path === `${root}/${CHECKOUT_ID}/pay`;
  const getCheckout = vi.fn(async () =>
    JSON.stringify({
      id: CHECKOUT_ID,
      childOrders: [{ orderId: "1" }],
    }),
  );
  const response = await app.fetch(
    new Request(`https://api.makanmasak.com${path}`, {
      method,
      headers: {
        Host: "api.makanmasak.com",
        "Content-Type": "application/json",
        ...(browser ? { Origin: "https://makanmasak.com" } : {}),
      },
      body: "{}",
    }),
    {
      NODE_ENV: "test",
      DEV_CORS_ORIGINS: "https://makanmasak.com",
      ...(readsCheckout ? { CACHE_KV: { get: getCheckout } } : {}),
    } as never,
  );
  const body = (await response.json()) as { error?: { code?: string } };
  if (readsCheckout) {
    expect(getCheckout).toHaveBeenCalledWith(`market_checkout:${CHECKOUT_ID}`);
    // Exempting CSRF must still leave the checkout's ownership gate intact.
    expect(body.error?.code).toBe("MARKET_CHECKOUT_ACCESS_DENIED");
  }
  return { status: response.status, code: body.error?.code };
}

// Keep this list aligned with the possession-authorized writes in customer-app
// services. The middleware must let these reach validation/ownership checks
// without requiring the session CSRF token that customer-app never sends.
const customerWrites: Array<[string, string]> = [
  ["POST", root],
  ["POST", `${root}/${CHECKOUT_ID}/voucher`],
  ["DELETE", `${root}/${CHECKOUT_ID}/voucher`],
  ["POST", `${root}/${CHECKOUT_ID}/pay`],
  ["POST", `${root}/${CHECKOUT_ID}/guest-token`],
  ["POST", "/api/v1/guest-orders"],
  ["POST", "/api/v1/realtime/auth/guest-token"],
  ["POST", "/api/v1/waiting-list"],
  ["POST", `/api/v1/waiting-list/${CHECKOUT_ID}/confirm`],
  ["POST", "/api/v1/reservations"],
  ["DELETE", `/api/v1/reservations/${CHECKOUT_ID}/cancel`],
  ["POST", "/api/v1/service-bookings"],
  ["POST", "/api/v1/orders/group/create"],
  ["POST", "/api/v1/orders/group/join/ABC12345"],
];

describe("customer self-service CSRF boundaries", () => {
  it.each(customerWrites)(
    "allows the customer request to reach its handler: %s %s",
    async (method, path) => {
      const { status, code } = await requestWithoutCsrf(method, path);
      expect(code).not.toBe("CSRF_TOKEN_MISSING");
      expect(code).not.toBe("INVALID_REQUEST_ORIGIN");
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    },
  );

  it("allows a server webhook without Origin to reach signature validation", async () => {
    const result = await requestWithoutCsrf(
      "POST",
      `${root}/payment-webhooks/stripe`,
      false,
    );
    expect(result.code).not.toBe("CSRF_TOKEN_MISSING");
    expect(result.code).not.toBe("INVALID_REQUEST_ORIGIN");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it.each([
    `${root}/${CHECKOUT_ID}/refund`,
    `${root}/admin/provider-status/check`,
    `${root}/admin/${CHECKOUT_ID}/reconcile`,
    // No bare-prefix exemption: future staff routes must remain protected.
    `${root}/future-staff-action`,
    `${root}/nested/${CHECKOUT_ID}/pay`,
    // The public cancellation exemption is DELETE-only. The staff POST route
    // must continue through CSRF protection.
    `/api/v1/reservations/${CHECKOUT_ID}/cancel`,
    "/api/v1/reservations/staff",
  ])("keeps CSRF protection on %s", async (path) => {
    expect(await requestWithoutCsrf("POST", path)).toEqual({
      status: 403,
      code: "CSRF_TOKEN_MISSING",
    });
  });
});
