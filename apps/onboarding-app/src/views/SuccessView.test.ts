import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  route: { hash: "#unique-secret" },
  push: vi.fn(),
  copy: vi.fn(async () => {}),
  toast: vi.fn(),
  store: {
    applicationId: "APP-1",
    applicationSecret: "unique-secret",
    application: {
      businessName: "Laksa Shop",
      contactEmail: "owner@example.test",
      planId: "standard",
    },
    assignedSubdomain: "laksa-shop",
    reset: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/stores/onboarding", () => ({
  useOnboardingStore: () => mocks.store,
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: mocks.toast }),
}));

import SuccessView from "./SuccessView.vue";

describe("application success status link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.copy },
    });
  });

  it("shows and copies an absolute fragment-only link without storing the secret", async () => {
    const wrapper = mount(SuccessView);
    const link = wrapper.get("[data-testid=onboarding-status-link]");
    const expected = `${window.location.origin}/status/APP-1#unique-secret`;
    expect(link.text()).toContain(expected);
    expect(wrapper.get("a[href]").attributes("href")).toBe(
      "/status/APP-1#unique-secret",
    );

    await wrapper
      .get("[data-testid=copy-onboarding-status-link]")
      .trigger("click");
    expect(mocks.copy).toHaveBeenCalledWith(expected);
    expect(
      sessionStorage.getItem("onboarding_application") ?? "",
    ).not.toContain("unique-secret");
  });
});
