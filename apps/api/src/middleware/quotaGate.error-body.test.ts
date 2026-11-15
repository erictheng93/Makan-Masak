import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { handleAppError } from "../utils/app-error-handler";
import { quotaExceeded } from "./quotaGate";

describe("QUOTA_EXCEEDED response body", () => {
  it("keeps details.meterKey so clients can tell a shop limit from throttling", async () => {
    const app = new Hono();
    app.onError(handleAppError);
    app.get("/", () => {
      throw quotaExceeded("orders.created", 1000, 1000);
    });

    const res = await app.request("/");

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      success: false,
      error: {
        code: "QUOTA_EXCEEDED",
        details: { meterKey: "orders.created", hardLimit: 1000, current: 1000 },
      },
    });
  });
});
