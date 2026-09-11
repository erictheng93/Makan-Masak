import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sign } from "hono/jwt";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readError, readEnvelope } from "../helpers/read-json";
import { ReviewContracts, ContractHelpers } from "../../contracts";
import type { ZodType } from "zod";
import type {
  OrderReviewView,
  OwnerReviewView,
  PublicReviewView,
  ReviewPagination,
  ReviewSummary,
} from "../../features/reviews/types";

/**
 * Customer reviews, end to end against real D1 (#286).
 *
 * Real D1 rather than mocks because almost everything worth asserting here is
 * SQL: the STRICT/CHECK constraints on the new table, the two *partial* unique
 * indexes that make "one review per order" hold (a plain UNIQUE would not —
 * SQLite treats NULLs as distinct), and the aggregate recompute that runs in
 * the same batch as the insert. A mocked drizzle cannot tell a correct
 * recompute from one that silently averages the wrong rows.
 *
 * The auth paths are exercised through real tokens for the same reason: a
 * hand-rolled auth mock swallows the middleware chain, so a tenancy guard
 * would look covered while never running.
 */
describe("Reviews — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  const CSRF = "a".repeat(64);

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  // ───────────────────────────── helpers ─────────────────────────────

  function call(
    path: string,
    options: {
      token?: string;
      method?: string;
      body?: unknown;
    } = {},
  ) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": CSRF,
      cookie: `__Host-mm_csrf=${CSRF}`,
      origin: "http://localhost:3000",
    };
    if (options.token) headers.authorization = `Bearer ${options.token}`;

    return testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    );
  }

  async function addOrderItem(orderId: string, menuItemId: number) {
    const now = Date.now();
    const row = await testApp.testDb.bindings.DB.prepare(
      `INSERT INTO order_items
         (order_id, menu_item_id, quantity, unit_price_cents, total_price_cents,
          status, created_at_ms, updated_at_ms)
       VALUES (?, ?, 1, 12000, 12000, 'pending', ?, ?)
       RETURNING id`,
    )
      .bind(orderId, menuItemId, now, now)
      .first<{ id: number }>();
    return row!.id;
  }

  /**
   * Read a response and hold it to the published contract schema at the same
   * time. The contract file is what the customer-app and admin-dashboard work
   * is written against, so it has to be checked against the server that
   * actually answers rather than against intent — `PublicReviewSchema` is
   * `strict()`, so a leaked field fails here.
   */
  async function readContractData<T>(
    schema: ZodType,
    res: Response,
  ): Promise<T> {
    const envelope = await readEnvelope<T>(res);
    ContractHelpers.assertMatchesSchema(schema, envelope);
    if (!envelope.success || envelope.data === undefined) {
      throw new Error(
        `expected success envelope, got ${JSON.stringify(envelope)}`,
      );
    }
    return envelope.data;
  }

  /** A guest token exactly as `POST /guest-orders` mints it. */
  async function mintGuestToken(orderId: string, restaurantId: string) {
    const token = `gt_${"b".repeat(64)}`;
    await testApp.env.CACHE_KV.put(
      `guest_token:${token}`,
      JSON.stringify({
        orderId,
        restaurantId,
        guestName: "Integration Guest",
        createdAt: Date.now(),
      }),
    );
    return token;
  }

  /**
   * A signed-in diner, minted directly rather than through
   * `/customer/auth/request-otp`. The OTP path is rate limited per IP in KV,
   * which `truncateAll()` does not clear — every suite that logs in more than
   * a handful of times otherwise starts failing partway through on
   * OTP_RATE_LIMITED and looks like a reviews bug. The claims here are exactly
   * what `canonicalCustomerAuthMiddleware` accepts: `{ sub, type: "customer" }`.
   */
  async function loginCustomer(phone: string) {
    const now = Date.now();
    const id = crypto.randomUUID();
    await testApp.testDb.bindings.DB.prepare(
      `INSERT INTO customers
         (id, display_name, primary_phone, status, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
      .bind(id, `顧客${phone.slice(-4)}`, phone, now, now)
      .run();

    const issuedAt = Math.floor(now / 1000);
    const accessToken = await sign(
      { sub: id, type: "customer", iat: issuedAt, exp: issuedAt + 3600 },
      "test-jwt-secret-do-not-use-in-prod",
    );

    return { accessToken, customer: { id } };
  }

  /** A delivered order with two items, owned by a signed-in customer. */
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
    return { restaurant, itemA, itemB, order, orderItemA, orderItemB };
  }

  async function readRestaurantAggregate(restaurantId: string) {
    return testApp.testDb.bindings.DB.prepare(
      `SELECT rating, review_count FROM restaurants WHERE id = ?`,
    )
      .bind(restaurantId)
      .first<{ rating: number | null; review_count: number }>();
  }

  async function readMenuItemAggregate(menuItemId: number) {
    return testApp.testDb.bindings.DB.prepare(
      `SELECT rating, review_count FROM menu_items WHERE id = ?`,
    )
      .bind(menuItemId)
      .first<{ rating: number | null; review_count: number }>();
  }

  async function countReviews(orderId: string) {
    const row = await testApp.testDb.bindings.DB.prepare(
      `SELECT COUNT(*) AS n FROM reviews WHERE order_id = ?`,
    )
      .bind(orderId)
      .first<{ n: number }>();
    return row!.n;
  }

  // ─────────────────────────── schema / migration ───────────────────────────

  describe("0023_reviews.sql", () => {
    it("creates the table STRICT", async () => {
      const row = await testApp.testDb.bindings.DB.prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reviews'`,
      ).first<{ sql: string }>();

      // Substring-matching STRICT is the bug CLAUDE.md records (it also matches
      // ON DELETE RESTRICT); the keyword only counts as the table option after
      // the closing paren.
      expect(row?.sql.replace(/\n/g, " ").trim()).toMatch(/\) STRICT$/);
    });

    it("rejects a rating outside 1-5 with the CHECK constraint", async () => {
      const { order, restaurant } = await deliveredOrder();

      await expect(
        testApp.testDb.bindings.DB.prepare(
          `INSERT INTO reviews (id, restaurant_id, order_id, rating, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, 6, ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            restaurant.id,
            order.id,
            Date.now(),
            Date.now(),
          )
          .run(),
      ).rejects.toThrow(/CONSTRAINT|CHECK/i);
    });

    it("rejects a TEXT rating because the table is STRICT", async () => {
      const { order, restaurant } = await deliveredOrder();

      await expect(
        testApp.testDb.bindings.DB.prepare(
          `INSERT INTO reviews (id, restaurant_id, order_id, rating, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, 'five', ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            restaurant.id,
            order.id,
            Date.now(),
            Date.now(),
          )
          .run(),
      ).rejects.toThrow(/TEXT|INTEGER|datatype|constraint/i);
    });

    it("lets two orders carry an item rating for the same dish, but not one order twice", async () => {
      const { order, itemA, restaurant } = await deliveredOrder();
      const now = Date.now();
      const insert = (id: string) =>
        testApp.testDb.bindings.DB.prepare(
          `INSERT INTO reviews (id, restaurant_id, order_id, menu_item_id, rating, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, 5, ?, ?)`,
        )
          .bind(id, restaurant.id, order.id, itemA.id, now, now)
          .run();

      await insert(crypto.randomUUID());
      await expect(insert(crypto.randomUUID())).rejects.toThrow(/UNIQUE/i);
    });
  });

  // ────────────────────────────── diner writes ──────────────────────────────

  describe("POST /orders/:id/review", () => {
    it("stores the order-level review and its item rows, and recomputes every aggregate", async () => {
      const customer = await loginCustomer("+886911000001");
      const restaurant = await seed.restaurant();
      const itemA = await seed.menuItem(restaurant.id, { name: "招牌牛肉麵" });
      const itemB = await seed.menuItem(restaurant.id, { name: "小菜拼盤" });
      const order = await seed.order(restaurant.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });
      await addOrderItem(order.id, itemA.id);
      await addOrderItem(order.id, itemB.id);

      const res = await call(`/orders/${order.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: {
          rating: 4,
          content: "上菜很快",
          items: [
            { menuItemId: itemA.id, rating: 5 },
            { menuItemId: itemB.id, rating: 3 },
          ],
        },
      });

      expect(res.status).toBe(201);
      const review = await readContractData<OrderReviewView>(
        ReviewContracts.SubmitOrderReviewResponse,
        res,
      );
      expect(review).toMatchObject({
        orderId: order.id,
        restaurantId: restaurant.id,
        rating: 4,
        content: "上菜很快",
        reply: null,
      });
      expect(review.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ menuItemId: itemA.id, rating: 5 }),
          expect.objectContaining({ menuItemId: itemB.id, rating: 3 }),
        ]),
      );

      // One order-level row + two item rows.
      expect(await countReviews(order.id)).toBe(3);

      // The restaurant aggregate counts order-level rows only: a two-dish order
      // must not vote three times.
      await expect(readRestaurantAggregate(restaurant.id)).resolves.toEqual(
        expect.objectContaining({ rating: 4, review_count: 1 }),
      );
      await expect(readMenuItemAggregate(itemA.id)).resolves.toEqual(
        expect.objectContaining({ rating: 5, review_count: 1 }),
      );
      await expect(readMenuItemAggregate(itemB.id)).resolves.toEqual(
        expect.objectContaining({ rating: 3, review_count: 1 }),
      );

      const orderRow = await testApp.testDb.bindings.DB.prepare(
        `SELECT rating, review_comment, reviewed_at_ms FROM orders WHERE id = ?`,
      )
        .bind(order.id)
        .first<{
          rating: number | null;
          review_comment: string | null;
          reviewed_at_ms: number | null;
        }>();
      expect(orderRow).toMatchObject({ rating: 4, review_comment: "上菜很快" });
      expect(orderRow?.reviewed_at_ms).toEqual(expect.any(Number));
    });

    it("accepts the body shape the customer app already sends (comment + itemRatings/orderItemId)", async () => {
      const customer = await loginCustomer("+886911000002");
      const restaurant = await seed.restaurant();
      const item = await seed.menuItem(restaurant.id);
      const order = await seed.order(restaurant.id, {
        status: "paid",
        customerId: customer.customer.id,
      });
      const orderItemId = await addOrderItem(order.id, item.id);

      const res = await call(`/orders/${order.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: {
          rating: 5,
          comment: "很好吃",
          itemRatings: [{ orderItemId, rating: 4, comment: "還行" }],
        },
      });

      expect(res.status).toBe(201);
      const review = await readData<OrderReviewView>(res);
      expect(review.content).toBe("很好吃");
      expect(review.items).toEqual([
        expect.objectContaining({ menuItemId: item.id, rating: 4 }),
      ]);
    });

    it("refuses a second review and leaves the aggregates untouched", async () => {
      const customer = await loginCustomer("+886911000003");
      const restaurant = await seed.restaurant();
      const order = await seed.order(restaurant.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });

      const first = await call(`/orders/${order.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: { rating: 5 },
      });
      expect(first.status).toBe(201);
      const before = await readRestaurantAggregate(restaurant.id);

      const second = await call(`/orders/${order.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: { rating: 1 },
      });

      expect(second.status).toBe(409);
      await expect(readError(second)).resolves.toMatchObject({
        code: "REVIEW_ALREADY_EXISTS",
      });
      await expect(readRestaurantAggregate(restaurant.id)).resolves.toEqual(
        before,
      );
      expect(await countReviews(order.id)).toBe(1);
    });

    it.each([
      ["pending", "pending"],
      ["cancelled", "cancelled"],
    ])("refuses an order in status %s and names the status", async (status) => {
      const customer = await loginCustomer(`+8869110001${status.length}0`);
      const restaurant = await seed.restaurant();
      const order = await seed.order(restaurant.id, {
        status,
        customerId: customer.customer.id,
      });

      const res = await call(`/orders/${order.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: { rating: 5 },
      });

      expect(res.status).toBe(409);
      await expect(readError(res)).resolves.toMatchObject({
        code: "ORDER_NOT_REVIEWABLE",
        details: { status },
      });
      expect(await countReviews(order.id)).toBe(0);
    });

    it("refuses a menu item that is not on the order and names it", async () => {
      const customer = await loginCustomer("+886911000004");
      const mine = await seed.restaurant();
      const theirs = await seed.restaurant();
      const myItem = await seed.menuItem(mine.id);
      const foreignItem = await seed.menuItem(theirs.id);
      const order = await seed.order(mine.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });
      await addOrderItem(order.id, myItem.id);

      const res = await call(`/orders/${order.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: {
          rating: 5,
          items: [{ menuItemId: foreignItem.id, rating: 1 }],
        },
      });

      expect(res.status).toBe(400);
      await expect(readError(res)).resolves.toMatchObject({
        code: "REVIEW_ITEM_NOT_IN_ORDER",
        details: { menuItemId: foreignItem.id },
      });
      // Nothing was written, so the other restaurant's dish keeps its aggregate.
      expect(await countReviews(order.id)).toBe(0);
      await expect(readMenuItemAggregate(foreignItem.id)).resolves.toEqual(
        expect.objectContaining({ review_count: 0 }),
      );
    });

    it("rejects a rating outside 1-5 before it reaches the database", async () => {
      const customer = await loginCustomer("+886911000005");
      const restaurant = await seed.restaurant();
      const order = await seed.order(restaurant.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });

      const res = await call(`/orders/${order.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: { rating: 6 },
      });

      expect(res.status).toBe(400);
      expect(await countReviews(order.id)).toBe(0);
    });

    it("lets the guest holding the order token review it, with no customer attached", async () => {
      const { order, restaurant, itemA } = await deliveredOrder();
      const guestToken = await mintGuestToken(order.id, restaurant.id);

      const res = await call(`/orders/${order.id}/review`, {
        token: guestToken,
        method: "POST",
        body: { rating: 5, items: [{ menuItemId: itemA.id, rating: 5 }] },
      });

      expect(res.status).toBe(201);
      const row = await testApp.testDb.bindings.DB.prepare(
        `SELECT customer_id FROM reviews WHERE order_id = ? AND menu_item_id IS NULL`,
      )
        .bind(order.id)
        .first<{ customer_id: string | null }>();
      expect(row?.customer_id).toBeNull();
    });

    it("answers 401 without a token and 403 for a token belonging to another order", async () => {
      const { order } = await deliveredOrder();
      const other = await deliveredOrder();
      const foreignToken = await mintGuestToken(
        other.order.id,
        other.restaurant.id,
      );

      const anonymous = await call(`/orders/${order.id}/review`, {
        method: "POST",
        body: { rating: 5 },
      });
      expect(anonymous.status).toBe(401);

      const wrongOrder = await call(`/orders/${order.id}/review`, {
        token: foreignToken,
        method: "POST",
        body: { rating: 5 },
      });
      expect(wrongOrder.status).toBe(403);
      await expect(readError(wrongOrder)).resolves.toMatchObject({
        code: "ORDER_ACCESS_DENIED",
      });
      expect(await countReviews(order.id)).toBe(0);
    });

    it("keeps two restaurants' aggregates apart", async () => {
      const customer = await loginCustomer("+886911000006");
      const a = await seed.restaurant();
      const b = await seed.restaurant();
      const orderA = await seed.order(a.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });
      const orderB = await seed.order(b.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });

      await call(`/orders/${orderA.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: { rating: 5 },
      });
      await call(`/orders/${orderB.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: { rating: 1 },
      });

      await expect(readRestaurantAggregate(a.id)).resolves.toEqual(
        expect.objectContaining({ rating: 5, review_count: 1 }),
      );
      await expect(readRestaurantAggregate(b.id)).resolves.toEqual(
        expect.objectContaining({ rating: 1, review_count: 1 }),
      );
    });

    it("averages repeat reviews rather than overwriting the last one", async () => {
      const customer = await loginCustomer("+886911000007");
      const restaurant = await seed.restaurant();
      const first = await seed.order(restaurant.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });
      const second = await seed.order(restaurant.id, {
        status: "paid",
        customerId: customer.customer.id,
      });

      await call(`/orders/${first.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: { rating: 5 },
      });
      await call(`/orders/${second.id}/review`, {
        token: customer.accessToken,
        method: "POST",
        body: { rating: 2 },
      });

      await expect(readRestaurantAggregate(restaurant.id)).resolves.toEqual(
        expect.objectContaining({ rating: 3.5, review_count: 2 }),
      );
    });
  });

  // ─────────────────────────────── diner reads ───────────────────────────────

  describe("GET /orders/:id/review", () => {
    it("returns the diner's own review including the owner reply", async () => {
      const customer = await loginCustomer("+886911000008");
      const restaurant = await seed.restaurant();
      const order = await seed.order(restaurant.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });
      const created = await readData<OrderReviewView>(
        await call(`/orders/${order.id}/review`, {
          token: customer.accessToken,
          method: "POST",
          body: { rating: 4, content: "還不錯" },
        }),
      );

      const owner = await seed.user({
        id: 21,
        role: 1,
        restaurantId: restaurant.id,
      });
      const ownerToken = await testApp.authHelper.ownerToken(
        owner.id,
        restaurant.id,
      );
      await call(`/reviews/${restaurant.id}/${created.id}/reply`, {
        token: ownerToken,
        method: "POST",
        body: { content: "謝謝光臨" },
      });

      const res = await call(`/orders/${order.id}/review`, {
        token: customer.accessToken,
      });

      expect(res.status).toBe(200);
      const review = await readContractData<OrderReviewView>(
        ReviewContracts.GetOrderReviewResponse,
        res,
      );
      expect(review.reply).toMatchObject({ content: "謝謝光臨" });
      expect(review.reply?.repliedAt).toEqual(expect.any(Number));
    });

    it("answers 404 when the order has not been reviewed", async () => {
      const { order, restaurant } = await deliveredOrder();
      const token = await mintGuestToken(order.id, restaurant.id);

      const res = await call(`/orders/${order.id}/review`, { token });

      expect(res.status).toBe(404);
      await expect(readError(res)).resolves.toMatchObject({
        code: "REVIEW_NOT_FOUND",
      });
    });
  });

  // ────────────────────────────── owner surface ──────────────────────────────

  describe("owner endpoints", () => {
    async function restaurantWithReview(phone: string, rating = 4) {
      const customer = await loginCustomer(phone);
      const restaurant = await seed.restaurant();
      const item = await seed.menuItem(restaurant.id, { name: "招牌牛肉麵" });
      const order = await seed.order(restaurant.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });
      await addOrderItem(order.id, item.id);

      const review = await readData<OrderReviewView>(
        await call(`/orders/${order.id}/review`, {
          token: customer.accessToken,
          method: "POST",
          body: {
            rating,
            content: "服務很好",
            items: [{ menuItemId: item.id, rating }],
          },
        }),
      );

      return { customer, restaurant, item, order, review };
    }

    it("lists a restaurant's reviews with their item ratings", async () => {
      const { restaurant, item, review } =
        await restaurantWithReview("+886911000010");
      const owner = await seed.user({
        id: 31,
        role: 1,
        restaurantId: restaurant.id,
      });
      const token = await testApp.authHelper.ownerToken(
        owner.id,
        restaurant.id,
      );

      const res = await call(`/reviews/${restaurant.id}`, { token });

      expect(res.status).toBe(200);
      const data = await readContractData<{
        reviews: OwnerReviewView[];
        pagination: ReviewPagination;
      }>(ReviewContracts.ListRestaurantReviewsResponse, res);
      expect(data.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
      expect(data.reviews).toHaveLength(1);
      expect(data.reviews[0]).toMatchObject({
        id: review.id,
        rating: 4,
        content: "服務很好",
      });
      expect(data.reviews[0].orderNumber).toEqual(expect.any(String));
      expect(data.reviews[0].items).toEqual([
        expect.objectContaining({
          menuItemId: item.id,
          menuItemName: "招牌牛肉麵",
        }),
      ]);
    });

    it("filters by rating and by whether a reply exists", async () => {
      const { restaurant, review } = await restaurantWithReview(
        "+886911000011",
        2,
      );
      const owner = await seed.user({
        id: 32,
        role: 1,
        restaurantId: restaurant.id,
      });
      const token = await testApp.authHelper.ownerToken(
        owner.id,
        restaurant.id,
      );

      await expect(
        readData<{ reviews: OwnerReviewView[] }>(
          await call(`/reviews/${restaurant.id}?rating=2`, { token }),
        ),
      ).resolves.toMatchObject({
        reviews: [expect.objectContaining({ id: review.id })],
      });
      await expect(
        readData<{ reviews: OwnerReviewView[] }>(
          await call(`/reviews/${restaurant.id}?rating=5`, { token }),
        ),
      ).resolves.toMatchObject({ reviews: [] });
      await expect(
        readData<{ reviews: OwnerReviewView[] }>(
          await call(`/reviews/${restaurant.id}?replied=false`, { token }),
        ),
      ).resolves.toMatchObject({
        reviews: [expect.objectContaining({ id: review.id })],
      });
      await expect(
        readData<{ reviews: OwnerReviewView[] }>(
          await call(`/reviews/${restaurant.id}?replied=true`, { token }),
        ),
      ).resolves.toMatchObject({ reviews: [] });
    });

    it("summarises the distribution and the reply backlog", async () => {
      const { restaurant } = await restaurantWithReview("+886911000012", 3);
      const owner = await seed.user({
        id: 33,
        role: 1,
        restaurantId: restaurant.id,
      });
      const token = await testApp.authHelper.ownerToken(
        owner.id,
        restaurant.id,
      );

      const summary = await readContractData<ReviewSummary>(
        ReviewContracts.RestaurantReviewSummaryResponse,
        await call(`/reviews/${restaurant.id}/summary`, { token }),
      );

      expect(summary).toMatchObject({
        average: 3,
        count: 1,
        unrepliedCount: 1,
        distribution: { "1": 0, "2": 0, "3": 1, "4": 0, "5": 0 },
      });
    });

    it("records a reply against the replying user", async () => {
      const { restaurant, review } =
        await restaurantWithReview("+886911000013");
      const owner = await seed.user({
        id: 34,
        role: 1,
        restaurantId: restaurant.id,
      });
      const token = await testApp.authHelper.ownerToken(
        owner.id,
        restaurant.id,
      );

      const res = await call(`/reviews/${restaurant.id}/${review.id}/reply`, {
        token,
        method: "POST",
        body: { content: "謝謝您的回饋" },
      });

      expect(res.status).toBe(200);
      const replied = await readContractData<OwnerReviewView>(
        ReviewContracts.ReplyToReviewResponse,
        res,
      );
      expect(replied.reply).toMatchObject({
        content: "謝謝您的回饋",
        repliedBy: owner.id,
      });

      const summary = await readData<ReviewSummary>(
        await call(`/reviews/${restaurant.id}/summary`, { token }),
      );
      expect(summary.unrepliedCount).toBe(0);
    });

    it("refuses another restaurant's owner: 403 on the list, 403 on a reply into that restaurant", async () => {
      const { restaurant, review } =
        await restaurantWithReview("+886911000014");
      const attackerRestaurant = await seed.restaurant();
      const attacker = await seed.user({
        id: 35,
        role: 1,
        restaurantId: attackerRestaurant.id,
      });
      const token = await testApp.authHelper.ownerToken(
        attacker.id,
        attackerRestaurant.id,
      );

      const list = await call(`/reviews/${restaurant.id}`, { token });
      expect(list.status).toBe(403);

      const summary = await call(`/reviews/${restaurant.id}/summary`, {
        token,
      });
      expect(summary.status).toBe(403);

      const reply = await call(`/reviews/${restaurant.id}/${review.id}/reply`, {
        token,
        method: "POST",
        body: { content: "hijack" },
      });
      expect(reply.status).toBe(403);
    });

    it("answers 404 — not 403 — when the review id belongs to someone else", async () => {
      const { review } = await restaurantWithReview("+886911000015");
      const attackerRestaurant = await seed.restaurant();
      const attacker = await seed.user({
        id: 36,
        role: 1,
        restaurantId: attackerRestaurant.id,
      });
      const token = await testApp.authHelper.ownerToken(
        attacker.id,
        attackerRestaurant.id,
      );

      // Own restaurantId in the path (so the tenancy guard passes) plus the
      // victim's reviewId — the only shape that reaches the service. It must
      // not distinguish "not yours" from "does not exist".
      const res = await call(
        `/reviews/${attackerRestaurant.id}/${review.id}/reply`,
        { token, method: "POST", body: { content: "hijack" } },
      );

      expect(res.status).toBe(404);
      await expect(readError(res)).resolves.toMatchObject({
        code: "REVIEW_NOT_FOUND",
      });

      const stillUnreplied = await testApp.testDb.bindings.DB.prepare(
        `SELECT reply_content FROM reviews WHERE id = ?`,
      )
        .bind(review.id)
        .first<{ reply_content: string | null }>();
      expect(stillUnreplied?.reply_content).toBeNull();
    });

    it("lets an admin reply to any restaurant's review", async () => {
      const { restaurant, review } =
        await restaurantWithReview("+886911000016");
      const admin = await seed.user({ id: 37, role: 0 });
      const token = await testApp.authHelper.adminToken(undefined, admin.id);

      const res = await call(`/reviews/${restaurant.id}/${review.id}/reply`, {
        token,
        method: "POST",
        body: { content: "平台已協助處理" },
      });

      expect(res.status).toBe(200);
      await expect(readData<OwnerReviewView>(res)).resolves.toMatchObject({
        reply: expect.objectContaining({ repliedBy: admin.id }),
      });
    });

    it("refuses a kitchen role outright", async () => {
      const { restaurant } = await restaurantWithReview("+886911000017");
      const chef = await seed.user({
        id: 38,
        role: 2,
        restaurantId: restaurant.id,
      });
      const token = await testApp.authHelper.staffToken(
        chef.id,
        2,
        restaurant.id,
      );

      const res = await call(`/reviews/${restaurant.id}`, { token });
      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────── public surface ──────────────────────────────

  describe("GET /restaurants/:id/reviews", () => {
    it("returns order-level reviews with the reply, masked author, and no customer identifiers", async () => {
      const customer = await loginCustomer("+886911000020");
      const restaurant = await seed.restaurant();
      const item = await seed.menuItem(restaurant.id);
      const order = await seed.order(restaurant.id, {
        status: "delivered",
        customerId: customer.customer.id,
      });
      await addOrderItem(order.id, item.id);
      const review = await readData<OrderReviewView>(
        await call(`/orders/${order.id}/review`, {
          token: customer.accessToken,
          method: "POST",
          body: {
            rating: 5,
            content: "很推薦",
            items: [{ menuItemId: item.id, rating: 5 }],
          },
        }),
      );
      const owner = await seed.user({
        id: 41,
        role: 1,
        restaurantId: restaurant.id,
      });
      const ownerToken = await testApp.authHelper.ownerToken(
        owner.id,
        restaurant.id,
      );
      await call(`/reviews/${restaurant.id}/${review.id}/reply`, {
        token: ownerToken,
        method: "POST",
        body: { content: "感謝支持" },
      });

      // No Authorization header at all: this list is public.
      const res = await call(`/restaurants/${restaurant.id}/reviews`);

      expect(res.status).toBe(200);
      const data = await readContractData<{
        reviews: PublicReviewView[];
        pagination: ReviewPagination;
      }>(ReviewContracts.ListPublicReviewsResponse, res);
      expect(data.pagination.total).toBe(1);
      expect(data.reviews).toHaveLength(1);
      expect(data.reviews[0]).toMatchObject({
        rating: 5,
        content: "很推薦",
        reply: { content: "感謝支持" },
      });

      // The diner is attributed, not identified: "顧客0020" -> "顧**".
      expect(data.reviews[0].authorName).toBe("顧**");

      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain(customer.customer.id);
      expect(serialized).not.toContain(order.id);
      expect(serialized).not.toContain(owner.id);
      expect(serialized).not.toContain("顧客0020");
      expect(data.reviews[0]).not.toHaveProperty("customerId");
      expect(data.reviews[0].reply).not.toHaveProperty("repliedBy");
    });

    it("answers 404 for a restaurant that does not exist", async () => {
      const res = await call(`/restaurants/${crypto.randomUUID()}/reviews`);

      expect(res.status).toBe(404);
      await expect(readEnvelope(res)).resolves.toMatchObject({
        success: false,
      });
    });
  });
});
