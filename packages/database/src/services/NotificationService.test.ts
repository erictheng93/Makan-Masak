import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database, SendEmail } from "@cloudflare/workers-types";
import type { CloudflareEnv } from "./base";
import {
  NotificationService,
  CloudflareEmailProvider,
  resolveEmailProviderName,
  type EmailProviderEnv,
} from "./NotificationService";

function buildEnv(overrides: Partial<EmailProviderEnv> = {}): EmailProviderEnv {
  return { ...overrides };
}

describe("resolveEmailProviderName", () => {
  const binding = {} as SendEmail;
  it.each([
    [
      "uses Cloudflare when its binding exists",
      { NOTIFICATION_EMAIL: binding },
      "cloudflare",
    ],
    [
      "prefers Cloudflare when both providers are configured",
      { NOTIFICATION_EMAIL: binding, RESEND_API_KEY: "resend-key" },
      "cloudflare",
    ],
    ["uses noop without any provider", {}, "noop"],
    [
      "defaults to Resend when its key is configured",
      { RESEND_API_KEY: "resend-key" },
      "resend",
    ],
    [
      "uses Resend when explicitly requested with a key",
      {
        EMAIL_PROVIDER: "resend",
        NOTIFICATION_EMAIL: binding,
        RESEND_API_KEY: "resend-key",
      },
      "resend",
    ],
    [
      "does not fall back to Cloudflare when Resend is requested without a key",
      { EMAIL_PROVIDER: "resend", NOTIFICATION_EMAIL: binding },
      "noop",
    ],
  ] as const)("%s", (_description, env, expected) => {
    expect(resolveEmailProviderName(buildEnv(env))).toBe(expected);
  });

  it("falls back to Resend when no Cloudflare binding exists", () => {
    const service = new NotificationService(
      {} as D1Database,
      { RESEND_API_KEY: "resend-key" } as CloudflareEnv,
    );

    expect(service.emailProviderName).toBe("resend");
  });
});

describe("CloudflareEmailProvider", () => {
  it("sends through the binding and returns its message id", async () => {
    const send = vi.fn(function (this: SendEmail) {
      if (this !== binding) throw new Error("binding context lost");
      return Promise.resolve({ messageId: "cf-1" });
    });
    const binding = { send } as unknown as SendEmail;
    const provider = new CloudflareEmailProvider(
      binding,
      "notifications@makanmasak.com",
    );

    await expect(
      provider.sendEmail({
        to: "staff@example.test",
        subject: "Welcome",
        html: "<b>Hello</b>",
      }),
    ).resolves.toEqual({ success: true, messageId: "cf-1" });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "staff@example.test",
        from: "notifications@makanmasak.com",
        subject: "Welcome",
        text: "Hello",
      }),
    );
  });

  it("returns binding failures without throwing", async () => {
    const send = vi.fn().mockRejectedValue(new Error("send failed"));
    const provider = new CloudflareEmailProvider(
      { send } as unknown as SendEmail,
      "notifications@makanmasak.com",
    );

    await expect(
      provider.sendEmail({
        to: "staff@example.test",
        subject: "Welcome",
        html: "Hello",
      }),
    ).resolves.toEqual({ success: false, error: "send failed" });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "staff@example.test",
        from: "notifications@makanmasak.com",
        subject: "Welcome",
      }),
    );
  });
});

describe("NotificationService template rendering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves template markup while HTML-escaping untrusted values", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "email-1" }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new NotificationService(
      {} as D1Database,
      { RESEND_API_KEY: "resend-key" } as CloudflareEnv,
    );

    await service.sendNotification({
      recipientId: "user-1",
      recipientEmail: "staff@test.dev",
      category: "schedule_created",
      type: "email",
      data: {
        "[^]*": "ATTACKER_CONTROLLED",
        employeeName: '<img src=x onerror="alert(1)">',
        shiftName: "Lunch & Dinner",
        scheduleDate: "2026-09-04",
        startTime: "10:00",
        endTime: "14:00",
        notes: "</li><script>alert(1)</script>",
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      Authorization: "Bearer resend-key",
      "User-Agent": "MakanMasak-Worker/1.0",
    });
    const payload = JSON.parse(String(request.body)) as {
      subject: string;
      html: string;
    };

    expect(payload.subject).toBe("New Schedule Assignment - Lunch & Dinner");
    expect(payload.html).toContain("<h2>New Shift Assigned</h2>");
    expect(payload.html).toContain(
      "Dear &lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(payload.html).toContain(
      "&lt;/li&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(payload.html).not.toContain("ATTACKER_CONTROLLED");
    expect(payload.html).not.toContain("<script>alert(1)</script>");
  });
});
