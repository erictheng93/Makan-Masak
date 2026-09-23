import type { BaseEntity } from "./common";

export type RestaurantServiceType =
  | "general"
  | "booking"
  | "pickup"
  | "delivery"
  | "consultation"
  | "rental"
  | "activity";

export type ServiceItemPaymentRequirement =
  | "none"
  | "deposit"
  | "prepay"
  | "pay_at_venue";

export interface RestaurantServiceItem extends BaseEntity {
  restaurantId: string;
  name: string;
  description?: string | null;
  serviceType: RestaurantServiceType;
  priceCents?: number | null;
  paymentRequirement?: ServiceItemPaymentRequirement;
  depositAmountCents?: number;
  priceLabel?: string | null;
  durationMinutes?: number | null;
  requiresBooking: boolean;
  bookingUrl?: string | null;
  availableHours?: {
    start?: string;
    end?: string;
    days?: number[];
  };
  tags?: string[];
  keywords?: string;
  sortOrder: number;
  isActive: boolean;
  isPublic: boolean;
  deletedAt?: string;
}

export interface CreateRestaurantServiceItemRequest {
  restaurantId: string;
  name: string;
  description?: string | null;
  serviceType?: RestaurantServiceType;
  priceCents?: number | null;
  paymentRequirement?: ServiceItemPaymentRequirement;
  depositAmountCents?: number;
  priceLabel?: string | null;
  durationMinutes?: number | null;
  requiresBooking?: boolean;
  bookingUrl?: string | null;
  availableHours?: RestaurantServiceItem["availableHours"];
  tags?: string[];
  keywords?: string;
  sortOrder?: number;
  isActive?: boolean;
  isPublic?: boolean;
}

export interface UpdateRestaurantServiceItemRequest extends Partial<CreateRestaurantServiceItemRequest> {}
