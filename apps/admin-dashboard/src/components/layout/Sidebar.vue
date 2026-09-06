<template>
  <aside
    class="bg-white border-r border-gray-200 transition-all duration-300"
    :class="[
      isCollapsed ? 'w-16' : 'w-64',
      isMobile ? 'fixed inset-y-0 left-0 z-40' : '',
      isMobile && isCollapsed ? '-translate-x-full' : 'translate-x-0',
    ]"
  >
    <div class="flex flex-col h-full">
      <!-- Logo -->
      <div class="flex items-center h-16 px-4 border-b border-gray-200">
        <div class="flex items-center space-x-3">
          <div
            class="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center"
          >
            <span class="text-white font-bold text-sm">M</span>
          </div>
          <div v-if="!isCollapsed" class="font-semibold text-gray-900">
            MakanMasak
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
        <template v-for="item in navigationItems" :key="item.name">
          <div
            v-if="item.showRestaurantSectionLabel && !isCollapsed"
            class="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-gray-400"
            data-testid="restaurant-section-label"
          >
            {{ t("nav.restaurantManagement") }}
          </div>
          <!-- An unlaunched feature is shown, greyed and inert, rather than
               hidden: hiding it makes the product look smaller than it is,
               while linking to it leads to a screen whose requests the API
               refuses. See composables/useFeatureAvailability.ts. -->
          <span
            v-if="item.feature && isDisabled(item.feature)"
            :data-testid="`nav-item-${item.name}`"
            data-disabled="true"
            :title="t('nav.featureUnavailable')"
            aria-disabled="true"
            class="flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-400 cursor-not-allowed select-none"
          >
            <component :is="item.icon" class="w-5 h-5 flex-shrink-0" />
            <span v-if="!isCollapsed" class="ml-3">{{ item.label }}</span>
            <span v-if="!isCollapsed" class="ml-auto text-xs">{{
              t("nav.featureUnavailable")
            }}</span>
          </span>
          <ModuleGate v-else-if="item.module" :module="item.module">
            <component
              :is="'router-link'"
              :to="item.path"
              :data-testid="`nav-item-${item.name}`"
              class="flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="[
                isActiveRoute(item.path)
                  ? 'bg-primary-50 text-primary-700 border-r-2 border-primary-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              ]"
              @click="emit('navigate')"
            >
              <component :is="item.icon" class="w-5 h-5 flex-shrink-0" />
              <span v-if="!isCollapsed" class="ml-3">{{ item.label }}</span>
            </component>
            <template #fallback><span /></template>
            <template #loading><span /></template>
          </ModuleGate>
          <component
            :is="'router-link'"
            v-else
            :to="item.path"
            :data-testid="`nav-item-${item.name}`"
            class="flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            :class="[
              isActiveRoute(item.path)
                ? 'bg-primary-50 text-primary-700 border-r-2 border-primary-600'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
            ]"
            @click="emit('navigate')"
          >
            <component :is="item.icon" class="w-5 h-5 flex-shrink-0" />
            <span v-if="!isCollapsed" class="ml-3">{{ item.label }}</span>
          </component>
        </template>
        <p
          v-if="needsRestaurantContext && !isCollapsed"
          class="px-3 pt-2 text-xs leading-5 text-gray-500"
          role="status"
          data-testid="restaurant-context-hint"
        >
          {{ t("nav.selectRestaurantFirst") }} ·
          {{ t("nav.restaurantContextHint") }}
        </p>
      </nav>

      <!-- User Info -->
      <div class="px-4 py-4 border-t border-gray-200">
        <div class="flex items-center">
          <div
            class="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center"
          >
            <User class="w-4 h-4 text-gray-600" />
          </div>
          <div v-if="!isCollapsed" class="ml-3">
            <div class="text-sm font-medium text-gray-900">
              {{ user?.username }}
            </div>
            <div class="text-xs text-gray-500">
              {{ getRoleLabel(user?.role) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";
import { useI18n } from "@/i18n";
import {
  useFeatureAvailability,
  type UnlaunchedFeature,
} from "@/composables/useFeatureAvailability";
import ModuleGate from "@makanmasak/shared/components/ModuleGate.vue";
import type { ModuleKey } from "@makanmasak/shared/types/module-access";
import {
  Home,
  ShoppingCart,
  Menu,
  Users,
  BarChart3,
  Settings,
  User,
  CreditCard,
  Ticket as TicketIcon,
  Sparkles,
  Armchair,
  Activity,
  Globe,
  MapPinned,
  ReceiptText,
  UserPlus,
  UserRound,
  UsersRound,
  Crown,
  MessageSquare,
  CalendarCheck,
  CalendarClock,
  CalendarOff,
  Printer,
  Carrot,
  TrendingUp,
} from "lucide-vue-next";

interface Props {
  isCollapsed: boolean;
  isMobile?: boolean;
}

defineProps<Props>();
const emit = defineEmits<{
  toggle: [];
  navigate: [];
}>();

const route = useRoute();
const authStore = useAuthStore();
const { t } = useI18n();
const { isDisabled } = useFeatureAvailability();

const user = computed(() => authStore.user);

// Platform-level routes that don't require restaurant context
const platformItemNames = new Set([
  "platform",
  "platform-markets",
  "platform-market-checkouts",
  "platform-onboarding",
  "monitoring",
  "settings",
  "account-management",
  "feedback",
]);

const needsRestaurantContext = computed(
  () => authStore.isAdminRole && !authStore.hasRestaurantContext,
);

const shouldShowRestaurantSectionLabel = computed(
  () => authStore.isAdminRole && authStore.hasRestaurantContext,
);

const navigationItems = computed(() => {
  const items: Array<{
    name: string;
    path: string;
    label: string;
    icon: Component;
    visible: boolean;
    module?: ModuleKey;
    /** Set when this entry leads to a built-but-unlaunched feature. */
    feature?: UnlaunchedFeature;
    section: "platform" | "restaurant";
  }> = [
    // Platform Overview (admin-only, always at top)
    {
      name: "platform",
      path: "/dashboard/platform",
      label: t("nav.platform"),
      icon: Globe,
      visible: authStore.isAdminRole,
      section: "platform",
    },
    {
      name: "platform-markets",
      path: "/dashboard/platform/markets",
      label: "市場品質",
      icon: MapPinned,
      visible: authStore.isAdminRole,
      section: "platform",
    },
    {
      name: "platform-market-checkouts",
      path: "/dashboard/platform/market-checkouts",
      label: "市場結帳",
      icon: ReceiptText,
      visible: authStore.isAdminRole,
      section: "platform",
      feature: "marketCheckouts",
    },
    {
      name: "platform-customers",
      path: "/dashboard/platform/customers",
      label: t("nav.platformCustomers"),
      icon: UsersRound,
      visible: authStore.isAdminRole,
      section: "platform",
    },
    {
      name: "platform-onboarding",
      path: "/dashboard/platform/onboarding",
      label: "開店申請",
      icon: UserPlus,
      visible: authStore.isAdminRole,
      section: "platform",
    },
    {
      name: "dashboard",
      path: "/dashboard",
      label: t("nav.dashboard"),
      icon: Home,
      visible: true,
      section: "restaurant",
    },
    {
      name: "owner-overview",
      path: "/dashboard/owner-overview",
      label: t("nav.ownerOverview"),
      icon: Crown,
      visible: authStore.canAccessOwnerDashboard,
      section: "restaurant",
    },
    {
      name: "pos",
      path: "/dashboard/pos",
      label: t("nav.pos"),
      icon: CreditCard,
      visible: authStore.hasPermission([
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.CASHIER,
      ]),
      section: "restaurant",
    },
    {
      name: "print-agents",
      path: "/dashboard/print-agents",
      label: t("nav.printAgents"),
      icon: Printer,
      visible: authStore.hasPermission([
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.CASHIER,
      ]),
      section: "restaurant",
    },
    {
      name: "orders",
      path: "/dashboard/orders",
      label: t("nav.orders"),
      icon: ShoppingCart,
      visible: authStore.canManageOrders,
      section: "restaurant",
    },
    {
      name: "menu",
      path: "/dashboard/menu",
      label: t("nav.menu"),
      icon: Menu,
      visible: authStore.canManageMenu,
      section: "restaurant",
    },
    {
      name: "menu-option-groups",
      path: "/dashboard/menu/option-groups",
      label: t("nav.menuOptionGroups"),
      icon: Menu,
      visible: authStore.canManageMenu,
      section: "restaurant",
    },
    {
      name: "seating",
      path: "/dashboard/seating",
      label: t("nav.seatingManagement"),
      icon: Armchair,
      visible: authStore.hasPermission([
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ]),
      section: "restaurant",
    },
    {
      // Every staff role, not just managers — it only ever shows the signed-in
      // user's own shifts. Gated on the same module as the API (#320).
      name: "my-shifts",
      path: "/dashboard/my-shifts",
      label: t("nav.myShifts"),
      icon: CalendarClock,
      visible: true,
      module: "staff_management",
      section: "restaurant",
    },
    {
      // Same population and the same module as my-shifts: it only ever shows
      // the signed-in user's own leave (#344).
      name: "my-leaves",
      path: "/dashboard/my-leaves",
      label: t("nav.myLeaves"),
      icon: CalendarOff,
      visible: true,
      module: "staff_management",
      section: "restaurant",
    },
    {
      name: "employees",
      path: "/dashboard/employees",
      label: t("nav.employees"),
      icon: Users,
      visible: authStore.canAccessAdminFeatures,
      section: "restaurant",
    },
    {
      // /ingredients/* is gated on "inventory" in app-factory; matching the
      // gate here keeps the entry from advertising a page that 403s.
      name: "ingredients",
      path: "/dashboard/ingredients",
      label: t("nav.ingredients"),
      icon: Carrot,
      visible: authStore.canAccessAdminFeatures,
      module: "inventory",
      section: "restaurant",
    },
    {
      // The forecast page itself is gated per route -- demand is "analytics",
      // the ingredient tab is "inventory" -- so gate the entry on the one the
      // page needs to render at all.
      name: "forecast",
      path: "/dashboard/forecast",
      label: t("nav.forecast"),
      icon: TrendingUp,
      visible: authStore.canAccessAdminFeatures,
      module: "analytics",
      section: "restaurant",
    },
    {
      name: "coupons",
      path: "/dashboard/coupons",
      label: t("nav.coupons"),
      icon: TicketIcon,
      visible: authStore.canAccessAdminFeatures,
      module: "coupons",
      section: "restaurant",
    },
    {
      name: "members",
      path: "/dashboard/members",
      label: t("nav.members"),
      icon: UserRound,
      visible: authStore.canAccessAdminFeatures,
      section: "restaurant",
    },
    {
      name: "analytics",
      path: "/dashboard/analytics",
      label: t("nav.analytics"),
      icon: BarChart3,
      visible: authStore.canAccessAdminFeatures,
      module: "analytics",
      section: "restaurant",
    },
    {
      name: "ai-analytics",
      path: "/dashboard/ai-analytics/insights",
      label: t("nav.aiInsights"),
      icon: Sparkles,
      visible: authStore.canAccessAdminFeatures,
      module: "ai_analytics",
      section: "restaurant",
    },
    {
      name: "group-orders",
      path: "/dashboard/group-orders",
      label: t("nav.groupOrders"),
      icon: Users,
      visible: authStore.hasPermission([UserRole.ADMIN, UserRole.OWNER]),
      section: "restaurant",
    },
    {
      name: "service-bookings",
      path: "/dashboard/service-bookings",
      label: "服務預約",
      icon: CalendarCheck,
      visible: authStore.hasPermission([
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ]),
      section: "restaurant",
    },
    {
      name: "account-management",
      path: "/dashboard/account-management",
      label: t("nav.accountManagement"),
      icon: UserPlus,
      visible: authStore.isAdminRole,
      section: "platform",
    },
    {
      name: "feedback",
      path: "/dashboard/feedback",
      label: t("nav.feedback"),
      icon: MessageSquare,
      visible: authStore.hasPermission([UserRole.ADMIN, UserRole.OWNER]),
      section: "platform",
    },
    {
      name: "monitoring",
      path: "/dashboard/monitoring",
      label: t("nav.monitoring"),
      icon: Activity,
      visible: authStore.canAccessAdminFeatures,
      section: "platform",
    },
    {
      name: "settings",
      path: "/dashboard/settings",
      label: t("nav.settings"),
      icon: Settings,
      visible: authStore.canAccessAdminFeatures,
      section: "platform",
    },
  ];

  let restaurantSectionShown = false;

  return items
    .filter((item) => item.visible)
    .filter(
      (item) =>
        !needsRestaurantContext.value || platformItemNames.has(item.name),
    )
    .map((item) => {
      const showRestaurantSectionLabel =
        shouldShowRestaurantSectionLabel.value &&
        item.section === "restaurant" &&
        !restaurantSectionShown;

      if (showRestaurantSectionLabel) {
        restaurantSectionShown = true;
      }

      return {
        ...item,
        showRestaurantSectionLabel,
      };
    });
});

const isActiveRoute = (path: string) => {
  if (path === "/dashboard" && route.path === "/dashboard") return true;
  if (path === "/dashboard") return false;
  if (path === "/dashboard/platform") return route.path === path;
  return route.path === path || route.path.startsWith(path + "/");
};

const getRoleLabel = (role?: UserRole) => {
  const roleKeys: Record<number, string> = {
    [UserRole.ADMIN]: "header.roles.admin",
    [UserRole.OWNER]: "header.roles.owner",
    [UserRole.CHEF]: "header.roles.chef",
    [UserRole.SERVICE]: "header.roles.service",
    [UserRole.CASHIER]: "header.roles.cashier",
  };
  return role !== undefined ? t(roleKeys[role]) : "";
};
</script>
