/**
 * Management API Client
 * 管理平台 API 客戶端
 */

import axios, { type AxiosInstance, type AxiosError } from "axios";
import { useToast } from "vue-toastification";
import { clearManagementSession, getManagementToken } from "./auth";
import type {
  Tenant,
  TenantResource,
  DeploymentLog,
  HealthCheck,
  License,
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  CreateTenantRequest,
  UpdateTenantRequest,
  DeployRequest,
  BatchDeployRequest,
  GenerateLicenseRequest,
  Market,
  MarketJoinRequest,
  MarketVendorCandidate,
  MarketVendorImportInput,
  MarketVendorImportResult,
  MarketVendorMembership,
  CreateMarketRequest,
  UpdateMarketRequest,
} from "@/types";

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * Error codes the caller handles itself (for example by asking the admin
     * to confirm and retrying). The global error toast skips them, so the
     * admin does not see an error for a step that is part of the flow.
     */
    expectedErrorCodes?: readonly string[];
  }
}

/** True when the failed request declared this error code as one it handles. */
export function isExpectedApiError(
  error: Pick<AxiosError<ApiResponse<unknown>>, "config" | "response">,
): boolean {
  const apiError = error.response?.data?.error;
  const code =
    typeof apiError === "object" && apiError !== null ? apiError.code : null;
  return code !== null && !!error.config?.expectedErrorCodes?.includes(code);
}

function resolveApiBase(): string {
  const apiBase = import.meta.env.VITE_MANAGEMENT_API_URL;
  if (apiBase) {
    return apiBase;
  }

  if (import.meta.env.PROD) {
    throw new Error(
      "VITE_MANAGEMENT_API_URL is required for production builds",
    );
  }

  return "/api/v1";
}

const API_BASE = resolveApiBase();
const CSRF_COOKIE_NAME = "csrf_token";
const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"]);

export interface ManagementAuthExchangeResult {
  token: string;
  tokenType: "Bearer";
  expiresAt: number;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookie = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

function isMutatingMethod(method?: string): boolean {
  return MUTATING_METHODS.has((method || "get").toLowerCase());
}

// 創建 axios 實例
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// 請求攔截器
apiClient.interceptors.request.use(
  (config) => {
    const token = getManagementToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (isMutatingMethod(config.method)) {
      const csrfToken = readCookie(CSRF_COOKIE_NAME);
      if (csrfToken) {
        config.headers["X-CSRF-Token"] = csrfToken;
      }
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// 響應攔截器
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse<unknown>>) => {
    const toast = useToast();
    // Nested unified format `{ error: { code, message } }` first, with a
    // fallback for legacy flat `{ error: "<string>" }` responses.
    // TODO(cleanup): drop the flat fallback once every deployed
    // management-api is at or past commit 7151ca2c.
    const apiError = error.response?.data?.error;
    const message =
      (typeof apiError === "object" && apiError !== null
        ? apiError.message
        : apiError) ||
      error.message ||
      "請求失敗";
    if (!isExpectedApiError(error)) toast.error(message);
    if (
      error.response?.status === 401 &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login"
    ) {
      clearManagementSession();
      const redirect = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`);
    }
    return Promise.reject(error);
  },
);

export const authApi = {
  async exchange(apiToken: string): Promise<ManagementAuthExchangeResult> {
    const { data } = await apiClient.post<
      ApiResponse<ManagementAuthExchangeResult>
    >("/auth/exchange", { token: apiToken });
    return data.data!;
  },
};

/**
 * 租戶 API
 */
export const tenantsApi = {
  // 獲取租戶列表
  async list(params?: PaginationParams): Promise<PaginatedResponse<Tenant>> {
    const { data } = await apiClient.get<PaginatedResponse<Tenant>>(
      "/tenants",
      { params },
    );
    return data;
  },

  // 獲取單個租戶
  async get(id: string): Promise<Tenant> {
    const { data } = await apiClient.get<ApiResponse<Tenant>>(`/tenants/${id}`);
    return data.data!;
  },

  // 創建租戶
  async create(request: CreateTenantRequest): Promise<Tenant> {
    const { data } = await apiClient.post<ApiResponse<Tenant>>(
      "/tenants",
      request,
    );
    return data.data!;
  },

  // 更新租戶
  async update(id: string, request: UpdateTenantRequest): Promise<Tenant> {
    const { data } = await apiClient.patch<ApiResponse<Tenant>>(
      `/tenants/${id}`,
      request,
    );
    return data.data!;
  },

  // 刪除租戶
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/tenants/${id}`);
  },

  // 獲取租戶資源
  async getResources(id: string): Promise<TenantResource[]> {
    const { data } = await apiClient.get<ApiResponse<TenantResource[]>>(
      `/tenants/${id}/resources`,
    );
    return data.data!;
  },
};

/**
 * 部署 API
 */
export const deploymentsApi = {
  // 獲取部署狀態
  async getStatus(
    tenantId: string,
  ): Promise<{ status: string; currentVersion?: string }> {
    const { data } = await apiClient.get<
      ApiResponse<{ status: string; currentVersion?: string }>
    >(`/deployments/${tenantId}`);
    return data.data!;
  },

  // 獲取部署歷史
  async getHistory(tenantId: string): Promise<DeploymentLog[]> {
    const { data } = await apiClient.get<ApiResponse<DeploymentLog[]>>(
      `/deployments/${tenantId}/history`,
    );
    return data.data!;
  },

  // 配置資源
  async provision(tenantId: string): Promise<TenantResource[]> {
    const { data } = await apiClient.post<ApiResponse<TenantResource[]>>(
      "/deployments/provision",
      { tenantId },
    );
    return data.data!;
  },

  // 部署
  async deploy(request: DeployRequest): Promise<DeploymentLog> {
    const { data } = await apiClient.post<ApiResponse<DeploymentLog>>(
      "/deployments/deploy",
      request,
    );
    return data.data!;
  },

  // 回滾
  async rollback(
    tenantId: string,
    targetVersion: string,
  ): Promise<DeploymentLog> {
    const { data } = await apiClient.post<ApiResponse<DeploymentLog>>(
      `/deployments/${tenantId}/rollback`,
      { targetVersion },
    );
    return data.data!;
  },

  // 批量部署
  async batchDeploy(
    request: BatchDeployRequest,
  ): Promise<{ queued: number; failed: string[] }> {
    const { data } = await apiClient.post<
      ApiResponse<{ queued: number; failed: string[] }>
    >("/deployments/batch", request);
    return data.data!;
  },
};

/**
 * 健康檢查 API
 */
export const healthApi = {
  // 獲取所有租戶健康狀態
  async getAllStatus(): Promise<HealthCheck[]> {
    const { data } =
      await apiClient.get<ApiResponse<HealthCheck[]>>("/health/tenants");
    return data.data!;
  },

  // 獲取單個租戶健康狀態
  async getTenantStatus(tenantId: string): Promise<HealthCheck[]> {
    const { data } = await apiClient.get<ApiResponse<HealthCheck[]>>(
      `/health/tenants/${tenantId}`,
    );
    return data.data!;
  },

  // 執行健康檢查
  async check(tenantId: string): Promise<HealthCheck> {
    const { data } = await apiClient.post<ApiResponse<HealthCheck>>(
      `/health/check/${tenantId}`,
    );
    return data.data!;
  },
};

/**
 * 授權 API
 */
export const licensesApi = {
  // 生成授權
  async generate(request: GenerateLicenseRequest): Promise<License> {
    const { data } = await apiClient.post<ApiResponse<License>>(
      "/licenses/generate",
      request,
    );
    return data.data!;
  },

  // 獲取租戶授權
  async getTenantLicense(tenantId: string): Promise<License[]> {
    const { data } = await apiClient.get<ApiResponse<License[]>>(
      `/licenses/${tenantId}`,
    );
    return data.data!;
  },

  // 續期
  async renew(tenantId: string, expiresAt: string): Promise<License> {
    const { data } = await apiClient.post<ApiResponse<License>>(
      `/licenses/${tenantId}/renew`,
      { expiresAt },
    );
    return data.data!;
  },

  // 升級
  async upgrade(tenantId: string, tier: string): Promise<License> {
    const { data } = await apiClient.post<ApiResponse<License>>(
      `/licenses/${tenantId}/upgrade`,
      { tier },
    );
    return data.data!;
  },
};

export const marketsApi = {
  async list(params?: {
    city?: string;
    district?: string;
    type?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    markets: Market[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { data } = await apiClient.get<
      ApiResponse<{
        markets: Market[];
        total: number;
        page: number;
        limit: number;
      }>
    >("/markets", { params });
    return data.data!;
  },

  async create(request: CreateMarketRequest): Promise<Market> {
    const { data } = await apiClient.post<ApiResponse<{ market: Market }>>(
      "/admin/markets",
      request,
    );
    return data.data!.market;
  },

  async update(id: string, request: UpdateMarketRequest): Promise<Market> {
    const { data } = await apiClient.put<ApiResponse<{ market: Market }>>(
      `/admin/markets/${id}`,
      request,
    );
    return data.data!.market;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/admin/markets/${id}`);
  },

  async addVendor(
    marketId: string,
    request: {
      restaurantId: string;
      stallNumber?: string | null;
      locationLabel?: string | null;
      isPrimary?: boolean;
    },
  ): Promise<MarketVendorMembership> {
    const { data } = await apiClient.post<
      ApiResponse<{ membership: MarketVendorMembership }>
    >(`/admin/markets/${marketId}/vendors`, request);
    return data.data!.membership;
  },

  async removeVendor(marketId: string, restaurantId: string): Promise<void> {
    await apiClient.delete(
      `/admin/markets/${marketId}/vendors/${restaurantId}`,
    );
  },

  async importVendors(
    marketId: string,
    request: {
      dryRun?: boolean;
      vendors: MarketVendorImportInput[];
    },
  ): Promise<MarketVendorImportResult> {
    const { data } = await apiClient.post<
      ApiResponse<MarketVendorImportResult>
    >(`/admin/markets/${marketId}/vendor-imports`, request);
    return data.data!;
  },

  async listVendorCandidates(params?: {
    q?: string;
    marketId?: string;
    limit?: number;
  }): Promise<{ restaurants: MarketVendorCandidate[]; total: number }> {
    const { data } = await apiClient.get<
      ApiResponse<{ restaurants: MarketVendorCandidate[]; total: number }>
    >("/admin/markets/vendor-candidates", { params });
    return data.data!;
  },

  async listJoinRequests(params?: {
    status?: MarketJoinRequest["status"];
  }): Promise<MarketJoinRequest[]> {
    const { data } = await apiClient.get<
      ApiResponse<{ requests: MarketJoinRequest[] }>
    >("/admin/markets/join-requests", { params });
    return data.data!.requests;
  },

  async approveJoinRequest(
    requestId: number,
    request: {
      stallNumber?: string | null;
      locationLabel?: string | null;
      isPrimary?: boolean;
    } = {},
  ): Promise<{
    request: MarketJoinRequest;
    membership: MarketVendorMembership;
  }> {
    const { data } = await apiClient.post<
      ApiResponse<{
        request: MarketJoinRequest;
        membership: MarketVendorMembership;
      }>
    >(`/admin/markets/join-requests/${requestId}/approve`, request);
    return data.data!;
  },

  async rejectJoinRequest(requestId: number): Promise<MarketJoinRequest> {
    const { data } = await apiClient.post<
      ApiResponse<{ request: MarketJoinRequest }>
    >(`/admin/markets/join-requests/${requestId}/reject`);
    return data.data!.request;
  },
};

export type PolicyScopeType = "country" | "market";

export interface PolicyDefinition {
  key: string;
  merge: "ceiling_deny" | "ceiling_allow" | "default" | "platform_cap";
  scopes: PolicyScopeType[];
  ui: { kind: "list"; options: string[] } | { kind: "bps" };
}

export interface PolicyScopeState {
  scopeType: PolicyScopeType;
  scopeId: string;
  policies: Record<
    string,
    { value: unknown; updatedBy: string | null; updatedAt: number }
  >;
  restaurantsWithoutCountry?: number;
}

const policyPath = (scopeType: PolicyScopeType, scopeId: string, key: string) =>
  `/admin/policies/${scopeType}/${encodeURIComponent(scopeId)}/${key}`;

export const policiesApi = {
  async registry(): Promise<PolicyDefinition[]> {
    const { data } = await apiClient.get<
      ApiResponse<{ definitions: PolicyDefinition[] }>
    >("/admin/policies/registry");
    return data.data!.definitions;
  },

  async list(
    scopeType: PolicyScopeType,
    scopeId: string,
  ): Promise<PolicyScopeState> {
    const { data } = await apiClient.get<ApiResponse<PolicyScopeState>>(
      "/admin/policies",
      { params: { scope_type: scopeType, scope_id: scopeId } },
    );
    return data.data!;
  },

  /** acknowledge：管理員已確認的「國別未知店家數」，見 spec D10。 */
  async set(
    scopeType: PolicyScopeType,
    scopeId: string,
    key: string,
    value: unknown,
    acknowledge?: number,
  ): Promise<void> {
    await apiClient.put(
      policyPath(scopeType, scopeId, key),
      {
        value,
        ...(acknowledge === undefined
          ? {}
          : { acknowledgeRestaurantsWithoutCountry: acknowledge }),
      },
      // The view answers this 409 with a confirm dialog, not an error.
      { expectedErrorCodes: ["POLICY_BLOCKED_BY_UNKNOWN_COUNTRY"] },
    );
  },

  async clear(
    scopeType: PolicyScopeType,
    scopeId: string,
    key: string,
  ): Promise<void> {
    await apiClient.delete(policyPath(scopeType, scopeId, key));
  },
};

export default {
  auth: authApi,
  tenants: tenantsApi,
  deployments: deploymentsApi,
  health: healthApi,
  licenses: licensesApi,
  markets: marketsApi,
  policies: policiesApi,
};
