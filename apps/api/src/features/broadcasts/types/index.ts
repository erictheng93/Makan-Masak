import type { MarketingBroadcastScope } from "@makanmasak/shared-types";

/** What a route hands the service. `nowMs` is a test seam, not a request field. */
export interface SendBroadcastCommand {
  scopeType: MarketingBroadcastScope;
  scopeId: string;
  sentBy: string;
  title: string;
  body: string;
  url?: string;
  /** Restaurant scope only; the market route never sets it. */
  includeMarketFollowers?: boolean;
  nowMs?: number;
}

/** The 201 body of a send. */
export interface BroadcastResult {
  id: string;
  audienceCount: number;
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
}

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

export interface BroadcastHistory {
  broadcasts: BroadcastHistoryItem[];
  pagination: BroadcastPagination;
}
