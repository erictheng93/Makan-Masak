import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingService } from "../services/OnboardingService";
import type { ManagementEnv, OnboardingApplication } from "../types";

const application = {
  id: "APP-20260915-EMAIL",
  contactName: "王小明",
  contactEmail: "owner@example.com",
  businessName: "小明餐館",
} as OnboardingApplication;
const owner = {
  username: "owner-xiao-ming",
  setupPasswordLink:
    "https://admin.example.com/reset-password?token=setup-token",
  setupPasswordExpiresAt: "2026-09-16T00:00:00.000Z",
  restaurantId: "restaurant-1",
  userId: "user-1",
  setupPasswordToken: "setup-token",
};

function service(overrides: Partial<ManagementEnv> = {}) {
  return new OnboardingService({
    ONBOARDING_EMAIL_ENABLED: "true",
    ONBOARDING_EMAIL_FROM: "onboarding@makanmasak.com",
    RESEND_API_KEY: "test-key",
    ...overrides,
  } as ManagementEnv);
}

describe("onboarding setup email", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends Chinese setup details through authenticated Resend", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "email-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service()["sendSetupPasswordEmail"](
      application,
      owner,
    );

    expect(result.status).toBe("sent");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
    const body = JSON.parse(String(init.body));
    expect(body.text).toContain("小明餐館");
    expect(body.text).toContain(owner.username);
    expect(body.text).toContain(owner.setupPasswordLink);
    expect(body.text).toContain(owner.setupPasswordExpiresAt);
  });

  it("reports provider failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    const result = await service()["sendSetupPasswordEmail"](
      application,
      owner,
    );
    expect(result).toMatchObject({ attempted: true, status: "failed" });
    expect(result.errorMessage).toContain("403");
  });

  it("does not fetch when the key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await service({ RESEND_API_KEY: undefined })[
      "sendSetupPasswordEmail"
    ](application, owner);
    expect(result).toMatchObject({ attempted: true, status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a status URL with the one-time secret in the fragment", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "email-2" }));
    vi.stubGlobal("fetch", fetchMock);

    await service({ ONBOARDING_APP_URL: "https://onboarding.example.com" })[
      "sendApplicationReceivedEmail"
    ](application, "onb_secret");

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body));
    expect(body.text).toContain(
      "https://onboarding.example.com/status/APP-20260915-EMAIL#onb_secret",
    );
  });
});
