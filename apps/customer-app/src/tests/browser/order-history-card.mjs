// Run against the local customer server: node apps/customer-app/src/tests/browser/order-history-card.mjs
import assert from "node:assert/strict";
import process from "node:process";
import { log, error as logError } from "node:console";
import { URL } from "node:url";
import reviewData from "../../../../../docs/design-review-2026-11-11/implementation/local-review-data.cjs";
const { chromium, installReviewData } = reviewData;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  try {
    for (const width of [1100, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        locale: "zh-TW",
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      await installReviewData(context, "customer-app");
      await context.route("**/customers/me/orders?*", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: "101",
                restaurantId: "demo-restaurant",
                orderNumber: "FOLLOWUP-ORDER",
                status: "pending",
                paymentStatus: "pending",
                totalAmount: 300,
                subtotal: 300,
                currency: "TWD",
                createdAt: Date.now(),
                items: [],
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          }),
        }),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(2500);
      try {
        await page.goto("http://127.0.0.1:4410/orders", {
          waitUntil: "networkidle",
        });
        const link = page.getByRole("link", {
          name: "FOLLOWUP-ORDER",
          exact: true,
        });
        await link.waitFor();
        const card = link.locator(
          "xpath=ancestor::div[contains(@class,'rounded-2xl')][1]",
        );
        const bounds = await card.boundingBox();
        await card.click({ position: { x: bounds.width - 20, y: 20 } });
        await page.waitForURL("**/orders/101");
        assert.equal(new URL(page.url()).pathname, "/orders/101");
        await page.goto("http://127.0.0.1:4410/orders", {
          waitUntil: "networkidle",
        });
        await page
          .getByRole("button", { name: "取消訂單", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "取消訂單", exact: true })
          .waitFor();
        assert.equal(new URL(page.url()).pathname, "/orders");
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await page
          .getByRole("link", { name: "FOLLOWUP-ORDER", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await page.waitForURL("**/orders/101");
        checks.push({
          width,
          cardSurface: true,
          nestedCancel: true,
          keyboardLink: true,
        });
      } catch (error) {
        checks.push({ width, error: error.message });
        process.exitCode = 1;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  log(JSON.stringify(checks));
})().catch((error) => {
  logError(error);
  process.exitCode = 1;
});
