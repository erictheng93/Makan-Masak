import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingService } from "../services/OnboardingService";
import type { ManagementEnv, OnboardingApplication } from "../types";

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
});
