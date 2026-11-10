// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginView from "./LoginView.vue";
import { api } from "@/services/api";

const { login, push, route } = vi.hoisted(() => ({
  login: vi.fn(),
  push: vi.fn(),
  route: {
    name: "Login" as string,
    params: {} as Record<string, string>,
    query: {} as Record<string, string>,
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
  }),
}));
vi.mock("@/services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    isAuthenticated: false,
    user: null,
    login,
    logout: vi.fn(),
    getDefaultRoute: () => "/dashboard",
  }),
}));

const stubs = { RouterLink: { template: "<a><slot /></a>" } };

async function mountView() {
  const wrapper = mount(LoginView, { global: { stubs } });
  await flushPromises();
  return wrapper;
}

async function submit(wrapper: Awaited<ReturnType<typeof mountView>>) {
  await wrapper.get("#username").setValue("alice");
  await wrapper.get("#password").setValue("secret123");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

describe("LoginView shop mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    route.name = "Login";
    route.params = {};
    route.query = {};
    login.mockResolvedValue({ success: true });
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: { slug: "noodle-bar", name: "Noodle Bar", logoUrl: null },
      },
    } as never);
  });

  it("shows the shop name on /s/:slug and signs in with the shop", async () => {
    route.name = "ShopLogin";
    route.params = { slug: "noodle-bar" };

    const wrapper = await mountView();
    await submit(wrapper);

    expect(api.get).toHaveBeenCalledWith(
      "/restaurants/login-context/noodle-bar",
    );
    expect(wrapper.get('[data-testid="login-shop"]').text()).toContain(
      "Noodle Bar",
    );
    expect(login).toHaveBeenCalledOnce();
    expect(login).toHaveBeenCalledWith("alice", "secret123", "noodle-bar");
  });

  it("shows the invalid-link message when the shop is unknown", async () => {
    route.name = "ShopLogin";
    route.params = { slug: "nope-nope" };
    vi.mocked(api.get).mockRejectedValue({
      response: {
        status: 404,
        data: { success: false, error: { code: "SHOP_NOT_FOUND" } },
      },
    });

    const wrapper = await mountView();
    await submit(wrapper);

    expect(wrapper.get('[data-testid="login-shop-invalid"]').text()).toContain(
      "auth.shopInvalidLink",
    );
    expect(login).toHaveBeenCalledWith("alice", "secret123", undefined);
  });

  it("shows the store's SHOP_REQUIRED message on /login", async () => {
    login.mockResolvedValue({ success: false, error: "auth.shopRequired" });

    const wrapper = await mountView();
    await submit(wrapper);

    expect(wrapper.text()).toContain("auth.shopRequired");
    expect(login).toHaveBeenCalledWith("alice", "secret123", undefined);
  });

  it("sends the remembered shop on /login and stops once cleared", async () => {
    localStorage.setItem("mm_admin_login_shop", "noodle-bar");

    const wrapper = await mountView();
    expect(wrapper.get('[data-testid="login-shop"]').text()).toContain(
      "auth.shopSigningIn:Noodle Bar",
    );
    await submit(wrapper);
    expect(login).toHaveBeenLastCalledWith("alice", "secret123", "noodle-bar");

    await wrapper.get('[data-testid="login-shop-clear"]').trigger("click");
    expect(wrapper.find('[data-testid="login-shop"]').exists()).toBe(false);
    expect(localStorage.getItem("mm_admin_login_shop")).toBeNull();

    await submit(wrapper);
    expect(login).toHaveBeenLastCalledWith("alice", "secret123", undefined);
  });
});
