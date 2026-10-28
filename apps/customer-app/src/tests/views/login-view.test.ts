import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import LoginView from "@/views/LoginView.vue";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${JSON.stringify(params)}`,
  }),
}));

const storeMocks = vi.hoisted(() => ({
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  loginWithPassword: vi.fn(),
  checkAuth: vi.fn(),
  isAuthenticated: false,
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => storeMocks,
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  query: {} as Record<string, string>,
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerMocks.push }),
  useRoute: () => ({ query: routerMocks.query }),
}));

const mountView = () =>
  mount(LoginView, { global: { stubs: { RouterLink: true } } });

beforeEach(() => {
  vi.clearAllMocks();
  routerMocks.query = {};
});

describe("LoginView", () => {
  it("asks for a code before accepting one on the OTP tab", async () => {
    storeMocks.requestOtp.mockResolvedValue({ success: true, data: {} });
    const wrapper = mountView();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="tab-otp"]').attributes("data-active"),
    ).toBe("true");
    expect(wrapper.find('[data-testid="otp-input"]').exists()).toBe(false);

    await wrapper.find('[data-testid="phone-input"]').setValue("0912345678");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(storeMocks.requestOtp).toHaveBeenCalledOnce();
    expect(storeMocks.requestOtp).toHaveBeenCalledWith("0912345678");
    expect(storeMocks.verifyOtp).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="otp-input"]').exists()).toBe(true);
  });

  it("signs in with a password from the same screen", async () => {
    storeMocks.loginWithPassword.mockResolvedValue({ success: true });
    const wrapper = mountView();
    await flushPromises();

    await wrapper.find('[data-testid="tab-password"]').trigger("click");

    expect(wrapper.find('[data-testid="phone-input"]').exists()).toBe(false);
    await wrapper
      .find('[data-testid="identifier-input"]')
      .setValue("mei@example.com");
    await wrapper
      .find('[data-testid="password-input"]')
      .setValue("correct-horse-battery");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(storeMocks.loginWithPassword).toHaveBeenCalledOnce();
    expect(storeMocks.loginWithPassword).toHaveBeenCalledWith(
      "mei@example.com",
      "correct-horse-battery",
    );
    expect(routerMocks.push).toHaveBeenCalledWith("/profile");
  });

  it("honours the redirect query after a password sign-in", async () => {
    routerMocks.query = { redirect: "/orders/42" };
    storeMocks.loginWithPassword.mockResolvedValue({ success: true });
    const wrapper = mountView();
    await flushPromises();

    await wrapper.find('[data-testid="tab-password"]').trigger("click");
    await wrapper
      .find('[data-testid="identifier-input"]')
      .setValue("mei@example.com");
    await wrapper
      .find('[data-testid="password-input"]')
      .setValue("correct-horse-battery");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(routerMocks.push).toHaveBeenCalledWith("/orders/42");
  });

  it("shows the server's sentence verbatim, and the same one either way", async () => {
    // The API deliberately answers "no such account" and "wrong password" with
    // one identical message. Re-deriving a more specific one in the view would
    // hand back the account-enumeration oracle the API is avoiding.
    const serverMessage = "Invalid identifier or password";
    storeMocks.loginWithPassword.mockResolvedValue({
      success: false,
      error: serverMessage,
    });

    const wrapper = mountView();
    await flushPromises();
    await wrapper.find('[data-testid="tab-password"]').trigger("click");

    const submitWith = async (identifier: string) => {
      await wrapper
        .find('[data-testid="identifier-input"]')
        .setValue(identifier);
      await wrapper
        .find('[data-testid="password-input"]')
        .setValue("some-long-password");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      return wrapper.find('[data-testid="auth-error"]').text();
    };

    const unknownAccount = await submitWith("ghost@example.com");
    const wrongPassword = await submitWith("mei@example.com");

    expect(unknownAccount).toBe(serverMessage);
    expect(wrongPassword).toBe(unknownAccount);
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it("goes straight to the code field when registration already sent one", async () => {
    routerMocks.query = { phone: "+886912345678", otpSent: "1" };
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('[data-testid="otp-input"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="registration-otp-notice"]').exists(),
    ).toBe(true);
    // A second request would cost the diner another SMS for no reason.
    expect(storeMocks.requestOtp).not.toHaveBeenCalled();

    await wrapper.find('[data-testid="otp-input"]').setValue("123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(storeMocks.verifyOtp).toHaveBeenCalledWith(
      "+886912345678",
      "123456",
    );
  });

  it("opens on the password tab when the link asks for it", async () => {
    routerMocks.query = { mode: "password" };
    const wrapper = mountView();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="tab-password"]').attributes("data-active"),
    ).toBe("true");
    expect(wrapper.find('[data-testid="identifier-input"]').exists()).toBe(
      true,
    );
  });
  it("keeps an authenticated customer on the OTP step for a phone-recovery request", async () => {
    routerMocks.query = {
      mode: "otp",
      phone: "0912345678",
      redirect: "/r/rest-1/wait-list",
    };
    storeMocks.isAuthenticated = true;
    storeMocks.checkAuth.mockResolvedValue(true);
    storeMocks.requestOtp.mockResolvedValue({ success: true, data: {} });
    storeMocks.verifyOtp.mockResolvedValue({ success: true });
    try {
      const wrapper = mountView();
      await flushPromises();

      expect(routerMocks.push).not.toHaveBeenCalled();
      expect(
        wrapper.find('[data-testid="phone-input"]').element,
      ).toHaveProperty("value", "0912345678");

      await wrapper.find("form").trigger("submit");
      await flushPromises();
      await wrapper.find('[data-testid="otp-input"]').setValue("123456");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      expect(storeMocks.verifyOtp).toHaveBeenCalledWith("0912345678", "123456");
      expect(routerMocks.push).toHaveBeenCalledOnce();
      expect(routerMocks.push).toHaveBeenCalledWith("/r/rest-1/wait-list");
    } finally {
      storeMocks.isAuthenticated = false;
    }
  });

  it("still sends an authenticated customer on a plain /login to /orders", async () => {
    storeMocks.isAuthenticated = true;
    storeMocks.checkAuth.mockResolvedValue(true);
    try {
      mountView();
      await flushPromises();

      expect(routerMocks.push).toHaveBeenCalledWith("/orders");
    } finally {
      storeMocks.isAuthenticated = false;
    }
  });

  it("ignores a redirect that would leave the app", async () => {
    routerMocks.query = { redirect: "//evil.example/x" };
    storeMocks.loginWithPassword.mockResolvedValue({ success: true });
    const wrapper = mountView();
    await flushPromises();

    await wrapper.find('[data-testid="tab-password"]').trigger("click");
    await wrapper.find('[data-testid="identifier-input"]').setValue("a@b.co");
    await wrapper.find('[data-testid="password-input"]').setValue("pw-123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(routerMocks.push).toHaveBeenCalledWith("/profile");
  });
});
