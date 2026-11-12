// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";

const { loginWithOAuth, login, push, replace, route } = vi.hoisted(() => ({
  loginWithOAuth: vi.fn(),
  login: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  route: {
    name: "Login" as string,
    path: "/login",
    params: {} as Record<string, string>,
    query: {} as Record<string, string>,
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push, replace }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/services/api", () => ({
  api: { get: vi.fn() },
  resolveApiBase: () => "/api/v1",
  unwrapApiData: (r: { data: { data: unknown } }) => r.data.data,
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    isAuthenticated: false,
    user: null,
    login,
    loginWithOAuth,
    logout: vi.fn(),
    getDefaultRoute: () => "/dashboard",
  }),
}));

const stubs = { RouterLink: { template: "<a><slot /></a>" } };
const assign = vi.fn();
let LoginView: typeof import("./LoginView.vue").default;

beforeAll(async () => {
  LoginView = (await import("./LoginView.vue")).default;
}, 30_000);

function providersResponse(providers: string[]) {
  vi.mocked(api.get).mockImplementation((async (url: string) =>
    url === "/auth/oauth/providers"
      ? { data: { success: true, data: { providers } } }
      : { data: { success: true, data: {} } }) as never);
}

async function mountView() {
  const wrapper = mount(LoginView, { global: { stubs } });
  await flushPromises();
  return wrapper;
}

describe("LoginView OAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    route.name = "Login";
    route.path = "/login";
    route.params = {};
    route.query = {};
    vi.stubGlobal("location", { ...window.location, assign });
    providersResponse(["google", "line"]);
    login.mockResolvedValue({ success: true });
  });

  it("renders no OAuth UI and keeps password login when there are no providers", async () => {
    providersResponse([]);
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="oauth-section"]').exists()).toBe(false);
    await wrapper.get("#username").setValue("alice");
    await wrapper.get("#password").setValue("secret123");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(login).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("treats a failing providers request as no providers", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("offline"));
    const wrapper = await mountView();
    expect(wrapper.find('[data-testid="oauth-section"]').exists()).toBe(false);
  });

  it("navigates to the start URL returning to /login", async () => {
    const wrapper = await mountView();
    await wrapper.get('[data-testid="oauth-google"]').trigger("click");
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(
      "/api/v1/auth/oauth/google/start?redirectTo=%2Flogin",
    );
  });

  it("returns to /s/:slug and keeps the redirect param", async () => {
    route.name = "ShopLogin";
    route.path = "/s/noodle-bar";
    route.params = { slug: "noodle-bar" };
    route.query = { redirect: "/dashboard/menu?x=1" };
    const wrapper = await mountView();
    await wrapper.get('[data-testid="oauth-line"]').trigger("click");
    expect(assign).toHaveBeenCalledWith(
      `/api/v1/auth/oauth/line/start?redirectTo=${encodeURIComponent(
        "/s/noodle-bar?redirect=" + encodeURIComponent("/dashboard/menu?x=1"),
      )}`,
    );
  });

  it("strips oauth_code, completes once, then redirects", async () => {
    route.query = { oauth_code: "abc", redirect: "/dashboard/menu" };
    loginWithOAuth.mockResolvedValue({ success: true });
    await mountView();

    expect(replace).toHaveBeenCalledOnce();
    const replaced = replace.mock.calls[0][0] as {
      query: Record<string, string>;
    };
    expect(replaced.query).toEqual({ redirect: "/dashboard/menu" });
    expect(loginWithOAuth).toHaveBeenCalledOnce();
    expect(loginWithOAuth).toHaveBeenCalledWith("abc");
    expect(push).toHaveBeenCalledWith("/dashboard/menu");
  });

  it("shows an inline error and does not redirect when complete fails", async () => {
    route.query = { oauth_code: "burned" };
    loginWithOAuth.mockResolvedValue({
      success: false,
      error: "auth.oauth.completeFailed",
    });
    const wrapper = await mountView();

    const message = wrapper.get('[data-testid="oauth-message"]');
    expect(message.text()).toBe("auth.oauth.completeFailed");
    expect(message.attributes("role")).toBe("alert");
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["OAUTH_IDENTITY_NOT_LINKED", "error"],
    ["OAUTH_STATE_INVALID", "error"],
    ["OAUTH_CALLBACK_INVALID", "error"],
    ["OAUTH_VERIFICATION_FAILED", "error"],
    ["declined", "notice"],
  ])("maps oauth_error %s", async (code, kind) => {
    route.query = { oauth_error: code };
    const wrapper = await mountView();

    const message = wrapper.get('[data-testid="oauth-message"]');
    expect(message.text()).toBe(`auth.oauth.errors.${code}`);
    expect(message.attributes("data-kind")).toBe(kind);
    expect(replace).toHaveBeenCalledOnce();
    expect(loginWithOAuth).not.toHaveBeenCalled();
  });

  it("uses generic copy for an unknown code and never prints it", async () => {
    route.query = { oauth_error: "SOMETHING_ODD" };
    const wrapper = await mountView();
    const text = wrapper.get('[data-testid="oauth-message"]').text();
    expect(text).toBe("auth.oauth.errors.generic");
    expect(text).not.toContain("SOMETHING_ODD");
  });
});
