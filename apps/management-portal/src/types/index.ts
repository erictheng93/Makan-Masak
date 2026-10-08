/**
 * Management Portal Types
 * 管理平台類型定義
 */

// 租戶狀態
export type TenantStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "suspended"
  | "terminated";

// 授權等級
export type LicenseTier = "standard" | "professional" | "enterprise";

// 健康狀態
export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

// 資源類型
export type ResourceType = "d1" | "kv" | "r2" | "worker" | "pages";

// 部署類型
export type DeploymentType = "initial" | "update" | "rollback";

// 部署狀態
export type DeploymentStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "rolled_back";

/**
 * 租戶資訊
 */
export interface Tenant {
  id: string;
  businessName: string;
  contactEmail: string;
  contactPhone?: string;
  subdomain?: string;
  customDomain?: string;
  deployedVersion?: string;
  status: TenantStatus;
  licenseTier?: LicenseTier;
  createdAt: string;
  activatedAt?: string;
}

/**
 * 租戶資源
 */
export interface TenantResource {
  id: string;
  tenantId: string;
  resourceType: ResourceType;
  resourceName: string;
  resourceId?: string;
  status: "pending" | "provisioned" | "failed";
  createdAt: string;
}

/**
 * 部署日誌
 */
export interface DeploymentLog {
  id: string;
  tenantId: string;
  deploymentType: DeploymentType;
  fromVersion?: string;
  toVersion: string;
  status: DeploymentStatus;
  logs?: string[];
  startedAt: string;
  completedAt?: string;
}

/**
 * 健康檢查記錄
 */
export interface HealthCheck {
  id: string;
  tenantId: string;
  status: HealthStatus;
  responseTimeMs?: number;
  details?: {
    api?: HealthStatus;
    database?: HealthStatus;
    cache?: HealthStatus;
    storage?: HealthStatus;
  };
  checkedAt: string;
}

/**
 * 授權資訊
 */
export interface License {
  id: string;
  tenantId: string;
  licenseKey: string;
  tier: LicenseTier;
  expiresAt?: string;
  revokedAt?: string;
  revokeReason?: string;
  createdAt: string;
}

/**
 * 統計卡片資料
 */
export interface StatCard {
  title: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon?: string;
}

/**
 * API 響應
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  /**
   * Unified nested error format `{ code, message, details? }`.
   * A plain string is still accepted as a legacy fallback.
   */
  error?: string | ApiErrorPayload;
  message?: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * 分頁參數
 */
export interface PaginationParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * 分頁響應
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * 創建租戶請求
 */
export interface CreateTenantRequest {
  businessName: string;
  contactEmail: string;
  contactPhone?: string;
  subdomain?: string;
  licenseTier: LicenseTier;
}

/**
 * 更新租戶請求
 */
export interface UpdateTenantRequest {
  businessName?: string;
  contactEmail?: string;
  contactPhone?: string;
  subdomain?: string;
  customDomain?: string;
  status?: TenantStatus;
}

/**
 * 部署請求
 */
export interface DeployRequest {
  tenantId: string;
  /** Strict x.y.z semver — management-api rejects anything else */
  targetVersion: string;
  deploymentType?: DeploymentType;
}

/**
 * 批量部署請求
 */
export interface BatchDeployRequest {
  tenantIds: string[];
  targetVersion: string;
}

/**
 * 授權生成請求
 */
export interface GenerateLicenseRequest {
  tenantId: string;
  tier: LicenseTier;
  expiresAt?: string;
}

export interface Market {
  id: string;
  slug: string;
  name: string;
  type: "night_market" | "commercial_district" | "food_court" | "event_venue";
  description?: string | null;
  city: string;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  boundaryGeojson?:
    | {
        type: "Polygon";
        coordinates: number[][][];
      }
    | {
        type: "MultiPolygon";
        coordinates: number[][][][];
      }
    | null;
  openingHours?: Record<string, unknown> | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  imageUrls?: string[] | null;
  tags?: string[] | null;
  isActive?: boolean;
}

export interface MarketVendorMembership {
  id: number;
  restaurantId: string;
  marketId: string;
  stallNumber?: string | null;
  locationLabel?: string | null;
  isPrimary: boolean;
  joinedAt: string | number;
  leftAt?: string | number | null;
}

export interface MarketVendorCandidate {
  id: string;
  name: string;
  city: string;
  district: string;
  address: string;
  type: string;
  category: string;
  isAvailable: boolean;
  supportsTakeaway: boolean;
  supportsDelivery: boolean;
}

export interface MarketVendorImportInput {
  restaurantId?: string;
  name?: string;
  type?: string;
  category?: string;
  description?: string;
  address?: string;
  district?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  website?: string;
  stallNumber?: string | null;
  locationLabel?: string | null;
  isPrimary?: boolean;
}

export interface MarketVendorImportIssue {
  index: number;
  code: string;
  severity: "blocking" | "warning";
  message: string;
  field?: string;
  restaurantId?: string;
  restaurantName?: string;
}

export interface MarketCatalogGapVendor {
  restaurantId: string;
  name: string;
  stallNumber: string | null;
  locationLabel: string | null;
}

export interface MarketCatalogReadiness {
  searchableProductCount: number;
  publicServiceCount: number;
  vendorsWithSearchableProducts: number;
  vendorsMissingSearchableProducts: number;
  vendorsWithPublicServices: number;
  vendorsMissingPublicServices: number;
  vendorsMissingStallNumbers: number;
  vendorsMissingSearchEntrypoints: number;
  missingProductVendors: MarketCatalogGapVendor[];
  missingServiceVendors: MarketCatalogGapVendor[];
  missingStallNumberVendors: MarketCatalogGapVendor[];
  missingSearchEntrypointVendors: MarketCatalogGapVendor[];
}

export interface MarketVendorImportResult {
  dryRun?: boolean;
  wouldCreateRestaurants?: number;
  wouldAttachVendors?: number;
  createdRestaurants?: number;
  attachedVendors?: number;
  skipped: number;
  issueCount?: number;
  blockingIssueCount?: number;
  warningIssueCount?: number;
  issues?: MarketVendorImportIssue[];
  publicReadiness?: {
    ready: boolean;
    score: number;
    completedCount: number;
    totalCount: number;
    issues: Array<{
      key: string;
      severity: "required" | "recommended";
    }>;
  } | null;
  catalogReadiness?: MarketCatalogReadiness;
  results: Array<{
    status: string;
    reason?: string;
    restaurantId?: string;
    restaurantName?: string;
    membershipId?: number;
    stallNumber?: string | null;
    locationLabel?: string | null;
  }>;
}

export interface MarketJoinRequest {
  id: number;
  restaurantId: string;
  marketId: string;
  status: "pending" | "approved" | "rejected";
  message?: string | null;
  requestedAt: string | number | Date;
  resolvedAt?: string | number | Date | null;
  market: Pick<Market, "id" | "slug" | "name" | "type" | "city" | "district">;
  restaurant: {
    id: string;
    name: string;
    city?: string | null;
    district?: string | null;
  };
}

export interface CreateMarketRequest {
  slug: string;
  name: string;
  type: Market["type"];
  description?: string | null;
  city: string;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  openingHours?: Record<string, unknown> | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  imageUrls?: string[] | null;
  tags?: string[] | null;
  isActive?: boolean;
}

export type UpdateMarketRequest = Partial<CreateMarketRequest>;
