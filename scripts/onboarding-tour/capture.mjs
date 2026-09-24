// Drives the local stack capture.sh starts and writes the onboarding tour
// screenshots to apps/onboarding-app/public/tour/. Run it through capture.sh,
// not directly: it assumes the showcase seed and the dev ports.
//
// `--serve-photos` only starts the food photo server (capture.sh --serve).
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";

const FOOD_DIR = fileURLToPath(new URL("./food/", import.meta.url));
const OUT_DIR = fileURLToPath(
  new URL("../../apps/onboarding-app/public/tour/", import.meta.url),
);
const API = "http://localhost:8787/api/v1";
const CUSTOMER = "http://localhost:3000";
const KITCHEN = "http://localhost:3002";
const ADMIN = "http://localhost:3001";
const RESTAURANT_ID = "019469a0-0099-7000-8000-000000000099";

// The seeded menu image URLs point here.
const photoServer = createServer(async (req, res) => {
  const name = new URL(req.url, "http://x").pathname.replace(/^\/food\//, "");
  if (!/^[a-z-]+\.jpg$/.test(name)) return res.writeHead(404).end();
  try {
    res
      .writeHead(200, {
        "Content-Type": "image/jpeg",
        "Access-Control-Allow-Origin": "*",
      })
      .end(await readFile(FOOD_DIR + name));
  } catch {
    res.writeHead(404).end();
  }
});
// Under capture.sh --serve the photo server is already up; reuse it.
photoServer.on("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
});
photoServer.listen(3099);

if (process.argv.includes("--serve-photos")) {
  await new Promise(() => {});
}

// Toasts ("已加入 …") stack over the top of every customer screen.
const HIDE_TOASTS = ".Vue-Toastification__container{display:none!important}";

async function api(path, { token, method = "GET", body, headers = {} } = {}) {
  const csrf = "a".repeat(64);
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "GET"
        ? {}
        : {
            "X-CSRF-Token": csrf,
            cookie: `csrf_token=${csrf}`,
            origin: new URL(API).origin,
          }),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(
      `${method} ${path} -> ${response.status} ${JSON.stringify(json)}`,
    );
  }
  return json.data;
}

async function login(username, password, system) {
  const data = await api("/auth/login", {
    method: "POST",
    body: { username, password, ...(system ? { system } : {}) },
  });
  return data.token;
}

// Table orders, so kitchen tickets carry a table number instead of "No Table".
async function placeTableOrder(tableId, items, guestName) {
  const data = await api("/guest-orders", {
    method: "POST",
    body: {
      restaurantId: RESTAURANT_ID,
      orderType: "table",
      tableId,
      items: items.map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
      guestName,
    },
  });
  return data.order;
}

async function advance(orderId, token, ...statuses) {
  for (const status of statuses) {
    await api(`/orders/${orderId}/status`, {
      token,
      method: "PUT",
      body: { status },
    });
  }
}

async function payCash(order, token) {
  await api("/payments/create", {
    token,
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      orderId: order.id,
      restaurantId: RESTAURANT_ID,
      amount: order.totalAmount,
      method: "cash",
    },
  });
}

async function shoot(page, name) {
  await page.addStyleTag({ content: HIDE_TOASTS });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${OUT_DIR}${name}.jpg`,
    type: "jpeg",
    quality: 80,
  });
  console.log(`wrote public/tour/${name}.jpg`);
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();

try {
  const ownerToken = await login("owner1", "owner123");

  // The morning's trade, served and paid, so the owner's dashboard shows real
  // revenue rather than NT$0.
  const served = [
    [
      9501,
      [
        [9501, 2],
        [9505, 1],
      ],
    ],
    [
      9502,
      [
        [9502, 2],
        [9506, 1],
        [9508, 2],
      ],
    ],
    [
      9503,
      [
        [9504, 1],
        [9503, 1],
      ],
    ],
    [
      9504,
      [
        [9501, 3],
        [9502, 2],
        [9507, 4],
        [9508, 3],
      ],
    ],
    [
      9501,
      [
        [9505, 2],
        [9508, 2],
      ],
    ],
    [
      9502,
      [
        [9503, 2],
        [9504, 1],
      ],
    ],
  ];
  for (const [tableId, items] of served) {
    const order = await placeTableOrder(tableId, items, "客人");
    await advance(
      order.id,
      ownerToken,
      "confirmed",
      "preparing",
      "ready",
      "delivered",
    );
    await payCash(order, ownerToken);
  }

  // The lunch rush on the kitchen board: two waiting, two cooking, one ready.
  const rush = [
    [
      9501,
      [
        [9501, 2],
        [9505, 1],
      ],
      "王先生",
      ["confirmed"],
    ],
    [
      9503,
      [
        [9504, 1],
        [9503, 1],
        [9508, 1],
      ],
      "陳先生",
      ["confirmed"],
    ],
    [
      9502,
      [
        [9502, 3],
        [9508, 3],
      ],
      "林小姐",
      ["confirmed", "preparing"],
    ],
    [
      9504,
      [
        [9501, 1],
        [9507, 2],
      ],
      "黃先生",
      ["confirmed", "preparing"],
    ],
    [
      9503,
      [
        [9506, 2],
        [9507, 2],
      ],
      "張太太",
      ["confirmed", "preparing", "ready"],
    ],
  ];
  for (const [tableId, items, guest, statuses] of rush) {
    const order = await placeTableOrder(tableId, items, guest);
    await advance(order.id, ownerToken, ...statuses);
  }

  // 1. The customer's phone: scan, browse, add to cart.
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    deviceScaleFactor: 2,
    locale: "zh-TW",
  });
  const customer = await phone.newPage();
  await customer.goto(
    `${CUSTOMER}/restaurant/${RESTAURANT_ID}/shop/menu?fulfillmentType=takeaway`,
    { waitUntil: "networkidle" },
  );
  for (const name of ["紅燒牛肉麵", "鮮肉小籠包", "珍珠奶茶"]) {
    await customer
      .locator("div", { has: customer.getByText(name, { exact: true }) })
      .filter({ has: customer.getByRole("button", { name: "加入" }) })
      .last()
      .getByRole("button", { name: "加入" })
      .click();
    await customer.waitForTimeout(300);
  }
  // Frame the featured dishes; the top of the page is header and search.
  await customer.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const heading = [...document.querySelectorAll("h2,h3")].find((el) =>
      el.textContent.includes("推薦菜品"),
    );
    window.scrollTo(
      0,
      heading.getBoundingClientRect().top + window.scrollY - 124,
    );
  });
  await shoot(customer, "1-order");

  // 3. The same order, a minute later, on the customer's phone.
  await customer.getByText("查看購物車").click();
  await customer.getByRole("button", { name: "確認訂單" }).click();
  await customer.waitForURL(/\/shop\/order\//);
  const orderId = customer.url().match(/\/shop\/order\/([^/?]+)/)[1];
  await advance(orderId, ownerToken, "confirmed", "preparing");
  await customer.reload({ waitUntil: "networkidle" });
  await customer.waitForTimeout(1000);
  await shoot(customer, "3-tracking");

  // 2. The kitchen screen.
  const tablet = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    deviceScaleFactor: 2,
    locale: "zh-TW",
  });
  const kitchen = await tablet.newPage();
  await kitchen.goto(`${KITCHEN}/login`, { waitUntil: "networkidle" });
  await kitchen.locator("#username").fill("chef1");
  await kitchen.locator("#password").fill("chef123");
  await kitchen.getByRole("button", { name: "登入" }).click();
  await kitchen.waitForURL(/\/kitchen\//);
  await kitchen.waitForLoadState("networkidle");
  await kitchen.waitForTimeout(1500);
  await shoot(kitchen, "2-kitchen");

  // 4. The owner's dashboard.
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "zh-TW",
  });
  const admin = await desktop.newPage();
  await admin.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await admin.locator("#username").fill("owner1");
  await admin.locator("#password").fill("owner123");
  await admin.getByRole("button", { name: "登入" }).click();
  await admin.waitForURL(/\/dashboard/);
  await admin.waitForLoadState("networkidle");
  // The first-run checklist would fill the top half of the shot.
  await admin
    .locator("div", { has: admin.getByText("完成店家設定", { exact: true }) })
    .getByRole("button", { name: "關閉" })
    .last()
    .click();
  // Wait out "重新連線中" so the header shows the live connection.
  await admin
    .getByText("即時連線", { exact: true })
    .waitFor({ timeout: 15_000 });
  await admin.waitForTimeout(1000);
  await shoot(admin, "4-dashboard");
} finally {
  await browser.close();
  photoServer.close();
}
