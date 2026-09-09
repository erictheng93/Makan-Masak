/**
 * Deployed admin realtime WebSocket smoke.
 *
 * This is intentionally not a mocked E2E: it logs in through the deployed API,
 * lets the deployed admin dashboard create its own WebSocket, then verifies
 * public realtime helper routes cannot be used as event injectors.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  isLocalSmokeApi,
  localAdminUrlFallback,
  optionalEnv,
  resolveLocalSmokeFixtureIds,
} from "./smoke-env";
import { getSmokeOwnerSession } from "./owner-auth";

const API_URL = process.env.SMOKE_API_URL || "http://localhost:8787";

const ADMIN_URL =
  optionalEnv("SMOKE_ADMIN_URL") ?? localAdminUrlFallback(API_URL);
const AUTH_USERNAME = optionalEnv("SMOKE_AUTH_USERNAME");
const AUTH_PASSWORD = optionalEnv("SMOKE_AUTH_PASSWORD");
const RESTAURANT_ID = optionalEnv("SMOKE_RESTAURANT_ID");
const REALTIME_URL = optionalEnv("SMOKE_REALTIME_URL");

interface LoginBody {
  success: boolean;
  data?: {
    token?: string;
    refreshToken?: string;
    user?: {
      // TEXT UUID v7, matching users.id.
      id: string;
      username: string;
      fullName?: string;
      email?: string;
      role: number;
      restaurantId?: string | null;
    };
  };
}

interface RealtimeTokenBody {
  success: boolean;
  data?: {
    token?: string;
    expiresIn?: number;
    wsUrl?: string;
  };
}

async function directLogin() {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: AUTH_USERNAME,
      password: AUTH_PASSWORD,
    }),
  });

  expect(response.ok, `login status ${response.status}`).toBe(true);
  const body = (await response.json()) as LoginBody;
  expect(body.success).toBe(true);
  expect(typeof body.data?.token, "login token").toBe("string");
  expect(body.data?.user, "login user").toBeTruthy();

  return {
    token: body.data!.token!,
    refreshToken: body.data?.refreshToken,
    user: body.data!.user!,
  };
}

async function login() {
  try {
    const ownerSession = await getSmokeOwnerSession();
    return {
      token: ownerSession.token,
      refreshToken: ownerSession.refreshToken,
      user: ownerSession.user,
    };
  } catch {
    return directLogin();
  }
}

async function requestAdminRealtimeToken(token: string, restaurantId: string) {
  const response = await fetch(`${API_URL}/api/v1/realtime/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      roomType: "admin",
      roomId: restaurantId,
      restaurantId,
      sessionId: token,
    }),
  });

  expect(response.ok, `realtime token status ${response.status}`).toBe(true);
  const body = (await response.json()) as RealtimeTokenBody;
  expect(body.success).toBe(true);
  expect(typeof body.data?.token, "realtime token").toBe("string");
  expect(typeof body.data?.wsUrl, "realtime wsUrl").toBe("string");

  return body.data!.wsUrl!;
}

function realtimeHttpBaseFrom(wsUrl: string): string {
  if (REALTIME_URL) return REALTIME_URL.replace(/\/$/, "");

  const parsed = new URL(wsUrl);
  const protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  return `${protocol}//${parsed.host}`;
}

function isLocalRealtimeBase(realtimeHttpBase: string): boolean {
  return isLocalSmokeApi(realtimeHttpBase);
}

async function isRealtimeHttpAvailable(realtimeHttpBase: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  try {
    const response = await fetch(`${realtimeHttpBase}/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function installWebSocketProbe(page: Page) {
  await page.addInitScript(() => {
    type Probe = {
      urls: string[];
      openUrls: string[];
      messages: Array<{ url: string; data: string }>;
      closes: Array<{ url: string; code: number; reason: string }>;
      errors: string[];
    };

    const win = window as typeof window & {
      __adminRealtimeProbe?: Probe;
    };
    const OriginalWebSocket = window.WebSocket;
    const probe: Probe = {
      urls: [],
      openUrls: [],
      messages: [],
      closes: [],
      errors: [],
    };

    win.__adminRealtimeProbe = probe;

    class TrackedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const urlString = String(url);
        if (protocols === undefined) {
          super(url);
        } else {
          super(url, protocols);
        }

        probe.urls.push(urlString);
        this.addEventListener("open", () => {
          probe.openUrls.push(urlString);
        });
        this.addEventListener("message", (event) => {
          probe.messages.push({
            url: urlString,
            data:
              typeof event.data === "string" ? event.data : "[binary-message]",
          });
        });
        this.addEventListener("close", (event) => {
          probe.closes.push({
            url: urlString,
            code: event.code,
            reason: event.reason,
          });
        });
        this.addEventListener("error", () => {
          probe.errors.push(urlString);
        });
      }
    }

    window.WebSocket = TrackedWebSocket;
  });
}

test.describe("Smoke: admin realtime WebSocket", () => {
  test("admin dashboard connects and public realtime helpers stay closed", async ({
    page,
  }) => {
    test.skip(
      !ADMIN_URL || !AUTH_USERNAME || !AUTH_PASSWORD,
      "SMOKE_ADMIN_URL / auth credentials not set",
    );

    const adminUrl = ADMIN_URL!;
    const { token, refreshToken, user } = await login();
    const fixtureIds = await resolveLocalSmokeFixtureIds({
      apiUrl: API_URL,
      authUsername: AUTH_USERNAME,
      authPassword: AUTH_PASSWORD,
      restaurantId: RESTAURANT_ID,
      loginData: { token, refreshToken, user },
    });
    test.skip(
      !fixtureIds.restaurantId,
      "SMOKE_RESTAURANT_ID not set and local login did not provide one",
    );

    const restaurantId = fixtureIds.restaurantId!;
    const wsUrl = await requestAdminRealtimeToken(token, restaurantId);
    const realtimeHttpBase = realtimeHttpBaseFrom(wsUrl);
    test.skip(
      isLocalRealtimeBase(realtimeHttpBase) &&
        !(await isRealtimeHttpAvailable(realtimeHttpBase)),
      `local realtime worker is not available at ${realtimeHttpBase}`,
    );

    await installWebSocketProbe(page);
    await page.addInitScript(
      ({ token, refreshToken, user, restaurantId }) => {
        localStorage.setItem("auth_token", token);
        if (refreshToken) {
          localStorage.setItem("auth_refresh_token", refreshToken);
        }
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            ...user,
            restaurantId: user.restaurantId ?? restaurantId,
          }),
        );
        sessionStorage.setItem("admin_selected_restaurant_id", restaurantId);
        sessionStorage.setItem(
          "admin_selected_restaurant_name",
          "Deployed Smoke Restaurant",
        );
      },
      { token, refreshToken, user, restaurantId },
    );

    await page.goto(`${adminUrl.replace(/\/$/, "")}/dashboard`);

    await page.waitForFunction(
      ({ restaurantId }) => {
        const probe = (
          window as typeof window & {
            __adminRealtimeProbe?: {
              openUrls: string[];
              messages: Array<{ data: string }>;
            };
          }
        ).__adminRealtimeProbe;

        if (!probe) return false;
        const adminSocketOpen = probe.openUrls.some((url) =>
          url.includes(`/admin/${restaurantId}`),
        );
        const acknowledged = probe.messages.some(({ data }) => {
          try {
            return JSON.parse(data).type === "connection_ack";
          } catch {
            return false;
          }
        });

        return adminSocketOpen && acknowledged;
      },
      { restaurantId },
      { timeout: 30_000 },
    );

    const eventId = `blocked_admin_ws_${Date.now()}`;
    const broadcastResponse = await fetch(
      `${realtimeHttpBase}/broadcast/admin/${restaurantId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "system_notification",
          eventId,
          timestamp: Date.now(),
          restaurantId,
          data: {
            notificationId: eventId,
            level: "info",
            title: "blocked public realtime broadcast",
            message: "admin realtime smoke",
          },
        }),
      },
    );
    const statsResponse = await fetch(
      `${realtimeHttpBase}/stats/admin/${restaurantId}`,
    );

    expect(broadcastResponse.status, "public broadcast status").toBe(404);
    expect(statsResponse.status, "public stats status").toBe(404);
  });
});
