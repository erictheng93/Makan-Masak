const root = require("node:path").resolve(__dirname, "../../..");
const fs = require("fs");
const path = require("path");
const ts = require(root + "/node_modules/typescript");
const { chromium } = require(root + "/node_modules/@playwright/test");
const reviewRoot = root + "/docs/design-review-2026-11-11";
const out = reviewRoot + "/implementation";
const apps = [
  "customer-app",
  "admin-dashboard",
  "kitchen-display",
  "management-portal",
  "onboarding-app",
];
const manifest = JSON.parse(
  fs.readFileSync(reviewRoot + "/baseline-manifest.json", "utf8"),
);
for (const tab of [
  "markets",
  "contact",
  "orders",
  "qrcode",
  "notifications",
  "security",
  "integrations",
  "payments",
])
  if (!manifest.routes.some((r) => r.name === "Settings-" + tab)) {
    const base = manifest.routes.find(
      (r) => r.app === "admin-dashboard" && r.name === "Settings",
    );
    manifest.routes.push({
      ...base,
      name: "Settings-" + tab,
      route: "/dashboard/settings?tab=" + tab,
      variant: "設定分頁 " + tab,
      screenshot: undefined,
    });
  }
const token =
  "eyJhbGciOiJub25lIn0." +
  Buffer.from(
    JSON.stringify({
      sub: "fixture-review",
      exp: Math.floor(Date.now() / 1000) + 86400,
      role: 0,
    }),
  ).toString("base64url") +
  ".fixture";
const restaurant = {
  id: "demo-restaurant",
  name: "示範餐廳",
  slug: "demo-shop",
  description: "本機設計檢視用範例餐廳",
  isActive: true,
  isOpen: true,
  address: "台北市示範路 1 號",
  phone: "02-0000-0000",
  currency: "TWD",
  timezone: "Asia/Taipei",
  enableShopMode: true,
  settings: { enableDineIn: true, enableTakeaway: true, enableDelivery: false },
  businessHours: {},
};
const customer = {
  id: "fixture-customer",
  displayName: "範例顧客",
  primaryPhone: "0900000000",
  primaryEmail: "review@example.test",
  locale: "zh-TW",
  status: "active",
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
};
const categories = [
  {
    id: 1,
    name: "經典主餐",
    restaurantId: "demo-restaurant",
    sortOrder: 0,
    isActive: true,
  },
];
const menuItems = [
  {
    id: 1,
    name: "招牌海南雞飯",
    description: "香嫩雞肉、雞油飯與特製醬汁",
    price: 150,
    categoryId: 1,
    restaurantId: "demo-restaurant",
    isAvailable: true,
    isFeatured: true,
    sortOrder: 0,
  },
  {
    id: 2,
    name: "叻沙麵",
    description: "濃郁椰奶湯底，搭配鮮蝦與豆腐",
    price: 180,
    categoryId: 1,
    restaurantId: "demo-restaurant",
    isAvailable: true,
    isFeatured: false,
    sortOrder: 1,
  },
  {
    id: 3,
    name: "南洋咖哩雞飯",
    description: "每日現煮咖哩與時蔬",
    price: 160,
    categoryId: 1,
    restaurantId: "demo-restaurant",
    isAvailable: true,
    isFeatured: false,
    sortOrder: 2,
  },
];
const user = {
  id: 1,
  username: "design-review",
  fullName: "範例管理員",
  name: "範例管理員",
  role: 0,
  restaurantId: "demo-restaurant",
  restaurantName: "示範餐廳",
  isActive: true,
  email: "review@example.test",
};
function routePath(r) {
  return (
    r.app === "onboarding-app" &&
    ["Success", "ApplicationStatus"].includes(r.name)
      ? r.route + "#local-fixture-secret"
      : r.route
  )
    .replace("/:pathMatch(.*)*", "/preview-not-found")
    .replace(/:restaurantId/g, "demo-restaurant")
    .replace(/:tableId/g, "1")
    .replace(/:applicationId/g, "demo-application")
    .replace(/:groupOrderId/g, "demo-group")
    .replace(/:shareCode/g, "DEMO12")
    .replace(/:ticketId/g, "demo-ticket")
    .replace(/:serviceItemId/g, "1")
    .replace(/:orderId/g, "101")
    .replace(/:checkoutId/g, "demo-checkout")
    .replace(/:slug/g, "demo-shop")
    .replace(/:id/g, "1");
}

async function installReviewData(context, app) {
  await context.addInitScript(
    ({ app, token, user, customer }) => {
      localStorage.setItem("makanmakan_locale", "zh-TW");
      if (
        ["/login", "/forgot-password", "/reset-password", "/register"].includes(
          location.pathname,
        ) ||
        location.pathname.startsWith("/s/")
      ) {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem("makanmakan_locale", "zh-TW");
      }
      if (app === "onboarding-app")
        sessionStorage.setItem(
          "onboarding_application",
          JSON.stringify({
            applicationId: "demo-application",
            assignedSubdomain: "demo-shop",
            application: {
              businessName: "範例南洋餐館",
              contactName: "範例店主",
              contactEmail: "review@example.test",
              contactPhone: "0900000000",
              address: "示範路1號",
              district: "中正區",
              city: "台北市",
              countryCode: "TW",
              planId: "trial",
              status: "submitted",
              latitude: 25.03,
              longitude: 121.56,
            },
          }),
        );
      if (app === "customer-app")
        localStorage.setItem(
          "makanmakan_cart_demo-restaurant_1",
          JSON.stringify({
            restaurantId: "demo-restaurant",
            tableId: 1,
            timestamp: Date.now(),
            items: [
              {
                id: "fixture-item",
                menuItem: {
                  id: 1,
                  name: "招牌海南雞飯",
                  price: 150,
                  isAvailable: true,
                  categoryId: 1,
                  restaurantId: "demo-restaurant",
                },
                quantity: 2,
                price: 150,
                totalPrice: 300,
                notes: "少油",
              },
            ],
          }),
        );
      if (
        app === "admin-dashboard" &&
        !["/login", "/forgot-password", "/reset-password"].includes(
          location.pathname,
        ) &&
        !location.pathname.startsWith("/s/")
      ) {
        localStorage.setItem("auth_user", JSON.stringify(user));
        localStorage.setItem("mm_csrf_token_auth", "fixture-csrf");
        sessionStorage.setItem(
          "admin_selected_restaurant_id",
          "demo-restaurant",
        );
        sessionStorage.setItem("admin_selected_restaurant_name", "示範餐廳");
      }
      if (
        app === "kitchen-display" &&
        !["/login"].includes(location.pathname) &&
        !location.pathname.startsWith("/s/")
      ) {
        localStorage.setItem("kitchen_auth_token", token);
        localStorage.setItem(
          "kitchen_user",
          JSON.stringify({ ...user, role: 2, fullName: "範例廚師" }),
        );
      }
      if (app === "management-portal" && location.pathname != "/login")
        sessionStorage.setItem("management_token", "local-fixture");
      if (
        app === "customer-app" &&
        ["/orders", "/profile"].some((p) => location.pathname.startsWith(p))
      )
        localStorage.setItem("customer_user", JSON.stringify(customer));
    },
    { app, token, user, customer },
  );
  let errors = [];
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname)) {
      return route.abort("blockedbyclient");
    }
    if (!u.pathname.startsWith("/api") && u.pathname != "/info")
      return route.continue();
    const p = u.pathname.replace(/^\/api\/v1/, "").replace(/^\/api/, "");
    let data;
    let status = 200;
    const now = new Date().toISOString();
    const sampleOrders = ["confirmed", "preparing", "ready"].map(
      (status, i) => ({
        id: String(101 + i),
        restaurantId: "demo-restaurant",
        orderNumber: "A" + (101 + i),
        tableId: i + 1,
        tableName: "A" + (i + 1),
        table: { number: "A" + (i + 1) },
        status,
        orderType: "table",
        orderSource: "direct",
        customerInfo: { name: "範例顧客" },
        items: [
          {
            id: i + 1,
            name: ["招牌海南雞飯", "叻沙麵", "南洋咖哩雞飯"][i],
            menuItemId: i + 1,
            menuItem: { name: ["招牌海南雞飯", "叻沙麵", "南洋咖哩雞飯"][i] },
            quantity: 2,
            status: status === "confirmed" ? "pending" : status,
            price: 150,
            totalPrice: 300,
            priority: i === 0 ? "urgent" : "normal",
            notes: "少辣",
            customizations: [],
          },
        ],
        createdAt: new Date(Date.now() - (i + 2) * 60000).toISOString(),
        updatedAt: Date.now(),
        totalItems: 2,
        totalAmount: 300,
        priority: i === 0 ? "urgent" : "normal",
        elapsedTime: i + 2,
        estimatedTime: 10,
        notes: i === 0 ? "請先出餐" : "",
      }),
    );
    const tenant = {
      id: "1",
      businessName: "範例南洋餐館",
      contactEmail: "review@example.test",
      contactPhone: "02-0000-0000",
      subdomain: "demo-shop",
      status: "active",
      licenseTier: "professional",
      deployedVersion: "2.1.0",
      createdAt: now,
      activatedAt: now,
    };
    const health = [
      {
        id: "1",
        tenantId: "1",
        status: "healthy",
        responseTimeMs: 86,
        checkedAt: now,
        details: {
          api: "healthy",
          database: "healthy",
          cache: "healthy",
          storage: "healthy",
        },
      },
    ];
    let special;
    if (
      app === "management-portal" &&
      ["/deployments/1/history", "/licenses/1"].includes(p)
    )
      special = [];
    if (
      app === "onboarding-app" &&
      p === "/onboarding/applications/demo-application"
    )
      special = {
        id: "demo-application",
        businessName: "範例南洋餐館",
        status: "submitted",
        contactEmail: "review@example.test",
        contactName: "範例店主",
        countryCode: "TW",
        planId: "trial",
        assignedSubdomain: "demo-shop",
        createdAt: now,
        updatedAt: now,
      };
    if (p.endsWith("/tables/1/validate"))
      special = {
        isValid: true,
        table: { id: 1, number: "A1", seats: 4, status: "available" },
        restaurant,
      };
    else if (
      app === "kitchen-display" &&
      p === "/kitchen/demo-restaurant/orders"
    )
      special = {
        pending: [sampleOrders[0]],
        preparing: [sampleOrders[1]],
        ready: [sampleOrders[2]],
        stats: {
          pendingCount: 1,
          preparingCount: 1,
          readyCount: 1,
          completedToday: 24,
          averageCookingTime: 8,
          averageWaitingTime: 4,
          efficiency: 94,
          urgentOrders: 1,
        },
      };
    else if (app === "admin-dashboard" && p === "/orders")
      special = sampleOrders;
    else if (app === "admin-dashboard" && p === "/orders/stats")
      special = {
        pendingOrders: 1,
        preparingOrders: 1,
        completedOrders: 24,
        cancelledOrders: 0,
      };
    else if (app === "management-portal" && p === "/tenants")
      special = [tenant];
    else if (app === "management-portal" && p === "/tenants/1")
      special = tenant;
    else if (app === "management-portal" && p === "/health/tenants")
      special = health;
    else if (app === "management-portal" && p === "/health/tenants/1")
      special = health;
    else if (
      app === "management-portal" &&
      /^\/tenants\/1\/(resources|deployments|health|licenses)$/.test(p)
    )
      special = p.endsWith("/health") ? health : [];
    const service = {
      id: 1,
      restaurantId: "demo-restaurant",
      name: "體驗服務",
      serviceType: "activity",
      priceCents: 12000,
      durationMinutes: 60,
      requiresBooking: true,
      isActive: true,
      isPublic: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const market = {
      id: "demo-market",
      slug: "demo-shop",
      name: "示範夜市",
      marketType: "night_market",
      city: "台北市",
      district: "中正區",
      description: "隔離檢視用",
      latitude: 25.03,
      longitude: 121.56,
      isActive: true,
      mapLayout: null,
    };
    const dish = {
      menuItemId: 1,
      dishName: "招牌海南雞飯",
      price: 150,
      categoryName: "主餐",
      restaurantId: "demo-restaurant",
      restaurantName: "示範餐廳",
      district: "中正區",
      isOpen: true,
      supportsTakeaway: true,
      supportsDelivery: false,
      tags: [],
    };
    if (app === "customer-app") {
      if (p === "/restaurants/demo-restaurant/service-items")
        special = [service];
      if (p === "/service-bookings/availability")
        special = {
          slots: [{ timeSlot: "18:00", isAvailable: true, remaining: 5 }],
        };
      if (p === "/orders/group/join/DEMO12")
        special = {
          groupOrderId: "demo-group",
          restaurantId: "demo-restaurant",
          restaurantName: "示範餐廳",
          hostName: "範例團主",
          memberCount: 2,
          fulfillmentType: "dine_in",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          status: "active",
        };
      if (p === "/waiting-list/demo-ticket")
        special = {
          id: "demo-ticket",
          restaurantId: "demo-restaurant",
          customerName: "範例顧客",
          customerPhone: "0900000000",
          partySize: 2,
          queueNumber: 1,
          queueDisplay: "A001",
          priority: 0,
          partiesAhead: 3,
          status: "waiting",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          estimatedWaitMinutes: 15,
        };
      if (
        [
          "/guest-orders/1",
          "/guest-orders/101",
          "/orders/1",
          "/orders/101",
        ].includes(p)
      )
        special = {
          ...sampleOrders[0],
          subtotal: 300,
          serviceCharge: 0,
          taxAmount: 0,
          totalAmount: 300,
        };
      if (p === "/discovery/popular")
        special = { keywords: ["雞飯"], dishes: [dish], restaurants: [] };
      if (p === "/discovery/restaurants") special = { results: [], total: 0 };
      if (p === "/discovery/categories") special = { categories: ["主餐"] };
      if (p === "/discovery/service-types") special = { serviceTypes: [] };
      if (p === "/discovery/search")
        special = { results: [dish], total: 1, page: 1, limit: 20 };
      if (p === "/discovery/services")
        special = { results: [], total: 0, page: 1, limit: 20 };
      if (p === "/markets")
        special = { markets: [market], total: 1, page: 1, limit: 20 };
      if (p === "/markets/areas") special = { areas: [] };
      if (p === "/markets/demo-shop") special = { market, vendorCount: 1 };
      if (p === "/markets/demo-shop/vendors")
        special = { vendors: [], total: 0, page: 1, limit: 20 };
    }
    const employee = {
      id: "1",
      username: "employee",
      fullName: "示範員工",
      email:
        "employee.with.a.very.long.address.without.breaks@example-restaurant.test",
      role: 3,
      restaurantId: "demo-restaurant",
      isActive: true,
      createdAt: "2026-09-01T00:00:00.000Z",
      lastLoginAt: "2026-11-11T08:00:00.000Z",
    };
    if (app === "admin-dashboard" && p === "/users/1") special = employee;
    if (app === "admin-dashboard" && p === "/users") special = [employee];
    if (
      app === "admin-dashboard" &&
      (p === "/leaves/balances" ||
        p === "/leaves/demo-restaurant/requests" ||
        p === "/scheduling/demo-restaurant/schedules")
    )
      special = [];
    if (p === "/me/modules")
      special = {
        restaurantId: "demo-restaurant",
        planTier: "enterprise",
        isActive: true,
        trialEndsAt: null,
        effectiveModules: Object.fromEntries(
          [
            "menu_management",
            "order_management",
            "kitchen_display",
            "table_management",
            "coupons",
            "loyalty",
            "analytics",
            "reservations",
            "waiting_list",
            "ai_analytics",
            "integrations",
            "online_ordering",
            "pos",
            "inventory",
            "staff_management",
          ].map((key) => [key, true]),
        ),
      };
    if (special !== undefined)
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: special,
          pagination: {
            page: 1,
            limit: 20,
            total: Array.isArray(special) ? special.length : 1,
            totalPages: 1,
          },
        }),
      });
    if (p.endsWith("/auth/refresh") && !p.includes("/customer/")) {
      if (
        /\/(login|forgot-password|reset-password)(?:[?#]|$)/.test(
          route.request().headers().referer || "",
        )
      )
        status = 401;
      else data = { token, user };
    } else if (p === "/auth/me") {
      if (
        /\/(login|forgot-password|reset-password)(?:[?#]|$)/.test(
          route.request().headers().referer || "",
        )
      )
        status = 401;
      else data = user;
    } else if (p === "/customer/auth/refresh") {
      if (
        ["login", "register", "forgot-password"].some((s) =>
          route
            .request()
            .headers()
            .referer?.includes("/" + s),
        )
      )
        status = 401;
      else data = { accessToken: token, expiresIn: 86400 };
    } else if (p === "/customer/me")
      data = {
        customer,
        preferences: {
          dietaryTags: [],
          allergens: [],
          defaultPartySize: 2,
          marketingOptIn: false,
          waitingListOptIn: false,
          promoFromFavoritesOptIn: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          updatedAtMs: null,
        },
      };
    else if (p.startsWith("/restaurants/login-context/"))
      data = { slug: "demo-shop", name: "示範餐廳", logoUrl: null };
    else if (p === "/restaurants/demo-restaurant") data = restaurant;
    else if (p.startsWith("/menu/demo-restaurant"))
      data = {
        restaurant,
        categories,
        menuItems,
        featuredItems: [menuItems[0]],
      };
    else if (p === "/info") data = { status: "ok" };
    else {
      status = 503;
      errors.push(p);
    }
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        status === 200
          ? { success: true, data }
          : {
              success: false,
              error: {
                code: "PREVIEW_UNAVAILABLE",
                message: "隔離預覽未連線資料服務",
              },
              message: "隔離預覽未連線資料服務",
            },
      ),
    });
  });
  return {
    unavailable: errors,
    reset() {
      errors.length = 0;
    },
  };
}
module.exports = {
  root,
  reviewRoot,
  out,
  apps,
  manifest,
  routePath,
  installReviewData,
  chromium,
  fs,
  path,
};
