/**
 * OpenAPI Integration
 * 整合 OpenAPI 規範到主 API 應用
 */

import { swaggerUI } from "@hono/swagger-ui";
import { ORDER_STATUSES } from "@makanmasak/shared-types";
import { createOpenAPIApp, errorResponses } from "./config";
import { createRoute, z } from "@hono/zod-openapi";
import type { Hono } from "hono";

// ========== Schema Imports ==========
import {
  TablesSchemas,
  getTablesRoute,
  createTableRoute,
  updateTableStatusRoute,
  generateQRCodeRoute as generateTableQRCodeRoute,
} from "./schemas/tables";

import {
  UsersSchemas,
  getUsersRoute,
  createUserRoute,
  updateUserRoute,
  changePasswordRoute,
  deleteUserRoute,
  restoreUserRoute,
} from "./schemas/users";

import {
  RestaurantsSchemas,
  getRestaurantsRoute,
  getRestaurantRoute,
  createRestaurantRoute,
  updateRestaurantRoute,
  getRestaurantStatsRoute,
  generateShopQRRoute,
  getShopQRRoute,
  updateRestaurantSettingsRoute,
} from "./schemas/restaurants";

import {
  CustomersSchemas,
  registerCustomerRoute,
  getCustomersRoute,
  getCustomerRoute,
  updateCustomerRoute,
  getCustomerOrdersRoute,
  addLoyaltyPointsRoute,
  redeemLoyaltyPointsRoute,
  getLoyaltyPointsHistoryRoute,
} from "./schemas/customers";

import {
  RealtimeSchemas,
  generateWebSocketTokenRoute,
  generateMenuTokenRoute,
  verifyWebSocketTokenRoute,
  broadcastMessageRoute,
  getConnectionStatsRoute,
  getConnectionHealthRoute,
  disconnectUserRoute,
  getActiveRoomsRoute,
} from "./schemas/realtime";

import {
  AnalyticsSchemas,
  getAnalyticsRoute,
  getSalesReportRoute,
  getCustomerAnalyticsRoute,
  getPerformanceMetricsRoute as getAnalyticsPerformanceRoute,
  getInventoryAnalyticsRoute,
  exportReportRoute,
  getDashboardSummaryRoute,
} from "./schemas/analytics";

import {
  AIAnalyticsSchemas,
  getAIConfigRoute,
  configureAIRoute,
  generateInsightsRoute,
  getInsightsRoute,
  updateInsightStatusRoute,
  askAIRoute,
  getAIUsageRoute,
  getProductAnalyticsRoute,
} from "./schemas/ai-analytics";

import {
  SchedulingSchemas,
  getShiftTemplatesRoute,
  createShiftTemplateRoute,
  getEmployeeSchedulesRoute,
  createScheduleRoute,
  batchCreateSchedulesRoute,
  createSwapRequestRoute,
  updateSwapRequestRoute,
  clockInOutRoute,
  getScheduleStatsRoute,
} from "./schemas/scheduling";

import {
  LeavesSchemas,
  getLeaveRequestsRoute,
  createLeaveRequestRoute,
  updateLeaveStatusRoute,
  getLeaveBalancesRoute,
  getLeavePoliciesRoute,
  getLeaveStatsRoute,
  cancelLeaveRequestRoute,
} from "./schemas/leaves";

import {
  QRHealthSchemas,
  generateQRCodeRoute,
  bulkGenerateQRCodesRoute,
  getQRTemplatesRoute,
  createQRTemplateRoute,
  getSystemHealthRoute,
  getPerformanceMetricsRoute,
} from "./schemas/qr-health";

import {
  PartnershipsSchemas,
  createPartnershipRoute,
  getPartnershipsRoute,
  getPartnershipRoute,
  getPartnershipStatsRoute,
  updatePartnershipRoute,
  deletePartnershipRoute,
  createPlanRoute,
  getPlansRoute,
  getPlanRoute,
  validatePlanRoute,
  updatePlanRoute,
  deletePlanRoute,
  submitMemberVerificationRoute,
  getMembersRoute,
  getMemberRoute,
  approveMemberRoute,
  rejectMemberRoute,
  updateMemberRoute,
  logUsageRoute,
  getUsageLogsRoute,
  cancelUsageRoute,
  refundUsageRoute,
} from "./schemas/partnerships";

import {
  SeatsSchemas,
  getSeatsRoute,
  getSeatStatsRoute,
  getSeatByQRCodeRoute,
  getSeatRoute,
  batchCreateSeatsRoute,
  batchRegenerateQRRoute,
  updateSeatRoute,
  deleteSeatRoute,
  deleteSeatsForTableRoute,
  occupySeatRoute,
  releaseSeatRoute,
  regenerateSeatQRRoute,
} from "./schemas/seats";

/**
 * 整合 OpenAPI 到 Hono 應用
 */
export function integrateOpenAPI(app: Hono) {
  const openApiApp = createOpenAPIApp();

  // ========== Swagger UI 路由 ==========

  // Swagger UI 主頁面
  app.get(
    "/docs",
    swaggerUI({
      url: "/openapi.json",
    }),
  );

  // OpenAPI JSON 端點
  app.get("/openapi.json", (c) => {
    return c.json(
      openApiApp.getOpenAPI31Document({
        openapi: "3.1.0",
        info: { title: "MakanMasak API", version: "2.0.0" },
        servers: [{ url: "/" }],
      }),
    );
  });

  console.log("✅ OpenAPI integrated");
  console.log("📚 Swagger UI available at: /docs");
  console.log("📄 OpenAPI spec available at: /openapi.json");

  return openApiApp;
}

/**
 * Auth API Schema 定義
 */
export const AuthSchemas = {
  // Login Request
  LoginRequest: z.object({
    email: z.email("Invalid email format"),
    password: z.string().min(8, "Password must be at least 8 characters"),
  }),

  // Login Response
  LoginResponse: z.object({
    success: z.boolean(),
    token: z.string(),
    user: z.object({
      id: z.string(),
      email: z.email(),
      name: z.string(),
      role: z.number().int().min(0).max(4),
    }),
  }),

  // Refresh Token Request
  RefreshTokenRequest: z.object({
    refreshToken: z.string(),
  }),
};

// Define schemas first to avoid circular reference
const MenuItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  price: z.number().positive(),
  category: z.string(),
  imageUrl: z.url().optional(),
  available: z.boolean(),
  tags: z.array(z.string()).optional(),
});

/**
 * Menu API Schema 定義
 */
export const MenuSchemas = {
  // Menu Item
  MenuItem,

  // Get Menu Items Request
  GetMenuItemsRequest: z.object({
    restaurantId: z.uuid(),
    categoryId: z.uuid().optional(),
    available: z.boolean().optional(),
    page: z.string().regex(/^\d+$/).transform(Number).prefault("1"),
    pageSize: z.string().regex(/^\d+$/).transform(Number).prefault("20"),
  }),

  // Get Menu Items Response
  GetMenuItemsResponse: z.object({
    success: z.boolean(),
    data: z.array(MenuItem),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  }),

  // Create Menu Item Request
  CreateMenuItemRequest: z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    price: z.number().positive("Price must be positive"),
    categoryId: z.uuid("Invalid category ID"),
    imageUrl: z.url().optional(),
    tags: z.array(z.string()).optional(),
  }),
};

// Define order-related schemas first to avoid circular reference
const OrderStatus = z.enum(ORDER_STATUSES);
const OrderItem = z.object({
  id: z.string(),
  menuItemId: z.uuid(),
  name: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  notes: z.string().optional(),
  status: z.enum(["pending", "preparing", "ready"]),
});

/**
 * Orders API Schema 定義
 */
export const OrdersSchemas = {
  // Order Status Enum
  OrderStatus,

  // Order Item
  OrderItem,

  // Order
  Order: z.object({
    id: z.string(),
    orderNumber: z.string(),
    restaurantId: z.uuid(),
    tableId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    status: OrderStatus,
    items: z.array(OrderItem),
    subtotal: z.number().nonnegative(),
    tax: z.number().nonnegative(),
    total: z.number().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),

  // Create Order Request
  CreateOrderRequest: z.object({
    restaurantId: z.uuid(),
    tableId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    items: z
      .array(
        z.object({
          menuItemId: z.uuid(),
          quantity: z.number().int().positive(),
          notes: z.string().optional(),
        }),
      )
      .min(1, "At least one item is required"),
  }),

  // Update Order Status Request
  UpdateOrderStatusRequest: z.object({
    status: OrderStatus,
  }),
};

/**
 * Auth Login 路由
 */
export const authLoginRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/login",
  tags: ["auth"],
  summary: "用戶登入",
  description: "使用 email 和密碼進行身份驗證，成功後返回 JWT token",
  request: {
    body: {
      content: {
        "application/json": {
          schema: AuthSchemas.LoginRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: "登入成功",
      content: {
        "application/json": {
          schema: AuthSchemas.LoginResponse,
        },
      },
    },
    ...errorResponses(400, 401),
  },
});

/**
 * Menu Items 列表路由
 */
export const getMenuItemsRoute = createRoute({
  method: "get",
  path: "/api/v1/menu/:restaurantId/items",
  tags: ["menu"],
  summary: "獲取菜單項目列表",
  description: "獲取指定餐廳的菜單項目，支持分頁和過濾",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      restaurantId: z.uuid(),
    }),
    query: z.object({
      categoryId: z.uuid().optional(),
      available: z
        .string()
        .transform((val) => val === "true")
        .optional(),
      page: z.string().regex(/^\d+$/).transform(Number).prefault("1"),
      pageSize: z.string().regex(/^\d+$/).transform(Number).prefault("20"),
    }),
  },
  responses: {
    200: {
      description: "成功獲取菜單項目",
      content: {
        "application/json": {
          schema: MenuSchemas.GetMenuItemsResponse,
        },
      },
    },
    ...errorResponses(401, 404),
  },
});

/**
 * 創建訂單路由
 */
export const createOrderRoute = createRoute({
  method: "post",
  path: "/api/v1/orders",
  tags: ["orders"],
  summary: "創建新訂單",
  description: "創建新的訂單，包含一個或多個菜單項目",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: OrdersSchemas.CreateOrderRequest,
        },
      },
    },
  },
  responses: {
    201: {
      description: "訂單創建成功",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: OrdersSchemas.Order,
          }),
        },
      },
    },
    ...errorResponses(400, 401),
  },
});

/**
 * 導出所有 OpenAPI 路由定義
 *
 * 包含 16 個端點組的完整 API 路由：
 * - auth: 身份驗證
 * - menu: 菜單管理
 * - orders: 訂單管理
 * - tables: 桌位管理
 * - users: 用戶管理
 * - restaurants: 餐廳管理
 * - customers: 客戶管理
 * - realtime: 即時通訊
 * - analytics: 數據分析
 * - ai-analytics: AI 分析
 * - scheduling: 排班管理
 * - leaves: 請假管理
 * - qr: QR Code 管理
 * - health: 系統健康
 * - partnerships: 特約商店體系
 * - seats: 座位管理
 */
export const OpenAPIRoutes = {
  auth: {
    login: authLoginRoute,
  },
  menu: {
    getItems: getMenuItemsRoute,
  },
  orders: {
    create: createOrderRoute,
  },
  tables: {
    getAll: getTablesRoute,
    create: createTableRoute,
    updateStatus: updateTableStatusRoute,
    generateQR: generateTableQRCodeRoute,
  },
  users: {
    getAll: getUsersRoute,
    create: createUserRoute,
    update: updateUserRoute,
    changePassword: changePasswordRoute,
    delete: deleteUserRoute,
    restore: restoreUserRoute,
  },
  restaurants: {
    getAll: getRestaurantsRoute,
    getById: getRestaurantRoute,
    create: createRestaurantRoute,
    update: updateRestaurantRoute,
    getStats: getRestaurantStatsRoute,
    generateShopQR: generateShopQRRoute,
    getShopQR: getShopQRRoute,
    updateSettings: updateRestaurantSettingsRoute,
  },
  customers: {
    register: registerCustomerRoute,
    getAll: getCustomersRoute,
    getById: getCustomerRoute,
    update: updateCustomerRoute,
    getOrders: getCustomerOrdersRoute,
    addLoyaltyPoints: addLoyaltyPointsRoute,
    redeemLoyaltyPoints: redeemLoyaltyPointsRoute,
    getLoyaltyHistory: getLoyaltyPointsHistoryRoute,
  },
  realtime: {
    generateToken: generateWebSocketTokenRoute,
    generateMenuToken: generateMenuTokenRoute,
    verifyToken: verifyWebSocketTokenRoute,
    broadcast: broadcastMessageRoute,
    getConnectionStats: getConnectionStatsRoute,
    getConnectionHealth: getConnectionHealthRoute,
    disconnectUser: disconnectUserRoute,
    getActiveRooms: getActiveRoomsRoute,
  },
  analytics: {
    query: getAnalyticsRoute,
    getSalesReport: getSalesReportRoute,
    getCustomerAnalytics: getCustomerAnalyticsRoute,
    getPerformance: getAnalyticsPerformanceRoute,
    getInventory: getInventoryAnalyticsRoute,
    exportReport: exportReportRoute,
    getDashboard: getDashboardSummaryRoute,
  },
  aiAnalytics: {
    getConfig: getAIConfigRoute,
    configure: configureAIRoute,
    generateInsights: generateInsightsRoute,
    getInsights: getInsightsRoute,
    updateInsightStatus: updateInsightStatusRoute,
    ask: askAIRoute,
    getUsage: getAIUsageRoute,
    getProductAnalytics: getProductAnalyticsRoute,
  },
  scheduling: {
    getTemplates: getShiftTemplatesRoute,
    createTemplate: createShiftTemplateRoute,
    getSchedules: getEmployeeSchedulesRoute,
    createSchedule: createScheduleRoute,
    batchCreate: batchCreateSchedulesRoute,
    createSwapRequest: createSwapRequestRoute,
    updateSwapRequest: updateSwapRequestRoute,
    clockInOut: clockInOutRoute,
    getStats: getScheduleStatsRoute,
  },
  leaves: {
    getRequests: getLeaveRequestsRoute,
    createRequest: createLeaveRequestRoute,
    updateStatus: updateLeaveStatusRoute,
    getBalances: getLeaveBalancesRoute,
    getPolicies: getLeavePoliciesRoute,
    getStats: getLeaveStatsRoute,
    cancel: cancelLeaveRequestRoute,
  },
  qr: {
    generate: generateQRCodeRoute,
    bulkGenerate: bulkGenerateQRCodesRoute,
    getTemplates: getQRTemplatesRoute,
    createTemplate: createQRTemplateRoute,
  },
  health: {
    getSystemHealth: getSystemHealthRoute,
    getPerformanceMetrics: getPerformanceMetricsRoute,
  },
  partnerships: {
    create: createPartnershipRoute,
    getAll: getPartnershipsRoute,
    getById: getPartnershipRoute,
    getStats: getPartnershipStatsRoute,
    update: updatePartnershipRoute,
    delete: deletePartnershipRoute,
    createPlan: createPlanRoute,
    getPlans: getPlansRoute,
    getPlan: getPlanRoute,
    validatePlan: validatePlanRoute,
    updatePlan: updatePlanRoute,
    deletePlan: deletePlanRoute,
    submitMemberVerification: submitMemberVerificationRoute,
    getMembers: getMembersRoute,
    getMember: getMemberRoute,
    approveMember: approveMemberRoute,
    rejectMember: rejectMemberRoute,
    updateMember: updateMemberRoute,
    logUsage: logUsageRoute,
    getUsageLogs: getUsageLogsRoute,
    cancelUsage: cancelUsageRoute,
    refundUsage: refundUsageRoute,
  },
  seats: {
    getAll: getSeatsRoute,
    getStats: getSeatStatsRoute,
    getByQRCode: getSeatByQRCodeRoute,
    getById: getSeatRoute,
    batchCreate: batchCreateSeatsRoute,
    batchRegenerateQR: batchRegenerateQRRoute,
    update: updateSeatRoute,
    delete: deleteSeatRoute,
    deleteForTable: deleteSeatsForTableRoute,
    occupy: occupySeatRoute,
    release: releaseSeatRoute,
    regenerateQR: regenerateSeatQRRoute,
  },
};

// Re-export all schemas for external use
export {
  TablesSchemas,
  UsersSchemas,
  RestaurantsSchemas,
  CustomersSchemas,
  RealtimeSchemas,
  AnalyticsSchemas,
  AIAnalyticsSchemas,
  SchedulingSchemas,
  LeavesSchemas,
  QRHealthSchemas,
  PartnershipsSchemas,
  SeatsSchemas,
};
