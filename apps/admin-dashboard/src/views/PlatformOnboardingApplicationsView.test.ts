// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlatformOnboardingApplicationsView from "./PlatformOnboardingApplicationsView.vue";
import {
  onboardingApplicationsService,
  type OnboardingApplication,
} from "@/services/onboardingApplicationsService";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/onboardingApplicationsService", () => ({
  onboardingApplicationsService: {
    list: vi.fn(),
    approve: vi.fn(),
    regenerateSetupLink: vi.fn(),
    reject: vi.fn(),
  },
}));

const SETUP_LINK =
  "https://admin.example.test/reset-password?token=setup-token";
const FRESH_LINK =
  "https://admin.example.test/reset-password?token=fresh-token";

function buildApplication(
  overrides: Partial<OnboardingApplication> = {},
): OnboardingApplication {
  return {
    id: "APP-1",
    businessName: "Laksa Shop",
    contactName: "Tan Mei",
    contactEmail: "tan@example.test",
    contactPhone: "0912345678",
    planId: "trial",
    latitude: 24.147736,
    longitude: 120.673648,
    assignedSubdomain: "laksa",
    status: "submitted",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildOwnerAccount(overrides = {}) {
  return {
    restaurantId: "restaurant-1",
    userId: "owner-1",
    username: "tan",
    setupPasswordLink: SETUP_LINK,
    setupPasswordExpiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildDelivery(overrides = {}) {
  return {
    id: "delivery-1",
    channel: "manual" as const,
    status: "pending" as const,
    recipientEmail: "tan@example.test",
    recipientName: "Tan Mei",
    setupPasswordExpiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockList(applications: OnboardingApplication[]) {
  vi.mocked(onboardingApplicationsService.list).mockResolvedValue({
    applications,
    total: applications.length,
    page: 1,
    limit: 50,
  });
}

describe("PlatformOnboardingApplicationsView", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    mockList([buildApplication()]);
    vi.mocked(onboardingApplicationsService.approve).mockResolvedValue({
      tenantId: "T-1",
      subdomain: "laksa",
      ownerAccount: buildOwnerAccount(),
      credentialDelivery: buildDelivery(),
      status: "completed",
    });
    vi.mocked(onboardingApplicationsService.reject).mockResolvedValue({
      status: "rejected",
    });
    vi.mocked(
      onboardingApplicationsService.regenerateSetupLink,
    ).mockResolvedValue({
      ownerAccount: buildOwnerAccount({
        setupPasswordLink: FRESH_LINK,
        setupPasswordExpiresAt: "2099-02-01T00:00:00.000Z",
      }),
      credentialDelivery: buildDelivery({ id: "delivery-2" }),
    });
  });

  it("loads onboarding applications and filters by submitted status by default", async () => {
    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();

    expect(onboardingApplicationsService.list).toHaveBeenCalledWith({
      status: "submitted",
      limit: 50,
    });
    expect(wrapper.text()).toContain("Laksa Shop");
  });

  it("approves an application and shows the handoff", async () => {
    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();

    await wrapper
      .get('[data-testid="approve-onboarding-APP-1"]')
      .trigger("click");
    await flushPromises();

    expect(onboardingApplicationsService.approve).toHaveBeenCalledWith("APP-1");
    expect(onboardingApplicationsService.list).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-testid="owner-handoff-username"]').text()).toBe(
      "tan",
    );
    expect(wrapper.get('[data-testid="owner-handoff-setup-link"]').text()).toBe(
      SETUP_LINK,
    );
  });

  it("allows approving submitted applications in the managed onboarding flow", async () => {
    mockList([
      buildApplication({
        id: "APP-2",
        businessName: "Nasi Lemak Shop",
        planId: "standard",
        latitude: null,
        longitude: null,
      }),
    ]);

    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();

    const approveButton = wrapper.get(
      '[data-testid="approve-onboarding-APP-2"]',
    );
    expect(approveButton.attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="approvable-count"]').text()).toBe("1");

    await approveButton.trigger("click");
    await flushPromises();

    expect(onboardingApplicationsService.approve).toHaveBeenCalledWith("APP-2");
  });

  it("copies the owner username and setup link for handing over", async () => {
    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();
    await wrapper
      .get('[data-testid="approve-onboarding-APP-1"]')
      .trigger("click");
    await flushPromises();

    const copyUsername = wrapper.get('[data-testid="copy-owner-username"]');
    await copyUsername.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith("tan");

    const copyLink = wrapper.get('[data-testid="copy-owner-setup-link"]');
    await copyLink.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenLastCalledWith(SETUP_LINK);
  });

  it("reports a clipboard failure instead of claiming the copy worked", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();
    await wrapper
      .get('[data-testid="approve-onboarding-APP-1"]')
      .trigger("click");
    await flushPromises();

    await wrapper.get('[data-testid="copy-owner-setup-link"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-testid="onboarding-error"]').text()).toContain(
      "platformOnboarding.errors.copy",
    );
  });

  it("shows how the credentials were delivered, including a failed email", async () => {
    vi.mocked(onboardingApplicationsService.approve).mockResolvedValue({
      tenantId: "T-1",
      ownerAccount: buildOwnerAccount(),
      credentialDelivery: buildDelivery({
        channel: "email",
        status: "failed",
        errorMessage: "RESEND_API_KEY is not configured",
      }),
      status: "completed",
    });

    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();
    await wrapper
      .get('[data-testid="approve-onboarding-APP-1"]')
      .trigger("click");
    await flushPromises();

    const delivery = wrapper.get('[data-testid="owner-handoff-delivery"]');
    expect(delivery.text()).toContain("RESEND_API_KEY is not configured");
  });

  it("reopens the handoff for a completed application without provisioning again", async () => {
    mockList([
      buildApplication({ id: "APP-3", status: "completed", tenantId: "T-3" }),
    ]);

    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();

    expect(
      wrapper.find('[data-testid="approved-owner-account"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .get('[data-testid="approve-onboarding-APP-3"]')
        .attributes("disabled"),
    ).toBeDefined();

    await wrapper.get('[data-testid="owner-handoff-APP-3"]').trigger("click");
    await flushPromises();

    expect(onboardingApplicationsService.approve).toHaveBeenCalledOnce();
    expect(onboardingApplicationsService.approve).toHaveBeenCalledWith("APP-3");
    // Reopening only reads the handoff back; it does not refresh the list.
    expect(onboardingApplicationsService.list).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-testid="owner-handoff-setup-link"]').text()).toBe(
      SETUP_LINK,
    );

    await wrapper
      .get('[data-testid="dismiss-approved-owner-account"]')
      .trigger("click");
    expect(
      wrapper.find('[data-testid="approved-owner-account"]').exists(),
    ).toBe(false);
  });

  it("does not offer the handoff button before an application is completed", async () => {
    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();

    expect(wrapper.find('[data-testid="owner-handoff-APP-1"]').exists()).toBe(
      false,
    );
  });

  it("explains what to do when no unused setup link remains", async () => {
    mockList([buildApplication({ id: "APP-4", status: "completed" })]);
    vi.mocked(onboardingApplicationsService.approve).mockResolvedValue({
      tenantId: "T-4",
      status: "completed",
    });

    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();
    await wrapper.get('[data-testid="owner-handoff-APP-4"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="owner-handoff-unavailable"]').text(),
    ).toContain("platformOnboarding.handoff.unavailable");
    expect(wrapper.find('[data-testid="copy-owner-setup-link"]').exists()).toBe(
      false,
    );
  });

  it("marks an expired setup link and refuses to copy it", async () => {
    mockList([buildApplication({ id: "APP-5", status: "completed" })]);
    vi.mocked(onboardingApplicationsService.approve).mockResolvedValue({
      tenantId: "T-5",
      ownerAccount: buildOwnerAccount({
        setupPasswordExpiresAt: "2020-01-01T00:00:00.000Z",
      }),
      status: "completed",
    });

    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();
    await wrapper.get('[data-testid="owner-handoff-APP-5"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="owner-link-expired"]').exists()).toBe(
      true,
    );
    expect(
      wrapper
        .get('[data-testid="copy-owner-setup-link"]')
        .attributes("disabled"),
    ).toBeDefined();
    expect(writeText).not.toHaveBeenCalled();
  });

  // Regenerating rotates the token, so a link already handed to an owner stops
  // working. It must not be one stray click away while a usable link exists.
  it("offers regeneration only once the link is unusable, and asks first", async () => {
    mockList([buildApplication({ id: "APP-6", status: "completed" })]);

    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();
    await wrapper.get('[data-testid="owner-handoff-APP-6"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="regenerate-setup-link"]').exists()).toBe(
      false,
    );

    vi.mocked(onboardingApplicationsService.approve).mockResolvedValue({
      tenantId: "T-6",
      ownerAccount: buildOwnerAccount({
        setupPasswordExpiresAt: "2020-01-01T00:00:00.000Z",
      }),
      status: "completed",
    });
    await wrapper.get('[data-testid="owner-handoff-APP-6"]').trigger("click");
    await flushPromises();

    await wrapper.get('[data-testid="regenerate-setup-link"]').trigger("click");
    await flushPromises();
    expect(
      onboardingApplicationsService.regenerateSetupLink,
    ).not.toHaveBeenCalled();

    await wrapper
      .get('[data-testid="confirm-regenerate-setup-link"]')
      .trigger("click");
    await flushPromises();

    expect(
      onboardingApplicationsService.regenerateSetupLink,
    ).toHaveBeenCalledWith("APP-6");
    expect(wrapper.get('[data-testid="owner-handoff-setup-link"]').text()).toBe(
      FRESH_LINK,
    );
    expect(wrapper.find('[data-testid="regenerate-setup-link"]').exists()).toBe(
      false,
    );
  });

  it("rejects a submitted application only with a reason", async () => {
    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();

    await wrapper
      .get('[data-testid="reject-onboarding-APP-1"]')
      .trigger("click");
    await flushPromises();

    const confirmReject = wrapper.get(
      '[data-testid="confirm-reject-onboarding"]',
    );
    expect(confirmReject.attributes("disabled")).toBeDefined();
    await wrapper
      .get('[data-testid="onboarding-rejection-reason-input"]')
      .setValue("Missing documents");
    expect(confirmReject.attributes("disabled")).toBeUndefined();
    await wrapper.get('[role="dialog"] form').trigger("submit");
    await flushPromises();

    expect(onboardingApplicationsService.reject).toHaveBeenCalledWith(
      "APP-1",
      "Missing documents",
    );
    expect(onboardingApplicationsService.list).toHaveBeenCalledTimes(2);
  });

  it("does not offer rejection again after an application is rejected", async () => {
    mockList([
      buildApplication({
        status: "rejected",
        rejectionReason: "Missing documents",
      }),
    ]);

    const wrapper = mount(PlatformOnboardingApplicationsView);
    await flushPromises();

    expect(
      wrapper
        .get('[data-testid="reject-onboarding-APP-1"]')
        .attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.get('[data-testid="onboarding-rejection-reason"]').text(),
    ).toContain("platformOnboarding.rejectionReason");
  });
});
