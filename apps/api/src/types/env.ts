import type {
  Fetcher,
  KVNamespace,
  R2Bucket,
  Queue,
} from "@cloudflare/workers-types";
import type { DeploymentMode } from "./deployment";

// Custom AnalyticsEngine interface since it's not exported by @cloudflare/workers-types
interface AnalyticsEngine {
  writeDataPoint(data: {
    blobs?: Array<string | ArrayBuffer>;
    doubles?: Array<number>;
    indexes?: Array<string>;
  }): void;
}

import type { D1Database } from "@makanmasak/database";

/**
 * Enhanced Environment Interface for 100/100 Score
 * Includes all advanced Cloudflare features for optimal performance
 * Supports both SaaS and Independent deployment modes
 */
export interface Env {
  // Environment variables
  NODE_ENV: string;
  JWT_SECRET: string;
  REALTIME_JWT_SECRET?: string;
  API_VERSION: string;
  ENCRYPTION_KEY: string; // For encrypting sensitive data like API keys
  QR_SIGNING_KEY: string; // HMAC key for signing QR code URLs
  CLIENT_BASE_URL?: string;
  STORED_VALUE_CREDITS_ENABLED?: string;

  // ===== Deployment Mode Configuration =====
  /**
   * Deployment mode: 'saas' (default) or 'independent'
   * - saas: Multi-tenant centralized platform
   * - independent: Single-tenant managed deployment
   */
  DEPLOYMENT_MODE?: DeploymentMode;

  /**
   * Tenant identifier for independent deployments
   * Format: S-YYYYMMDD-NNN (e.g., S-20241201-001)
   */
  TENANT_ID?: string;

  /**
   * Tenant display name for independent deployments
   * Example: "御膳房", "好味道餐廳"
   */
  TENANT_NAME?: string;

  /**
   * License key for independent deployments
   * Format: MKM-{TIER}-{CODE}-{CHECK} (e.g., MKM-PRO-YSF001-A7B2)
   */
  LICENSE_KEY?: string;

  /**
   * Central management API URL for license validation and updates
   * Example: https://manage.makanmasak.com
   */
  CENTRAL_API_URL?: string;

  /**
   * Current platform version for update management
   * Semantic versioning: MAJOR.MINOR.PATCH
   */
  PLATFORM_VERSION?: string;

  // Performance optimization variables
  CACHE_TTL_DEFAULT?: string;
  CACHE_TTL_MENU?: string;
  CACHE_TTL_ANALYTICS?: string;
  RATE_LIMIT_MULTIPLIER?: string;
  SECURITY_THREAT_THRESHOLD?: string;
  PRELOAD_POPULAR_QUERIES?: string;
  QUOTA_ENFORCEMENT_MODE?: "disabled" | "warn" | "enforce";
  PREFERRED_REGION?: string;

  // Cloudflare bindings - Core
  DB: D1Database;
  CACHE_KV: KVNamespace;
  TOKEN_BLACKLIST: KVNamespace; // For JWT token blacklisting security
  IMAGES_BUCKET: R2Bucket;
  BACKUP_STORAGE: R2Bucket;
  JOB_QUEUE: Queue;
  // Fan-out queue for search-index re-sync (market/category changes).
  // Optional so the service falls back to inline processing when unbound
  // (e.g. local tests). See SearchIndexSyncService.
  SEARCH_SYNC_QUEUE?: Queue;
  REALTIME_ORDERS: DurableObjectNamespace;

  // Advanced Cloudflare bindings for 100/100 optimization
  ANALYTICS_ENGINE?: AnalyticsEngine; // Workers Analytics for custom metrics
  ANALYTICS?: AnalyticsEngine; // Production binding alias used by wrangler.toml
  GLOBAL_RATE_LIMITER?: RateLimit;
  /** Tighter native bucket for the public WebSocket token exchange (#341). */
  AUTH_TOKEN_RATE_LIMITER?: RateLimit;
  RATE_LIMIT_KV: KVNamespace; // Geographic rate limiting storage
  PRELOAD_QUEUE?: Queue; // Cache preloading queue
  REVALIDATION_QUEUE?: Queue; // Cache revalidation queue
  REALTIME_SESSION: DurableObjectNamespace; // Advanced Durable Objects
  MANAGEMENT_API?: Fetcher;

  // Security and monitoring
  CF_API_TOKEN?: string; // Cloudflare API for advanced features
  CF_ACCOUNT_ID?: string; // Cloudflare Account ID
  CF_ZONE_ID?: string; // Zone ID for WAF rules
  CF_STREAM_TOKEN?: string; // Cloudflare Streams for video

  // Optional variables
  API_BASE_URL?: string;
  INTERNAL_API_TOKEN?: string;
  SLACK_WEBHOOK_URL?: string;
  REALTIME_SERVICE_URL?: string; // URL for realtime WebSocket service (HTTP)
  REALTIME_WS_URL?: string; // WebSocket URL returned to clients (ws:// or wss://)

  // CORS configuration
  CORS_ORIGIN?: string; // Production CORS origin (comma-separated for multiple)
  DEV_CORS_ORIGINS?: string; // Additional dev origins (comma-separated)

  MONITORING_WEBHOOK_URL?: string;
  ALERT_EMAIL_FROM?: string;
  ALERT_EMAIL_TO?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /**
   * Secret. Needed only to read aggregates back out of Analytics Engine via
   * its SQL API — writes go through the ANALYTICS binding and need no token.
   * Without it, monitoring endpoints report zeroes instead of failing.
   */
  CLOUDFLARE_API_TOKEN?: string;
  /** Dataset name behind the ANALYTICS binding, for SQL API queries. */
  ANALYTICS_DATASET?: string;
  SENTRY_DSN?: string;

  // Advanced monitoring and analytics
  GRAFANA_API_KEY?: string;
  DATADOG_API_KEY?: string;
  MIXPANEL_TOKEN?: string;
  AMPLITUDE_API_KEY?: string;

  // Third-party integrations
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  /**
   * SMS vendor selection: "mitake" | "every8d" | "twilio" | "noop" | "auto".
   * Omit or "auto" to pick the first vendor with complete credentials, in cost
   * order (mitake → every8d → twilio). See packages/database/src/services/sms.ts.
   */
  SMS_PROVIDER?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  /** 三竹簡訊 (Mitake) — enterprise API credentials */
  MITAKE_USERNAME?: string;
  MITAKE_PASSWORD?: string;
  MITAKE_API_BASE?: string;
  /** Every8d (互動資通) API21 credentials */
  EVERY8D_UID?: string;
  EVERY8D_PWD?: string;
  EVERY8D_API_BASE?: string;
  /** Brand prefix on outbound OTP messages; carriers require an identifiable sender. */
  OTP_SMS_BRAND?: string;
  /** Test seam: injected by integration tests so no vendor call is made. */
  SMS_FETCH?: typeof fetch;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;
  WEB_PUSH_ENABLED?: string;
  WEB_PUSH_DELIVERER?: (delivery: {
    subscription: {
      id: string;
      endpoint: string;
      p256dhKey: string;
      authKey: string;
    };
    payload: Record<string, unknown>;
  }) => Promise<{ ok: boolean; status: number }>;
  SENDGRID_API_KEY?: string;
  RESEND_API_KEY?: string;
  // Opt-in flag read by NotificationService's resolveEmailProviderName. Only
  // "true" selects MailChannels; anything else falls back to Resend (or to the
  // noop provider when RESEND_API_KEY is absent).
  USE_MAILCHANNELS?: string;
  BILLING_EMAIL_FROM?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  LINEPAY_WEBHOOK_SECRET?: string;
  MARKET_CHECKOUT_WEBHOOK_SECRET?: string;
  MARKET_CHECKOUT_SPLIT_MODE?: "child_transactions" | "provider_split";
  MARKET_CHECKOUT_PROVIDER_SPLIT_URL?: string;
  MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL?: string;
  MARKET_CHECKOUT_PROVIDER_STATUS_URL?: string;
  MARKET_CHECKOUT_PROVIDER_REFUND_URL?: string;
  MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN?: string;
  MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET?: string;

  /**
   * Out-of-process adapter for a shop's own e-wallet (Touch 'n Go / GrabPay).
   * Unset means no wallet gateway is wired up and every shop-wallet charge
   * fails loudly — see features/shop-payments/services/ShopWalletGateway.ts.
   */
  SHOP_WALLET_GATEWAY_URL?: string;
  SHOP_WALLET_GATEWAY_TOKEN?: string;
  NOTIFICATION_FROM_EMAIL?: string;

  // Stored-value credits (代幣): per-currency overrides for the PIN threshold.
  // Unset or invalid values use the product defaults in credit-limits.ts.
  CREDIT_PIN_THRESHOLD_CENTS_TWD?: string;
  CREDIT_PIN_THRESHOLD_CENTS_MYR?: string;
  CREDIT_PIN_THRESHOLD_CENTS_VND?: string;
  // Online top-up (Phase 2) provider gateway + webhook verification
  CREDIT_TOPUP_PROVIDER_URL?: string;
  CREDIT_TOPUP_PROVIDER_TOKEN?: string;
  CREDIT_TOPUP_PROVIDER_SIGNING_SECRET?: string;
  CREDIT_TOPUP_WEBHOOK_SECRET?: string;

  // AI and machine learning
  AI?: unknown;
  DISCOVERY_VECTORIZE?: unknown;
  DISCOVERY_EMBEDDING_MODEL?: string;
  /**
   * "true" switches on semantic discovery. Anything else, including absent,
   * leaves Vectorize and Workers AI unused -- both bill continuously once the
   * index is populated, so having the bindings configured must not be the same
   * as having the feature on. D1 search is unaffected.
   */
  DISCOVERY_SEMANTIC_ENABLED?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;

  // Platform integrations (Uber Eats, Foodpanda, etc.)
  UBER_EATS_CLIENT_ID?: string;
  UBER_EATS_CLIENT_SECRET?: string;
}
