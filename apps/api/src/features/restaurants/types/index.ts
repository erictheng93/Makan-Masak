/**
 * Restaurants Types
 * TypeScript type definitions for the restaurants feature
 */

// Import and re-export shared types for consistency
import type { BusinessTimezone } from "@makanmasak/database";
import type {
  Restaurant as SharedRestaurant,
  RestaurantSettings as SharedRestaurantSettings,
  RestaurantStats as SharedRestaurantStats,
  BusinessHours as SharedBusinessHours,
  Status,
  PlanType,
  SupportedCountryCode,
} from "@makanmasak/shared-types";

export type Restaurant = SharedRestaurant;
export type RestaurantSettings = SharedRestaurantSettings;
export type RestaurantStats = SharedRestaurantStats;
export type BusinessHours = SharedBusinessHours;
export { Status, PlanType };

// Additional feature-specific types
export interface CreateRestaurantData {
  name: string;
  type: string;
  category: string;
  description?: string;
  address: string;
  district: string;
  city?: string;
  /** Required only when `city` is not on a country's city list. */
  countryCode?: SupportedCountryCode;
  phone: string;
  email?: string;
  website?: string;
  businessHours?: BusinessHours;
  latitude?: number | null;
  longitude?: number | null;
  logoUrl?: string;
  bannerUrl?: string;
}

export interface UpdateRestaurantData extends Partial<
  Omit<CreateRestaurantData, "countryCode">
> {
  isAvailable?: boolean;
  isActive?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  supportsTakeaway?: boolean;
  supportsDelivery?: boolean;
  settings?: Partial<RestaurantSettings>;
  timezone?: BusinessTimezone;
}

// Enhanced restaurant statistics interface
export interface EnhancedRestaurantStats extends RestaurantStats {
  popularItems: Array<{
    id: number;
    name: string;
    orderCount: number;
  }>;
  ordersByHour: Array<{
    hour: number;
    count: number;
  }>;
  customerRetention: {
    newCustomers: number;
    returningCustomers: number;
    retentionRate: number;
  };
}

// Filter and query types
export interface RestaurantFilters {
  page?: number;
  limit?: number;
  type?: string;
  district?: string;
  isAvailable?: boolean;
}

export interface NearbySearchParams {
  district: string;
  limit: number;
}

export interface PopularRestaurantsParams {
  limit: number;
}

// Service interfaces
export interface IRestaurantService {
  getRestaurants(filters: RestaurantFilters): Promise<{
    restaurants: Restaurant[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>;
  getRestaurant(id: string): Promise<Restaurant | null>;
  createRestaurant(data: CreateRestaurantData): Promise<Restaurant>;
  updateRestaurant(
    id: string,
    data: UpdateRestaurantData,
  ): Promise<Restaurant | null>;
  deactivateRestaurant(id: string): Promise<boolean>;
  getRestaurantStats(id: string): Promise<EnhancedRestaurantStats>;
  searchNearbyRestaurants(
    district: string,
    limit: number,
  ): Promise<Restaurant[]>;
  getPopularRestaurants(limit: number): Promise<Restaurant[]>;
}

// Event types for restaurant operations
export type RestaurantEvent =
  | { type: "RESTAURANT_CREATED"; payload: Restaurant }
  | { type: "RESTAURANT_UPDATED"; payload: Restaurant }
  | { type: "RESTAURANT_DEACTIVATED"; payload: { id: string } }
  | {
      type: "RESTAURANT_STATS_UPDATED";
      payload: { id: string; stats: RestaurantStats };
    };
