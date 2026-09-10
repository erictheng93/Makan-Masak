import { drizzle } from "drizzle-orm/d1";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { ApiError } from "@makanmasak/utils";
import * as schema from "../schema";
import {
  QueryCache,
  buildCacheKey,
  type QueryCacheOptions,
} from "../utils/query-cache";
import {
  getConnectionManager,
  type ConnectionManager,
} from "../utils/connection-manager";
import { SoftDeleteService } from "../utils/soft-delete";
import { fromCents, toRequiredCents } from "../utils/money";

const ORDER_NUMBER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ORDER_NUMBER_SEGMENT_SIZE = 4;
const ORDER_NUMBER_SEGMENT_MODULUS =
  ORDER_NUMBER_ALPHABET.length ** ORDER_NUMBER_SEGMENT_SIZE;

/**
 * Deployment mode type
 * - saas: Multi-tenant centralized SaaS platform
 * - independent: Single-tenant managed deployment
 */
export type DeploymentMode = "saas" | "independent";

/**
 * A D1 Sessions API constraint: `"first-unconstrained"`, `"first-primary"`, or
 * a bookmark returned by a previous session's `getBookmark()`.
 *
 * Kept as a string rather than a union so a caller can pass a bookmark through
 * unchanged once bookmark propagation exists (#321).
 */
export type D1SessionConstraint = string;

export interface BaseServiceOptions {
  /**
   * When set, this service's query builder runs inside a D1 Session, so its
   * reads can be served by a regional read replica instead of always crossing
   * to the primary. Leave unset — the default — and the service behaves exactly
   * as it did before sessions existed.
   *
   * Worth knowing before turning this on for a service (#321):
   *
   * - The primary for makanmasak-prod is in APAC while the Worker runs at
   *   whichever colo the request landed on. `/api/v1/system/health` self-reports
   *   108-115ms for a bare `SELECT 1`, so a method with four serial queries is a
   *   450ms method for reasons that have nothing to do with the query.
   * - Writes are safe: D1 routes them to the primary regardless, and reads later
   *   in the *same* session are read-your-writes consistent.
   * - The risk is across requests. One request writes; the next opens a fresh
   *   `"first-unconstrained"` session and may read a replica that has not caught
   *   up yet. So enable this on read paths that tolerate seconds of staleness,
   *   and use `"first-primary"` — or a propagated bookmark — where a caller
   *   must see its own recent write.
   * - It is a no-op until read replication is enabled on the database. Only
   *   `served_by_primary` from a production `D1Result.meta` proves a replica
   *   actually served a query; miniflare reports neither field locally.
   */
  readSessionConstraint?: D1SessionConstraint;
}

export interface CloudflareEnv {
  JWT_SECRET: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  CACHE_KV?: KVNamespace;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;
  WEB_PUSH_ENABLED?: string;
  QR_SIGNING_KEY?: string;
  CLIENT_BASE_URL?: string;
  CORS_ORIGIN?: string;
  API_BASE_URL?: string;
  WEB_PUSH_DELIVERER?: (delivery: {
    subscription: {
      id: string;
      endpoint: string;
      p256dhKey: string;
      authKey: string;
    };
    payload: Record<string, unknown>;
  }) => Promise<{ ok: boolean; status: number }>;
  // Notification providers
  RESEND_API_KEY?: string;
  NOTIFICATION_FROM_EMAIL?: string;
  USE_MAILCHANNELS?: string;
  // SMS vendor selection — see ./sms (SmsProviderEnv)
  SMS_PROVIDER?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  MITAKE_USERNAME?: string;
  MITAKE_PASSWORD?: string;
  MITAKE_API_BASE?: string;
  EVERY8D_UID?: string;
  EVERY8D_PWD?: string;
  EVERY8D_API_BASE?: string;
  // Deployment mode configuration
  DEPLOYMENT_MODE?: DeploymentMode;
  TENANT_ID?: string;
  TENANT_NAME?: string;
  LICENSE_KEY?: string;
  CENTRAL_API_URL?: string;
  PLATFORM_VERSION?: string;
}

/** Web push defaults on; only the explicit feature flag disables delivery. */
export function isWebPushEnabled(
  env: Pick<CloudflareEnv, "WEB_PUSH_ENABLED">,
): boolean {
  return env.WEB_PUSH_ENABLED !== "false";
}

// 基礎服務類別
export class BaseService {
  protected db: ReturnType<typeof drizzle<typeof schema>>;
  protected d1: D1Database;
  protected env: CloudflareEnv;
  protected queryCache: QueryCache;
  protected connectionManager: ConnectionManager;
  protected softDelete: SoftDeleteService<typeof schema>;

  // Deployment mode properties
  protected deploymentMode: DeploymentMode;
  protected tenantId?: string;
  protected tenantName?: string;

  constructor(
    d1: D1Database,
    env: CloudflareEnv,
    options: BaseServiceOptions = {},
  ) {
    this.d1 = d1;
    this.env = env;

    // Initialize deployment mode configuration
    this.deploymentMode = env.DEPLOYMENT_MODE || "saas";
    this.tenantId = env.TENANT_ID;
    this.tenantName = env.TENANT_NAME;

    // `this.d1` stays on the primary; only the query builder is wrapped, and
    // only when a caller asked for it. Drizzle's d1 driver calls prepare() and
    // batch(), both of which a D1DatabaseSession implements, so the cast holds
    // at runtime — the same shape DiscoveryService has been shipping.
    const readClient = options.readSessionConstraint
      ? (d1.withSession(options.readSessionConstraint) as unknown as D1Database)
      : d1;

    this.db = drizzle(readClient, {
      schema,
      logger: env.NODE_ENV === "development",
    });

    this.queryCache = new QueryCache(env.CACHE_KV);
    this.connectionManager = getConnectionManager();
    this.softDelete = new SoftDeleteService(this.db, {
      retentionDays: 90,
    });
  }

  /**
   * Execute query with caching support
   * For frequently accessed, read-only queries
   */
  protected async cachedQuery<T>(
    cacheKey: string,
    queryFn: () => Promise<T>,
    options: QueryCacheOptions,
  ): Promise<T> {
    return this.queryCache.getOrExecute(cacheKey, queryFn, options);
  }

  /**
   * Invalidate cache by key or tags
   */
  protected async invalidateCache(
    keyOrTags: string | string[],
    type: "key" | "tag" = "key",
  ): Promise<void> {
    await this.queryCache.invalidate(keyOrTags, type);
  }

  /**
   * Build consistent cache keys
   */
  protected buildCacheKey(
    resource: string,
    identifier: string | number,
    suffix?: string,
  ): string {
    return buildCacheKey(resource, identifier, suffix);
  }

  /**
   * Execute query with connection management
   * Provides retry logic, timeout handling, and batching
   */
  protected async managedQuery<T>(
    queryFn: () => Promise<T>,
    options?: {
      priority?: number;
      timeout?: number;
      maxRetries?: number;
      batchable?: boolean;
    },
  ): Promise<T> {
    return this.connectionManager.executeQuery(queryFn, options);
  }

  /**
   * Get connection metrics for monitoring
   */
  protected getConnectionMetrics() {
    return this.connectionManager.getMetrics();
  }

  // There is deliberately no transaction helper on this class. D1 does not
  // support interactive BEGIN transactions, and a helper that wrapped writes
  // anyway would make multi-statement mutations silently non-atomic. Use
  // `db.batch()` for atomic writes. A `safeTransaction` stub used to live here
  // that threw at runtime to say so; it was removed once the last caller was
  // gone, so reaching for it is now a compile error instead.

  // 通用錯誤處理
  protected handleError(error: unknown, operation: string): never {
    // A deliberate business-rule rejection already carries its code, status and
    // details. The tail of this method rebuilds every error as a plain
    // `new Error(message)`, which would strip exactly that and leave the API's
    // `err instanceof ApiError` branch unreachable — a 400 arriving at the
    // customer as a 500 GENERIC_ERROR (#352). Pass it through untouched, and
    // do not log it: it is not a server fault.
    if (error instanceof ApiError) throw error;

    // 安全地記錄錯誤，避免循環引用問題
    if (error instanceof Error) {
      console.error(`Database error in ${operation}:`, error.message);
      if (error.stack) {
        console.error("Stack trace:", error.stack);
      }
    } else {
      console.error(`Database error in ${operation}:`, String(error));
    }

    // 創建一個可序列化的錯誤對象，避免循環引用問題
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage?.includes("UNIQUE constraint failed")) {
      throw new Error("Record already exists");
    }

    if (errorMessage?.includes("FOREIGN KEY constraint failed")) {
      throw new Error("Related record not found");
    }

    if (errorMessage?.includes("NOT NULL constraint failed")) {
      throw new Error("Required field missing");
    }

    // 拋出可序列化的錯誤對象
    throw new Error(errorMessage);
  }

  // 分頁輔助函數
  protected createPagination(page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;
    return { limit, offset };
  }

  // 生成訂單號碼
  protected generateOrderNumber(restaurantId: string): string {
    void restaurantId;

    const timePart = this.toOrderNumberSegment(Date.now());
    const randomPart = this.toOrderNumberSegment(
      Math.floor(Math.random() * ORDER_NUMBER_SEGMENT_MODULUS),
    );
    return `${timePart}-${randomPart}`;
  }

  private toOrderNumberSegment(value: number): string {
    let remaining = Math.trunc(Math.abs(value)) % ORDER_NUMBER_SEGMENT_MODULUS;
    let segment = "";

    for (let index = 0; index < ORDER_NUMBER_SEGMENT_SIZE; index += 1) {
      segment =
        ORDER_NUMBER_ALPHABET[remaining % ORDER_NUMBER_ALPHABET.length] +
        segment;
      remaining = Math.floor(remaining / ORDER_NUMBER_ALPHABET.length);
    }

    return segment;
  }

  // ===== Deployment Mode Methods =====

  /**
   * Check if current deployment is in independent mode
   */
  protected isIndependentMode(): boolean {
    return this.deploymentMode === "independent";
  }

  /**
   * Check if current deployment is in SaaS mode
   */
  protected isSaaSMode(): boolean {
    return this.deploymentMode === "saas";
  }

  /**
   * Validate tenant access for the requested resource
   *
   * In independent mode, ensures that requests can only access
   * the configured tenant's resources.
   *
   * @param requestedId - The restaurant/tenant ID being accessed
   * @returns true if access is allowed, false otherwise
   */
  protected validateTenantAccess(requestedId: string): boolean {
    if (this.deploymentMode === "independent") {
      // In independent mode, strictly enforce single-tenant access
      if (!this.tenantId) {
        console.error(
          "[BaseService] TENANT_ID not configured for independent deployment",
        );
        return false;
      }
      return requestedId === this.tenantId;
    }

    // SaaS mode: allow access (authorization handled by middleware)
    return true;
  }

  /**
   * Get the effective tenant ID for the current operation
   *
   * In independent mode, always returns the configured TENANT_ID.
   * In SaaS mode, returns the provided ID or undefined.
   *
   * @param requestedId - The requested tenant/restaurant ID
   * @returns The effective tenant ID to use
   */
  protected getEffectiveTenantId(requestedId?: string): string | undefined {
    if (this.deploymentMode === "independent") {
      // Always use configured tenant ID in independent mode
      return this.tenantId;
    }

    // SaaS mode: use the requested ID
    return requestedId;
  }

  /**
   * Get deployment information for logging/debugging
   */
  protected getDeploymentInfo(): {
    mode: DeploymentMode;
    tenantId?: string;
    tenantName?: string;
  } {
    return {
      mode: this.deploymentMode,
      tenantId: this.tenantId,
      tenantName: this.tenantName,
    };
  }

  // 計算總金額
  //
  // `deliveryFee` 不參與稅金與服務費：兩者都是 `subtotal * rate`，外送費是
  // 運費而非餐點消費。它只加在最後的 totalAmountCents 上。呼叫端必須傳伺服器
  // 端算出的金額 — 顧客請求裡的數字不可信（#295）。
  protected calculateOrderTotal(
    subtotal: number,
    taxRate: number = 0,
    serviceChargeRate: number = 0,
    discountAmount: number = 0,
    deliveryFee: number = 0,
  ) {
    const subtotalCents = toRequiredCents(subtotal);
    const discountAmountCents = toRequiredCents(discountAmount);
    const deliveryFeeCents = toRequiredCents(deliveryFee);
    const taxAmountCents = Math.round(subtotalCents * taxRate);
    const serviceChargeCents = Math.round(subtotalCents * serviceChargeRate);
    const totalAmountCents =
      subtotalCents +
      taxAmountCents +
      serviceChargeCents +
      deliveryFeeCents -
      discountAmountCents;

    return {
      subtotal: fromCents(subtotalCents),
      taxAmount: fromCents(taxAmountCents),
      serviceCharge: fromCents(serviceChargeCents),
      discountAmount: fromCents(discountAmountCents),
      deliveryFee: fromCents(deliveryFeeCents),
      totalAmount: fromCents(totalAmountCents),
      subtotalCents,
      taxAmountCents,
      serviceChargeCents,
      discountAmountCents,
      deliveryFeeCents,
      totalAmountCents,
    };
  }
}
