import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:4410/discover", {
    waitUntil: "domcontentloaded",
  });
  const back = page.locator("nav button").first();
  await back.waitFor();
  const box = await back.boundingBox();
  assert.ok(
    box.height >= 44,
    `Discovery navigation target height ${box.height}px; expected at least 44px`,
  );
  assert.ok(
    box.width >= 44,
    `Discovery navigation target width ${box.width}px; expected at least 44px`,
  );
  console.log("Real customer navigation target meets the 44px touch floor.");
} finally {
  await browser.close();
}
