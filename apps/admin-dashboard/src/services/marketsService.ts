import { api, unwrapApiPayload } from "@/services/api";
import type { MarketPublicReadiness } from "@/utils/marketPublicReadiness";

export type MarketGeoJsonBoundary =
  | {
      type: "Polygon";
      coordinates: number[][][];
    }
  | {
      type: "MultiPolygon";
      coordinates: number[][][][];
    };

export interface MarketMapLayout {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface MarketCatalogGapVendor {
  restaurantId: string;
  name: string;
  stallNumber?: string | null;
  locationLabel?: string | null;
}

export interface MarketCatalogCoverage {
  searchableProductCount: number;
  publicServiceCount: number;
  bookingRequiredServiceCount?: number;
  bookingUrlMissingServiceCount?: number;
  vendorsWithSearchableProducts?: number;
  vendorsMissingSearchableProducts?: number;
  vendorsWithPublicServices?: number;
  vendorsMissingPublicServices?: number;
  vendorsMissingBookingUrls?: number;
  vendorsMissingStallNumbers?: number;
  vendorsMissingMapPositions?: number;
  vendorsMissingSearchEntrypoints?: number;
  missingProductVendors?: MarketCatalogGapVendor[];
  missingServiceVendors?: MarketCatalogGapVendor[];
  missingBookingUrlVendors?: MarketCatalogGapVendor[];
  missingStallNumberVendors?: MarketCatalogGapVendor[];
  missingMapPositionVendors?: MarketCatalogGapVendor[];
  missingSearchEntrypointVendors?: MarketCatalogGapVendor[];
}

export interface MarketListItem {
  id: string;
  slug: string;
  name: string;
  type: string;
  description?: string | null;
  city: string;
  district: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  boundaryGeojson?: MarketGeoJsonBoundary | null;
  mapLayout?: MarketMapLayout | null;
  openingHours?: Record<string, unknown> | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  imageUrls?: string[] | null;
  tags?: string[] | null;
  platformFeeRateBps?: number;
  businessDayCutoffMinutes?: number;
  vendorCount?: number;
  catalogCoverage?: MarketCatalogCoverage;
  publicReadiness?: MarketPublicReadiness;
}

export interface MarketQrCodeResult {
  id: number;
  content: string;
  format: "png" | "svg" | "pdf" | "jpeg";
  downloadUrl?: string;
}

export interface MarketAreaReadinessSummary {
  city: string;
  district: string;
  marketCount: number;
  vendorCount: number;
  searchableProductCount: number;
  publicServiceCount: number;
  vendorsMissingSearchableProducts: number;
  vendorsMissingPublicServices: number;
  marketsWithoutVendors: number;
  marketsWithoutSearchableCatalog: number;
  totalCatalogGapVendors: number;
  averageReadinessScore: number;
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

export interface MarketVendor {
  restaurantId: string;
  name: string;
  type?: string | null;
  category?: string | null;
  city?: string | null;
  district?: string | null;
  supportsTakeaway: boolean;
  supportsDelivery: boolean;
  stallNumber?: string | null;
  locationLabel?: string | null;
  mapPosition?: MarketVendorMapPosition | null;
  marketHours?: Record<string, unknown> | null;
  effectiveBusinessHours?: Record<string, unknown> | null;
  isPrimary: boolean;
}

export interface MarketVendorMapPosition {
  x: number;
  y: number;
}

export interface MarketVendorsResult {
  vendors: MarketVendor[];
  total: number;
  page: number;
  limit: number;
}

export interface MarketVendorCandidatesResult {
  restaurants: MarketVendorCandidate[];
  total: number;
}

export interface UpdateMarketPublicProfileInput {
  description: string | null;
  address: string;
  latitude: number;
  longitude: number;
  openingHours: Record<string, unknown> | null;
  businessDayCutoffMinutes?: number;
  mapLayout: MarketMapLayout | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  imageUrls: string[] | null;
  tags: string[] | null;
}

export interface CreateMarketInput {
  slug: string;
  name: string;
  type: "night_market" | "commercial_district" | "food_court" | "event_venue";
  description?: string | null;
  city: string;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  boundaryGeojson?: MarketGeoJsonBoundary | null;
  mapLayout?: MarketMapLayout | null;
  openingHours?: Record<string, unknown> | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  imageUrls?: string[] | null;
  tags?: string[] | null;
  platformFeeRateBps?: number;
  isActive?: boolean;
}

export interface ImportMarketResult {
  status: "created" | "skipped" | "would_create";
  reason?: "duplicate_in_payload" | "slug_exists";
  slug: string;
  marketName: string;
  type?: CreateMarketInput["type"];
  city?: string;
  district?: string;
  market?: MarketListItem;
}

export interface ImportMarketIssue {
  index: number;
  code: "duplicate_in_payload" | "slug_exists";
  severity: "blocking";
  message: string;
  slug: string;
  marketName?: string;
}

export interface ImportMarketsResult {
  dryRun?: boolean;
  wouldCreateMarkets?: number;
  createdMarkets: number;
  skipped: number;
  issueCount: number;
  blockingIssueCount: number;
  issues: ImportMarketIssue[];
  results: ImportMarketResult[];
}

export interface ImportMarketVendorInput {
  restaurantId?: string;
  name?: string;
  type?: string;
  category?: string;
  description?: string | null;
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
  mapPosition?: MarketVendorMapPosition | null;
  marketHours?: Record<string, unknown> | null;
  isPrimary?: boolean;
}

export interface ImportMarketVendorResult {
  status: "attached" | "created" | "skipped" | "would_attach" | "would_create";
  reason?:
    | "already_attached"
    | "duplicate_in_payload"
    | "market_not_found"
    | "restaurant_not_found";
  restaurantId?: string;
  restaurantName?: string | null;
  membershipId?: number;
  stallNumber?: string | null;
  locationLabel?: string | null;
  mapPosition?: MarketVendorMapPosition | null;
  marketHours?: Record<string, unknown> | null;
}

export interface ImportMarketVendorIssue {
  index: number;
  code:
    | "already_attached"
    | "city_defaulted"
    | "coordinates_missing"
    | "duplicate_in_payload"
    | "phone_defaulted"
    | "restaurant_not_found";
  severity: "blocking" | "warning";
  message: string;
  field?: "city" | "coordinates" | "phone";
  restaurantId?: string;
  restaurantName?: string;
}

export interface ImportMarketVendorsResult {
  dryRun?: boolean;
  createdRestaurants?: number;
  attachedVendors?: number;
  skipped: number;
  wouldCreateRestaurants?: number;
  wouldAttachVendors?: number;
  issueCount?: number;
  blockingIssueCount?: number;
  warningIssueCount?: number;
  issues?: ImportMarketVendorIssue[];
  publicReadiness?: MarketPublicReadiness | null;
  catalogReadiness?: MarketCatalogCoverage;
  results: ImportMarketVendorResult[];
}

export interface RestaurantMarketMembership {
  id: number;
  restaurantId: string;
  marketId: string;
  stallNumber?: string | null;
  locationLabel?: string | null;
  marketHours?: Record<string, unknown> | null;
  isPrimary: boolean;
  joinedAt: string | number | Date;
  isOpenToday: boolean;
  openedAt: string | number | null;
  businessDate: string;
  timezone: string;
  nextBusinessDayStartMs: number;
  market: {
    id: string;
    slug: string;
    name: string;
    type: string;
    city: string;
    district: string;
  };
}

export interface MarketVendorOpenState {
  isOpenToday: boolean;
  openedAt: string | number | null;
  businessDate: string;
}

export type MarketOpenReportScope =
  | { kind: "platform"; marketId: string }
  | { kind: "owner"; restaurantId: string; marketId: string };

export interface MarketOpenReportDailyRow {
  businessDate: string;
  restaurantId: string;
  vendorName: string;
  stallNumber: string | null;
  firstOpenedAtMs: number | null;
  lastClosedAtMs: number | null;
  autoClosed: boolean;
  openMinutes: number;
  openedBy: string | null;
  orderCount: number;
  revenueCents: number;
  currency: string;
  offsetMinutes: number;
}

export interface MarketOpenReportSummaryRow {
  restaurantId: string;
  vendorName: string;
  stallNumber: string | null;
  openDays: number;
  expectedDays: number;
  attendanceRate: number | null;
  avgOpenMinutes: number;
  orderCount: number;
  revenueCents: number;
  currency: string;
}

export interface MarketOpenReport {
  market: { id: string; name: string; businessDayCutoffMinutes: number };
  from: string;
  to: string;
  daily: MarketOpenReportDailyRow[];
  summary: MarketOpenReportSummaryRow[];
}

function openReportPath(scope: MarketOpenReportScope) {
  return scope.kind === "platform"
    ? `/admin/markets/${scope.marketId}/open-report`
    : `/restaurants/${scope.restaurantId}/markets/${scope.marketId}/open-report`;
}

export interface AddMarketVendorInput {
  restaurantId: string;
  stallNumber?: string | null;
  locationLabel?: string | null;
  mapPosition?: MarketVendorMapPosition | null;
  marketHours?: Record<string, unknown> | null;
  isPrimary?: boolean;
}

export interface UpdateMarketVendorInput {
  stallNumber?: string | null;
  locationLabel?: string | null;
  mapPosition?: MarketVendorMapPosition | null;
  marketHours?: Record<string, unknown> | null;
  isPrimary?: boolean;
}

export interface MarketJoinRequest {
  id: number;
  restaurantId: string;
  marketId: string;
  status: "pending" | "approved" | "rejected";
  message?: string | null;
  requestedAt: string | number | Date;
  resolvedAt?: string | number | Date | null;
  market: {
    id: string;
    slug: string;
    name: string;
    type: string;
    city: string;
    district: string;
  };
}

export interface AdminMarketJoinRequest extends MarketJoinRequest {
  restaurant: {
    id: string;
    name: string;
    city?: string | null;
    district?: string | null;
  };
}

export const marketsService = {
  async listMarkets(): Promise<MarketListItem[]> {
    const response = await api.get<{
      markets: MarketListItem[];
      total: number;
      page: number;
      limit: number;
    }>("/markets", { limit: 50 });
    return unwrapApiPayload<{ markets: MarketListItem[] }>(response.data)
      .markets;
  },

  async listPlatformReadiness(): Promise<MarketListItem[]> {
    const response = await api.get<{
      markets: MarketListItem[];
      total: number;
      page: number;
      limit: number;
    }>("/admin/markets/readiness");
    return unwrapApiPayload<{ markets: MarketListItem[] }>(response.data)
      .markets;
  },

  async listAreaReadiness(): Promise<MarketAreaReadinessSummary[]> {
    const response = await api.get<{
      areas: MarketAreaReadinessSummary[];
    }>("/admin/markets/area-readiness");
    return unwrapApiPayload<{ areas: MarketAreaReadinessSummary[] }>(
      response.data,
    ).areas;
  },

  async generateMarketQr(input: {
    slug: string;
    name: string;
  }): Promise<MarketQrCodeResult> {
    const response = await api.post<MarketQrCodeResult>("/qr/generate", {
      content: `MARKET-${input.slug}`,
      format: "png",
      metadata: {
        title: `${input.name} 市場 QR`,
        description: `掃描後開啟${input.name}市場頁`,
      },
    });
    return unwrapApiPayload<MarketQrCodeResult>(response.data);
  },

  async listRestaurantMemberships(
    restaurantId: string,
  ): Promise<RestaurantMarketMembership[]> {
    const response = await api.get<{
      memberships: RestaurantMarketMembership[];
    }>(`/restaurants/${restaurantId}/markets`);
    return unwrapApiPayload<{ memberships: RestaurantMarketMembership[] }>(
      response.data,
    ).memberships;
  },

  async setMarketOpenToday(
    restaurantId: string,
    marketId: string,
    open: boolean,
  ): Promise<MarketVendorOpenState> {
    const response = await api.post<MarketVendorOpenState>(
      `/restaurants/${restaurantId}/markets/${marketId}/${open ? "open" : "close"}`,
    );
    return unwrapApiPayload<MarketVendorOpenState>(response.data);
  },

  async getMarketOpenReport(
    scope: MarketOpenReportScope,
    range: { from: string; to: string },
  ): Promise<MarketOpenReport> {
    const response = await api.get<MarketOpenReport>(
      openReportPath(scope),
      range,
    );
    return unwrapApiPayload<MarketOpenReport>(response.data);
  },

  async exportMarketOpenReportCsv(
    scope: MarketOpenReportScope,
    range: { from: string; to: string },
    view: "daily" | "summary",
  ): Promise<Blob> {
    const response = await api.instance.get<Blob>(openReportPath(scope), {
      params: { ...range, view, format: "csv" },
      responseType: "blob",
    });
    return response.data;
  },

  async listMarketVendors(
    slug: string,
    input: { q?: string; page?: number; limit?: number } = {},
  ): Promise<MarketVendorsResult> {
    const response = await api.get<MarketVendorsResult>(
      `/markets/${slug}/vendors`,
      {
        q: input.q,
        page: input.page ?? 1,
        limit: input.limit ?? 10,
      },
    );
    return unwrapApiPayload<MarketVendorsResult>(response.data);
  },

  async requestJoin(
    restaurantId: string,
    input: { marketId?: string; marketSlug?: string; message?: string | null },
  ): Promise<MarketJoinRequest> {
    const response = await api.post<{ request: MarketJoinRequest }>(
      `/restaurants/${restaurantId}/market-join-requests`,
      input,
    );
    return unwrapApiPayload<{ request: MarketJoinRequest }>(response.data)
      .request;
  },

  async listJoinRequests(restaurantId: string): Promise<MarketJoinRequest[]> {
    const response = await api.get<{
      requests: MarketJoinRequest[];
    }>(`/restaurants/${restaurantId}/market-join-requests`);
    return unwrapApiPayload<{ requests: MarketJoinRequest[] }>(response.data)
      .requests;
  },

  async listAdminJoinRequests(
    input: {
      status?: MarketJoinRequest["status"];
    } = {},
  ): Promise<AdminMarketJoinRequest[]> {
    const response = await api.get<{
      requests: AdminMarketJoinRequest[];
    }>("/admin/markets/join-requests", input);
    return unwrapApiPayload<{ requests: AdminMarketJoinRequest[] }>(
      response.data,
    ).requests;
  },

  async approveJoinRequest(
    requestId: number,
    input: {
      stallNumber?: string | null;
      locationLabel?: string | null;
      marketHours?: Record<string, unknown> | null;
      isPrimary?: boolean;
    } = {},
  ): Promise<void> {
    await api.post(`/admin/markets/join-requests/${requestId}/approve`, input);
  },

  async rejectJoinRequest(requestId: number): Promise<void> {
    await api.post(`/admin/markets/join-requests/${requestId}/reject`, {});
  },

  async updateMarketPublicProfile(
    marketId: string,
    input: UpdateMarketPublicProfileInput,
  ): Promise<MarketListItem> {
    const response = await api.put<{ market: MarketListItem }>(
      `/admin/markets/${marketId}`,
      input,
    );
    return unwrapApiPayload<{ market: MarketListItem }>(response.data).market;
  },

  async createMarket(input: CreateMarketInput): Promise<MarketListItem> {
    const response = await api.post<{ market: MarketListItem }>(
      "/admin/markets",
      input,
    );
    return unwrapApiPayload<{ market: MarketListItem }>(response.data).market;
  },

  async importMarkets(
    markets: CreateMarketInput[],
    options: { dryRun?: boolean } = {},
  ): Promise<ImportMarketsResult> {
    const response = await api.post<ImportMarketsResult>(
      "/admin/markets/bulk",
      { markets, ...(options.dryRun ? { dryRun: true } : {}) },
    );
    return unwrapApiPayload<ImportMarketsResult>(response.data);
  },

  async importVendors(
    marketId: string,
    vendors: ImportMarketVendorInput[],
    options: { dryRun?: boolean } = {},
  ): Promise<ImportMarketVendorsResult> {
    const response = await api.post<ImportMarketVendorsResult>(
      `/admin/markets/${marketId}/vendor-imports`,
      { vendors, ...(options.dryRun ? { dryRun: true } : {}) },
    );
    return unwrapApiPayload<ImportMarketVendorsResult>(response.data);
  },

  async searchVendorCandidates(input: {
    q?: string;
    marketId?: string;
    limit?: number;
  }): Promise<MarketVendorCandidatesResult> {
    const response = await api.get<MarketVendorCandidatesResult>(
      "/admin/markets/vendor-candidates",
      input,
    );
    return unwrapApiPayload<MarketVendorCandidatesResult>(response.data);
  },

  async addVendor(
    marketId: string,
    input: AddMarketVendorInput,
  ): Promise<RestaurantMarketMembership> {
    const response = await api.post<{ membership: RestaurantMarketMembership }>(
      `/admin/markets/${marketId}/vendors`,
      input,
    );
    return unwrapApiPayload<{ membership: RestaurantMarketMembership }>(
      response.data,
    ).membership;
  },

  async updateVendor(
    marketId: string,
    restaurantId: string,
    input: UpdateMarketVendorInput,
  ): Promise<RestaurantMarketMembership> {
    const response = await api.put<{ membership: RestaurantMarketMembership }>(
      `/admin/markets/${marketId}/vendors/${restaurantId}`,
      input,
    );
    return unwrapApiPayload<{ membership: RestaurantMarketMembership }>(
      response.data,
    ).membership;
  },

  async removeVendor(marketId: string, restaurantId: string): Promise<boolean> {
    const response = await api.delete<{ removed: boolean }>(
      `/admin/markets/${marketId}/vendors/${restaurantId}`,
    );
    return unwrapApiPayload<{ removed: boolean }>(response.data).removed;
  },
};
