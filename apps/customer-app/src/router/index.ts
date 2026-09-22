import { getGuestOrderToken } from "@/utils/guest-order-tokens";
import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { safeTranslate } from "@/utils/i18n";
import {
  clearChunkRecoveryMark,
  createChunkRecovery,
} from "@makanmasak/utils/chunk-recovery";
// Deliberately eager. Every other view is a chunk, and the failure this view
// exists to report is "a chunk could not be fetched" — a deploy replaces the
// hashed filenames, so a tab still holding the previous index.html asks for
// files that are gone. Lazy-loading the recovery view meant it was a chunk
// from the same dead build: it 404'd too, re-entered onError, and the app spun
// (18,994 console errors in one observed run). Living in the entry bundle,
// which by definition already loaded, is what makes it able to render at all.
import ErrorView from "@/views/ErrorView.vue";

const FALLBACK_DOCUMENT_TITLE = "MakanMasak";

function firstQueryString(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string");
  }
  return typeof value === "string" ? value : undefined;
}

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "Home",
    component: () => import("@/views/HomeView.vue"),
    meta: {
      titleKey: "navigation.appTitle",
    },
  },
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/LoginView.vue"),
    meta: {
      titleKey: "navigation.login",
      requiresGuest: true,
    },
  },
  {
    path: "/register",
    name: "Register",
    component: () => import("@/views/RegisterView.vue"),
    meta: {
      titleKey: "navigation.register",
      requiresGuest: true,
    },
  },
  {
    path: "/forgot-password",
    name: "ForgotPassword",
    component: () => import("@/views/ForgotPasswordView.vue"),
    meta: {
      titleKey: "navigation.forgotPassword",
      requiresGuest: true,
    },
  },
  // The reset and verification links arrive from email, so they must open for
  // whoever clicks them — including a diner who is already signed in on this
  // device. No requiresGuest here: bouncing them to /orders would strand the
  // token they came to spend.
  {
    path: "/reset-password",
    name: "ResetPassword",
    component: () => import("@/views/ResetPasswordView.vue"),
    meta: {
      titleKey: "navigation.resetPassword",
    },
  },
  {
    path: "/verify-email",
    name: "VerifyEmail",
    component: () => import("@/views/VerifyEmailView.vue"),
    meta: {
      titleKey: "navigation.verifyEmail",
    },
  },
  {
    path: "/orders",
    name: "Orders",
    component: () => import("@/views/OrderHistoryView.vue"),
    meta: {
      titleKey: "navigation.myOrders",
      requiresAuth: true,
    },
  },
  {
    path: "/orders/:id",
    name: "OrderDetail",
    component: () => import("@/views/OrderTrackingView.vue"),
    props: (route) => ({
      orderId: String(route.params.id),
    }),
    meta: {
      titleKey: "navigation.orderDetail",
      requiresAuth: true,
      allowGuestToken: true,
    },
  },
  {
    path: "/profile",
    name: "Profile",
    component: () => import("@/views/ProfileView.vue"),
    meta: {
      titleKey: "navigation.profileCenter",
      requiresAuth: true,
    },
  },
  {
    path: "/menu",
    name: "Menu",
    component: () => import("@/views/HomeView.vue"),
    meta: {
      titleKey: "navigation.browseMenu",
    },
  },
  {
    path: "/scan",
    name: "QRScan",
    component: () => import("@/views/QRScanView.vue"),
    meta: {
      titleKey: "navigation.scanQR",
    },
  },
  {
    path: "/order",
    name: "SignedOrderEntry",
    component: () => import("@/views/SignedOrderEntryView.vue"),
    meta: {
      titleKey: "navigation.browseMenu",
    },
  },
  {
    path: "/group/order/:groupOrderId",
    name: "GroupOrder",
    component: () => import("@/views/GroupOrderView.vue"),
    props: (route) => ({
      groupOrderId: String(route.params.groupOrderId),
    }),
    meta: {
      titleKey: "group.sharedCart",
    },
  },
  {
    path: "/group/:shareCode",
    name: "GroupOrderJoin",
    component: () => import("@/views/GroupOrderJoinView.vue"),
    props: (route) => ({
      shareCode: String(route.params.shareCode),
    }),
    meta: {
      titleKey: "group.joinGroupOrder",
    },
  },
  {
    path: "/restaurant/:restaurantId/table/:tableId",
    name: "RestaurantMenu",
    component: () => import("@/views/MenuView.vue"),
    props: (route) => ({
      restaurantId: route.params.restaurantId,
      tableId: Number(route.params.tableId),
    }),
    meta: {
      titleKey: "navigation.browseMenu",
    },
  },
  {
    path: "/restaurant/:restaurantId/shop/order-type",
    name: "OrderTypeLanding",
    component: () => import("@/views/OrderTypeLandingView.vue"),
    props: true,
    meta: { titleKey: "navigation.orderTypeSelect" },
  },
  {
    path: "/restaurant/:restaurantId/shop/menu",
    name: "ShopMenu",
    component: () => import("@/views/ShopMenuView.vue"),
    props: (route) => ({
      restaurantId: route.params.restaurantId,
      // Carried from the scanned sticker so checkout can prove which code it
      // came from — the server retires older ones after a regeneration.
      shopQrCode: route.query.qr as string | undefined,
      waitingTicketId: route.query.waitingTicketId as string | undefined,
      linkedItemId: route.query.itemId,
      linkedCategoryName: route.query.categoryName,
      linkedServiceItemId: route.query.serviceItemId,
      linkedServices: route.query.services,
      returnPath: firstQueryString(route.query.returnPath),
      returnLabel: firstQueryString(route.query.returnLabel),
    }),
    meta: {
      titleKey: "navigation.shopMenu",
    },
  },
  {
    path: "/restaurant/:restaurantId/services/:serviceItemId/book",
    name: "ServiceBooking",
    component: () => import("@/views/ServiceBookingView.vue"),
    props: (route) => ({
      restaurantId: String(route.params.restaurantId),
      serviceItemId: Number(route.params.serviceItemId),
    }),
    meta: {
      titleKey: "navigation.serviceBooking",
    },
  },
  {
    path: "/restaurant/:restaurantId/reserve",
    name: "Reservation",
    component: () => import("@/views/ReservationView.vue"),
    props: (route) => ({
      restaurantId: String(route.params.restaurantId),
    }),
    meta: {
      titleKey: "reservationBooking.title",
    },
  },
  {
    path: "/restaurant/:restaurantId/table/:tableId/cart",
    name: "Cart",
    component: () => import("@/views/CartView.vue"),
    props: (route) => ({
      restaurantId: route.params.restaurantId,
      tableId: Number(route.params.tableId),
    }),
    meta: {
      titleKey: "navigation.shoppingCart",
    },
  },
  {
    path: "/restaurant/:restaurantId/shop/order/:orderId",
    name: "ShopOrderTracking",
    component: () => import("@/views/OrderTrackingView.vue"),
    props: (route) => ({
      restaurantId: route.params.restaurantId,
      tableId: 0,
      orderId: String(route.params.orderId),
      isShopOrder: true,
    }),
    meta: {
      titleKey: "navigation.orderTracking",
    },
  },
  {
    path: "/r/:restaurantId/wait-list",
    name: "JoinWaitingList",
    component: () => import("@/views/waiting-list/JoinWaitingListView.vue"),
    props: true,
    meta: {
      titleKey: "waitingList.join.title",
    },
  },
  {
    path: "/r/:restaurantId/wait-list/history",
    name: "WaitingListHistory",
    component: () => import("@/views/waiting-list/WaitingListHistoryView.vue"),
    props: true,
    meta: {
      titleKey: "waitingList.history.title",
    },
  },
  {
    path: "/r/:restaurantId/wait-list/:ticketId",
    name: "MyWaitingTicket",
    component: () => import("@/views/waiting-list/MyWaitingTicketView.vue"),
    props: true,
    meta: {
      titleKey: "waitingList.ticket.title",
    },
  },
  {
    path: "/restaurant/:restaurantId/table/:tableId/order/:orderId",
    name: "OrderTracking",
    component: () => import("@/views/OrderTrackingView.vue"),
    props: (route) => ({
      restaurantId: route.params.restaurantId,
      tableId: Number(route.params.tableId),
      orderId: String(route.params.orderId),
    }),
    meta: {
      titleKey: "navigation.orderTracking",
    },
  },
  {
    path: "/about",
    name: "About",
    component: () => import("@/views/AboutView.vue"),
    meta: {
      titleKey: "navigation.about",
    },
  },
  {
    path: "/privacy",
    name: "Privacy",
    component: () => import("@/views/PrivacyView.vue"),
    meta: {
      titleKey: "navigation.privacy",
    },
  },
  {
    path: "/terms",
    name: "Terms",
    component: () => import("@/views/TermsView.vue"),
    meta: {
      titleKey: "navigation.terms",
    },
  },
  {
    path: "/discover",
    name: "Discover",
    component: () => import("@/views/DiscoveryView.vue"),
    meta: {
      titleKey: "navigation.discover",
    },
  },
  {
    path: "/markets",
    name: "Markets",
    component: () => import("@/views/MarketsView.vue"),
    meta: {
      titleKey: "navigation.markets",
    },
  },
  {
    path: "/markets/:slug",
    name: "MarketDetail",
    component: () => import("@/views/MarketDetailView.vue"),
    props: true,
    meta: {
      titleKey: "navigation.markets",
    },
  },
  {
    path: "/markets/:slug/checkout/:checkoutId",
    name: "MarketCheckoutTracking",
    component: () => import("@/views/MarketCheckoutTrackingView.vue"),
    props: true,
    meta: {
      titleKey: "navigation.markets",
    },
  },
  {
    path: "/error",
    name: "Error",
    component: ErrorView,
    props: (route) => ({
      code: route.query.code,
      message: route.query.message,
    }),
    meta: {
      titleKey: "navigation.error",
    },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/NotFoundView.vue"),
    meta: {
      titleKey: "navigation.pageNotFound",
    },
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    } else if (to.hash) {
      return {
        el: to.hash,
        behavior: "smooth",
      };
    } else {
      return { top: 0 };
    }
  },
});

// 路由守衛
router.beforeEach(async (to, from, next) => {
  // 設置頁面標題
  // Cosmetic, and it runs before everything else in the guard — it must never
  // be able to abort the navigation (#60).
  const titleKey = to.meta?.titleKey as string;
  if (titleKey) {
    document.title = safeTranslate(titleKey, FALLBACK_DOCUMENT_TITLE);
  }

  // 獲取認證狀態
  const authStore = useAuthStore();
  const requiresAuth = to.meta.requiresAuth as boolean;
  const requiresGuest = to.meta.requiresGuest as boolean;

  // 檢查需要認證的路由
  if (requiresAuth) {
    // Allow guest token holders to access routes with allowGuestToken meta
    const allowGuestToken = to.meta.allowGuestToken as boolean;
    const hasGuestToken = !!getGuestOrderToken(String(to.params.orderId ?? ""));

    if (allowGuestToken && hasGuestToken) {
      // Guest token is sufficient for this route
      next();
      return;
    }

    // Restore an access token from the HttpOnly refresh cookie when this is a
    // fresh page load. Access tokens are intentionally never persisted.
    const isValid = await authStore.checkAuth();
    if (!isValid) {
      next({
        name: "Login",
        query: { redirect: to.fullPath },
      });
      return;
    }
  }

  // 檢查需要訪客身份的路由（如登入、註冊頁）
  if (
    requiresGuest &&
    (authStore.isAuthenticated || (await authStore.checkAuth()))
  ) {
    // 已登入用戶訪問登入/註冊頁，重定向到訂單頁
    next({ name: "Orders" });
    return;
  }

  // 檢查餐廳和桌台參數
  if (to.params.restaurantId && to.params.tableId) {
    const restaurantId = to.params.restaurantId as string;
    const tableId = Number(to.params.tableId);

    // restaurantId is a UUID string — validate it's non-empty
    // tableId must be a valid number
    if (!restaurantId || isNaN(tableId) || tableId <= 0) {
      next({
        name: "Error",
        query: {
          code: "400",
          message: safeTranslate(
            "errors.invalidRestaurantOrTable",
            "餐廳或桌號無效",
          ),
        },
      });
      return;
    }
  }

  next();
});

const CHUNK_RELOAD_KEY = "makanmakan_chunk_reload_path";
const recoverFromChunkFailure = createChunkRecovery({
  storageKey: CHUNK_RELOAD_KEY,
});

router.afterEach(() => {
  // 頁面載入完成後的處理
  // 可以在這裡添加 Google Analytics 或其他追蹤代碼

  // Navigation worked, so whatever was stale is now loaded. Forgetting the
  // mark lets a later deploy earn its own reload instead of being refused one.
  clearChunkRecoveryMark(CHUNK_RELOAD_KEY);
});

// 錯誤處理
router.onError((error, to) => {
  // This is the only trace a fatal navigation failure leaves behind, which is
  // why production builds no longer strip console.error (#60).
  console.error("路由錯誤:", error);

  // A chunk 404 almost always means the page still exists and only this build
  // is gone, so the document is fetched again and the diner lands where they
  // were headed. Once per page: if it fails again the build really is
  // unreachable, and the error view below is the honest answer.
  if (recoverFromChunkFailure(error, to)) return;

  router.push({
    name: "Error",
    query: {
      code: "500",
      // The recovery path must not re-run whatever just failed.
      message: safeTranslate("errors.routeLoadFailed", "頁面載入失敗"),
    },
  });
});

export default router;
