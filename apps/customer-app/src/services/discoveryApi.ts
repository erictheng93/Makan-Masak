import type { CurrencyCode } from "@makanmasak/shared-types";
import { apiClient } from "./api";

export type OpeningHoursStatus = "open" | "closed" | "unavailable";

export interface DishSearchResult {
  resultType?: "menu_item" | "product";
  menuItemId: number;
  dishName: string;
  price: number;
  priceCents?: number | null;
  priceLabel?: string | null;
  /**
   * The listing restaurant's currency. Results span restaurants, so a row is
   * formatted with this and not with the currency of the shop the customer
   * happens to have visited last. Optional only for cached payloads written
   * before the field existed.
   */
  currency?: CurrencyCode;
  categoryName: string | null;
  restaurantId: string;
  restaurantName: string;
  district: string | null;
  isOpen: boolean;
  /** Omitted by discovery payloads cached before the three-state contract. */
  openingHoursStatus?: OpeningHoursStatus;
  supportsTakeaway: boolean;
  supportsDelivery: boolean;
  tags: string[];
  distanceKm?: number;
  marketVendor?: {
    marketId: string;
    marketSlug?: string | null;
    marketName?: string | null;
    marketUrl?: string | null;
    stallNumber: string | null;
    locationLabel?: string | null;
    isPrimary: boolean;
  } | null;
}

export interface RestaurantListItem {
  restaurantId: string;
  name: string;
  type: string | null;
  category?: string | null;
  district: string | null;
  city?: string | null;
  priceRange: number | null;
  rating: number | null;
  isOpen: boolean;
  /** Omitted by discovery payloads cached before the three-state contract. */
  openingHoursStatus?: OpeningHoursStatus;
  supportsTakeaway: boolean;
  supportsDelivery: boolean;
  imageUrl: string | null;
  latitude?: number | null;
  longitude?: number | null;
  detailUrl?: string;
  menuUrl?: string;
  serviceItemsUrl?: string;
  availableMenuItemCount?: number;
  publicServiceItemCount?: number;
  distanceKm?: number;
  marketVendor?: {
    marketId: string;
    marketSlug?: string | null;
    marketName?: string | null;
    marketUrl?: string | null;
    stallNumber: string | null;
    locationLabel?: string | null;
    isPrimary: boolean;
  } | null;
}

export interface ServiceSearchResult {
  resultType?: "service";
  serviceItemId: number;
  name: string;
  description: string | null;
  serviceType: string;
  priceCents: number | null;
  priceLabel: string | null;
  /** The listing restaurant's currency — see DishSearchResult.currency. */
  currency?: CurrencyCode;
  durationMinutes: number | null;
  requiresBooking: boolean;
  bookingUrl: string | null;
  tags: string[];
  restaurantId: string;
  restaurantName: string;
  district: string | null;
  city: string | null;
  isOpen: boolean;
  /** Omitted by discovery payloads cached before the three-state contract. */
  openingHoursStatus?: OpeningHoursStatus;
  distanceKm?: number;
  marketVendor?: {
    marketId: string;
    marketSlug?: string | null;
    marketName?: string | null;
    marketUrl?: string | null;
    stallNumber: string | null;
    locationLabel?: string | null;
    isPrimary: boolean;
  } | null;
}

export interface ServiceTypeFacet {
  serviceType: NonNullable<SearchFilters["serviceType"]>;
  count: number;
}

export interface MarketSearchScopeMetadata {
  marketId: string;
  hasSearchableCatalog: boolean;
  searchableProductCount: number;
  publicServiceCount: number;
}

export interface SearchResponse<T> {
  results: T[];
  total: number;
  scope?: {
    market?: MarketSearchScopeMetadata;
  };
}

export interface RestaurantMarketMembership {
  marketId: string;
  stallNumber: string | null;
  locationLabel?: string | null;
  isPrimary: boolean;
  market: {
    id: string;
    slug: string;
    name: string;
    type: string;
    city: string;
    district: string;
  };
  marketUrl: string;
}

export interface SearchFilters {
  q?: string;
  city?: string;
  district?: string;
  categoryName?: string;
  catalogType?: "menu_item" | "product";
  marketId?: string;
  marketSlug?: string;
  serviceType?:
    | "general"
    | "booking"
    | "pickup"
    | "delivery"
    | "consultation"
    | "rental"
    | "activity";
  lat?: number;
  lng?: number;
  radiusKm?: number;
  priceMin?: number;
  priceMax?: number;
  openNow?: boolean;
  takeaway?: boolean;
  delivery?: boolean;
  sortBy?: "price_asc" | "price_desc" | "popular" | "open_now" | "distance";
  page?: number;
  limit?: number;
}

export const discoveryApi = {
  async searchDishes(filters: SearchFilters) {
    return apiClient.get<SearchResponse<DishSearchResult>>(
      "/discovery/search",
      filters,
    );
  },

  async browseRestaurants(filters: SearchFilters) {
    return apiClient.get<{ results: RestaurantListItem[]; total: number }>(
      "/discovery/restaurants",
      filters,
    );
  },

  async searchServices(filters: SearchFilters) {
    return apiClient.get<SearchResponse<ServiceSearchResult>>(
      "/discovery/services",
      filters,
    );
  },

  async listCategories(filters: SearchFilters = {}) {
    return apiClient.get<{ categories: string[] }>(
      "/discovery/categories",
      filters,
    );
  },

  async listServiceTypes(filters: SearchFilters = {}) {
    return apiClient.get<{ serviceTypes: ServiceTypeFacet[] }>(
      "/discovery/service-types",
      filters,
    );
  },

  async getRestaurantMenu(restaurantId: string) {
    return apiClient.get<unknown[]>(
      `/discovery/restaurants/${restaurantId}/menu`,
    );
  },

  async getTakeawayEligibility(restaurantId: string) {
    return apiClient.get<
      | { eligible: true; shopQrCode: string }
      | {
          eligible: false;
          reason: "restaurant_disabled" | "takeaway_disabled" | "closed_now";
        }
    >(`/discovery/restaurants/${restaurantId}/takeaway-eligibility`);
  },

  async getRestaurantMarkets(restaurantId: string) {
    return apiClient.get<{ memberships: RestaurantMarketMembership[] }>(
      `/discovery/restaurants/${restaurantId}/markets`,
    );
  },

  async getPopular() {
    return apiClient.get<{
      keywords: string[];
      dishes: DishSearchResult[];
      restaurants: RestaurantListItem[];
    }>("/discovery/popular");
  },
};
