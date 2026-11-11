// Run against the release customer server, default port 4420. Never confirms an order.
import assert from "node:assert/strict";
import process from "node:process";
import { log, error as logError } from "node:console";
import { join } from "node:path";
import reviewData from "../../../../../docs/design-review-2026-11-11/implementation/local-review-data.cjs";
const { chromium, installReviewData } = reviewData;
const base = process.env.CUSTOMER_QA_URL || "http://127.0.0.1:4420";
const checks = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1100, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      locale: "zh-TW",
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    await installReviewData(context, "customer-app");
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      for (const kind of ["cart", "tracking"]) {
        const path =
          kind === "cart"
            ? "/restaurant/demo-restaurant/table/1/cart"
            : "/restaurant/demo-restaurant/table/1/order/101";
        await page.goto(base + path, { waitUntil: "networkidle" });
        const opener =
          kind === "cart"
            ? page.getByTestId("submit-order-btn")
            : page.getByRole("button", { name: "取消訂單", exact: true });
        await opener.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        assert.ok(await dialog.getAttribute("aria-labelledby"));
        assert.ok(await dialog.getAttribute("aria-describedby"));
        const cancel = dialog.getByTestId("confirmation-cancel");
        const confirm = dialog.getByTestId("confirmation-confirm");
        await page.waitForFunction(
          (element) => element === globalThis.document.activeElement,
          await cancel.elementHandle(),
        );
        await page.keyboard.press("Tab");
        await page.waitForFunction(
          (element) => element === globalThis.document.activeElement,
          await confirm.elementHandle(),
        );
        await page.keyboard.press("Shift+Tab");
        await page.waitForFunction(
          (element) => element === globalThis.document.activeElement,
          await cancel.elementHandle(),
        );
        if (kind === "cart" && process.env.CUSTOMER_QA_ARTIFACTS)
          await page.screenshot({
            path: join(
              process.env.CUSTOMER_QA_ARTIFACTS,
              `demo-customer-confirmation-local-${width}.png`,
            ),
            animations: "disabled",
          });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        await page.waitForFunction(
          (element) => element === globalThis.document.activeElement,
          await opener.elementHandle(),
        );
        await opener.click();
        await dialog.waitFor();
        await cancel.click();
        await dialog.waitFor({ state: "detached" });
        await page.waitForFunction(
          (element) => element === globalThis.document.activeElement,
          await opener.elementHandle(),
        );
        checks.push({
          width,
          kind,
          namedDialog: true,
          initialCancel: true,
          tabTrap: true,
          escapeCancel: true,
          cancelButton: true,
          focusRestored: true,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
} catch (error) {
  logError(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
log(JSON.stringify(checks));
