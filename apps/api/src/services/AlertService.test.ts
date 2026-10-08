import { afterEach, describe, expect, it, vi } from "vitest";
import type { SendEmail } from "@cloudflare/workers-types";
import { AlertService } from "./AlertService";
import type { Env } from "../types/env";

describe("email alert delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a Cloudflare email channel when the binding and recipient exist", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "cf-alert-1" });
    await new AlertService({
      ALERT_EMAIL_TO: "ops@example.com",
      NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
      NOTIFICATION_FROM_EMAIL: "alerts@makanmasak.com",
    } as Env).sendAlert({
      title: "Check",
      message: "Alert body",
      severity: "warning",
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ops@example.com",
        from: "alerts@makanmasak.com",
        subject: "[WARNING] Check",
      }),
    );
  });

  it("does not send alert email without the Cloudflare binding", async () => {
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
