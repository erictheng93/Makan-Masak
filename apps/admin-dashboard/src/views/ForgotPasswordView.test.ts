// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordView from "./ForgotPasswordView.vue";
import { api } from "@/services/api";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/api", () => ({
  api: { instance: { post: vi.fn() } },
}));

const SERVER_MESSAGE = "Password reset email sent";

describe("ForgotPasswordView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.instance.post).mockResolvedValue({
      status: 200,
      data: { success: true, message: SERVER_MESSAGE },
    });
  });

  it("confirms the request with local copy only, not the API's English message", async () => {
    const wrapper = mount(ForgotPasswordView, {
      global: { stubs: { RouterLink: true, "router-link": true } },
    });

    await wrapper.get('input[type="email"]').setValue("owner@example.test");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(api.instance.post).toHaveBeenCalledOnce();
    expect(api.instance.post).toHaveBeenCalledWith(
      "/auth/forgot-password",
      expect.objectContaining({ identifier: "owner@example.test" }),
      expect.any(Object),
    );
    expect(wrapper.text()).toContain("auth.emailSent");
    expect(wrapper.text()).toContain("auth.emailSentMessage");
    expect(wrapper.text()).not.toContain(SERVER_MESSAGE);
  });
});
