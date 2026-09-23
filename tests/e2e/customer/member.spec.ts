/**
 * master-user-flow 1. 顧客端 → 會員入口, against a real API and a real D1.
 *
 * Production cannot reach any of this yet: it has no email or SMS
 * credentials, so registration and OTP login fail with 503 and `customers`
 * holds no rows (#384). Locally the API runs with NODE_ENV=test, where
 * /customer/auth/request-otp echoes the code as `devOtp`. The test reads that
 * code from the page's own request-otp response, so the diner still logs in
 * through the real login form.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  Cleanup,
  apiData,
  apiRequest,
  assertNoOverlayError,
  cancelOnCleanup,
  createMenuFixture,
  createTable,
  e2eName,
  getOwner,
  NAV_TIMEOUT,
  newDinerContext,
  qrPath,
  readOrder,
  requireStack,
  suffix,
  type MenuFixture,
} from "./customer-e2e";

test.describe.configure({ mode: "serial" });

const cleanup = new Cleanup();
let menu: MenuFixture;

test.beforeAll(async () => {
  await requireStack();
  menu = await createMenuFixture(cleanup);
});

test.afterAll(async () => {
  await cleanup.run();
});

/** A Taiwan mobile number no earlier run has registered. */
function freshMobile(): string {
  const digits = randomUUID().replace(/\D/g, "").padEnd(8, "0");
  return `09${digits.slice(0, 8)}`;
}

/** OTP login through /login; the code comes from the page's own response. */
async function loginWithOtp(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("tab-otp").click();
  await page.getByTestId("phone-input").fill(phone);
  const requested = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/customer/auth/request-otp") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("submit").click();
  const response = await requested;
  const body = (await response.json()) as { data?: { devOtp?: string } };
  expect(response.status(), "request OTP").toBe(200);
  expect(
    body.data?.devOtp,
    "the local API must echo the OTP (NODE_ENV=test)",
  ).toMatch(/^\d{6}$/);

  await page.getByTestId("otp-input").fill(body.data!.devOtp!);
  const verified = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/customer/auth/verify-otp") &&
      r.request().method() === "POST",
  );
  await page.getByTestId("submit").click();
  expect((await verified).status(), "verify OTP").toBe(200);
  await expect(page).toHaveURL(/\/profile$/, { timeout: NAV_TIMEOUT });
}

/** From a scanned table's menu: two of the plain dish, then the cart. */
async function addTwoPlainDishes(page: Page): Promise<void> {
  await expect(
    page.getByTestId(`menu-item-card-${menu.plainItem.id}`),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.getByTestId(`menu-item-add-${menu.plainItem.id}`).click();
  await page.getByTestId(`menu-item-add-${menu.plainItem.id}`).click();
  await page.getByTestId("cart-btn").click();
}

test.describe("會員入口 (real API)", () => {
  test("OTP login from /login lands on the profile, and 訂單歷史 opens for the member", async ({
    browser,
  }) => {
    const { context, page } = await newDinerContext(browser);
    try {
      await loginWithOtp(page, freshMobile());
      await page.goto("/orders");
      await expect(page).toHaveURL(/\/orders$/, { timeout: NAV_TIMEOUT });
      await expect(page).not.toHaveURL(/\/login/);
      await assertNoOverlayError(page);
    } finally {
      await context.close();
    }
  });

  // #422, asserted as the correct behaviour. Today the scan's full page load
  // drops the in-memory member token, so the cart orders as a guest; with
  // that restored, POST /api/v1/orders is refused by CSRF.
  test.fail(
    "a member logs in by OTP, scans a table QR, orders as a member, and finds the order in 訂單歷史 (#422)",
    async ({ browser }) => {
      const localCleanup = new Cleanup();
      let orderId: string | undefined;
      cancelOnCleanup(localCleanup, () => orderId);
      const { context, page } = await newDinerContext(browser);
      try {
        await loginWithOtp(page, freshMobile());

        // Scanning is a full page load, and the member's access token lives in
        // memory only; the cart must still know this diner is a member.
        const table = await createTable(localCleanup);
        await page.goto(qrPath(table.qrCode));
        await addTwoPlainDishes(page);

        const created = page.waitForResponse(
          (response) =>
            /\/api\/v1\/(guest-)?orders$/.test(
              new URL(response.url()).pathname,
            ) && response.request().method() === "POST",
        );
        await page.getByTestId("submit-order-btn").click();
        await page.getByTestId("confirmation-confirm").click();
        const response = await created;
        const createdBody = (await response.json()) as {
          data?: { order?: { id: string }; id?: string };
          error?: unknown;
        };
        expect(
          response.status(),
          `create member order: ${JSON.stringify(createdBody.error)}`,
        ).toBe(201);
        expect(
          new URL(response.url()).pathname,
          "a signed-in member orders through the member path",
        ).toBe("/api/v1/orders");
        orderId = createdBody.data?.order?.id ?? createdBody.data?.id;
        expect(orderId, "the member order has an id").toBeTruthy();

        const order = await readOrder(orderId!);
        expect(order.totalAmount).toBe(menu.plainItem.price * 2);
        expect(order.tableId).toBe(table.id);

        // 訂單歷史 is requiresAuth; in production nobody has reached it (#384).
        await page.goto("/orders");
        await expect(page.getByText(order.orderNumber)).toBeVisible({
          timeout: NAV_TIMEOUT,
        });
        await assertNoOverlayError(page);
      } finally {
        await context.close();
        await localCleanup.run();
      }
    },
  );

  // #422, asserted as the correct behaviour: POST /coupons/validate reads
  // userId from the body and ignores the member's JWT, while the client
  // (rightly) drops the guest device id once signed in — so the server sees
  // no identity and refuses every per-user-limited coupon. Member order
  // creation records coupon_usage.user_id, a foreign key to staff users.
  test.fail(
    "a member applies a per-user-limited coupon, and the order gets the discount the cart showed (#422)",
    async ({ browser }) => {
      const localCleanup = new Cleanup();
      let orderId: string | undefined;
      cancelOnCleanup(localCleanup, () => orderId);
      const { context, page } = await newDinerContext(browser);
      try {
        const owner = await getOwner();
        const code = `E2EMEMBER${suffix().toUpperCase()}`;
        const coupon = await apiData<{ id: number }>(
          "create coupon",
          "/api/v1/coupons",
          {
            token: owner.token,
            method: "POST",
            body: {
              restaurantId: owner.restaurantId,
              code,
              name: e2eName("會員券"),
              discountType: "fixed",
              discountValue: 20,
              usageLimitPerUser: 1,
              validFrom: new Date(Date.now() - 3_600_000).toISOString(),
              validTo: new Date(Date.now() + 86_400_000).toISOString(),
            },
          },
        );
        localCleanup.add(`deactivate coupon ${coupon.id}`, () =>
          apiRequest(`/api/v1/coupons/${coupon.id}/deactivate`, {
            token: owner.token,
            method: "POST",
            body: {},
          }),
        );

        await loginWithOtp(page, freshMobile());
        const table = await createTable(localCleanup);
        await page.goto(qrPath(table.qrCode));
        await addTwoPlainDishes(page);

        await page.getByTestId("coupon-code").fill(code);
        const validated = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/v1/coupons/validate") &&
            response.request().method() === "POST",
        );
        await page.getByTestId("coupon-apply").click();
        const validationBody = await (await validated).text();
        const discounted = menu.plainItem.price * 2 - 20;
        await expect(
          page.getByTestId("submit-order-btn"),
          `the cart applies the coupon: ${validationBody}`,
        ).toHaveText(`送出訂單 · NT$${discounted}`);

        const created = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/orders" &&
            response.request().method() === "POST",
        );
        await page.getByTestId("submit-order-btn").click();
        await page.getByTestId("confirmation-confirm").click();
        const response = await created;
        expect(response.status(), await response.text()).toBe(201);
        orderId = (
          (await response.json()) as { data: { order?: { id: string } } }
        ).data.order?.id;
        const order = await readOrder(orderId!);
        expect({
          total: order.totalAmount,
          discount: order.discountAmount,
        }).toEqual({ total: discounted, discount: 20 });
      } finally {
        await context.close();
        await localCleanup.run();
      }
    },
  );
});
