/**
 * master-user-flow 1. 顧客端 → 點餐主流程, against a real API and a real D1.
 *
 * 掃描 QR → 選擇取餐 → 瀏覽菜單 → 加入購物車 → 送出訂單, one test per node
 * where the node has behaviour of its own, and one end-to-end dine-in order
 * whose every choice is read back from the server afterwards. That read-back is
 * the point: the 09-15 production walk found two bugs (C1 coupon, C10 phone)
 * where the screen showed one thing and D1 stored another, and neither is
 * visible without asking the API what was actually written.
 */
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
  toasts,
  type MenuFixture,
  type OrderRow,
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

/** Waits for the menu of a validated table to render a known dish. */
async function expectMenuLoaded(page: Page, itemId: number): Promise<void> {
  await expect(
    page.getByTestId(`menu-item-card-${itemId}`),
    "the scanned table's menu should render the fixture dish",
  ).toBeVisible({ timeout: NAV_TIMEOUT });
}

test.describe("點餐主流程 (real API)", () => {
  test("掃描 QR: a signed table QR opens that table's menu", async ({
    browser,
  }) => {
    const tableCleanup = new Cleanup();
    const { context, page } = await newDinerContext(browser);
    try {
      const owner = await getOwner();
      const table = await createTable(tableCleanup);

      await page.goto(qrPath(table.qrCode));

      // SignedOrderEntryView verifies the signature server-side, then replaces
      // the URL with the table route. Landing there proves the verify passed.
      await expect(page).toHaveURL(
        new RegExp(
          `/restaurant/${owner.restaurantId}/table/${table.id}(\\?|$)`,
        ),
        { timeout: NAV_TIMEOUT },
      );
      await expectMenuLoaded(page, menu.customItem.id);
      // The header shows the label printed on the table, not the row id.
      await expect(page.getByText(`桌號 ${table.number}`)).toBeVisible();
      await assertNoOverlayError(page);
    } finally {
      await context.close();
      await tableCleanup.run();
    }
  });

  test("掃描 QR: a seat QR on a seat-mode table opens the menu for that seat", async ({
    browser,
  }) => {
    const tableCleanup = new Cleanup();
    const { context, page } = await newDinerContext(browser);
    try {
      const owner = await getOwner();
      const table = await createTable(tableCleanup, { seatCount: 2 });
      const seat = table.seats[1];

      await page.goto(qrPath(seat.qrCode));

      await expect(page).toHaveURL(
        new RegExp(
          `/restaurant/${owner.restaurantId}/table/${table.id}\\?.*seatId=${seat.id}`,
        ),
        { timeout: NAV_TIMEOUT },
      );
      await expectMenuLoaded(page, menu.customItem.id);
      // menu.seatContext: "{table} · {seat} 號座" — the seat's own printed
      // number, which the route carries alongside the (global) seat row id.
      await expect(
        page.getByText(`桌號 ${table.number} · ${seat.seatNumber} 號座`),
      ).toBeVisible();
      await assertNoOverlayError(page);
    } finally {
      await context.close();
      await tableCleanup.run();
    }
  });

  test("掃描店家公開碼 → 選擇取餐: only the methods the shop enables, and the menu and cart agree with the choice", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    let orderId: string | undefined;
    cancelOnCleanup(localCleanup, () => orderId);
    const { context, page } = await newDinerContext(browser);
    try {
      const owner = await getOwner();
      const rid = owner.restaurantId;

      // The shop's own switches, as the 09-15 walk found them: dine-in only.
      // Restored afterwards; the seed leaves all three unset, which every
      // reader treats as false.
      const before = await apiData<{
        settings?: Record<string, unknown>;
        shopQrCode?: string | null;
      }>("read restaurant", `/api/v1/restaurants/${rid}`);
      const original = {
        enableDineIn: before.settings?.enableDineIn === true,
        enableTakeaway: before.settings?.enableTakeaway === true,
        enableDelivery: before.settings?.enableDelivery === true,
      };
      localCleanup.add("restore fulfilment settings", () =>
        apiRequest(`/api/v1/restaurants/${rid}`, {
          token: owner.token,
          method: "PUT",
          body: { settings: original },
        }),
      );
      await apiData("enable dine-in only", `/api/v1/restaurants/${rid}`, {
        token: owner.token,
        method: "PUT",
        body: {
          settings: {
            enableDineIn: true,
            enableTakeaway: false,
            enableDelivery: false,
          },
        },
      });

      // The shop code is public by design; generate one if the shop has none.
      let shopQrCode = before.shopQrCode ?? undefined;
      if (!shopQrCode) {
        const generated = await apiData<{ qrCode: string }>(
          "generate shop QR",
          `/api/v1/restaurants/${rid}/qr/shop/generate`,
          { token: owner.token, method: "POST" },
        );
        shopQrCode = generated.qrCode;
      }

      await page.goto(
        `/restaurant/${rid}/shop/order-type?qr=${encodeURIComponent(shopQrCode)}`,
      );

      // --- 選擇取餐: the landing page offers what the shop enabled ----------
      const dineIn = page.getByRole("button", { name: /內用 Dine-in/ });
      await expect(dineIn).toBeVisible({ timeout: NAV_TIMEOUT });
      await expect(
        page.getByRole("button", { name: /外帶 Takeaway/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /外送 Delivery/ }),
      ).toHaveCount(0);

      await dineIn.click();
      await page.getByTestId("continue-btn").click();
      await expect(page).toHaveURL(/\/shop\/menu\?.*fulfillmentType=dine-in/);

      // C5 (09-15), first half: the header badge was a two-way ternary and
      // told a dine-in diner 外帶.
      const header = page.locator("nav").first();
      await expect(header).toContainText("內用 Dine-in", {
        timeout: NAV_TIMEOUT,
      });
      await expect(header).not.toContainText("外帶");

      await page.getByTestId(`menu-item-add-${menu.plainItem.id}`).click();
      await page.getByTestId("cart-btn").click();
      const cart = page.getByTestId("shop-cart-modal");
      await expect(cart).toBeVisible();

      // C5, second half: the cart offered 外帶 unguarded and 外送 behind a
      // `deliveryFee >= 0` check that was always true, and never 內用.
      await expect(
        cart.getByRole("button", { name: "內用 Dine-in" }),
      ).toBeVisible();
      await expect(cart.getByRole("button", { name: "🛍️ 外帶" })).toHaveCount(
        0,
      );
      await expect(cart.getByRole("button", { name: "🛵 外送" })).toHaveCount(
        0,
      );

      const submitted = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/guest-orders") &&
          response.request().method() === "POST",
      );
      await cart.getByTestId("submit-order-btn").click();
      const response = await submitted;
      const body = (await response.json()) as {
        data?: { order?: { id: string } };
        error?: unknown;
      };
      orderId = body.data?.order?.id;

      // The store spells it "dine-in" and POST /guest-orders accepts only
      // "dine_in"; ShopCartModal used to send the store's spelling, so the
      // dine-in button C5 put back in the cart answered 400 VALIDATION_ERROR
      // on field deliveryInfo.type (fixed in 42c12e53).
      expect(
        { status: response.status(), error: body.error },
        "a dine-in shop order should be accepted",
      ).toEqual({ status: 201, error: undefined });
      await expect(page).toHaveURL(new RegExp(`/shop/order/${orderId}`));

      // Read back: the order is stored as a dine-in shop order, not as the
      // takeaway the server falls back to when no fulfilment arrives.
      const order = await readOrder(orderId!);
      expect(order).toEqual(
        expect.objectContaining({
          orderType: "shop",
          deliveryInfo: expect.objectContaining({ type: "dine_in" }),
        }),
      );
    } finally {
      await context.close();
      await localCleanup.run();
    }
  });

  test("瀏覽菜單: a category chip scrolls its section into view", async ({
    browser,
  }) => {
    const tableCleanup = new Cleanup();
    const { context, page } = await newDinerContext(browser);
    try {
      const table = await createTable(tableCleanup);
      await page.goto(qrPath(table.qrCode));
      await expectMenuLoaded(page, menu.customItem.id);

      const target = page.locator(`#category-${menu.secondCategoryId}`);
      const chip = page.getByRole("button", {
        name: new RegExp(`^E2E 飲品 `),
      });
      await expect(chip).toBeVisible();
      // The precondition that makes the assertion mean something: the section
      // starts below the fold, so only the chip can bring it into view.
      await expect(
        target.getByTestId(`menu-item-card-${menu.plainItem.id}`),
      ).not.toBeInViewport();

      await chip.click();

      await expect(
        target.getByTestId(`menu-item-card-${menu.plainItem.id}`),
        "clicking the category chip should scroll its dishes into view",
      ).toBeInViewport({ timeout: 10_000 });
    } finally {
      await context.close();
      await tableCleanup.run();
    }
  });

  test("加入購物車 → 送出訂單: options, quantities, notes, name and phone all reach the order", async ({
    browser,
  }) => {
    const tableCleanup = new Cleanup();
    let orderId: string | undefined;
    cancelOnCleanup(tableCleanup, () => orderId);
    const { context, page } = await newDinerContext(browser);
    try {
      const table = await createTable(tableCleanup);
      await page.goto(qrPath(table.qrCode));
      await expectMenuLoaded(page, menu.customItem.id);

      // --- 瀏覽菜單: an item with option groups --------------------------------
      await page
        .getByTestId(`menu-item-customize-${menu.customItem.id}`)
        .click();
      const modal = page.getByTestId("menu-item-modal");
      await expect(modal).toBeVisible();
      await expect(modal.getByText(menu.spice.groupName)).toBeVisible();

      await modal.locator("label", { hasText: menu.spice.hot.name }).click();
      await modal.locator("label", { hasText: menu.addOn.name }).click();
      await modal.getByTestId("qty-increase").click();
      await modal.locator("textarea").fill("麵硬一點");

      // (150 + 10 大辣 + 15 加蛋) × 2 = 350: the price delta of both groups has
      // to be in the number the diner is asked to accept.
      const customLine =
        (menu.customItem.price +
          menu.spice.hot.priceAdjustment +
          menu.addOn.price) *
        2;
      await expect(modal.getByTestId("menu-item-modal-add")).toHaveText(
        `加入購物車 · NT$${customLine}`,
      );
      await modal.getByTestId("menu-item-modal-add").click();
      await expect(modal).toHaveCount(0);

      // --- a plain item, quick add -------------------------------------------
      await page.getByTestId(`menu-item-add-${menu.plainItem.id}`).click();
      await expect(page.getByTestId("cart-count")).toHaveText("3");

      // --- 加入購物車: quantity change and an item note -----------------------
      await page.getByTestId("cart-btn").click();
      await expect(page.getByTestId("cart-page")).toBeVisible();

      const plainLine = page
        .getByTestId("cart-item")
        .filter({ hasText: menu.plainItem.name });
      await plainLine.locator('[data-testid^="qty-increase-"]').click();
      await expect(
        plainLine.locator('[data-testid^="cart-item-quantity-"]'),
      ).toHaveText("2");
      await plainLine
        .locator('[data-testid^="cart-item-notes-toggle-"]')
        .click();
      await plainLine
        .locator('textarea[data-testid^="cart-item-notes-"]')
        .fill("少冰");

      const expectedTotal = customLine + menu.plainItem.price * 2;
      await expect(page.getByTestId("submit-order-btn")).toHaveText(
        `送出訂單 · NT$${expectedTotal}`,
      );

      // --- 顧客資訊 and order notes ------------------------------------------
      const customerName = e2eName("顧客");
      const customerPhone = `09${Date.now().toString().slice(-8)}`;
      await page.getByTestId("order-notes").fill("請分開裝");
      await page.locator("#customer-name").fill(customerName);
      await page.locator("#customer-phone").fill(customerPhone);

      // --- 送出訂單 ------------------------------------------------------------
      await page.getByTestId("submit-order-btn").click();
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/guest-orders") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("confirmation-confirm").click();
      const response = await created;
      expect(response.status(), "guest order create").toBe(201);
      const body = (await response.json()) as {
        data: { order: { id: string; orderNumber: string } };
      };
      orderId = body.data.order.id;

      await expect(page).toHaveURL(new RegExp(`/order/${orderId}$`));
      // The order number is what the diner quotes at the counter.
      await expect(page.locator("nav")).toContainText(
        `訂單編號: ${body.data.order.orderNumber}`,
        { timeout: NAV_TIMEOUT },
      );
      expect(await toasts(page)).toContain("訂單提交成功！");

      // --- read back: what D1 actually holds -----------------------------------
      const order = await readOrder(orderId);
      expect(order.totalAmount).toBe(expectedTotal);
      expect(order.notes).toBe("請分開裝");
      expect(order.tableId).toBe(table.id);
      // C10 (09-15): the phone used to be collected, sent and then dropped.
      expect(order.customerInfo).toEqual(
        expect.objectContaining({ name: customerName, phone: customerPhone }),
      );

      const customRow = order.items.find(
        (item) => item.menuItemId === menu.customItem.id,
      );
      expect(customRow, "the customised dish is on the order").toEqual(
        expect.objectContaining({
          quantity: 2,
          unitPrice:
            menu.customItem.price +
            menu.spice.hot.priceAdjustment +
            menu.addOn.price,
          notes: "麵硬一點",
        }),
      );
      expect(customRow?.customizations?.options).toEqual([
        expect.objectContaining({ choiceId: menu.spice.hot.publicId }),
      ]);
      expect(customRow?.customizations?.addOns).toEqual([
        expect.objectContaining({ id: menu.addOn.publicId, quantity: 1 }),
      ]);

      const plainRow = order.items.find(
        (item) => item.menuItemId === menu.plainItem.id,
      );
      expect(plainRow).toEqual(
        expect.objectContaining({ quantity: 2, notes: "少冰" }),
      );
      await assertNoOverlayError(page);
    } finally {
      await context.close();
      await tableCleanup.run();
    }
  });

  test("優惠券折抵 as a guest: the discount the cart shows is the discount the order gets (#382)", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    let orderId: string | undefined;
    cancelOnCleanup(localCleanup, () => orderId);
    const { context, page } = await newDinerContext(browser);
    try {
      const owner = await getOwner();
      const code = `E2EGUEST${suffix().toUpperCase()}`;
      const coupon = await apiData<{ id: number }>(
        "create coupon",
        "/api/v1/coupons",
        {
          token: owner.token,
          method: "POST",
          body: {
            restaurantId: owner.restaurantId,
            code,
            name: e2eName("訪客券"),
            discountType: "fixed",
            discountValue: 20,
            usageLimitPerUser: 1,
            validFrom: new Date(Date.now() - 3_600_000).toISOString(),
            validTo: new Date(Date.now() + 86_400_000).toISOString(),
          },
        },
      );
      // DELETE is admin-only; deactivating is the owner's disposal path.
      localCleanup.add(`deactivate coupon ${coupon.id}`, () =>
        apiRequest(`/api/v1/coupons/${coupon.id}/deactivate`, {
          token: owner.token,
          method: "POST",
          body: {},
        }),
      );

      const table = await createTable(localCleanup);
      await page.goto(qrPath(table.qrCode));
      await expectMenuLoaded(page, menu.plainItem.id);
      await page.getByTestId(`menu-item-add-${menu.plainItem.id}`).click();
      await page.getByTestId(`menu-item-add-${menu.plainItem.id}`).click();
      await page.getByTestId("cart-btn").click();

      await page.getByTestId("coupon-code").fill(code);
      await page.getByTestId("coupon-apply").click();
      const discounted = menu.plainItem.price * 2 - 20;
      await expect(page.getByTestId("submit-order-btn")).toHaveText(
        `送出訂單 · NT$${discounted}`,
      );

      await page.getByTestId("submit-order-btn").click();
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/guest-orders") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("confirmation-confirm").click();
      const response = await created;
      expect(response.status()).toBe(201);
      orderId = ((await response.json()) as { data: { order: { id: string } } })
        .data.order.id;

      const order: OrderRow = await readOrder(orderId);
      expect(
        { total: order.totalAmount, discount: order.discountAmount },
        "the order must be charged what the cart showed",
      ).toEqual({ total: discounted, discount: 20 });
    } finally {
      await context.close();
      await localCleanup.run();
    }
  });
});
