import { describe, expect, it, vi } from "vitest";
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

function service(
  send: SendEmail["send"] | undefined,
  overrides: Partial<ManagementEnv> = {},
) {
  return new OnboardingService({
    ONBOARDING_EMAIL_ENABLED: "true",
    ONBOARDING_EMAIL_FROM: "onboarding@makanmasak.com",
    ONBOARDING_NOTIFICATION_EMAIL: send ? ({ send } as SendEmail) : undefined,
    ...overrides,
  } as ManagementEnv);
}

describe("onboarding email via Cloudflare Email Service", () => {
  it("sends Chinese setup details through the binding", async () => {
    const send = vi.fn(async () => ({ messageId: "cf-1" }));

    const result = await service(send)["sendSetupPasswordEmail"](
      application,
      owner,
    );

    expect(result).toMatchObject({ attempted: true, status: "sent" });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: application.contactEmail,
        from: "onboarding@makanmasak.com",
        html: expect.stringContaining("<pre>"),
      }),
    );
    const { text } = (send.mock.calls[0] as unknown as [{ text: string }])[0];
    expect(text).toContain("小明餐館");
    expect(text).toContain(owner.username);
    expect(text).toContain(owner.setupPasswordLink);
    expect(text).toContain(owner.setupPasswordExpiresAt);
  });

  it("sends a status URL with the one-time secret in the fragment", async () => {
    const send = vi.fn(async () => ({ messageId: "cf-2" }));

    await service(send, {
      ONBOARDING_APP_URL: "https://onboarding.example.com",
    })["sendApplicationReceivedEmail"](application, "onb_secret");

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: application.contactEmail,
        text: expect.stringContaining(
          "https://onboarding.example.com/status/APP-20260915-EMAIL#onb_secret",
        ),
      }),
    );
  });

  it("records a failed delivery when the binding throws", async () => {
    const send = vi.fn(async () => {
      throw new Error("sender domain not verified");
    });
    const result = await service(send)["sendSetupPasswordEmail"](
      application,
      owner,
    );
    expect(send).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      attempted: true,
      status: "failed",
      errorMessage: "sender domain not verified",
    });
  });

  it("records a failed delivery when the binding is missing", async () => {
    const result = await service(undefined)["sendSetupPasswordEmail"](
      application,
      owner,
    );
    expect(result).toMatchObject({ attempted: true, status: "failed" });
    expect(result.errorMessage).toContain("ONBOARDING_NOTIFICATION_EMAIL");
  });
});
