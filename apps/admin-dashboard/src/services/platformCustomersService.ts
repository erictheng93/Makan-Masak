import { api, unwrapApiPayload } from "./api";
import type { CurrencyCode } from "@makanmasak/shared-types";

/**
 * Platform-side (role 0) customer directory — spec §7.2, issue #299 A4.
 *
 * Keyed on the platform `customers.id`, unlike `membersService`, which may only
 * ever address a member through `restaurant_customers.id`. The API enforces
 * that split with `requireRole([0])`; this file exists on the other side of it,
 * so nothing here belongs in a tenant-scoped view.
 */

export type PlatformCustomerSort = "recent" | "orders" | "restaurants" | "name";

export interface PlatformCustomerListItem {
  customerId: string;
  /** Null for a soft-deleted customer; the view renders its own placeholder. */
  displayName: string | null;
  maskedPhone: string | null;
  maskedEmail: string | null;
  locale: string | null;
  status: "active" | "deleted";
  /** The figure no tenant-scoped endpoint may produce. */
  restaurantCount: number;
  orderCount: number;
  totalSpentByCurrency: Array<{ currency: CurrencyCode; amountCents: number }>;
  lastOrderAt: string | null;
  createdAt: string | null;
}

/** Spend facts only — a shop's private tags and notes are not platform data. */
export interface PlatformCustomerRestaurantSlice {
  restaurantId: string;
  restaurantName: string | null;
  orderCount: number;
  cancelledOrderCount: number;
  totalSpentCents: number;
  currency: CurrencyCode;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

export interface PlatformCustomerContactReveal {
  customerId?: string;
  phone: string | null;
  email: string | null;
  revealedAt?: number;
}

export interface PlatformCustomerListParams {
  page?: number;
  limit?: number;
  /**
   * Name substring, or a **complete** phone / email. The API compares contact
   * details by equality only; a prefix would make this an enumeration tool.
   */
  search?: string;
  status?: "active" | "deleted";
  sort?: PlatformCustomerSort;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PlatformCustomerListResponse {
  data: PlatformCustomerListItem[];
  pagination: Pagination;
}

interface RawPagination {
  total: number;
  page: number;
  limit: number;
  pages?: number;
  totalPages?: number;
}

function toPagination(raw: unknown): Pagination {
  const value = (raw ?? {}) as RawPagination;
  return {
    total: value.total ?? 0,
    page: value.page ?? 1,
    limit: value.limit ?? 20,
    pages: value.pages ?? value.totalPages ?? 1,
  };
}

export const platformCustomersService = {
  async list(
    params: PlatformCustomerListParams,
  ): Promise<PlatformCustomerListResponse> {
    const response = await api.get<PlatformCustomerListItem[]>(
      "/admin/customers",
      params,
    );
    return {
      data: unwrapApiPayload<PlatformCustomerListItem[]>(response.data),
      pagination: toPagination(response.data.pagination),
    };
  },

  async get(customerId: string): Promise<PlatformCustomerListItem> {
    const response = await api.get<PlatformCustomerListItem>(
      `/admin/customers/${customerId}`,
    );
    return unwrapApiPayload<PlatformCustomerListItem>(response.data);
  },

  async listRestaurants(
    customerId: string,
  ): Promise<PlatformCustomerRestaurantSlice[]> {
    const response = await api.get<PlatformCustomerRestaurantSlice[]>(
      `/admin/customers/${customerId}/restaurants`,
    );
    return unwrapApiPayload<PlatformCustomerRestaurantSlice[]>(response.data);
  },

  /**
   * Unmask one customer's contact details. Written to audit_logs at platform
   * scope and rate limited to 30/actor/hour — a budget shared with the tenant
   * reveal, because what it bounds is the account, not the endpoint. Only ever
   * call this from a deliberate, confirmed user action.
   */
  async revealContact(
    customerId: string,
    reason?: string,
  ): Promise<PlatformCustomerContactReveal> {
    const response = await api.post<PlatformCustomerContactReveal>(
      `/admin/customers/${customerId}/reveal-contact`,
      reason ? { reason } : undefined,
    );
    return unwrapApiPayload<PlatformCustomerContactReveal>(response.data);
  },
};
