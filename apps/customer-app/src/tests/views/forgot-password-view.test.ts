/**
 * #353: a phone-registered diner used to be told to "check your inbox" for a
 * reset link that had no channel to travel on. The phone branch now stays on
 * this screen and takes the SMS code instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ForgotPasswordView from "@/views/ForgotPasswordView.vue";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${JSON.stringify(params)}`,
  }),
}));

const apiMocks = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  verifyPasswordResetOtp: vi.fn(),
}));

vi.mock("@/services/customerIdentityApi", () => ({
  customerIdentityApi: apiMocks,
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerMocks.push }),
  useRoute: () => ({ query: {} }),
}));

const PHONE = "0912345678";

const mountView = () =>
  mount(ForgotPasswordView, { global: { stubs: { RouterLink: true } } });

/** Shape the api client hands a view for a rejected credential check. */
function invalidOtpError() {
  return Object.assign(new Error("Invalid or expired OTP"), {
    code: "INVALID_OTP",
    status: 401,
  });
}

async function requestCodeFor(identifier: string) {
  apiMocks.forgotPassword.mockResolvedValue({ sent: true });
  const wrapper = mountView();
  await wrapper.find('[data-testid="identifier-input"]').setValue(identifier);
  await wrapper.find("form").trigger("submit");
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ForgotPasswordView", () => {
  it("keeps the mailed-link panel for an email identifier", async () => {
    const wrapper = await requestCodeFor("  mei@example.com  ");

    expect(apiMocks.forgotPassword).toHaveBeenCalledOnce();
    expect(apiMocks.forgotPassword).toHaveBeenCalledWith("mei@example.com");
    expect(wrapper.find('[data-testid="sent-panel"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("auth.forgotPasswordSent");
    expect(wrapper.find('[data-testid="otp-panel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="otp-input"]').exists()).toBe(false);
  });

  it("asks a phone identifier for the SMS code instead of an inbox", async () => {
    const wrapper = await requestCodeFor(PHONE);

    expect(apiMocks.forgotPassword).toHaveBeenCalledOnce();
    expect(apiMocks.forgotPassword).toHaveBeenCalledWith(PHONE);
    expect(wrapper.find('[data-testid="otp-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="otp-input"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("auth.forgotPasswordOtpSent");
    // The email copy told a phone diner to check a mailbox they never gave us.
    expect(wrapper.find('[data-testid="sent-panel"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("auth.forgotPasswordSent");
  });

  it("trades a valid code for a reset token and carries it to /reset-password", async () => {
    apiMocks.verifyPasswordResetOtp.mockResolvedValue({
      resetToken: "reset-token-value-0001",
      expiresInSeconds: 900,
    });
    const wrapper = await requestCodeFor(PHONE);

    await wrapper.find('[data-testid="otp-input"]').setValue("123456");
    await wrapper.find('[data-testid="otp-panel"] form').trigger("submit");
    await flushPromises();

    expect(apiMocks.verifyPasswordResetOtp).toHaveBeenCalledOnce();
    expect(apiMocks.verifyPasswordResetOtp).toHaveBeenCalledWith(
      PHONE,
      "123456",
    );
    expect(routerMocks.push).toHaveBeenCalledWith({
      path: "/reset-password",
      query: { token: "reset-token-value-0001" },
    });
  });

  it("lets a wrong code be retyped rather than restarting the flow", async () => {
    apiMocks.verifyPasswordResetOtp.mockRejectedValue(invalidOtpError());
    const wrapper = await requestCodeFor(PHONE);

    await wrapper.find('[data-testid="otp-input"]').setValue("000000");
    await wrapper.find('[data-testid="otp-panel"] form').trigger("submit");
    await flushPromises();

    expect(wrapper.find('[data-testid="otp-error"]').text()).toBe(
      "auth.forgotPasswordOtpInvalid",
    );
    expect(routerMocks.push).not.toHaveBeenCalled();
    // Still on the code step: a second SMS would otherwise be the only way out.
    expect(wrapper.find('[data-testid="otp-input"]').exists()).toBe(true);
  });

  it("rejects a code that is not six digits without spending a request", async () => {
    const wrapper = await requestCodeFor(PHONE);

    await wrapper.find('[data-testid="otp-input"]').setValue("12345");
    await wrapper.find('[data-testid="otp-panel"] form').trigger("submit");
    await flushPromises();

    expect(wrapper.find('[data-testid="otp-error"]').text()).toBe(
      "auth.otpRequired",
    );
    expect(apiMocks.verifyPasswordResetOtp).not.toHaveBeenCalled();
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it("still validates an empty identifier before calling the API", async () => {
    const wrapper = mountView();

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(apiMocks.forgotPassword).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("auth.identifierRequired");
  });
});
