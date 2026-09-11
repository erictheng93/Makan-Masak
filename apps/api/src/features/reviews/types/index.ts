/** A per-item rating as it appears on a review. */
export interface ReviewItemRating {
  menuItemId: number;
  menuItemName: string | null;
  rating: number;
}

/** Owner reply attached to an order-level review. */
export interface ReviewReply {
  content: string;
  repliedBy: string | null;
  repliedAt: number | null;
}

/** What the diner who wrote the review gets back. */
export interface OrderReviewView {
  id: string;
  orderId: string;
  restaurantId: string;
  rating: number;
  content: string | null;
  createdAt: number;
  updatedAt: number;
  reply: ReviewReply | null;
  items: ReviewItemRating[];
}

/** One row of the owner list. Adds the identity the owner is entitled to. */
export interface OwnerReviewView extends OrderReviewView {
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
}

/** One row of the public list. Carries no customer identifier at all. */
export interface PublicReviewView {
  id: string;
  rating: number;
  content: string | null;
  createdAt: number;
  authorName: string | null;
  reply: Omit<ReviewReply, "repliedBy"> | null;
}

export interface ReviewPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ReviewSummary {
  average: number;
  count: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  unrepliedCount: number;
}

export interface ReviewListFilters {
  page: number;
  limit: number;
  rating?: number;
  replied?: boolean;
  from?: number;
  to?: number;
}

/**
 * The order fields the review flow needs, already resolved and authorised by
 * the route. Passing the row in rather than re-reading it keeps the service
 * from having a second, weaker opinion about which order this is.
 */
export interface ReviewableOrder {
  id: string;
  restaurantId: string;
  status: string;
  customerId: string | null;
}

export interface SubmitOrderReviewData {
  rating: number;
  content: string | null;
  items: Array<{ menuItemId: number; rating: number }>;
  customerId: string | null;
}
