/**
 * Platform Integration Types
 * 外送平台串接型別定義
 */

import { BaseEntity } from "./common";
import type { PlatformSource } from "./order";

// Re-export for convenience
export type { PlatformSource };

// Third-party platform integration types. Internal sources such as direct
// orders and market checkouts are not external integration platforms.
export type PlatformType = Exclude<
  PlatformSource,
  "direct" | "market_checkout"
>;

// ================================================
// Platform Integration
// ================================================

export interface PlatformCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  storeId?: string;
  webhookSecret?: string;
}

export interface PlatformConfig {
  webhookSecret?: string;
  autoAcceptOrders?: boolean;
  menuSyncEnabled?: boolean;
}

export type MenuSyncStatus = "idle" | "syncing" | "success" | "error";

export interface PlatformIntegration extends BaseEntity {
  restaurantId: string;
  platform: PlatformType;
  enabled: boolean;
  credentials?: PlatformCredentials;
  config?: PlatformConfig;
  lastMenuSyncAt?: string;
  menuSyncStatus?: MenuSyncStatus;
  menuSyncError?: string;
}

// ================================================
// Platform Order
// ================================================

export interface PlatformOrder extends BaseEntity {
  orderId: number;
  platform: PlatformType;
  platformOrderId: string;
  platformStoreId?: string;
  restaurantId: string;
  platformStatus?: string;
  lastSyncedAt?: string;
  rawPayload?: unknown;
}

// ================================================
// Platform Menu Mapping
// ================================================

export type MenuMappingSyncStatus = "pending" | "synced" | "error";

export interface PlatformMenuMapping extends BaseEntity {
  menuItemId: number;
  restaurantId: string;
  platform: PlatformType;
  platformItemId?: string;
  syncStatus?: MenuMappingSyncStatus;
  lastSyncedAt?: string;
}

// ================================================
// Webhook Log
// ================================================

export type WebhookLogStatus = "received" | "processed" | "failed";

export interface PlatformWebhookLog {
  id: number;
  platform: PlatformType;
  eventType: string;
  restaurantId?: string;
  payload?: unknown;
  status: WebhookLogStatus;
  error?: string;
  processedAt?: string;
  createdAt: string;
}

// ================================================
// Parsed Platform Order (adapter output)
// ================================================

export interface ParsedPlatformOrderItem {
  platformItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  notes?: string;
  customizations?: {
    name: string;
    value: string;
    priceAdjustmentCents?: number;
  }[];
}

export interface ParsedPlatformOrder {
  platformOrderId: string;
  platformStoreId: string;
  currencyCode: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryInstructions?: string;
  deliveryFeeCents?: number;
  estimatedDeliveryTime?: number;
  items: ParsedPlatformOrderItem[];
  subtotalCents: number;
  taxAmountCents: number;
  totalAmountCents: number;
  notes?: string;
  platformStatus: string;
  rawPayload: unknown;
}

// ================================================
// Menu Sync Types
// ================================================

export interface MenuSyncPayload {
  restaurantId: string;
  currencyCode: string;
  serviceAvailability?: Array<{
    day_of_week: string;
    time_periods: Array<{ start_time: string; end_time: string }>;
  }>;
  categories: MenuSyncCategory[];
}

export interface MenuSyncCategory {
  id: number;
  name: string;
  items: MenuSyncItem[];
}

export interface MenuSyncItem {
  id: number;
  name: string;
  description?: string;
  priceCents: number;
  imageUrl?: string;
  available: boolean;
  modifierGroups?: MenuSyncModifierGroup[];
}

export interface MenuSyncModifierGroup {
  id?: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  modifiers: MenuSyncModifier[];
}

export interface MenuSyncModifier {
  id?: string;
  name: string;
  priceCents: number;
  available?: boolean;
}

export interface MenuSyncResult {
  success: boolean;
  syncedItems: number;
  errors?: string[];
  platformItemIds?: Record<number, string>;
}

// ================================================
// API Request/Response Types
// ================================================

export interface ConnectPlatformRequest {
  clientId: string;
  clientSecret: string;
  storeId: string;
  autoAcceptOrders?: boolean;
  menuSyncEnabled?: boolean;
}

export interface UpdatePlatformConfigRequest {
  autoAcceptOrders?: boolean;
  menuSyncEnabled?: boolean;
  webhookSecret?: string;
}

export interface PlatformOrdersFilter {
  platform?: PlatformType;
  dateFrom?: string;
  dateTo?: string;
  platformStatus?: string;
  page?: number;
  limit?: number;
}
