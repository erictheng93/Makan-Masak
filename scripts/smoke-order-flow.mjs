#!/usr/bin/env node
/**
 * End-to-end smoke check of the ordering flow against a deployed stack, in a
 * real browser: diner -> owner -> kitchen -> diner.
 *
 * CI already runs this flow against a local stack. This exists for the things
 * only a deployment has: the real D1, KV, Durable Objects and Pages bundles.
 * Both defects it was written after (#476, #478) passed CI.
 *
 * It creates its own restaurant and deletes it again through
 * `DELETE /restaurants/:id/permanent`, so it leaves nothing behind and never
 * touches a real shop. That needs an administrator-tier account:
 *
 *   SMOKE_ADMIN_USERNAME=... SMOKE_ADMIN_PASSWORD=... pnpm smoke:order-flow
 *
 * Optional: SMOKE_API_URL, SMOKE_CUSTOMER_URL, SMOKE_ADMIN_URL,
 * SMOKE_KITCHEN_URL (default to production), SMOKE_KEEP=1 to skip the delete
 * when you want to look at the shop afterwards, SMOKE_ARTIFACTS for the
 * directory failure screenshots go to.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";

const API = process.env.SMOKE_API_URL ?? "https://api.makanmasak.com";
const CUSTOMER = process.env.SMOKE_CUSTOMER_URL ?? "https://makanmasak.com";
const ADMIN = process.env.SMOKE_ADMIN_URL ?? "https://admin.makanmasak.com";
const KITCHEN =
  process.env.SMOKE_KITCHEN_URL ?? "https://kitchen.makanmasak.com";
const ARTIFACTS =
  process.env.SMOKE_ARTIFACTS ??
  join(tmpdir(), `smoke-order-flow-${Date.now()}`);
const LIVE_MS = 30_000;
/** A display that lost its socket catches up on its safety-net poll. */
const CATCH_UP_MS = 120_000;

const username = process.env.SMOKE_ADMIN_USERNAME;
const password = process.env.SMOKE_ADMIN_PASSWORD;
if (!username || !password) {
  console.error("Set SMOKE_ADMIN_USERNAME and SMOKE_ADMIN_PASSWORD.");
  process.exit(2);
}

/** QR links carry the production origin; point them at the stack under test. */
function onCustomerApp(link) {
  const url = new URL(link);
  return `${CUSTOMER}${url.pathname}${url.search}`;
}

const results = [];
const started = Date.now();
const seconds = (from) => `${((Date.now() - from) / 1000).toFixed(1)}s`;

async function step(name, run) {
  const from = Date.now();
  try {
    const detail = await run();
    results.push({ name, ok: true, detail: detail ?? seconds(from) });
    console.log(`  ok    ${name}${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, detail: String(error.message ?? error) });
    console.log(
      `  FAIL  ${name}\n        ${String(error.message ?? error).split("\n")[0]}`,
    );
    throw error;
  }
}

/** A staff API session: bearer token plus the double-submit CSRF cookie. */
async function apiSession(body) {
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ADMIN },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`login ${response.status}: ${JSON.stringify(json.error)}`);
  }
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0]);
  const csrf = cookies
    .find((cookie) => cookie.includes("csrf"))
    ?.split("=")
    .slice(1)
    .join("=");
  return async (method, path, payload) => {
    const call = await fetch(`${API}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${json.data.token}`,
        origin: ADMIN,
        cookie: cookies.join("; "),
        "x-csrf-token": csrf ?? "",
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await call.json().catch(() => ({}));
    if (!call.ok) {
      throw new Error(
        `${method} ${path} -> ${call.status} ${JSON.stringify(data.error ?? data)}`,
      );
    }
    return data.data ?? data;
  };
}

const browser = await chromium.launch();
const pages = [];
function watch(page, tag) {
  pages.push({ page, tag });
  page.on("pageerror", (error) =>
    console.log(`        [${tag} page error] ${String(error).slice(0, 200)}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 500) {
      console.log(
        `        [${tag} http ${response.status()}] ${response.url()}`,
      );
    }
  });
  return page;
}

async function staffPage(base, slug, user, pass) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "zh-TW",
  });
  const page = watch(await context.newPage(), new URL(base).hostname);
  await page.goto(`${base}/s/${slug}`, { waitUntil: "networkidle" });
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/s/"), {
    timeout: LIVE_MS,
  });
  return page;
}

async function dinerPage() {
  const context = await browser.newContext({
    ...devices["iPhone 14"],
    locale: "zh-TW",
  });
  return watch(await context.newPage(), "diner");
}

/** Submit whatever is in the cart and return the created order. */
async function submitOrder(page, submit) {
  const created = page.waitForResponse(
    (response) =>
      /\/api\/v1\/(guest-orders|orders)$/.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === "POST",
    { timeout: LIVE_MS },
  );
  await submit.click();
  const confirm = page.getByTestId("confirmation-confirm");
  if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirm.click();
  }
  const response = await created;
  const body = await response.json();
  if (response.status() !== 201) {
    throw new Error(
      `order ${response.status()}: ${JSON.stringify(body.error)}`,
    );
  }
  return body.data.order;
}

async function shopCodeOrder(qrUrl, itemId, fulfilment) {
  const page = await dinerPage();
  await page.goto(onCustomerApp(qrUrl), { waitUntil: "networkidle" });
  await page
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: fulfilment }) })
    .click({ timeout: LIVE_MS });
  await page.getByTestId("continue-btn").click();
  await page.getByTestId(`menu-item-add-${itemId}`).click({ timeout: LIVE_MS });
  await page.getByTestId("cart-btn").click();
  const cart = page.getByTestId("shop-cart-modal");
  await cart.waitFor({ timeout: LIVE_MS });
  const order = await submitOrder(page, cart.getByTestId("submit-order-btn"));
  return { page, order };
}

const statusOf = (page) =>
  page.getByTestId("order-status-title").innerText({ timeout: LIVE_MS });

async function waitForStatus(page, expected, timeout = LIVE_MS) {
  const from = Date.now();
  let seen = "";
  while (Date.now() - from < timeout) {
    seen = await statusOf(page).catch(() => "");
    if (seen === expected) return seconds(from);
    await page.waitForTimeout(250);
  }
  throw new Error(`diner status is "${seen}", expected "${expected}"`);
}

const kitchenCard = (page, orderId) =>
  page.locator(`[data-testid="kitchen-order-card-${orderId}"]`);

async function kitchenType(page, orderId, timeout = LIVE_MS) {
  const card = kitchenCard(page, orderId);
  await card.waitFor({ timeout });
  return card
    .locator("[data-order-type]")
    .first()
    .getAttribute("data-order-type");
}

function expectEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${expected}, got ${actual}`);
  }
}

let admin;
let restaurant;
let failed = false;

try {
  console.log(`Smoke check against ${API}`);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const name = `ZZ smoke ${stamp}`;
  // Random on every run and gone with the shop; the suffix only satisfies the
  // password policy (upper, lower, digit, symbol).
  const staffPassword = [crypto.randomUUID(), "Zz", "9", "!"].join("");
  let owner;
  let table;
  let item;
  let shopQr;

  await step("administrator signs in", async () => {
    admin = await apiSession({ username, password });
  });

  await step("a temporary shop is set up", async () => {
    restaurant = await admin("POST", "/restaurants", {
      name,
      type: "restaurant",
      category: "smoke",
      address: "1 Smoke Test Road",
      district: "Test",
      city: "臺北市",
      countryCode: "TW",
      phone: "0200000000",
    });
    const rid = restaurant.id;
    for (const [user, role] of [
      ["smokeowner", 1],
      ["smokechef", 2],
    ]) {
      await admin("POST", "/users", {
        username: user,
        fullName: user,
        password: staffPassword,
        role,
        restaurantId: rid,
      });
    }
    owner = await apiSession({
      username: "smokeowner",
      password: staffPassword,
      shop: restaurant.loginSlug,
    });
    const category = await owner("POST", `/menu/${rid}/categories`, {
      name: "Smoke",
    });
    item = await owner("POST", `/menu/${rid}/items`, {
      categoryId: category.id,
      name: "Smoke noodles",
      price: 100,
    });
    table = await owner("POST", "/tables", {
      restaurantId: rid,
      number: "S1",
      capacity: 2,
    });
    // Manual confirmation first, so the owner's step is exercised.
    await owner("PUT", `/restaurants/${rid}`, {
      settings: {
        enableDineIn: true,
        enableTakeaway: true,
        enableDelivery: false,
        autoAcceptOrders: false,
      },
    });
    await owner("PUT", `/restaurants/${rid}/shop-mode`, { enabled: true });
    shopQr = await owner("POST", `/restaurants/${rid}/qr/shop/generate`);
    return restaurant.loginSlug;
  });

  const kitchen = await staffPage(
    KITCHEN,
    restaurant.loginSlug,
    "smokechef",
    staffPassword,
  );
  const office = await staffPage(
    ADMIN,
    restaurant.loginSlug,
    "smokeowner",
    staffPassword,
  );
  await office.goto(`${ADMIN}/dashboard/orders`, { waitUntil: "networkidle" });
  for (const page of [kitchen, office]) {
    await page.evaluate(() => {
      window.__smoke = true;
    });
  }

  // --- 1. Table code, staff confirm, kitchen, diner follows along ----------
  const diner = await dinerPage();
  let tableOrder;
  await step("diner orders from a table code", async () => {
    await diner.goto(onCustomerApp(table.qrCode), { waitUntil: "networkidle" });
    await diner
      .getByTestId(`menu-item-add-${item.id}`)
      .click({ timeout: LIVE_MS });
    await diner.getByTestId("cart-btn").click();
    tableOrder = await submitOrder(
      diner,
      diner.getByTestId("submit-order-btn"),
    );
    expectEqual(await statusOf(diner), "待確認", "diner status");
    return tableOrder.orderNumber;
  });

  const confirmButton = () =>
    office
      .locator(`[data-testid="admin-order-update-${tableOrder.id}"]:visible`)
      .first();
  await step("owner sees the order without reloading", async () => {
    const from = Date.now();
    await confirmButton().waitFor({ timeout: LIVE_MS });
    return seconds(from);
  });

  await step("owner confirms, kitchen board shows it as dine-in", async () => {
    const from = Date.now();
    await confirmButton().click();
    expectEqual(
      await kitchenType(kitchen, tableOrder.id),
      "dine_in",
      "kitchen order type",
    );
    return seconds(from);
  });

  await step("diner sees 已確認 → 製作中 → 準備完成 live", async () => {
    const timings = [await waitForStatus(diner, "已確認")];
    for (const [kind, status] of [
      ["start", "製作中"],
      ["ready", "準備完成"],
    ]) {
      await kitchen
        .locator(`[data-testid^="kitchen-item-${kind}-${tableOrder.id}"]`)
        .first()
        .click({ timeout: LIVE_MS });
      timings.push(await waitForStatus(diner, status));
    }
    return timings.join(", ");
  });

  await step(
    "the diner keeps the order after a reload; a stranger gets 401",
    async () => {
      await diner.reload({ waitUntil: "networkidle" });
      expectEqual(await statusOf(diner), "準備完成", "status after reload");
      const stranger = await fetch(
        `${API}/api/v1/guest-orders/${tableOrder.id}`,
      );
      expectEqual(stranger.status, 401, "stranger read");
    },
  );

  await step("no page was reloaded to get there", async () => {
    for (const page of [kitchen, office]) {
      if (!(await page.evaluate(() => window.__smoke === true))) {
        throw new Error(`${new URL(page.url()).hostname} reloaded`);
      }
    }
  });

  // --- 2. Shop code with auto-accept: straight to the kitchen ---------------
  await owner("PUT", `/restaurants/${restaurant.id}`, {
    settings: { autoAcceptOrders: true },
  });

  await step(
    "shop-code takeaway reaches the kitchen as takeaway, unconfirmed by hand",
    async () => {
      const { order } = await shopCodeOrder(shopQr.qrUrl, item.id, /外帶/);
      const from = Date.now();
      expectEqual(
        await kitchenType(kitchen, order.id),
        "takeaway",
        "kitchen order type",
      );
      return seconds(from);
    },
  );

  await step("shop-code dine-in reaches the kitchen as dine-in", async () => {
    const { order } = await shopCodeOrder(shopQr.qrUrl, item.id, /內用/);
    const from = Date.now();
    expectEqual(
      await kitchenType(kitchen, order.id),
      "dine_in",
      "kitchen order type",
    );
    return seconds(from);
  });

  // --- 3. A kitchen display that lost its connection catches up -------------
  await step(
    "kitchen display catches up after losing its connection",
    async () => {
      await kitchen.context().setOffline(true);
      const { order } = await shopCodeOrder(shopQr.qrUrl, item.id, /外帶/);
      await kitchen.waitForTimeout(5000);
      if ((await kitchenCard(kitchen, order.id).count()) > 0) {
        throw new Error(
          "the offline display showed an order it cannot have received",
        );
      }
      await kitchen.context().setOffline(false);
      const from = Date.now();
      await kitchenCard(kitchen, order.id).waitFor({ timeout: CATCH_UP_MS });
      return `${seconds(from)} after reconnecting`;
    },
  );

  // --- 4. A diner cancels their own order ------------------------------------
  await owner("PUT", `/restaurants/${restaurant.id}`, {
    settings: { autoAcceptOrders: false },
  });
  await step("diner cancels a pending order themselves", async () => {
    const { page } = await shopCodeOrder(shopQr.qrUrl, item.id, /外帶/);
    await page
      .getByRole("button", { name: /取消訂單/ })
      .click({ timeout: LIVE_MS });
    await page.getByTestId("confirmation-confirm").click();
    return waitForStatus(page, "已取消");
  });
} catch {
  failed = true;
  mkdirSync(ARTIFACTS, { recursive: true });
  for (const [index, { page, tag }] of pages.entries()) {
    await page
      .screenshot({
        path: join(ARTIFACTS, `${index}-${tag}.png`),
        fullPage: true,
      })
      .catch(() => {});
  }
  console.log(`  screenshots: ${ARTIFACTS}`);
} finally {
  await browser.close();
  if (restaurant && admin && process.env.SMOKE_KEEP !== "1") {
    try {
      await admin("DELETE", `/restaurants/${restaurant.id}`);
      const removed = await admin(
        "DELETE",
        `/restaurants/${restaurant.id}/permanent`,
        { confirmName: restaurant.name, acknowledgeFinancialRecords: true },
      );
      console.log(`  ok    temporary shop deleted (${removed.totalRows} rows)`);
    } catch (error) {
      failed = true;
      console.log(
        `  FAIL  temporary shop NOT deleted: ${error.message}\n        id ${restaurant.id}, name "${restaurant.name}" — remove it by hand`,
      );
    }
  } else if (restaurant) {
    console.log(`  kept  ${restaurant.name} (${restaurant.id})`);
  }
}

const passed = results.filter((result) => result.ok).length;
console.log(
  `${failed ? "FAILED" : "PASSED"}: ${passed}/${results.length} steps in ${seconds(started)}`,
);
process.exit(failed ? 1 : 0);
