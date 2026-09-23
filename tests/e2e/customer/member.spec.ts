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
/**
 * The member the first test signs in, reused by the rest: OTP requests are
 * limited to 10 per IP, and a member who signed in earlier and then scans a
 * QR is the realistic case anyway. Refresh tokens rotate, so each test saves
 * the session back when it closes; replaying a spent refresh cookie would
 * sign the next test out.
 */
let memberState:
  | Awaited<
      ReturnType<import("@playwright/test").BrowserContext["storageState"]>
    >
  | undefined;

async function memberContext(browser: import("@playwright/test").Browser) {
  expect(
    memberState,
    "the OTP login test signs the member in first",
  ).toBeTruthy();
  return newDinerContext(browser, { storageState: memberState });
}

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
      // A full load of an account route restores the session through the
      // refresh cookie, and that refresh rotates the cookie. The URL reads
      // /orders before the router's refresh has answered, so wait for the
      // refresh itself: saving the session earlier keeps the spent cookie,
      // and the next member test is signed out (seen on CI, 2026-09-23).
      const restored = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/customer/auth/refresh") &&
          response.request().method() === "POST",
      );
      await page.goto("/orders");
      expect((await restored).status(), "session restore on /orders").toBe(200);
      await expect(page).toHaveURL(/\/orders$/, { timeout: NAV_TIMEOUT });
      await expect(page).not.toHaveURL(/\/login/);
      await assertNoOverlayError(page);
      memberState = await context.storageState();
    } finally {
      await context.close();
    }
  });

  // #422: the scan's full page load used to drop the in-memory member token
  // (the cart then ordered as a guest), and POST /api/v1/orders then refused
  // members by CSRF and by a module gate that found no restaurant.
  test("a signed-in member scans a table QR, orders as a member, and finds the order in 訂單歷史 (#422)", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    let orderId: string | undefined;
    cancelOnCleanup(localCleanup, () => orderId);
    const { context, page } = await memberContext(browser);
    try {
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
      memberState = await context.storageState();
      await context.close();
      await localCleanup.run();
    }
  });

  // #422: POST /coupons/validate used to read userId from the body and
  // ignore the member's JWT, so every per-user-limited coupon was refused to
  // members. Preview and redemption now share one server-derived identity.
  test("a member applies a per-user-limited coupon, and the order gets the discount the cart showed (#422)", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    let orderId: string | undefined;
    cancelOnCleanup(localCleanup, () => orderId);
    const { context, page } = await memberContext(browser);
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

      const table = await createTable(localCleanup);
      await page.goto(qrPath(table.qrCode));
      await addTwoPlainDishes(page);

      const validations: string[] = [];
      page.on("response", (response) => {
        if (response.url().endsWith("/api/v1/coupons/validate")) {
          void response.text().then((text) => validations.push(text));
        }
      });
      await page.getByTestId("coupon-code").fill(code);
      await page.getByTestId("coupon-apply").click();
      const discounted = menu.plainItem.price * 2 - 20;
      await expect(
        page.getByTestId("submit-order-btn"),
        `the cart applies the coupon: ${validations.join(" | ")}`,
      ).toHaveText(`送出訂單 · NT$${discounted}`);

      const created = page.waitForResponse(
        (response) =>
          /\/api\/v1\/(guest-)?orders$/.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "POST",
      );
      await page.getByTestId("submit-order-btn").click();
      await page.getByTestId("confirmation-confirm").click();
      const response = await created;
      expect(
        new URL(response.url()).pathname,
        "a signed-in member orders through the member path",
      ).toBe("/api/v1/orders");
      expect(response.status(), await response.text()).toBe(201);
      const orderBody = (await response.json()) as {
        data?: { order?: { id: string }; id?: string };
      };
      orderId = orderBody.data?.order?.id ?? orderBody.data?.id;
      const order = await readOrder(orderId!);
      expect({
        total: order.totalAmount,
        discount: order.discountAmount,
      }).toEqual({ total: discounted, discount: 20 });
    } finally {
      memberState = await context.storageState();
      await context.close();
      await localCleanup.run();
    }
  });
});
