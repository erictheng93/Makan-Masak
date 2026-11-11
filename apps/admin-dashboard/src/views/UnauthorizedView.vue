<template>
  <div class="ui-page unauthorized-view">
    <div
      class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8"
    >
      <div class="max-w-md w-full space-y-8 text-center">
        <!-- 圖標 -->
        <div class="mx-auto">
          <ShieldExclamationIcon class="mx-auto h-24 w-24 text-red-700" />
        </div>

        <!-- 標題和描述 -->
        <div>
          <h1 class="ui-page-heading mt-6 text-3xl font-bold text-gray-900">
            {{ t("unauthorized.title") }}
          </h1>
          <p class="mt-2 text-sm text-gray-600">
            {{ t("unauthorized.description") }}
          </p>
        </div>

        <!-- 操作按鈕 -->
        <div class="flex flex-col sm:flex-row gap-3">
          <button
            class="ui-panel flex-1 flex justify-center items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            @click="goBack"
          >
            <ArrowLeftIcon class="h-4 w-4 mr-2" />
            {{ t("unauthorized.goBack") }}
          </button>

          <button
            class="flex-1 flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm bg-primary-700 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            @click="goToDashboard"
          >
            <HomeIcon class="h-4 w-4 mr-2" />
            {{ t("unauthorized.goHome") }}
          </button>
        </div>

        <!-- 錯誤詳情 -->
        <div class="bg-red-50 border border-red-200 rounded-md p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <ExclamationTriangleIcon class="h-5 w-5 text-red-700" />
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-800">
                {{ t("unauthorized.permissionDenied") }}
              </h3>
              <div class="mt-2 text-sm text-red-700">
                <p>{{ t("unauthorized.permissionMessage") }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 用戶資訊 -->
        <div v-if="currentUser" class="bg-gray-100 rounded-md p-4">
          <h2 class="text-sm font-medium text-gray-900 mb-2">
            {{ t("unauthorized.currentLoginInfo") }}
          </h2>
          <div class="text-sm text-gray-600 space-y-1">
            <div class="ui-toolbar flex justify-between">
              <span>{{ t("unauthorized.usernameLabel") }}</span>
              <span class="font-medium">{{ currentUser.username }}</span>
            </div>
            <div class="ui-toolbar flex justify-between">
              <span>{{ t("unauthorized.roleLabel") }}</span>
              <span class="font-medium">{{
                getRoleText(currentUser.role)
              }}</span>
            </div>
            <div
              v-if="currentRestaurantName"
              class="ui-toolbar flex justify-between"
            >
              <span>{{ t("unauthorized.restaurantLabel") }}</span>
              <span class="font-medium">{{ currentRestaurantName }}</span>
            </div>
          </div>
        </div>

        <!-- 可用功能提示 -->
        <div class="bg-blue-50 border border-blue-200 rounded-md p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <InformationCircleIcon class="h-5 w-5 text-blue-700" />
            </div>
            <div class="ml-3">
              <h2 class="text-sm font-medium text-blue-800">
                {{ t("unauthorized.availableFeatures") }}
              </h2>
              <div class="mt-2 text-sm text-blue-700">
                <ul class="list-disc list-inside space-y-1">
                  <li
                    v-for="permission in availablePermissions"
                    :key="permission"
                  >
                    {{ permission }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- 聯絡資訊 -->
        <div class="text-center">
          <p class="text-xs text-gray-500">
            {{ t("unauthorized.contactAdmin") }}
          </p>
          <p class="text-xs text-blue-700 mt-1">
            <a
              href="mailto:admin@makanmasak.com"
              class="hover:text-blue-800 transition-colors"
            >
              admin@makanmasak.com
            </a>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import {
  ShieldExclamationIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ArrowLeftIcon,
  HomeIcon,
} from "@heroicons/vue/24/outline";

const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();

// 計算屬性
const currentUser = computed(() => authStore.user);
const currentRestaurantName = computed(() => {
  const user = currentUser.value;
  if (!user || !("restaurantName" in user)) return undefined;

  const restaurantName = (user as { restaurantName?: unknown }).restaurantName;
  return typeof restaurantName === "string" && restaurantName.length > 0
    ? restaurantName
    : undefined;
});

const availablePermissions = computed(() => {
  const role = currentUser.value?.role;
  const permissions: Record<number, string[]> = {
    0: [
      // Admin
      t("unauthorized.permissions.systemManagement"),
      t("unauthorized.permissions.userManagement"),
      t("unauthorized.permissions.restaurantManagement"),
      t("unauthorized.permissions.dataAnalysis"),
      t("unauthorized.permissions.allFeatures"),
    ],
    1: [
      // Owner
      t("unauthorized.permissions.restaurantManagement"),
      t("unauthorized.permissions.staffManagement"),
      t("unauthorized.permissions.menuManagement"),
      t("unauthorized.permissions.orderManagement"),
      t("unauthorized.permissions.dataAnalysis"),
    ],
    2: [
      // Chef
      t("unauthorized.permissions.kitchenDisplay"),
      t("unauthorized.permissions.orderProcessing"),
      t("unauthorized.permissions.menuView"),
    ],
    3: [
      // Service
      t("unauthorized.permissions.orderManagement"),
      t("unauthorized.permissions.tableManagement"),
      t("unauthorized.permissions.deliveryService"),
    ],
    4: [
      // Cashier
      t("unauthorized.permissions.cashier"),
      t("unauthorized.permissions.orderCheckout"),
      t("unauthorized.permissions.paymentProcessing"),
    ],
  };
  return permissions[role!] || [t("unauthorized.permissions.basicFeatures")];
});

// 方法
const getRoleText = (role: number) => {
  const roles: Record<number, string> = {
    0: t("unauthorized.roles.admin"),
    1: t("unauthorized.roles.owner"),
    2: t("unauthorized.roles.chef"),
    3: t("unauthorized.roles.service"),
    4: t("unauthorized.roles.cashier"),
  };
  return roles[role] || t("unauthorized.roles.unknown");
};

const goBack = () => {
  if (window.history.length > 1) {
    router.go(-1);
  } else {
    goToDashboard();
  }
};

const goToDashboard = () => {
  router.push("/dashboard");
};

// 生命周期
onMounted(() => {
  // 記錄未授權訪問嘗試
  console.warn("Unauthorized access attempt:", {
    user: currentUser.value?.username,
    role: currentUser.value?.role,
    timestamp: new Date().toISOString(),
    path: router.currentRoute.value.path,
  });
});
</script>

<style scoped>
.unauthorized-view {
  min-height: 100vh;
}
</style>
