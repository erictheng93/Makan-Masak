import { expect, test, type Page } from "@playwright/test";
import { randomInt, randomUUID } from "node:crypto";
import {
  createLocalManagementToken,
  firstAvailableMenuItemId,
  isLocalSmokeApi,
  localManagementApiUrlFallback,
  localManagementPortalUrlFallback,
  localOnboardingUrlFallback,
  optionalEnv,
  resolveLocalSmokeFixtureIds,
  smokeLogin,
  type SmokeLoginData,
} from "../smoke/smoke-env";

const API_URL =
  optionalEnv("WORKFLOW_API_URL") ||
  optionalEnv("SMOKE_API_URL") ||
  "http://localhost:8787";
const WORKFLOW_STRICT =
  optionalEnv("WORKFLOW_STRICT")?.toLowerCase() === "true" ||
  optionalEnv("WORKFLOW_STRICT") === "1" ||
  optionalEnv("SMOKE_STRICT")?.toLowerCase() === "true" ||
  optionalEnv("SMOKE_STRICT") === "1";
const CUSTOMER_URL =
  optionalEnv("WORKFLOW_CUSTOMER_URL") ||
  optionalEnv("SMOKE_CUSTOMER_URL") ||
  "http://localhost:3000";
const IS_LOCAL_API = isLocalSmokeApi(API_URL);
const ADMIN_URL =
  optionalEnv("WORKFLOW_ADMIN_URL") || optionalEnv("SMOKE_ADMIN_URL");
const KITCHEN_URL =
  optionalEnv("WORKFLOW_KITCHEN_URL") || optionalEnv("SMOKE_KITCHEN_URL");
const ENABLE_LOCAL_MANAGEMENT_WORKFLOWS =
  optionalEnv("WORKFLOW_ENABLE_LOCAL_MANAGEMENT") === "1";
const MANAGEMENT_PORTAL_URL =
  optionalEnv("WORKFLOW_MANAGEMENT_PORTAL_URL") ||
  (ENABLE_LOCAL_MANAGEMENT_WORKFLOWS
    ? localManagementPortalUrlFallback(API_URL)
    : undefined);
const ONBOARDING_URL =
  optionalEnv("WORKFLOW_ONBOARDING_URL") ||
  (ENABLE_LOCAL_MANAGEMENT_WORKFLOWS
    ? localOnboardingUrlFallback(API_URL)
    : undefined);
const MANAGEMENT_API_URL =
  optionalEnv("WORKFLOW_MANAGEMENT_API_URL") ||
  (ENABLE_LOCAL_MANAGEMENT_WORKFLOWS
    ? localManagementApiUrlFallback(API_URL)
    : undefined);
const MANAGEMENT_API_ORIGIN_URL = MANAGEMENT_API_URL?.replace(
  /\/api\/v1\/?$/,
  "",
);
const MANAGEMENT_WORKFLOW_API_URL =
  MANAGEMENT_API_URL ||
  optionalEnv("WORKFLOW_MANAGEMENT_PORTAL_API_URL") ||
  (MANAGEMENT_PORTAL_URL
    ? new URL("/api/v1", MANAGEMENT_PORTAL_URL).toString().replace(/\/$/, "")
    : undefined);

/**
 * Local fallbacks are owner1/owner123 — the account scripts/seed-local.sql
 * creates, and the same pair tests/e2e/admin/admin-e2e.ts falls back to.
 *
 * They used to be grandmaShop/password123, which came from
 * scripts/seed-mock-data.sql. b936600f deleted that file, so against a
 * freshly seeded local D1 the fallback 401s and every test that needs a
 * login skips on "login failed" rather than on anything true (#357).
 */
const AUTH_USERNAME =
  optionalEnv("WORKFLOW_AUTH_USERNAME") ||
  optionalEnv("SMOKE_AUTH_USERNAME") ||
  (IS_LOCAL_API ? "owner1" : undefined);
const AUTH_PASSWORD =
  optionalEnv("WORKFLOW_AUTH_PASSWORD") ||
  optionalEnv("SMOKE_AUTH_PASSWORD") ||
  (IS_LOCAL_API ? "owner123" : undefined);
const CHEF_USERNAME = optionalEnv("WORKFLOW_CHEF_USERNAME");
const CHEF_PASSWORD = optionalEnv("WORKFLOW_CHEF_PASSWORD");
const MANAGEMENT_TOKEN =
  optionalEnv("WORKFLOW_MANAGEMENT_TOKEN") ||
  (ENABLE_LOCAL_MANAGEMENT_WORKFLOWS
    ? createLocalManagementToken({
        managementApiUrl: MANAGEMENT_API_URL,
        jwtSecret: optionalEnv("WORKFLOW_MANAGEMENT_JWT_SECRET"),
      })
    : undefined);
const RESTAURANT_ID =
  optionalEnv("WORKFLOW_RESTAURANT_ID") || optionalEnv("SMOKE_RESTAURANT_ID");
const MENU_ITEM_ID = Number(
  optionalEnv("WORKFLOW_MENU_ITEM_ID") ||
    optionalEnv("SMOKE_MENU_ITEM_ID") ||
    NaN,
);

function skipWhen(condition: unknown, message: string): void {
  if (!condition) return;
  if (WORKFLOW_STRICT) {
    throw new Error(message);
  }
  test.skip(true, message);
}

function assertLoginData(
  value: SmokeLoginData | undefined,
  reason: string,
): asserts value is SmokeLoginData {
  skipWhen(!value?.token || !value.user, reason);
}

function assertLoginToken(
  value: SmokeLoginData | undefined,
  reason: string,
): asserts value is SmokeLoginData {
  skipWhen(!value?.token, reason);
}

function assertChefLoginData(
  value: LoginResponse["data"] | undefined,
  reason: string,
): asserts value is NonNullable<LoginResponse["data"]> {
  skipWhen(!value?.token || !value.user, reason);
}

const SERVICE_ITEM_ID = Number(optionalEnv("WORKFLOW_SERVICE_ITEM_ID") || NaN);
const MARKET_SLUG = optionalEnv("WORKFLOW_MARKET_SLUG");
const TABLE_ID = Number(
  optionalEnv("WORKFLOW_TABLE_ID") || optionalEnv("SMOKE_TABLE_ID") || NaN,
);

function randomSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function randomPhoneLastDigits() {
  return String(randomInt(100, 1000));
}

function randomTaiwanPhone() {
  return `0912${randomInt(100000, 1000000)}`;
}

function randomUsPhone() {
  return `+1555${randomInt(1000000, 10000000)}`;
}

interface MenuItemCandidate {
  id?: number | string;
  name?: string;
  price?: number | string;
  isAvailable?: boolean | number;
}

interface MenuBody {
  success: boolean;
  data?: {
    menuItems?: MenuItemCandidate[];
    items?: MenuItemCandidate[];
    categories?: Array<{
      id?: number | string;
      name?: string;
      items?: MenuItemCandidate[];
    }>;
  };
}

interface MenuMutationBody {
  success: boolean;
  data?: {
    id?: number;
    name?: string;
    price?: number;
    isAvailable?: boolean | number;
  };
}

interface GuestOrderResponse {
  success: boolean;
  data?: {
    order?: {
      id?: string;
      orderNumber?: string;
    };
    guestToken?: string;
  };
}

interface RestaurantServiceItemCandidate {
  id?: number | string;
  restaurantId?: string;
  name?: string;
  requiresBooking?: boolean | number;
  isActive?: boolean | number;
  isPublic?: boolean | number;
}

interface ServiceBookingAvailabilityBody {
  success: boolean;
  data?: {
    slots?: Array<{
      timeSlot?: string;
      remaining?: number | null;
      isAvailable?: boolean;
    }>;
  };
}

interface ServiceBookingBody {
  success: boolean;
  data?: {
    booking?: {
      id?: string;
      restaurantId?: string;
      serviceItemId?: number;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string | null;
      bookingDate?: string;
      bookingTime?: string;
      partySize?: number;
      status?: string;
      confirmationCode?: string;
      specialRequests?: string | null;
    };
  };
}

interface MarketListBody {
  success: boolean;
  data?: {
    markets?: Array<{
      slug?: string;
      name?: string;
    }>;
  };
}

interface MarketVendorsBody {
  success: boolean;
  data?: {
    vendors?: Array<{
      restaurantId?: string;
      name?: string;
      availableMenuItemCount?: number;
    }>;
  };
}

interface MarketCheckoutBody {
  success: boolean;
  data?: {
    checkout?: {
      id?: string;
      market?: {
        slug?: string;
        name?: string;
      };
      status?: string;
      childOrders?: Array<{
        restaurantId?: string;
        restaurantName?: string;
        orderId?: string;
        orderNumber?: string;
        totalAmount?: number;
      }>;
      subtotal?: number;
    };
    childOrders?: Array<{
      restaurantId?: string;
      order?: {
        id?: string;
      };
      guestToken?: string;
    }>;
  };
}

interface OrderBody {
  success: boolean;
  data?: {
    id?: string;
    status?: string;
    items?: Array<{
      id?: number;
      status?: string;
    }>;
  };
}

interface KitchenOrdersBody {
  success: boolean;
  data?: {
    pending?: Array<{
      id?: string;
      items?: Array<{ id?: number; status?: string }>;
    }>;
    preparing?: Array<{
      id?: string;
      items?: Array<{ id?: number; status?: string }>;
    }>;
    ready?: Array<{
      id?: string;
      items?: Array<{ id?: number; status?: string }>;
    }>;
  };
}

interface ManagementTenantSummary {
  id?: string;
  businessName?: string;
  contactEmail?: string;
  contactPhone?: string;
  subdomain?: string;
  licenseTier?: string;
  status?: string;
}

interface ManagementTenantsBody {
  data?: ManagementTenantSummary[];
  pagination?: unknown;
}

interface ManagementTenantBody {
  success?: boolean;
  data?: ManagementTenantSummary & {
    contactEmail?: string;
    contactPhone?: string;
    subdomain?: string;
    licenseTier?: string;
    status?: string;
  };
}

interface LoginResponse {
  success: boolean;
  data?: {
    token?: string;
    refreshToken?: string;
    csrfToken?: string;
    createdUserId?: string;
    user?: SmokeLoginData["user"] & {
      id?: string;
      username?: string;
      role?: number;
      permissions?: string[];
    };
  };
}

declare global {
  interface Window {
    __kitchenEventSourceUrls: string[];
    __kitchenWebSocketUrls: string[];
    __kitchenAudioPlayRequests: Array<{
      type?: string;
      priority?: string;
      repeat?: number;
    }>;
    __emitKitchenSse: (event: unknown) => void;
    __emitKitchenRealtime: (event: unknown) => void;
  }
}

let loginDataPromise: Promise<SmokeLoginData> | undefined;
let chefLoginDataPromise: Promise<LoginResponse["data"]> | undefined;

function csrfHeaders() {
  const token = "a".repeat(64);
  const api = new URL(API_URL);
  return {
    "X-CSRF-Token": token,
    cookie: `csrf_token=${token}`,
    origin: api.origin,
    host: api.host,
  };
}

function getLoginData(): Promise<SmokeLoginData> | undefined {
  if (!AUTH_USERNAME || !AUTH_PASSWORD) return undefined;

  loginDataPromise ??= smokeLogin(API_URL, AUTH_USERNAME, AUTH_PASSWORD);
  loginDataPromise = loginDataPromise.catch((error) => {
    loginDataPromise = undefined;
    throw error;
  });

  return loginDataPromise;
}

async function resolveFixtureIds() {
  return resolveLocalSmokeFixtureIds({
    apiUrl: API_URL,
    authUsername: AUTH_USERNAME,
    authPassword: AUTH_PASSWORD,
    restaurantId: RESTAURANT_ID,
    menuItemId: Number.isFinite(MENU_ITEM_ID) ? MENU_ITEM_ID : undefined,
    tableId: Number.isFinite(TABLE_ID) ? TABLE_ID : undefined,
    loginData: await getLoginData(),
  });
}

async function fetchMenu(restaurantId: string): Promise<MenuBody> {
  const response = await fetch(`${API_URL}/api/v1/menu/${restaurantId}`);
  expect(response.ok, `menu API status ${response.status}`).toBe(true);
  return (await response.json()) as MenuBody;
}

async function loginChef() {
  if (!CHEF_USERNAME || !CHEF_PASSWORD) {
    if (!IS_LOCAL_API) return undefined;

    const ownerLoginData = await getLoginData();
    if (!ownerLoginData?.token || !ownerLoginData.user) return undefined;

    const suffix = randomSuffix();
    const username = `workflowchef${suffix}`;
    const password = `ChefPass1!${suffix}`;
    const createResponse = await fetch(`${API_URL}/api/v1/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerLoginData.token}`,
        "Content-Type": "application/json",
        ...(ownerLoginData.csrfToken
          ? {
              "X-CSRF-Token": ownerLoginData.csrfToken,
              cookie: `csrf_token=${ownerLoginData.csrfToken}`,
            }
          : csrfHeaders()),
        origin: new URL(API_URL).origin,
      },
      body: JSON.stringify({
        username,
        fullName: "Workflow Chef",
        email: `${username}@example.test`,
        password,
        role: 2,
      }),
    });
    expect(
      createResponse.ok,
      `local workflow chef create status ${createResponse.status}`,
    ).toBe(true);
    const createBody = (await createResponse.json()) as {
      data?: { id?: string };
    };
    const createdUserId = createBody.data?.id;
    expect(typeof createdUserId, "created chef user id").toBe("string");

    const loginData = await smokeLogin(API_URL, username, password);
    expect(loginData.user?.role, "created chef role").toBe(2);
    return { ...loginData, createdUserId };
  }

  chefLoginDataPromise ??= fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: CHEF_USERNAME,
      password: CHEF_PASSWORD,
      system: "kitchen",
    }),
  }).then(async (response) => {
    expect(response.ok, `chef login status ${response.status}`).toBe(true);
    const body = (await response.json()) as LoginResponse;
    expect(body.success, "chef login should succeed").toBe(true);
    expect(body.data?.user?.role, "chef role").toBe(2);
    return {
      ...body.data,
      csrfToken: response.headers.get("X-CSRF-Token") ?? undefined,
    };
  });

  chefLoginDataPromise = chefLoginDataPromise.catch((error) => {
    chefLoginDataPromise = undefined;
    throw error;
  });

  return chefLoginDataPromise;
}

async function deactivateWorkflowChef(
  chefLoginData: NonNullable<LoginResponse["data"]>,
  ownerLoginData: SmokeLoginData,
) {
  if (!chefLoginData.createdUserId || !ownerLoginData.token) return;

  await fetch(`${API_URL}/api/v1/users/${chefLoginData.createdUserId}/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ownerLoginData.token}`,
      "Content-Type": "application/json",
      ...(ownerLoginData.csrfToken
        ? {
            "X-CSRF-Token": ownerLoginData.csrfToken,
            cookie: `csrf_token=${ownerLoginData.csrfToken}`,
          }
        : csrfHeaders()),
      origin: new URL(API_URL).origin,
    },
    body: JSON.stringify({ isActive: false }),
  }).catch(() => {
    /* best-effort cleanup */
  });
}

function allMenuItems(menu: MenuBody): MenuItemCandidate[] {
  return [
    ...(menu.data?.menuItems ?? []),
    ...(menu.data?.items ?? []),
    ...(menu.data?.categories ?? []).flatMap(
      (category) => category.items ?? [],
    ),
  ];
}

function firstAvailableNamedMenuItem(menu: MenuBody) {
  return allMenuItems(menu).find(
    (item) =>
      item.name &&
      item.isAvailable !== false &&
      item.isAvailable !== 0 &&
      Number.isFinite(Number(item.id)),
  );
}

function availableNamedMenuItems(menu: MenuBody) {
  const itemsById = new Map<number, MenuItemCandidate>();

  for (const item of allMenuItems(menu)) {
    const id = Number(item.id);
    if (
      item.name &&
      item.isAvailable !== false &&
      item.isAvailable !== 0 &&
      Number.isFinite(id) &&
      !itemsById.has(id)
    ) {
      itemsById.set(id, item);
    }
  }

  return [...itemsById.values()];
}

function firstMenuCategory(menu: MenuBody) {
  return menu.data?.categories?.find((category) =>
    Number.isFinite(Number(category.id)),
  );
}

function futureIsoDate(daysFromToday: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

async function fetchPublicServiceItems(restaurantId: string) {
  const response = await fetch(
    `${API_URL}/api/v1/restaurants/${restaurantId}/service-items`,
  );
  expect(
    response.ok,
    `restaurant service items status ${response.status}`,
  ).toBe(true);
  const body = (await response.json()) as {
    success: boolean;
    data?: RestaurantServiceItemCandidate[];
  };
  return body.data ?? [];
}

async function fetchServiceAvailability(serviceItemId: number, date: string) {
  const response = await fetch(
    `${API_URL}/api/v1/service-bookings/availability?serviceItemId=${serviceItemId}&date=${date}`,
  );
  expect(
    response.ok,
    `service booking availability status ${response.status}`,
  ).toBe(true);
  return (await response.json()) as ServiceBookingAvailabilityBody;
}

async function findBookableServiceFixture(restaurantId: string) {
  const serviceItems = await fetchPublicServiceItems(restaurantId);
  const candidates = serviceItems.filter((item) => {
    const itemId = Number(item.id);
    if (!Number.isFinite(itemId)) return false;
    if (Number.isFinite(SERVICE_ITEM_ID)) return itemId === SERVICE_ITEM_ID;

    return (
      item.requiresBooking !== false &&
      item.requiresBooking !== 0 &&
      item.isActive !== false &&
      item.isActive !== 0 &&
      item.isPublic !== false &&
      item.isPublic !== 0
    );
  });

  for (const serviceItem of candidates) {
    const serviceItemId = Number(serviceItem.id);
    for (let offset = 1; offset <= 14; offset += 1) {
      const date = futureIsoDate(offset);
      const availability = await fetchServiceAvailability(serviceItemId, date);
      const slot = availability.data?.slots?.find(
        (candidate) => candidate.isAvailable && candidate.timeSlot,
      );
      if (slot?.timeSlot) {
        return {
          serviceItemId,
          serviceName: serviceItem.name,
          date,
          timeSlot: slot.timeSlot,
        };
      }
    }
  }

  return undefined;
}

async function fetchPublicMarkets() {
  if (MARKET_SLUG) return [{ slug: MARKET_SLUG, name: MARKET_SLUG }];

  const response = await fetch(`${API_URL}/api/v1/markets?limit=25`);
  expect(response.ok, `markets list status ${response.status}`).toBe(true);
  const body = (await response.json()) as MarketListBody;
  return (body.data?.markets ?? []).filter((market) => market.slug);
}

async function fetchMarketVendors(marketSlug: string) {
  const response = await fetch(
    `${API_URL}/api/v1/markets/${encodeURIComponent(marketSlug)}/vendors?limit=25`,
  );
  expect(
    response.ok,
    `market vendors status ${response.status} for ${marketSlug}`,
  ).toBe(true);
  const body = (await response.json()) as MarketVendorsBody;
  return body.data?.vendors ?? [];
}

async function findMarketCheckoutFixture() {
  const markets = await fetchPublicMarkets();

  for (const market of markets) {
    if (!market.slug) continue;
    const vendors = await fetchMarketVendors(market.slug);
    const vendorFixtures: Array<{
      restaurantId: string;
      restaurantName: string;
      menuItemId: number;
      menuItemName: string;
      price: number;
    }> = [];

    for (const vendor of vendors) {
      if (!vendor.restaurantId) continue;
      if (vendor.availableMenuItemCount !== undefined) {
        if (vendor.availableMenuItemCount <= 0) continue;
      }

      const menu = await fetchMenu(vendor.restaurantId);
      const item = firstAvailableNamedMenuItem(menu);
      const menuItemId = Number(item?.id);
      if (!item?.name || !Number.isFinite(menuItemId)) continue;

      vendorFixtures.push({
        restaurantId: vendor.restaurantId,
        restaurantName: vendor.name ?? vendor.restaurantId,
        menuItemId,
        menuItemName: item.name,
        price: Number(item.price ?? 0),
      });

      if (vendorFixtures.length >= 2) {
        return {
          marketSlug: market.slug,
          marketName: market.name ?? market.slug,
          vendors: vendorFixtures,
        };
      }
    }
  }

  return undefined;
}

async function installMarketCartFixture(
  page: Page,
  fixture: NonNullable<Awaited<ReturnType<typeof findMarketCheckoutFixture>>>,
) {
  await page.addInitScript((marketFixture) => {
    const now = Date.now();
    window.localStorage.setItem(
      "makanmakan_market_carts_v1",
      JSON.stringify({
        [marketFixture.marketSlug]: {
          marketSlug: marketFixture.marketSlug,
          marketName: marketFixture.marketName,
          vendors: marketFixture.vendors.map((vendor, index) => ({
            restaurantId: vendor.restaurantId,
            name: vendor.restaurantName,
            items: [
              {
                id: `workflow-${vendor.menuItemId}-${index}`,
                menuItem: {
                  id: vendor.menuItemId,
                  name: vendor.menuItemName,
                  price: vendor.price,
                },
                quantity: index === 0 ? 2 : 1,
                price: vendor.price,
                totalPrice: vendor.price * (index === 0 ? 2 : 1),
              },
            ],
          })),
          updatedAt: now,
        },
      }),
    );
  }, fixture);
}

async function fetchMarketCheckout(checkoutId: string) {
  const response = await fetch(
    `${API_URL}/api/v1/market-checkouts/${encodeURIComponent(checkoutId)}`,
  );
  expect(
    response.ok,
    `market checkout readback status ${response.status}`,
  ).toBe(true);
  return (await response.json()) as MarketCheckoutBody;
}

async function cancelMarketCheckoutChildOrders(
  childOrders: NonNullable<MarketCheckoutBody["data"]>["childOrders"],
) {
  await Promise.all(
    (childOrders ?? []).map(async (childOrder) => {
      const orderId = childOrder.order?.id;
      const token = childOrder.guestToken;
      if (!orderId || !token) return;

      await fetch(`${API_URL}/api/v1/guest-orders/${orderId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        /* best-effort cleanup */
      });
    }),
  );
}

async function fetchServiceBookingByCode(
  confirmationCode: string,
  contactEmail: string,
): Promise<ServiceBookingBody> {
  const query = new URLSearchParams({
    requireContact: "true",
    customerEmail: contactEmail,
  });
  const response = await fetch(
    `${API_URL}/api/v1/service-bookings/verify/${encodeURIComponent(confirmationCode)}?${query}`,
  );
  expect(response.ok, `service booking verify ${response.status}`).toBe(true);
  return (await response.json()) as ServiceBookingBody;
}

async function cancelServiceBookingByCode(
  confirmationCode: string,
  contactEmail: string,
) {
  await fetch(
    `${API_URL}/api/v1/service-bookings/verify/${encodeURIComponent(confirmationCode)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requireContact: true,
        customerEmail: contactEmail,
      }),
    },
  ).catch(() => {
    /* best-effort cleanup */
  });
}

function findMenuCategory(menu: MenuBody, categoryId: number) {
  return menu.data?.categories?.find(
    (category) => Number(category.id) === categoryId,
  );
}

function adminCategoryRow(page: Page, categoryId: number) {
  return page.locator(
    `[data-testid="category-row"][data-category-id="${categoryId}"]`,
  );
}

async function addMenuItemThroughUi(page: Page, id: number) {
  await expect(page.getByTestId(`menu-item-card-${id}`).first()).toBeVisible({
    timeout: 15_000,
  });

  const quickAdd = page.getByTestId(`menu-item-add-${id}`).first();
  const customize = page.getByTestId(`menu-item-customize-${id}`).first();

  if ((await quickAdd.count()) > 0) {
    await quickAdd.click();
    return;
  }

  await customize.click();
  await expect(page.getByTestId("menu-item-modal")).toBeVisible();
  await page.getByTestId("menu-item-modal-add").click();
}

function cartItemRow(page: Page, menuItemId: number) {
  return page.locator(
    `[data-testid="cart-item"][data-menu-item-id="${menuItemId}"]`,
  );
}

async function installAdminSession(page: Page, loginData: SmokeLoginData) {
  await page.addInitScript((session) => {
    window.localStorage.setItem("auth_token", session.token ?? "");
    if (session.csrfToken) {
      window.document.cookie = `csrf_token=${session.csrfToken}; path=/; SameSite=Lax`;
    }
    if (session.refreshToken) {
      window.localStorage.setItem("auth_refresh_token", session.refreshToken);
    }
    if (session.user) {
      window.localStorage.setItem("auth_user", JSON.stringify(session.user));
    }
    window.localStorage.setItem("makanmakan_locale", "en-US");
    window.localStorage.setItem("locale", "en-US");
  }, loginData);
}

async function installKitchenSession(
  page: Page,
  loginData: NonNullable<LoginResponse["data"]>,
) {
  await page.addInitScript((session) => {
    window.localStorage.setItem("kitchen_auth_token", session.token ?? "");
    if (session.csrfToken) {
      window.document.cookie = `csrf_token=${session.csrfToken}; path=/; SameSite=Lax`;
    }
    if (session.refreshToken) {
      window.localStorage.setItem(
        "kitchen_refresh_token",
        session.refreshToken,
      );
    }
    if (session.user) {
      window.localStorage.setItem("kitchen_user", JSON.stringify(session.user));
    }
    window.localStorage.setItem("makanmakan_locale", "en-US");
    window.localStorage.setItem("locale", "en-US");
    window.localStorage.setItem("kitchen-view-mode", "kanban");
  }, loginData);
}

async function installKitchenBrowserRuntimeHooks(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.removeItem("kitchen_settings");
    window.localStorage.setItem("kitchen-view-mode", "kanban");
    window.localStorage.setItem(
      "kitchen-audio-notifications",
      JSON.stringify({
        newOrderSound: true,
        urgentOrderSound: true,
        orderReadySound: true,
        orderCompleteSound: true,
        warningSound: true,
        successSound: true,
        errorSound: true,
        volume: 0.7,
        enabled: true,
      }),
    );
    window.__kitchenEventSourceUrls = [];
    window.__kitchenWebSocketUrls = [];
    window.__kitchenAudioPlayRequests = [];
    const eventSources: WorkflowEventSource[] = [];
    const webSockets: WorkflowWebSocket[] = [];

    class WorkflowEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readonly url: string;
      readyState = WorkflowEventSource.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        super();
        this.url = url;
        window.__kitchenEventSourceUrls.push(url);
        eventSources.push(this);

        window.setTimeout(() => {
          if (this.readyState === WorkflowEventSource.CLOSED) return;

          this.readyState = WorkflowEventSource.OPEN;
          const openEvent = new Event("open");
          this.onopen?.(openEvent);
          this.dispatchEvent(openEvent);

          this.dispatchEvent(
            new MessageEvent("connected", {
              data: JSON.stringify({ ok: true }),
            }),
          );
        }, 0);
      }

      close() {
        this.readyState = WorkflowEventSource.CLOSED;
      }

      emitKitchenEvent(payload: unknown) {
        const messageEvent = new MessageEvent("message", {
          data: JSON.stringify(payload),
        });
        this.onmessage?.(messageEvent);
        this.dispatchEvent(messageEvent);
      }
    }

    window.__emitKitchenSse = (event: unknown) => {
      eventSources.forEach((source) => source.emitKitchenEvent(event));
    };

    window.EventSource = WorkflowEventSource as unknown as typeof EventSource;

    class WorkflowWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readonly url: string;
      readyState = WorkflowWebSocket.CONNECTING;
      binaryType: BinaryType = "blob";
      bufferedAmount = 0;
      extensions = "";
      protocol = "";
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;

      constructor(url: string) {
        super();
        this.url = url;
        window.__kitchenWebSocketUrls.push(url);
        webSockets.push(this);

        window.setTimeout(() => {
          if (this.readyState === WorkflowWebSocket.CLOSED) return;
          this.readyState = WorkflowWebSocket.OPEN;
          const openEvent = new Event("open");
          this.onopen?.(openEvent);
          this.dispatchEvent(openEvent);
        }, 0);
      }

      send() {
        /* test transport does not send client frames */
      }

      close(code = 1000, reason = "workflow close") {
        if (this.readyState === WorkflowWebSocket.CLOSED) return;
        this.readyState = WorkflowWebSocket.CLOSED;
        const closeEvent = new CloseEvent("close", { code, reason });
        this.onclose?.(closeEvent);
        this.dispatchEvent(closeEvent);
      }

      emitKitchenEvent(payload: unknown) {
        const messageEvent = new MessageEvent("message", {
          data: JSON.stringify(payload),
        });
        this.onmessage?.(messageEvent);
        this.dispatchEvent(messageEvent);
      }
    }

    window.__emitKitchenRealtime = (event: unknown) => {
      webSockets.forEach((socket) => socket.emitKitchenEvent(event));
    };

    window.WebSocket = WorkflowWebSocket as unknown as typeof WebSocket;
  });
}

async function installManagementSession(page: Page, token: string) {
  await page.addInitScript((managementToken) => {
    window.localStorage.setItem("management_token", managementToken);
  }, token);
}

async function fetchManagementTenant(
  token: string,
): Promise<ManagementTenantSummary | undefined> {
  if (!MANAGEMENT_WORKFLOW_API_URL) return undefined;

  const response = await fetch(`${MANAGEMENT_WORKFLOW_API_URL}/tenants`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok, `management tenants status ${response.status}`).toBe(
    true,
  );

  const body = (await response.json()) as ManagementTenantsBody;
  return body.data?.find((tenant) => tenant.id);
}

async function fetchManagementTenantById(
  tenantId: string,
  token: string,
): Promise<ManagementTenantBody> {
  expect(
    MANAGEMENT_WORKFLOW_API_URL,
    "management workflow API URL",
  ).toBeTruthy();

  const response = await fetch(
    `${MANAGEMENT_WORKFLOW_API_URL}/tenants/${tenantId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.ok, `management tenant get status ${response.status}`).toBe(
    true,
  );
  return (await response.json()) as ManagementTenantBody;
}

async function createManagementTenantFixture(token: string): Promise<{
  id: string;
  businessName: string;
}> {
  expect(
    MANAGEMENT_WORKFLOW_API_URL,
    "management workflow API URL",
  ).toBeTruthy();

  const suffix = randomSuffix();
  const businessName = `Workflow Detail Tenant ${suffix}`;
  const response = await fetch(`${MANAGEMENT_WORKFLOW_API_URL}/tenants`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessName,
      contactEmail: `workflow-detail-${suffix}@example.com`,
      contactPhone: randomUsPhone(),
      subdomain: `workflow-detail-${suffix}`,
      licenseTier: "standard",
    }),
  });
  expect(
    response.ok,
    `management tenant fixture create status ${response.status}`,
  ).toBe(true);

  const body = (await response.json()) as ManagementTenantBody;
  const id = body.data?.id;
  expect(typeof id, "management tenant fixture id").toBe("string");

  return { id: id!, businessName };
}

async function deleteManagementTenant(tenantId: string, token: string) {
  if (!MANAGEMENT_WORKFLOW_API_URL) return;

  await fetch(`${MANAGEMENT_WORKFLOW_API_URL}/tenants/${tenantId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {
    /* best-effort cleanup */
  });
}

async function confirmOrder(orderId: string, token: string) {
  await updateOrderStatus(orderId, token, "confirmed");
}

async function updateOrderStatus(
  orderId: string,
  token: string,
  status: "confirmed" | "preparing" | "ready",
) {
  const response = await fetch(`${API_URL}/api/v1/orders/${orderId}/status`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...csrfHeaders(),
    },
    body: JSON.stringify({ status }),
  });

  expect(response.ok, `${status} order status ${response.status}`).toBe(true);
}

async function fetchOrder(orderId: string, token: string): Promise<OrderBody> {
  const response = await fetch(`${API_URL}/api/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok, `fetch order status ${response.status}`).toBe(true);
  return (await response.json()) as OrderBody;
}

async function fetchMenuItem(
  itemId: number,
  token: string,
): Promise<MenuMutationBody> {
  const response = await fetch(`${API_URL}/api/v1/menu/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok, `fetch menu item status ${response.status}`).toBe(true);
  return (await response.json()) as MenuMutationBody;
}

async function deleteMenuItemAsOwner(itemId: number, token: string) {
  await fetch(`${API_URL}/api/v1/menu/items/${itemId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      ...csrfHeaders(),
    },
  }).catch(() => {
    /* best-effort cleanup */
  });
}

async function deleteCategoryAsOwner(categoryId: number, token: string) {
  await fetch(`${API_URL}/api/v1/menu/categories/${categoryId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      ...csrfHeaders(),
    },
  }).catch(() => {
    /* best-effort cleanup */
  });
}

async function cancelOrderAsOwner(orderId: string, token: string) {
  await fetch(`${API_URL}/api/v1/orders/${orderId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...csrfHeaders(),
    },
    body: JSON.stringify({ reason: "workflow cleanup" }),
  }).catch(() => {
    /* best-effort cleanup */
  });
}

async function fetchKitchenOrders(
  restaurantId: string,
  token: string,
): Promise<KitchenOrdersBody> {
  const response = await fetch(
    `${API_URL}/api/v1/kitchen/${restaurantId}/orders`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.ok, `fetch kitchen orders status ${response.status}`).toBe(
    true,
  );
  return (await response.json()) as KitchenOrdersBody;
}

function findKitchenOrder(body: KitchenOrdersBody, orderId: string) {
  return [
    ...(body.data?.pending ?? []),
    ...(body.data?.preparing ?? []),
    ...(body.data?.ready ?? []),
  ].find((order) => order.id === orderId);
}

test.describe.configure({ mode: "serial" });

test.describe("Real system workflows", () => {
  test("API and customer SPA are both reachable without mocks", async ({
    page,
  }) => {
    const infoResponse = await fetch(`${API_URL}/info`);
    expect(infoResponse.status, `${API_URL}/info status`).toBe(200);

    const response = await page.goto(CUSTOMER_URL, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.ok(), `${CUSTOMER_URL} should serve the app`).toBe(true);
    await expect(page.locator("#app[data-v-app]")).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });

  test("customer menu page renders menu data served by the real API", async ({
    page,
  }) => {
    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId || !fixtureIds.tableId,
      "WORKFLOW_RESTAURANT_ID/SMOKE_RESTAURANT_ID and WORKFLOW_TABLE_ID/SMOKE_TABLE_ID not set and local discovery failed",
    );

    const menu = await fetchMenu(fixtureIds.restaurantId!);
    const item = firstAvailableNamedMenuItem(menu);
    skipWhen(!item?.name, "real API did not return an available named item");

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/menu/${fixtureIds.restaurantId}`) &&
          response.ok(),
      ),
      page.goto(
        `${CUSTOMER_URL}/restaurant/${fixtureIds.restaurantId}/table/${fixtureIds.tableId}`,
        { waitUntil: "domcontentloaded" },
      ),
    ]);

    await expect(page.getByTestId("cart-btn")).toBeVisible();
    await expect(
      page.getByText(item!.name!, { exact: false }).first(),
    ).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });

  test("customer can add a real menu item to cart and submit through checkout UI", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId || !fixtureIds.tableId,
      "WORKFLOW_RESTAURANT_ID/SMOKE_RESTAURANT_ID and WORKFLOW_TABLE_ID/SMOKE_TABLE_ID not set and local discovery failed",
    );

    const menu = await fetchMenu(fixtureIds.restaurantId!);
    const availableItems = availableNamedMenuItems(menu);
    const item =
      availableItems.find(
        (candidate) =>
          Number(candidate.id) === fixtureIds.menuItemId && candidate.name,
      ) ?? firstAvailableNamedMenuItem(menu);
    const secondItem = availableItems.find(
      (candidate) => Number(candidate.id) !== Number(item?.id),
    );
    const menuItemId = Number(item?.id);
    const secondMenuItemId = Number(secondItem?.id);

    skipWhen(
      !item?.name ||
        !secondItem?.name ||
        !Number.isFinite(menuItemId) ||
        !Number.isFinite(secondMenuItemId),
      "real API did not return two available named items",
    );

    const menuUrl = `${CUSTOMER_URL}/restaurant/${fixtureIds.restaurantId}/table/${fixtureIds.tableId}`;
    await page.goto(menuUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(
      page.getByTestId(`menu-item-card-${menuItemId}`).first(),
    ).toBeVisible({ timeout: 15_000 });
    await addMenuItemThroughUi(page, menuItemId);
    await expect(page.getByTestId("cart-count")).toHaveText("1");

    await expect(
      page.getByTestId(`menu-item-card-${secondMenuItemId}`).first(),
    ).toBeVisible({ timeout: 15_000 });
    await addMenuItemThroughUi(page, secondMenuItemId);
    await expect(page.getByTestId("cart-count")).toHaveText("2");

    await page.getByTestId("cart-btn").click();
    await page.waitForURL("**/cart");
    await expect(page.getByTestId("cart-item")).toHaveCount(2);
    await expect(
      page.getByText(item!.name!, { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(secondItem!.name!, { exact: false }).first(),
    ).toBeVisible();

    const firstCartRow = cartItemRow(page, menuItemId);
    const secondCartRow = cartItemRow(page, secondMenuItemId);
    await expect(firstCartRow).toBeVisible();
    await expect(secondCartRow).toBeVisible();

    const firstIncrease = firstCartRow.locator(
      `[data-testid^="qty-increase-"]`,
    );
    const firstDecrease = firstCartRow.locator(
      `[data-testid^="qty-decrease-"]`,
    );
    const firstQuantityTestId =
      (await firstIncrease.getAttribute("data-testid"))!;
    const firstCartItemId = firstQuantityTestId.replace("qty-increase-", "");

    await firstIncrease.click();
    await expect(
      page.getByTestId(`cart-item-quantity-${firstCartItemId}`),
    ).toHaveText("2");
    await firstDecrease.click();
    await expect(
      page.getByTestId(`cart-item-quantity-${firstCartItemId}`),
    ).toHaveText("1");
    await firstIncrease.click();
    await expect(
      page.getByTestId(`cart-item-quantity-${firstCartItemId}`),
    ).toHaveText("2");

    await secondCartRow.getByTestId("remove-item").click();
    await expect(cartItemRow(page, secondMenuItemId)).toHaveCount(0);
    await expect(page.getByTestId("cart-item")).toHaveCount(1);

    await page.goto(menuUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await expect(page.getByTestId("cart-count")).toHaveText("2");
    await addMenuItemThroughUi(page, secondMenuItemId);
    await expect(page.getByTestId("cart-count")).toHaveText("3");
    await page.getByTestId("cart-btn").click();
    await page.waitForURL("**/cart");
    await expect(page.getByTestId("cart-item")).toHaveCount(2);

    await page.getByTestId(`cart-item-notes-toggle-${firstCartItemId}`).click();
    await page
      .getByTestId(`cart-item-notes-${firstCartItemId}`)
      .fill("less spicy workflow note");
    await page.getByTestId("order-notes").fill("workflow table note");

    await page.locator("#customer-name").fill("Workflow UI");
    await page.locator("#customer-phone").fill("0912345678");

    let orderId: string | undefined;
    let guestToken: string | undefined;

    try {
      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/guest-orders") &&
          response.request().method() === "POST",
      );

      await page.getByTestId("submit-order-btn").click();
      await expect(page.getByTestId("confirmation-modal")).toBeVisible();
      await page.getByTestId("confirmation-confirm").click();

      const createResponse = await createResponsePromise;
      expect(
        createResponse.ok(),
        `guest checkout status ${createResponse.status()}`,
      ).toBe(true);
      const createRequestBody = createResponse.request().postDataJSON() as {
        guestName?: string;
        phoneLastDigits?: string;
        notes?: string;
        items?: Array<{
          menuItemId?: number;
          quantity?: number;
          notes?: string;
        }>;
      };
      expect(createRequestBody.guestName).toBe("Workflow UI");
      // Asserted absent, not equal to "678". df34417e (#193, #189) removed the
      // pickup-digits step from both order payloads — the order number is the
      // pickup identifier — and apps/customer-app's own unit test
      // ("sends no pickup digits") pins the same thing. This spec kept
      // asserting the pre-df34417e contract because nothing had run it since
      // b936600f; the nightly runs it again as of #357.
      expect(createRequestBody.phoneLastDigits).toBeUndefined();
      expect(createRequestBody.notes).toBe("workflow table note");
      expect(createRequestBody.items).toEqual([
        expect.objectContaining({
          menuItemId,
          quantity: 2,
          notes: "less spicy workflow note",
        }),
        expect.objectContaining({
          menuItemId: secondMenuItemId,
          quantity: 1,
        }),
      ]);
      const createBody = (await createResponse.json()) as GuestOrderResponse;
      orderId = createBody.data?.order?.id;
      guestToken = createBody.data?.guestToken;

      expect(typeof orderId, "created order id").toBe("string");
      expect(typeof guestToken, "created guest token").toBe("string");

      await page.waitForURL(`**/order/${orderId}`, { timeout: 45_000 });
      await expect(page.getByTestId("order-timeline")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      if (orderId && guestToken) {
        await fetch(`${API_URL}/api/v1/guest-orders/${orderId}/cancel`, {
          method: "POST",
          headers: { Authorization: `Bearer ${guestToken}` },
        }).catch(() => {
          /* best-effort cleanup */
        });
      }
    }
  });

  test("customer can create, verify, and cancel a real service booking from the browser", async ({
    page,
  }) => {
    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId,
      "WORKFLOW_RESTAURANT_ID/SMOKE_RESTAURANT_ID not set and local discovery failed",
    );

    const serviceFixture = await findBookableServiceFixture(
      fixtureIds.restaurantId!,
    );
    skipWhen(
      !serviceFixture,
      "real API did not return a bookable service item with an available slot; set WORKFLOW_SERVICE_ITEM_ID for this workflow",
    );

    const suffix = randomSuffix();
    const customerName = `Workflow Booking ${suffix}`;
    const customerPhone = randomTaiwanPhone();
    const customerEmail = `workflow-booking-${suffix}@example.com`;
    const specialRequests = `workflow service booking ${suffix}`;
    let confirmationCode: string | undefined;

    try {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(
                `/api/v1/restaurants/${fixtureIds.restaurantId}/service-items`,
              ) && response.ok(),
        ),
        page.goto(
          `${CUSTOMER_URL}/restaurant/${fixtureIds.restaurantId}/services/${serviceFixture!.serviceItemId}/book`,
          { waitUntil: "domcontentloaded" },
        ),
      ]);

      await expect(
        page.getByTestId("service-booking-service-summary"),
      ).toBeVisible();
      if (serviceFixture!.serviceName) {
        await expect(
          page.getByText(serviceFixture!.serviceName, { exact: false }).first(),
        ).toBeVisible();
      }

      const availabilityResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/service-bookings/availability") &&
          response.url().includes(`date=${serviceFixture!.date}`) &&
          response.ok(),
      );
      await page.getByTestId("service-booking-date").fill(serviceFixture!.date);
      await page.getByTestId("service-booking-load-slots").click();
      await availabilityResponsePromise;

      const slot = page
        .getByTestId("service-booking-slot")
        .filter({ hasText: serviceFixture!.timeSlot })
        .first();
      await expect(slot).toBeVisible();
      await slot.click();

      await page.getByTestId("service-booking-name").fill(customerName);
      await page.getByTestId("service-booking-phone").fill(customerPhone);
      await page.getByTestId("service-booking-email").fill(customerEmail);
      await page.getByTestId("service-booking-party-size").fill("2");
      await page.getByTestId("service-booking-requests").fill(specialRequests);

      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/service-bookings") &&
          response.request().method() === "POST" &&
          !response.url().includes("/cancel"),
      );
      await page.getByTestId("service-booking-create").click();
      const createResponse = await createResponsePromise;
      expect(
        createResponse.ok(),
        `service booking create status ${createResponse.status()}`,
      ).toBe(true);
      const createRequestBody = createResponse.request().postDataJSON() as {
        restaurantId?: string;
        serviceItemId?: number;
        customerName?: string;
        customerPhone?: string;
        customerEmail?: string;
        bookingDate?: string;
        bookingTime?: string;
        partySize?: number;
        specialRequests?: string;
      };
      expect(createRequestBody).toMatchObject({
        restaurantId: fixtureIds.restaurantId,
        serviceItemId: serviceFixture!.serviceItemId,
        customerName,
        customerPhone,
        customerEmail,
        bookingDate: serviceFixture!.date,
        bookingTime: serviceFixture!.timeSlot,
        partySize: 2,
        specialRequests,
      });

      const createBody = (await createResponse.json()) as ServiceBookingBody;
      confirmationCode = createBody.data?.booking?.confirmationCode;
      expect(typeof confirmationCode, "booking confirmation code").toBe(
        "string",
      );
      await expect(
        page.getByTestId("service-booking-confirmation"),
      ).toContainText(confirmationCode!);

      const createdBooking = await fetchServiceBookingByCode(
        confirmationCode!,
        customerEmail,
      );
      expect(createdBooking.data?.booking).toMatchObject({
        restaurantId: fixtureIds.restaurantId,
        serviceItemId: serviceFixture!.serviceItemId,
        customerName,
        customerPhone,
        customerEmail,
        bookingDate: serviceFixture!.date,
        bookingTime: serviceFixture!.timeSlot,
        partySize: 2,
        status: "pending",
        specialRequests,
      });

      const verifyResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/api/v1/service-bookings/verify/${encodeURIComponent(confirmationCode!)}`,
            ) &&
          response.request().method() === "GET" &&
          response.ok(),
      );
      await page.getByTestId("service-booking-verify").click();
      await verifyResponsePromise;
      await expect(page.getByTestId("service-booking-verified")).toContainText(
        serviceFixture!.date,
      );

      const cancelResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/api/v1/service-bookings/verify/${encodeURIComponent(confirmationCode!)}/cancel`,
            ) && response.request().method() === "POST",
      );
      await page.getByTestId("service-booking-cancel").click();
      const cancelResponse = await cancelResponsePromise;
      expect(
        cancelResponse.ok(),
        `service booking cancel status ${cancelResponse.status()}`,
      ).toBe(true);
      await expect(page.getByTestId("service-booking-verified")).toContainText(
        "已取消",
      );

      const cancelledBooking = await fetchServiceBookingByCode(
        confirmationCode!,
        customerEmail,
      );
      expect(cancelledBooking.data?.booking?.status).toBe("cancelled");
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      if (confirmationCode) {
        await cancelServiceBookingByCode(confirmationCode, customerEmail);
      }
    }
  });

  test("customer can submit a real multi-vendor market checkout and open tracking from the browser", async ({
    page,
  }) => {
    const checkoutFixture = await findMarketCheckoutFixture();
    skipWhen(
      !checkoutFixture,
      "real API did not return a public market with two vendors and available menu items; set WORKFLOW_MARKET_SLUG for this workflow",
    );

    const phoneLastDigits = randomPhoneLastDigits();
    let checkoutId: string | undefined;
    let createBody: MarketCheckoutBody | undefined;

    await installMarketCartFixture(page, checkoutFixture!);

    try {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(
                `/api/v1/markets/${encodeURIComponent(checkoutFixture!.marketSlug)}`,
              ) && response.ok(),
        ),
        page.goto(`${CUSTOMER_URL}/markets/${checkoutFixture!.marketSlug}`, {
          waitUntil: "domcontentloaded",
        }),
      ]);

      await expect(page.getByTestId("market-cart-summary")).toBeVisible();
      await expect(page.getByTestId("market-cart-summary")).toContainText(
        "2 個攤位",
      );
      await page.getByTestId("market-checkout-phone").fill(phoneLastDigits);

      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/market-checkouts") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("market-checkout-submit").click();
      const createResponse = await createResponsePromise;
      expect(
        createResponse.ok(),
        `market checkout create status ${createResponse.status()}`,
      ).toBe(true);

      const createRequestBody = createResponse.request().postDataJSON() as {
        marketSlug?: string;
        guestName?: string;
        phoneLastDigits?: string;
        vendors?: Array<{
          restaurantId?: string;
          items?: Array<{
            menuItemId?: number;
            quantity?: number;
          }>;
        }>;
      };
      expect(createRequestBody).toMatchObject({
        marketSlug: checkoutFixture!.marketSlug,
        guestName: "Guest",
        phoneLastDigits,
        vendors: checkoutFixture!.vendors.map((vendor, index) => ({
          restaurantId: vendor.restaurantId,
          items: [
            {
              menuItemId: vendor.menuItemId,
              quantity: index === 0 ? 2 : 1,
            },
          ],
        })),
      });

      createBody = (await createResponse.json()) as MarketCheckoutBody;
      checkoutId = createBody.data?.checkout?.id;
      expect(typeof checkoutId, "market checkout id").toBe("string");
      expect(createBody.data?.checkout?.childOrders).toHaveLength(2);

      await page.waitForURL(
        `**/markets/${checkoutFixture!.marketSlug}/checkout/${checkoutId}`,
      );
      await expect(page.getByTestId("market-checkout-summary")).toBeVisible();
      await expect(page.getByTestId("market-checkout-child-order")).toHaveCount(
        2,
      );
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);

      const checkout = await fetchMarketCheckout(checkoutId!);
      expect(checkout.data?.checkout).toMatchObject({
        id: checkoutId,
        status: "submitted",
        market: {
          slug: checkoutFixture!.marketSlug,
        },
      });
      expect(checkout.data?.checkout?.childOrders).toHaveLength(2);

      const storedCheckout = await page.evaluate((id) => {
        const raw = window.localStorage.getItem(
          "makanmakan_recent_market_checkouts",
        );
        const checkouts = raw
          ? (JSON.parse(raw) as Array<{ id?: string }>)
          : [];
        return checkouts.find((checkout) => checkout.id === id) ?? null;
      }, checkoutId);
      expect(storedCheckout).toBeTruthy();
    } finally {
      await cancelMarketCheckoutChildOrders(createBody?.data?.childOrders);
    }
  });

  test("guest order created by the real API is readable in customer tracking UI", async ({
    page,
  }) => {
    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId || fixtureIds.menuItemId === undefined,
      "WORKFLOW_RESTAURANT_ID and WORKFLOW_MENU_ITEM_ID are required for guest workflow",
    );

    const menu = await fetchMenu(fixtureIds.restaurantId!);
    const menuItemId =
      fixtureIds.menuItemId ?? firstAvailableMenuItemId(menu as any);
    skipWhen(menuItemId === undefined, "real API did not return a menu item");

    const createResponse = await fetch(`${API_URL}/api/v1/guest-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: fixtureIds.restaurantId,
        orderType: "shop",
        items: [{ menuItemId, quantity: 1 }],
        guestName: "workflow-test",
        phoneLastDigits: randomPhoneLastDigits(),
      }),
    });
    expect(
      createResponse.ok,
      `guest order create status ${createResponse.status}`,
    ).toBe(true);

    const createBody = (await createResponse.json()) as GuestOrderResponse;
    const orderId = createBody.data?.order?.id;
    const orderNumber = createBody.data?.order?.orderNumber;
    const guestToken = createBody.data?.guestToken;

    expect(typeof orderId, "created order id").toBe("string");
    expect(typeof guestToken, "created guest token").toBe("string");

    await page.addInitScript((token) => {
      window.localStorage.setItem("guest_auth_token", token);
    }, guestToken);

    try {
      await page.goto(
        `${CUSTOMER_URL}/restaurant/${fixtureIds.restaurantId}/shop/order/${orderId}`,
        { waitUntil: "domcontentloaded" },
      );

      await expect(page.getByTestId("order-timeline")).toBeVisible();
      if (orderNumber) {
        await expect(
          page.getByText(orderNumber, { exact: true }),
        ).toBeVisible();
      }
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      await fetch(`${API_URL}/api/v1/guest-orders/${orderId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${guestToken}` },
      }).catch(() => {
        /* best-effort cleanup */
      });
    }
  });

  test("owner dashboard updates a real API order status", async ({ page }) => {
    test.setTimeout(180_000);

    skipWhen(!ADMIN_URL, "WORKFLOW_ADMIN_URL/SMOKE_ADMIN_URL is required");

    const loginData = await getLoginData();
    assertLoginData(
      loginData,
      "WORKFLOW_AUTH_USERNAME/SMOKE_AUTH_USERNAME and password are required",
    );

    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId ||
        fixtureIds.menuItemId === undefined ||
        !fixtureIds.tableId,
      "WORKFLOW_RESTAURANT_ID, WORKFLOW_MENU_ITEM_ID, and WORKFLOW_TABLE_ID are required for admin workflow",
    );

    const createResponse = await fetch(`${API_URL}/api/v1/guest-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: fixtureIds.restaurantId,
        orderType: "table",
        tableId: fixtureIds.tableId,
        items: [{ menuItemId: fixtureIds.menuItemId, quantity: 1 }],
        guestName: "workflow-admin",
        phoneLastDigits: randomPhoneLastDigits(),
      }),
    });
    expect(
      createResponse.ok,
      `guest order create status ${createResponse.status}`,
    ).toBe(true);

    const createBody = (await createResponse.json()) as GuestOrderResponse;
    const orderId = createBody.data?.order?.id;
    const guestToken = createBody.data?.guestToken;

    expect(typeof orderId, "created order id").toBe("string");
    expect(typeof guestToken, "created guest token").toBe("string");

    await installAdminSession(page, loginData);

    try {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/v1/orders") && response.ok(),
          { timeout: 120_000 },
        ),
        page.goto(`${ADMIN_URL}/dashboard/orders`, {
          timeout: 60_000,
          waitUntil: "domcontentloaded",
        }),
      ]);

      await expect(page.getByTestId("admin-orders-page")).toBeVisible();
      const statusButton = page
        .getByTestId(`admin-order-update-${orderId}`)
        .first();
      await expect(statusButton).toBeVisible();

      const updateResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/orders/${orderId}/status`) &&
          response.request().method() === "PUT",
      );
      await statusButton.click();
      const updateResponse = await updateResponsePromise;
      expect(
        updateResponse.ok(),
        `admin order status update ${updateResponse.status()}`,
      ).toBe(true);

      await expect
        .poll(async () => {
          const body = await fetchOrder(orderId!, loginData.token!);
          return body.data?.status;
        })
        .toBe("confirmed");
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      await cancelOrderAsOwner(orderId!, loginData.token!);
      await fetch(`${API_URL}/api/v1/guest-orders/${orderId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${guestToken}` },
      }).catch(() => {
        /* best-effort cleanup */
      });
    }
  });

  test("service delivery marks a ready order delivered without sending an unsupported status", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    skipWhen(!ADMIN_URL, "WORKFLOW_ADMIN_URL/SMOKE_ADMIN_URL is required");

    const loginData = await getLoginData();
    assertLoginData(
      loginData,
      "WORKFLOW_AUTH_USERNAME/SMOKE_AUTH_USERNAME and password are required",
    );

    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId ||
        fixtureIds.menuItemId === undefined ||
        !fixtureIds.tableId,
      "WORKFLOW_RESTAURANT_ID, WORKFLOW_MENU_ITEM_ID, and WORKFLOW_TABLE_ID are required for service workflow",
    );

    const createResponse = await fetch(`${API_URL}/api/v1/guest-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: fixtureIds.restaurantId,
        orderType: "table",
        tableId: fixtureIds.tableId,
        items: [{ menuItemId: fixtureIds.menuItemId, quantity: 1 }],
        guestName: "workflow-service",
        phoneLastDigits: randomPhoneLastDigits(),
      }),
    });
    expect(
      createResponse.ok,
      `service workflow order create status ${createResponse.status}`,
    ).toBe(true);

    const createBody = (await createResponse.json()) as GuestOrderResponse;
    const orderId = createBody.data?.order?.id;
    const orderNumber = createBody.data?.order?.orderNumber;
    const guestToken = createBody.data?.guestToken;
    expect(typeof orderId, "created service order id").toBe("string");
    expect(typeof orderNumber, "created service order number").toBe("string");
    expect(typeof guestToken, "service guest token").toBe("string");

    await confirmOrder(orderId!, loginData.token!);
    await updateOrderStatus(orderId!, loginData.token!, "preparing");
    await updateOrderStatus(orderId!, loginData.token!, "ready");
    const readyOrder = await fetchOrder(orderId!, loginData.token!);
    expect(readyOrder.data?.status).toBe("ready");

    await installAdminSession(page, loginData);
    const statusRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        request.url().includes(`/api/v1/orders/${orderId}/status`)
      ) {
        statusRequests.push(request.postData() ?? "");
      }
    });

    try {
      const readyListResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname.endsWith("/api/v1/orders") &&
          url.searchParams.get("status") === "ready" &&
          response.ok()
        );
      });
      await page.goto(`${ADMIN_URL}/service`, {
        timeout: 60_000,
        waitUntil: "domcontentloaded",
      });
      await readyListResponse;

      await expect(page.getByText(orderNumber!, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Start Delivery" }).click();
      expect(statusRequests).toHaveLength(0);

      const deliveredResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/orders/${orderId}/status`) &&
          response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Confirm Delivered" }).click();
      const deliveredResponse = await deliveredResponsePromise;
      expect(
        deliveredResponse.ok(),
        `service delivery status update ${deliveredResponse.status()}`,
      ).toBe(true);
      expect(statusRequests).toEqual([
        expect.stringContaining('"status":"delivered"'),
      ]);

      await expect
        .poll(
          async () =>
            (await fetchOrder(orderId!, loginData.token!)).data?.status,
        )
        .toBe("delivered");
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      await cancelOrderAsOwner(orderId!, loginData.token!);
      await fetch(`${API_URL}/api/v1/guest-orders/${orderId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${guestToken}` },
      }).catch(() => {
        /* best-effort cleanup */
      });
    }
  });

  test("owner dashboard creates and updates a real menu item from the browser", async ({
    page,
  }) => {
    skipWhen(!ADMIN_URL, "WORKFLOW_ADMIN_URL/SMOKE_ADMIN_URL is required");

    const loginData = await getLoginData();
    assertLoginData(
      loginData,
      "WORKFLOW_AUTH_USERNAME/SMOKE_AUTH_USERNAME and password are required",
    );

    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId,
      "WORKFLOW_RESTAURANT_ID/SMOKE_RESTAURANT_ID not set and local discovery failed",
    );

    const menu = await fetchMenu(fixtureIds.restaurantId!);
    const category = firstMenuCategory(menu);
    const categoryId = Number(category?.id);
    skipWhen(
      !Number.isFinite(categoryId),
      "real API did not return a menu category",
    );

    const suffix = randomSuffix();
    const itemName = `Workflow Menu ${suffix}`;
    const updatedName = `Workflow Menu Updated ${suffix}`;
    let createdItemId: number | undefined;

    await installAdminSession(page, loginData);

    try {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/menu/${fixtureIds.restaurantId}`) &&
            response.ok(),
        ),
        page.goto(`${ADMIN_URL}/dashboard/menu`, {
          waitUntil: "domcontentloaded",
        }),
      ]);

      await page.getByTestId("admin-menu-add-item").click();
      await expect(page.getByTestId("item-modal")).toBeVisible();
      await page.getByTestId("menu-item-name-input").fill(itemName);
      await page.getByTestId("menu-item-price-input").fill("12.34");
      await page
        .getByTestId("menu-item-category-select")
        .selectOption(String(categoryId));

      const createResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/menu/${fixtureIds.restaurantId}/items`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("menu-item-submit").click();
      const createResponse = await createResponsePromise;
      expect(
        createResponse.ok(),
        `admin menu item create ${createResponse.status()}`,
      ).toBe(true);
      const createBody = (await createResponse.json()) as MenuMutationBody;
      createdItemId = createBody.data?.id;
      expect(typeof createdItemId, "created menu item id").toBe("number");

      await page.getByTestId("admin-menu-search").fill(itemName);
      await expect(
        page.getByTestId(`admin-menu-item-${createdItemId}`),
      ).toBeVisible();

      await page.getByTestId(`admin-menu-item-${createdItemId}`).hover();
      await page.getByTestId(`admin-menu-item-edit-${createdItemId}`).click();
      await expect(page.getByTestId("item-modal")).toBeVisible();
      await page.getByTestId("menu-item-name-input").fill(updatedName);
      await page.getByTestId("menu-item-price-input").fill("13.45");

      const updateResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/menu/items/${createdItemId}`) &&
          response.request().method() === "PUT",
      );
      await page.getByTestId("menu-item-submit").click();
      const updateResponse = await updateResponsePromise;
      expect(
        updateResponse.ok(),
        `admin menu item update ${updateResponse.status()}`,
      ).toBe(true);

      const updatedItem = await fetchMenuItem(createdItemId!, loginData.token!);
      expect(updatedItem.data?.name).toBe(updatedName);
      expect(updatedItem.data?.price).toBe(13.45);
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      if (createdItemId) {
        await deleteMenuItemAsOwner(createdItemId, loginData.token!);
      }
    }
  });

  test("owner dashboard creates, updates, and deletes a real menu category from the browser", async ({
    page,
  }) => {
    skipWhen(!ADMIN_URL, "WORKFLOW_ADMIN_URL/SMOKE_ADMIN_URL is required");

    const loginData = await getLoginData();
    assertLoginData(
      loginData,
      "WORKFLOW_AUTH_USERNAME/SMOKE_AUTH_USERNAME and password are required",
    );

    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId,
      "WORKFLOW_RESTAURANT_ID/SMOKE_RESTAURANT_ID not set and local discovery failed",
    );

    const suffix = randomSuffix();
    const categoryName = `Workflow Category ${suffix}`;
    const updatedCategoryName = `Workflow Category Updated ${suffix}`;
    let createdCategoryId: number | undefined;

    await installAdminSession(page, loginData);

    try {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/menu/${fixtureIds.restaurantId}`) &&
            response.ok(),
        ),
        page.goto(`${ADMIN_URL}/dashboard/menu`, {
          waitUntil: "domcontentloaded",
        }),
      ]);

      await page.getByTestId("add-category-btn").click();
      await expect(page.getByTestId("admin-category-form")).toBeVisible();
      await page.getByTestId("admin-category-name-input").fill(categoryName);
      await page
        .getByTestId("admin-category-name-en-input")
        .fill(`Workflow Category EN ${suffix}`);
      await page
        .getByTestId("admin-category-description-input")
        .fill("Real workflow category created by Playwright");
      await page.getByTestId("admin-category-sort-order-input").fill("999");

      const createResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/menu/${fixtureIds.restaurantId}/categories`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("admin-category-submit").click();
      const createResponse = await createResponsePromise;
      expect(
        createResponse.ok(),
        `admin category create ${createResponse.status()}`,
      ).toBe(true);
      const createBody = (await createResponse.json()) as MenuMutationBody;
      createdCategoryId = createBody.data?.id;
      expect(typeof createdCategoryId, "created category id").toBe("number");

      await expect(adminCategoryRow(page, createdCategoryId!)).toBeVisible();

      await adminCategoryRow(page, createdCategoryId!).hover();
      await page
        .getByTestId(`admin-category-edit-${createdCategoryId}`)
        .click();
      await expect(page.getByTestId("admin-category-form")).toBeVisible();
      await page
        .getByTestId("admin-category-name-input")
        .fill(updatedCategoryName);
      await page
        .getByTestId("admin-category-description-input")
        .fill("Real workflow category updated by Playwright");

      const updateResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/menu/categories/${createdCategoryId}`) &&
          response.request().method() === "PUT",
      );
      await page.getByTestId("admin-category-submit").click();
      const updateResponse = await updateResponsePromise;
      expect(
        updateResponse.ok(),
        `admin category update ${updateResponse.status()}`,
      ).toBe(true);

      await expect(adminCategoryRow(page, createdCategoryId!)).toContainText(
        updatedCategoryName,
      );
      await expect
        .poll(async () => {
          const menu = await fetchMenu(fixtureIds.restaurantId!);
          return findMenuCategory(menu, createdCategoryId!)?.name;
        })
        .toBe(updatedCategoryName);

      await adminCategoryRow(page, createdCategoryId!).hover();
      await page
        .getByTestId(`admin-category-delete-${createdCategoryId}`)
        .click();
      await expect(
        page.getByText(updatedCategoryName, { exact: true }),
      ).toBeVisible();

      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/menu/categories/${createdCategoryId}`) &&
          response.request().method() === "DELETE",
      );
      await page.getByTestId("admin-delete-confirm").click();
      const deleteResponse = await deleteResponsePromise;
      expect(
        deleteResponse.ok(),
        `admin category delete ${deleteResponse.status()}`,
      ).toBe(true);

      await expect(adminCategoryRow(page, createdCategoryId!)).toHaveCount(0);
      await expect
        .poll(async () => {
          const menu = await fetchMenu(fixtureIds.restaurantId!);
          return findMenuCategory(menu, createdCategoryId!);
        })
        .toBeUndefined();
      createdCategoryId = undefined;
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      if (createdCategoryId) {
        await deleteCategoryAsOwner(createdCategoryId, loginData.token!);
      }
    }
  });

  test("kitchen display handles real orders plus SSE, offline, and audio browser runtime", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    skipWhen(
      !KITCHEN_URL,
      "WORKFLOW_KITCHEN_URL/SMOKE_KITCHEN_URL is required",
    );

    const ownerLoginData = await getLoginData();
    assertLoginToken(
      ownerLoginData,
      "WORKFLOW_AUTH_USERNAME/SMOKE_AUTH_USERNAME and password are required",
    );

    const chefLoginData = await loginChef();
    assertChefLoginData(
      chefLoginData,
      "WORKFLOW_CHEF_USERNAME and WORKFLOW_CHEF_PASSWORD are required for non-local kitchen workflow",
    );

    const fixtureIds = await resolveFixtureIds();
    skipWhen(
      !fixtureIds.restaurantId ||
        fixtureIds.menuItemId === undefined ||
        !fixtureIds.tableId,
      "WORKFLOW_RESTAURANT_ID, WORKFLOW_MENU_ITEM_ID, and WORKFLOW_TABLE_ID are required for kitchen workflow",
    );

    const createResponse = await fetch(`${API_URL}/api/v1/guest-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: fixtureIds.restaurantId,
        orderType: "table",
        tableId: fixtureIds.tableId,
        items: [{ menuItemId: fixtureIds.menuItemId, quantity: 1 }],
        guestName: "workflow-kitchen",
        phoneLastDigits: randomPhoneLastDigits(),
      }),
    });
    expect(
      createResponse.ok,
      `guest order create status ${createResponse.status}`,
    ).toBe(true);

    const createBody = (await createResponse.json()) as GuestOrderResponse;
    const orderId = createBody.data?.order?.id;
    const guestToken = createBody.data?.guestToken;

    expect(typeof orderId, "created order id").toBe("string");
    expect(typeof guestToken, "created guest token").toBe("string");

    await confirmOrder(orderId!, ownerLoginData!.token!);
    const createdOrder = await fetchOrder(orderId!, ownerLoginData!.token!);
    const orderItemId = createdOrder.data?.items?.[0]?.id;
    expect(typeof orderItemId, "created order item id").toBe("number");
    await installKitchenSession(page, chefLoginData);
    await installKitchenBrowserRuntimeHooks(page);

    try {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/kitchen/${fixtureIds.restaurantId}/orders`) &&
            response.ok(),
          { timeout: 120_000 },
        ),
        page.goto(`${KITCHEN_URL}/kitchen/${fixtureIds.restaurantId}`, {
          timeout: 60_000,
          waitUntil: "domcontentloaded",
        }),
      ]);

      await expect(page.getByTestId("kitchen-dashboard")).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate((restaurantId) => {
            const legacySseConnected = window.__kitchenEventSourceUrls.some(
              (url) =>
                url.includes(`/api/v1/kitchen/${restaurantId}/events?token=`),
            );
            const realtimeWsConnected =
              window.__kitchenWebSocketUrls.length > 0;
            return legacySseConnected || realtimeWsConnected;
          }, fixtureIds.restaurantId),
        )
        .toBe(true);
      await expect(
        page.getByTestId("kitchen-connection-status"),
      ).toHaveAttribute("data-connection-status", /^(connected|connecting)$/);

      await page.evaluate(
        ({ restaurantId, syntheticOrderId, syntheticItemId }) => {
          const order = {
            id: syntheticOrderId,
            orderNumber: `WF-AUDIO-${syntheticOrderId}`,
            status: "confirmed",
            deliveryInfo: { type: "dine_in" },
            tableName: "Workflow",
            customer: { name: "Workflow Audio" },
            items: [
              {
                id: syntheticItemId,
                orderItemId: syntheticItemId,
                name: "Audio workflow item",
                menuItemName: "Audio workflow item",
                quantity: 1,
                status: "pending",
                priority: "high",
                price: 0,
              },
            ],
            createdAt: new Date().toISOString(),
            totalItems: 1,
            priority: "high",
            elapsedTime: 0,
            totalAmount: 0,
          };
          window.__emitKitchenSse({
            type: "NEW_ORDER",
            eventId: `workflow-audio-${syntheticOrderId}`,
            timestamp: Date.now(),
            restaurantId,
            payload: {
              priority: "high",
              order,
            },
          });
          window.__emitKitchenRealtime({
            type: "new_order",
            eventId: `workflow-audio-${syntheticOrderId}`,
            timestamp: Date.now(),
            restaurantId,
            data: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              tableName: order.tableName,
              customer: order.customer,
              items: order.items,
              priority: "high",
              totalAmount: order.totalAmount,
            },
          });
        },
        {
          restaurantId: fixtureIds.restaurantId!,
          syntheticOrderId: `workflow-audio-${orderId!}`,
          syntheticItemId: 900_001,
        },
      );
      await expect
        .poll(async () =>
          page.evaluate(() =>
            window.__kitchenAudioPlayRequests.some(
              (request) =>
                request.type === "newOrder" && request.priority === "high",
            ),
          ),
        )
        .toBe(true);

      await expect(page.getByTestId("kitchen-audio-toggle")).toHaveAttribute(
        "data-audio-enabled",
        "true",
      );
      await page.getByTestId("kitchen-audio-toggle").click();
      await expect(page.getByTestId("kitchen-audio-toggle")).toHaveAttribute(
        "data-audio-enabled",
        "false",
      );
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const settings = window.localStorage.getItem("kitchen_settings");
            return settings ? JSON.parse(settings).audioEnabled : undefined;
          }),
        )
        .toBe(false);

      await expect(
        page.getByTestId(`kitchen-order-card-${orderId}`),
      ).toBeVisible();

      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.getByTestId("kitchen-offline-status")).toBeVisible();
      await expect
        .poll(async () => page.evaluate(() => navigator.onLine))
        .toBe(false);

      const startButton = page.getByTestId(
        `kitchen-item-start-${orderId}-${orderItemId}`,
      );
      await startButton.scrollIntoViewIfNeeded();
      await expect(startButton).toBeVisible();
      await expect(startButton).toBeEnabled();
      await page
        .getByTestId(`kitchen-item-start-${orderId}-${orderItemId}`)
        .click();
      let queuedSnapshot: {
        buttonExists: boolean;
        navigatorOnline: boolean;
        queued: boolean;
        actions: unknown[];
        cachedItemStatus?: string;
      } | null = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        queuedSnapshot = await page.evaluate(
          ({ targetOrderId, targetItemId }) => {
            const offlineData = window.localStorage.getItem(
              "kitchen-offline-data",
            );
            const cachedOrders = window.localStorage.getItem(
              "kitchen-cached-orders",
            );
            const actions = offlineData
              ? (JSON.parse(offlineData).actions ?? [])
              : [];
            const cachedOrder = cachedOrders
              ? JSON.parse(cachedOrders).find(
                  (order: { id?: string }) => order.id === targetOrderId,
                )
              : undefined;
            const cachedItem = cachedOrder?.items?.find(
              (item: { id?: number }) => item.id === targetItemId,
            );
            return {
              buttonExists: Boolean(
                document.querySelector(
                  `[data-testid="kitchen-item-start-${targetOrderId}-${targetItemId}"]`,
                ),
              ),
              navigatorOnline: navigator.onLine,
              queued: actions.some(
                (action: {
                  type?: string;
                  orderId?: string;
                  itemId?: number;
                  synced?: boolean;
                }) =>
                  action.type === "start_cooking" &&
                  action.orderId === targetOrderId &&
                  action.itemId === targetItemId &&
                  action.synced === false,
              ),
              actions,
              cachedItemStatus: cachedItem?.status,
            };
          },
          { targetOrderId: orderId, targetItemId: orderItemId },
        );
        if (queuedSnapshot.queued) break;
        await page.waitForTimeout(500);
      }
      expect(
        queuedSnapshot?.navigatorOnline,
        JSON.stringify(queuedSnapshot, null, 2),
      ).toBe(false);
      expect(
        queuedSnapshot?.queued,
        JSON.stringify(queuedSnapshot, null, 2),
      ).toBe(true);

      const replayResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/api/v1/kitchen/${fixtureIds.restaurantId}/orders/${orderId}/items/`,
            ) && response.request().method() === "PUT",
      );
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.getByTestId("kitchen-offline-status")).toHaveCount(0);
      const updateResponse = await replayResponsePromise;
      expect(
        updateResponse.ok(),
        `kitchen offline replay status update ${updateResponse.status()}`,
      ).toBe(true);

      await expect
        .poll(async () => {
          const body = await fetchKitchenOrders(
            fixtureIds.restaurantId!,
            chefLoginData.token!,
          );
          const order = findKitchenOrder(body, orderId!);
          return order?.items?.some((item) => item.status === "preparing");
        })
        .toBe(true);
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const offlineData = window.localStorage.getItem(
              "kitchen-offline-data",
            );
            if (!offlineData) return 0;
            return JSON.parse(offlineData).actions?.length ?? 0;
          }),
        )
        .toBe(0);
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      await cancelOrderAsOwner(orderId!, ownerLoginData!.token!);
      await deactivateWorkflowChef(chefLoginData!, ownerLoginData!);
      await fetch(`${API_URL}/api/v1/guest-orders/${orderId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${guestToken}` },
      }).catch(() => {
        /* best-effort cleanup */
      });
    }
  });

  test("management portal health page loads data from the management API", async ({
    page,
  }) => {
    skipWhen(
      !MANAGEMENT_PORTAL_URL || !MANAGEMENT_TOKEN,
      "WORKFLOW_MANAGEMENT_PORTAL_URL and WORKFLOW_MANAGEMENT_TOKEN are required",
    );

    await installManagementSession(page, MANAGEMENT_TOKEN!);

    const healthResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/health") && response.ok(),
    );

    await page.goto(`${MANAGEMENT_PORTAL_URL}/health`, {
      waitUntil: "domcontentloaded",
    });

    await healthResponse;
    await expect(page.getByTestId("management-health-page")).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });

  test("management portal tenants page loads tenant data from the management API", async ({
    page,
  }) => {
    skipWhen(
      !MANAGEMENT_PORTAL_URL || !MANAGEMENT_TOKEN,
      "WORKFLOW_MANAGEMENT_PORTAL_URL and WORKFLOW_MANAGEMENT_TOKEN are required",
    );

    await installManagementSession(page, MANAGEMENT_TOKEN!);

    const tenantsResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/tenants") && response.ok(),
    );

    await page.goto(`${MANAGEMENT_PORTAL_URL}/tenants`, {
      waitUntil: "domcontentloaded",
    });

    await tenantsResponse;
    await expect(page.getByTestId("management-tenants-page")).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });

  test("management portal creates a real tenant from the browser and reads it back from the management API", async ({
    page,
  }) => {
    skipWhen(
      !MANAGEMENT_PORTAL_URL ||
        !MANAGEMENT_TOKEN ||
        !MANAGEMENT_WORKFLOW_API_URL,
      "WORKFLOW_MANAGEMENT_PORTAL_URL, WORKFLOW_MANAGEMENT_TOKEN, and management API URL are required",
    );

    const suffix = randomSuffix();
    const businessName = `Workflow Tenant ${suffix}`;
    const contactEmail = `workflow-${suffix}@example.com`;
    const contactPhone = randomUsPhone();
    const subdomain = `workflow-${suffix}`;
    let createdTenantId: string | undefined;

    await installManagementSession(page, MANAGEMENT_TOKEN!);

    try {
      const tenantsResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/tenants") &&
          response.request().method() === "GET" &&
          response.ok(),
      );

      await page.goto(`${MANAGEMENT_PORTAL_URL}/tenants`, {
        waitUntil: "domcontentloaded",
      });
      await tenantsResponse;

      await page.getByTestId("management-tenant-create-open").click();
      await expect(
        page.getByTestId("management-tenant-create-modal"),
      ).toBeVisible();
      await page
        .getByTestId("management-tenant-business-name")
        .fill(businessName);
      await page
        .getByTestId("management-tenant-contact-email")
        .fill(contactEmail);
      await page
        .getByTestId("management-tenant-contact-phone")
        .fill(contactPhone);
      await page.getByTestId("management-tenant-subdomain").fill(subdomain);
      await page.getByTestId("management-tenant-license-professional").check();

      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/tenants") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("management-tenant-create-submit").click();
      const createResponse = await createResponsePromise;
      expect(
        createResponse.ok(),
        `management tenant create ${createResponse.status()}`,
      ).toBe(true);
      const createBody = (await createResponse.json()) as ManagementTenantBody;
      createdTenantId = createBody.data?.id;
      expect(typeof createdTenantId, "created tenant id").toBe("string");

      await expect(
        page.locator(
          `[data-testid="management-tenant-row"][data-tenant-id="${createdTenantId}"]`,
        ),
      ).toContainText(businessName);

      const createdTenant = await fetchManagementTenantById(
        createdTenantId!,
        MANAGEMENT_TOKEN!,
      );
      expect(createdTenant.data).toMatchObject({
        id: createdTenantId,
        businessName,
        contactEmail,
        contactPhone,
        subdomain,
        licenseTier: "professional",
      });
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      if (createdTenantId) {
        await deleteManagementTenant(createdTenantId, MANAGEMENT_TOKEN!);
      }
    }
  });

  test("management portal tenant detail loads tenant resources, deployments, health, and licenses from the management API", async ({
    page,
  }) => {
    skipWhen(
      !MANAGEMENT_PORTAL_URL ||
        !MANAGEMENT_TOKEN ||
        !MANAGEMENT_WORKFLOW_API_URL,
      "WORKFLOW_MANAGEMENT_PORTAL_URL and WORKFLOW_MANAGEMENT_TOKEN are required",
    );

    let createdTenantId: string | undefined;
    let tenant = await fetchManagementTenant(MANAGEMENT_TOKEN!);
    if (!tenant?.id) {
      const fixture = await createManagementTenantFixture(MANAGEMENT_TOKEN!);
      createdTenantId = fixture.id;
      tenant = {
        id: fixture.id,
        businessName: fixture.businessName,
      };
    }

    await installManagementSession(page, MANAGEMENT_TOKEN!);

    try {
      const tenantResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/tenants/${tenant!.id}`) &&
          response.ok(),
      );
      const resourcesResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/tenants/${tenant!.id}/resources`) &&
          response.ok(),
      );
      const deploymentsResponse = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/deployments/${tenant!.id}/history`) &&
          response.ok(),
      );
      const healthResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/health/tenants/${tenant!.id}`) &&
          response.ok(),
      );
      const licensesResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/licenses/${tenant!.id}`) &&
          response.ok(),
      );

      await page.goto(`${MANAGEMENT_PORTAL_URL}/tenants/${tenant!.id}`, {
        waitUntil: "domcontentloaded",
      });

      await Promise.all([
        tenantResponse,
        resourcesResponse,
        deploymentsResponse,
        healthResponse,
        licensesResponse,
      ]);
      await expect(
        page.getByTestId("management-tenant-detail-page"),
      ).toBeVisible();
      await expect(
        page.getByTestId("management-tenant-overview"),
      ).toBeVisible();
      if (tenant!.businessName) {
        await expect(
          page.getByText(tenant!.businessName).first(),
        ).toBeVisible();
      }

      await page.getByTestId("management-tenant-tab-deployments").click();
      await expect(
        page.getByTestId("management-tenant-deployments"),
      ).toBeVisible();
      await page.getByTestId("management-tenant-tab-health").click();
      await expect(page.getByTestId("management-tenant-health")).toBeVisible();
      await page.getByTestId("management-tenant-tab-license").click();
      await expect(page.getByTestId("management-tenant-license")).toBeVisible();
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    } finally {
      if (createdTenantId) {
        await deleteManagementTenant(createdTenantId, MANAGEMENT_TOKEN!);
      }
    }
  });

  test("management portal deployments, licenses, and markets pages load from management APIs", async ({
    page,
  }) => {
    skipWhen(
      !MANAGEMENT_PORTAL_URL || !MANAGEMENT_TOKEN,
      "WORKFLOW_MANAGEMENT_PORTAL_URL and WORKFLOW_MANAGEMENT_TOKEN are required",
    );

    await installManagementSession(page, MANAGEMENT_TOKEN!);

    const deploymentsTenantsResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/tenants") && response.ok(),
    );
    await page.goto(`${MANAGEMENT_PORTAL_URL}/deployments`, {
      waitUntil: "domcontentloaded",
    });
    await deploymentsTenantsResponse;
    await expect(page.getByTestId("management-deployments-page")).toBeVisible();

    const licensesTenantsResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/tenants") && response.ok(),
    );
    await page.goto(`${MANAGEMENT_PORTAL_URL}/licenses`, {
      waitUntil: "domcontentloaded",
    });
    await licensesTenantsResponse;
    await expect(page.getByTestId("management-licenses-page")).toBeVisible();

    const marketsResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/markets") && response.ok(),
    );
    await page.goto(`${MANAGEMENT_PORTAL_URL}/markets`, {
      waitUntil: "domcontentloaded",
    });
    await marketsResponse;
    await expect(page.getByTestId("management-markets-page")).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });

  test("onboarding app submits the application form to the management API", async ({
    page,
  }) => {
    skipWhen(
      !ONBOARDING_URL || !MANAGEMENT_API_URL,
      "WORKFLOW_ONBOARDING_URL and WORKFLOW_MANAGEMENT_API_URL are required",
    );

    const suffix = randomSuffix();
    const subdomain = `workflow-${suffix}`;

    await page.goto(`${ONBOARDING_URL}/apply`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByTestId("onboarding-business-name").fill("Workflow Laksa");
    await page.getByTestId("onboarding-contact-name").fill("Tan Mei");
    await page
      .getByTestId("onboarding-contact-email")
      .fill(`workflow-${suffix}@example.com`);
    await page.getByTestId("onboarding-contact-phone").fill("0912345678");
    await page.getByTestId("onboarding-latitude").fill("24.147736");
    await page.getByTestId("onboarding-longitude").fill("120.673648");
    await page.getByTestId("onboarding-subdomain").fill(subdomain);

    await expect
      .poll(async () => {
        const response = await fetch(
          `${MANAGEMENT_API_ORIGIN_URL}/api/v1/onboarding/subdomain/check?subdomain=${subdomain}`,
        );
        if (!response.ok) return false;
        const body = (await response.json()) as {
          success: boolean;
          data?: { available?: boolean };
        };
        return body.success && body.data?.available === true;
      })
      .toBe(true);

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/onboarding/applications") &&
        response.request().method() === "POST",
    );

    await page.getByTestId("onboarding-submit").click();

    const createResponse = await createResponsePromise;
    expect(
      createResponse.ok(),
      `onboarding create status ${createResponse.status()}`,
    ).toBe(true);
    const createBody = (await createResponse.json()) as {
      success: boolean;
      data?: { applicationId?: string; assignedSubdomain?: string };
    };
    expect(createBody.success).toBe(true);
    expect(createBody.data?.assignedSubdomain).toBe(subdomain);

    await expect(page).toHaveURL(/\/success$/);
    await expect(page.getByTestId("onboarding-success")).toBeVisible();
    await expect(
      page.getByText(/Pending Platform Review|等待平台審核/),
    ).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });
});
