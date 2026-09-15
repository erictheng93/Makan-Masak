import {
  clearChunkRecoveryMark,
  createChunkRecovery,
} from "@makanmasak/utils/chunk-recovery";
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "Home",
    component: () => import("@/views/HomeView.vue"),
    meta: { title: "獨立部署申請" },
  },
  {
    path: "/apply",
    name: "Apply",
    component: () => import("@/views/ApplyView.vue"),
    meta: { title: "填寫申請" },
  },
  {
    path: "/success",
    name: "Success",
    component: () => import("@/views/SuccessView.vue"),
    meta: { title: "申請成功" },
  },
  {
    path: "/status/:applicationId",
    name: "ApplicationStatus",
    component: () => import("@/views/ApplicationStatusView.vue"),
    meta: { title: "申請狀態" },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/**
 * A deploy replaces every hashed chunk, so a tab opened before it asks for
 * filenames that are gone and stops navigating. This flow is walked once, by
 * someone deciding whether to become a tenant, which makes a dead page here
 * expensive out of proportion to how rarely it happens.
 *
 * Reloading is safe because the draft lives in session storage and is restored
 * on load; the only field not persisted is the application secret, which no
 * screen reads.
 */
const CHUNK_RELOAD_KEY = "makanmasak_onboarding_chunk_reload";
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
  document.title = title ? `${title} - MakanMasak` : "MakanMasak 獨立部署";
  next();
});

export default router;
