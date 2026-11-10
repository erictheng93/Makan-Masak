<template>
  <nav class="bg-white shadow-sm border-b border-gray-200">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <!-- Logo 和主導航 -->
        <div class="flex">
          <div class="flex-shrink-0 flex items-center">
            <BuildingStorefrontIcon class="h-8 w-8 text-teal-600" />
            <span class="ml-2 text-xl font-bold text-gray-900">MakanMasak</span>
          </div>

          <!-- 主要導航選項 -->
          <div class="hidden md:ml-6 md:flex md:space-x-8">
            <router-link
              v-for="item in visibleNavItems"
              :key="item.name"
              :to="item.href"
              :class="[
                'flex items-center px-1 pt-1 text-sm font-medium transition-colors duration-200',
                $route.path === item.href ||
                $route.path.startsWith(item.href + '/')
                  ? 'border-b-2 border-teal-500 text-teal-600'
                  : 'text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ]"
            >
              <component :is="item.icon" class="w-5 h-5 mr-2" />
              {{ item.label }}
            </router-link>
          </div>
        </div>

        <!-- 用戶資訊和快速操作 -->
        <div class="flex items-center space-x-4">
          <!-- 角色徽章 -->
          <div
            :class="[
              'px-3 py-1 rounded-full text-xs font-medium',
              roleColorClass,
            ]"
          >
            {{ roleDisplayName }}
          </div>

          <!-- 角色切換（僅管理員可見） -->
          <div v-if="authStore.userRole === UserRole.ADMIN" class="relative">
            <select
              class="text-sm border border-gray-300 rounded-md px-3 py-1 bg-white"
              @change="handleRoleSwitch"
            >
              <option value="">{{ t("roleNav.switchRole") }}</option>
              <option value="owner">{{ t("roleNav.ownerView") }}</option>
              <option value="chef">{{ t("roleNav.chefView") }}</option>
              <option value="service">{{ t("roleNav.serviceView") }}</option>
              <option value="cashier">{{ t("roleNav.cashierView") }}</option>
            </select>
          </div>

          <!-- 通知 -->
          <button
            class="relative p-2 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 rounded-lg"
            @click="showNotifications = !showNotifications"
          >
            <BellIcon class="h-6 w-6" />
            <span
              v-if="unreadNotifications > 0"
              class="absolute -top-1 -right-1 h-4 w-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
            >
              {{ unreadNotifications }}
            </span>
          </button>

          <!-- 用戶菜單 -->
          <div class="relative" @click="showUserMenu = !showUserMenu">
            <button
              class="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50"
            >
              <div
                class="w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center"
              >
                <span class="text-sm font-medium text-white">
                  {{ userInitials }}
                </span>
              </div>
              <div class="hidden md:block text-left">
                <p class="text-sm font-medium text-gray-900">
                  {{ authStore.user?.username }}
                </p>
                <p class="text-xs text-gray-500">
                  {{ authStore.user?.email }}
                </p>
              </div>
            </button>

            <!-- 用戶下拉菜單 -->
            <div
              v-if="showUserMenu"
              class="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50"
            >
              <div class="py-1">
                <router-link
                  v-for="item in userMenuItems"
                  :key="item.name"
                  :to="item.href"
                  class="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  @click="showUserMenu = false"
                >
                  <component :is="item.icon" class="w-4 h-4 mr-3" />
                  {{ item.label }}
                </router-link>
                <hr class="my-1 border-gray-200" />
                <button
                  class="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  @click="handleLogout"
                >
                  <ArrowRightOnRectangleIcon class="w-4 h-4 mr-3" />
                  {{ t("roleNav.logout") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 手機版導航 -->
      <div class="md:hidden">
        <div class="pt-2 pb-3 space-y-1">
          <router-link
            v-for="item in visibleNavItems"
            :key="item.name"
            :to="item.href"
            :class="[
              'flex items-center px-3 py-2 text-base font-medium transition-colors duration-200',
              $route.path === item.href
                ? 'bg-teal-50 border-r-4 border-teal-500 text-teal-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50',
            ]"
          >
            <component :is="item.icon" class="w-5 h-5 mr-3" />
            {{ item.label }}
          </router-link>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "@/i18n";
import { useRouter } from "vue-router";
import {
  BuildingStorefrontIcon,
  HomeIcon,
  ShoppingCartIcon,
  DocumentTextIcon,
  TableCellsIcon,
  UsersIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  BellIcon,
  UserIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/vue/24/outline";
import { useAuthStore } from "@/stores/auth";
import { currentLoginPath } from "@/utils/loginShop";
import { UserRole } from "@/types";

const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();

const showNotifications = ref(false);
const showUserMenu = ref(false);
const unreadNotifications = ref(2);

// 導航項目定義
const allNavItems = computed(() => [
  {
    name: "dashboard",
    label: t("roleNav.dashboard"),
    href: "/dashboard",
    icon: HomeIcon,
    roles: [
      UserRole.ADMIN,
      UserRole.OWNER,
      UserRole.CHEF,
      UserRole.SERVICE,
      UserRole.CASHIER,
    ],
  },
  {
    name: "owner",
    label: t("roleNav.ownerCenter"),
    href: "/dashboard/owner-overview",
    icon: BuildingStorefrontIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER],
  },
  {
    name: "pos",
    label: t("roleNav.pos"),
    href: "/dashboard/pos",
    icon: ShoppingCartIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER, UserRole.CASHIER],
  },
  {
    name: "orders",
    label: t("roleNav.orderManagement"),
    href: "/dashboard/orders",
    icon: ShoppingCartIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER, UserRole.SERVICE, UserRole.CASHIER],
  },
  {
    name: "menu",
    label: t("roleNav.menuManagement"),
    href: "/dashboard/menu",
    icon: DocumentTextIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER],
  },
  {
    name: "tables",
    label: t("roleNav.tableManagement"),
    href: "/dashboard/tables",
    icon: TableCellsIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER],
  },
  {
    name: "service",
    label: t("roleNav.serviceSystem"),
    href: "/service",
    icon: HomeIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER, UserRole.SERVICE],
  },
  {
    name: "analytics",
    label: t("roleNav.analytics"),
    href: "/dashboard/analytics",
    icon: ChartBarIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER],
  },
  {
    name: "users",
    label: t("roleNav.userManagement"),
    href: "/dashboard/users",
    icon: UsersIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER],
  },
  {
    name: "settings",
    label: t("roleNav.systemSettings"),
    href: "/dashboard/settings",
    icon: Cog6ToothIcon,
    roles: [UserRole.ADMIN, UserRole.OWNER],
  },
]);

// 用戶菜單項目
const userMenuItems = computed(() => {
  const items = [
    {
      name: "profile",
      label: t("roleNav.profile"),
      href: "/dashboard/settings",
      icon: UserIcon,
    },
    {
      name: "settings",
      label: t("roleNav.preferences"),
      href: "/dashboard/settings",
      icon: Cog6ToothIcon,
    },
  ];

  return items.filter((item) => {
    if (item.name === "settings") {
      return authStore.canAccessAdminFeatures;
    }
    return true;
  });
});

// 根據用戶角色篩選可見的導航項目
const visibleNavItems = computed(() => {
  if (!authStore.user) return [];

  return allNavItems.value.filter((item) =>
    authStore.hasPermission(item.roles),
  );
});

// 角色顯示名稱
const roleDisplayName = computed(() => {
  if (!authStore.user) return "";

  const roleKeys: Record<number, string> = {
    [UserRole.ADMIN]: "roleNav.roles.admin",
    [UserRole.OWNER]: "roleNav.roles.owner",
    [UserRole.CHEF]: "roleNav.roles.chef",
    [UserRole.SERVICE]: "roleNav.roles.service",
    [UserRole.CASHIER]: "roleNav.roles.cashier",
  };

  return roleKeys[authStore.user.role]
    ? t(roleKeys[authStore.user.role])
    : t("roleNav.roles.unknown");
});

// 角色顏色樣式
const roleColorClass = computed(() => {
  if (!authStore.user) return "bg-gray-100 text-gray-800";

  const roleColors: Record<number, string> = {
    [UserRole.ADMIN]: "bg-red-100 text-red-800",
    [UserRole.OWNER]: "bg-teal-100 text-teal-800",
    [UserRole.CHEF]: "bg-orange-100 text-orange-800",
    [UserRole.SERVICE]: "bg-blue-100 text-blue-800",
    [UserRole.CASHIER]: "bg-green-100 text-green-800",
  };

  return roleColors[authStore.user.role] || "bg-gray-100 text-gray-800";
});

// 用戶姓名首字母
const userInitials = computed(() => {
  if (!authStore.user?.username) return "?";

  return authStore.user.username
    .split(" ")
    .map((name) => name.charAt(0).toUpperCase())
    .join("")
    .substring(0, 2);
});

// 處理角色切換（僅管理員）
const handleRoleSwitch = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  const role = target.value;

  if (!role) return;

  const roleRoutes: Record<string, string> = {
    owner: "/dashboard/owner-overview",
    chef: "/dashboard",
    service: "/service",
    cashier: "/dashboard/pos/checkout",
  };

  router.push(roleRoutes[role as keyof typeof roleRoutes]);
  target.value = ""; // 重置選擇
};

// 處理登出
const handleLogout = async () => {
  try {
    await authStore.logout();
    router.push(currentLoginPath());
  } catch (error) {
    console.error("Logout error:", error);
  }
};

// 點擊外部關閉下拉菜單
const handleClickOutside = (event: Event) => {
  const target = event.target as Element;
  if (!target.closest(".relative")) {
    showUserMenu.value = false;
    showNotifications.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
});
</script>
