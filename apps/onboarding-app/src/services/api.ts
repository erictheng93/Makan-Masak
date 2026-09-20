/**
 * Onboarding API Service
 * Handles communication with the Management API
 */

import axios, { AxiosError } from "axios";
import type { SupportedCountryCode } from "@makanmasak/shared-types";

function resolveApiBase(): string {
  const apiBase = import.meta.env.VITE_API_URL;
  if (apiBase) {
    return apiBase;
  }

  if (import.meta.env.PROD) {
    throw new Error("VITE_API_URL is required for production builds");
  }

  return "/api/v1";
}

const API_BASE = resolveApiBase();

// Create axios instance with defaults
const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000, // 30 second timeout
});

// ============================================================
// Types
// ============================================================

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  details?: Array<{ path: string[]; message: string }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  // Nested format (current management-api): error: { code, message, details }
  // Flat format (legacy fallback during rollout): error: string + top-level code/details
  error?: ApiErrorPayload | string;
  code?: string;
  details?: Array<{ path: string[]; message: string }>;
}

export interface CreateApplicationData {
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  district: string;
  city: string;
  countryCode: SupportedCountryCode;
  marketId?: string;
  stallNumber?: string;
  planId: "trial" | "standard" | "professional" | "enterprise";
  latitude: number;
  longitude: number;
}

export interface ApplicationResponse {
  applicationId: string;
  applicationSecret: string;
  assignedSubdomain: string;
  status: string;
}

export interface ApplicationDetails {
  id: string;
  businessName: string;
  contactName: string;
  contactEmail: string;
  address: string;
  district?: string;
  city?: string;
  countryCode: SupportedCountryCode;
  marketId?: string;
  stallNumber?: string;
  latitude: number;
  longitude: number;
  planId: string;
  assignedSubdomain: string;
  status: string;
  tenantId?: string;
  createdAt: string;
  completedAt?: string;
  rejectionReason?: string;
}

export interface MarketOption {
  id: string;
  name: string;
}

interface MarketListResponse {
  markets: MarketOption[];
  total: number;
  page: number;
  limit: number;
}

const MARKET_PAGE_SIZE = 100;

async function getMarketPage(
  params: { country: SupportedCountryCode; city: string },
  page: number,
): Promise<MarketListResponse> {
  const response = await apiClient.get<ApiResponse<MarketListResponse>>(
    "/markets",
    { params: { ...params, page, limit: MARKET_PAGE_SIZE } },
  );

  if (!response.data.success || !response.data.data) {
    const extracted = extractApiError(response.data);
    throw new ApiError(
      extracted.message || "Failed to load markets",
      extracted.code || "MARKET_LIST_FAILED",
      extracted.details,
    );
  }

  return response.data.data;
}

// ============================================================
// API Error Handling
// ============================================================

export class ApiError extends Error {
  code: string;
  details?: Array<{ path: string[]; message: string }>;

  constructor(
    message: string,
    code: string,
    details?: Array<{ path: string[]; message: string }>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Extract error info from an API error body.
 * Prefers the unified nested format { error: { code, message, details } },
 * falling back to the legacy flat format { error: string, code, details }
 * so the app keeps working against not-yet-updated workers during rollout.
 * TODO(cleanup): drop the flat fallback once every deployed management-api
 * is at or past commit 7151ca2c (all routes emit the nested format).
 */
function extractApiError(response: ApiResponse<unknown>): {
  message?: string;
  code?: string;
  details?: Array<{ path: string[]; message: string }>;
} {
  if (response.error && typeof response.error === "object") {
    return {
      message: response.error.message,
      code: response.error.code,
      details: response.error.details,
    };
  }

  return {
    message: typeof response.error === "string" ? response.error : undefined,
    code: response.code,
    details: response.details,
  };
}

function handleApiError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiResponse<unknown>>;
    const response = axiosError.response?.data;

    if (response) {
      const extracted = extractApiError(response);
      throw new ApiError(
        extracted.message || "Request failed",
        extracted.code || "UNKNOWN_ERROR",
        extracted.details,
      );
    }

    if (axiosError.code === "ECONNABORTED") {
      throw new ApiError("Request timed out", "TIMEOUT");
    }

    if (!axiosError.response) {
      throw new ApiError(
        "Network error - please check your connection",
        "NETWORK_ERROR",
      );
    }
  }

  throw new ApiError("An unexpected error occurred", "UNKNOWN_ERROR");
}

// ============================================================
// API Methods
// ============================================================

export const onboardingApi = {
  /**
   * List active markets available for a selected country and city.
   */
  async getMarkets(params: {
    country: SupportedCountryCode;
    city: string;
  }): Promise<MarketOption[]> {
    try {
      const firstPage = await getMarketPage(params, 1);
      const markets = [...firstPage.markets];
      const totalPages = Math.ceil(firstPage.total / MARKET_PAGE_SIZE);

      for (let page = 2; page <= totalPages; page += 1) {
        const nextPage = await getMarketPage(params, page);
        markets.push(...nextPage.markets);
      }

      return markets;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      handleApiError(error);
    }
  },

  /**
   * Create a new onboarding application
   */
  async createApplication(
    data: CreateApplicationData,
  ): Promise<ApplicationResponse> {
    try {
      const response = await apiClient.post<ApiResponse<ApplicationResponse>>(
        "/onboarding/applications",
        data,
      );

      if (!response.data.success || !response.data.data) {
        const extracted = extractApiError(response.data);
        throw new ApiError(
          extracted.message || "Failed to create application",
          extracted.code || "CREATE_FAILED",
          extracted.details,
        );
      }

      return response.data.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      handleApiError(error);
    }
  },

  /**
   * Get application details
   */
  async getApplication(
    applicationId: string,
    applicationSecret: string,
  ): Promise<ApplicationDetails> {
    try {
      const response = await apiClient.get<ApiResponse<ApplicationDetails>>(
        `/onboarding/applications/${applicationId}`,
        {
          headers: { "X-Onboarding-Secret": applicationSecret },
        },
      );

      if (!response.data.success || !response.data.data) {
        const extracted = extractApiError(response.data);
        throw new ApiError(
          extracted.message || "Application not found",
          extracted.code || "NOT_FOUND",
        );
      }

      return response.data.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      handleApiError(error);
    }
  },
};

export default onboardingApi;
