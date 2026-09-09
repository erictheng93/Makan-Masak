/**
 * 店務主流程 → 菜單管理, against a real API and a real D1.
 *
 * Every assertion that matters is made twice: once on what the browser shows,
 * and once on what `GET /api/v1/menu/:restaurantId` returns afterwards. The
 * pair is the point — a UI that renders its own optimistic state after a failed
 * write passes the first check and fails the second.
 */
import { expect, test } from "@playwright/test";
import {
  apiCleanup,
  apiRequest,
  assertAuthenticated,
  assertNoOverlayError,
  e2eName,
  getOwnerContext,
  gotoAdmin,
  installAdminSession,
  POLL_TIMEOUT,
  requireStack,
} from "./admin-e2e";

interface MenuCategory {
  id?: number | string;
  name?: string;
  sortOrder?: number;
}

interface MenuItem {
  id?: number | string;
  name?: string;
  price?: number;
  isAvailable?: boolean | number;
  categoryId?: number | string;
}

interface MenuPayload {
  categories?: MenuCategory[];
  menuItems?: MenuItem[];
  items?: MenuItem[];
}

function allItems(payload: MenuPayload | undefined): MenuItem[] {
  return [...(payload?.menuItems ?? []), ...(payload?.items ?? [])];
}

// Real writes against one shared D1. `fullyParallel` is off for this project,
// but that only serialises within a file — the project also pins workers to 1.
test.describe.configure({ mode: "serial" });

test.describe("菜單管理 (real API)", () => {
  test("owner creates a category through the UI and the API agrees", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const categoryName = e2eName("Category");
    let categoryId: number | undefined;

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/menu", {
        expectApi: `/api/v1/menu/${restaurantId}`,
      });
      await assertAuthenticated(page);

      await page.getByTestId("add-category-btn").click();
      await expect(page.getByTestId("admin-category-form")).toBeVisible();
      await page.getByTestId("admin-category-name-input").fill(categoryName);
      await page.getByTestId("admin-category-sort-order-input").fill("990");

      // Arm before the click: the same URL is re-fetched by the list refresh
      // milliseconds later, so the method clause is load-bearing.
      const created = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/menu/${restaurantId}/categories`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("admin-category-submit").click();
      const response = await created;
      expect(
        response.ok(),
        `category create returned ${response.status()}`,
      ).toBe(true);

      const body = (await response.json()) as { data?: MenuCategory };
      categoryId = Number(body.data?.id);
      expect(Number.isFinite(categoryId), "created category id").toBe(true);

      await expect(
        page.locator(`[data-testid="category-row"]`).filter({
          hasText: categoryName,
        }),
      ).toBeVisible();

      // The half the UI cannot fake.
      await expect
        .poll(
          async () => {
            const menu = await apiRequest<MenuPayload>(
              `/api/v1/menu/${restaurantId}`,
            );
            return menu.body.data?.categories?.find(
              (category) => Number(category.id) === categoryId,
            )?.name;
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(categoryName);

      await assertNoOverlayError(page);
    } finally {
      if (Number.isFinite(categoryId)) {
        await apiCleanup(`/api/v1/menu/categories/${categoryId}`, token);
      }
    }
  });

  test("owner creates a menu item and it reaches the real menu", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();

    // Provision the category this item needs through the same public API the
    // cleanup path uses, rather than depending on seed data that the repo's
    // seed file does not actually create.
    const categoryName = e2eName("ItemCategory");
    const categoryResult = await apiRequest<MenuCategory>(
      `/api/v1/menu/${restaurantId}/categories`,
      { token, method: "POST", body: { name: categoryName, sortOrder: 991 } },
    );
    expect(
      categoryResult.ok,
      `category fixture create returned ${categoryResult.status}`,
    ).toBe(true);
    const categoryId = Number(categoryResult.body.data?.id);

    const itemName = e2eName("Item");
    let itemId: number | undefined;

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/menu", {
        expectApi: `/api/v1/menu/${restaurantId}`,
      });
      await assertAuthenticated(page);

      await page.getByTestId("admin-menu-add-item").click();
      await expect(page.getByTestId("item-modal")).toBeVisible();
      await page.getByTestId("menu-item-name-input").fill(itemName);
      await page.getByTestId("menu-item-price-input").fill("128");
      await page
        .getByTestId("menu-item-category-select")
        .selectOption(String(categoryId));

      const created = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/menu/${restaurantId}/items`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("menu-item-submit").click();
      const response = await created;
      expect(response.ok(), `item create returned ${response.status()}`).toBe(
        true,
      );

      const body = (await response.json()) as { data?: MenuItem };
      itemId = Number(body.data?.id);
      expect(Number.isFinite(itemId), "created menu item id").toBe(true);

      await expect(page.getByTestId(`admin-menu-item-${itemId}`)).toBeVisible();

      // Price is asserted in the API's own units so a cents/dollars drift
      // cannot hide behind a formatted string.
      await expect
        .poll(
          async () => {
            const menu = await apiRequest<MenuPayload>(
              `/api/v1/menu/${restaurantId}`,
            );
            const found = allItems(menu.body.data).find(
              (item) => Number(item.id) === itemId,
            );
            return found
              ? { name: found.name, price: Number(found.price) }
              : undefined;
          },
          { timeout: POLL_TIMEOUT },
        )
        .toEqual({ name: itemName, price: 128 });

      await assertNoOverlayError(page);
    } finally {
      if (Number.isFinite(itemId)) {
        await apiCleanup(`/api/v1/menu/items/${itemId}`, token);
      }
      if (Number.isFinite(categoryId)) {
        await apiCleanup(`/api/v1/menu/categories/${categoryId}`, token);
      }
    }
  });

  test("owner toggles availability and the change persists server-side", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();

    const categoryResult = await apiRequest<MenuCategory>(
      `/api/v1/menu/${restaurantId}/categories`,
      {
        token,
        method: "POST",
        body: { name: e2eName("ToggleCategory"), sortOrder: 992 },
      },
    );
    const categoryId = Number(categoryResult.body.data?.id);

    const itemResult = await apiRequest<MenuItem>(
      `/api/v1/menu/${restaurantId}/items`,
      {
        token,
        method: "POST",
        body: {
          name: e2eName("ToggleItem"),
          price: 99,
          categoryId,
          isAvailable: true,
        },
      },
    );
    expect(
      itemResult.ok,
      `item fixture create returned ${itemResult.status}`,
    ).toBe(true);
    const itemId = Number(itemResult.body.data?.id);

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/menu", {
        expectApi: `/api/v1/menu/${restaurantId}`,
      });
      await assertAuthenticated(page);

      const toggle = page.getByTestId(`admin-menu-item-toggle-${itemId}`);
      await expect(toggle).toBeVisible();

      const toggled = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/menu/items/${itemId}`) &&
          ["PUT", "PATCH"].includes(response.request().method()),
      );
      await toggle.click();
      const response = await toggled;
      expect(
        response.ok(),
        `availability toggle returned ${response.status()}`,
      ).toBe(true);

      // #261 reported "售完在後台仍顯示供應中" — the server value is the
      // only thing that settles whether that is fixed.
      await expect
        .poll(
          async () => {
            const menu = await apiRequest<MenuPayload>(
              `/api/v1/menu/${restaurantId}`,
            );
            const found = allItems(menu.body.data).find(
              (item) => Number(item.id) === itemId,
            );
            return found?.isAvailable === true || found?.isAvailable === 1;
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(false);

      await assertNoOverlayError(page);
    } finally {
      if (Number.isFinite(itemId)) {
        await apiCleanup(`/api/v1/menu/items/${itemId}`, token);
      }
      if (Number.isFinite(categoryId)) {
        await apiCleanup(`/api/v1/menu/categories/${categoryId}`, token);
      }
    }
  });
});
