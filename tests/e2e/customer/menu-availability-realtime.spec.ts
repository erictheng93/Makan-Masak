import { test, expect, type BrowserContext } from "@playwright/test";
import {
  Cleanup,
  createMenuFixture,
  createTable,
  getOwner,
  newDinerContext,
  markDocument,
  expectNoReload,
  recordRealtimeEvents,
  waitForRealtimeAck,
  apiData,
  apiRequest,
  requireStack,
  qrPath,
  suffix,
  API_URL,
} from "./customer-e2e";
import { installAdminSession, ADMIN_URL } from "../admin/admin-e2e";
import { smokeLogin } from "../smoke/smoke-env";

test("all three availability writes reach customer menus, admin and kitchen live", async ({
  browser,
}, testInfo) => {
  await requireStack();
  const cleanup = new Cleanup();
  const contexts: BrowserContext[] = [];
  try {
    const owner = await getOwner();
    const menu = await createMenuFixture(cleanup);
    const table = await createTable(cleanup);
    const diner = await newDinerContext(browser);
    contexts.push(diner.context);
    const shop = await newDinerContext(browser);
    contexts.push(shop.context);
    const adminContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(adminContext);
    const admin = await adminContext.newPage();
    await installAdminSession(admin, {
      token: owner.token,
      user: { id: owner.userId, role: 1, restaurantId: owner.restaurantId },
    });
    const chefName = `e2e_menu_chef_${suffix()}`;
    const chef = await apiData<{ id: string }>("create chef", "/api/v1/users", {
      token: owner.token,
      method: "POST",
      body: {
        username: chefName,
        fullName: "E2E Menu Chef",
        password: "E2e-Menu-2026!",
        role: 2,
        restaurantId: owner.restaurantId,
      },
    });
    cleanup.add("delete chef", () =>
      apiRequest(`/api/v1/users/${chef.id}`, {
        token: owner.token,
        method: "DELETE",
      }),
    );
    const chefLogin = await smokeLogin(API_URL, chefName, "E2e-Menu-2026!");
    const kitchenContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(kitchenContext);
    await kitchenContext.addInitScript((session) => {
      localStorage.setItem("kitchen_auth_token", session.token!);
      localStorage.setItem(
        "kitchen_user",
        JSON.stringify({ ...session.user, permissions: [] }),
      );
      localStorage.setItem(
        "kitchen_settings",
        JSON.stringify({ autoRefresh: false }),
      );
      localStorage.setItem("makanmakan_locale", "zh-TW");
    }, chefLogin);
    const kitchen = await kitchenContext.newPage();
    // Offline emulation leaves existing WebSockets open in Chromium. Track the
    // real sockets so reconnect checks can close the transport itself.
    for (const context of contexts) {
      await context.addInitScript(() => {
        const sockets: WebSocket[] = [];
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            if (protocols !== "vite-hmr") sockets.push(this);
          }
        };
        Object.assign(window, {
          closeRealtimeTransport: () =>
            Promise.all(
              sockets
                .filter((socket) => socket.readyState === WebSocket.OPEN)
                .map(
                  (socket) =>
                    new Promise<void>((resolve) => {
                      socket.addEventListener("close", () => resolve(), {
                        once: true,
                      });
                      socket.close();
                    }),
                ),
            ),
        });
      });
    }
    const dinerFrames = recordRealtimeEvents(diner.page);
    const shopFrames = recordRealtimeEvents(shop.page);
    const adminFrames = recordRealtimeEvents(admin);
    const kitchenFrames = recordRealtimeEvents(kitchen);
    await diner.page.goto(qrPath(table.qrCode));
    await shop.page.goto(
      `/restaurant/${owner.restaurantId}/shop/menu?type=takeaway`,
    );
    await admin.goto(`${ADMIN_URL}/dashboard/menu`);
    await kitchen.goto(
      `${process.env.E2E_KITCHEN_URL ?? "http://localhost:3002"}/kitchen/${owner.restaurantId}`,
    );
    const id = menu.plainItem.id;
    const dinerCard = diner.page.getByTestId(`menu-item-card-${id}`);
    const shopCard = shop.page.getByTestId(`menu-item-card-${id}`);
    await expect(dinerCard).toBeVisible({ timeout: 30_000 });
    await expect(shopCard).toBeVisible({ timeout: 30_000 });
    await Promise.all(
      [dinerFrames, shopFrames, adminFrames, kitchenFrames].map(
        waitForRealtimeAck,
      ),
    );
    await admin.getByTestId("admin-menu-search").fill(menu.plainItem.name);
    const adminCard = admin.getByTestId(`admin-menu-item-${id}`);
    await expect(adminCard).toBeVisible();
    await dinerCard.getByTestId(`menu-item-add-${id}`).click();
    await expect(diner.page.getByTestId("cart-count")).toHaveText("1");
    await Promise.all(
      [diner.page, shop.page, admin, kitchen].map(markDocument),
    );
    const writes = [
      (isAvailable: boolean) =>
        apiRequest(`/api/v1/menu/items/${id}`, {
          token: owner.token,
          method: "PUT",
          body: { isAvailable },
        }),
      (isAvailable: boolean) =>
        apiRequest(`/api/v1/menu/${owner.restaurantId}/items/availability`, {
          token: owner.token,
          method: "PATCH",
          body: { updates: [{ id, isAvailable }] },
        }),
      (isAvailable: boolean) =>
        apiRequest("/api/v1/manager/actions", {
          token: owner.token,
          method: "POST",
          body: {
            action: "update_menu_availability",
            resource: "menu_item",
            resourceId: String(id),
            restaurantId: owner.restaurantId,
            payload: { isAvailable },
            reason: "E2E menu availability",
          },
        }),
    ];
    for (const [index, write] of writes.entries()) {
      for (const available of [false, true]) {
        const beforeStaff = kitchenFrames.filter(
          (type) => type === "menu_availability_update",
        ).length;
        const beforeShop = shopFrames.filter(
          (type) => type === "menu_item_update",
        ).length;
        const before = dinerFrames.filter(
          (type) => type === "menu_item_update",
        ).length;
        const result = await write(available);
        expect(result.ok, JSON.stringify(result.body)).toBe(true);
        await expect
          .poll(
            () =>
              dinerFrames.filter((type) => type === "menu_item_update").length,
          )
          .toBeGreaterThan(before);
        await expect
          .poll(
            () =>
              shopFrames.filter((type) => type === "menu_item_update").length,
          )
          .toBeGreaterThan(beforeShop);
        await expect
          .poll(
            () =>
              kitchenFrames.filter(
                (type) => type === "menu_availability_update",
              ).length,
          )
          .toBeGreaterThan(beforeStaff);
        await expect(dinerCard).toHaveCount(available ? 1 : 0);
        await expect(shopCard).toHaveCount(available ? 1 : 0);
        await expect(adminCard).toContainText(
          available ? "Available" : "Sold Out",
        );
        await expect(
          kitchen
            .locator(".Vue-Toastification__toast-body")
            .filter({
              hasText: `${menu.plainItem.name} 已${available ? "恢復" : "停止"}供應`,
            })
            .first(),
        ).toBeVisible();
        await expect(diner.page.getByTestId("cart-count")).toHaveText("1");
        await Promise.all(
          [diner.page, shop.page, admin, kitchen].map(expectNoReload),
        );
        await testInfo.attach(`write-${index}-${available}`, {
          body: await diner.page.screenshot(),
          contentType: "image/png",
        });
      }
    }
    const dinerAcks = dinerFrames.filter(
      (type) => type === "connection_ack",
    ).length;
    await diner.page.evaluate("window.closeRealtimeTransport()");
    await diner.context.setOffline(true);
    await apiData("offline sale out", `/api/v1/menu/items/${id}`, {
      token: owner.token,
      method: "PUT",
      body: { isAvailable: false },
    });
    await expect(shopCard).toHaveCount(0);
    await diner.context.setOffline(false);
    await expect
      .poll(
        () => dinerFrames.filter((type) => type === "connection_ack").length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(dinerAcks);
    await expect(dinerCard).toHaveCount(0, { timeout: 30_000 });
    await expectNoReload(diner.page);
    await apiData("restore fixture", `/api/v1/menu/items/${id}`, {
      token: owner.token,
      method: "PUT",
      body: { isAvailable: true },
    });
    await expect(dinerCard).toHaveCount(1);
    await expect(shopCard).toHaveCount(1);
    const adminAcks = adminFrames.filter(
      (type) => type === "connection_ack",
    ).length;
    await admin.evaluate("window.closeRealtimeTransport()");
    await adminContext.setOffline(true);
    await apiData("admin offline sale out", `/api/v1/menu/items/${id}`, {
      token: owner.token,
      method: "PUT",
      body: { isAvailable: false },
    });
    await expect(shopCard).toHaveCount(0);
    await adminContext.setOffline(false);
    await expect
      .poll(
        () => adminFrames.filter((type) => type === "connection_ack").length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(adminAcks);
    await expect(adminCard).toContainText("Sold Out");
    await expectNoReload(admin);
    await apiData("final restore", `/api/v1/menu/items/${id}`, {
      token: owner.token,
      method: "PUT",
      body: { isAvailable: true },
    });
    const denied = await apiRequest("/api/v1/realtime/auth/menu-token", {
      method: "POST",
      body: { restaurantId: "missing" },
    });
    expect(denied.ok).toBe(false);
    const realtimeUrl = new URL(
      process.env.E2E_REALTIME_URL ?? "http://127.0.0.1:8788",
    );
    realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";
    realtimeUrl.pathname = `/menu/${owner.restaurantId}`;
    expect(
      await diner.page.evaluate(
        (url) =>
          new Promise<boolean>((resolve) => {
            const socket = new WebSocket(url);
            socket.onopen = () => {
              socket.close();
              resolve(false);
            };
            socket.onerror = () => resolve(true);
            setTimeout(() => {
              socket.close();
              resolve(false);
            }, 5000);
          }),
        realtimeUrl.toString(),
      ),
    ).toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await cleanup.run();
  }
});
