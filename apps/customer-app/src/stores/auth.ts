import { defineStore } from "pinia";
import { ref, computed, readonly } from "vue";
import { getRefreshDelay } from "@makanmasak/utils";
import {
  customerIdentityApi,
  type CustomerRegistration,
  type CustomerSummary,
} from "@/services/customerIdentityApi";
import {
  clearCustomerAccessToken,
  setCustomerAccessToken,
} from "@/services/customerAccessToken";
import { resetFollowing } from "@/composables/useFollowing";
import { translate as t } from "@/utils/i18n";

// 定義客戶用戶類型
export interface CustomerUser {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  role: number;
}

// Hydrate user from localStorage for instant restore on page refresh.
// Without this, refreshing any authenticated view kicks the user back to
// /login because the router guard checks `isAuthenticated` (which depends
// on `!!user`) before `checkAuth()` has a chance to fetch the user.
const hydrateUser = (): CustomerUser | null => {
  try {
    const saved = localStorage.getItem("customer_user");
    return saved ? (JSON.parse(saved) as CustomerUser) : null;
  } catch {
    localStorage.removeItem("customer_user");
    return null;
  }
};

const persistUser = (u: CustomerUser | null): void => {
  if (u) {
    localStorage.setItem("customer_user", JSON.stringify(u));
  } else {
    localStorage.removeItem("customer_user");
  }
};

const toCustomerUser = (customer: CustomerSummary): CustomerUser => ({
  id: customer.id,
  username: customer.primaryPhone || customer.primaryEmail || customer.id,
  fullName: customer.displayName,
  email: customer.primaryEmail || undefined,
  phone: customer.primaryPhone || undefined,
  role: 5,
});

const failureMessage = (_err: unknown): string => t("auth.loginFailed");

const failureCode = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

export const useAuthStore = defineStore("auth", () => {
  // 狀態
  sessionStorage.removeItem("customer_auth_token");
  const user = ref<CustomerUser | null>(hydrateUser());
  const token = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // 計算屬性
  const isAuthenticated = computed(() => !!user.value && !!token.value);
  const userId = computed(() => user.value?.id);
  const userName = computed(() => user.value?.fullName || user.value?.username);

  // 清除錯誤
  const clearError = () => {
    error.value = null;
  };

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleProactiveRefresh = (accessToken: string) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const delay = getRefreshDelay(accessToken);
    if (!delay || delay <= 0) return;
    refreshTimer = setTimeout(async () => {
      await refresh();
    }, delay);
  };

  const clearRefreshTimer = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };

  /**
   * The single place a customer session lands. OTP and password sign-in must
   * not each keep their own copy — the moment they diverge one of the two
   * starts skipping the proactive refresh or the persisted user.
   */
  const adoptSession = (session: {
    accessToken: string;
    customer: CustomerSummary;
  }) => {
    token.value = session.accessToken;
    user.value = toCustomerUser(session.customer);

    setCustomerAccessToken(session.accessToken);
    persistUser(user.value);

    scheduleProactiveRefresh(session.accessToken);
  };

  const requestOtp = async (phone: string) => {
    isLoading.value = true;
    error.value = null;

    try {
      const data = await customerIdentityApi.requestOtp(phone);
      return { success: true, data };
    } catch (err: unknown) {
      error.value = failureMessage(err);
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  };

  const verifyOtp = async (phone: string, otp: string) => {
    isLoading.value = true;
    error.value = null;

    try {
      const data = await customerIdentityApi.verifyOtp(phone, otp);

      if (data.accessToken && data.customer) {
        adoptSession(data);
        return { success: true };
      }

      error.value = t("auth.loginFailed");
      return { success: false, error: error.value };
    } catch (err: unknown) {
      error.value = failureMessage(err);
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  };

  const loginWithPassword = async (identifier: string, password: string) => {
    isLoading.value = true;
    error.value = null;

    try {
      const data = await customerIdentityApi.loginWithPassword(
        identifier,
        password,
      );

      if (data.accessToken && data.customer) {
        adoptSession(data);
        return { success: true };
      }

      error.value = t("auth.loginFailed");
      return { success: false, error: error.value };
    } catch (err: unknown) {
      error.value = failureMessage(err);
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  };

  // Legacy username/password login is intentionally no longer used by the
  // customer app. Keep the method name as a compatibility wrapper for callers
  // that still submit a phone + OTP pair.
  const login = async (phone: string, otp: string) => verifyOtp(phone, otp);

  /**
   * Registration never yields a session — the identity has to be verified
   * first, through whichever channel `verificationMethod` names. Callers must
   * branch on it, and on the VERIFICATION_EMAIL_FAILED code: that one means
   * the account exists but its only activation link never left the building.
   */
  const register = async (input: {
    identifier: string;
    password: string;
    displayName: string;
  }): Promise<
    | { success: true; data: CustomerRegistration }
    | { success: false; error: string; code?: string }
  > => {
    isLoading.value = true;
    error.value = null;

    try {
      const data = await customerIdentityApi.register(input);
      return { success: true, data };
    } catch (err: unknown) {
      error.value = failureMessage(err);
      return { success: false, error: error.value, code: failureCode(err) };
    } finally {
      isLoading.value = false;
    }
  };

  // 登出
  const logout = async () => {
    try {
      if (token.value) {
        await customerIdentityApi.logout();
      }
    } catch (err) {
      console.warn("Logout request failed:", err);
    } finally {
      // 清除本地狀態
      user.value = null;
      token.value = null;
      error.value = null;

      clearCustomerAccessToken();
      // The followed-markets list is module-level shared state, so without this
      // the next diner to sign in on this device starts out looking at the
      // previous one's follows (#335).
      resetFollowing();
      sessionStorage.removeItem("customer_auth_token");
      localStorage.removeItem("customer_refresh_token");
      persistUser(null);
      clearRefreshTimer();
    }
  };

  // 刷新 token
  const refresh = async () => {
    try {
      const data = await customerIdentityApi.refresh();

      if ("accessToken" in data && data.accessToken) {
        token.value = data.accessToken;
        setCustomerAccessToken(token.value);

        if (token.value) scheduleProactiveRefresh(token.value);
        return true;
      }
    } catch (err) {
      console.warn("Token refresh failed:", err);
    }

    // Degrade to reactive mode — don't logout on refresh failure
    return false;
  };

  // 檢查認證狀態
  const checkAuth = async () => {
    if (!token.value && !(await refresh())) {
      return false;
    }

    try {
      const data = await customerIdentityApi.getMe();

      if (data.customer) {
        user.value = toCustomerUser(data.customer);
        persistUser(user.value);
        if (token.value) scheduleProactiveRefresh(token.value);
        return true;
      }
    } catch (err) {
      console.warn("Auth check failed:", err);
    }

    // Attempt refresh before giving up
    const refreshed = await refresh();
    if (refreshed) {
      try {
        const data = await customerIdentityApi.getMe();
        if (data.customer) {
          user.value = toCustomerUser(data.customer);
          persistUser(user.value);
          return true;
        }
      } catch (err) {
        console.warn("Auth check after refresh failed:", err);
      }
    }

    await logout();
    return false;
  };

  // 獲取當前用戶資料
  const fetchUserProfile = async () => {
    if (!token.value) return null;

    try {
      const data = await customerIdentityApi.getMe();

      if (data.customer) {
        user.value = toCustomerUser(data.customer);
        persistUser(user.value);
        return data;
      }
    } catch (err) {
      console.error("Failed to fetch user profile:", err);
    }

    return null;
  };

  return {
    // 狀態
    user: readonly(user),
    token: readonly(token),
    isLoading: readonly(isLoading),
    error: readonly(error),

    // 計算屬性
    isAuthenticated,
    userId,
    userName,

    // 方法
    login,
    requestOtp,
    verifyOtp,
    loginWithPassword,
    register,
    logout,
    checkAuth,
    refresh,
    fetchUserProfile,
    clearError,
  };
});
