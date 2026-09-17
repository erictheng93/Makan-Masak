/**
 * master-user-flow 1. 顧客端 → 夜市市集 (探索市集 → 跨攤結帳 → 代幣／優惠卷 →
 * 完成付款), against a real API and a real D1.
 *
 * One diner walks one market from the directory to payment, so the tests share
 * a browser context and run in order: the checkout page needs the guest tokens
 * the checkout wrote into that diner's storage, exactly as it would on a phone.
 *
 * The market and its memberships are created by the platform admin through
 * `/api/v1/admin/markets`; the second stall is found-or-created through
 * `POST /api/v1/restaurants` (see `ensureMarketStall`).
 *
 * 代幣 (stored-value credits) is not driven. The market checkout page offers no
 * credits payment at all — its pay button always sends `market_online` — and
 * the only customer surface for credits (service booking) is hidden while the
 * API reports `STORED_VALUE_CREDITS_ENABLED` off, which is the default locally
 * and in CI.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  Cleanup,
  apiData,
  apiRequest,
  assertNoOverlayError,
  createMenuFixture,
  e2eName,
  ensureMarketStall,
  getAdmin,
  getOwner,
  NAV_TIMEOUT,
  newDinerContext,
  requireStack,
  suffix,
  type MarketStall,
  type MenuFixture,
  type OrderRow,
} from "./customer-e2e";

test.describe.configure({ mode: "serial" });

const cleanup = new Cleanup();
let menu: MenuFixture;
let stall: MarketStall;
let ownerRestaurantId: string;
let ownerRestaurantName: string;
let market: { id: string; slug: string; name: string };
let diner: { context: BrowserContext; page: Page };
let checkoutId: string | undefined;
let guestTokens: string[] = [];

interface ChildOrder {
  restaurantId: string;
  restaurantName: string;
  orderId: string;
  totalAmount: number;
}

interface CheckoutSession {
  id: string;
  subtotal: number;
  childOrders: ChildOrder[];
  appliedVoucher?: {
    code: string;
    discountCents: number;
    allocations: Array<{ orderId: string; discountCents: number }>;
  } | null;
  payment?: { status: string; paidAmount: number } | null;
}

async function readCheckout(id: string): Promise<CheckoutSession> {
  const admin = await getAdmin();
  const data = await apiData<CheckoutSession | { checkout: CheckoutSession }>(
    "read market checkout",
    `/api/v1/market-checkouts/admin/${id}`,
    { token: admin.token },
  );
  return "checkout" in data ? data.checkout : data;
}

async function readOrderAsAdmin(orderId: string): Promise<
  OrderRow & {
    restaurantId: string;
    paidAt?: unknown;
    paymentTransactionId?: string | null;
  }
> {
  const admin = await getAdmin();
  return apiData("read child order", `/api/v1/orders/${orderId}`, {
    token: admin.token,
  });
}

test.beforeAll(async ({ browser }) => {
  await requireStack();
  const owner = await getOwner();
  const admin = await getAdmin();
  ownerRestaurantId = owner.restaurantId;
  ownerRestaurantName = (
    await apiData<{ name: string }>(
      "read owner shop",
      `/api/v1/restaurants/${owner.restaurantId}`,
    )
  ).name;

  menu = await createMenuFixture(cleanup);
  stall = await ensureMarketStall();

  const s = suffix();
  const created = await apiData<{
    market: { id: string; slug: string; name: string };
  }>("create market", "/api/v1/admin/markets", {
    token: admin.token,
    method: "POST",
    body: {
      slug: `e2e-market-${s}`,
      name: `E2E 夜市 ${s}`,
      type: "night_market",
      description: "E2E 顧客端市集流程用的夜市",
      city: "Taichung",
      district: "E2E District",
      address: "E2E Night Market Road",
      latitude: 24.16,
      longitude: 120.64,
      openingHours: {
        mon: { open: "00:00", close: "23:59" },
        tue: { open: "00:00", close: "23:59" },
        wed: { open: "00:00", close: "23:59" },
        thu: { open: "00:00", close: "23:59" },
        fri: { open: "00:00", close: "23:59" },
        sat: { open: "00:00", close: "23:59" },
        sun: { open: "00:00", close: "23:59" },
      },
    },
  });
  market = created.market;
  cleanup.add(`delete market ${market.id}`, () =>
    apiRequest(`/api/v1/admin/markets/${market.id}`, {
      token: admin.token,
      method: "DELETE",
    }),
  );

  for (const [restaurantId, stallNumber] of [
    [ownerRestaurantId, "A01"],
    [stall.restaurantId, "A02"],
  ]) {
    await apiData(
      `add vendor ${stallNumber}`,
      `/api/v1/admin/markets/${market.id}/vendors`,
      {
        token: admin.token,
        method: "POST",
        body: { restaurantId, stallNumber },
      },
    );
  }

  // A market is only public once a member stall has a searchable dish, and
  // membership reaches the search index through the sync the add-vendor route
  // triggers. Wait for the public list to agree before a page asks for it.
  // `limit=17` keeps this probe off the cache key the directory page uses, so
  // an early empty answer cannot be served back to the UI.
  await expect
    .poll(
      async () => {
        const listed = await apiRequest<{ markets: Array<{ id: string }> }>(
          `/api/v1/markets?q=${encodeURIComponent(market.name)}&limit=17`,
        );
        return listed.body.data?.markets.some((row) => row.id === market.id);
      },
      { timeout: 60_000, message: "the new market never became public" },
    )
    .toBe(true);

  diner = await newDinerContext(browser);
});

test.afterAll(async () => {
  await diner?.context.close();
  // Child orders a test left unpaid would hold this diner's lock; the context
  // is gone, but cancel them anyway so the shops' boards stay clean.
  if (checkoutId) {
    const admin = await getAdmin();
    const session = await readCheckout(checkoutId).catch(() => undefined);
    for (const child of session?.childOrders ?? []) {
      await apiRequest(`/api/v1/orders/${child.orderId}`, {
        token: admin.token,
        method: "DELETE",
      }).catch(() => undefined);
    }
  }
  await cleanup.run();
});

/** Opens a stall's menu from the market page, adds one dish, returns to the market. */
async function addFromStall(
  page: Page,
  restaurantId: string,
  menuItemId: number,
  expectedBasketCount: number,
): Promise<void> {
  await page.getByTestId(`open-vendor-menu-${restaurantId}`).click();
  await expect(page.getByTestId(`menu-item-add-${menuItemId}`)).toBeEnabled({
    timeout: NAV_TIMEOUT,
  });
  await page.getByTestId(`menu-item-add-${menuItemId}`).click();
  const basket = page.getByTestId("shop-market-cart-summary");
  await expect(basket).toContainText(String(expectedBasketCount));
  await basket.getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`/markets/${market.slug}`));
}

test.describe("夜市市集 (real API)", () => {
  test("探索市集: the directory lists the market and its page shows both stalls", async () => {
    const { page } = diner;
    await page.goto("/markets");
    await page.getByTestId("markets-search-input").fill(market.name);
    await page.getByTestId("markets-search-input").press("Enter");

    const card = page.getByRole("button", { name: new RegExp(market.name) });
    await expect(card).toBeVisible({ timeout: NAV_TIMEOUT });
    await card.click();

    await expect(page).toHaveURL(new RegExp(`/markets/${market.slug}(\\?|$)`));
    await expect(
      page.getByTestId(`open-vendor-menu-${ownerRestaurantId}`),
    ).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(
      page.getByTestId(`open-vendor-menu-${stall.restaurantId}`),
    ).toBeVisible();
    await expect(page.getByText(ownerRestaurantName).first()).toBeVisible();
    await expect(page.getByText(stall.name).first()).toBeVisible();
    await assertNoOverlayError(page);
  });

  test("跨攤結帳 from the market page: a basket with two stalls submits one checkout (#401)", async () => {
    const { page } = diner;
    await addFromStall(page, ownerRestaurantId, menu.plainItem.id, 1);
    await addFromStall(page, stall.restaurantId, stall.dish.id, 2);

    const basket = page.getByTestId("market-cart-summary");
    await expect(basket).toContainText(ownerRestaurantName);
    await expect(basket).toContainText(stall.name);
    await page.getByTestId("market-checkout-phone").fill("135");
    await expect(page.getByTestId("market-checkout-submit")).toBeEnabled();

    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/market-checkouts") &&
        response.request().method() === "POST",
    );
    await page.getByTestId("market-checkout-submit").click();
    const response = await submitted;
    const body = (await response.json()) as {
      data?: { checkout: CheckoutSession };
      error?: unknown;
    };

    // Everything above works: stalls, basket, phone digits. The submit is
    // the open bug (#401). /market-checkouts is mounted after csrfProtection
    // in app-factory.ts and is not on its excludePaths, while the customer
    // app sends no X-CSRF-Token at all — so every guest market checkout POST
    // (create, voucher, pay) answers 403 CSRF_TOKEN_MISSING.
    test.fail(
      true,
      "#401: guest market checkout POSTs are CSRF-protected and the customer app sends no CSRF token",
    );
    expect(
      { status: response.status(), error: body.error },
      "the basket should become a market checkout",
    ).toEqual({ status: 201, error: undefined });
    await expect(page).toHaveURL(/\/checkout\//);
  });

  test("跨攤結帳: one checkout is one real order per stall, and its page shows both", async () => {
    const { page } = diner;
    // Created through the same endpoint and body the market page sends, from
    // outside the browser, because the page itself cannot get past CSRF
    // (#401, see the test above). What is under test here is the checkout page and the
    // orders behind it.
    const created = await apiData<{
      checkout: CheckoutSession;
      childOrders: Array<{
        restaurantId: string;
        order: { id: string };
        guestToken: string;
        tokenExpiresAt: string;
      }>;
    }>("create market checkout", "/api/v1/market-checkouts", {
      method: "POST",
      body: {
        marketSlug: market.slug,
        guestName: "Guest",
        phoneLastDigits: "135",
        vendors: [
          {
            restaurantId: ownerRestaurantId,
            items: [{ menuItemId: menu.plainItem.id, quantity: 1 }],
          },
          {
            restaurantId: stall.restaurantId,
            items: [{ menuItemId: stall.dish.id, quantity: 1 }],
          },
        ],
      },
    });
    checkoutId = created.checkout.id;
    guestTokens = created.childOrders.map((child) => child.guestToken);

    // Where the market page would have put them after a successful submit.
    await page.evaluate((response) => {
      const key = "makanmakan_market_checkout_guest_tokens";
      const records = JSON.parse(localStorage.getItem(key) ?? "{}");
      records[response.checkout.id] = Object.fromEntries(
        response.childOrders.map((child) => [
          String(child.order.id),
          {
            restaurantId: child.restaurantId,
            guestToken: child.guestToken,
            tokenExpiresAt: child.tokenExpiresAt,
          },
        ]),
      );
      localStorage.setItem(key, JSON.stringify(records));
    }, created);

    await page.goto(`/markets/${market.slug}/checkout/${checkoutId}`);
    const children = page.getByTestId("market-checkout-child-order");
    await expect(children).toHaveCount(2, { timeout: NAV_TIMEOUT });
    await expect(children.filter({ hasText: ownerRestaurantName })).toHaveCount(
      1,
    );
    await expect(children.filter({ hasText: stall.name })).toHaveCount(1);
    const subtotal = menu.plainItem.price + stall.dish.price;

    const session = await readCheckout(checkoutId);
    expect(
      session.childOrders.map((child) => child.restaurantId).sort(),
    ).toEqual([ownerRestaurantId, stall.restaurantId].sort());
    let childTotal = 0;
    for (const child of session.childOrders) {
      const order = await readOrderAsAdmin(child.orderId);
      expect(order.restaurantId).toBe(child.restaurantId);
      expect(order.items.map((item) => item.menuItemId)).toEqual([
        child.restaurantId === ownerRestaurantId
          ? menu.plainItem.id
          : stall.dish.id,
      ]);
      childTotal += order.totalAmount;
    }
    expect(childTotal, "the stall orders add up to the basket").toBe(subtotal);

    // The session's `subtotal` is in cents; the page used to format it as a
    // currency amount, so a NT$110 checkout read NT$11,000 (fixed in
    // f2a3ad0f). Anchored, with no digit allowed after the amount: `NT$110`
    // is a substring of `NT$1100`, so a contains-check would pass a 10x error.
    const amount = new RegExp(`^\\s*NT\\$${subtotal}(?!\\d)\\D*$`);
    await expect(page.getByTestId("market-checkout-subtotal")).toHaveText(
      amount,
    );
    await expect(page.getByTestId("market-checkout-payable")).toHaveText(
      amount,
    );
    await assertNoOverlayError(page);
  });

  test("優惠卷: a shop's voucher code entered on the checkout page discounts that stall (#401)", async () => {
    const { page } = diner;
    const owner = await getOwner();
    const code = `E2EMKT${suffix().toUpperCase()}`;
    const coupon = await apiData<{ id: number }>(
      "create shop voucher",
      "/api/v1/coupons",
      {
        token: owner.token,
        method: "POST",
        body: {
          restaurantId: owner.restaurantId,
          code,
          name: e2eName("市集卷"),
          discountType: "fixed",
          discountValue: 10,
          validFrom: new Date(Date.now() - 3_600_000).toISOString(),
          validTo: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
    );
    cleanup.add(`deactivate voucher ${coupon.id}`, () =>
      apiRequest(`/api/v1/coupons/${coupon.id}/deactivate`, {
        token: owner.token,
        method: "POST",
        body: {},
      }),
    );

    await page.getByTestId("market-checkout-voucher-code").fill(code);
    const applied = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/v1/market-checkouts/${checkoutId}/voucher`) &&
        response.request().method() === "POST",
    );
    await page.getByTestId("market-checkout-voucher-apply").click();
    const response = await applied;

    // Same CSRF blocker as the market-page submit (#401): the voucher POST
    // is 403.
    test.fail(
      true,
      "#401: guest market checkout POSTs are CSRF-protected and the customer app sends no CSRF token",
    );
    expect(response.status(), await response.text()).toBe(200);
    const subtotal = menu.plainItem.price + stall.dish.price;
    await expect(
      page.getByTestId("market-checkout-voucher-discount"),
    ).toHaveText("-NT$10");
    await expect(page.getByTestId("market-checkout-payable")).toHaveText(
      `NT$${subtotal - 10}`,
    );
    const session = await readCheckout(checkoutId!);
    const ownChild = session.childOrders.find(
      (child) => child.restaurantId === ownerRestaurantId,
    )!;
    expect(session.appliedVoucher).toEqual(
      expect.objectContaining({ code, discountCents: 1_000 }),
    );
    expect(
      session.appliedVoucher?.allocations
        .filter((allocation) => allocation.discountCents > 0)
        .map((allocation) => allocation.orderId),
    ).toEqual([ownChild.orderId]);
  });

  test("完成付款: with no payment provider configured, paying must not mark the stall orders paid (#400)", async () => {
    // Sent from outside the browser for the same CSRF reason (#401), with exactly
    // what the pay button sends: method "market_online", TW/TWD, and the
    // guest token that proves this diner holds the checkout.
    const pay = await apiRequest<{
      checkout?: CheckoutSession;
      payment?: {
        status?: string;
        method?: string;
        childPayments?: Array<{
          orderId: string;
          status: string;
          paymentId?: string;
        }>;
      };
    }>(`/api/v1/market-checkouts/${checkoutId}/pay`, {
      method: "POST",
      headers: { "X-Guest-Token": guestTokens[0]! },
      body: { method: "market_online", country: "TW", currency: "TWD" },
    });

    const children = [];
    for (const child of (await readCheckout(checkoutId!)).childOrders) {
      const order = await readOrderAsAdmin(child.orderId);
      children.push({
        restaurantId: child.restaurantId,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paidAt: order.paidAt ?? null,
        paymentTransactionId: order.paymentTransactionId ?? null,
      });
    }
    // Printed so a run records what actually happened, whichever way it went.
    console.log(
      "[market pay]",
      JSON.stringify({
        httpStatus: pay.status,
        paymentStatus: pay.body.data?.payment?.status,
        method: pay.body.data?.payment?.method,
        childPayments: pay.body.data?.payment?.childPayments,
        children,
      }),
    );
    expect(pay.status, JSON.stringify(pay.body.error)).toBeLessThan(500);

    // With no MARKET_CHECKOUT_SPLIT_MODE set (the production default) the pay
    // route uses ChildTransactionMarketCheckoutPaymentProvider, which calls
    // PaymentService.processPayment directly — no gateway, no redirect, no
    // callback — and records every stall order as paid.
    test.fail(
      true,
      "#400: market checkout self-certifies payment without a provider",
    );
    expect(
      {
        paymentStatus: pay.body.data?.payment?.status,
        childPaymentStatuses: children.map((child) => child.paymentStatus),
      },
      "no money moved, so nothing may be recorded as paid",
    ).toEqual({
      paymentStatus: expect.not.stringMatching(/^paid$/),
      childPaymentStatuses: [
        expect.not.stringMatching(/^completed$/),
        expect.not.stringMatching(/^completed$/),
      ],
    });
  });
});
