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

  async function submitNewPassword() {
    const wrapper = mount(ResetPasswordView, {
      global: { stubs: { RouterLink: true, "router-link": true } },
    });
    await flushPromises();

    const inputs = wrapper.findAll('input[type="password"]');
    expect(inputs).toHaveLength(2);
    await inputs[0].setValue("Owner@2026x");
    await inputs[1].setValue("Owner@2026x");
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
});
