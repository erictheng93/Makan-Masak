/**
 * Realtime Service Environment Type Definitions
 *
 * KV 命名空間說明：
 * - CACHE_KV: 通用快取（與 API 共用）
 * - TOKEN_BLACKLIST: 安全令牌撤銷（專用命名空間）
 */
export interface Env {
  // Durable Object bindings
  REALTIME_SESSION: DurableObjectNamespace;

  // Database bindings
  DB: D1Database;

  // KV store bindings - aligned with API naming convention
  /** 通用快取（與 API 共用命名空間） */
  CACHE_KV: KVNamespace;

  /** 安全令牌黑名單（專用命名空間，確保登出/密碼變更立即生效） */
  TOKEN_BLACKLIST: KVNamespace;

  // Environment variables
  JWT_SECRET: string;
  REALTIME_JWT_SECRET?: string;
  ENVIRONMENT: string;
  API_VERSION: string;
  CORS_ORIGIN?: string;

  /** WebSocket 連線限流（native binding，僅 production 綁定） */
  WS_CONNECT_RATE_LIMITER?: RateLimit;

  // Logging
  SLACK_WEBHOOK_URL?: string;
}
