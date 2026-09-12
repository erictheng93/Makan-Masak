<template>
  <div class="min-h-screen bg-ios-bg">
    <!-- Header -->
    <div class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center py-6">
          <div class="flex items-center">
            <router-link
              to="/orders"
              class="mr-4 text-gray-600 hover:text-orange-600"
            >
              <svg
                class="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </router-link>
            <h1 class="text-2xl font-bold text-gray-900">
              {{ t("profile.pageTitle") }}
            </h1>
          </div>
          <button
            class="text-sm text-gray-600 hover:text-red-600"
            @click="handleLogout"
          >
            {{ t("profile.logout") }}
          </button>
        </div>
      </div>
    </div>

    <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Loading State -->
      <div v-if="isLoading" class="flex justify-center items-center py-12">
        <div
          class="animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent"
        />
      </div>

      <div v-else class="space-y-6">
        <!-- Profile Card -->
        <div class="bg-white rounded-lg shadow-lg overflow-hidden">
          <!-- Header with Gradient -->
          <div class="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-8">
            <div class="flex items-center space-x-4">
              <div
                class="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg"
              >
                <span class="text-3xl font-bold text-orange-600">
                  {{ getInitial(profile.fullName) }}
                </span>
              </div>
              <div class="text-white">
                <h2 class="text-2xl font-bold">{{ profile.fullName }}</h2>
                <p class="text-orange-100">@{{ profile.username }}</p>
              </div>
            </div>
          </div>

          <!-- Profile Details -->
          <div class="px-6 py-6 space-y-4">
            <!-- Username -->
            <div class="flex items-center py-3 border-b border-gray-200">
              <div class="flex items-center w-1/3">
                <svg
                  class="w-5 h-5 text-gray-400 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                <span class="text-sm font-medium text-gray-600">{{
                  t("auth.username")
                }}</span>
              </div>
              <div class="flex-1 text-gray-900">{{ profile.username }}</div>
            </div>

            <!-- Full Name -->
            <div class="flex items-center py-3 border-b border-gray-200">
              <div class="flex items-center w-1/3">
                <svg
                  class="w-5 h-5 text-gray-400 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span class="text-sm font-medium text-gray-600">{{
                  t("auth.displayName")
                }}</span>
              </div>
              <div class="flex-1 text-gray-900">{{ profile.fullName }}</div>
            </div>

            <!-- Email -->
            <div class="flex items-center py-3 border-b border-gray-200">
              <div class="flex items-center w-1/3">
                <svg
                  class="w-5 h-5 text-gray-400 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                <span class="text-sm font-medium text-gray-600">{{
                  t("profile.email")
                }}</span>
              </div>
              <div class="flex-1 text-gray-900">
                {{ profile.email || t("profile.notSet") }}
              </div>
            </div>

            <!-- Phone -->
            <div class="flex items-center py-3">
              <div class="flex items-center w-1/3">
                <svg
                  class="w-5 h-5 text-gray-400 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                <span class="text-sm font-medium text-gray-600">{{
                  t("auth.phone")
                }}</span>
              </div>
              <div class="flex-1 text-gray-900">
                {{ profile.phone || t("profile.notSet") }}
              </div>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">
            通知與同意設定
          </h3>
          <div class="space-y-4">
            <label class="flex items-center justify-between gap-4">
              <span class="text-sm font-medium text-gray-700">候位通知</span>
              <input
                v-model="preferences.waitingListOptIn"
                type="checkbox"
                class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
              />
            </label>
            <label class="flex items-center justify-between gap-4">
              <span class="text-sm font-medium text-gray-700">行銷通知</span>
              <input
                v-model="preferences.marketingOptIn"
                type="checkbox"
                class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
              />
            </label>
            <label class="flex items-center justify-between gap-4">
              <span class="text-sm font-medium text-gray-700">
                只接收收藏店家的優惠
              </span>
              <input
                v-model="preferences.promoFromFavoritesOptIn"
                type="checkbox"
                class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
              />
            </label>
            <div class="flex flex-col sm:flex-row gap-3">
              <button
                class="flex-1 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition"
                @click="savePreferences"
              >
                儲存設定
              </button>
              <!-- Web push is built but unlaunched, and the API answers its
                   endpoints with 404 while it is switched off. The button stays
                   visible, greyed and inert, rather than hidden: hiding it makes
                   the product look smaller than it is, while leaving it live
                   sends a subscribe request the API refuses. See
                   composables/useFeatureAvailability.ts. -->
              <button
                data-testid="enable-push-button"
                class="flex-1 flex items-center justify-center gap-2 px-4 py-3 border rounded-lg transition"
                :class="
                  pushUnavailable
                    ? 'border-gray-200 text-gray-400 cursor-not-allowed select-none'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                "
                :disabled="pushUnavailable"
                :data-disabled="pushUnavailable ? 'true' : undefined"
                :aria-disabled="pushUnavailable ? 'true' : undefined"
                :title="pushUnavailable ? PUSH_UNAVAILABLE_LABEL : undefined"
                @click="enablePush"
              >
                啟用推播
                <span v-if="pushUnavailable" class="text-xs">{{
                  PUSH_UNAVAILABLE_LABEL
                }}</span>
              </button>
            </div>
            <p v-if="settingsMessage" class="text-sm text-gray-600">
              {{ settingsMessage }}
            </p>
          </div>
        </div>

        <FollowingList />

        <!-- Quick Actions -->
        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">
            {{ t("profile.quickActions") }}
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <router-link
              to="/orders"
              class="flex items-center p-4 border border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition"
            >
              <svg
                class="w-6 h-6 text-orange-600 mr-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <div>
                <p class="font-medium text-gray-900">
                  {{ t("orderHistory.title") }}
                </p>
                <p class="text-sm text-gray-500">
                  {{ t("profile.viewOrderHistory") }}
                </p>
              </div>
            </router-link>

            <router-link
              to="/menu"
              class="flex items-center p-4 border border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition"
            >
              <svg
                class="w-6 h-6 text-orange-600 mr-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              <div>
                <p class="font-medium text-gray-900">
                  {{ t("profile.browseMenu") }}
                </p>
                <p class="text-sm text-gray-500">
                  {{ t("profile.viewRestaurantMenu") }}
                </p>
              </div>
            </router-link>
          </div>
        </div>

        <!-- Account Actions -->
        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">
            {{ t("profile.accountSettings") }}
          </h3>
          <div class="space-y-2">
            <button
              class="w-full flex items-center justify-center px-4 py-3 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition"
              @click="handleLogout"
            >
              <svg
                class="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              {{ t("profile.logoutAccount") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { customerOrderApi } from "@/services/customerOrderApi";
import { customerIdentityApi } from "@/services/customerIdentityApi";
import customerPushService from "@/utils/push-notifications";
import { useFeatureAvailability } from "@/composables/useFeatureAvailability";
import { useI18n } from "@/composables/useI18n";
import { useConfirmModal } from "@/composables/useConfirmModal";
import FollowingList from "@/components/follow/FollowingList.vue";
import { CUSTOMER_CONSENT_VERSIONS } from "@makanmasak/shared-types";

const router = useRouter();
const authStore = useAuthStore();
const { t } = useI18n();
const { confirm: confirmModal } = useConfirmModal();
const { isDisabled } = useFeatureAvailability();

/**
 * TODO(i18n): hard-coded zh-TW because the locale files were being edited in a
 * concurrent change when this landed, and this section already carries
 * hard-coded zh-TW copy ("通知與同意設定", "啟用推播"). Move to a translation
 * key alongside the rest of this card.
 */
const PUSH_UNAVAILABLE_LABEL = "尚未開放";

const pushUnavailable = computed(() => isDisabled("webPush"));

const isLoading = ref(false);
const settingsMessage = ref("");
const profile = ref({
  id: "",
  username: "",
  fullName: "",
  email: "",
  phone: "",
  role: 5,
});
const preferences = ref({
  dietaryTags: [] as string[],
  allergens: [] as string[],
  defaultPartySize: null as number | null,
  marketingOptIn: false,
  waitingListOptIn: true,
  promoFromFavoritesOptIn: false,
  quietHoursStart: null as string | null,
  quietHoursEnd: null as string | null,
  updatedAtMs: null as number | null,
});

// 獲取姓名首字母
const getInitial = (name: string) => {
  return name ? name.charAt(0).toUpperCase() : "U";
};

// 載入用戶資料
const loadProfile = async () => {
  isLoading.value = true;

  try {
    const data = await customerOrderApi.getMyProfile();
    const identity = await customerIdentityApi.getMe();
    profile.value = {
      id: data.id,
      username: data.username,
      fullName: data.fullName,
      email: data.email || "",
      phone: data.phone || "",
      role: data.role,
    };
    preferences.value = identity.preferences;
  } catch (error) {
    console.error("Failed to load profile:", error);
  } finally {
    isLoading.value = false;
  }
};

const savePreferences = async () => {
  settingsMessage.value = "";
  try {
    preferences.value = await customerIdentityApi.updatePreferences(
      preferences.value,
    );
    await customerIdentityApi.grantConsent({
      consentType: "marketing",
      version: CUSTOMER_CONSENT_VERSIONS.marketing,
      granted: preferences.value.marketingOptIn,
      source: "settings",
    });
    settingsMessage.value = "設定已儲存";
  } catch (error) {
    console.error("Failed to save preferences:", error);
    settingsMessage.value = "設定儲存失敗";
  }
};

const enablePush = async () => {
  settingsMessage.value = "";
  // Guarded here as well as on the button: the disabled attribute is
  // presentation, and this is what actually keeps the subscribe request --
  // which the API refuses while web push is unlaunched -- from being sent.
  if (pushUnavailable.value) {
    settingsMessage.value = `推播${PUSH_UNAVAILABLE_LABEL}`;
    return;
  }
  try {
    const permission = await customerPushService.requestPermission();
    if (permission !== "granted") {
      settingsMessage.value = "推播權限未開啟";
      return;
    }
    const subscription = await customerPushService.subscribe();
    settingsMessage.value = subscription ? "推播已啟用" : "推播啟用失敗";
  } catch (error) {
    console.error("Failed to enable push:", error);
    settingsMessage.value = "推播啟用失敗";
  }
};

// 登出
const handleLogout = async () => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("orderHistory.logout"),
    message: t("orderHistory.confirmLogout"),
    confirmLabel: t("orderHistory.logout"),
  });
  if (!confirmed) return;

  await authStore.logout();
  router.push("/login");
};

// 初始化
onMounted(async () => {
  // 檢查登入狀態
  if (!authStore.isAuthenticated) {
    router.push("/login");
    return;
  }

  const isValid = await authStore.checkAuth();
  if (!isValid) {
    router.push("/login");
    return;
  }

  await loadProfile();
});
</script>
