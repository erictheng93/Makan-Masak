import { describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./shared/utils/meter", () => ({ meterEmit }));

import { createApp } from "./app-factory";

/**
 * Group ordering is customer self-service: a guest creates a group with no
 * account, members join by holding a share code, and every later action is
 * authorised by holding a memberToken. None of it uses a session cookie, so
 * CSRF protects nothing here — and because apps/customer-app sends no CSRF
 * token at all, leaving these paths protected makes the entire feature
 * unusable from a browser. Every mutation answers 403 before it reaches a
 * handler.
 *
 * The exclusion list already carries the same shape for waiting lists,
 * reservations, service bookings and guest orders. Group ordering was simply
 * missed.
 *
 * The staff-gated routes in the same feature must stay protected — they run
 * behind authMiddleware and a session, which is exactly what CSRF defends.
 */

const GROUP_ORDER_ID = "018ffb9a-7b8a-7c3d-9f23-123456789abc";
const MEMBER_ID = "018ffb9a-7b8a-7c3d-9f23-1234567890a1";
const ITEM_ID = "018ffb9a-7b8a-7c3d-9f23-1234567890b1";

function buildApp() {
  return createApp(undefined, {
    disableEdgeCache: true,
    disableObservability: true,
  });
}

async function callWithoutCsrf(method: string, path: string) {
  const response = await buildApp().fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers: {
        Host: "api.test",
        Origin: "https://api.test",
        "Content-Type": "application/json",
      },
      body: method === "GET" ? undefined : "{}",
    }),
    { NODE_ENV: "test" } as never,
  );

  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string };
  } | null;

  return { status: response.status, code: body?.error?.code };
}

const customerSelfService: Array<[string, string]> = [
  ["POST", "/api/v1/orders/group/create"],
  ["POST", "/api/v1/orders/group/join/ABC12345"],
  ["POST", `/api/v1/orders/group/${GROUP_ORDER_ID}/cart`],
  ["PUT", `/api/v1/orders/group/${GROUP_ORDER_ID}/cart/${ITEM_ID}`],
  ["DELETE", `/api/v1/orders/group/${GROUP_ORDER_ID}/cart/${ITEM_ID}`],
  ["POST", `/api/v1/orders/group/${GROUP_ORDER_ID}/lock`],
  ["POST", `/api/v1/orders/group/${GROUP_ORDER_ID}/tracking-token`],
  ["POST", `/api/v1/orders/group/${GROUP_ORDER_ID}/recover`],
  ["POST", `/api/v1/orders/group/${GROUP_ORDER_ID}/split`],
  ["POST", `/api/v1/orders/group/${GROUP_ORDER_ID}/payment/${MEMBER_ID}`],
  ["POST", `/api/v1/orders/group/${GROUP_ORDER_ID}/leave/${MEMBER_ID}`],
];

const staffOnly: Array<[string, string]> = [
  ["POST", "/api/v1/orders/group/generate-code"],
  ["POST", "/api/v1/orders/group/cleanup/expired"],
];

describe("group ordering CSRF exemptions", () => {
  it.each(customerSelfService)(
    "lets a browser reach the handler for %s %s",
    async (method, path) => {
      const { code } = await callWithoutCsrf(method, path);

      // The request may still fail on validation or auth — what it must not do
      // is die at CSRF, which no customer-app request can ever satisfy.
      expect(code).not.toBe("CSRF_TOKEN_MISSING");
    },
  );

  it.each(staffOnly)(
    "keeps CSRF protection on the staff route %s %s",
    async (method, path) => {
      const { status, code } = await callWithoutCsrf(method, path);

      // These sit behind authMiddleware and a session cookie. A blanket
      // wildcard over /api/v1/orders/group would exempt them too, which is the
      // mistake the exclusion list's own comments warn about.
      expect({ status, code }).toEqual({
        status: 403,
        code: "CSRF_TOKEN_MISSING",
      });
    },
  );
});
