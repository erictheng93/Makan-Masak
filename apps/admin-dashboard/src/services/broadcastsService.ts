import { api, unwrapApiPayload } from "@/services/api";
import type { MarketingBroadcastScope } from "@makanmasak/shared-types";

/**
 * Marketing broadcasts to followers (#335, 商圈 Phase 4).
 *
 * Two scopes, two mount points: a shop owner sends as its restaurant from
 * `/api/v1/restaurants/:id/broadcasts`, and the platform operator sends as a
 * market from `/api/v1/markets/:id/broadcasts`. They share the request and
 * response shapes but not the budget (3/24h vs 1/24h) and not the audience —
 * which is why `includeMarketFollowers` exists on one and is *dropped* by the
 * other route rather than merely defaulted, and so is never sent from here.
 */

export interface SendBroadcastInput {
  /** 1–80 characters after trimming. */
  title: string;
  /** 1–300 characters after trimming. */
  body: string;
  /** Absolute `https://` or site-relative `/…`, ≤2048 chars. Omit for none. */
  url?: string;
  /**
   * Restaurant scope only: also reach customers who follow this restaurant's
   * market but not the restaurant itself.
   */
  includeMarketFollowers?: boolean;
}

/**
 * The counts a sender sees immediately.
 *
 * `audienceCount` counts *people*; the other three count *device deliveries*,
 * so they do not add up to the audience when somebody has three phones.
 */
export interface SendBroadcastResult {
  id: string;
  audienceCount: number;
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
}

/** One row of the send history. Timestamps are Unix milliseconds. */
export interface BroadcastHistoryItem {
  id: string;
  scopeType: MarketingBroadcastScope;
  scopeId: string;
  title: string;
  body: string;
  url: string | null;
  sentBy: string | null;
  audienceCount: number;
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: number;
  completedAt: number | null;
}

export interface BroadcastPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface BroadcastListResult {
  broadcasts: BroadcastHistoryItem[];
  pagination: BroadcastPagination;
}

export interface BroadcastListParams {
  page?: number;
  /** Server ceiling is 50. */
  limit?: number;
}

function toQuery(params: BroadcastListParams): Record<string, number> {
  const query: Record<string, number> = {};
  if (params.page !== undefined) query.page = params.page;
  if (params.limit !== undefined) query.limit = params.limit;
  return query;
}

/**
 * Drop an unset or blank `url` rather than sending it.
 *
 * The server's schema is `min(1)` on a trimmed string, so `url: ""` is a 400
 * rather than "no link" — an empty input field must not reach the wire.
 */
function toRestaurantBody(input: SendBroadcastInput) {
  const body: Record<string, unknown> = {
    title: input.title,
    body: input.body,
    includeMarketFollowers: input.includeMarketFollowers ?? false,
  };
  if (input.url) body.url = input.url;
  return body;
}

/** Same, minus the flag the market route refuses to forward. */
function toMarketBody(input: SendBroadcastInput) {
  const body: Record<string, unknown> = {
    title: input.title,
    body: input.body,
  };
  if (input.url) body.url = input.url;
  return body;
}

function restaurantPath(restaurantId: string): string {
  return `/restaurants/${encodeURIComponent(restaurantId)}/broadcasts`;
}

function marketPath(marketId: string): string {
  return `/markets/${encodeURIComponent(marketId)}/broadcasts`;
}

export const broadcastsService = {
  /** POST /api/v1/restaurants/:restaurantId/broadcasts */
  async send(
    restaurantId: string,
    input: SendBroadcastInput,
  ): Promise<SendBroadcastResult> {
    const response = await api.post<SendBroadcastResult>(
      restaurantPath(restaurantId),
      toRestaurantBody(input),
    );
    return unwrapApiPayload<SendBroadcastResult>(response.data);
  },

  /** GET /api/v1/restaurants/:restaurantId/broadcasts — newest first. */
  async list(
    restaurantId: string,
    params: BroadcastListParams = {},
  ): Promise<BroadcastListResult> {
    const response = await api.get<BroadcastListResult>(
      restaurantPath(restaurantId),
      toQuery(params),
    );
    return unwrapApiPayload<BroadcastListResult>(response.data);
  },

  /** POST /api/v1/markets/:marketId/broadcasts — platform admin only. */
  async sendToMarket(
    marketId: string,
    input: SendBroadcastInput,
  ): Promise<SendBroadcastResult> {
    const response = await api.post<SendBroadcastResult>(
      marketPath(marketId),
      toMarketBody(input),
    );
    return unwrapApiPayload<SendBroadcastResult>(response.data);
  },

  /** GET /api/v1/markets/:marketId/broadcasts — newest first. */
  async listForMarket(
    marketId: string,
    params: BroadcastListParams = {},
  ): Promise<BroadcastListResult> {
    const response = await api.get<BroadcastListResult>(
      marketPath(marketId),
      toQuery(params),
    );
    return unwrapApiPayload<BroadcastListResult>(response.data);
  },
};
