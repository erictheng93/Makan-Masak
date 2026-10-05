/**
 * Realtime API OpenAPI Schemas
 * 即時通訊 API Schema 定義
 */

import { z } from "zod";
import { createRoute } from "@hono/zod-openapi";
import { errorResponses } from "../config";

// Define enums first to avoid circular reference
const RoomType = z.enum(["customer", "admin", "kitchen"]);

// /auth/token mints staff rooms only — customer rooms come from
// /auth/guest-token, which verifies a signed QR or a guest token.
const StaffRoomType = z.enum(["admin", "kitchen"]);

/**
 * Realtime API Schemas
 */
export const RealtimeSchemas = {
  // Room Type
  RoomType,
  StaffRoomType,

  // WebSocket Token Payload
  WebSocketTokenPayload: z.object({
    roomType: RoomType,
    roomId: z.string(),
    restaurantId: z.uuid(),
    userId: z.uuid().optional(),
    role: z.number().int().min(0).max(4).optional(),
    exp: z.number().int(),
    iat: z.number().int(),
  }),

  // Generate WebSocket Token Request
  GenerateTokenRequest: z.object({
    roomType: StaffRoomType,
    roomId: z.string().min(1, "Room ID is required"),
    restaurantId: z.uuid(),
    userId: z.uuid().optional(),
    expiresIn: z.number().int().min(60).max(86400).default(3600), // 1 min to 24 hours
  }),

  // Generate WebSocket Token Response
  GenerateTokenResponse: z.object({
    success: z.boolean(),
    token: z.string(),
    expiresAt: z.iso.datetime(),
    connectionUrl: z.url(),
  }),

  // Verify Token Request
  VerifyTokenRequest: z.object({
    token: z.string().min(1, "Token is required"),
    channel: z.string().min(1, "Channel is required").optional(),
  }),

  // Verify Token Response
  VerifyTokenResponse: z.object({
    success: z.boolean(),
    data: z.object({
      valid: z.boolean(),
      roomType: z.enum(["customer", "admin", "kitchen"]).optional(),
      expiresAt: z.iso.datetime().optional(),
      channelAccess: z
        .object({
          allowed: z.literal(true),
        })
        .optional(),
    }),
  }),

  // Broadcast Message Request
  BroadcastMessageRequest: z.object({
    roomType: RoomType,
    roomId: z.string(),
    messageType: z.string(),
    payload: z.record(z.string(), z.any()),
    excludeSender: z.boolean().default(false),
    senderId: z.string().optional(),
  }),

  // Broadcast Message Response
  BroadcastMessageResponse: z.object({
    success: z.boolean(),
    messageId: z.string(),
    recipientCount: z.number().int(),
    timestamp: z.iso.datetime(),
  }),

  // Connection Statistics
  ConnectionStatistics: z.object({
    roomType: RoomType,
    roomId: z.string(),
    totalConnections: z.number().int(),
    activeConnections: z.number().int(),
    connections: z.array(
      z.object({
        connectionId: z.string(),
        userId: z.string().optional(),
        connectedAt: z.iso.datetime(),
        lastActivity: z.iso.datetime(),
      }),
    ),
  }),

  // WebSocket Event
  WebSocketEvent: z.object({
    type: z.string(),
    payload: z.record(z.string(), z.any()),
    timestamp: z.number().int(),
    roomType: RoomType.optional(),
    roomId: z.string().optional(),
    senderId: z.string().optional(),
  }),

  // Connection Health
  ConnectionHealth: z.object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    uptime: z.number().int(), // seconds
    totalMessages: z.number().int(),
    messagesPerSecond: z.number(),
    errorRate: z.number().min(0).max(1),
    averageLatency: z.number(), // milliseconds
    activeRooms: z.number().int(),
    totalConnections: z.number().int(),
  }),
};

/**
 * Realtime API Routes
 */

// Generate WebSocket Token
export const generateWebSocketTokenRoute = createRoute({
  method: "post",
  path: "/api/v1/realtime/auth/token",
  tags: ["realtime"],
  summary: "生成 WebSocket Token",
  description: "為 WebSocket 連接生成 JWT 認證 token",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: RealtimeSchemas.GenerateTokenRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Token 生成成功",
      content: {
        "application/json": {
          schema: RealtimeSchemas.GenerateTokenResponse,
        },
      },
    },
    ...errorResponses(400, 401, 403),
  },
});

// Verify WebSocket Token
export const verifyWebSocketTokenRoute = createRoute({
  method: "post",
  path: "/api/v1/realtime/auth/verify",
  tags: ["realtime"],
  summary: "驗證 WebSocket Token",
  description: "驗證 WebSocket token 的有效性",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RealtimeSchemas.VerifyTokenRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Token 驗證結果",
      content: {
        "application/json": {
          schema: RealtimeSchemas.VerifyTokenResponse,
        },
      },
    },
    ...errorResponses(400),
  },
});

// Broadcast Message
export const broadcastMessageRoute = createRoute({
  method: "post",
  path: "/api/v1/realtime/broadcast/:roomType/:roomId",
  tags: ["realtime"],
  summary: "廣播訊息",
  description: "向指定 room 的所有連接廣播訊息",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      roomType: RealtimeSchemas.RoomType,
      roomId: z.string(),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            messageType: z.string(),
            payload: z.record(z.string(), z.any()),
            excludeSender: z.boolean().optional(),
            senderId: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "訊息廣播成功",
      content: {
        "application/json": {
          schema: RealtimeSchemas.BroadcastMessageResponse,
        },
      },
    },
    ...errorResponses(400, 401, 404),
  },
});

// Get Connection Statistics
export const getConnectionStatsRoute = createRoute({
  method: "get",
  path: "/api/v1/realtime/stats/:roomType/:roomId",
  tags: ["realtime"],
  summary: "獲取連接統計",
  description: "獲取指定 room 的連接統計信息",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      roomType: RealtimeSchemas.RoomType,
      roomId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "成功獲取連接統計",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: RealtimeSchemas.ConnectionStatistics,
          }),
        },
      },
    },
    ...errorResponses(401, 403, 404),
  },
});

// Get Connection Health
export const getConnectionHealthRoute = createRoute({
  method: "get",
  path: "/api/v1/realtime/health",
  tags: ["realtime"],
  summary: "獲取連接健康狀態",
  description: "獲取整體 WebSocket 連接系統的健康狀態和性能指標",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "成功獲取健康狀態",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: RealtimeSchemas.ConnectionHealth,
          }),
        },
      },
    },
    ...errorResponses(401),
  },
});

// Disconnect User
export const disconnectUserRoute = createRoute({
  method: "post",
  path: "/api/v1/realtime/disconnect/:connectionId",
  tags: ["realtime"],
  summary: "斷開用戶連接",
  description: "強制斷開指定的 WebSocket 連接",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      connectionId: z.string(),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            reason: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "連接已斷開",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
    },
    ...errorResponses(401, 403, 404),
  },
});

// Get Active Rooms
export const getActiveRoomsRoute = createRoute({
  method: "get",
  path: "/api/v1/realtime/rooms",
  tags: ["realtime"],
  summary: "獲取活躍 Rooms",
  description: "獲取所有活躍的 WebSocket rooms 列表",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      roomType: RealtimeSchemas.RoomType.optional(),
      restaurantId: z.uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "成功獲取 rooms 列表",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.array(
              z.object({
                roomType: RealtimeSchemas.RoomType,
                roomId: z.string(),
                connectionCount: z.number().int(),
                createdAt: z.iso.datetime(),
              }),
            ),
          }),
        },
      },
    },
    ...errorResponses(401),
  },
});
