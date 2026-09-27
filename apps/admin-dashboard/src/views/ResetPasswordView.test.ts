// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordView from "./ResetPasswordView.vue";
import { api } from "@/services/api";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const push = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { token: "setup-token" } }),
  useRouter: () => ({ push }),
}));

vi.mock("@/services/api", () => ({
  api: { instance: { get: vi.fn(), post: vi.fn() } },
}));

// The API answers in English. Onboarded owners land on this page first, so
// that sentence must never reach a zh-TW screen.
const SERVER_MESSAGE = "Password reset successfully";

describe("ResetPasswordView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.instance.get).mockResolvedValue({
      status: 200,
      data: { valid: true, email: "own***@example.test" },
    });
    vi.mocked(api.instance.post).mockResolvedValue({
      status: 200,
      data: { success: true, message: SERVER_MESSAGE },
    });
  });

  async function submitNewPassword(password = "Owner@2026x") {
    const wrapper = mount(ResetPasswordView, {
      global: { stubs: { RouterLink: true, "router-link": true } },
    });
    await flushPromises();

    const inputs = wrapper.findAll('input[type="password"]');
    expect(inputs).toHaveLength(2);
    await inputs[0].setValue(password);
    await inputs[1].setValue(password);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    return wrapper;
  }

  it("confirms the reset with local copy only, not the API's English message", async () => {
    const wrapper = await submitNewPassword();

    expect(api.instance.post).toHaveBeenCalledOnce();
    expect(api.instance.post).toHaveBeenCalledWith(
      "/auth/reset-password",
      expect.objectContaining({
        token: "setup-token",
        newPassword: "Owner@2026x",
      }),
      expect.any(Object),
    );
    expect(wrapper.text()).toContain("auth.resetSuccess");
    expect(wrapper.text()).toContain("auth.resetSuccessMessage");
    expect(wrapper.text()).not.toContain(SERVER_MESSAGE);
  });

  // The API requires 8+ characters with upper, lower, a digit and one of
  // @$!%*?&. Each of these used to pass the page's hints and then fail on
  // the server with a generic message; the page now names what is missing.
  it.each([
    ["Aming2026Rice", "symbol"],
    ["Aming#2026Rice", "symbol"],
    ["Ab1@x", "length"],
    ["abcde@12345", "uppercase"],
    ["#Abcdef1!", "start"],
  ])("blocks %s and flags the %s requirement", async (password, missing) => {
    const wrapper = await submitNewPassword(password);

    expect(api.instance.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("auth.passwordMissing");
    const missingKeys = wrapper
      .findAll('[data-status="missing"]')
      .map((li) => li.attributes("data-requirement"));
    expect(missingKeys).toEqual([missing]);
  });

  it("lists the rule before anything is typed", async () => {
    const wrapper = mount(ResetPasswordView, {
      global: { stubs: { RouterLink: true, "router-link": true } },
    });
    await flushPromises();

    expect(
      wrapper
        .findAll("[data-requirement]")
        .map((li) => li.attributes("data-requirement")),
    ).toEqual(["length", "uppercase", "lowercase", "number", "symbol"]);
  });

  it("explains the password rule when the server rejects it", async () => {
    vi.mocked(api.instance.post).mockResolvedValue({
      status: 400,
      data: {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Validation failed" },
      },
    });

    const wrapper = await submitNewPassword();

    expect(api.instance.post).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("auth.passwordRequirementsNotMet");
    expect(wrapper.text()).not.toContain("Validation failed");
  });
});
