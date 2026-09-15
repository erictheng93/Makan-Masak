import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAuthStore } from "@/stores/auth";
import {
  customerIdentityApi,
  type CustomerSummary,
} from "@/services/customerIdentityApi";
import {
  clearCustomerAccessToken,
  hasCustomerAccessToken,
} from "@/services/customerAccessToken";

vi.mock("@/utils/i18n", () => ({
  translate: (key: string) => key,
}));

vi.mock("@makanmasak/utils", () => ({
  getRefreshDelay: vi.fn(() => 0),
}));

vi.mock("@/services/customerIdentityApi", () => ({
  customerIdentityApi: {
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(),
    loginWithPassword: vi.fn(),
    register: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  },
}));

const customer = (
  overrides: Partial<CustomerSummary> = {},
): CustomerSummary => ({
  id: "customer-1",
  displayName: "Lin Mei",
  primaryPhone: "0912345678",
  primaryEmail: "mei@example.com",
  status: "active",
  createdAtMs: 1770000000000,
  updatedAtMs: 1770000000000,
  ...overrides,
});

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  clearCustomerAccessToken();
  setActivePinia(createPinia());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("customer auth store", () => {
  it("does not hydrate an access token from browser storage", () => {
    localStorage.setItem(
      "customer_user",
      JSON.stringify({
        id: "customer-1",
        username: "0912345678",
        fullName: "Lin Mei",
        phone: "0912345678",
        role: 5,
      }),
    );
    sessionStorage.setItem("customer_auth_token", "stored-access");

    const store = useAuthStore();

    expect(store.isAuthenticated).toBe(false);
    expect(store.userId).toBe("customer-1");
    expect(store.userName).toBe("Lin Mei");
    expect(store.token).toBeNull();
  });

  it("requests an OTP with a localized fallback without leaving loading enabled", async () => {
    vi.mocked(customerIdentityApi.requestOtp)
      .mockResolvedValueOnce({
        phone: "0912345678",
        expiresInSeconds: 300,
        devOtp: "123456",
      })
      .mockRejectedValueOnce(new Error("SMS quota exceeded"));
    const store = useAuthStore();

    await expect(store.requestOtp("0912345678")).resolves.toEqual({
      success: true,
      data: {
        phone: "0912345678",
        expiresInSeconds: 300,
        devOtp: "123456",
      },
    });

    await expect(store.requestOtp("0912345678")).resolves.toEqual({
      success: false,
      error: "auth.loginFailed",
    });
    expect(store.error).toBe("auth.loginFailed");
    expect(store.isLoading).toBe(false);
  });

  it("keeps OTP access tokens out of browser storage and maps customer summary to app user", async () => {
    vi.mocked(customerIdentityApi.verifyOtp).mockResolvedValue({
      accessToken: "access-token",
      expiresIn: 3600,
      customer: customer(),
    });
    const store = useAuthStore();

    await expect(store.verifyOtp("0912345678", "123456")).resolves.toEqual({
      success: true,
    });

    expect(store.isAuthenticated).toBe(true);
    expect(store.user).toEqual({
      id: "customer-1",
      username: "0912345678",
      fullName: "Lin Mei",
      email: "mei@example.com",
      phone: "0912345678",
      role: 5,
    });
    expect(sessionStorage.getItem("customer_auth_token")).toBeNull();
    expect(hasCustomerAccessToken()).toBe(true);
    expect(localStorage.getItem("customer_refresh_token")).toBeNull();
    expect(JSON.parse(localStorage.getItem("customer_user")!)).toMatchObject({
      id: "customer-1",
      fullName: "Lin Mei",
    });
  });

  it("refreshes a session without reading or writing an access token in browser storage", async () => {
    sessionStorage.setItem("customer_auth_token", "old-access");
    vi.mocked(customerIdentityApi.getMe).mockResolvedValue({
      customer: customer(),
      preferences: {} as never,
    });
    vi.mocked(customerIdentityApi.refresh).mockResolvedValue({
      accessToken: "new-access",
      expiresIn: 3600,
    });
    const store = useAuthStore();

    await expect(store.checkAuth()).resolves.toBe(true);

    expect(customerIdentityApi.refresh).toHaveBeenCalledWith();
    expect(store.token).toBe("new-access");
    expect(sessionStorage.getItem("customer_auth_token")).toBeNull();
    expect(hasCustomerAccessToken()).toBe(true);
    expect(localStorage.getItem("customer_refresh_token")).toBeNull();
    expect(customerIdentityApi.logout).not.toHaveBeenCalled();
  });

  it("logs out locally even when logout API fails", async () => {
    sessionStorage.setItem("customer_auth_token", "access-token");
    localStorage.setItem(
      "customer_user",
      JSON.stringify({
        id: "customer-1",
        username: "0912345678",
        fullName: "Lin Mei",
        role: 5,
      }),
    );
    vi.mocked(customerIdentityApi.logout).mockRejectedValue(
      new Error("network unavailable"),
    );
    const store = useAuthStore();

    await store.logout();

    expect(store.user).toBeNull();
    expect(store.token).toBeNull();
    expect(sessionStorage.getItem("customer_auth_token")).toBeNull();
    expect(hasCustomerAccessToken()).toBe(false);
    expect(localStorage.getItem("customer_refresh_token")).toBeNull();
    expect(localStorage.getItem("customer_user")).toBeNull();
  });

  it("lands a password session through the same path as an OTP session", async () => {
    vi.mocked(customerIdentityApi.loginWithPassword).mockResolvedValue({
      accessToken: "password-access",
      expiresIn: 3600,
      customer: customer(),
    });
    const store = useAuthStore();

    await expect(
      store.loginWithPassword("mei@example.com", "correct-horse-battery"),
    ).resolves.toEqual({ success: true });

    expect(customerIdentityApi.loginWithPassword).toHaveBeenCalledOnce();
    expect(customerIdentityApi.loginWithPassword).toHaveBeenCalledWith(
      "mei@example.com",
      "correct-horse-battery",
    );
    expect(store.isAuthenticated).toBe(true);
    expect(store.user).toMatchObject({ id: "customer-1", role: 5 });
    expect(sessionStorage.getItem("customer_auth_token")).toBeNull();
    expect(hasCustomerAccessToken()).toBe(true);
    expect(localStorage.getItem("customer_refresh_token")).toBeNull();
    expect(JSON.parse(localStorage.getItem("customer_user")!)).toMatchObject({
      id: "customer-1",
      fullName: "Lin Mei",
    });
  });

  it("uses a localized fallback for a server login failure", async () => {
    // The API answers unknown accounts and wrong passwords with one identical
    // sentence. The store must not enrich or replace it.
    vi.mocked(customerIdentityApi.loginWithPassword).mockRejectedValue(
      new Error("Invalid identifier or password"),
    );
    const store = useAuthStore();

    await expect(
      store.loginWithPassword("ghost@example.com", "whatever-long-enough"),
    ).resolves.toEqual({
      success: false,
      error: "auth.loginFailed",
    });
    expect(store.isAuthenticated).toBe(false);
    expect(store.isLoading).toBe(false);
  });

  it("registers without issuing a session and reports the verification channel", async () => {
    vi.mocked(customerIdentityApi.register).mockResolvedValue({
      customer: {
        id: "customer-2",
        displayName: "Ah Hock",
        primaryPhone: null,
        primaryEmail: null,
        status: "active",
      },
      verificationRequired: true,
      verificationMethod: "email",
    });
    const store = useAuthStore();

    const result = await store.register({
      identifier: "hock@example.com",
      password: "correct-horse-battery",
      displayName: "Ah Hock",
    });

    expect(result).toMatchObject({
      success: true,
      data: { verificationMethod: "email", verificationRequired: true },
    });
    expect(customerIdentityApi.register).toHaveBeenCalledOnce();
    expect(customerIdentityApi.register).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "hock@example.com",
        displayName: "Ah Hock",
      }),
    );
    // Verification comes first — registration never signs anyone in.
    expect(store.isAuthenticated).toBe(false);
    expect(sessionStorage.getItem("customer_auth_token")).toBeNull();
  });

  it("surfaces the error code so callers can offer a resend", async () => {
    const failure = Object.assign(
      new Error(
        "Account created, but the verification email could not be sent",
      ),
      { code: "VERIFICATION_EMAIL_FAILED" },
    );
    vi.mocked(customerIdentityApi.register).mockRejectedValue(failure);
    const store = useAuthStore();

    await expect(
      store.register({
        identifier: "hock@example.com",
        password: "correct-horse-battery",
        displayName: "Ah Hock",
      }),
    ).resolves.toEqual({
      success: false,
      // Not `auth.loginFailed`: this is registration. The store used to hand
      // every auth action the same hardcoded login message, so a registration
      // the server refused -- including the 503 it returns when no
      // verification channel is configured -- told the diner their *login*
      // had failed, on the registration screen.
      error: "auth.registerFailed",
      code: "VERIFICATION_EMAIL_FAILED",
    });
    expect(store.isLoading).toBe(false);
  });

  it("keeps the login wording for sign-in failures", async () => {
    vi.mocked(customerIdentityApi.loginWithPassword).mockRejectedValue(
      new Error("nope"),
    );
    const store = useAuthStore();

    await expect(
      store.loginWithPassword("hock@example.com", "wrong"),
    ).resolves.toEqual({
      success: false,
      error: "auth.loginFailed",
    });
  });
});
