// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeParams = vi.hoisted(() => ({ value: {} as Record<string, string> }));
const push = vi.hoisted(() => vi.fn());
const login = vi.hoisted(() => vi.fn());
const getLoginContext = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: routeParams.value }),
}));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ initialize: vi.fn() }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    isAuthenticated: false,
    restaurantId: 7,
    login,
  }),
}));
vi.mock("@/services/authApi", () => ({ authApi: { getLoginContext } }));

import LoginView from "./LoginView.vue";

const apiError = (status: number, code: string) => ({
  response: { status, data: { success: false, error: { code, message: "x" } } },
});

async function submit(wrapper: ReturnType<typeof mount>) {
  await wrapper.find("#username").setValue("chef1");
  await wrapper.find("#password").setValue("pw");
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

beforeEach(() => {
  routeParams.value = {};
  login.mockResolvedValue({ success: true });
  getLoginContext.mockResolvedValue({
    slug: "my-shop",
    name: "Warung Maju",
    logoUrl: null,
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("kitchen LoginView shop mode", () => {
  it("shows the shop name on /s/:slug and sends shop on login", async () => {
    routeParams.value = { slug: "my-shop" };
    const wrapper = mount(LoginView);
    await flushPromises();

    expect(getLoginContext).toHaveBeenCalledWith("my-shop");
    expect(wrapper.find('[data-testid="login-shop"]').text()).toContain(
      "Warung Maju",
    );

    await submit(wrapper);
    expect(login).toHaveBeenCalledOnce();
    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({ username: "chef1", shop: "my-shop" }),
    );
  });

  it("shows an invalid-link message on a 404 and blocks sign-in", async () => {
    routeParams.value = { slug: "nope" };
    getLoginContext.mockRejectedValue(apiError(404, "SHOP_NOT_FOUND"));
    const wrapper = mount(LoginView);
    await flushPromises();

    expect(wrapper.text()).toContain("login.shopNotFound");
    await submit(wrapper);
    expect(login).not.toHaveBeenCalled();
  });

  it("shows the use-your-shop-link message on SHOP_REQUIRED", async () => {
    login.mockRejectedValue(apiError(400, "SHOP_REQUIRED"));
    const wrapper = mount(LoginView);
    await flushPromises();
    await submit(wrapper);

    expect(login).toHaveBeenCalledWith(
      expect.not.objectContaining({ shop: expect.anything() }),
    );
    expect(wrapper.text()).toContain("login.shopRequired");
  });

  it("sends a remembered shop on /login and can clear it", async () => {
    localStorage.setItem("mm_kitchen_login_shop", "my-shop");
    const wrapper = mount(LoginView);
    await flushPromises();

    await submit(wrapper);
    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({ shop: "my-shop" }),
    );

    await wrapper.find('[data-testid="login-shop-clear"]').trigger("click");
    expect(wrapper.find('[data-testid="login-shop"]').exists()).toBe(false);
    expect(localStorage.getItem("mm_kitchen_login_shop")).toBeNull();

    login.mockClear();
    await submit(wrapper);
    expect(login).toHaveBeenCalledWith(
      expect.not.objectContaining({ shop: expect.anything() }),
    );
  });
});
