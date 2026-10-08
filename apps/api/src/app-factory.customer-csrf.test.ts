import { describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./shared/utils/meter", () => ({ meterEmit }));

import { createApp } from "./app-factory";

/**
 * Every signed-in diner write under /api/v1/customer — follow, save a dish,
 * preferences, push enrollment, consents — authenticates with
 * `Authorization: Bearer` alone (canonicalCustomerAuthMiddleware), and the
 * customer app sends no CSRF token. With only /customer/auth exempted, all of
 * them answered 403 CSRF_TOKEN_MISSING before reaching the handler.
 *
 * A bearer token is never attached by the browser on its own, so a cross-site
 * request cannot carry one and CSRF has nothing to defend here. The refresh
 * cookie, the one ambient credential, is read only under /customer/auth.
 */

function buildApp() {
  return createApp(undefined, {
    disableEdgeCache: true,
    disableObservability: true,
  });
}

async function postFromCustomerApp(method: string, path: string) {
  const response = await buildApp().fetch(
    new Request(`https://api.test${path}`, {
      method,
      // What the customer app sends: an Origin and a bearer token, no CSRF
      // header and no CSRF cookie.
      headers: {
        Host: "api.test",
        Origin: "https://evil.example",
        "Content-Type": "application/json",
        Authorization: "Bearer not-a-real-token",
      },
      body: JSON.stringify({ targetType: "dish", targetId: "1" }),
    }),
    { NODE_ENV: "test" } as never,
  );

  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string };
  } | null;

  return { status: response.status, code: body?.error?.code };
}

describe("customer self-service CSRF exemption", () => {
  it.each([
    ["POST", "/api/v1/customer/favorites"],
    ["DELETE", "/api/v1/customer/favorites/1"],
    ["PATCH", "/api/v1/customer/preferences"],
    ["POST", "/api/v1/customer/push-subscriptions"],
    ["PUT", "/api/v1/customer/notification-preferences"],
  ])("reaches the bearer check for %s %s", async (method, path) => {
    const { code } = await postFromCustomerApp(method, path);

    // The fake token fails auth further in; it must not die at CSRF.
    expect(code).not.toBe("INVALID_REQUEST_ORIGIN");
    expect(code).not.toBe("CSRF_TOKEN_MISSING");
  });

  it("keeps CSRF on the staff /customers routes beside it", async () => {
    const { status, code } = await postFromCustomerApp(
      "POST",
      "/api/v1/customers/restaurant-1",
    );

    expect({ status, code }).toEqual({
      status: 403,
      code: "INVALID_REQUEST_ORIGIN",
    });
  });
});
