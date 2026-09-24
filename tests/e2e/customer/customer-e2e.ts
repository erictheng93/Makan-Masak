/**
 * Shared harness for the real-backend customer app E2E suite.
 *
 * Same contract as `tests/e2e/admin/admin-e2e.ts`, which this is modelled on:
 * every request the browser makes is served by a real `wrangler dev` Worker
 * against a real local D1, fixtures are created through the real API, and every
 * write the UI performs is read back from the API afterwards.
 *
 * `page.route()` appears exactly once (group-orders.spec.ts), and only to hold
 * a real response back for a moment so a race window a phone opens on its own
 * is wide enough to hit. No route here may fulfil or abort a request.
 *
 * Three things differ from the admin harness, and each is load-bearing:
 *
 * 1. **Three services, not two.** Order tracking, the waiting list and group
 *    orders are live over WebSocket, so the realtime worker (:8788) is part of
 *    the stack and part of the reachability gate. Without it the tracking page
 *    still renders and simply never updates, which reads as a product bug.
 *
 * 2. **The diner is a browser context, not a login.** Guest ordering holds a
 *    one-active-order lock per (restaurant, device), and the device id lives in
 *    localStorage. A test that needs two diners needs two contexts, and every
 *    context is built by `newDinerContext` so it gets the zh-TW locale the
 *    Chinese UI strings below are written against.
 *
 * 3. **Staff actions go through the API.** The customer app has no staff
 *    surface; driving the admin dashboard to push an order status would test
 *    the admin app instead. Staff logins are memoised per worker because a
 *    staff login invalidates that user's other sessions.
 */
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  optionalEnv,
  smokeLogin,
  type SmokeLoginData,
} from "../smoke/smoke-env";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const API_URL =
  optionalEnv("E2E_API_URL") ??
  optionalEnv("WORKFLOW_API_URL") ??
  "http://127.0.0.1:8787";

export const CUSTOMER_URL =
  optionalEnv("E2E_CUSTOMER_URL") ??
  optionalEnv("WORKFLOW_CUSTOMER_URL") ??
  "http://127.0.0.1:3000";

export const REALTIME_URL =
  optionalEnv("E2E_REALTIME_URL") ?? "http://127.0.0.1:8788";

/** Every skip becomes a failure. CI sets it: "stack down" is not "app works". */
export const STRICT =
  /^(1|true)$/i.test(optionalEnv("E2E_STRICT") ?? "") ||
  /^(1|true)$/i.test(optionalEnv("WORKFLOW_STRICT") ?? "");

/** scripts/seed-local.sql: owner1/owner123 owns restaurant …0099. */
export const OWNER_USERNAME = optionalEnv("E2E_OWNER_USERNAME") ?? "owner1";
export const OWNER_PASSWORD = optionalEnv("E2E_OWNER_PASSWORD") ?? "owner123";

/** Platform admin (role 0), also from the local seed. Local-only credentials. */
export const ADMIN_USERNAME = optionalEnv("E2E_ADMIN_USERNAME") ?? "admin";
export const ADMIN_PASSWORD = optionalEnv("E2E_ADMIN_PASSWORD") ?? "admin123";

/**
 * A cashier the suite provisions for itself through `POST /api/v1/users`.
 *
 * The seed does have `cashier1`, but its password is documented nowhere and
 * matches none of the demo conventions (`cashier123` and friends all 401), so
 * the suite cannot log in as it. Creating a role-4 account through the owner's
 * real API is the honest alternative to guessing.
 */
export const CASHIER_USERNAME = "e2e_customer_cashier";
const CASHIER_PASSWORD = "E2e-Cashier-2026!";

export const NAV_TIMEOUT = 60_000;
/** Budget for a server-driven UI change (realtime push, poll, refetch). */
export const LIVE_TIMEOUT = 30_000;

export const DINER_LOCALE = "zh-TW";
export const DINER_TIMEZONE = "Asia/Taipei";

// ---------------------------------------------------------------------------
// Reachability preflight
// ---------------------------------------------------------------------------

interface StackStatus {
  ready: boolean;
  reason?: string;
}

let stackStatusPromise: Promise<StackStatus> | undefined;

async function probe(url: string, label: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
    if (response.status >= 500) {
      return `${label} at ${url} returned ${response.status}`;
    }
    return undefined;
  } catch (error) {
    return `${label} at ${url} is unreachable (${(error as Error).message})`;
  }
}

function getStackStatus(): Promise<StackStatus> {
  stackStatusPromise ??= (async () => {
    const reasons = (
      await Promise.all([
        probe(`${API_URL}/info`, "API worker"),
        probe(`${REALTIME_URL}/health`, "realtime worker"),
        probe(`${CUSTOMER_URL}/`, "customer app"),
      ])
    ).filter((reason): reason is string => reason !== undefined);

    return reasons.length > 0
      ? {
          ready: false,
          reason: `${reasons.join("; ")}. Start apps/realtime and apps/api with \`wrangler dev --local\` (same --persist-to, realtime first) and the customer app with vite.`,
        }
      : { ready: true };
  })();
  return stackStatusPromise;
}

/** First line of every test: skip (or, under STRICT, fail) unless all three answer. */
export async function requireStack(): Promise<void> {
  const status = await getStackStatus();
  if (status.ready) return;
  if (STRICT)
    throw new Error(status.reason ?? "customer E2E stack is not ready");
  test.skip(true, status.reason ?? "customer E2E stack is not ready");
}

// ---------------------------------------------------------------------------
// Node-side API access
// ---------------------------------------------------------------------------

/**
 * apps/api/src/middleware/csrf.ts is a double-submit check: the header must
 * equal the cookie, and the origin must be one the API trusts. Its own origin
 * always is.
 */
function csrfHeaders(): Record<string, string> {
  const token = "c".repeat(64);
  return {
    "X-CSRF-Token": token,
    cookie: `csrf_token=${token}`,
    origin: new URL(API_URL).origin,
  };
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
  message?: string;
}

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: ApiEnvelope<T>;
}

/** Never throws on a non-2xx: callers assert, so the status lands in the message. */
export async function apiRequest<T = unknown>(
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult<T>> {
  const { token, method = "GET", body, headers = {} } = options;
  const allHeaders: Record<string, string> = { ...csrfHeaders(), ...headers };
  if (token) allHeaders.Authorization = `Bearer ${token}`;
  if (body !== undefined) allHeaders["Content-Type"] = "application/json";

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: allHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed = (await response
    .json()
    .catch(() => ({ success: false }))) as ApiEnvelope<T>;
  return { status: response.status, ok: response.ok, body: parsed };
}

/** A fixture call that must succeed; the failure message carries the body. */
export async function apiData<T>(
  label: string,
  path: string,
  options: Parameters<typeof apiRequest>[1] = {},
): Promise<T> {
  const result = await apiRequest<T>(path, options);
  expect(
    result.ok,
    `${label}: ${options.method ?? "GET"} ${path} returned ${result.status} ${JSON.stringify(result.body.error ?? result.body)}`,
  ).toBe(true);
  return result.body.data as T;
}

// ---------------------------------------------------------------------------
// Staff sessions
// ---------------------------------------------------------------------------

function memoLogin(
  username: string,
  password: string,
): () => Promise<SmokeLoginData> {
  let promise: Promise<SmokeLoginData> | undefined;
  return () => {
    promise ??= smokeLogin(API_URL, username, password).catch((error) => {
      promise = undefined;
      throw error;
    });
    return promise;
  };
}

const ownerLogin = memoLogin(OWNER_USERNAME, OWNER_PASSWORD);
const adminLogin = memoLogin(ADMIN_USERNAME, ADMIN_PASSWORD);

export interface StaffContext {
  token: string;
  userId: string;
  restaurantId: string;
}

export async function getOwner(): Promise<StaffContext> {
  const login = await ownerLogin();
  expect(login.token, "owner login returns a token").toBeTruthy();
  expect(login.user?.restaurantId, "owner is bound to a shop").toBeTruthy();
  return {
    token: login.token!,
    userId: login.user!.id!,
    restaurantId: login.user!.restaurantId!,
  };
}

/** Role 0 has no shop of its own; restaurant-scoped calls pass the id. */
export async function getAdmin(): Promise<{ token: string }> {
  const login = await adminLogin();
  expect(login.user?.role, "admin login is role 0").toBe(0);
  return { token: login.token! };
}

let cashierLoginPromise: Promise<SmokeLoginData> | undefined;

/**
 * A role-4 session for the owner's shop, provisioning the account on first use.
 *
 * Login is tried first rather than create-then-tolerate-a-conflict: a duplicate
 * username currently comes back as a 500 GENERIC_ERROR, not a 409, so the
 * create response cannot tell "already there" apart from a real failure.
 */
export async function getCashier(): Promise<StaffContext> {
  cashierLoginPromise ??= (async () => {
    try {
      return await smokeLogin(API_URL, CASHIER_USERNAME, CASHIER_PASSWORD);
    } catch {
      const owner = await getOwner();
      await apiData("provision cashier", "/api/v1/users", {
        token: owner.token,
        method: "POST",
        body: {
          username: CASHIER_USERNAME,
          fullName: "E2E Customer Suite Cashier",
          password: CASHIER_PASSWORD,
          role: 4,
          restaurantId: owner.restaurantId,
        },
      });
      return smokeLogin(API_URL, CASHIER_USERNAME, CASHIER_PASSWORD);
    }
  })().catch((error) => {
    cashierLoginPromise = undefined;
    throw error;
  });

  const login = await cashierLoginPromise;
  expect(login.user?.role, "cashier login is role 4").toBe(4);
  return {
    token: login.token!,
    userId: login.user!.id!,
    restaurantId: login.user!.restaurantId!,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Reverse-order, best-effort teardown. A cleanup failure is logged, never
 * thrown: it must not mask the assertion that actually failed.
 */
export class Cleanup {
  private readonly steps: Array<{
    label: string;
    run: () => Promise<unknown>;
  }> = [];

  add(label: string, run: () => Promise<unknown>): void {
    this.steps.push({ label, run });
  }

  async run(): Promise<void> {
    while (this.steps.length > 0) {
      const step = this.steps.pop()!;
      try {
        await step.run();
      } catch (error) {
        console.warn(`[customer-e2e cleanup] ${step.label}: ${String(error)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Browser: diners, toasts, realtime frames
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __e2eToasts?: string[];
  }
}

/**
 * Records every toast body the page shows, for the life of the page.
 *
 * Toasts live about three seconds, so an assertion made after the fact reads
 * "no toast" when the toast came and went. A MutationObserver installed before
 * the app boots sees each one exactly once, which is also what lets a test say
 * "exactly one cancel toast" instead of "at least one".
 */
async function installToastRecorder(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.__e2eToasts = [];
    const seen = new WeakSet<Element>();
    const collect = (root: ParentNode) => {
      root
        .querySelectorAll(".Vue-Toastification__toast-body")
        .forEach((node) => {
          if (seen.has(node)) return;
          seen.add(node);
          window.__e2eToasts!.push((node.textContent ?? "").trim());
        });
    };
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            if (node.matches(".Vue-Toastification__toast-body")) {
              collect(node.parentElement ?? node);
            } else {
              collect(node);
            }
          }
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

export async function toasts(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__e2eToasts ?? [])]);
}

/**
 * A fresh diner: its own storage, so its own guest device id and lock.
 * `storageState` resumes a diner saved earlier, e.g. a signed-in member.
 */
export async function newDinerContext(
  browser: Browser,
  options: {
    storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>;
  } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: options.storageState,
    baseURL: CUSTOMER_URL,
    locale: DINER_LOCALE,
    timezoneId: DINER_TIMEZONE,
    viewport: { width: 390, height: 844 },
  });
  await installToastRecorder(context);
  const page = await context.newPage();
  return { context, page };
}

/**
 * Records the `type` of every realtime event the page receives.
 *
 * This is what separates "the server never sent it" from "the page received it
 * and did nothing": when a live-update assertion fails, the message says which.
 */
export function recordRealtimeEvents(page: Page): string[] {
  const types: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      try {
        const parsed = JSON.parse(String(payload)) as { type?: unknown };
        if (typeof parsed.type === "string") types.push(parsed.type);
      } catch {
        /* non-JSON heartbeat */
      }
    });
  });
  return types;
}

/**
 * Resolves once the realtime worker has acknowledged the page's socket.
 *
 * A staff write made before this point is broadcast to a room the page has not
 * joined yet, and the test would then blame the page for an event it was never
 * sent.
 */
export async function waitForRealtimeAck(events: string[]): Promise<void> {
  await expect
    .poll(() => events.includes("connection_ack"), {
      message: "the page's realtime socket was never acknowledged",
      timeout: LIVE_TIMEOUT,
    })
    .toBe(true);
}

/**
 * Plants a marker in the page's JS heap. A reload clears it, so
 * `expectNoReload` failing means the page only showed the change by reloading.
 */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __e2eSameDocument?: boolean }).__e2eSameDocument =
      true;
  });
}

export async function expectNoReload(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __e2eSameDocument?: boolean })
          .__e2eSameDocument === true,
    ),
    "the page reloaded; the update was supposed to arrive live",
  ).toBe(true);
}

/** Catches a runtime Vue/Vite error that still rendered a plausible page. */
export async function assertNoOverlayError(page: Page): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Fixtures through the real API
// ---------------------------------------------------------------------------

export function suffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

/** Every artifact this suite creates is named so a stray row is identifiable. */
export function e2eName(label: string): string {
  return `E2E ${label} ${suffix()}`;
}

/** The signed QR is issued for a production-shaped origin; keep path + query. */
export function qrPath(qrCode: string): string {
  const url = new URL(qrCode);
  return `${url.pathname}${url.search}`;
}

export interface TableFixture {
  id: number;
  number: string;
  qrCode: string;
  seats: Array<{ id: number; seatNumber: string; qrCode: string }>;
}

/**
 * A table with a signed QR, created through `POST /api/v1/tables`.
 *
 * The seeded table's `qr_code` is a bare `TABLE-…` string, not a signed URL,
 * so it cannot be scanned; a table made through the API carries the real one.
 */
export async function createTable(
  cleanup: Cleanup,
  options: { seatCount?: number } = {},
): Promise<TableFixture> {
  const owner = await getOwner();
  const number = `E2E-${suffix().slice(0, 6)}`;
  const table = await apiData<{ id: number; number: string; qrCode: string }>(
    "create table",
    "/api/v1/tables",
    {
      token: owner.token,
      method: "POST",
      body: {
        restaurantId: owner.restaurantId,
        number,
        capacity: 4,
        ...(options.seatCount
          ? { qrMode: "seat", seatCount: options.seatCount }
          : {}),
      },
    },
  );
  cleanup.add(`delete table ${table.id}`, () =>
    apiRequest(`/api/v1/tables/${table.id}`, {
      token: owner.token,
      method: "DELETE",
    }),
  );
  expect(table.qrCode, "table QR is a signed URL").toMatch(/[?&]sig=/);

  let seats: TableFixture["seats"] = [];
  if (options.seatCount) {
    seats = await apiData<TableFixture["seats"]>(
      "list seats",
      `/api/v1/seats?tableId=${table.id}`,
      { token: owner.token },
    );
    expect(seats.length).toBe(options.seatCount);
  }
  return { id: table.id, number: table.number, qrCode: table.qrCode, seats };
}

export interface MenuFixture {
  categoryId: number;
  secondCategoryId: number;
  plainItem: { id: number; name: string; price: number };
  /** A second plain dish, for flows where two diners must order different things. */
  sideItem: { id: number; name: string; price: number };
  customItem: { id: number; name: string; price: number };
  spice: {
    groupName: string;
    mild: { publicId: string; name: string };
    hot: { publicId: string; name: string; priceAdjustment: number };
  };
  addOn: { publicId: string; name: string; price: number };
}

/**
 * Two categories, a plain dish and a dish with two shared option groups:
 * a required single choice with a priced option, and an optional priced add-on.
 */
export async function createMenuFixture(
  cleanup: Cleanup,
): Promise<MenuFixture> {
  const owner = await getOwner();
  const rid = owner.restaurantId;
  const s = suffix();
  const auth = { token: owner.token };

  const category = await apiData<{ id: number }>(
    "create category",
    `/api/v1/menu/${rid}/categories`,
    { ...auth, method: "POST", body: { name: `E2E 麵類 ${s}`, sortOrder: 50 } },
  );
  cleanup.add(`delete category ${category.id}`, () =>
    apiRequest(`/api/v1/menu/categories/${category.id}`, {
      ...auth,
      method: "DELETE",
    }),
  );
  const secondCategory = await apiData<{ id: number }>(
    "create second category",
    `/api/v1/menu/${rid}/categories`,
    { ...auth, method: "POST", body: { name: `E2E 飲品 ${s}`, sortOrder: 51 } },
  );
  cleanup.add(`delete category ${secondCategory.id}`, () =>
    apiRequest(`/api/v1/menu/categories/${secondCategory.id}`, {
      ...auth,
      method: "DELETE",
    }),
  );

  const createItem = async (
    categoryId: number,
    name: string,
    price: number,
  ) => {
    const item = await apiData<{ id: number; name: string; price: number }>(
      `create item ${name}`,
      `/api/v1/menu/${rid}/items`,
      { ...auth, method: "POST", body: { categoryId, name, price } },
    );
    cleanup.add(`delete item ${item.id}`, () =>
      apiRequest(`/api/v1/menu/items/${item.id}`, {
        ...auth,
        method: "DELETE",
      }),
    );
    return item;
  };

  const customItem = await createItem(category.id, `E2E 客製拉麵 ${s}`, 150);
  const plainItem = await createItem(secondCategory.id, `E2E 冬瓜茶 ${s}`, 40);
  const sideItem = await createItem(category.id, `E2E 滷蛋 ${s}`, 20);

  const createGroup = async (body: Record<string, unknown>) => {
    const group = await apiData<{ id: string }>(
      "create option group",
      `/api/v1/menu/${rid}/option-groups`,
      { ...auth, method: "POST", body },
    );
    cleanup.add(`delete option group ${group.id}`, () =>
      apiRequest(`/api/v1/menu/option-groups/${group.id}`, {
        ...auth,
        method: "DELETE",
      }),
    );
    return group;
  };
  const createChoice = (groupId: string, body: Record<string, unknown>) =>
    apiData(
      "create option choice",
      `/api/v1/menu/option-groups/${groupId}/choices`,
      { ...auth, method: "POST", body },
    );

  const spiceGroupName = `辣度 ${s}`;
  const spiceGroup = await createGroup({
    name: spiceGroupName,
    publicId: `e2e-spice-${s}`,
    kind: "choice",
    type: "single",
    required: true,
  });
  const mild = { publicId: `e2e-mild-${s}`, name: "不辣" };
  const hot = { publicId: `e2e-hot-${s}`, name: "大辣", priceAdjustment: 10 };
  await createChoice(spiceGroup.id, {
    name: mild.name,
    publicId: mild.publicId,
    priceAdjustment: 0,
    sortOrder: 0,
  });
  await createChoice(spiceGroup.id, {
    name: hot.name,
    publicId: hot.publicId,
    priceAdjustment: hot.priceAdjustment,
    sortOrder: 1,
  });

  const toppingGroup = await createGroup({
    name: `加料 ${s}`,
    publicId: `e2e-topping-${s}`,
    kind: "addon",
    type: "multiple",
  });
  const addOn = { publicId: `e2e-egg-${s}`, name: "加蛋", price: 15 };
  await createChoice(toppingGroup.id, {
    name: addOn.name,
    publicId: addOn.publicId,
    priceAdjustment: addOn.price,
  });

  await apiData(
    "attach option groups",
    `/api/v1/menu/items/${customItem.id}/option-groups`,
    {
      ...auth,
      method: "PUT",
      body: {
        groups: [
          { groupId: spiceGroup.id, sortOrder: 0 },
          { groupId: toppingGroup.id, sortOrder: 1 },
        ],
      },
    },
  );

  return {
    categoryId: category.id,
    secondCategoryId: secondCategory.id,
    plainItem,
    sideItem,
    customItem,
    spice: { groupName: spiceGroupName, mild, hot },
    addOn,
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface OrderItemRow {
  id: string | number;
  menuItemId: number;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  notes?: string | null;
  customizations?: {
    options?: Array<{ choiceId?: string; choiceName?: string }>;
    addOns?: Array<{ id?: string; name?: string; quantity?: number }>;
  } | null;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus?: string;
  totalAmount: number;
  subtotal?: number;
  discountAmount?: number;
  couponCode?: string | null;
  notes?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerInfo?: { name?: string; phone?: string } | null;
  tableId?: number | null;
  items: OrderItemRow[];
}

/** The order as staff see it, read through the owner's session. */
export async function readOrder(orderId: string): Promise<OrderRow> {
  const owner = await getOwner();
  return apiData<OrderRow>("read order", `/api/v1/orders/${orderId}`, {
    token: owner.token,
  });
}

export async function staffSetStatus(
  orderId: string,
  status: string,
): Promise<void> {
  const owner = await getOwner();
  await apiData(`order → ${status}`, `/api/v1/orders/${orderId}/status`, {
    token: owner.token,
    method: "PUT",
    body: { status },
  });
}

/**
 * Registers a staff cancel for an order a test may leave active.
 *
 * Cancelling releases the guest active-order lock; a lock left behind would
 * 429 the next test that orders from the same device.
 */
export function cancelOnCleanup(
  cleanup: Cleanup,
  orderId: () => string | undefined,
): void {
  cleanup.add("cancel leftover order", async () => {
    const id = orderId();
    if (!id) return;
    const owner = await getOwner();
    const order = await apiRequest<OrderRow>(`/api/v1/orders/${id}`, {
      token: owner.token,
    });
    const status = order.body.data?.status;
    if (status === "pending" || status === "confirmed") {
      await apiRequest(`/api/v1/orders/${id}`, {
        token: owner.token,
        method: "DELETE",
      });
    }
  });
}

export interface GuestOrderFixture {
  order: { id: string; orderNumber: string; totalAmount: number };
  guestToken: string;
}

/** A dine-in guest order placed through the real guest endpoint. */
export async function createGuestTableOrder(options: {
  table: TableFixture;
  items: Array<{ menuItemId: number; quantity: number }>;
  guestName?: string;
}): Promise<GuestOrderFixture> {
  const owner = await getOwner();
  return apiData<GuestOrderFixture>(
    "create guest order",
    "/api/v1/guest-orders",
    {
      method: "POST",
      body: {
        restaurantId: owner.restaurantId,
        orderType: "table",
        tableId: options.table.id,
        guestName: options.guestName ?? e2eName("Guest"),
        items: options.items,
        clientMutationId: randomUUID(),
      },
    },
  );
}

/**
 * Puts a guest order's session into a diner's browser, exactly where the cart
 * leaves it after a real submit: the guest API token, and the signed table QR
 * the tracking page trades for a realtime token.
 */
export async function installGuestOrderSession(
  context: BrowserContext,
  session: {
    guestToken: string;
    restaurantId: string;
    tableId: number;
    qrCode: string;
  },
): Promise<void> {
  await context.addInitScript((s) => {
    // Only on the first document: the app rewrites guest_auth_token itself on
    // a later order, and #383 is precisely about what happens then.
    if (window.sessionStorage.getItem("__e2e_guest_session_installed")) return;
    window.sessionStorage.setItem("__e2e_guest_session_installed", "1");
    window.localStorage.setItem("guest_auth_token", s.guestToken);
    window.localStorage.setItem(
      `makanmakan_table_qr:${s.restaurantId}:${s.tableId}`,
      s.qrCode,
    );
  }, session);
}

export function trackingPath(
  restaurantId: string,
  tableId: number,
  orderId: string,
): string {
  return `/restaurant/${restaurantId}/table/${tableId}/order/${orderId}`;
}

// ---------------------------------------------------------------------------
// Market stalls
// ---------------------------------------------------------------------------

/** Marks the suite's own second stall, so a re-run finds it instead of adding another. */
const MARKET_STALL_TYPE = "e2e_market_stall";

export interface MarketStall {
  restaurantId: string;
  name: string;
  dish: { id: number; name: string; price: number };
}

/**
 * A second shop for market flows, found or created through the real API.
 *
 * Only the platform admin can create a restaurant, and `POST /restaurants`
 * provisions its tenant through the management API's service binding — so the
 * management worker has to be running for the first run against a fresh D1.
 * Restaurants cannot be deleted, which is why this is find-or-create rather
 * than create-and-clean-up: one stall per database, identified by its type.
 */
export async function ensureMarketStall(): Promise<MarketStall> {
  return ensureE2EShop({
    type: MARKET_STALL_TYPE,
    name: "E2E 市集第二攤",
    dish: { name: "E2E 蚵仔煎", price: 70 },
  });
}

/**
 * Every new restaurant needs a country, and the country fixes its currency.
 * Both cities are on their country's list (COUNTRY_PROFILES), so the API
 * derives TW/TWD and MY/MYR from the city alone.
 */
const E2E_SHOP_CITY = {
  TWD: "台中市",
  MYR: "Penang",
} as const;

/**
 * A second shop of the suite's own, found by `type` or created through the
 * real API, with guest takeaway and shop mode on and one dish.
 *
 * `currency` is applied right after creation: the API refuses to change a
 * shop's currency once it has orders, so it must be set before the first.
 */
export async function ensureE2EShop(options: {
  type: string;
  name: string;
  dish: { name: string; price: number };
  currency?: keyof typeof E2E_SHOP_CITY;
}): Promise<MarketStall> {
  const admin = await getAdmin();
  const auth = { token: admin.token };

  const existing = await apiData<Array<{ id: string; name: string }>>(
    `find ${options.type} shop`,
    `/api/v1/restaurants?type=${options.type}&limit=5`,
    auth,
  );
  let shop = existing[0];
  if (!shop) {
    shop = await apiData<{ id: string; name: string }>(
      `create ${options.type} shop (needs the management API worker)`,
      "/api/v1/restaurants",
      {
        ...auth,
        method: "POST",
        body: {
          name: options.name,
          type: options.type,
          category: "snack",
          address: "E2E Night Market Road 2",
          district: "E2E District",
          city: E2E_SHOP_CITY[options.currency ?? "TWD"],
          phone: "0422000002",
        },
      },
    );
  }

  // Idempotent: guest orders on, one fulfilment method on (shop mode refuses
  // to enable without one), shop mode on.
  await apiData("enable guest takeaway", `/api/v1/restaurants/${shop.id}`, {
    ...auth,
    method: "PUT",
    body: {
      settings: {
        allowGuestOrders: true,
        enableTakeaway: true,
        ...(options.currency ? { currency: options.currency } : {}),
      },
    },
  });
  await apiData(
    "enable shop mode",
    `/api/v1/restaurants/${shop.id}/shop-mode`,
    {
      ...auth,
      method: "PUT",
      body: { enabled: true },
    },
  );

  const menu = await apiData<{
    categories: Array<{ id: number }>;
    menuItems: Array<{ id: number; name: string; price: number }>;
  }>("read shop menu", `/api/v1/menu/${shop.id}`);
  let dish = menu.menuItems.find((item) => item.name === options.dish.name);
  if (!dish) {
    const categoryId =
      menu.categories[0]?.id ??
      (
        await apiData<{ id: number }>(
          "create shop category",
          `/api/v1/menu/${shop.id}/categories`,
          { ...auth, method: "POST", body: { name: "E2E 小吃" } },
        )
      ).id;
    dish = await apiData<{ id: number; name: string; price: number }>(
      "create shop dish",
      `/api/v1/menu/${shop.id}/items`,
      {
        ...auth,
        method: "POST",
        body: { categoryId, ...options.dish },
      },
    );
  }

  return {
    restaurantId: shop.id,
    name: shop.name,
    dish: { id: dish.id, name: dish.name, price: dish.price },
  };
}
