import { drizzle } from "drizzle-orm/d1";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  customers,
  menuItems,
  orderItems,
  orders,
  restaurants,
  reviews,
} from "@makanmasak/database";
import { ApiError, badRequest } from "../../../shared/utils/api-error";
import type {
  OrderReviewView,
  OwnerReviewView,
  PublicReviewView,
  ReviewItemRating,
  ReviewListFilters,
  ReviewPagination,
  ReviewSummary,
  ReviewableOrder,
  SubmitOrderReviewData,
} from "../types";

/**
 * An order may be reviewed once it has reached the diner. `cancelled` and
 * `refunded` are terminal in the other direction and never become reviewable;
 * everything earlier may still get there, which is why both answer the same
 * 409 with the current status in `details` — the client needs to tell "come
 * back later" from "never".
 */
const REVIEWABLE_ORDER_STATUSES = new Set(["delivered", "paid"]);

type ReviewRow = typeof reviews.$inferSelect;

function toMs(value: Date | number | null): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : value;
}

/**
 * "王小明" -> "王**". The public list needs something to attribute a review to
 * without handing out the diner's name; a fixed-width tail keeps the mask from
 * leaking the length as well.
 */
export function maskDisplayName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return `${[...trimmed][0]}**`;
}

export class ReviewService {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(private readonly d1: D1Database) {
    this.db = drizzle(d1);
  }

  // ───────────────────────── aggregate recompute ─────────────────────────

  /**
   * Recompute `restaurants.rating` / `review_count` from the reviews table.
   *
   * Stated as a full recompute rather than an increment so it is idempotent:
   * replaying it after a partially-applied batch, or running it twice for the
   * same review, converges on the same numbers. Only order-level rows
   * (`menu_item_id IS NULL`) count toward a restaurant's rating — the per-item
   * rows would otherwise let a ten-dish order outvote a one-dish order.
   */
  private restaurantAggregateUpdate(restaurantId: string): BatchItem<"sqlite"> {
    return this.db
      .update(restaurants)
      .set({
        rating: sql`COALESCE((SELECT ROUND(AVG(${reviews.rating}), 2) FROM ${reviews}
          WHERE ${reviews.restaurantId} = ${restaurantId}
            AND ${reviews.menuItemId} IS NULL), 0)`,
        reviewCount: sql`(SELECT COUNT(*) FROM ${reviews}
          WHERE ${reviews.restaurantId} = ${restaurantId}
            AND ${reviews.menuItemId} IS NULL)`,
      })
      .where(eq(restaurants.id, restaurantId)) as BatchItem<"sqlite">;
  }

  /** The same recompute for one dish. See `restaurantAggregateUpdate`. */
  private menuItemAggregateUpdate(menuItemId: number): BatchItem<"sqlite"> {
    return this.db
      .update(menuItems)
      .set({
        rating: sql`COALESCE((SELECT ROUND(AVG(${reviews.rating}), 2) FROM ${reviews}
          WHERE ${reviews.menuItemId} = ${menuItemId}), 0)`,
        reviewCount: sql`(SELECT COUNT(*) FROM ${reviews}
          WHERE ${reviews.menuItemId} = ${menuItemId})`,
      })
      .where(eq(menuItems.id, menuItemId)) as BatchItem<"sqlite">;
  }

  // ───────────────────────────── diner writes ─────────────────────────────

  /**
   * Resolve the legacy `itemRatings[].orderItemId` shape to `menuItemId`, and
   * reject any id that is not on this order.
   *
   * Both halves matter: the order id is authorised by the route, but the item
   * ids are caller-controlled integers from a global autoincrement sequence,
   * so an unscoped write here would let one diner rate another restaurant's
   * dish — and move that restaurant's aggregate.
   */
  async resolveOrderItems(
    orderId: string,
    input: {
      items?: Array<{ menuItemId: number; rating: number }>;
      itemRatings?: Array<{ orderItemId: number; rating: number }>;
    },
  ): Promise<Array<{ menuItemId: number; rating: number }>> {
    const items = input.items ?? [];
    const legacy = input.itemRatings ?? [];
    if (items.length === 0 && legacy.length === 0) return [];

    const rows = await this.db
      .select({
        orderItemId: orderItems.id,
        menuItemId: orderItems.menuItemId,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const menuItemIds = new Set(rows.map((row) => row.menuItemId));
    const byOrderItemId = new Map(
      rows.map((row) => [row.orderItemId, row.menuItemId]),
    );

    const resolved: Array<{ menuItemId: number; rating: number }> = [];
    const seen = new Set<number>();

    const push = (menuItemId: number, rating: number, offending: unknown) => {
      if (seen.has(menuItemId)) {
        throw badRequest(
          "The same menu item was rated more than once",
          "REVIEW_ITEM_DUPLICATE",
          { menuItemId, ...(offending as object) },
        );
      }
      seen.add(menuItemId);
      resolved.push({ menuItemId, rating });
    };

    for (const item of items) {
      if (!menuItemIds.has(item.menuItemId)) {
        throw badRequest(
          "Menu item is not part of this order",
          "REVIEW_ITEM_NOT_IN_ORDER",
          { menuItemId: item.menuItemId },
        );
      }
      push(item.menuItemId, item.rating, {});
    }

    for (const item of legacy) {
      const menuItemId = byOrderItemId.get(item.orderItemId);
      if (menuItemId === undefined) {
        throw badRequest(
          "Order item is not part of this order",
          "REVIEW_ITEM_NOT_IN_ORDER",
          { orderItemId: item.orderItemId, menuItemId: null },
        );
      }
      push(menuItemId, item.rating, { orderItemId: item.orderItemId });
    }

    return resolved;
  }

  /**
   * Write the order-level review, its per-item rows, and every aggregate the
   * two move — in one `db.batch`.
   *
   * The aggregates are recomputed inside the same batch as the insert on
   * purpose. A rating written now and averaged by a later job is a window in
   * which the restaurant page and the reviews list disagree, and the job is
   * one more thing that can silently stop running.
   */
  async submitOrderReview(
    order: ReviewableOrder,
    data: SubmitOrderReviewData,
  ): Promise<OrderReviewView> {
    this.assertReviewable(order);

    const existing = await this.db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.orderId, order.id), isNull(reviews.menuItemId)))
      .limit(1);

    if (existing.length > 0) {
      throw new ApiError(
        "REVIEW_ALREADY_EXISTS",
        "This order has already been reviewed",
        409,
      );
    }

    const now = new Date();
    const writes: BatchItem<"sqlite">[] = [
      this.db.insert(reviews).values({
        restaurantId: order.restaurantId,
        orderId: order.id,
        menuItemId: null,
        customerId: data.customerId,
        rating: data.rating,
        content: data.content,
        createdAt: now,
        updatedAt: now,
      }) as BatchItem<"sqlite">,
    ];

    if (data.items.length > 0) {
      writes.push(
        this.db.insert(reviews).values(
          data.items.map((item) => ({
            restaurantId: order.restaurantId,
            orderId: order.id,
            menuItemId: item.menuItemId,
            customerId: data.customerId,
            rating: item.rating,
            content: null,
            createdAt: now,
            updatedAt: now,
          })),
        ) as BatchItem<"sqlite">,
      );
    }

    // The order keeps its own copy so order history renders without a join,
    // and so `orders.rating` — a baseline column nothing wrote — finally means
    // something.
    writes.push(
      this.db
        .update(orders)
        .set({
          rating: data.rating,
          reviewComment: data.content,
          reviewedAt: now,
        })
        .where(eq(orders.id, order.id)) as BatchItem<"sqlite">,
    );

    writes.push(this.restaurantAggregateUpdate(order.restaurantId));
    for (const item of data.items) {
      writes.push(this.menuItemAggregateUpdate(item.menuItemId));
    }

    await this.db.batch(
      writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );

    const view = await this.getOrderReview(order.id);
    if (!view) {
      throw new ApiError(
        "REVIEW_WRITE_FAILED",
        "Review could not be read back after writing",
        500,
      );
    }
    return view;
  }

  private assertReviewable(order: ReviewableOrder): void {
    if (!REVIEWABLE_ORDER_STATUSES.has(String(order.status).toLowerCase())) {
      throw new ApiError(
        "ORDER_NOT_REVIEWABLE",
        "Only a completed order can be reviewed",
        409,
        { status: order.status },
      );
    }
  }

  // ───────────────────────────── diner reads ─────────────────────────────

  async getOrderReview(orderId: string): Promise<OrderReviewView | null> {
    const rows = await this.db
      .select()
      .from(reviews)
      .where(eq(reviews.orderId, orderId))
      .orderBy(asc(reviews.menuItemId));

    const orderLevel = rows.find((row) => row.menuItemId === null);
    if (!orderLevel) return null;

    const itemRows = rows.filter((row) => row.menuItemId !== null);
    return {
      ...this.toOrderReviewView(orderLevel),
      items: await this.decorateItems(itemRows),
    };
  }

  // ───────────────────────────── owner reads ─────────────────────────────

  async listRestaurantReviews(
    restaurantId: string,
    filters: ReviewListFilters,
  ): Promise<{ reviews: OwnerReviewView[]; pagination: ReviewPagination }> {
    const where = this.buildListWhere(restaurantId, filters);

    const [{ total }] = await this.db
      .select({ total: sql<number>`COUNT(*)` })
      .from(reviews)
      .where(where);

    const rows = await this.db
      .select({
        review: reviews,
        orderNumber: orders.orderNumber,
        customerName: customers.displayName,
      })
      .from(reviews)
      .leftJoin(orders, eq(reviews.orderId, orders.id))
      .leftJoin(customers, eq(reviews.customerId, customers.id))
      .where(where)
      .orderBy(desc(reviews.createdAt))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);

    const itemsByOrderId = await this.loadItemRatings(
      rows.map((row) => row.review.orderId),
    );

    return {
      reviews: rows.map((row) => ({
        ...this.toOrderReviewView(row.review),
        orderNumber: row.orderNumber ?? null,
        customerId: row.review.customerId,
        customerName: row.customerName ?? null,
        items: itemsByOrderId.get(row.review.orderId) ?? [],
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total: Number(total ?? 0),
        totalPages: Math.ceil(Number(total ?? 0) / filters.limit),
      },
    };
  }

  async getRestaurantSummary(restaurantId: string): Promise<ReviewSummary> {
    const scope = and(
      eq(reviews.restaurantId, restaurantId),
      isNull(reviews.menuItemId),
    );

    const [row] = await this.db
      .select({
        count: sql<number>`COUNT(*)`,
        average: sql<number | null>`ROUND(AVG(${reviews.rating}), 2)`,
        one: sql<number>`SUM(CASE WHEN ${reviews.rating} = 1 THEN 1 ELSE 0 END)`,
        two: sql<number>`SUM(CASE WHEN ${reviews.rating} = 2 THEN 1 ELSE 0 END)`,
        three: sql<number>`SUM(CASE WHEN ${reviews.rating} = 3 THEN 1 ELSE 0 END)`,
        four: sql<number>`SUM(CASE WHEN ${reviews.rating} = 4 THEN 1 ELSE 0 END)`,
        five: sql<number>`SUM(CASE WHEN ${reviews.rating} = 5 THEN 1 ELSE 0 END)`,
        unreplied: sql<number>`SUM(CASE WHEN ${reviews.replyContent} IS NULL THEN 1 ELSE 0 END)`,
      })
      .from(reviews)
      .where(scope);

    return {
      average: Number(row?.average ?? 0),
      count: Number(row?.count ?? 0),
      distribution: {
        "1": Number(row?.one ?? 0),
        "2": Number(row?.two ?? 0),
        "3": Number(row?.three ?? 0),
        "4": Number(row?.four ?? 0),
        "5": Number(row?.five ?? 0),
      },
      unrepliedCount: Number(row?.unreplied ?? 0),
    };
  }

  /**
   * Attach an owner reply.
   *
   * Scoped by `(id, restaurant_id, menu_item_id IS NULL)` rather than id alone:
   * the route proves the caller owns the restaurant in the path, but the review
   * id is a second caller-controlled identifier the route cannot check.
   * Returns null for a miss so the route can answer 404 — "not yours" and "does
   * not exist" must look the same from outside.
   */
  async replyToReview(
    restaurantId: string,
    reviewId: string,
    userId: string,
    content: string,
  ): Promise<OwnerReviewView | null> {
    const now = new Date();
    const updated = await this.db
      .update(reviews)
      .set({
        replyContent: content,
        repliedBy: userId,
        repliedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(reviews.id, reviewId),
          eq(reviews.restaurantId, restaurantId),
          isNull(reviews.menuItemId),
        ),
      )
      .returning();

    const row = updated[0];
    if (!row) return null;

    const [context] = await this.db
      .select({
        orderNumber: orders.orderNumber,
        customerName: customers.displayName,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(eq(orders.id, row.orderId))
      .limit(1);

    const itemsByOrderId = await this.loadItemRatings([row.orderId]);

    return {
      ...this.toOrderReviewView(row),
      orderNumber: context?.orderNumber ?? null,
      customerId: row.customerId,
      customerName: context?.customerName ?? null,
      items: itemsByOrderId.get(row.orderId) ?? [],
    };
  }

  // ───────────────────────────── public reads ─────────────────────────────

  /**
   * The restaurant page's review list. Deliberately the narrowest projection
   * in this service: order-level rows only, no customer id, no order id, no
   * replier — a diner reading a restaurant page has no business learning who
   * ordered what.
   */
  async listPublicReviews(
    restaurantId: string,
    page: number,
    limit: number,
  ): Promise<{ reviews: PublicReviewView[]; pagination: ReviewPagination }> {
    const where = and(
      eq(reviews.restaurantId, restaurantId),
      isNull(reviews.menuItemId),
    );

    const [{ total }] = await this.db
      .select({ total: sql<number>`COUNT(*)` })
      .from(reviews)
      .where(where);

    const rows = await this.db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        content: reviews.content,
        createdAt: reviews.createdAt,
        replyContent: reviews.replyContent,
        repliedAt: reviews.repliedAt,
        customerName: customers.displayName,
      })
      .from(reviews)
      .leftJoin(customers, eq(reviews.customerId, customers.id))
      .where(where)
      .orderBy(desc(reviews.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      reviews: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        content: row.content,
        createdAt: toMs(row.createdAt) ?? 0,
        authorName: maskDisplayName(row.customerName),
        reply: row.replyContent
          ? { content: row.replyContent, repliedAt: toMs(row.repliedAt) }
          : null,
      })),
      pagination: {
        page,
        limit,
        total: Number(total ?? 0),
        totalPages: Math.ceil(Number(total ?? 0) / limit),
      },
    };
  }

  // ──────────────────────────────── shared ────────────────────────────────

  private buildListWhere(restaurantId: string, filters: ReviewListFilters) {
    const conditions = [
      eq(reviews.restaurantId, restaurantId),
      isNull(reviews.menuItemId),
    ];

    if (filters.rating !== undefined) {
      conditions.push(eq(reviews.rating, filters.rating));
    }
    if (filters.replied === true) {
      conditions.push(isNotNull(reviews.replyContent));
    }
    if (filters.replied === false) {
      conditions.push(isNull(reviews.replyContent));
    }
    if (filters.from !== undefined) {
      conditions.push(gte(reviews.createdAt, new Date(filters.from)));
    }
    if (filters.to !== undefined) {
      conditions.push(lte(reviews.createdAt, new Date(filters.to)));
    }

    return and(...conditions);
  }

  private toOrderReviewView(row: ReviewRow): OrderReviewView {
    return {
      id: row.id,
      orderId: row.orderId,
      restaurantId: row.restaurantId,
      rating: row.rating,
      content: row.content,
      createdAt: toMs(row.createdAt) ?? 0,
      updatedAt: toMs(row.updatedAt) ?? 0,
      reply: row.replyContent
        ? {
            content: row.replyContent,
            repliedBy: row.repliedBy,
            repliedAt: toMs(row.repliedAt),
          }
        : null,
      items: [],
    };
  }

  private async loadItemRatings(
    orderIds: string[],
  ): Promise<Map<string, ReviewItemRating[]>> {
    const grouped = new Map<string, ReviewItemRating[]>();
    if (orderIds.length === 0) return grouped;

    const rows = await this.db
      .select({
        orderId: reviews.orderId,
        menuItemId: reviews.menuItemId,
        rating: reviews.rating,
        menuItemName: menuItems.name,
      })
      .from(reviews)
      .leftJoin(menuItems, eq(reviews.menuItemId, menuItems.id))
      .where(
        and(
          inArray(reviews.orderId, [...new Set(orderIds)]),
          isNotNull(reviews.menuItemId),
        ),
      )
      .orderBy(asc(reviews.menuItemId));

    for (const row of rows) {
      if (row.menuItemId === null) continue;
      const bucket = grouped.get(row.orderId) ?? [];
      bucket.push({
        menuItemId: row.menuItemId,
        menuItemName: row.menuItemName ?? null,
        rating: row.rating,
      });
      grouped.set(row.orderId, bucket);
    }

    return grouped;
  }

  private async decorateItems(rows: ReviewRow[]): Promise<ReviewItemRating[]> {
    if (rows.length === 0) return [];
    const ids = rows
      .map((row) => row.menuItemId)
      .filter((id): id is number => id !== null);

    const names = await this.db
      .select({ id: menuItems.id, name: menuItems.name })
      .from(menuItems)
      .where(inArray(menuItems.id, ids));
    const nameById = new Map(names.map((row) => [row.id, row.name]));

    return rows.flatMap((row) =>
      row.menuItemId === null
        ? []
        : [
            {
              menuItemId: row.menuItemId,
              menuItemName: nameById.get(row.menuItemId) ?? null,
              rating: row.rating,
            },
          ],
    );
  }
}
