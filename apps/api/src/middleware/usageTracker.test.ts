import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usageTracker } from "./usageTracker";
import { meterEmit } from "../shared/utils/meter";

vi.mock("../shared/utils/meter", () => ({
  meterEmit: vi.fn(async () => undefined),
}));

function createApp() {
  const app = new Hono();
  app.use("*", usageTracker);
  app.get("/api/v1/orders", (c) => c.json({ success: true }));
  app.get("/api/v1/health", (c) => c.json({ dead: true }));
  app.get("/info", (c) => c.json({ ok: true }));
  app.get("/api/v1/print/jobs", (c) => c.json({ success: true }));
  app.post("/api/v1/print/jobs/:receiptId/ack", (c) =>
    c.json({ success: true }),
  );
  app.get("/api/v1/print/jobsummary", (c) => c.json({ success: true }));
  app.get("/api/v1/pos/print-agents", (c) => c.json({ success: true }));
  return app;
}

describe("usageTracker", () => {
  beforeEach(() => {
    vi.mocked(meterEmit).mockClear();
  });

  it("meters stale /api/v1/health requests instead of hiding them", async () => {
    const app = createApp();

    await app.fetch(new Request("https://api.test/api/v1/health"), {} as never);

    expect(meterEmit).toHaveBeenCalledOnce();
    expect(meterEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.objectContaining({ path: "/api/v1/health" }),
      }),
      "api.requests",
    );
  });

  it("continues to skip the real public liveness endpoint", async () => {
    const app = createApp();

    await app.fetch(new Request("https://api.test/info"), {} as never);

    expect(meterEmit).not.toHaveBeenCalled();
  });

  it("does not bill the tenant for print-agent job polling", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://api.test/api/v1/print/jobs"),
      {} as never,
    );

    expect(meterEmit).not.toHaveBeenCalled();
  });

  it("does not bill the tenant for print-agent receipt acknowledgements", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://api.test/api/v1/print/jobs/receipt-1/ack", {
        method: "POST",
      }),
      {} as never,
    );

    expect(meterEmit).not.toHaveBeenCalled();
  });

  it("still meters the browser-driven print-agent admin endpoints", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://api.test/api/v1/pos/print-agents"),
      {} as never,
    );

    expect(meterEmit).toHaveBeenCalledOnce();
    expect(meterEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.objectContaining({ path: "/api/v1/pos/print-agents" }),
      }),
      "api.requests",
    );
  });

  it("only exempts on a path-segment boundary, not a string prefix", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://api.test/api/v1/print/jobsummary"),
      {} as never,
    );

    expect(meterEmit).toHaveBeenCalledOnce();
    expect(meterEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.objectContaining({ path: "/api/v1/print/jobsummary" }),
      }),
      "api.requests",
    );
  });
});
