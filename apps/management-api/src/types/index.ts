/**
 * Management API Type Definitions
 *
 * Types for the central management platform that handles:
 * - Tenant management
 * - Deployment provisioning
 * - License management
 * - Health monitoring
 */

import type { KVNamespace } from "@cloudflare/workers-types";

// ============================================================
// Environment Types
// ============================================================

export interface ManagementEnv {
  // Environment variables
  NODE_ENV: string;
  API_VERSION: string;
  API_BASE_URL: string;
  CORS_ORIGIN: string;
  LOG_LEVEL: string;
  /** Origin of the admin dashboard; onboarding setup-password links point here. */
  ADMIN_APP_URL?: string;

  // Secrets (set via wrangler secret put)
  JWT_SECRET: string;
  MANAGEMENT_JWT_SECRET?: string;
  // No ENCRYPTION_KEY here on purpose: nothing in this app's src encrypts or
  // decrypts anything, so declaring it required only forced every test fixture
  // to invent a value and implied a production secret that never needed to
  // exist. Re-add it (and the wrangler.toml/.dev.vars.example notes) only
  // alongside the code that actually reads it.
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  PLATFORM_CF_API_TOKEN?: string;
  PLATFORM_CF_ACCOUNT_ID?: string;
  SLACK_WEBHOOK_URL?: string; // Optional: for alert notifications
  ONBOARDING_EMAIL_ENABLED?: string;
  ONBOARDING_EMAIL_FROM?: string;
  INTERNAL_API_TOKEN?: string;

  // D1 Database binding
  MANAGEMENT_DB: D1Database;
  PLATFORM_DB?: D1Database;

  // KV namespaces
  CACHE_KV: KVNamespace;
  DEPLOYMENT_STATUS_KV: KVNamespace;

  // R2 bucket for worker bundles
  BUNDLE_STORAGE: R2Bucket;
}

// ============================================================
// Tenant Types
// ============================================================

/**
 * Tenant status
 */
export type TenantStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "suspended"
  | "terminated";

/**
 * License tier
 */
export type LicenseTier = "standard" | "professional" | "enterprise";
export type OnboardingPlanId = LicenseTier | "trial";

/**
 * Tenant record in database
 */
export interface Tenant {
  id: string;
  businessName: string;
  contactEmail: string;
  contactPhone?: string;
  latitude?: number;
  longitude?: number;

  // Deployment info
  subdomain: string;
  customDomain?: string;
  deployedVersion?: string;

  // License info
  licenseTier: LicenseTier;
  licenseKey: string;
  licenseExpiresAt?: string;

  // Status
  status: TenantStatus;

  // Platform account links
  platformRestaurantId?: string;
  ownerUserId?: string;
  ownerUsername?: string;

  // Timestamps
  createdAt: string;
  activatedAt?: string;
  updatedAt: string;
}

/**
 * Create tenant request
 */
export interface CreateTenantRequest {
  businessName: string;
  contactEmail: string;
  contactPhone?: string;
  subdomain?: string;
  customDomain?: string;
  licenseTier: LicenseTier;
}

/**
 * Update tenant request
 */
export interface UpdateTenantRequest {
  businessName?: string;
  contactEmail?: string;
  contactPhone?: string;
  customDomain?: string;
  licenseTier?: LicenseTier;
  status?: TenantStatus;
}

// ============================================================
// Resource Types
// ============================================================

/**
 * Cloudflare resource type
 */
export type ResourceType = "d1" | "kv" | "r2" | "worker" | "page";

/**
 * Resource status
 */
export type ResourceStatus =
  | "pending"
  | "creating"
  | "ready"
  | "error"
  | "deleted";

/**
 * Tenant resource record
 */
export interface TenantResource {
  id: string;
  tenantId: string;
  resourceType: ResourceType;
  resourceName: string;
  resourceId?: string;
  status: ResourceStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resource provisioning request
 */
export interface ProvisionResourceRequest {
  tenantId: string;
  resourceType: ResourceType;
  resourceName: string;
}

// ============================================================
// Deployment Types
// ============================================================

/**
 * Deployment type
 */
export type DeploymentType = "initial" | "update" | "rollback";

/**
 * Deployment status
 */
export type DeploymentStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "rolled_back";

/**
 * Deployment log record
 */
export interface DeploymentLog {
  id: string;
  tenantId: string;
  deploymentType: DeploymentType;
  fromVersion?: string;
  toVersion: string;
  status: DeploymentStatus;
  logs?: string; // JSON array of log entries
  startedAt: string;
  completedAt?: string;
}

/**
 * Deploy request
 */
export interface DeployRequest {
  tenantId: string;
  targetVersion: string;
  deploymentType?: DeploymentType;
}

// ============================================================
// License Types
// ============================================================

/**
 * License validation request
 */
export interface LicenseValidationRequest {
  tenantId: string;
  licenseKey: string;
  version: string;
  timestamp: number;
}

/**
 * License validation response
 */
export interface LicenseValidationResponse {
  valid: boolean;
  tier?: LicenseTier;
  features?: LicenseFeatures;
  expiresAt?: string;
  error?: string;
}

/**
 * License features by tier
 */
export interface LicenseFeatures {
  maxRestaurants: number;
  aiAnalytics: boolean;
  advancedScheduling: boolean;
  leaveManagement: boolean;
  partnerships: boolean;
  customBranding: boolean;
  prioritySupport: boolean;
  apiAccess: boolean;
}

/**
 * Generate license request
 */
export interface GenerateLicenseRequest {
  tenantId: string;
  tier: LicenseTier;
  validityMonths: number;
}

// ============================================================
// Health Check Types
// ============================================================

/**
 * Health status
 */
export type HealthStatus = "healthy" | "degraded" | "down";

/**
 * Health check record
 */
export interface HealthCheck {
  id: string;
  tenantId: string;
  status: HealthStatus;
  responseTimeMs?: number;
  details?: string; // JSON object with component status
  checkedAt: string;
}

/**
 * Tenant health summary
 */
export interface TenantHealthSummary {
  tenantId: string;
  tenantName: string;
  status: HealthStatus;
  lastCheck: string;
  uptimePercentage: number;
  avgResponseTime: number;
  issues?: string[];
}

// ============================================================
// API Response Types
// ============================================================

/**
 * Standard API response
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  /**
   * Matches what `app.onError` actually emits (see src/index.ts): an object,
   * not a bare string. The previous `error?: string; code?: string` pair never
   * described a response this service sends.
   */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================
// Cloudflare API Types
// ============================================================

/**
 * Cloudflare API response wrapper
 */
export interface CloudflareApiResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T;
}

/**
 * D1 database info
 */
export interface D1DatabaseInfo {
  uuid: string;
  name: string;
  created_at: string;
  version: string;
}

/**
 * KV namespace info
 */
export interface KVNamespaceInfo {
  id: string;
  title: string;
  supports_url_encoding?: boolean;
}

/**
 * R2 bucket info
 */
export interface R2BucketInfo {
  name: string;
  creation_date: string;
}

/**
 * Worker info
 */
export interface WorkerInfo {
  id: string;
  etag: string;
  handlers: string[];
  modified_on: string;
}

// ============================================================
// Onboarding Types
// ============================================================

/**
 * Onboarding application status
 */
export type OnboardingStatus =
  | "submitted"
  | "provisioning"
  | "completed"
  | "rejected";

/**
 * Onboarding application record
 */
export interface OnboardingApplication {
  id: string;
  applicationSecret?: string;
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  planId: OnboardingPlanId | null;
  latitude?: number;
  longitude?: number;
  requestedSubdomain?: string;
  assignedSubdomain?: string;
  status: OnboardingStatus;
  tenantId?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  submittedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

/**
 * Create onboarding application request
 */
export interface CreateApplicationRequest {
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  planId?: OnboardingPlanId | null;
  latitude: number;
  longitude: number;
}

/**
 * Cloudflare permission check result
 */
export interface CloudflarePermissions {
  workers: boolean;
  d1: boolean;
  kv: boolean;
  r2: boolean;
  pages: boolean;
}

/**
 * Cloudflare verification result
 */
export interface CloudflareVerificationResult {
  valid: boolean;
  permissions: CloudflarePermissions;
  error?: string;
}
