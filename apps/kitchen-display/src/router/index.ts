import { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/login",
  },
  {
    path: "/login",
    name: "Login",
    component: () => import("../views/LoginView.vue"),
    meta: {
      requiresAuth: false,
      title: "廚房系統登入",
    },
  },
  {
    path: "/s/:slug",
    name: "ShopLogin",
    component: () => import("../views/LoginView.vue"),
    meta: {
      requiresAuth: false,
      title: "廚房系統登入",
    },
  },
  {
    path: "/kitchen/:restaurantId",
    name: "Kitchen",
    component: () => import("../views/EnhancedKitchenDashboard.vue"),
    props: (route) => ({
      restaurantId: route.params.restaurantId as string,
    }),
    meta: {
      requiresAuth: true,
      requiredRole: 2, // Chef role
      title: "廚房顯示系統",
    },
  },
  {
    // Role 2 is logged out of admin-dashboard on sight, so the employee shift
    // swap entry has to live here as well (#320).
    path: "/my-shifts",
    name: "MyShifts",
    component: () => import("../views/MyShiftsView.vue"),
    meta: {
      requiresAuth: true,
      requiredRole: 2,
      title: "我的班表",
    },
  },
  {
    path: "/settings",
    name: "Settings",
    component: () => import("../views/SettingsView.vue"),
    meta: {
      requiresAuth: true,
      title: "系統設定",
    },
  },
  {
    path: "/history",
    name: "History",
    component: () => import("../views/HistoryView.vue"),
    meta: {
      requiresAuth: true,
      title: "歷史記錄",
    },
  },
  {
    path: "/unauthorized",
    name: "Unauthorized",
    component: () => import("../views/UnauthorizedView.vue"),
    meta: {
      requiresAuth: false,
      title: "權限不足",
    },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("../views/NotFoundView.vue"),
    meta: {
      requiresAuth: false,
      title: "頁面不存在",
    },
  },
];

export default routes;
