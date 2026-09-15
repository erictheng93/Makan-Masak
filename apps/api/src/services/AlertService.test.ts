import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertService } from "./AlertService";
import type { Env } from "../types/env";

describe("email alert delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses authenticated Resend when alert email and key are configured", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "alert-email" }));
    vi.stubGlobal("fetch", fetchMock);
    await new AlertService({
      ALERT_EMAIL_TO: "ops@example.com",
      RESEND_API_KEY: "test-key",
      NOTIFICATION_FROM_EMAIL: "alerts@makanmasak.com",
    } as Env).sendAlert({
      title: "Check",
      message: "Alert body",
      severity: "warning",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("does not send to the retired relay without a key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await new AlertService({
      ALERT_EMAIL_TO: "ops@example.com",
    } as Env).sendAlert({
      title: "Check",
      message: "Alert body",
      severity: "warning",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
