import { UUIDEntity, Status, BusinessHours } from "./common";

export interface Restaurant extends UUIDEntity {
  name: string;
  type?: string;
  category?: string;
  description?: string;
  address?: string;
  district?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string;
  email?: string;
  website?: string;
  businessHours?: BusinessHours;
  logoUrl?: string;
  bannerUrl?: string;
  imageUrls?: string[];
  isAvailable?: boolean;
  isActive?: boolean;
  rating?: number;
  reviewCount?: number;
  totalOrders?: number;
  supportsTakeaway?: boolean;
  supportsDelivery?: boolean;
  status: Status;
  planType: PlanType;
  settings?: RestaurantSettings;

  /**
   * IANA name of the zone this restaurant's business day is cut in. A column
   * rather than a `settings` key since #329: every revenue and report bucket
   * derives its SQL offset from it, and two copies of the day boundary is how
   * a shop ends up with a report it cannot reconcile against the till.
   */
  timezone?: string;

  // 店家级别 QR Code（用于无桌号的外带/自取订单）
  shopQrCode?: string;
  shopQrCodeImageUrl?: string;
  enableShopMode?: boolean;
  shopQrSettings?: ShopQrSettings;
  shopQrVersion?: number;

  /** A platform showcase shop: browsable, but every order is refused. */
  isDemo?: boolean;
}

export interface ShopQrSettings {
  displayName?: string;
  instructions?: string;
}

export enum PlanType {
  FREE = 0,
  BASIC = 1,
  PRO = 2,
}

export interface RestaurantSettings {
  currency?: string;
  language?: string;
  allowGuestOrders?: boolean;
  autoAcceptOrders?: boolean;
  estimatedPrepTime?: number; // minutes
  maxTablesPerQR?: number;
  enableNotifications?: boolean;
  theme?: {
    primaryColor?: string;
    logoUrl?: string;
    backgroundImage?: string;
  };
  // Fulfillment settings
  enableDineIn?: boolean;
  enableTakeaway?: boolean;
  enableDelivery?: boolean;
  deliveryFee?: number;
  estimatedPrepTimeMin?: number;
  estimatedPrepTimeMax?: number;
}

export interface CreateRestaurantRequest {
  name: string;
  description?: string;
  address?: string;
  phone?: string;
  email?: string;
  businessHours?: BusinessHours;
}

export interface UpdateRestaurantRequest extends Partial<CreateRestaurantRequest> {
  settings?: Partial<RestaurantSettings>;
}

export interface RestaurantStats {
  totalOrders: number;
  todayOrders: number;
  totalRevenue: number; // in cents
  todayRevenue: number; // in cents
  averageOrderValue: number; // in cents
  activeMenuItems: number;
  totalTables: number;
  occupiedTables: number;
}
