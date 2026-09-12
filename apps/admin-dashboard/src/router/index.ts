import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";
import { t } from "@/i18n";
import type { RouteRecordRaw } from "vue-router";
import { isTokenExpired } from "@makanmasak/utils";
import {
  clearChunkRecoveryMark,
  createChunkRecovery,
} from "@makanmasak/utils/chunk-recovery";
import {
  LOGIN_REDIRECT_QUERY,
  loginRouteFor,
  readLoginRedirect,
} from "@/utils/loginRedirect";

const FALLBACK_DOCUMENT_TITLE = "MakanMasak";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/LoginView.vue"),
    meta: { requiresAuth: false, titleKey: "pages.login" },
  },
  {
    path: "/forgot-password",
    name: "ForgotPassword",
    component: () => import("@/views/ForgotPasswordView.vue"),
    meta: { requiresAuth: false, titleKey: "pages.forgotPassword" },
  },
  {
    path: "/reset-password",
    name: "ResetPassword",
    component: () => import("@/views/ResetPasswordView.vue"),
    meta: { requiresAuth: false, titleKey: "pages.resetPassword" },
  },
  {
    path: "/",
    redirect: "/dashboard",
  },
  {
    path: "/owner",
    redirect: "/dashboard/owner-overview",
  },
  {
    path: "/dashboard",
    name: "Dashboard",
    component: () => import("@/layouts/DefaultLayout.vue"),
    meta: {
      requiresAuth: true,
      titleKey: "pages.dashboard",
      roles: [
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.CHEF,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ],
    },
    children: [
      {
        path: "",
        name: "DashboardHome",
        component: () => import("@/views/DashboardView.vue"),
      },
      {
        path: "owner-overview",
        name: "OwnerOverview",
        component: () => import("@/views/OwnerView.vue"),
        meta: {
          titleKey: "pages.ownerOverview",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "platform",
        name: "PlatformOverview",
        component: () => import("@/views/PlatformOverview.vue"),
        meta: {
          titleKey: "pages.platformOverview",
          roles: [UserRole.ADMIN],
        },
      },
      {
        path: "platform/markets",
        name: "PlatformMarkets",
        component: () => import("@/views/PlatformMarketsView.vue"),
        meta: {
          titleKey: "pages.platformOverview",
          roles: [UserRole.ADMIN],
        },
      },
      {
        path: "platform/market-checkouts",
        name: "PlatformMarketCheckouts",
        component: () => import("@/views/PlatformMarketCheckoutsView.vue"),
        meta: {
          titleKey: "pages.platformMarketCheckouts",
          roles: [UserRole.ADMIN],
        },
      },
      {
        // Platform-side customer directory (#299 A4). Role 0 only: it is the
        // one page keyed on the platform customers.id, and the tenant-facing
        // MembersView deliberately cannot reach one.
        path: "platform/customers",
        name: "PlatformCustomers",
        component: () => import("@/views/PlatformCustomersView.vue"),
        meta: {
          titleKey: "pages.platformCustomers",
          roles: [UserRole.ADMIN],
        },
      },
      {
        path: "platform/onboarding",
        name: "PlatformOnboardingApplications",
        component: () =>
          import("@/views/PlatformOnboardingApplicationsView.vue"),
        meta: {
          titleKey: "pages.platformOverview",
          roles: [UserRole.ADMIN],
        },
      },
      {
        path: "orders",
        name: "Orders",
        component: () => import("@/views/OrdersView.vue"),
        meta: {
          titleKey: "pages.orders",
          roles: [
            UserRole.ADMIN,
            UserRole.OWNER,
            UserRole.SERVICE,
            UserRole.CASHIER,
          ],
        },
      },
      {
        path: "kitchen",
        name: "Kitchen",
        component: () => import("@/views/KitchenView.vue"),
        meta: {
          titleKey: "pages.kitchen",
          roles: [UserRole.ADMIN, UserRole.OWNER, UserRole.CHEF],
        },
      },
      {
        path: "menu",
        name: "Menu",
        component: () => import("@/views/MenuView.vue"),
        meta: {
          titleKey: "pages.menu",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "print-agents",
        name: "PrintAgents",
        component: () => import("@/views/PrintAgentsView.vue"),
        meta: {
          titleKey: "pages.printAgents",
          // 收銀（4）看得到狀態，核發／撤銷的端點另外只開給 0/1。
          roles: [UserRole.ADMIN, UserRole.OWNER, UserRole.CASHIER],
        },
      },
      {
        path: "menu/option-groups",
        name: "MenuOptionGroups",
        component: () => import("@/views/OptionGroupsView.vue"),
        meta: {
          titleKey: "pages.optionGroups",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      { path: "tables", redirect: { name: "SeatingTableSetup" } },
      {
        // Employee-facing, unlike everything under /employees: it shows the
        // signed-in user's own shifts and lets them raise a swap request (#320).
        path: "my-shifts",
        name: "MyShifts",
        component: () => import("@/views/MyShiftsView.vue"),
        meta: {
          titleKey: "pages.myShifts",
          roles: [
            UserRole.ADMIN,
            UserRole.OWNER,
            UserRole.CHEF,
            UserRole.SERVICE,
            UserRole.CASHIER,
          ],
        },
      },
      {
        // Employee-facing, like my-shifts: own balances, own leave requests,
        // own cancellations. The manager surface is /employees/leaves, which
        // is ADMIN/OWNER-only, so without this page roles 2-4 had no leave UI
        // at all (#344).
        path: "my-leaves",
        name: "MyLeaves",
        component: () => import("@/views/MyLeavesView.vue"),
        meta: {
          titleKey: "pages.myLeaves",
          roles: [
            UserRole.ADMIN,
            UserRole.OWNER,
            UserRole.CHEF,
            UserRole.SERVICE,
            UserRole.CASHIER,
          ],
        },
      },
      {
        // Employee-facing, like my-shifts: the signed-in user's own shift for
        // today and their own clock in/out. The manager surface is
        // /employees/attendance, which is ADMIN/OWNER-only, so without this
        // page roles 2-4 had no way to clock in at all (#308).
        path: "my-attendance",
        name: "MyAttendance",
        component: () => import("@/views/MyAttendanceView.vue"),
        meta: {
          titleKey: "pages.myAttendance",
          roles: [
            UserRole.ADMIN,
            UserRole.OWNER,
            UserRole.CHEF,
            UserRole.SERVICE,
            UserRole.CASHIER,
          ],
        },
      },
      // Employee Management (replaces old /users route)
      {
        path: "employees",
        component: () => import("@/views/employees/EmployeeManagementView.vue"),
        meta: {
          titleKey: "pages.employees",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
        children: [
          {
            path: "",
            name: "EmployeeList",
            component: () => import("@/views/employees/EmployeeListTab.vue"),
          },
          {
            path: "attendance",
            name: "EmployeeAttendance",
            component: () =>
              import("@/views/employees/AttendanceOverviewTab.vue"),
          },
          {
            path: "scheduling",
            name: "EmployeeScheduling",
            component: () => import("@/views/employees/SchedulingTab.vue"),
          },
          {
            path: "scheduling/advanced",
            name: "AdvancedScheduling",
            component: () => import("@/views/scheduling/SchedulingView.vue"),
            meta: {
              titleKey: "pages.scheduling",
              roles: [UserRole.ADMIN, UserRole.OWNER],
            },
          },
          {
            path: "leaves",
            name: "EmployeeLeaves",
            component: () => import("@/views/employees/LeavesTab.vue"),
          },
          {
            path: ":id",
            component: () => import("@/views/employees/EmployeeDetailView.vue"),
            children: [
              {
                path: "",
                name: "EmployeeProfile",
                component: () =>
                  import("@/views/employees/EmployeeProfileTab.vue"),
              },
              {
                path: "schedule",
                name: "EmployeeSchedule",
                component: () =>
                  import("@/views/employees/EmployeeScheduleTab.vue"),
              },
              {
                path: "leave",
                name: "EmployeeLeave",
                component: () =>
                  import("@/views/employees/EmployeeLeaveTab.vue"),
              },
            ],
          },
        ],
      },
      // Backward compatibility redirect
      {
        path: "users",
        redirect: { name: "EmployeeList" },
      },
      {
        path: "analytics",
        name: "Analytics",
        component: () => import("@/views/AnalyticsView.vue"),
        meta: {
          titleKey: "pages.analytics",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "ingredients",
        name: "Ingredients",
        component: () => import("@/views/ingredients/IngredientsView.vue"),
        meta: {
          titleKey: "pages.ingredients",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "forecast",
        name: "Forecast",
        component: () => import("@/views/forecast/ForecastView.vue"),
        meta: {
          titleKey: "pages.forecast",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "feedback",
        name: "Feedback",
        component: () => import("@/views/FeedbackView.vue"),
        meta: {
          titleKey: "pages.feedback",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        // The owner-facing half of "訂閱與帳務". /dashboard/subscriptions is the
        // platform-operator console (role 0, lists every tenant); until this
        // route existed a shop owner had no way to see their own plan, trial
        // window or usage at all, even though /me/modules and /me/usage had
        // been serving exactly that data with no frontend consumer (#315/F20).
        path: "billing",
        name: "Billing",
        component: () => import("@/views/BillingView.vue"),
        meta: {
          titleKey: "pages.billing",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "settings",
        name: "Settings",
        component: () => import("@/views/SettingsView.vue"),
        meta: {
          titleKey: "pages.settings",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "coupons",
        name: "Coupons",
        component: () => import("@/views/CouponsView.vue"),
        meta: {
          titleKey: "pages.coupons",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "members",
        name: "Members",
        component: () => import("@/views/MembersView.vue"),
        meta: {
          titleKey: "pages.members",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        // Diner reviews of completed orders (#286). Distinct from
        // /dashboard/feedback, which is the platform's support-ticket queue —
        // #266 records the two being confused. This one is restaurant-scoped,
        // so it is deliberately absent from adminRestaurantOptionalRoutes.
        path: "reviews",
        name: "Reviews",
        component: () => import("@/views/ReviewsView.vue"),
        meta: {
          titleKey: "pages.reviews",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        // Marketing pushes to this shop's followers (#335). Restaurant-scoped
        // like reviews, so it is deliberately absent from
        // adminRestaurantOptionalRoutes: an admin with no shop selected has
        // nothing to send as. Market-scoped sends live on the platform markets
        // page instead, which is role 0 only.
        path: "broadcasts",
        name: "Broadcasts",
        component: () => import("@/views/BroadcastsView.vue"),
        meta: {
          titleKey: "pages.broadcasts",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "pos",
        component: () => import("@/views/POSView.vue"),
        meta: {
          titleKey: "pages.pos",
          roles: [UserRole.ADMIN, UserRole.OWNER, UserRole.CASHIER],
        },
        children: [
          {
            path: "",
            redirect: { name: "POSCheckout" },
          },
          {
            path: "checkout",
            name: "POSCheckout",
            component: () => import("@/views/CashierView.vue"),
          },
          {
            path: "management",
            name: "POSManagement",
            component: () => import("@/views/POSManagementView.vue"),
          },
        ],
      },
      {
        path: "group-orders",
        name: "GroupOrders",
        component: () => import("@/views/GroupOrdersView.vue"),
        meta: {
          titleKey: "pages.groupOrders",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "service-bookings",
        name: "ServiceBookings",
        component: () => import("@/views/ServiceBookingsView.vue"),
        meta: {
          titleKey: "pages.serviceBookings",
          roles: [
            UserRole.ADMIN,
            UserRole.OWNER,
            UserRole.SERVICE,
            UserRole.CASHIER,
          ],
        },
      },
      // Redirect old /queue path to unified seating management
      {
        path: "queue",
        redirect: { name: "SeatingQueueDashboard" },
      },
      {
        path: "ai-analytics/config",
        name: "AIProviderConfig",
        component: () => import("@/views/ai-analytics/AIProviderConfig.vue"),
        meta: {
          titleKey: "pages.aiConfig",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "ai-analytics/insights",
        name: "AIInsightsDashboard",
        component: () => import("@/views/ai-analytics/AIInsightsDashboard.vue"),
        meta: {
          titleKey: "pages.aiInsights",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      {
        path: "ai-analytics/products",
        name: "ProductAnalytics",
        component: () =>
          import("@/views/ai-analytics/ProductAnalyticsView.vue"),
        meta: {
          titleKey: "pages.productAnalysis",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
      // Employee scheduling route (redirects to unified employee management tab)
      { path: "scheduling", redirect: { name: "EmployeeScheduling" } },
      // Leave management route (redirects to unified employee management tab)
      { path: "leaves", redirect: { name: "EmployeeLeaves" } },
      // Unified Seating Management (座位管理)
      {
        path: "seating",
        component: () => import("@/views/seating/SeatingManagementView.vue"),
        meta: {
          titleKey: "pages.seatingManagement",
          roles: [
            UserRole.ADMIN,
            UserRole.OWNER,
            UserRole.SERVICE,
            UserRole.CASHIER,
          ],
        },
        children: [
          {
            path: "table-setup",
            name: "SeatingTableSetup",
            component: () => import("@/views/seating/TableSetupTab.vue"),
            meta: {
              roles: [UserRole.ADMIN, UserRole.OWNER],
            },
          },
          {
            path: "tables/:id",
            name: "TableDetail",
            component: () => import("@/views/TableDetailView.vue"),
            meta: {
              roles: [UserRole.ADMIN, UserRole.OWNER],
            },
          },
          {
            path: "",
            name: "SeatingReservations",
            component: () => import("@/views/seating/ReservationTab.vue"),
          },
          {
            path: "waiting-list",
            name: "SeatingWaitingList",
            component: () => import("@/views/seating/WaitingListTab.vue"),
          },
          {
            path: "queue-dashboard",
            name: "SeatingQueueDashboard",
            component: () => import("@/views/seating/QueueDashboardTab.vue"),
          },
        ],
      },
      // Legacy redirects for backward compatibility
      { path: "reservations", redirect: { name: "SeatingReservations" } },
      { path: "waiting", redirect: "/dashboard/seating/waiting-list" },
      { path: "waiting/list", redirect: { name: "SeatingWaitingList" } },
      {
        path: "waiting/dashboard",
        redirect: { name: "SeatingQueueDashboard" },
      },
      {
        path: "waiting-list",
        redirect: { name: "SeatingWaitingList" },
      },
      // Account management (Admin only - platform level)
      {
        path: "account-management",
        name: "AccountManagement",
        component: () => import("@/views/AccountManagementView.vue"),
        meta: {
          titleKey: "pages.accountManagement",
          roles: [UserRole.ADMIN],
        },
      },
      // Subscription management (Admin only - platform level)
      {
        path: "subscriptions",
        name: "Subscriptions",
        component: () => import("@/views/SubscriptionsView.vue"),
        meta: {
          titleKey: "pages.subscriptions",
          roles: [UserRole.ADMIN],
        },
      },
      // System monitoring
      {
        path: "monitoring",
        name: "Monitoring",
        component: () => import("@/views/MonitoringView.vue"),
        meta: {
          titleKey: "pages.monitoring",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
    ],
  },
  // Redirect old /cashier path to unified POS system
  {
    path: "/cashier",
    redirect: "/dashboard/pos/checkout",
  },
  {
    path: "/service",
    name: "Service",
    component: () => import("@/layouts/ServiceLayout.vue"),
    meta: {
      requiresAuth: true,
      titleKey: "pages.service",
      roles: [UserRole.ADMIN, UserRole.OWNER, UserRole.SERVICE],
    },
    children: [
      {
        path: "",
        name: "ServiceDelivery",
        component: () => import("@/views/ServiceView.vue"),
      },
    ],
  },
  {
    path: "/unauthorized",
    name: "Unauthorized",
    component: () => import("@/views/UnauthorizedView.vue"),
    meta: { requiresAuth: false, titleKey: "pages.unauthorized" },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/NotFoundView.vue"),
    meta: { requiresAuth: false, titleKey: "pages.notFound" },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_, __, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    }
    return { top: 0 };
  },
});

export const adminRestaurantOptionalRoutes = [
  "PlatformOverview",
  "PlatformMarkets",
  "PlatformMarketCheckouts",
  "PlatformOnboardingApplications",
  "PlatformCustomers",
  "Monitoring",
  "Settings",
  "AccountManagement",
  "Feedback", // Admin views all shops' feedback at platform level
  "Subscriptions", // Admin manages all subscriptions at platform level
];

/**
 * A deploy replaces every hashed chunk, so a tab left open on the dashboard
 * asks for filenames that are gone and simply stops navigating — silently,
 * since this app has no error view to fall back to. Fetching the document
 * again is the only recovery; no client-side routing can conjure a file the
 * edge stopped serving.
 *
 * Once per page, unlike the kitchen display: someone is sitting in front of
 * this one and can refresh, so a screen that keeps reloading on its own would
 * be more confusing than a stalled one.
 */
const CHUNK_RELOAD_KEY = "makanmasak_admin_chunk_reload";
const recoverFromChunkFailure = createChunkRecovery({
  storageKey: CHUNK_RELOAD_KEY,
});

router.onError((error, to) => {
  console.error("[router] navigation failed", error);
  recoverFromChunkFailure(error, to);
});

router.afterEach(() => {
  // Navigation worked, so the stale build is behind us; the next deploy earns
  // its own attempt rather than inheriting this one.
  clearChunkRecoveryMark(CHUNK_RELOAD_KEY);
});

router.beforeEach(async (to, _, next) => {
  const authStore = useAuthStore();

  // 對於不需要認證的路由
  if (to.meta.requiresAuth === false) {
    if (to.name === "Login" && authStore.isAuthenticated) {
      // 已登入用戶訪問登入頁，優先回到原本要去的頁面，否則角色默認頁面
      return next(
        readLoginRedirect(to.query[LOGIN_REDIRECT_QUERY]) ??
          authStore.getDefaultRoute(),
      );
    }
    return next();
  }

  // 檢查用戶是否已認證
  if (!authStore.isAuthenticated) {
    return next(loginRouteFor(to.fullPath));
  }

  // Check if token is expired — attempt refresh before proceeding
  if (authStore.token && isTokenExpired(authStore.token, 30)) {
    const refreshed = await authStore.refreshToken();
    if (!refreshed) {
      return next(loginRouteFor(to.fullPath));
    }
  }

  // 使用新的路由權限檢查
  const routeName = to.name as string;
  if (routeName && !authStore.canAccessRoute(routeName)) {
    console.warn(
      `Access denied to route: ${routeName} for role: ${authStore.userRole}`,
    );
    return next("/unauthorized");
  }

  const adminRestaurantId = firstQueryString(to.query.adminRestaurantId);
  const adminRestaurantName = firstQueryString(to.query.adminRestaurantName);
  if (authStore.isAdminRole && adminRestaurantId && adminRestaurantName) {
    authStore.selectRestaurant(adminRestaurantId, adminRestaurantName);
  }

  // Admin without restaurant context → redirect to platform overview
  if (authStore.isAdminRole && !authStore.hasRestaurantContext) {
    if (routeName && !adminRestaurantOptionalRoutes.includes(routeName)) {
      return next("/dashboard/platform");
    }
  }

  // 備用：檢查 meta.roles（向後兼容）
  const requiredRoles = to.meta.roles as UserRole[] | undefined;
  if (requiredRoles && requiredRoles.length > 0) {
    const hasPermission = requiredRoles.some((role) =>
      authStore.hasPermission(role),
    );

    if (!hasPermission) {
      return next("/unauthorized");
    }
  }

  // Set page title using i18n
  document.title = buildDocumentTitle(to.meta.titleKey as string | undefined);

  next();
});

/**
 * Page titles are cosmetic, but they are translated inside the navigation
 * guard — so a throwing i18n runtime would abort every navigation and leave a
 * blank page (#60). Degrade to the untranslated title instead.
 */
function buildDocumentTitle(titleKey: string | undefined): string {
  try {
    const pageTitle = titleKey ? t(titleKey) : FALLBACK_DOCUMENT_TITLE;
    return `${pageTitle} - ${t("pages.adminSuffix")}`;
  } catch (error) {
    console.error("[i18n] document title translation failed", error);
    return FALLBACK_DOCUMENT_TITLE;
  }
}

function firstQueryString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string");
  }

  return typeof value === "string" ? value : undefined;
}
