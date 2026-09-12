/**
 * Marketing push preferences (#335).
 *
 * The case that matters most is the marketing toggle writing *both* records: the
 * consent row is the legal ledger of what the diner agreed to, the preference
 * row is the switch the fan-out reads. Writing one without the other either
 * sends to someone who never consented, or records a consent that changes
 * nothing.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

vi.mock("@/services/customerIdentityApi", () => ({
  customerIdentityApi: {
    listConsents: vi.fn(),
    grantConsent: vi.fn(),
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn(),
    listPushSubscriptions: vi.fn(),
  },
}));

vi.mock("@/utils/push-notifications", () => ({
  default: { requestPermission: vi.fn(), subscribe: vi.fn() },
}));

const disabledFeatures = reactive({ value: new Set<string>() });

vi.mock("@/composables/useFeatureAvailability", () => ({
  useFeatureAvailability: () => ({
    isDisabled: (feature: string) => disabledFeatures.value.has(feature),
  }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
  }),
}));

import { customerIdentityApi } from "@/services/customerIdentityApi";
import type { CustomerConsentRecord } from "@/services/customerIdentityApi";
import NotificationSettingsCard from "@/components/settings/NotificationSettingsCard.vue";

function buildPreferences(overrides: Record<string, unknown> = {}) {
  return {
    marketingEnabled: true,
    followedOnly: true,
    quietHoursStartMin: null,
    quietHoursEndMin: null,
    updatedAt: null,
    ...overrides,
  };
}

function buildMarketingConsent(
  overrides: Partial<CustomerConsentRecord> = {},
): CustomerConsentRecord {
  return {
    id: "consent-1",
    consent_type: "marketing",
    version: "2026-05-25-v1",
    granted: 1,
    granted_at_ms: 1_764_000_000_000,
    source: "settings",
    ...overrides,
  };
}

async function mountCard() {
  const wrapper = mount(NotificationSettingsCard);
  await vi.waitFor(() => {
    expect(customerIdentityApi.getNotificationPreferences).toHaveBeenCalled();
    expect(customerIdentityApi.listConsents).toHaveBeenCalled();
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe("NotificationSettingsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disabledFeatures.value = new Set();
    vi.mocked(customerIdentityApi.listConsents).mockResolvedValue([
      buildMarketingConsent(),
    ]);
    vi.mocked(customerIdentityApi.getNotificationPreferences).mockResolvedValue(
      buildPreferences() as never,
    );
    vi.mocked(
      customerIdentityApi.updateNotificationPreferences,
    ).mockImplementation(async (input) => buildPreferences(input) as never);
    vi.mocked(customerIdentityApi.grantConsent).mockResolvedValue({
      id: "consent-2",
    } as never);
    vi.mocked(customerIdentityApi.listPushSubscriptions).mockResolvedValue([
      { id: "sub-1", endpoint: "https://push.example.test/sub" },
    ]);
  });

  it("renders the stored consent and preference state on load", async () => {
    vi.mocked(customerIdentityApi.getNotificationPreferences).mockResolvedValue(
      buildPreferences({
        followedOnly: false,
        quietHoursStartMin: 1380,
        quietHoursEndMin: 420,
      }) as never,
    );

    const wrapper = await mountCard();

    expect(
      (
        wrapper.get('[data-testid="marketing-toggle"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        wrapper.get('[data-testid="followed-only-toggle"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        wrapper.get('[data-testid="quiet-hours-start"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("23:00");
    expect(
      (
        wrapper.get('[data-testid="quiet-hours-end"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("07:00");
  });

  it("treats a missing marketing consent row as not consented", async () => {
    vi.mocked(customerIdentityApi.listConsents).mockResolvedValue([]);

    const wrapper = await mountCard();

    // The preference says enabled, but with no consent on file nothing may be
    // sent, so the switch must not claim the diner opted in.
    expect(
      (
        wrapper.get('[data-testid="marketing-toggle"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("writes the consent and the preference when marketing is switched off", async () => {
    const wrapper = await mountCard();

    await wrapper.get('[data-testid="marketing-toggle"]').setValue(false);

    await vi.waitFor(() => {
      expect(customerIdentityApi.grantConsent).toHaveBeenCalledOnce();
      expect(
        customerIdentityApi.updateNotificationPreferences,
      ).toHaveBeenCalledOnce();
    });

    expect(customerIdentityApi.grantConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        consentType: "marketing",
        granted: false,
        source: "settings",
      }),
    );
    expect(
      customerIdentityApi.updateNotificationPreferences,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ marketingEnabled: false }),
    );
  });

  it("sends followedOnly on its own toggle", async () => {
    const wrapper = await mountCard();

    await wrapper.get('[data-testid="followed-only-toggle"]').setValue(false);

    await vi.waitFor(() => {
      expect(
        customerIdentityApi.updateNotificationPreferences,
      ).toHaveBeenCalledWith(expect.objectContaining({ followedOnly: false }));
    });
    expect(customerIdentityApi.grantConsent).not.toHaveBeenCalled();
  });

  it("saves quiet hours as minutes from midnight", async () => {
    const wrapper = await mountCard();

    await wrapper.get('[data-testid="quiet-hours-start"]').setValue("22:30");
    await wrapper.get('[data-testid="quiet-hours-end"]').setValue("08:15");
    await wrapper.get('[data-testid="quiet-hours-save"]').trigger("click");

    await vi.waitFor(() => {
      expect(
        customerIdentityApi.updateNotificationPreferences,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          quietHoursStartMin: 1350,
          quietHoursEndMin: 495,
        }),
      );
    });
  });

  it("clears quiet hours by sending both bounds as null", async () => {
    vi.mocked(customerIdentityApi.getNotificationPreferences).mockResolvedValue(
      buildPreferences({
        quietHoursStartMin: 1380,
        quietHoursEndMin: 420,
      }) as never,
    );

    const wrapper = await mountCard();
    await wrapper.get('[data-testid="quiet-hours-clear"]').trigger("click");

    await vi.waitFor(() => {
      expect(
        customerIdentityApi.updateNotificationPreferences,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          quietHoursStartMin: null,
          quietHoursEndMin: null,
        }),
      );
    });
  });

  it("renders QUIET_HOURS_INCOMPLETE inline against the quiet hours fields", async () => {
    vi.mocked(
      customerIdentityApi.updateNotificationPreferences,
    ).mockRejectedValueOnce(
      Object.assign(new Error("bad request"), {
        code: "QUIET_HOURS_INCOMPLETE",
      }),
    );

    const wrapper = await mountCard();
    await wrapper.get('[data-testid="quiet-hours-start"]').setValue("22:30");
    await wrapper.get('[data-testid="quiet-hours-save"]').trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="quiet-hours-error"]').exists()).toBe(
        true,
      );
    });
    expect(wrapper.get('[data-testid="quiet-hours-error"]').text()).toContain(
      "notifications.quietHoursIncomplete",
    );
  });

  it("offers the push opt-in control when this device has no subscription", async () => {
    vi.mocked(customerIdentityApi.listPushSubscriptions).mockResolvedValue([]);

    const wrapper = await mountCard();

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="push-required-hint"]').exists()).toBe(
        true,
      );
    });
    expect(wrapper.find('[data-testid="enable-push-button"]').exists()).toBe(
      true,
    );
  });

  it("hides the push prompt once a subscription exists", async () => {
    const wrapper = await mountCard();

    await vi.waitFor(() => {
      expect(customerIdentityApi.listPushSubscriptions).toHaveBeenCalled();
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="push-required-hint"]').exists()).toBe(
      false,
    );
  });

  it("asks for no subscription list while web push is unlaunched, and still explains the dependency", async () => {
    disabledFeatures.value = new Set(["webPush"]);

    const wrapper = await mountCard();

    expect(customerIdentityApi.listPushSubscriptions).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="push-required-hint"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.get('[data-testid="enable-push-button"]').attributes("disabled"),
    ).toBeDefined();
  });
});
