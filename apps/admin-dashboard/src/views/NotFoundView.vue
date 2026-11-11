<template>
  <div class="ui-page not-found-view">
    <div
      class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8"
    >
      <div class="max-w-md w-full space-y-8 text-center">
        <!-- 404 大字 -->
        <div class="mb-8">
          <p class="text-sm font-semibold text-ios-text/70 mb-4">404</p>
          <div class="flex justify-center">
            <QuestionMarkCircleIcon class="h-20 w-20 text-gray-400" />
          </div>
        </div>

        <!-- 標題和描述 -->
        <div class="space-y-4">
          <h1 class="ui-page-heading text-3xl font-bold text-gray-900">
            {{ t("notFound.title") }}
          </h1>
          <p class="text-lg text-gray-600">
            {{ t("notFound.description") }}
          </p>
          <p class="text-sm text-gray-500">
            {{ t("notFound.instruction") }}
          </p>
        </div>

        <!-- 請求的路徑信息 -->
        <div class="bg-gray-100 rounded-lg p-4">
          <div class="text-sm text-gray-600">
            <p class="font-medium mb-2">{{ t("notFound.attemptedPath") }}</p>
            <code
              class="bg-white px-3 py-1 rounded border text-red-700 break-all"
            >
              {{ currentPath }}
            </code>
          </div>
        </div>

        <!-- 主要操作按鈕 -->
        <div class="flex flex-col sm:flex-row gap-3">
          <button
            class="ui-panel flex-1 flex justify-center items-center px-6 py-3 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            @click="goBack"
          >
            <ArrowLeftIcon class="h-4 w-4 mr-2" />
            {{ t("notFound.goBack") }}
          </button>

          <button
            class="flex-1 flex justify-center items-center px-6 py-3 border border-transparent rounded-lg shadow-sm bg-primary-700 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            @click="goHome"
          >
            <HomeIcon class="h-4 w-4 mr-2" />
            {{ t("notFound.goHome") }}
          </button>
        </div>

        <!-- 快速導航 -->
        <div class="space-y-4">
          <h3 class="text-lg font-medium text-gray-900">
            {{ t("notFound.quickNav") }}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              v-for="link in navigationLinks"
              :key="link.path"
              class="ui-panel flex items-center justify-center px-4 py-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 group"
              @click="navigateTo(link.path)"
            >
              <component
                :is="link.icon"
                class="h-5 w-5 text-gray-500 group-hover:text-gray-700 mr-3"
              />
              <span
                class="text-sm font-medium text-gray-700 group-hover:text-gray-900"
              >
                {{ link.name }}
              </span>
            </button>
          </div>
        </div>

        <!-- 搜索功能 -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div class="flex items-start">
            <div class="flex-shrink-0">
              <InformationCircleIcon class="h-5 w-5 text-blue-700" />
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-blue-800">
                {{ t("notFound.cantFind") }}
              </h3>
              <div class="mt-2 text-sm text-blue-700">
                <p class="mb-3">{{ t("notFound.trySearch") }}</p>
                <div class="relative">
                  <MagnifyingGlassIcon
                    class="absolute left-3 top-3 h-4 w-4 text-gray-400"
                  />
                  <input
                    v-model="searchQuery"
                    type="text"
                    :placeholder="t('notFound.searchPlaceholder')"
                    class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    @keyup.enter="performSearch"
                  />
                </div>
                <button
                  class="mt-2 w-full px-4 py-2 bg-primary-700 text-white rounded-lg hover:bg-primary-800 transition-colors text-sm font-medium"
                  @click="performSearch"
                >
                  {{ t("notFound.search") }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 聯絡支援 -->
        <div class="border-t border-gray-200 pt-6">
          <p class="text-sm text-gray-500 mb-3">
            {{ t("notFound.persistentIssue") }}
          </p>
          <div class="flex justify-center space-x-6 text-sm">
            <a
              href="mailto:support@makanmasak.com"
              class="text-blue-700 hover:text-blue-800 transition-colors flex items-center"
            >
              <EnvelopeIcon class="h-4 w-4 mr-1" />
              {{ t("notFound.techSupport") }}
            </a>
            <a
              href="tel:+60123456789"
              class="text-blue-700 hover:text-blue-800 transition-colors flex items-center"
            >
              <PhoneIcon class="h-4 w-4 mr-1" />
              {{ t("notFound.contactPhone") }}
            </a>
          </div>
        </div>

        <!-- 系統狀態 -->
        <div class="text-xs text-gray-400">
          <p>
            {{ t("notFound.errorCode") }}: 404 | {{ new Date().toISOString() }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useAuthStore } from "@/stores/auth";
import {
  QuestionMarkCircleIcon,
  ArrowLeftIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  InformationCircleIcon,
  EnvelopeIcon,
  PhoneIcon,
} from "@heroicons/vue/24/outline";
import {
  ChartBarIcon,
  ShoppingBagIcon,
  UserGroupIcon,
  CakeIcon,
  TableCellsIcon,
  CalculatorIcon,
} from "@heroicons/vue/24/solid";

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();

// 響應式數據
const searchQuery = ref("");

// 計算屬性
const currentPath = computed(() => route.fullPath);

const navigationLinks = computed(() => {
  const role = authStore.user?.role || 4;

  const allLinks = [
    {
      name: t("nav.dashboard"),
      path: "/dashboard",
      icon: ChartBarIcon,
      roles: [0, 1, 2, 3, 4],
    },
    {
      name: t("nav.orders"),
      path: "/dashboard/orders",
      icon: ShoppingBagIcon,
      roles: [0, 1, 3],
    },
    {
      name: t("nav.menu"),
      path: "/dashboard/menu",
      icon: CakeIcon,
      roles: [0, 1],
    },
    {
      name: t("nav.tables"),
      path: "/dashboard/tables",
      icon: TableCellsIcon,
      roles: [0, 1, 3],
    },
    {
      name: t("nav.users"),
      path: "/dashboard/users",
      icon: UserGroupIcon,
      roles: [0, 1],
    },
    {
      name: t("nav.analytics"),
      path: "/dashboard/analytics",
      icon: ChartBarIcon,
      roles: [0, 1],
    },
    {
      name: t("nav.cashier"),
      path: "/cashier",
      icon: CalculatorIcon,
      roles: [0, 1, 4],
    },
  ];

  return allLinks.filter((link) => link.roles.includes(role));
});

// 方法
const navigateTo = (path: string) => {
  router.push(path);
};

const goBack = () => {
  if (window.history.length > 1) {
    router.go(-1);
  } else {
    goHome();
  }
};

const goHome = () => {
  router.push("/dashboard");
};

const performSearch = () => {
  if (!searchQuery.value.trim()) return;

  // 根據搜索內容進行智能導航
  const query = searchQuery.value.toLowerCase().trim();

  const searchMappings = [
    { keywords: ["訂單", "order", "點餐"], path: "/dashboard/orders" },
    { keywords: ["菜單", "menu", "菜品", "食物"], path: "/dashboard/menu" },
    { keywords: ["桌台", "table", "桌子", "qr"], path: "/dashboard/tables" },
    { keywords: ["員工", "user", "用戶", "帳戶"], path: "/dashboard/users" },
    {
      keywords: ["分析", "analytics", "報表", "統計"],
      path: "/dashboard/analytics",
    },
    { keywords: ["收銀", "cashier", "付款", "結帳"], path: "/cashier" },
  ];

  for (const mapping of searchMappings) {
    if (mapping.keywords.some((keyword) => query.includes(keyword))) {
      // const userRole = authStore.user?.role || 4
      const targetLink = navigationLinks.value.find(
        (link) => link.path === mapping.path,
      );

      if (targetLink) {
        router.push(mapping.path);
        return;
      }
    }
  }

  // 如果沒有匹配的關鍵字，顯示提示
  toast.warning(t("notFound.noSearchResult", { query: searchQuery.value }));
};

// 生命周期
onMounted(() => {
  // 記錄 404 錯誤
  console.warn("404 Error:", {
    path: currentPath.value,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    referrer: document.referrer,
  });
});
</script>

<style scoped>
.not-found-view {
  min-height: 100vh;
}

/* 添加一些動畫效果 */
.not-found-view h1 {
  animation: fadeInScale 1s ease-out;
}

@keyframes fadeInScale {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.not-found-view button:hover {
  transform: translateY(-1px);
}

.not-found-view button:active {
  transform: translateY(0);
}
</style>
