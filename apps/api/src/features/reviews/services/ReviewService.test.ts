import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { customers, orders, reviews } from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  buildSeedHelpers,
  type SeedHelpers,
} from "../../../__tests__/integration/helpers/seed-helper";
import { maskDisplayName, ReviewService } from "./ReviewService";
import type { ReviewableOrder } from "../types";

/**
 * `maskDisplayName` is the one piece of this service that is pure string
 * handling, so it is tested on its own.
 */
describe("maskDisplayName", () => {
  it("keeps the first character and hides the rest at a fixed width", () => {
    expect(maskDisplayName("王小明")).toBe("王**");
    // Fixed width on purpose: a mask whose length tracks the value leaks it.
    expect(maskDisplayName("Alexandra")).toBe("A**");
  });

  it("counts by code point, not UTF-16 unit", () => {
    expect(maskDisplayName("😀顧客")).toBe("😀**");
  });

  it("returns null when there is nothing to attribute", () => {
    expect(maskDisplayName(null)).toBeNull();
    expect(maskDisplayName(undefined)).toBeNull();
    expect(maskDisplayName("")).toBeNull();
    expect(maskDisplayName("   ")).toBeNull();
  });
});

/**
 * The rest of ReviewService is SQL, so it is exercised against a real (in
 * memory, miniflare) D1 applied from `migrations_fresh` — the same harness
 * `packages/database`'s own service tests use, and the same reason: a mocked
 * drizzle cannot tell a correctly scoped aggregate from an unscoped one, nor a
 * partial unique index from none at all.
 *
 * This lives in the default unit project rather than beside
 * `src/__tests__/integration/reviews.real.integration.test.ts` on purpose.
 * That suite runs under `vitest.real-integration.config.ts`, which is a
 * separate project contributing nothing to the `apps/api/src/features/**`
 * coverage gate, so every line it proved still read as untested (#286 took the
 * gate to 89.32% statements / 77.4% branches against 90/78). The two are not
 * duplicates: the integration suite drives whole HTTP requests through the
 * app factory with real JWTs and asserts the published contract schemas; this
 * one calls the service directly and covers the argument-shape and
 * empty/filter branches that a request-level test cannot reach cheaply.
 */
describe("ReviewService against real D1", () => {
  let testDb: TestDatabase;
  let seed: SeedHelpers;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    seed = buildSeedHelpers(testDb);
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  const service = () => new ReviewService(testDb.bindings.DB);

  // ───────────────────────────── seed helpers ─────────────────────────────

  async function addOrderItem(
    orderId: string,
    menuItemId: number,
  ): Promise<number> {
    const now = Date.now();
    const row = await testDb.bindings.DB.prepare(
      `INSERT INTO order_items
         (order_id, menu_item_id, quantity, unit_price_cents, total_price_cents,
          status, created_at_ms, updated_at_ms)
       VALUES (?, ?, 1, 12000, 12000, 'pending', ?, ?)
       RETURNING id`,
    )
      .bind(orderId, menuItemId, now, now)
      .first<{ id: number }>();
    if (!row) throw new Error("failed to seed order_items row");
    return row.id;
  }

  async function addCustomer(displayName: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date();
    await testDb.drizzle.insert(customers).values({
      id,
      displayName,
      primaryPhone: `+8869${Math.floor(10000000 + Math.random() * 89999999)}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async function addReview(
    values: Omit<typeof reviews.$inferInsert, "createdAt" | "updatedAt"> & {
      createdAt?: Date;
      updatedAt?: Date;
    },
  ) {
    const now = new Date();
    const [row] = await testDb.drizzle
      .insert(reviews)
      .values({ createdAt: now, updatedAt: now, ...values })
      .returning();
    return row;
  }

  /** A delivered order with two dishes on it, plus its restaurant. */
  async function deliveredOrder(
    options: { status?: string; customerId?: string | null } = {},
  ) {
    const restaurant = await seed.restaurant();
    const itemA = await seed.menuItem(restaurant.id, { name: "招牌牛肉麵" });
    const itemB = await seed.menuItem(restaurant.id, { name: "小菜拼盤" });
    const order = await seed.order(restaurant.id, {
      status: options.status ?? "delivered",
      customerId: options.customerId ?? null,
      deliveredAt: new Date(),
    });
    const orderItemA = await addOrderItem(order.id, itemA.id);
    const orderItemB = await addOrderItem(order.id, itemB.id);

    const reviewable: ReviewableOrder = {
      id: order.id,
      restaurantId: restaurant.id,
      status: options.status ?? "delivered",
      customerId: options.customerId ?? null,
    };
    return {
      restaurant,
      itemA,
      itemB,
      order,
      orderItemA,
      orderItemB,
      reviewable,
    };
  }

  async function readRestaurantAggregate(restaurantId: string) {
    return testDb.bindings.DB.prepare(
      `SELECT rating, review_count FROM restaurants WHERE id = ?`,
    )
      .bind(restaurantId)
      .first<{ rating: number | null; review_count: number }>();
  }

  async function readMenuItemAggregate(menuItemId: number) {
    return testDb.bindings.DB.prepare(
      `SELECT rating, review_count FROM menu_items WHERE id = ?`,
    )
      .bind(menuItemId)
      .first<{ rating: number | null; review_count: number }>();
  }

  // ──────────────────────────── resolveOrderItems ────────────────────────────

  describe("resolveOrderItems", () => {
    it("returns nothing, and reads no rows, when neither item shape is sent", async () => {
      const { order } = await deliveredOrder();

      // Both shapes absent exercises the `?? []` defaults and the early
      // return — an order with no item ratings must not pay for a query.
      await expect(service().resolveOrderItems(order.id, {})).resolves.toEqual(
        [],
      );
      await expect(
        service().resolveOrderItems(order.id, { items: [], itemRatings: [] }),
      ).resolves.toEqual([]);
    });

    it("accepts menu item ids that are on the order", async () => {
      const { order, itemA, itemB } = await deliveredOrder();

      await expect(
        service().resolveOrderItems(order.id, {
          items: [
            { menuItemId: itemA.id, rating: 5 },
            { menuItemId: itemB.id, rating: 3 },
          ],
        }),
      ).resolves.toEqual([
        { menuItemId: itemA.id, rating: 5 },
        { menuItemId: itemB.id, rating: 3 },
      ]);
    });

    it("rejects a menu item that belongs to someone else's order", async () => {
      const { order } = await deliveredOrder();
      const other = await deliveredOrder();

      // The order id was authorised by the route; the item id was not. An
      // unscoped write here would move another restaurant's aggregate.
      await expect(
        service().resolveOrderItems(order.id, {
          items: [{ menuItemId: other.itemA.id, rating: 5 }],
        }),
      ).rejects.toMatchObject({
        code: "REVIEW_ITEM_NOT_IN_ORDER",
        status: 400,
        details: { menuItemId: other.itemA.id },
      });
    });

    it("rejects the same dish rated twice", async () => {
      const { order, itemA } = await deliveredOrder();

      await expect(
        service().resolveOrderItems(order.id, {
          items: [
            { menuItemId: itemA.id, rating: 5 },
            { menuItemId: itemA.id, rating: 1 },
          ],
        }),
      ).rejects.toMatchObject({
        code: "REVIEW_ITEM_DUPLICATE",
        status: 400,
        details: { menuItemId: itemA.id },
      });
    });

    it("resolves the legacy orderItemId shape to its menu item", async () => {
      const { order, itemA, itemB, orderItemA, orderItemB } =
        await deliveredOrder();

      await expect(
        service().resolveOrderItems(order.id, {
          itemRatings: [
            { orderItemId: orderItemA, rating: 4 },
            { orderItemId: orderItemB, rating: 2 },
          ],
        }),
      ).resolves.toEqual([
        { menuItemId: itemA.id, rating: 4 },
        { menuItemId: itemB.id, rating: 2 },
      ]);
    });

    it("rejects a legacy order item id that is not on this order, and says so", async () => {
      const { order } = await deliveredOrder();
      const other = await deliveredOrder();

      await expect(
        service().resolveOrderItems(order.id, {
          itemRatings: [{ orderItemId: other.orderItemA, rating: 4 }],
        }),
      ).rejects.toMatchObject({
        code: "REVIEW_ITEM_NOT_IN_ORDER",
        details: { orderItemId: other.orderItemA, menuItemId: null },
      });
    });

    it("rejects two order items that resolve to the same dish", async () => {
      const { order, itemA } = await deliveredOrder();
      // Same dish ordered twice: two order_items rows, one menu item. The
      // aggregate hangs off menu_items.id, so this must collapse to an error
      // rather than two votes.
      const secondLine = await addOrderItem(order.id, itemA.id);

      await expect(
        service().resolveOrderItems(order.id, {
          itemRatings: [
            { orderItemId: secondLine, rating: 5 },
            { orderItemId: secondLine, rating: 1 },
          ],
        }),
      ).rejects.toMatchObject({
        code: "REVIEW_ITEM_DUPLICATE",
        details: { menuItemId: itemA.id, orderItemId: secondLine },
      });
    });
  });

  // ──────────────────────────── submitOrderReview ────────────────────────────

  describe("submitOrderReview", () => {
    it("writes the order-level row, the item rows, the order stamp and every aggregate in one batch", async () => {
      const { reviewable, restaurant, order, itemA, itemB } =
        await deliveredOrder();
      const customerId = await addCustomer("王小明");

      const view = await service().submitOrderReview(reviewable, {
        rating: 4,
        content: "上菜很快",
        items: [
          { menuItemId: itemA.id, rating: 5 },
          { menuItemId: itemB.id, rating: 3 },
        ],
        customerId,
      });

      expect(view).toMatchObject({
        orderId: order.id,
        restaurantId: restaurant.id,
        rating: 4,
        content: "上菜很快",
        reply: null,
      });
      expect(view.createdAt).toEqual(expect.any(Number));
      expect(view.updatedAt).toEqual(expect.any(Number));
      expect(view.items).toEqual([
        { menuItemId: itemA.id, menuItemName: "招牌牛肉麵", rating: 5 },
        { menuItemId: itemB.id, menuItemName: "小菜拼盤", rating: 3 },
      ]);

      // The restaurant aggregate counts order-level rows only: a two-dish
      // order must not vote three times.
      await expect(readRestaurantAggregate(restaurant.id)).resolves.toEqual(
        expect.objectContaining({ rating: 4, review_count: 1 }),
      );
      await expect(readMenuItemAggregate(itemA.id)).resolves.toEqual(
        expect.objectContaining({ rating: 5, review_count: 1 }),
      );
      await expect(readMenuItemAggregate(itemB.id)).resolves.toEqual(
        expect.objectContaining({ rating: 3, review_count: 1 }),
      );

      const [orderRow] = await testDb.drizzle
        .select({
          rating: orders.rating,
          reviewComment: orders.reviewComment,
          reviewedAt: orders.reviewedAt,
        })
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(orderRow).toMatchObject({ rating: 4, reviewComment: "上菜很快" });
      expect(orderRow.reviewedAt).toBeInstanceOf(Date);
    });

    it("writes only the order-level row when no dish was rated", async () => {
      const { reviewable, restaurant, order } = await deliveredOrder();

      const view = await service().submitOrderReview(reviewable, {
        rating: 5,
        content: null,
        items: [],
        customerId: null,
      });

      expect(view.items).toEqual([]);
      expect(view.content).toBeNull();

      const rows = await testDb.drizzle
        .select()
        .from(reviews)
        .where(eq(reviews.orderId, order.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].customerId).toBeNull();
      await expect(readRestaurantAggregate(restaurant.id)).resolves.toEqual(
        expect.objectContaining({ rating: 5, review_count: 1 }),
      );
    });

    it("averages across orders rather than replacing the previous rating", async () => {
      const restaurant = await seed.restaurant();
      const first = await seed.order(restaurant.id, { status: "delivered" });
      const second = await seed.order(restaurant.id, { status: "paid" });

      const base = { content: null, items: [], customerId: null };
      await service().submitOrderReview(
        {
          id: first.id,
          restaurantId: restaurant.id,
          status: "delivered",
          customerId: null,
        },
        { ...base, rating: 5 },
      );
      await service().submitOrderReview(
        {
          id: second.id,
          restaurantId: restaurant.id,
          status: "paid",
          customerId: null,
        },
        { ...base, rating: 2 },
      );

      await expect(readRestaurantAggregate(restaurant.id)).resolves.toEqual(
        expect.objectContaining({ rating: 3.5, review_count: 2 }),
      );
    });

    it("refuses a second review of the same order", async () => {
      const { reviewable, restaurant } = await deliveredOrder();
      const body = {
        rating: 5,
        content: null,
        items: [],
        customerId: null,
      };

      await service().submitOrderReview(reviewable, body);
      const before = await readRestaurantAggregate(restaurant.id);

      await expect(
        service().submitOrderReview(reviewable, { ...body, rating: 1 }),
      ).rejects.toMatchObject({
        code: "REVIEW_ALREADY_EXISTS",
        status: 409,
      });

      // The duplicate must not have moved the aggregate on its way out.
      await expect(readRestaurantAggregate(restaurant.id)).resolves.toEqual(
        before,
      );
    });

    it.each(["pending", "preparing", "cancelled", "refunded"])(
      "refuses status %s and names it, so the client can tell 'later' from 'never'",
      async (status) => {
        const { reviewable } = await deliveredOrder({ status });

        await expect(
          service().submitOrderReview(reviewable, {
            rating: 5,
            content: null,
            items: [],
            customerId: null,
          }),
        ).rejects.toMatchObject({
          code: "ORDER_NOT_REVIEWABLE",
          status: 409,
          details: { status },
        });
      },
    );

    it("accepts a reviewable status whatever its casing", async () => {
      const { reviewable } = await deliveredOrder({ status: "delivered" });

      await expect(
        service().submitOrderReview(
          { ...reviewable, status: "DELIVERED" },
          { rating: 5, content: null, items: [], customerId: null },
        ),
      ).resolves.toMatchObject({ rating: 5 });
    });

    it("fails loudly when the review cannot be read back after writing", async () => {
      const { reviewable } = await deliveredOrder();
      const subject = service();
      // A write that reports success but returns nothing is the one failure
      // mode a caller cannot distinguish from "no review"; it must not answer
      // 2xx with an empty body.
      const readBack = vi
        .spyOn(subject, "getOrderReview")
        .mockResolvedValue(null);

      await expect(
        subject.submitOrderReview(reviewable, {
          rating: 5,
          content: null,
          items: [],
          customerId: null,
        }),
      ).rejects.toMatchObject({ code: "REVIEW_WRITE_FAILED", status: 500 });
      expect(readBack).toHaveBeenCalledWith(reviewable.id);
    });
  });

  // ───────────────────────────── getOrderReview ─────────────────────────────

  describe("getOrderReview", () => {
    it("returns null for an order nobody has reviewed", async () => {
      const { order } = await deliveredOrder();
      await expect(service().getOrderReview(order.id)).resolves.toBeNull();
    });

    it("returns null when only item rows exist, because the order-level row is the review", async () => {
      const { order, restaurant, itemA } = await deliveredOrder();
      await addReview({
        restaurantId: restaurant.id,
        orderId: order.id,
        menuItemId: itemA.id,
        rating: 5,
      });

      await expect(service().getOrderReview(order.id)).resolves.toBeNull();
    });

    it("returns the review with its owner reply and dish names", async () => {
      const { order, restaurant, itemA } = await deliveredOrder();
      const owner = await seed.user({ role: 1, restaurantId: restaurant.id });
      const repliedAt = new Date(1_760_000_000_000);
      await addReview({
        restaurantId: restaurant.id,
        orderId: order.id,
        menuItemId: null,
        rating: 4,
        content: "不錯",
        replyContent: "謝謝光臨",
        repliedBy: owner.id,
        repliedAt,
      });
      await addReview({
        restaurantId: restaurant.id,
        orderId: order.id,
        menuItemId: itemA.id,
        rating: 5,
      });

      const view = await service().getOrderReview(order.id);

      expect(view).toMatchObject({
        orderId: order.id,
        rating: 4,
        content: "不錯",
        reply: {
          content: "謝謝光臨",
          repliedBy: owner.id,
          repliedAt: repliedAt.getTime(),
        },
      });
      expect(view?.items).toEqual([
        { menuItemId: itemA.id, menuItemName: "招牌牛肉麵", rating: 5 },
      ]);
    });

    it("reports a reply whose timestamp was never stamped as null rather than 0", async () => {
      const { order, restaurant } = await deliveredOrder();
      await addReview({
        restaurantId: restaurant.id,
        orderId: order.id,
        menuItemId: null,
        rating: 3,
        content: null,
        replyContent: "已收到",
        repliedAt: null,
      });

      const view = await service().getOrderReview(order.id);
      expect(view?.reply).toEqual({
        content: "已收到",
        repliedBy: null,
        repliedAt: null,
      });
    });
  });

  // ───────────────────────── listRestaurantReviews ─────────────────────────

  describe("listRestaurantReviews", () => {
    /**
     * Four order-level reviews on one restaurant, one day apart, plus one
     * item-level row and one review belonging to a different restaurant —
     * both of which every assertion below must exclude.
     */
    async function seedList() {
      const restaurant = await seed.restaurant();
      const item = await seed.menuItem(restaurant.id, { name: "招牌牛肉麵" });
      const stranger = await seed.restaurant();
      const strangerOrder = await seed.order(stranger.id, {
        status: "delivered",
      });
      await addReview({
        restaurantId: stranger.id,
        orderId: strangerOrder.id,
        rating: 1,
      });

      const customerId = await addCustomer("王小明");
      const day = 24 * 60 * 60 * 1000;
      const base = 1_760_000_000_000;

      const seeded = [];
      for (const [index, spec] of [
        { rating: 5, replyContent: "謝謝", customerId },
        { rating: 4, replyContent: null, customerId: null },
        { rating: 3, replyContent: "改進中", customerId },
        { rating: 5, replyContent: null, customerId: null },
      ].entries()) {
        const order = await seed.order(restaurant.id, { status: "delivered" });
        const createdAt = new Date(base + index * day);
        const row = await addReview({
          restaurantId: restaurant.id,
          orderId: order.id,
          menuItemId: null,
          rating: spec.rating,
          content: `評論 ${index}`,
          replyContent: spec.replyContent,
          repliedAt: spec.replyContent ? createdAt : null,
          customerId: spec.customerId,
          createdAt,
          updatedAt: createdAt,
        });
        seeded.push({ order, row, createdAt });
      }

      // An item-level row on the newest order: it must never appear as a list
      // entry, only as an `items` member of its order-level row.
      await addReview({
        restaurantId: restaurant.id,
        orderId: seeded[3].order.id,
        menuItemId: item.id,
        rating: 2,
      });

      return { restaurant, item, seeded, customerId, base, day };
    }

    it("returns this restaurant's order-level reviews newest first, with the identity an owner is entitled to", async () => {
      const { restaurant, item, seeded, customerId } = await seedList();

      const result = await service().listRestaurantReviews(restaurant.id, {
        page: 1,
        limit: 20,
      });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 4,
        totalPages: 1,
      });
      expect(result.reviews.map((review) => review.content)).toEqual([
        "評論 3",
        "評論 2",
        "評論 1",
        "評論 0",
      ]);

      const newest = result.reviews[0];
      expect(newest).toMatchObject({
        orderId: seeded[3].order.id,
        customerId: null,
        customerName: null,
        reply: null,
      });
      expect(newest.orderNumber).toEqual(expect.any(String));
      expect(newest.items).toEqual([
        { menuItemId: item.id, menuItemName: "招牌牛肉麵", rating: 2 },
      ]);

      // The named customer is carried unmasked here — this list is the owner's.
      const attributed = result.reviews.find(
        (review) => review.content === "評論 2",
      );
      expect(attributed).toMatchObject({
        customerId,
        customerName: "王小明",
        reply: expect.objectContaining({ content: "改進中" }),
      });
      expect(attributed?.items).toEqual([]);
    });

    it("filters by rating", async () => {
      const { restaurant } = await seedList();

      const result = await service().listRestaurantReviews(restaurant.id, {
        page: 1,
        limit: 20,
        rating: 5,
      });

      expect(result.pagination.total).toBe(2);
      expect(result.reviews.map((review) => review.rating)).toEqual([5, 5]);
    });

    it("filters to replied reviews", async () => {
      const { restaurant } = await seedList();

      const result = await service().listRestaurantReviews(restaurant.id, {
        page: 1,
        limit: 20,
        replied: true,
      });

      expect(result.pagination.total).toBe(2);
      expect(result.reviews.every((review) => review.reply !== null)).toBe(
        true,
      );
    });

    it("filters to the reply backlog", async () => {
      const { restaurant } = await seedList();

      const result = await service().listRestaurantReviews(restaurant.id, {
        page: 1,
        limit: 20,
        replied: false,
      });

      expect(result.pagination.total).toBe(2);
      expect(result.reviews.every((review) => review.reply === null)).toBe(
        true,
      );
    });

    it("filters by a created-at window, inclusive at both ends", async () => {
      const { restaurant, base, day } = await seedList();

      const result = await service().listRestaurantReviews(restaurant.id, {
        page: 1,
        limit: 20,
        from: base + day,
        to: base + 2 * day,
      });

      expect(result.pagination.total).toBe(2);
      expect(result.reviews.map((review) => review.content)).toEqual([
        "評論 2",
        "評論 1",
      ]);
    });

    it("pages, and reports the page count the caller asked about", async () => {
      const { restaurant } = await seedList();

      const page2 = await service().listRestaurantReviews(restaurant.id, {
        page: 2,
        limit: 3,
      });

      expect(page2.pagination).toEqual({
        page: 2,
        limit: 3,
        total: 4,
        totalPages: 2,
      });
      expect(page2.reviews.map((review) => review.content)).toEqual(["評論 0"]);
    });

    it("returns an empty page rather than failing when nothing matches", async () => {
      const { restaurant } = await seedList();

      const result = await service().listRestaurantReviews(restaurant.id, {
        page: 1,
        limit: 20,
        rating: 1,
      });

      expect(result.reviews).toEqual([]);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });
  });

  // ───────────────────────── getRestaurantSummary ─────────────────────────

  describe("getRestaurantSummary", () => {
    it("counts order-level rows only, and reports the reply backlog", async () => {
      const restaurant = await seed.restaurant();
      const item = await seed.menuItem(restaurant.id);
      const stranger = await seed.restaurant();
      const strangerOrder = await seed.order(stranger.id, {
        status: "delivered",
      });
      await addReview({
        restaurantId: stranger.id,
        orderId: strangerOrder.id,
        rating: 1,
      });

      for (const spec of [
        { rating: 5, replyContent: "謝謝" },
        { rating: 5, replyContent: null },
        { rating: 2, replyContent: null },
      ]) {
        const order = await seed.order(restaurant.id, { status: "delivered" });
        await addReview({
          restaurantId: restaurant.id,
          orderId: order.id,
          rating: spec.rating,
          replyContent: spec.replyContent,
        });
        if (spec.rating === 2) {
          // An item-level row must not enter the distribution or the backlog.
          await addReview({
            restaurantId: restaurant.id,
            orderId: order.id,
            menuItemId: item.id,
            rating: 1,
          });
        }
      }

      await expect(
        service().getRestaurantSummary(restaurant.id),
      ).resolves.toEqual({
        average: 4,
        count: 3,
        distribution: { "1": 0, "2": 1, "3": 0, "4": 0, "5": 2 },
        unrepliedCount: 2,
      });
    });

    it("reports zeros, not nulls, for a restaurant nobody has reviewed", async () => {
      const restaurant = await seed.restaurant();

      // AVG and SUM over no rows are SQL NULL; the summary is a number in
      // every field, so the dashboard never has to render "null stars".
      await expect(
        service().getRestaurantSummary(restaurant.id),
      ).resolves.toEqual({
        average: 0,
        count: 0,
        distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
        unrepliedCount: 0,
      });
    });
  });

  // ─────────────────────────────── replyToReview ───────────────────────────────

  describe("replyToReview", () => {
    async function seedReviewToReplyTo() {
      const restaurant = await seed.restaurant();
      const item = await seed.menuItem(restaurant.id, { name: "招牌牛肉麵" });
      const customerId = await addCustomer("王小明");
      const owner = await seed.user({ role: 1, restaurantId: restaurant.id });
      const order = await seed.order(restaurant.id, {
        status: "delivered",
        customerId,
      });
      const review = await addReview({
        restaurantId: restaurant.id,
        orderId: order.id,
        menuItemId: null,
        customerId,
        rating: 4,
        content: "不錯",
      });
      const itemRow = await addReview({
        restaurantId: restaurant.id,
        orderId: order.id,
        menuItemId: item.id,
        customerId,
        rating: 5,
      });
      return { restaurant, item, order, owner, review, itemRow, customerId };
    }

    it("attaches the reply and returns the owner view", async () => {
      const { restaurant, review, owner, order, item, customerId } =
        await seedReviewToReplyTo();

      const updated = await service().replyToReview(
        restaurant.id,
        review.id,
        owner.id,
        "謝謝光臨",
      );

      expect(updated).toMatchObject({
        id: review.id,
        orderId: order.id,
        customerId,
        customerName: "王小明",
        reply: {
          content: "謝謝光臨",
          repliedBy: owner.id,
          repliedAt: expect.any(Number),
        },
      });
      expect(updated?.orderNumber).toEqual(expect.any(String));
      expect(updated?.items).toEqual([
        { menuItemId: item.id, menuItemName: "招牌牛肉麵", rating: 5 },
      ]);

      const [stored] = await testDb.drizzle
        .select()
        .from(reviews)
        .where(eq(reviews.id, review.id));
      expect(stored.replyContent).toBe("謝謝光臨");
      expect(stored.repliedBy).toBe(owner.id);
    });

    it("returns null for another restaurant's review, so the route can answer 404", async () => {
      const { review, owner } = await seedReviewToReplyTo();
      const stranger = await seed.restaurant();

      // "Not yours" and "does not exist" must look the same from outside.
      await expect(
        service().replyToReview(stranger.id, review.id, owner.id, "偷回覆"),
      ).resolves.toBeNull();

      const [stored] = await testDb.drizzle
        .select()
        .from(reviews)
        .where(eq(reviews.id, review.id));
      expect(stored.replyContent).toBeNull();
    });

    it("returns an empty item list when the diner rated no dish", async () => {
      const restaurant = await seed.restaurant();
      const owner = await seed.user({ role: 1, restaurantId: restaurant.id });
      const order = await seed.order(restaurant.id, { status: "delivered" });
      const review = await addReview({
        restaurantId: restaurant.id,
        orderId: order.id,
        menuItemId: null,
        rating: 5,
      });

      const updated = await service().replyToReview(
        restaurant.id,
        review.id,
        owner.id,
        "謝謝",
      );

      expect(updated?.items).toEqual([]);
      expect(updated?.customerId).toBeNull();
    });

    it("returns null for an unknown review id", async () => {
      const { restaurant, owner } = await seedReviewToReplyTo();

      await expect(
        service().replyToReview(
          restaurant.id,
          crypto.randomUUID(),
          owner.id,
          "回覆",
        ),
      ).resolves.toBeNull();
    });

    it("refuses to reply to a per-item row", async () => {
      const { restaurant, itemRow, owner } = await seedReviewToReplyTo();

      // Only the order-level row carries a reply; an item row is a rating.
      await expect(
        service().replyToReview(restaurant.id, itemRow.id, owner.id, "回覆"),
      ).resolves.toBeNull();
    });

    it("returns a null order number when the order has since gone", async () => {
      const { restaurant, review, owner, order } = await seedReviewToReplyTo();
      // reviews.order_id cascades, so the review would go with the order.
      // Detaching the customer instead exercises the same nullable join the
      // owner view has to tolerate.
      await testDb.drizzle
        .update(orders)
        .set({ customerId: null })
        .where(eq(orders.id, order.id));

      const updated = await service().replyToReview(
        restaurant.id,
        review.id,
        owner.id,
        "謝謝",
      );

      expect(updated?.customerName).toBeNull();
      // The review still remembers who wrote it even once the order forgot.
      expect(updated?.customerId).not.toBeNull();
    });
  });

  // ───────────────────────────── listPublicReviews ─────────────────────────────

  describe("listPublicReviews", () => {
    async function seedPublic() {
      const restaurant = await seed.restaurant();
      const item = await seed.menuItem(restaurant.id);
      const customerId = await addCustomer("王小明");
      const base = 1_760_000_000_000;
      const day = 24 * 60 * 60 * 1000;

      const rows = [];
      for (const [index, spec] of [
        { rating: 5, customerId, replyContent: "謝謝光臨" },
        { rating: 3, customerId: null, replyContent: null },
        { rating: 4, customerId, replyContent: null },
      ].entries()) {
        const order = await seed.order(restaurant.id, { status: "delivered" });
        const createdAt = new Date(base + index * day);
        rows.push(
          await addReview({
            restaurantId: restaurant.id,
            orderId: order.id,
            menuItemId: null,
            customerId: spec.customerId,
            rating: spec.rating,
            content: `公開評論 ${index}`,
            replyContent: spec.replyContent,
            repliedAt: spec.replyContent ? createdAt : null,
            createdAt,
            updatedAt: createdAt,
          }),
        );
        if (index === 0) {
          await addReview({
            restaurantId: restaurant.id,
            orderId: order.id,
            menuItemId: item.id,
            customerId: spec.customerId,
            rating: 1,
          });
        }
      }
      return { restaurant, rows, base, day };
    }

    it("masks the author and carries no customer, order or replier id", async () => {
      const { restaurant } = await seedPublic();

      const result = await service().listPublicReviews(restaurant.id, 1, 10);

      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
      expect(result.reviews.map((review) => review.content)).toEqual([
        "公開評論 2",
        "公開評論 1",
        "公開評論 0",
      ]);

      const oldest = result.reviews[2];
      expect(oldest).toEqual({
        id: expect.any(String),
        rating: 5,
        content: "公開評論 0",
        createdAt: expect.any(Number),
        authorName: "王**",
        reply: { content: "謝謝光臨", repliedAt: expect.any(Number) },
      });
      // A diner reading a restaurant page has no business learning who
      // ordered what.
      expect(Object.keys(oldest).sort()).toEqual([
        "authorName",
        "content",
        "createdAt",
        "id",
        "rating",
        "reply",
      ]);
      expect(oldest.reply).not.toHaveProperty("repliedBy");
    });

    it("attributes a guest review to nobody at all", async () => {
      const { restaurant } = await seedPublic();

      const result = await service().listPublicReviews(restaurant.id, 1, 10);
      const guestReview = result.reviews.find(
        (review) => review.content === "公開評論 1",
      );

      expect(guestReview).toMatchObject({ authorName: null, reply: null });
    });

    it("pages", async () => {
      const { restaurant } = await seedPublic();

      const page2 = await service().listPublicReviews(restaurant.id, 2, 2);

      expect(page2.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(page2.reviews.map((review) => review.content)).toEqual([
        "公開評論 0",
      ]);
    });

    it("answers an empty page for a restaurant with no reviews", async () => {
      await seedPublic();

      const result = await service().listPublicReviews(
        crypto.randomUUID(),
        1,
        10,
      );

      expect(result.reviews).toEqual([]);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it("excludes per-item rows, which carry no text and no author", async () => {
      const { restaurant } = await seedPublic();

      const result = await service().listPublicReviews(restaurant.id, 1, 10);

      expect(result.reviews).toHaveLength(3);
      expect(result.reviews.every((review) => review.content !== null)).toBe(
        true,
      );
    });
  });
});
