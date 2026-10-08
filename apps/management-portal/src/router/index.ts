import {
  clearChunkRecoveryMark,
  createChunkRecovery,
} from "@makanmasak/utils/chunk-recovery";
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { isManagementAuthenticated } from "@/services/auth";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/LoginView.vue"),
    meta: { title: "登入", public: true },
  },
  {
    path: "/",
    name: "Dashboard",
    component: () => import("@/views/DashboardView.vue"),
    meta: { title: "總覽" },
  },
  {
    path: "/tenants",
    name: "Tenants",
    component: () => import("@/views/TenantsView.vue"),
    meta: { title: "租戶管理" },
  },
  {
    path: "/tenants/:id",
    name: "TenantDetail",
    component: () => import("@/views/TenantDetailView.vue"),
    meta: { title: "租戶詳情" },
  },
  {
    path: "/deployments",
    name: "Deployments",
    component: () => import("@/views/DeploymentsView.vue"),
    meta: { title: "部署管理" },
  },
  {
    path: "/health",
    name: "Health",
    component: () => import("@/views/HealthView.vue"),
    meta: { title: "健康監控" },
  },
  {
    path: "/licenses",
    name: "Licenses",
    component: () => import("@/views/LicensesView.vue"),
    meta: { title: "授權管理" },
  },
  {
    path: "/markets",
    name: "Markets",
    component: () => import("@/views/MarketsView.vue"),
    meta: { title: "市場管理" },
  },
  {
    path: "/policies",
    name: "Policies",
    component: () => import("@/views/PoliciesView.vue"),
    meta: { title: "地區政策" },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/NotFoundView.vue"),
    meta: { title: "頁面不存在" },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

function safeRedirectTarget(value: unknown): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
    ? value
    : "/";
}

// 設置頁面標題
/**
 * A deploy replaces every hashed chunk, so a portal left open — and a health or
 * monitoring page is exactly the tab nobody closes — asks for filenames that
 * are gone, then simply stops navigating with nothing on screen to say why.
 * Fetching the document again is the only recovery.
 *
 * Once per page: an operator is at a desk and can refresh, so a portal that
 * reloads itself on a timer would confuse more than it healed.
 */
const CHUNK_RELOAD_KEY = "makanmasak_management_chunk_reload";
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

router.beforeEach((to, _from, next) => {
  const title = to.meta.title as string;
  document.title = title
    ? `${title} - MakanMasak 管理平台`
    : "MakanMasak 管理平台";

  const authenticated = isManagementAuthenticated();
  if (to.meta.public) {
    if (to.name === "Login" && authenticated) {
      next(safeRedirectTarget(to.query.redirect));
      return;
    }
    next();
    return;
  }

  if (!authenticated) {
    next({
      name: "Login",
      query: { redirect: to.fullPath },
    });
    return;
  }

  next();
});

export default router;
