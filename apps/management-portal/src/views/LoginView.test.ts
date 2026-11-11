import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginView from "./LoginView.vue";
import { authApi } from "@/services/api";

const replace = vi.fn();
const routeState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ replace }),
}));

vi.mock("@/services/api", () => ({
  authApi: {
    exchange: vi.fn(),
  },
}));

describe("LoginView", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    routeState.query = {};
    replace.mockReset();
    vi.mocked(authApi.exchange).mockReset();
  });

  it("exchanges an API token, stores the management token, and redirects", async () => {
    routeState.query = { redirect: "/health" };
    vi.mocked(authApi.exchange).mockResolvedValue({
      token: "management-jwt",
      tokenType: "Bearer",
      expiresAt: 1_780_000_600,
    });
    const wrapper = mount(LoginView);

    await wrapper.find("textarea").setValue(" api-admin-token ");
    await wrapper.find("form").trigger("submit.prevent");

    expect(authApi.exchange).toHaveBeenCalledWith("api-admin-token");
    expect(sessionStorage.getItem("management_token")).toBe("management-jwt");
    expect(sessionStorage.getItem("management_token_expires_at")).toBe(
      "1780000600",
    );
    expect(localStorage.getItem("management_token")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/health");
  });

  it("shows an error and does not store a token when exchange fails", async () => {
    vi.mocked(authApi.exchange).mockRejectedValue(new Error("forbidden"));
    const wrapper = mount(LoginView);

    await wrapper.find("textarea").setValue("invalid-token");
    await wrapper.find("form").trigger("submit.prevent");

    expect(sessionStorage.getItem("management_token")).toBeNull();
    expect(wrapper.text()).toContain("登入失敗");
    const errorId = wrapper.get('[role="alert"]').attributes("id");
    expect(errorId).toBeTruthy();
    expect(wrapper.get("textarea").attributes("aria-describedby")).toBe(
      errorId,
    );
    expect(wrapper.get("textarea").attributes("aria-invalid")).toBe("true");
    expect(replace).not.toHaveBeenCalled();
  });
});
