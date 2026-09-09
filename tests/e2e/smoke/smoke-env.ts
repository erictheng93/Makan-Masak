import { createHmac } from "node:crypto";

export interface SmokeUser {
  /** TEXT UUID v7 — `users.id` moved off integer autoincrement. */
  id?: string;
  restaurantId?: string | null;
  role?: number;
}

export interface SmokeLoginData {
  token?: string;
  refreshToken?: string;
  user?: SmokeUser;
  csrfToken?: string;
}

interface SmokeLoginBody {
  success: boolean;
  data?: SmokeLoginData;
}

interface SmokeMenuItem {
  id?: number | string;
  isAvailable?: boolean | number;
}

interface SmokeMenuBody {
  success: boolean;
  data?: {
    menuItems?: SmokeMenuItem[];
    items?: SmokeMenuItem[];
    categories?: Array<{ items?: SmokeMenuItem[] }>;
  };
}

interface SmokeRestaurantBody {
  success: boolean;
  data?: {
    settings?: {
      allowGuestOrders?: boolean;
    } | null;
  };
}

interface SmokeRestaurantListBody {
  success: boolean;
  data?: Array<{
    id?: string;
  }>;
}

export interface SmokeFixtureIds {
  restaurantId?: string;
  menuItemId?: number;
  tableId?: number;
}

const localSeedTableIdsByRestaurantId: Record<string, number> = {
  "019469a0-0001-7000-8000-000000000001": 1,
  "019469a0-0002-7000-8000-000000000002": 7,
  "019469a0-0003-7000-8000-000000000003": 13,
};

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || value === "undefined" || value === "null") return undefined;
  return value;
}

export function isLocalSmokeApi(apiUrl: string): boolean {
  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function localAdminUrlFallback(apiUrl: string): string | undefined {
  return isLocalSmokeApi(apiUrl) ? "http://localhost:3001" : undefined;
}

export function localManagementApiUrlFallback(
  apiUrl: string,
): string | undefined {
  return isLocalSmokeApi(apiUrl) ? "http://localhost:8789/api/v1" : undefined;
}

export function localManagementPortalUrlFallback(
  apiUrl: string,
): string | undefined {
  return isLocalSmokeApi(apiUrl) ? "http://localhost:3010" : undefined;
}

export function localOnboardingUrlFallback(apiUrl: string): string | undefined {
  return isLocalSmokeApi(apiUrl) ? "http://localhost:3011" : undefined;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function createLocalManagementToken(params: {
  managementApiUrl?: string;
  jwtSecret?: string;
  now?: number;
}): string | undefined {
  if (!params.managementApiUrl || !isLocalSmokeApi(params.managementApiUrl)) {
    return undefined;
  }

  const jwtSecret = params.jwtSecret || "test-secret";
  const now = params.now ?? Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      id: "workflow-admin",
      email: "workflow-admin@example.test",
      exp: now + 24 * 60 * 60,
    }),
  );
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

export async function smokeLogin(
  apiUrl: string,
  username: string,
  password: string,
): Promise<SmokeLoginData> {
  const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`smoke login failed with status ${response.status}`);
  }

  const body = (await response.json()) as SmokeLoginBody;
  if (!body.success || !body.data?.token || !body.data.user) {
    throw new Error("smoke login response did not include token and user");
  }

  return {
    ...body.data,
    csrfToken: response.headers.get("X-CSRF-Token") ?? undefined,
  };
}

export function firstAvailableMenuItemId(
  menu: SmokeMenuBody,
): number | undefined {
  const items = [
    ...(menu.data?.menuItems ?? []),
    ...(menu.data?.items ?? []),
    ...(menu.data?.categories ?? []).flatMap(
      (category) => category.items ?? [],
    ),
  ];

  const availableItem = items.find(
    (item) => item.isAvailable !== false && item.isAvailable !== 0,
  );
  const id = Number(availableItem?.id);
  return Number.isFinite(id) ? id : undefined;
}

async function discoverMenuItemId(
  apiUrl: string,
  restaurantId: string,
): Promise<number | undefined> {
  const response = await fetch(`${apiUrl}/api/v1/menu/${restaurantId}`);
  if (!response.ok) return undefined;
  return firstAvailableMenuItemId((await response.json()) as SmokeMenuBody);
}

async function discoverPublicRestaurantFixture(
  apiUrl: string,
): Promise<SmokeFixtureIds> {
  const response = await fetch(`${apiUrl}/api/v1/restaurants`);
  if (!response.ok) return {};

  const body = (await response.json()) as SmokeRestaurantListBody;
  const restaurants = body.success ? (body.data ?? []) : [];

  for (const restaurant of restaurants) {
    if (!restaurant.id) continue;
    if (!(await guestOrdersEnabled(apiUrl, restaurant.id))) continue;

    const menuItemId = await discoverMenuItemId(apiUrl, restaurant.id);
    if (menuItemId !== undefined) {
      const tableId = localSeedTableIdsByRestaurantId[restaurant.id];
      if (tableId === undefined) continue;

      return {
        restaurantId: restaurant.id,
        menuItemId,
        tableId,
      };
    }
  }

  return {};
}

async function guestOrdersEnabled(
  apiUrl: string,
  restaurantId: string,
): Promise<boolean> {
  const response = await fetch(`${apiUrl}/api/v1/restaurants/${restaurantId}`);
  if (!response.ok) return false;

  const body = (await response.json()) as SmokeRestaurantBody;
  return body.success && body.data?.settings?.allowGuestOrders === true;
}

export async function resolveLocalSmokeFixtureIds(params: {
  apiUrl: string;
  authUsername?: string;
  authPassword?: string;
  restaurantId?: string;
  menuItemId?: number;
  tableId?: number;
  loginData?: SmokeLoginData;
}): Promise<SmokeFixtureIds> {
  const fixtureIds: SmokeFixtureIds = {
    restaurantId: params.restaurantId,
    menuItemId: params.menuItemId,
  };
  if (params.tableId !== undefined) fixtureIds.tableId = params.tableId;

  if (!isLocalSmokeApi(params.apiUrl)) {
    return fixtureIds;
  }

  if (!fixtureIds.restaurantId) {
    if (!params.authUsername || !params.authPassword) {
      return discoverPublicRestaurantFixture(params.apiUrl);
    }

    let loginData = params.loginData;
    if (!loginData) {
      try {
        loginData = await smokeLogin(
          params.apiUrl,
          params.authUsername,
          params.authPassword,
        );
      } catch {
        return discoverPublicRestaurantFixture(params.apiUrl);
      }
    }

    fixtureIds.restaurantId = loginData.user?.restaurantId ?? undefined;
  }

  if (!fixtureIds.restaurantId) {
    return discoverPublicRestaurantFixture(params.apiUrl);
  }

  if (!fixtureIds.tableId) {
    fixtureIds.tableId =
      localSeedTableIdsByRestaurantId[fixtureIds.restaurantId];
  }

  if (
    fixtureIds.restaurantId &&
    !(await guestOrdersEnabled(params.apiUrl, fixtureIds.restaurantId))
  ) {
    return {
      restaurantId: undefined,
      menuItemId: undefined,
    };
  }

  if (fixtureIds.restaurantId && fixtureIds.menuItemId === undefined) {
    fixtureIds.menuItemId = await discoverMenuItemId(
      params.apiUrl,
      fixtureIds.restaurantId,
    );
  }

  return fixtureIds;
}
