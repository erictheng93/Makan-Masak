import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  route: {
    params: { applicationId: "app-123" },
    hash: "#tracking-secret",
  },
  push: vi.fn(),
  getApplication: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/api", () => {
  class MockApiError extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    ApiError: MockApiError,
    onboardingApi: { getApplication: mocks.getApplication },
  };
});

import ApplicationStatusView from "./ApplicationStatusView.vue";
import { ApiError } from "@/services/api";

const application = (status: string, rejectionReason?: string) => ({
  id: "app-123",
  businessName: "Demo Noodles",
  contactName: "Lin Mei",
  contactEmail: "mei@example.com",
  address: "1 Fengjia Road",
  district: "Xitun District",
  city: "Taichung City",
  latitude: 24.147736,
  longitude: 120.673648,
  planId: "standard",
  assignedSubdomain: "demo-noodles",
  status,
  createdAt: "2026-09-15T00:00:00.000Z",
  rejectionReason,
});

describe("ApplicationStatusView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.params.applicationId = "app-123";
    mocks.route.hash = "#tracking-secret";
  });

  it.each(["submitted", "provisioning", "completed"])(
    "loads and displays a %s application",
    async (status) => {
      mocks.getApplication.mockResolvedValue(application(status));

      const wrapper = mount(ApplicationStatusView);
      await flushPromises();

      expect(mocks.getApplication).toHaveBeenCalledWith(
        "app-123",
        "tracking-secret",
      );
      expect(wrapper.text()).toContain(`status.labels.${status}`);
    },
  );

  it("displays the rejection reason for a rejected application", async () => {
    mocks.getApplication.mockResolvedValue(
      application("rejected", "Please provide your business registration."),
    );

    const wrapper = mount(ApplicationStatusView);
    await flushPromises();

    expect(wrapper.text()).toContain("status.labels.rejected");
    expect(wrapper.text()).toContain(
      "Please provide your business registration.",
    );
  });

  it("does not fetch when the tracking secret is absent from the fragment", async () => {
    mocks.route.hash = "";

    const wrapper = mount(ApplicationStatusView);
    await flushPromises();

    expect(mocks.getApplication).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("status.error.missingLink");
  });

  it("shows an invalid-link error for a rejected secret", async () => {
    mocks.getApplication.mockRejectedValue(
      new ApiError(
        "Application secret is required",
        "APPLICATION_SECRET_REQUIRED",
      ),
    );

    const wrapper = mount(ApplicationStatusView);
    await flushPromises();

    expect(wrapper.text()).toContain("status.error.invalidLink");
  });
});
