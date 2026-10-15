import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./shared/utils/meter", () => ({ meterEmit }));

import { createApp } from "./app-factory";

/**
 * The local print agent is a Node daemon on the shop floor, not a browser. It
 * holds no session cookie and undici sends neither Origin nor Referer, so both
 * CSRF layers reject it before the handler runs: layer 1 answers
 * INVALID_REQUEST_ORIGIN on the missing Origin, and layer 2 would answer
 * CSRF_TOKEN_MISSING after it.
 *
 * That kills the only path that settles a print job. The agent claims a
 * receipt (print_status -> "printing"), prints it, and then cannot acknowledge
 * the outcome — every receipt stays claimed forever with no reclaim path, and
 * the cloud never learns whether paper came out.
 *
 * The agent authenticates by possession of a per-register credential, checked
 * in the route itself, which is the same shape as the webhook exclusions above
 * it.
 */

function buildApp() {
  return createApp(undefined, {
    disableEdgeCache: true,
    disableObservability: true,
  });
}

async function callAsPrintAgent(method: string, path: string) {
  const response = await buildApp().fetch(
    new Request(`https://api.test${path}`, {
      method,
      // Deliberately no Origin, no Referer and no cookie — this is exactly
      // what fetch() from the print agent puts on the wire.
      headers: {
        Host: "api.test",
        "Content-Type": "application/json",
        "X-Print-Agent-Key": "agent-secret",
        "X-Restaurant-Id": "restaurant-1",
      },
      body:
        method === "GET" ? undefined : JSON.stringify({ status: "printed" }),
    }),
    { NODE_ENV: "test" } as never,
  );

  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string };
  } | null;

  return { status: response.status, code: body?.error?.code };
}

describe("print agent CSRF exemption", () => {
  // These requests are rejected on purpose; the error handler and CORS/CSRF
  // middleware log each rejection, which is not what these tests check.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets the agent acknowledge a claimed job without a browser session", async () => {
    const { code } = await callAsPrintAgent(
      "POST",
      "/api/v1/print/jobs/receipt-1/ack",
    );

    // The request may still fail further in (no DB binding in this harness) —
    // what it must not do is die at CSRF, which the agent can never satisfy.
    expect(code).not.toBe("INVALID_REQUEST_ORIGIN");
    expect(code).not.toBe("CSRF_TOKEN_MISSING");
  });

  it.each([
    // The cashier's own print button: browser-driven, session-authenticated,
    // and the reason a bare "/api/v1/print" prefix would be wrong.
    "/api/v1/pos/receipts/print",
    // Anything added under the print feature that is not an agent job stays
    // protected, because the exclusion names /jobs and not the feature root.
    "/api/v1/print/devices",
  ])("keeps CSRF protection on %s", async (path) => {
    const { status, code } = await callAsPrintAgent("POST", path);

    expect({ status, code }).toEqual({
      status: 403,
      code: "INVALID_REQUEST_ORIGIN",
    });
  });
});
