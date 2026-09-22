import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingService } from "../services/OnboardingService";
import type { ManagementEnv, OnboardingApplication } from "../types";

function notificationEnv(overrides: Partial<ManagementEnv>): ManagementEnv {
  return overrides as ManagementEnv;
}

describe("new application platform notification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("notifies Slack without applicant contact details and swallows webhook failures", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new OnboardingService({
      SLACK_WEBHOOK_URL: "https://hooks.example.test/onboarding",
    } as ManagementEnv);
    await expect(
      service.notifyPlatformOfNewApplication({
        id: "APP-1",
        businessName: "Laksa Shop",
        contactName: "Applicant Name",
        contactEmail: "applicant@example.test",
        contactPhone: "0912345678",
      } as OnboardingApplication),
    ).resolves.toBeUndefined();

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const payload = JSON.parse(String(init.body));
    expect(payload.text).toContain("Laksa Shop");
    expect(payload.text).toContain("APP-1");
    expect(payload.text).not.toContain("Applicant Name");
    expect(payload.text).not.toContain("applicant@example.test");
    expect(payload.text).not.toContain("0912345678");
  });

  // The business name comes from a public form, and Slack reads <!channel> in
  // message text as a real mention of everyone in the channel.
  it("escapes Slack control sequences in the applicant's business name", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new OnboardingService({
      SLACK_WEBHOOK_URL: "https://hooks.example.test/onboarding",
      ADMIN_APP_URL: "https://admin.example.test",
    } as ManagementEnv);

    await service.notifyPlatformOfNewApplication({
      id: "APP-2",
      businessName: "<!channel> Laksa <https://evil.example|click>",
      contactName: "Applicant Name",
      contactEmail: "applicant@example.test",
      contactPhone: "0912345678",
    } as OnboardingApplication);

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const payload = JSON.parse(String(init.body));
    expect(payload.text).not.toContain("<!channel>");
    expect(payload.text).not.toContain("<https://evil.example|click>");
    expect(payload.text).toContain("&lt;!channel&gt;");
    expect(payload.text).toContain(
      "https://admin.example.test/dashboard/platform/onboarding",
    );
  });

  it("uses Cloudflare Email Service without applicant contact details", async () => {
    const send = vi.fn<
      (message: EmailMessageBuilder) => Promise<{ messageId: string }>
    >(async () => ({ messageId: "email-1" }));
    const service = new OnboardingService(
      notificationEnv({
        PLATFORM_NOTIFICATION_EMAIL: "ops@example.test",
        PLATFORM_NOTIFICATION_EMAIL_FROM: "alerts@makanmasak.com",
        ONBOARDING_NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
        ADMIN_APP_URL: "https://admin.example.test",
      }),
    );

    await expect(
      service.notifyPlatformOfNewApplication({
        id: "APP-3",
        businessName: "Laksa <Shop>",
        contactName: "Applicant Name",
        contactEmail: "applicant@example.test",
        contactPhone: "0912345678",
      } as OnboardingApplication),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ops@example.test",
        from: "alerts@makanmasak.com",
        subject: "New MakanMasak onboarding application",
      }),
    );
    const message = send.mock.calls[0]?.[0];
    expect(message.text).toContain("Laksa <Shop>");
    expect(message.text).toContain("APP-3");
    expect(message.text).not.toContain("Applicant Name");
    expect(message.text).not.toContain("applicant@example.test");
    expect(message.text).not.toContain("0912345678");
    expect(message.html).toContain("Laksa &lt;Shop&gt;");
  });

  it("swallows Cloudflare Email Service failures", async () => {
    const send = vi.fn<
      (message: EmailMessageBuilder) => Promise<{ messageId: string }>
    >(async () => {
      throw new Error("provider unavailable");
    });
    const service = new OnboardingService(
      notificationEnv({
        PLATFORM_NOTIFICATION_EMAIL: "ops@example.test",
        PLATFORM_NOTIFICATION_EMAIL_FROM: "alerts@makanmasak.com",
        ONBOARDING_NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
      }),
    );

    await expect(
      service.notifyPlatformOfNewApplication({
        id: "APP-4",
        businessName: "Laksa Shop",
      } as OnboardingApplication),
    ).resolves.toBeUndefined();
  });

  it("does not call Email Service until every email setting is configured", async () => {
    const send = vi.fn<
      (message: EmailMessageBuilder) => Promise<{ messageId: string }>
    >(async () => ({ messageId: "email-2" }));
    const service = new OnboardingService(
      notificationEnv({
        PLATFORM_NOTIFICATION_EMAIL: "ops@example.test",
        ONBOARDING_NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
      }),
    );

    await service.notifyPlatformOfNewApplication({
      id: "APP-5",
      businessName: "Laksa Shop",
    } as OnboardingApplication);

    expect(send).not.toHaveBeenCalled();
  });

  // #410 tells operators to look for this log in `wrangler tail` to learn that
  // production has no channel, so it is part of the contract, not noise.
  it("sends nothing and logs the gap when no channel is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const send = vi.fn();
    const service = new OnboardingService(
      notificationEnv({
        NODE_ENV: "production",
        ONBOARDING_NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
      }),
    );

    await expect(
      service.notifyPlatformOfNewApplication({
        id: "APP-6",
        businessName: "Laksa Shop",
      } as OnboardingApplication),
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "No platform onboarding notification channel is configured",
      ),
    );
    consoleError.mockRestore();
  });
});
