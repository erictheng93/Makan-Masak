// Run against the release customer server, default port 4420.
import assert from "node:assert/strict";
import process from "node:process";
import { URL } from "node:url";
import { log, error as logError } from "node:console";
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
    try {
      await page.goto(`${base}/markets`, { waitUntil: "networkidle" });
      await page.goto(`${base}/markets/demo-shop`, {
        waitUntil: "networkidle",
      });
      const initialLength = await page.evaluate(
        () => globalThis.history.length,
      );
      for (const id of ["market-vendors", "market-products", "market-maps"]) {
        const link = page.locator(`a[href="#${id}"]`);
        await link.focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          (id) => globalThis.location.hash === `#${id}`,
          id,
        );
        assert.equal(
          await page.evaluate(() => globalThis.history.length),
          initialLength,
          `${width}: ${id} must replace the history entry`,
        );
        await page.waitForFunction((id) => {
          const bounds = globalThis.document
            .getElementById(id)
            .getBoundingClientRect();
          return bounds.y < globalThis.innerHeight && bounds.bottom > 0;
        }, id);
        const target = page.locator(`#${id}`);
        const bounds = await target.boundingBox();
        assert.ok(
          bounds.y < 844 && bounds.y + bounds.height > 0,
          `${width}: ${id} scrolls into view`,
        );
      }
      await page.goBack();
      assert.equal(new URL(page.url()).pathname, "/markets");
      checks.push({
        width,
        keyboardLinks: true,
        scrollTargets: true,
        historyUnchanged: true,
        oneBackToMarkets: true,
      });
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
