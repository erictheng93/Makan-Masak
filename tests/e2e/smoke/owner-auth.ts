import { expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const API_URL = process.env.SMOKE_API_URL || "http://localhost:8787";
const AUTH_USERNAME = process.env.SMOKE_AUTH_USERNAME?.trim();
const AUTH_PASSWORD = process.env.SMOKE_AUTH_PASSWORD?.trim();
const OWNER_ROLE = 1;
const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 30_000;

export const hasSmokeOwnerCredentials = !!AUTH_USERNAME && !!AUTH_PASSWORD;

export interface SmokeOwnerUser {
  /**
   * TEXT UUID v7. This was declared `number` and never caught, because nothing
   * assigned the value anywhere the compiler could compare it against the
   * shared `SmokeUser` shape.
   */
  id: string;
  username: string;
  role: number;
  restaurantId?: string | null;
  fullName?: string;
  email?: string;
  phone?: string | null;
}

interface LoginBody {
  success: boolean;
  data?: {
    token?: string;
    refreshToken?: string;
    user?: SmokeOwnerUser;
  };
  error?:
    | string
    | {
        message?: string;
      };
}

interface MeBody {
  success: boolean;
  data?: SmokeOwnerUser;
}

export interface SmokeOwnerSession {
  token: string;
  refreshToken: string | undefined;
  user: SmokeOwnerUser;
}

const stateKey = createHash("sha256")
  .update(`${API_URL}:${AUTH_USERNAME ?? ""}`)
  .digest("hex")
  .slice(0, 16);
const stateDir = path.join(process.cwd(), "test-results", ".smoke-auth");
const statePath = path.join(stateDir, `owner-${stateKey}.json`);
const lockPath = path.join(stateDir, `owner-${stateKey}.lock`);

let ownerSessionPromise: Promise<SmokeOwnerSession> | undefined;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withStateLock<T>(callback: () => Promise<T>): Promise<T> {
  await fs.mkdir(stateDir, { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        await fs.rm(lockPath, { force: true, recursive: true });
        continue;
      }
      await sleep(LOCK_RETRY_MS);
    }
  }

  try {
    return await callback();
  } finally {
    await fs.rm(lockPath, { force: true, recursive: true });
  }
}

async function readCachedSession() {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as SmokeOwnerSession;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function isSessionValid(session: SmokeOwnerSession) {
  const response = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) return false;

  const body = (await response.json()) as MeBody;
  return body.success && body.data?.role === OWNER_ROLE;
}

async function loginOwnerSession() {
  const maxAttempts = 2;
  let response: Response | undefined;
  let body: LoginBody | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: AUTH_USERNAME,
        password: AUTH_PASSWORD,
      }),
    });
    body = (await response.json().catch(() => ({}))) as LoginBody;

    const message =
      typeof body.error === "string" ? body.error : body.error?.message;
    const retryableInvalidation =
      response.status === 401 &&
      /invalidate previous sessions/i.test(message ?? "");

    if (response.ok || !retryableInvalidation || attempt === maxAttempts) {
      break;
    }

    await sleep(LOCK_RETRY_MS * attempt);
  }

  expect(response?.ok, `owner login status ${response?.status}`).toBe(true);
  expect(body, "login response body").toBeTruthy();
  expect(body!.success, "login should succeed").toBe(true);
  expect(body!.data?.user?.role, "user role should be owner").toBe(OWNER_ROLE);

  const session: SmokeOwnerSession = {
    token: body!.data!.token!,
    refreshToken: body!.data?.refreshToken,
    user: body!.data!.user!,
  };

  await fs.writeFile(statePath, JSON.stringify(session), "utf8");
  return session;
}

export function getSmokeOwnerSession(): Promise<SmokeOwnerSession> {
  ownerSessionPromise ??= withStateLock(async () => {
    const cached = await readCachedSession();
    if (cached && (await isSessionValid(cached))) {
      return cached;
    }

    return loginOwnerSession();
  });

  ownerSessionPromise = ownerSessionPromise.catch((error) => {
    ownerSessionPromise = undefined;
    throw error;
  });

  return ownerSessionPromise;
}

export async function setSmokeOwnerSession(
  page: Page,
  session: SmokeOwnerSession,
  options: {
    selectedRestaurantName?: string;
  } = {},
) {
  await page.route("**/api/v1/auth/me", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: session.user,
      }),
    });
  });

  return page.addInitScript(
    ({ session: payload, selectedRestaurantName }) => {
      localStorage.setItem("auth_token", payload.token);
      if (payload.refreshToken) {
        localStorage.setItem("auth_refresh_token", payload.refreshToken);
      }
      localStorage.setItem("auth_user", JSON.stringify(payload.user));
      localStorage.setItem("makanmakan_locale", "en-US");
      localStorage.setItem("locale", "en-US");
      sessionStorage.clear();

      if (selectedRestaurantName) {
        sessionStorage.setItem(
          "admin_selected_restaurant_id",
          payload.user.restaurantId ?? "",
        );
        sessionStorage.setItem(
          "admin_selected_restaurant_name",
          selectedRestaurantName,
        );
      }
    },
    { session, selectedRestaurantName: options.selectedRestaurantName },
  );
}
