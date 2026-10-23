import {
  expect,
  type Locator,
  type Page,
  test,
  type Route,
} from "@playwright/test";
import {
  getSmokeOwnerSession,
  hasSmokeOwnerCredentials,
  setSmokeOwnerSession,
  type SmokeOwnerSession,
} from "./owner-auth";

const ADMIN_URL = process.env.SMOKE_ADMIN_URL || "http://localhost:3001";

const LABELS = {
  pageTitle: /Menu Management/i,
  searchPlaceholder: /Search menu items/i,
  addItemBtn: /^Add Item$/i,
  editButton: /^Edit$/i,
  saveButton: /^Add$/i,
  updateButton: /^Update$/i,
  deleteButton: /^Delete$/i,
  confirmButton: /^Delete$/i,
  cancelButton: /^Cancel$/i,
  allFilter: /^All$/i,
  availableFilter: /^Available$/i,
  unavailableFilter: /^Unavailable$/i,
  filterAllItems: /All Items/i,
  menuItemHeading: "h3",
  noDataTitle: /No Menu Items/i,
  soldOut: /Sold Out/i,
  available: /Available/i,
};

type OwnerContext = SmokeOwnerSession;

interface MockRouteResult {
  status: number;
  body: unknown;
}

interface MockCounters {
  menu: number;
  categoryCreate: number;
  categoryUpdate: number;
  categoryDelete: number;
  categoryReorder: number;
  itemCreate: number;
  itemUpdate: number;
  itemDelete: number;
}

interface MenuMockHandlers {
  menu?: () => MockRouteResult;
  categoryCreate?: () => MockRouteResult;
  categoryUpdate?: () => MockRouteResult;
  categoryDelete?: () => MockRouteResult;
  categoryReorder?: () => MockRouteResult;
  itemCreate?: () => MockRouteResult;
  itemUpdate?: () => MockRouteResult;
  itemDelete?: () => MockRouteResult;
}

interface MenuCategoryFixture {
  id: number;
  name: string;
  nameEn?: string;
  description?: string;
  sortOrder: number;
  isActive?: boolean;
  isVisible?: boolean;
}

interface MenuItemFixture {
  id: number;
  categoryId: number;
  catalogType: "menu_item" | "product";
  name: string;
  nameEn?: string;
  description?: string;
  price: number;
  imageUrl?: string | null;
  isFeatured: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

interface MenuState {
  categories: MenuCategoryFixture[];
  menuItems: MenuItemFixture[];
}

function successResponse(body: unknown): MockRouteResult {
  return {
    status: 200,
    body: { success: true, data: body },
  };
}

function failureResponse(message = "mocked API failure"): MockRouteResult {
  return {
    status: 500,
    body: {
      success: false,
      error: { message },
    },
  };
}

function responsePayload(result: MockRouteResult) {
  return {
    status: result.status,
    contentType: "application/json",
    body: JSON.stringify(result.body),
  };
}

const defaultMenuState: MenuState = {
  categories: [
    { id: 201, name: "Appetizers", sortOrder: 0 },
    { id: 202, name: "Mains", sortOrder: 1 },
    { id: 203, name: "Desserts", sortOrder: 2 },
  ],
  menuItems: [
    {
      id: 5001,
      categoryId: 201,
      catalogType: "menu_item",
      name: "Spring Rolls",
      nameEn: "Spring Rolls",
      description: "Crispy",
      price: 18,
      isFeatured: false,
      isAvailable: true,
      sortOrder: 1,
    },
    {
      id: 5002,
      categoryId: 201,
      catalogType: "menu_item",
      name: "Soup Dumplings",
      nameEn: "Soup Dumplings",
      description: "Wonton style",
      price: 26,
      isFeatured: true,
      isAvailable: true,
      sortOrder: 2,
    },
    {
      id: 5003,
      categoryId: 202,
      catalogType: "menu_item",
      name: "Grilled Chicken",
      nameEn: "Grilled Chicken",
      description: "Garlic",
      price: 42,
      isFeatured: true,
      isAvailable: true,
      sortOrder: 1,
    },
    {
      id: 5004,
      categoryId: 202,
      catalogType: "menu_item",
      name: "Seaweed Salad",
      nameEn: "Seaweed Salad",
      description: "Cold",
      price: 24,
      isFeatured: false,
      isAvailable: false,
      sortOrder: 2,
    },
    {
      id: 5005,
      categoryId: 203,
      catalogType: "menu_item",
      name: "Mango Pudding",
      nameEn: "Mango Pudding",
      description: "Smooth",
      price: 18,
      isFeatured: false,
      isAvailable: true,
      sortOrder: 1,
    },
  ],
};

function cloneState(state: MenuState): MenuState {
  return JSON.parse(JSON.stringify(state));
}

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function isCategoryCreatePath(path: string) {
  return /^\/api\/v1\/menu\/[^/]+\/categories\/?$/.test(path);
}

async function readJsonBody(route: Route) {
  const raw = route.request().postData();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function openOwnerMenu(page: Page, ctx: OwnerContext) {
  await setSmokeOwnerSession(page, ctx);
  await page.goto(`${ADMIN_URL}/dashboard/menu`, {
    waitUntil: "networkidle",
  });
}

function installOwnerMenuMocks(
  page: Page,
  handlers: Partial<MenuMockHandlers> = {},
) {
  const state: MenuState = cloneState(defaultMenuState);
  let nextCategoryId = 900;
  let nextItemId = 9100;
  const stats: MockCounters = {
    menu: 0,
    categoryCreate: 0,
    categoryUpdate: 0,
    categoryDelete: 0,
    categoryReorder: 0,
    itemCreate: 0,
    itemUpdate: 0,
    itemDelete: 0,
  };

  page.route("**/api/v1/menu/**", async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = new URL(req.url());
    const path = url.pathname;
    const includeAll = url.searchParams.get("includeAll") === "true";

    if (
      method === "GET" &&
      /^\/api\/v1\/menu\/[^/]+$/.test(path) &&
      includeAll
    ) {
      stats.menu += 1;
      const result = handlers.menu
        ? handlers.menu()
        : successResponse(cloneState(state));
      await route.fulfill(responsePayload(result));
      return;
    }

    if (method === "POST" && isCategoryCreatePath(path)) {
      stats.categoryCreate += 1;
      if (handlers.categoryCreate) {
        await route.fulfill(responsePayload(handlers.categoryCreate()));
        return;
      }

      const body = await readJsonBody(route);
      const name = String((body as { name?: unknown }).name ?? "").trim();
      if (!name) {
        await route.fulfill(
          responsePayload(failureResponse("Missing category name")),
        );
        return;
      }

      const catalog = body as { isVisible?: unknown; isActive?: unknown };
      const created = {
        id: nextCategoryId++,
        name,
        nameEn: String((body as { nameEn?: unknown })?.nameEn ?? ""),
        description: String(
          (body as { description?: unknown })?.description ?? "",
        ),
        sortOrder: toNumber((body as { sortOrder?: unknown })?.sortOrder) ?? 0,
        isVisible:
          typeof catalog.isVisible === "undefined" ? true : !!catalog.isVisible,
        isActive:
          typeof catalog.isActive === "undefined" ? true : !!catalog.isActive,
      };
      state.categories.push(created);
      await route.fulfill(responsePayload(successResponse(created)));
      return;
    }

    if (method === "PUT" && /^\/api\/v1\/menu\/categories\/\d+$/.test(path)) {
      stats.categoryUpdate += 1;
      const match = path.match(/\/menu\/categories\/(\d+)$/);
      const id = toNumber(match?.[1]) ?? 0;
      if (handlers.categoryUpdate) {
        await route.fulfill(responsePayload(handlers.categoryUpdate()));
        return;
      }

      const target = state.categories.find((category) => category.id === id);
      if (!target) {
        await route.fulfill(
          responsePayload(failureResponse("Category not found")),
        );
        return;
      }

      const body = await readJsonBody(route);
      target.name =
        String((body as { name?: unknown })?.name ?? target.name).trim() ||
        target.name;
      const nextNameEn = (body as { nameEn?: unknown } | null)?.nameEn;
      if (nextNameEn !== undefined) target.nameEn = String(nextNameEn);
      const nextDescription = (body as { description?: unknown } | null)
        ?.description;
      if (nextDescription !== undefined) {
        target.description = String(nextDescription);
      }
      target.sortOrder =
        toNumber((body as { sortOrder?: unknown })?.sortOrder) ??
        target.sortOrder;
      await route.fulfill(responsePayload(successResponse(target)));
      return;
    }

    if (
      method === "DELETE" &&
      /^\/api\/v1\/menu\/categories\/\d+$/.test(path)
    ) {
      stats.categoryDelete += 1;
      const match = path.match(/\/menu\/categories\/(\d+)$/);
      const id = toNumber(match?.[1]) ?? 0;
      if (handlers.categoryDelete) {
        await route.fulfill(responsePayload(handlers.categoryDelete()));
        return;
      }

      const existed = state.categories.find((category) => category.id === id);
      if (!existed) {
        await route.fulfill(
          responsePayload(failureResponse("Category not found")),
        );
        return;
      }

      state.categories = state.categories.filter(
        (category) => category.id !== id,
      );
      state.menuItems = state.menuItems.filter(
        (item) => item.categoryId !== id,
      );
      await route.fulfill(
        responsePayload(successResponse({ deletedId: existed.id })),
      );
      return;
    }

    if (
      method === "PATCH" &&
      /^\/api\/v1\/menu\/[^/]+\/categories\/reorder$/.test(path)
    ) {
      stats.categoryReorder += 1;
      if (handlers.categoryReorder) {
        await route.fulfill(responsePayload(handlers.categoryReorder()));
        return;
      }

      const body = await readJsonBody(route);
      const ordered = (body as { categories?: Array<{ id: number | string }> })
        .categories;
      if (Array.isArray(ordered) && ordered.length > 0) {
        const byId = new Map(state.categories.map((cat) => [cat.id, cat]));
        const next = ordered
          .map((entry, idx) => {
            const nextId = toNumber(entry.id);
            const found = nextId ? byId.get(nextId) : undefined;
            if (!found) return null;
            return { ...found, sortOrder: idx };
          })
          .filter((entry): entry is MenuCategoryFixture => entry !== null);
        if (next.length === ordered.length) {
          state.categories = next;
        }
      }
      await route.fulfill(responsePayload(successResponse(cloneState(state))));
      return;
    }

    if (method === "POST" && /^\/api\/v1\/menu\/[^/]+\/items$/.test(path)) {
      stats.itemCreate += 1;
      if (handlers.itemCreate) {
        await route.fulfill(responsePayload(handlers.itemCreate()));
        return;
      }

      const body = await readJsonBody(route);
      const name = String((body as { name?: unknown })?.name ?? "").trim();
      if (!name) {
        await route.fulfill(
          responsePayload(failureResponse("Missing item name")),
        );
        return;
      }

      const created: MenuItemFixture = {
        id: nextItemId++,
        categoryId:
          toNumber((body as { categoryId?: unknown })?.categoryId) ||
          state.categories[0].id,
        catalogType:
          (body as { catalogType?: unknown })?.catalogType === "product"
            ? "product"
            : "menu_item",
        name,
        nameEn: String((body as { nameEn?: unknown })?.nameEn ?? ""),
        description: String(
          (body as { description?: unknown })?.description ?? "",
        ),
        price: toNumber((body as { price?: unknown })?.price) ?? 0,
        imageUrl:
          typeof (body as { imageUrl?: unknown })?.imageUrl === "string" &&
          (body as { imageUrl?: unknown }).imageUrl
            ? String((body as { imageUrl?: unknown }).imageUrl)
            : null,
        isFeatured:
          (body as { isFeatured?: unknown })?.isFeatured === true
            ? true
            : false,
        isAvailable:
          (body as { isAvailable?: unknown })?.isAvailable === false
            ? false
            : true,
        sortOrder: toNumber((body as { sortOrder?: unknown })?.sortOrder) ?? 0,
      };
      state.menuItems.push(created);
      await route.fulfill(responsePayload(successResponse(created)));
      return;
    }

    if (method === "PUT" && /^\/api\/v1\/menu\/items\/\d+$/.test(path)) {
      stats.itemUpdate += 1;
      const match = path.match(/\/items\/(\d+)$/);
      const id = toNumber(match?.[1]) ?? 0;
      if (handlers.itemUpdate) {
        await route.fulfill(responsePayload(handlers.itemUpdate()));
        return;
      }

      const target = state.menuItems.find((item) => item.id === id);
      if (!target) {
        await route.fulfill(responsePayload(failureResponse("Item not found")));
        return;
      }

      const body = await readJsonBody(route);
      target.name =
        String((body as { name?: unknown })?.name ?? target.name).trim() ||
        target.name;
      const nextDescription = (body as { description?: unknown } | null)
        ?.description;
      if (nextDescription !== undefined) {
        target.description = String(nextDescription);
      }
      target.price =
        toNumber((body as { price?: unknown })?.price) ?? target.price;
      target.isAvailable =
        (body as { isAvailable?: unknown })?.isAvailable === undefined
          ? target.isAvailable
          : !!(body as { isAvailable?: unknown }).isAvailable;
      target.categoryId =
        toNumber((body as { categoryId?: unknown })?.categoryId) ??
        target.categoryId;
      await route.fulfill(responsePayload(successResponse(target)));
      return;
    }

    if (method === "DELETE" && /^\/api\/v1\/menu\/items\/\d+$/.test(path)) {
      stats.itemDelete += 1;
      const match = path.match(/\/items\/(\d+)$/);
      const id = toNumber(match?.[1]) ?? 0;
      if (handlers.itemDelete) {
        await route.fulfill(responsePayload(handlers.itemDelete()));
        return;
      }

      const existed = state.menuItems.find((item) => item.id === id);
      state.menuItems = state.menuItems.filter((item) => item.id !== id);
      if (!existed) {
        await route.fulfill(responsePayload(failureResponse("Item not found")));
        return;
      }

      await route.fulfill(
        responsePayload(successResponse({ deletedId: existed.id })),
      );
      return;
    }

    await route.continue();
  });

  return {
    stats,
    restore: () => {
      page.unroute("**/api/v1/menu/**");
    },
  };
}

async function waitForMenuPageReady(page: Page) {
  await expect(
    page.getByRole("heading", { name: LABELS.pageTitle }),
  ).toBeVisible();
  await expect(page.getByPlaceholder(LABELS.searchPlaceholder)).toBeVisible();
  await expect(addCategoryButton(page)).toBeVisible();
  await expect(addItemButton(page)).toBeVisible();
}

function addCategoryButton(page: Page): Locator {
  return page.getByTestId("add-category-btn");
}

function addItemButton(page: Page): Locator {
  return page.getByRole("button", { name: LABELS.addItemBtn }).first();
}

function menuCategoryRows(page: Page): Locator {
  return page.getByTestId("category-row");
}

function menuCategoryByName(page: Page, name: string): Locator {
  return menuCategoryRows(page).filter({ hasText: name });
}

function menuItemCardByName(page: Page, name: string): Locator {
  return page.locator("div.rounded-2xl").filter({
    has: page.getByRole("heading", { level: 3, name, exact: true }),
  });
}

function menuItemByName(page: Page, name: string): Locator {
  return page.getByRole("heading", { level: 3, name, exact: true });
}

function itemActionButton(
  page: Page,
  itemName: string,
  index: number,
): Locator {
  return menuItemCardByName(page, itemName).getByRole("button").nth(index);
}

async function fillNewCategory(page: Page, name: string) {
  await addCategoryButton(page).click();
  const form = page.locator("[data-category-form]");
  await expect(form).toBeVisible();
  await form.getByRole("textbox", { name: /Category Name/i }).fill(name);
  await form
    .getByRole("textbox", { name: /Description|Optional description/i })
    .fill(`QA created ${name}`);
  await form.locator('input[type="number"]').fill("10");
}

async function saveCategory(page: Page, isUpdate = false) {
  const label = isUpdate ? LABELS.updateButton : LABELS.saveButton;
  await page
    .locator("[data-category-form]")
    .getByRole("button", { name: label })
    .click();
  await expect(page.locator("[data-category-form]")).not.toBeVisible();
}

async function saveNewCategoryAndWaitForCreate(page: Page) {
  const categoryCreateResponse = page.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(response.url());

    return (
      request.method().toUpperCase() === "POST" &&
      isCategoryCreatePath(url.pathname)
    );
  });

  await saveCategory(page);
  const response = await categoryCreateResponse;
  expect(response.ok(), `category create status ${response.status()}`).toBe(
    true,
  );
}

async function openCategoryForEdit(page: Page, name: string) {
  const row = menuCategoryByName(page, name);
  await row.hover();
  await row.getByRole("button", { name: LABELS.editButton }).click();
  await expect(page.locator("[data-category-form]")).toBeVisible();
}

function itemCategoryValue(page: Page, value: string | number) {
  return page.getByRole("combobox", { name: /Category/i }).selectOption({
    label: String(value),
  });
}

async function fillNewItem(
  page: Page,
  payload: {
    name: string;
    category: string;
    price: string;
    description?: string;
    available?: boolean;
  },
) {
  await addItemButton(page).click();
  const modal = page.locator('[data-testid="item-modal"]');
  await expect(modal).toBeVisible();
  await modal.getByTestId("menu-item-name-input").fill(payload.name);
  if (payload.description) {
    await modal.locator("textarea").fill(payload.description);
  }
  await modal.getByTestId("menu-item-price-input").fill(payload.price);
  await modal.getByTestId("menu-item-category-select").selectOption({
    label: payload.category,
  });
  if (payload.available === false) {
    const checkbox = modal.getByRole("checkbox", { name: /Available/i });
    await checkbox.uncheck();
  }
}

async function confirmDelete(page: Page, name = LABELS.confirmButton) {
  await page
    .locator(".fixed.inset-0.z-50")
    .getByRole("button", { name })
    .last()
    .click();
}

function dragFirstCategoryToSecond(page: Page): Promise<void> {
  const rows = menuCategoryRows(page);
  const fromHandle = rows.nth(0).locator(".drag-handle");
  const toHandle = rows.nth(1).locator(".drag-handle");
  return fromHandle.dragTo(toHandle);
}

test.describe("Smoke: owner menu management usage state", () => {
  test.beforeEach(async () => {
    test.skip(
      !hasSmokeOwnerCredentials,
      "Owner credentials or admin URL is not configured",
    );
  });

  test("1) Menu Management renders categories and items", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await expect(menuCategoryByName(page, "Appetizers")).toBeVisible();
    await expect(menuCategoryByName(page, "Mains")).toBeVisible();
    await expect(menuCategoryByName(page, "Desserts")).toBeVisible();

    await expect(menuItemByName(page, "Spring Rolls")).toBeVisible();
    await expect(menuItemByName(page, "Grilled Chicken")).toBeVisible();
    await expect(menuItemByName(page, "Mango Pudding")).toBeVisible();
  });

  test("2) Search filter by item name", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await page.getByPlaceholder(LABELS.searchPlaceholder).fill("chicken");
    await expect(menuItemByName(page, "Grilled Chicken")).toBeVisible();
    await expect(menuItemByName(page, "Spring Rolls")).toBeHidden();

    await page.getByPlaceholder(LABELS.searchPlaceholder).fill("");
    await expect(menuItemByName(page, "Spring Rolls")).toBeVisible();
  });

  test("3) Status filter shows unavailable items", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await page.getByRole("button", { name: LABELS.unavailableFilter }).click();
    await expect(menuItemByName(page, "Seaweed Salad")).toBeVisible();
    await expect(menuItemByName(page, "Grilled Chicken")).toBeHidden();

    await page.getByRole("button", { name: LABELS.availableFilter }).click();
    await expect(menuItemByName(page, "Grilled Chicken")).toBeVisible();
  });

  test("4) Category filter by All/Mains works", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await expect(menuItemByName(page, "Spring Rolls")).toBeVisible();
    await menuCategoryByName(page, "Mains").click();
    await expect(menuItemByName(page, "Grilled Chicken")).toBeVisible();
    await expect(menuItemByName(page, "Spring Rolls")).toBeHidden();
    await page.getByText(LABELS.filterAllItems, { exact: true }).click();
    await expect(menuItemByName(page, "Spring Rolls")).toBeVisible();
    await expect(menuItemByName(page, "Grilled Chicken")).toBeVisible();
  });

  test("5) Add category using modal form", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await fillNewCategory(page, "Beverages");
    await saveNewCategoryAndWaitForCreate(page);

    await expect(mocks.stats.categoryCreate).toBeGreaterThan(0);
    await expect(menuCategoryByName(page, "Beverages")).toBeVisible();
  });

  test("6) Edit category", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await openCategoryForEdit(page, "Desserts");
    await page
      .locator("[data-category-form]")
      .getByRole("textbox", { name: /Category Name/i })
      .fill("Desserts Club");
    await saveCategory(page, true);
    await expect(menuCategoryByName(page, "Desserts Club")).toBeVisible();
    await expect(mocks.stats.categoryUpdate).toBeGreaterThan(0);
  });

  test("7) Delete category uses confirm modal and removes items", async ({
    page,
  }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    const targetRow = menuCategoryByName(page, "Appetizers");
    await targetRow.hover();
    await targetRow.getByRole("button", { name: LABELS.deleteButton }).click();
    await confirmDelete(page);

    await expect(mocks.stats.categoryDelete).toBeGreaterThan(0);
    await expect(targetRow).toBeHidden();
    await expect(menuItemByName(page, "Spring Rolls")).toBeHidden();
    await expect(menuItemByName(page, "Soup Dumplings")).toBeHidden();
  });

  test("8) Create menu item and verify in card list", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await fillNewItem(page, {
      name: "Crispy Squid",
      category: "Mains",
      price: "38",
      description: "Chef special",
    });
    await page
      .locator('[data-testid="item-modal"]')
      .getByRole("button", { name: LABELS.saveButton })
      .click();
    await expect(page.locator('[data-testid="item-modal"]')).not.toBeVisible();

    await expect(mocks.stats.itemCreate).toBeGreaterThan(0);
    await expect(menuItemByName(page, "Crispy Squid")).toBeVisible();
  });

  test("9) Edit menu item updates existing item name and price", async ({
    page,
  }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    const card = menuItemCardByName(page, "Mango Pudding");
    await card.getByRole("button", { name: LABELS.editButton }).click();
    const modal = page.locator('[data-testid="item-modal"]');
    await modal.getByTestId("menu-item-name-input").fill("Mango Cheesecake");
    await modal.getByTestId("menu-item-price-input").fill("22");
    await modal.getByRole("button", { name: LABELS.updateButton }).click();
    await expect(page.locator('[data-testid="item-modal"]')).not.toBeVisible();

    await expect(mocks.stats.itemUpdate).toBeGreaterThan(0);
    await expect(menuItemByName(page, "Mango Cheesecake")).toBeVisible();
    await expect(menuItemByName(page, "Mango Pudding")).toBeHidden();
  });

  test("10) Toggle menu item availability in card action", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    const card = menuItemCardByName(page, "Grilled Chicken");
    await card.getByRole("button").nth(1).click();
    await expect(card.getByText(LABELS.soldOut)).toBeVisible();

    await card.getByRole("button").nth(1).click();
    await expect(card.getByText(LABELS.available)).toBeVisible();
  });

  test("11) Delete menu item after confirmation", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    const target = menuItemCardByName(page, "Seaweed Salad");
    await target.getByRole("button").nth(2).click();
    await confirmDelete(page);

    await expect(mocks.stats.itemDelete).toBeGreaterThan(0);
    await expect(menuItemByName(page, "Seaweed Salad")).toBeHidden();
  });

  test("12) CSV import preview and create two menu items", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    const csvText = [
      "name,category,price,description,imageUrl,isFeatured,isAvailable,sortOrder,catalogType,tags,keywords",
      '"Imported Wonton","Appetizers",16,"Crisp","",false,true,5,menu_item,"soup","fresh soft"',
      '"Imported Curry","Appetizers",29,"Spicy","",false,true,6,menu_item,"main","hot curry"',
    ].join("\n");

    // Bulk import is collapsed behind its header button by default.
    await page.getByTestId("admin-menu-bulk-import-toggle").click();
    await page.locator('[data-testid="menu-item-import-csv"]').fill(csvText);
    await page.getByTestId("menu-item-import-submit").click();
    await expect(
      page.locator('[data-testid="menu-item-import-csv"]'),
    ).toHaveValue(csvText);

    await expect.poll(() => mocks.stats.itemCreate).toBeGreaterThanOrEqual(2);
    await expect(menuItemByName(page, "Imported Wonton")).toBeVisible();
    await expect(menuItemByName(page, "Imported Curry")).toBeVisible();
  });

  test("13) Category drag reorder triggers reorder API", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    const rowCount = await menuCategoryRows(page).count();
    if (rowCount >= 2) {
      await dragFirstCategoryToSecond(page);
      await expect(mocks.stats.categoryReorder).toBeGreaterThan(0);
    }
  });

  test("14) Single create-item failure keeps UI functional (graceful)", async ({
    page,
  }) => {
    const session = await getSmokeOwnerSession();
    const mocks = installOwnerMenuMocks(page, {
      itemCreate: () => failureResponse("forced failure"),
    });
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await fillNewItem(page, {
      name: "Failure Item",
      category: "Mains",
      price: "18",
      description: "Should fail",
    });
    await page
      .locator('[data-testid="item-modal"]')
      .getByRole("button", { name: LABELS.saveButton })
      .click();
    await page
      .locator('[data-testid="item-modal"]')
      .waitFor({ state: "hidden" });

    await expect(mocks.stats.itemCreate).toBeGreaterThan(0);
    await expect(menuItemByName(page, "Failure Item")).toBeHidden();
    await expect(menuItemByName(page, "Spring Rolls")).toBeVisible();
  });

  test("15) Single menu fetch failure still keeps action controls", async ({
    page,
  }) => {
    const session = await getSmokeOwnerSession();
    installOwnerMenuMocks(page, {
      menu: () => failureResponse("fetch failed"),
    });
    await openOwnerMenu(page, session);

    await expect(
      page.getByRole("heading", { name: LABELS.pageTitle }),
    ).toBeVisible();
    await expect(addItemButton(page)).toBeVisible();
    await expect(addCategoryButton(page)).toBeVisible();
    await expect(page.getByText(LABELS.noDataTitle)).toBeVisible();
    await expect(page.getByPlaceholder(LABELS.searchPlaceholder)).toBeVisible();
  });

  test("16) 全 API 失敗後，重新載入可恢復", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    let round = 0;
    const mocks = installOwnerMenuMocks(page, {
      menu: () => {
        round += 1;
        return round === 1
          ? failureResponse("all failed")
          : successResponse(cloneState(defaultMenuState));
      },
      categoryCreate: () =>
        round === 1 ? failureResponse("all failed") : successResponse({}),
      categoryUpdate: () =>
        round === 1 ? failureResponse("all failed") : successResponse({}),
      categoryDelete: () =>
        round === 1 ? failureResponse("all failed") : successResponse({}),
      categoryReorder: () =>
        round === 1 ? failureResponse("all failed") : successResponse({}),
      itemCreate: () =>
        round === 1 ? failureResponse("all failed") : successResponse({}),
      itemUpdate: () =>
        round === 1 ? failureResponse("all failed") : successResponse({}),
      itemDelete: () =>
        round === 1 ? failureResponse("all failed") : successResponse({}),
    });

    await openOwnerMenu(page, session);
    await expect(page.getByText(LABELS.noDataTitle)).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect(menuItemByName(page, "Spring Rolls")).toBeVisible();
    await expect(mocks.stats.menu).toBeGreaterThan(1);
  });

  test("17) 30 秒輪詢模擬刷新可見新資料", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    let round = 0;
    const mocks = installOwnerMenuMocks(page, {
      menu: () => {
        round += 1;
        const state = cloneState(defaultMenuState);
        if (round >= 3) {
          state.menuItems.push({
            id: 9300,
            categoryId: 201,
            catalogType: "menu_item",
            name: "Polling Ramen",
            description: "Arrival by refresh",
            price: 35,
            isFeatured: false,
            isAvailable: true,
            sortOrder: 10,
          });
        }
        return successResponse(state);
      },
    });

    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);
    await expect(menuItemByName(page, "Polling Ramen")).toBeHidden();

    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(1300);
      await page.reload({ waitUntil: "networkidle" });
    }

    await expect(mocks.stats.menu).toBeGreaterThanOrEqual(3);
    await expect(menuItemByName(page, "Polling Ramen")).toBeVisible();
  });

  test("18) 導航回流可回到菜單頁且保留可操作性", async ({ page }) => {
    const session = await getSmokeOwnerSession();
    installOwnerMenuMocks(page);
    await openOwnerMenu(page, session);
    await waitForMenuPageReady(page);

    await page.goto(`${ADMIN_URL}/dashboard/settings`, {
      waitUntil: "networkidle",
    });
    await expect(page).toHaveURL(/\/dashboard\/settings/);
    await page.goBack();

    await expect(page).toHaveURL(/\/dashboard\/menu/);
    await waitForMenuPageReady(page);
    await expect(
      page.getByRole("heading", { name: LABELS.pageTitle }),
    ).toBeVisible();
  });
});
