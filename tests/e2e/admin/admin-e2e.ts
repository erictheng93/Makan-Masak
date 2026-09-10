/**
 * Shared harness for the real-backend admin dashboard E2E suite.
 *
 * "Real" here means what it says: every request the browser makes is served by
 * a real `wrangler dev` Worker against a real local D1. Nothing in
 * `tests/e2e/admin/` may call `page.route()`. The mocked counterparts live in
 * `tests/e2e/smoke/owner-*.spec.ts` and test a different thing (usage state and
 * graceful degradation); this suite tests that the flow actually works.
 *
 * Two decisions in here are deliberate departures from the older
 * `tests/e2e/integration/real-workflows.spec.ts`, both because that file's
 * approach produced silent false greens:
 *
 * 1. **Gating is by reachability, not by env-var presence.** real-workflows
 *    skips when `WORKFLOW_ADMIN_URL` is unset, and that variable has no
 *    localhost fallback — so with the whole stack up and healthy, a plain
 *    `pnpm test:e2e` still reported `1 skipped` / exit 0. Here we default to
 *    localhost and probe both services; if they answer, the tests run. There is
 *    no configuration under which a developer with a working stack silently
 *    tests nothing.
 *
 * 2. **The session is written to sessionStorage as well as localStorage.**
 *    `apps/admin-dashboard/src/services/api.ts` picks the token store from
 *    `import.meta.env.DEV` (sessionStorage in dev, an in-process Map in
 *    preview), so a localStorage-only install bounces to the login screen under
 *    `pnpm dev:admin`. That is exactly what real-workflows.spec.ts does today,
 *    which is why its four admin tests fail the moment they stop skipping.
 */
import { expect, test, type Page } from "@playwright/test";
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
  optionalEnv("WORKFLOW_API_URL") ??
  optionalEnv("SMOKE_API_URL") ??
  optionalEnv("E2E_API_URL") ??
  "http://localhost:8787";

export const ADMIN_URL =
  optionalEnv("E2E_ADMIN_URL") ??
  optionalEnv("WORKFLOW_ADMIN_URL") ??
  optionalEnv("SMOKE_ADMIN_URL") ??
  "http://localhost:3001";

/**
 * Turns every skip into a hard failure. Set it in CI: a skipped test reads like
 * a passing one in a summary, and "the stack was not up" must not be reported
 * as "the admin dashboard works".
 */
export const STRICT =
  /^(1|true)$/i.test(optionalEnv("E2E_STRICT") ?? "") ||
  /^(1|true)$/i.test(optionalEnv("WORKFLOW_STRICT") ?? "") ||
  /^(1|true)$/i.test(optionalEnv("SMOKE_STRICT") ?? "");

/**
 * scripts/seed-local.sql seeds owner1/owner123 against restaurant
 * 019469a0-0099-7000-8000-000000000099.
 *
 * The older suite (real-workflows.spec.ts) used to fall back to
 * `grandmaShop`/`password123`, from scripts/seed-mock-data.sql — deleted in
 * b936600f, so that pair 401s. It now falls back to the same owner1/owner123
 * as this file (#357).
 */
export const OWNER_USERNAME =
  optionalEnv("WORKFLOW_AUTH_USERNAME") ??
  optionalEnv("SMOKE_AUTH_USERNAME") ??
  "owner1";

export const OWNER_PASSWORD =
  optionalEnv("WORKFLOW_AUTH_PASSWORD") ??
  optionalEnv("SMOKE_AUTH_PASSWORD") ??
  "owner123";

/**
 * Platform admin (role 0). Seeded by scripts/seed-local.sql alongside the owner.
 *
 * Needed because several flows are split across two roles by design and cannot
 * be walked end to end from one login: raising a support ticket is
 * `requireRole([1])` while resolving it is `requireRole([0])`, and coupon
 * deletion is admin-only. Without this the suite could only ever assert the
 * owner's half plus a 403.
 *
 * The production admin password is NOT `admin123` — it was changed and is
 * unknown — so anything using this is local-only by construction.
 */
export const ADMIN_USERNAME =
  optionalEnv("E2E_ADMIN_USERNAME") ??
  optionalEnv("WORKFLOW_ADMIN_USERNAME") ??
  "admin";

export const ADMIN_PASSWORD =
  optionalEnv("E2E_ADMIN_PASSWORD") ??
  optionalEnv("WORKFLOW_ADMIN_PASSWORD") ??
  "admin123";

const RESTAURANT_ID_OVERRIDE =
  optionalEnv("WORKFLOW_RESTAURANT_ID") ?? optionalEnv("SMOKE_RESTAURANT_ID");

/** Generous, because a cold wrangler-dev isolate answers the first call slowly. */
export const NAV_TIMEOUT = 60_000;
export const API_WAIT_TIMEOUT = 60_000;
export const POLL_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Reachability preflight
// ---------------------------------------------------------------------------

export interface StackStatus {
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
    // A Vite dev server answers `/` with 200; the Worker answers /info with 200.
    // Anything that completes the round trip proves the port is serving.
    if (response.status >= 500) {
      return `${label} at ${url} returned ${response.status}`;
    }
    return undefined;
  } catch (error) {
    return `${label} at ${url} is unreachable (${(error as Error).message})`;
  }
}

/**
 * Probes the API and the admin dev server once per worker. Memoised, and the
 * memo is not poisoned by a rejection.
 */
export function getStackStatus(): Promise<StackStatus> {
  stackStatusPromise ??= (async () => {
    const reasons = (
      await Promise.all([
        probe(`${API_URL}/info`, "API worker"),
        probe(`${ADMIN_URL}/`, "admin dashboard"),
      ])
    ).filter((reason): reason is string => reason !== undefined);

    if (reasons.length > 0) {
      return {
        ready: false,
        reason: `${reasons.join("; ")}. Start them with \`pnpm dev:api\` and \`pnpm dev:admin\`.`,
      };
    }
    return { ready: true };
  })();

  return stackStatusPromise;
}

/**
 * Skips (or, under STRICT, fails) unless the whole stack answered.
 *
 * Call this first in every test. It performs the only network I/O that is
 * allowed to happen before the gate, so a down stack never surfaces as a
 * confusing mid-test timeout.
 */
export async function requireStack(): Promise<void> {
  const status = await getStackStatus();
  if (status.ready) return;
  if (STRICT) throw new Error(status.reason ?? "admin E2E stack is not ready");
  test.skip(true, status.reason ?? "admin E2E stack is not ready");
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

let loginPromise: Promise<SmokeLoginData> | undefined;

/** Memoised per worker: the API invalidates previous sessions on re-login. */
export function getOwnerLogin(): Promise<SmokeLoginData> {
  loginPromise ??= smokeLogin(API_URL, OWNER_USERNAME, OWNER_PASSWORD);
  loginPromise = loginPromise.catch((error) => {
    loginPromise = undefined;
    throw error;
  });
  return loginPromise;
}

export interface OwnerContext {
  login: SmokeLoginData;
  token: string;
  restaurantId: string;
}

export async function getOwnerContext(): Promise<OwnerContext> {
  const login = await getOwnerLogin();
  const token = login.token;
  const restaurantId =
    RESTAURANT_ID_OVERRIDE ?? login.user?.restaurantId ?? undefined;

  expect(token, "owner login should return a token").toBeTruthy();
  expect(
    restaurantId,
    "owner login should resolve a restaurantId (set WORKFLOW_RESTAURANT_ID to override)",
  ).toBeTruthy();

  return { login, token: token!, restaurantId: restaurantId! };
}

let adminLoginPromise: Promise<SmokeLoginData> | undefined;

/** Memoised per worker, same as the owner login. */
export function getAdminLogin(): Promise<SmokeLoginData> {
  adminLoginPromise ??= smokeLogin(API_URL, ADMIN_USERNAME, ADMIN_PASSWORD);
  adminLoginPromise = adminLoginPromise.catch((error) => {
    adminLoginPromise = undefined;
    throw error;
  });
  return adminLoginPromise;
}

export interface AdminContext {
  login: SmokeLoginData;
  token: string;
}

/**
 * A platform-admin session. Note there is no restaurantId: role 0 is not bound
 * to a shop, so any restaurant-scoped call made with this token has to pass the
 * id explicitly.
 */
export async function getAdminContext(): Promise<AdminContext> {
  const login = await getAdminLogin();
  expect(login.token, "admin login should return a token").toBeTruthy();
  expect(login.user?.role, "admin login should be role 0").toBe(0);
  return { login, token: login.token! };
}

/**
 * Skips (or, under STRICT, fails) unless a platform-admin login is available.
 *
 * Separate from `requireStack` because the admin credentials are a local-seed
 * convenience: pointed at a deployed environment they will not work, and a
 * two-role spec should skip there rather than fail.
 */
export async function requireAdmin(): Promise<void> {
  try {
    await getAdminLogin();
  } catch (error) {
    const reason = `platform admin login unavailable (${(error as Error).message})`;
    if (STRICT) throw new Error(reason);
    test.skip(true, reason);
  }
}

/**
 * Seeds a real session into the browser before the first navigation.
 *
 * Writes `auth_token` to BOTH storages on purpose — see the file header. The
 * duplicate is inert in whichever mode does not read it: the auth client only
 * clears "the other" store when the app itself writes a token, which does not
 * happen on a pre-seeded load.
 */
export async function installAdminSession(
  page: Page,
  login: SmokeLoginData,
): Promise<void> {
  await page.addInitScript((session) => {
    const token = session.token ?? "";
    window.localStorage.setItem("auth_token", token);
    window.sessionStorage.setItem("auth_token", token);
    if (session.refreshToken) {
      window.localStorage.setItem("auth_refresh_token", session.refreshToken);
      window.sessionStorage.setItem("auth_refresh_token", session.refreshToken);
    }
    if (session.user) {
      window.localStorage.setItem("auth_user", JSON.stringify(session.user));
    }
    if (session.csrfToken) {
      window.document.cookie = `csrf_token=${session.csrfToken}; path=/; SameSite=Lax`;
    }
    // Pin i18n so role/label assertions are stable regardless of the machine.
    window.localStorage.setItem("makanmakan_locale", "en-US");
    window.localStorage.setItem("locale", "en-US");
  }, login);
}

// ---------------------------------------------------------------------------
// Node-side API access
// ---------------------------------------------------------------------------

/**
 * apps/api/src/middleware/csrf.ts is a double-submit check: the X-CSRF-Token
 * header must equal the `csrf_token` cookie. The value itself is never checked
 * against server state, so any matching pair passes.
 */
export function csrfHeaders(): Record<string, string> {
  const token = "a".repeat(64);
  const api = new URL(API_URL);
  return {
    "X-CSRF-Token": token,
    cookie: `csrf_token=${token}`,
    origin: api.origin,
    host: api.host,
  };
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  pagination?: { total?: number };
}

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: ApiEnvelope<T>;
}

/** Authenticated node-side request. Never throws on a non-2xx; callers assert. */
export async function apiRequest<T = unknown>(
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
  } = {},
): Promise<ApiResult<T>> {
  const { token, method = "GET", body } = options;
  const headers: Record<string, string> = { ...csrfHeaders() };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const parsed = (await response
    .json()
    .catch(() => ({ success: false }))) as ApiEnvelope<T>;
  return { status: response.status, ok: response.ok, body: parsed };
}

/**
 * Best-effort cleanup: never lets a teardown failure mask the real assertion.
 *
 * Note what "delete" means here. `DELETE /menu/items/:id`,
 * `/menu/categories/:id` and `/menu/option-groups/:id` are **soft** deletes —
 * they stamp `deleted_at_ms` and the row stays in D1. So cleanup does restore
 * the application's visible state (the rows vanish from every list endpoint),
 * but a local database accumulates tombstones across runs. That is why every
 * fixture is named through `e2eName()`: a stray row is identifiable as ours.
 * If you ever need a genuinely empty table, `pnpm db:reset:local` is the tool,
 * not this helper.
 */
export async function apiCleanup(
  path: string,
  token: string,
  options: { method?: string; body?: unknown } = {},
): Promise<void> {
  await apiRequest(path, {
    token,
    method: options.method ?? "DELETE",
    body: options.body,
  }).catch(() => {
    /* best-effort cleanup */
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Navigates to an admin route and waits for a real API response to land.
 *
 * `networkidle` is deliberately not used: against a real Worker (1-4s per call,
 * plus polling views that never go idle) it is a flake generator. The response
 * predicate is the readiness signal instead.
 */
export async function gotoAdmin(
  page: Page,
  path: string,
  options: {
    /** Substring the settling API response URL must contain. */
    expectApi?: string;
    /** Set false for routes that issue no API call on mount. */
    waitForApi?: boolean;
  } = {},
): Promise<void> {
  const { expectApi = "/api/v1/", waitForApi = true } = options;

  const navigation = page.goto(`${ADMIN_URL}${path}`, {
    timeout: NAV_TIMEOUT,
    waitUntil: "domcontentloaded",
  });

  if (!waitForApi) {
    await navigation;
    return;
  }

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(expectApi) && response.status() < 500,
      { timeout: API_WAIT_TIMEOUT },
    ),
    navigation,
  ]);
}

/**
 * Asserts the app did not bounce us to the login screen.
 *
 * Worth its own helper: an expired or wrongly-stored token renders a perfectly
 * valid page that simply is not the one under test, and the resulting failure
 * ("waitForResponse timed out") points nowhere near the cause. That is exactly
 * how the sessionStorage regression in real-workflows.spec.ts stayed hidden.
 */
export async function assertAuthenticated(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /Admin Dashboard Login|後台登入/ }),
    "session was rejected — the app bounced to the login screen",
  ).toHaveCount(0);
}

/** Catches a runtime Vue/Vite error that still rendered a plausible page. */
export async function assertNoOverlayError(page: Page): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Unique-per-run suffix so parallel or repeated runs never collide on names. */
export function suffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

export const E2E_PREFIX = "E2E";

/** Names every artifact this suite creates, so strays are identifiable in D1. */
export function e2eName(label: string): string {
  return `${E2E_PREFIX} ${label} ${suffix()}`;
}
