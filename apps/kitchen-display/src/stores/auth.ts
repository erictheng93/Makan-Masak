import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { User } from "@/types";
import { authApi, apiClient } from "@/services/authApi";
import { offlineService } from "@/services/offlineService";
import { isTokenExpired } from "@makanmasak/utils";
import { rememberShop } from "@/utils/login-shop";

export const useAuthStore = defineStore("auth", () => {
  // State
  const user = ref<User | null>(null);
  const token = ref<string | null>(null);
  const loading = ref(false);

  // Getters
  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const isChef = computed(() => user.value?.role === 2);
  const restaurantId = computed(() => user.value?.restaurantId);
  const hasPermission = computed(() => (permission: string) => {
    return user.value?.permissions.includes(permission) ?? false;
  });

  // Actions
  const login = async (credentials: {
    username: string;
    password: string;
    shop?: string;
  }) => {
    loading.value = true;
    try {
      const response = await authApi.login(credentials);

      if (response.success && response.data) {
        const { user: userData, token: authToken } = response.data;

        // 檢查用戶角色是否為廚師
        if (userData.role !== 2) {
          throw new Error("此帳號沒有廚房系統存取權限");
        }

        user.value = userData;
        token.value = authToken;

        // 換人登入時丟掉前一間餐廳的離線快取（共用/轉移裝置）
        offlineService.setActiveRestaurant(userData.restaurantId);

        // 保存到 localStorage (via shared auth-client)
        apiClient.tokens.setTokens(authToken);
        apiClient.tokens.setUser(userData);
        apiClient.tokens.scheduleProactiveRefresh(authToken);

        const slug = userData.loginSlug ?? credentials.shop;
        if (slug) rememberShop(slug);

        return { success: true };
      } else {
        // Reached only for a 2xx whose envelope reports failure: `authApi.login`
        // rethrows anything the request itself raised, and the login form
        // classifies that untouched. Nothing renders this message; it is what
        // the console.error below prints.
        throw new Error(response.error || response.message || "Login failed");
      }
    } catch (error: unknown) {
      console.error("Login error:", error);
      throw error;
    } finally {
      loading.value = false;
    }
  };

  const logout = async () => {
    try {
      if (token.value) {
        await authApi.logout();
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      // 清除本地狀態
      user.value = null;
      token.value = null;
      apiClient.tokens.clearAll();
      // 離線快取含本餐廳訂單內容，登出後不得留在裝置上
      offlineService.clearOfflineData();
    }
  };

  const refreshToken = async () => {
    if (!token.value) return false;

    try {
      const response = await authApi.refreshToken();
      if (response.success && response.data) {
        const { token: newToken, user: userData } = response.data;

        token.value = newToken;
        user.value = userData;

        apiClient.tokens.setTokens(newToken);
        apiClient.tokens.setUser(userData);

        apiClient.tokens.scheduleProactiveRefresh(newToken);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Token refresh error:", error);
      await logout();
      return false;
    }
  };

  const checkAuth = async () => {
    const savedToken = apiClient.tokens.getToken();
    const savedUser = apiClient.tokens.getUser<User>();

    if (savedToken && savedUser) {
      try {
        if (savedUser.role !== 2) {
          await logout();
          return false;
        }

        token.value = savedToken;
        user.value = savedUser;
        offlineService.setActiveRestaurant(savedUser.restaurantId);

        // Only refresh if token is expired or about to expire
        if (isTokenExpired(savedToken, 60)) {
          const refreshResult = await refreshToken();
          return refreshResult;
        }

        // Token still valid — schedule proactive refresh
        apiClient.tokens.scheduleProactiveRefresh(savedToken);
        return true;
      } catch (error) {
        console.error("Auth check error:", error);
        await logout();
        return false;
      }
    }

    return false;
  };

  const updateLastActivity = () => {
    if (user.value) {
      user.value.lastLogin = new Date().toISOString();
      apiClient.tokens.setUser(user.value);
    }
  };

  // 初始化時檢查認證狀態
  const initialize = async () => {
    loading.value = true;
    try {
      await checkAuth();
    } finally {
      loading.value = false;
    }
  };

  return {
    // State
    user,
    token,
    loading,

    // Getters
    isAuthenticated,
    isChef,
    restaurantId,
    hasPermission,

    // Actions
    login,
    logout,
    refreshToken,
    checkAuth,
    updateLastActivity,
    initialize,
  };
});
