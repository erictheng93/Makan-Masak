import { sign } from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  groupMembers,
  orders,
  restaurants,
  seats,
  tables,
} from "@makanmasak/database";

const mocks = vi.hoisted(() => {
  const dbState: {
    selectFixtures: Map<unknown, unknown[][]>;
    selectError: Error | null;
  } = {
    selectFixtures: new Map(),
    selectError: null,
  };
  const createQuery = () => {
    let selectedTable: unknown;
    const query = {
      from: vi.fn((table: unknown) => {
        selectedTable = table;
        return query;
      }),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn((resolve, reject) => {
        if (dbState.selectError) {
          return Promise.reject(dbState.selectError).then(resolve, reject);
        }
        const queue = dbState.selectFixtures.get(selectedTable);
        if (!queue) {
          return Promise.reject(
            new Error(`Missing select fixture for ${tableName(selectedTable)}`),
          ).then(resolve, reject);
        }
        const result = queue.shift();
        if (result === undefined) {
          return Promise.reject(
            new Error(
              `No select fixtures remaining for ${tableName(selectedTable)}`,
            ),
          ).then(resolve, reject);
        }
        return Promise.resolve(result).then(resolve, reject);
      }),
    };
    return query;
  };
  const db = {
    select: vi.fn(() => createQuery()),
  };
  const blacklist = {
    isTokenRevoked: vi.fn(),
    revokeToken: vi.fn(),
    revokeUserTokens: vi.fn(),
    getStats: vi.fn(),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const utils = {
    parseSignedQRUrl: vi.fn(),
    verifyQRSignature: vi.fn(),
  };

  return { blacklist, db, dbState, logger, utils };
});

/**
 * Select fixtures are keyed by table, not by call order: `from(table)` decides
 * which queue a query draws from, so adding a query against one table can no
 * longer shift another table's results out from under it.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a fixture
 *   at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared. An
 *   unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing falls
 * back to `[]`; a silent empty result is what made the previous positional
 * queues so hard to trace back to their cause.
 */
type SelectFixtureName =
  | "groupMembers"
  | "orders"
  | "restaurants"
  | "seats"
  | "tables";
const fixtureTables: Record<SelectFixtureName, unknown> = {
  groupMembers,
  orders,
  restaurants,
  seats,
  tables,
};
const fixtureTableNames = new Map<unknown, SelectFixtureName>(
  Object.entries(fixtureTables).map(([name, table]) => [
    table,
    name as SelectFixtureName,
  ]),
);
function tableName(table: unknown) {
  return fixtureTableNames.get(table) ?? "<unknown table>";
}
function setSelectFixtures(
  fixtures: Partial<Record<SelectFixtureName, unknown[][]>>,
) {
  mocks.dbState.selectFixtures = new Map(
    Object.entries(fixtures).map(([name, results]) => [
      fixtureTables[name as SelectFixtureName],
      [...(results ?? [])],
    ]),
  );
}

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => mocks.db),
}));

vi.mock("../../../core/monitoring", () => ({
  ConsoleLogger: vi.fn(function ConsoleLogger() {
    return mocks.logger;
  }),
}));

vi.mock("./TokenBlacklistService", () => ({
  TokenBlacklistService: vi.fn(function TokenBlacklistService() {
    return mocks.blacklist;
  }),
}));

vi.mock("@makanmasak/utils", async () => {
  const actual =
    await vi.importActual<typeof import("@makanmasak/utils")>(
      "@makanmasak/utils",
    );
  return {
    ...actual,
    parseSignedQRUrl: mocks.utils.parseSignedQRUrl,
    verifyQRSignature: mocks.utils.verifyQRSignature,
  };
});

import { RealtimeAuthService } from "./RealtimeAuthService";
import type {
  RealtimeAuthPayload,
  RealtimeAuthTokenRequest,
} from "@makanmasak/shared-types";
import type { Env } from "../../../types/env";

const realtimeSecret = "realtime-secret-with-at-least-32-chars";
const jwtSecret = "session-secret-with-at-least-32-chars";
const qrSigningKey = "qr-signing-key-with-at-least-32-chars";
const userId = "018f0000-0000-7000-8000-000000000007";
const ownerId = "018f0000-0000-7000-8000-000000000001";

function activeGuestRestaurant() {
  return {
    id: "restaurant-1",
    settings: { allowGuestOrders: true },
    isActive: true,
    isAvailable: true,
  };
}

function activeGuestTable() {
  return {
    id: 10,
    restaurantId: "restaurant-1",
    number: "T1",
    qrCodeVersion: 1,
    isActive: true,
    deletedAt: null,
  };
}

function createKV(values: Record<string, unknown> = {}) {
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = values[key];
      if (value === undefined) return null;
      if (type === "json") return value;
      return typeof value === "string" ? value : JSON.stringify(value);
    }),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as KVNamespace;
}

function untypedRoomType(value: string): RealtimeAuthTokenRequest["roomType"] {
  return value as RealtimeAuthTokenRequest["roomType"];
}

function createService(env: Record<string, unknown> = {}) {
  return new RealtimeAuthService({
    DB: {} as D1Database,
    CACHE_KV: createKV(),
    JWT_SECRET: jwtSecret,
    REALTIME_JWT_SECRET: realtimeSecret,
    QR_SIGNING_KEY: qrSigningKey,
    REALTIME_WS_URL: "wss://realtime.example.test",
    NODE_ENV: "test",
    ...env,
  } as unknown as Env);
}

function createSessionToken(
  payload: Record<string, unknown>,
  options: { expiresIn?: string | number; notBefore?: string | number } = {
    expiresIn: "1h",
  },
) {
  const signOptions = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  );

  return sign(
    {
      sub: userId,
      username: "chef",
      role: 2,
      restaurantId: "restaurant-1",
      tv: 1,
      ...payload,
    },
    jwtSecret,
    signOptions,
  );
}

function createPreparedDb(
  row: unknown,
  options: { throwOnFirst?: boolean } = {},
) {
  const first = options.throwOnFirst
    ? vi.fn(async () => {
        throw new Error("database unavailable");
      })
    : vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, bind, first };
}

describe("RealtimeAuthService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbState.selectFixtures = new Map();
    mocks.dbState.selectError = null;
    mocks.utils.parseSignedQRUrl.mockReturnValue(null);
    mocks.utils.verifyQRSignature.mockResolvedValue(false);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    mocks.blacklist.isTokenRevoked.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes select fixtures by table and reports missing fixtures", async () => {
    setSelectFixtures({
      restaurants: [[{ id: "restaurant-1" }]],
      tables: [[{ id: 10 }]],
    });

    // Read in the reverse of the declaration order: routing follows the table
    // passed to from(), never the order the queries happen to run in.
    await expect(mocks.db.select().from(tables)).resolves.toEqual([{ id: 10 }]);
    await expect(mocks.db.select().from(restaurants)).resolves.toEqual([
      { id: "restaurant-1" },
    ]);
    await expect(mocks.db.select().from(tables)).rejects.toThrow(
      "No select fixtures remaining for tables",
    );
    await expect(mocks.db.select().from(seats)).rejects.toThrow(
      "Missing select fixture for seats",
    );
  });

  it("requires a strong realtime JWT secret", () => {
    expect(
      () =>
        new RealtimeAuthService({
          DB: {} as D1Database,
          CACHE_KV: createKV(),
          REALTIME_JWT_SECRET: "short",
          JWT_SECRET: jwtSecret,
        } as unknown as Env),
    ).toThrow("REALTIME_JWT_SECRET must be set and at least 32 characters");
  });

  it("falls back to JWT_SECRET for local realtime token signing", async () => {
    const service = createService({
      REALTIME_JWT_SECRET: undefined,
      DB: {},
    });
    const sessionId = createSessionToken({ role: 2 });

    const response = await service.generateWebSocketToken({
      roomType: "kitchen",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId,
    });

    expect(response).toMatchObject({
      expiresIn: 300,
      wsUrl: expect.stringMatching(
        /^wss:\/\/realtime\.example\.test\/kitchen\/restaurant-1\?token=/,
      ),
    });
    await expect(
      service.verifyWebSocketToken("token" in response ? response.token : ""),
    ).resolves.toMatchObject({ valid: true });
  });

  it("refuses to mint customer room tokens from the public endpoint", async () => {
    const service = createService();
    const expected = {
      error:
        "Customer realtime tokens must be requested from /realtime/auth/guest-token",
    };

    // No tableId at all — the original vulnerability: an anonymous caller could
    // name any roomId and receive a signed customer token.
    await expect(
      service.generateWebSocketToken({
        roomType: "customer",
        roomId: "group-order-42",
        restaurantId: "restaurant-1",
      }),
    ).resolves.toEqual(expected);

    // A table/seat ID must not buy access either — it is not a secret, and it
    // never constrained which room the token was good for.
    await expect(
      service.generateWebSocketToken({
        roomType: "customer",
        roomId: "group-order-42",
        restaurantId: "restaurant-1",
        tableId: "7",
        seatId: "3",
      }),
    ).resolves.toEqual(expected);

    // Rejected before any DB work, and no token is signed.
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("rejects invalid staff room requests before issuing tokens", async () => {
    const service = createService();

    await expect(
      service.generateWebSocketToken({
        roomType: "kitchen",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
      }),
    ).resolves.toEqual({ error: "Session ID required for this room type" });
    await expect(
      service.generateWebSocketToken({
        roomType: "admin",
        roomId: "other-restaurant",
        restaurantId: "restaurant-1",
        sessionId: "session",
      }),
    ).resolves.toEqual({ error: "Room ID must match restaurant ID" });
  });

  it("rejects invalid room types", async () => {
    const service = createService();

    await expect(
      service.generateWebSocketToken({
        // The route reads roomType off the request body, so a value outside
        // the union really can reach this guard.
        roomType: untypedRoomType("unknown"),
        roomId: "room-1",
        restaurantId: "restaurant-1",
      }),
    ).resolves.toEqual({ error: "Invalid room type" });
  });

  describe("generateGroupOrderToken", () => {
    const groupOrderId = "018f0000-0000-7000-8000-000000000099";
    const memberToken = "018f0000-0000-7000-8000-0000000000aa";

    function activeMembership(overrides: Record<string, unknown> = {}) {
      return {
        memberId: "member-1",
        memberIsActive: true,
        memberLeftAt: null,
        restaurantId: "restaurant-1",
        status: "active",
        expiresAt: new Date("2026-06-07T06:00:00.000Z"),
        ...overrides,
      };
    }

    it("mints a token pinned to the group order room", async () => {
      setSelectFixtures({ groupMembers: [[activeMembership()]] });
      const service = createService();

      const response = await service.generateGroupOrderToken({
        groupOrderId,
        memberToken,
      });

      expect(response).toMatchObject({
        wsUrl: expect.stringContaining(`/customer/${groupOrderId}?token=`),
      });

      const verification = await service.verifyWebSocketToken(
        "token" in response ? response.token : "",
      );
      expect(verification).toMatchObject({
        valid: true,
        payload: {
          roomType: "customer",
          // Bare UUID — the room RealtimeBroadcastService targets.
          roomId: groupOrderId,
          restaurantId: "restaurant-1",
          role: "customer",
          guestFlag: true,
          scope: "group-order-realtime",
          groupOrderId,
        },
      });
    });

    it("refuses every membership that is not currently active", async () => {
      const cases: Array<[string, Record<string, unknown> | null]> = [
        ["no matching member/token pair", null],
        ["member deactivated", { memberIsActive: false }],
        ["member left the group", { memberLeftAt: new Date() }],
        ["group no longer active", { status: "completed" }],
        ["group expired", { expiresAt: new Date("2026-06-06T00:00:00.000Z") }],
      ];

      for (const [label, overrides] of cases) {
        setSelectFixtures({
          groupMembers: [
            overrides === null ? [] : [activeMembership(overrides)],
          ],
        });
        const service = createService();

        await expect(
          service.generateGroupOrderToken({ groupOrderId, memberToken }),
          label,
          // A single opaque message: probing must not reveal which check failed.
        ).resolves.toEqual({ error: "Invalid group order membership" });
      }
    });

    it("scopes channel access to its own group order", async () => {
      const service = createService();
      const payload = {
        scope: "group-order-realtime",
        groupOrderId,
      } as RealtimeAuthPayload;

      expect(service.verifyChannelAccess(payload, groupOrderId)).toEqual({
        allowed: true,
      });
      expect(service.verifyChannelAccess(payload, "another-group")).toEqual({
        allowed: false,
        error: "Token is not scoped to this channel",
      });
    });
  });

  it("generates staff tokens from valid session JWTs in token-only test mode", async () => {
    const service = createService({ DB: {} });
    const sessionId = sign(
      {
        sub: userId,
        username: "chef",
        role: 2,
        restaurantId: "restaurant-1",
        tv: 1,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    const response = await service.generateWebSocketToken({
      roomType: "kitchen",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId,
    });

    expect(response).toMatchObject({
      expiresIn: 300,
      wsUrl: expect.stringContaining("/kitchen/restaurant-1?token="),
    });
    await expect(
      service.verifyWebSocketToken("token" in response ? response.token : ""),
    ).resolves.toMatchObject({
      valid: true,
      payload: {
        roomType: "kitchen",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        role: "staff",
        userId,
        appRole: 2,
      },
    });
  });

  it("loads active session users from DB and derives admin staff roles", async () => {
    const prepared = createPreparedDb({
      id: ownerId,
      username: "owner",
      role: 1,
      restaurant_id: "restaurant-1",
      is_active: 1,
      token_version: 2,
    });
    const service = createService({ DB: { prepare: prepared.prepare } });
    const sessionId = createSessionToken({
      sub: ownerId,
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
      tv: 2,
    });

    const response = await service.generateWebSocketToken({
      roomType: "kitchen",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId,
    });

    expect(response).toMatchObject({ expiresIn: 300 });
    await expect(
      service.verifyWebSocketToken("token" in response ? response.token : ""),
    ).resolves.toMatchObject({
      valid: true,
      payload: {
        role: "admin",
        appRole: 1,
        userId: ownerId,
      },
    });
    expect(prepared.prepare).toHaveBeenCalled();
    expect(prepared.bind).toHaveBeenCalledWith(ownerId);
  });

  it("loads UUID-principal session users from DB and emits public user ids", async () => {
    const publicUserId = ownerId;
    const prepared = createPreparedDb({
      id: publicUserId,
      username: "owner",
      role: 1,
      restaurant_id: "restaurant-1",
      is_active: 1,
      token_version: 2,
    });
    const service = createService({ DB: { prepare: prepared.prepare } });
    const sessionId = createSessionToken({
      sub: publicUserId,
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
      tv: 2,
    });

    const response = await service.generateWebSocketToken({
      roomType: "kitchen",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId,
    });

    expect(response).toMatchObject({ expiresIn: 300 });
    await expect(
      service.verifyWebSocketToken("token" in response ? response.token : ""),
    ).resolves.toMatchObject({
      valid: true,
      payload: {
        role: "admin",
        appRole: 1,
        userId: publicUserId,
        publicUserId,
      },
    });
    expect(prepared.prepare).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ?"),
    );
    expect(prepared.bind).toHaveBeenCalledWith(publicUserId);
  });

  it("allows platform admins to access any restaurant room", async () => {
    const prepared = createPreparedDb({
      id: ownerId,
      username: "admin",
      role: 0,
      restaurant_id: null,
      is_active: true,
      token_version: 1,
    });
    const service = createService({ DB: { prepare: prepared.prepare } });
    const sessionId = createSessionToken({
      sub: ownerId,
      username: "admin",
      role: 0,
      restaurantId: "hq",
    });

    const response = await service.generateWebSocketToken({
      roomType: "restaurant",
      roomId: "restaurant-2",
      restaurantId: "restaurant-2",
      sessionId,
    });

    expect(response).toMatchObject({ expiresIn: 300 });
  });

  it("accepts platform admin session tokens without a restaurant", async () => {
    const prepared = createPreparedDb({
      id: ownerId,
      username: "admin",
      role: 0,
      restaurant_id: null,
      is_active: true,
      token_version: 1,
    });
    const service = createService({ DB: { prepare: prepared.prepare } });
    const sessionId = createSessionToken({
      sub: ownerId,
      username: "admin",
      role: 0,
      restaurantId: null,
    });

    const response = await service.generateWebSocketToken({
      roomType: "restaurant",
      roomId: "restaurant-2",
      restaurantId: "restaurant-2",
      sessionId,
    });

    expect(response).toMatchObject({ expiresIn: 300 });
  });

  it("returns precise session validation errors", async () => {
    const service = createService({
      TOKEN_BLACKLIST: createKV({ "token:blacklisted": "1" }),
    });

    await expect(
      service.generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: "blacklisted",
      }),
    ).resolves.toEqual({ error: "Session token has been invalidated" });
    await expect(
      createService({ JWT_SECRET: "short-secret" }).generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: "session",
      }),
    ).resolves.toEqual({ error: "JWT_SECRET is not configured" });
    await expect(
      createService().generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: "not-a-jwt",
      }),
    ).resolves.toEqual({ error: "Invalid session token" });
    await expect(
      createService().generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({ exp: 1 }, { expiresIn: undefined }),
      }),
    ).resolves.toEqual({ error: "Session token expired" });
    await expect(
      createService().generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({}, { notBefore: "1h" }),
      }),
    ).resolves.toEqual({ error: "Session token not yet valid" });
  });

  it("rejects malformed or unauthorized session claims", async () => {
    const service = createService();

    await expect(
      service.generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: sign(
          { sub: "not-a-uuid", username: "chef", role: 2 },
          jwtSecret,
          {
            expiresIn: "1h",
          },
        ),
      }),
    ).resolves.toEqual({ error: "Invalid session token claims" });
    await expect(
      service.generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({ iat: 1780790465 }),
      }),
    ).resolves.toEqual({ error: "Session token issued in future" });
    await expect(
      service.generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({ nbf: 1780790465 }),
      }),
    ).resolves.toEqual({ error: "Session token not yet valid" });
    await expect(
      service.generateWebSocketToken({
        roomType: "admin",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({ role: 5 }),
      }),
    ).resolves.toEqual({
      error: "Session role is not allowed for realtime rooms",
    });
    await expect(
      service.generateWebSocketToken({
        roomType: "restaurant",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({ role: 2 }),
      }),
    ).resolves.toEqual({
      error: "Session role cannot access this realtime room",
    });
  });

  // The admin room used to fall through to "any staff role". It carries data
  // the kitchen room does not — WaitingListService broadcasts customerName to
  // admin:{rid} — so chef/service/cashier must be turned away here, before any
  // token is signed.
  it("refuses admin room tokens for non-owner staff roles", async () => {
    const service = createService();

    for (const role of [2, 3, 4]) {
      await expect(
        service.generateWebSocketToken({
          roomType: "admin",
          roomId: "restaurant-1",
          restaurantId: "restaurant-1",
          sessionId: createSessionToken({ role }),
        }),
      ).resolves.toEqual({
        error: "Session role cannot access this realtime room",
      });
    }
  });

  it("mints admin room tokens for owners and stamps the role from the app role", async () => {
    const prepared = createPreparedDb({
      id: ownerId,
      username: "owner",
      role: 1,
      restaurant_id: "restaurant-1",
      is_active: 1,
      token_version: 2,
    });
    const service = createService({ DB: { prepare: prepared.prepare } });

    const response = await service.generateWebSocketToken({
      roomType: "admin",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId: createSessionToken({
        sub: ownerId,
        username: "owner",
        role: 1,
        restaurantId: "restaurant-1",
        tv: 2,
      }),
    });

    expect(response).toMatchObject({ expiresIn: 300 });
    await expect(
      service.verifyWebSocketToken("token" in response ? response.token : ""),
    ).resolves.toMatchObject({
      valid: true,
      payload: { roomType: "admin", role: "admin", appRole: 1 },
    });
  });

  // determineRole is now a projection of the app role rather than of the room.
  // canAccessRoomType keeps non-owners out of the admin room, so the only way
  // to pin the projection itself is to call it directly — otherwise a future
  // loosening of the room gate would silently restore "any staff is admin".
  it("never stamps admin from the room name alone", () => {
    const service = createService() as unknown as {
      determineRole(
        roomType: RealtimeAuthTokenRequest["roomType"],
        appRole?: number | string,
      ): string;
    };
    const determineRole = (
      roomType: RealtimeAuthTokenRequest["roomType"],
      appRole?: number | string,
    ) => service.determineRole(roomType, appRole);

    for (const roomType of ["admin", "restaurant", "kitchen"] as const) {
      expect(determineRole(roomType, 2)).toBe("staff");
      expect(determineRole(roomType, 4)).toBe("staff");
      expect(determineRole(roomType, 0)).toBe("admin");
      expect(determineRole(roomType, 1)).toBe("admin");
      // A string role must not be coerced — Number("") is 0, the platform
      // admin code.
      expect(determineRole(roomType, "")).toBe("staff");
      expect(determineRole(roomType, undefined)).toBe("staff");
    }
    expect(determineRole("customer", 0)).toBe("customer");
  });

  it("derives the realtime role from the app role, not the room name", async () => {
    const service = createService();

    const chefKitchen = await service.generateWebSocketToken({
      roomType: "kitchen",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId: createSessionToken({ role: 2 }),
    });
    await expect(
      service.verifyWebSocketToken(
        "token" in chefKitchen ? chefKitchen.token : "",
      ),
    ).resolves.toMatchObject({
      valid: true,
      payload: { role: "staff", appRole: 2 },
    });

    const platformAdmin = await service.generateWebSocketToken({
      roomType: "restaurant",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId: createSessionToken({ role: 0 }),
    });
    await expect(
      service.verifyWebSocketToken(
        "token" in platformAdmin ? platformAdmin.token : "",
      ),
    ).resolves.toMatchObject({
      valid: true,
      payload: { role: "admin", appRole: 0 },
    });
  });

  it("rejects inactive, stale, mismatched, and cross-restaurant DB users", async () => {
    const cases = [
      {
        row: {
          id: userId,
          username: "chef",
          role: 2,
          restaurant_id: "restaurant-1",
          is_active: 0,
          token_version: 1,
        },
        error: "User not found or inactive",
      },
      {
        row: {
          id: userId,
          username: "chef",
          role: 2,
          restaurant_id: "restaurant-1",
          is_active: 1,
          token_version: 2,
        },
        error: "Session token has been invalidated",
      },
      {
        row: {
          id: userId,
          username: "other",
          role: 2,
          restaurant_id: "restaurant-1",
          is_active: 1,
          token_version: 1,
        },
        error: "Invalid session token claims",
      },
      {
        row: {
          id: userId,
          username: "chef",
          role: 2,
          restaurant_id: "restaurant-2",
          is_active: 1,
          token_version: 1,
        },
        error: "User does not have access to this restaurant",
      },
    ];

    for (const { row, error } of cases) {
      const prepared = createPreparedDb(row);
      await expect(
        createService({
          DB: { prepare: prepared.prepare },
        }).generateWebSocketToken({
          roomType: "kitchen",
          roomId: "restaurant-1",
          restaurantId: "restaurant-1",
          sessionId: createSessionToken({}),
        }),
      ).resolves.toEqual({ error });
    }
  });

  it("handles user lookup absence and database failures by environment", async () => {
    await expect(
      createService({ NODE_ENV: "production", DB: {} }).generateWebSocketToken({
        roomType: "kitchen",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({}),
      }),
    ).resolves.toEqual({ error: "User lookup unavailable" });

    const throwingDb = createPreparedDb(null, { throwOnFirst: true });
    await expect(
      createService({
        NODE_ENV: "production",
        DB: { prepare: throwingDb.prepare },
      }).generateWebSocketToken({
        roomType: "kitchen",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({}),
      }),
    ).resolves.toEqual({ error: "Failed to validate session user" });

    const testThrowingDb = createPreparedDb(null, { throwOnFirst: true });
    await expect(
      createService({
        DB: { prepare: testThrowingDb.prepare },
      }).generateWebSocketToken({
        roomType: "kitchen",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: createSessionToken({}),
      }),
    ).resolves.toMatchObject({ expiresIn: 300 });
  });

  it("generates scoped guest realtime tokens from cached guest order tokens", async () => {
    const cache = createKV({
      "guest_token:guest-1": {
        restaurantId: "restaurant-1",
        orderId: "42",
      },
    });
    setSelectFixtures({
      orders: [[{ id: "42", restaurantId: "restaurant-1" }]],
    });
    const service = createService({ CACHE_KV: cache });

    const response = await service.generateGuestToken({
      restaurantId: "restaurant-1",
      orderId: "42",
      guestToken: "guest-1",
    });

    expect(response).toMatchObject({
      expiresAt: "2026-06-07T00:15:00.000Z",
      wsUrl: expect.stringMatching(
        /^wss:\/\/realtime\.example\.test\/customer\/order:42\?token=/,
      ),
    });
    await expect(
      service.verifyWebSocketToken("token" in response ? response.token : ""),
    ).resolves.toMatchObject({
      valid: true,
      payload: {
        roomType: "customer",
        roomId: "order:42",
        restaurantId: "restaurant-1",
        role: "customer",
        guestFlag: true,
        scope: "guest-realtime",
        orderId: "42",
      },
    });
    expect(cache.get).toHaveBeenCalledWith("guest_token:guest-1", "json");
  });

  it("denies guest realtime tokens when the claimed order is not owned by the restaurant", async () => {
    const cache = createKV({
      "guest_token:guest-1": {
        restaurantId: "restaurant-1",
        orderId: "42",
      },
    });
    setSelectFixtures({ orders: [[]] });
    const service = createService({ CACHE_KV: cache });

    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        orderId: "42",
        guestToken: "guest-1",
      }),
    ).resolves.toEqual({ error: "Guest token does not match this order" });
  });

  it("generates guest table tokens from signed QR codes", async () => {
    mocks.utils.parseSignedQRUrl.mockReturnValue({
      formatVersion: 2,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      identifier: "T1",
      version: 1,
      signature: "signature",
    });
    mocks.utils.verifyQRSignature.mockResolvedValue(true);
    setSelectFixtures({
      restaurants: [
        [
          {
            id: "restaurant-1",
            settings: { allowGuestOrders: true },
            isActive: true,
            isAvailable: true,
          },
        ],
      ],
      tables: [
        [
          {
            id: 10,
            restaurantId: "restaurant-1",
            number: "T1",
            qrCodeVersion: 1,
            isActive: true,
            deletedAt: null,
          },
        ],
      ],
    });
    const service = createService();

    const response = await service.generateGuestToken({
      restaurantId: "restaurant-1",
      tableId: "10",
      qrCode: "signed-qr",
    });

    expect(response).toMatchObject({
      expiresAt: "2026-06-07T00:15:00.000Z",
      wsUrl: expect.stringContaining("/customer/customer:10?token="),
    });
    await expect(
      service.verifyWebSocketToken("token" in response ? response.token : ""),
    ).resolves.toMatchObject({
      valid: true,
      payload: {
        guestFlag: true,
        tableId: "10",
        roomId: "customer:10",
      },
    });
    // tableId is part of the signed payload, so it must be part of what gets
    // verified — dropping it here would verify a different string than the one
    // that was signed.
    expect(mocks.utils.verifyQRSignature).toHaveBeenCalledWith(
      {
        type: "table",
        restaurantId: "restaurant-1",
        tableId: 10,
        identifier: "T1",
        version: 1,
      },
      "signature",
      qrSigningKey,
    );
  });

  it("rejects a table QR whose database version has been regenerated", async () => {
    mocks.utils.parseSignedQRUrl.mockReturnValue({
      formatVersion: 2,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      identifier: "T1",
      version: 1,
      signature: "signature",
    });
    mocks.utils.verifyQRSignature.mockResolvedValue(true);
    setSelectFixtures({
      restaurants: [
        [
          {
            id: "restaurant-1",
            settings: { allowGuestOrders: true },
            isActive: true,
            isAvailable: true,
          },
        ],
      ],
      tables: [
        [
          {
            id: 10,
            restaurantId: "restaurant-1",
            number: "T1",
            qrCodeVersion: 2,
            isActive: true,
            deletedAt: null,
          },
        ],
      ],
    });
    const service = createService();

    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        qrCode: "signed-qr",
      }),
    ).resolves.toEqual({ error: "QR code version is no longer current" });
  });

  it("generates guest realtime tokens from signed seat QR codes", async () => {
    mocks.utils.parseSignedQRUrl.mockReturnValue({
      formatVersion: 2,
      type: "seat",
      restaurantId: "restaurant-1",
      tableId: 10,
      identifier: "01",
      version: 3,
      signature: "signature",
    });
    mocks.utils.verifyQRSignature.mockResolvedValue(true);
    setSelectFixtures({
      restaurants: [
        [
          {
            id: "restaurant-1",
            settings: { allowGuestOrders: true },
            isActive: true,
            isAvailable: true,
          },
        ],
      ],
      seats: [
        [
          {
            id: 21,
            tableId: 10,
            seatNumber: "01",
            qrCodeVersion: 3,
            isActive: true,
            deletedAt: null,
          },
        ],
      ],
      tables: [
        [
          {
            id: 10,
            restaurantId: "restaurant-1",
            number: "T1",
            qrCodeVersion: 1,
            isActive: true,
            deletedAt: null,
          },
        ],
      ],
    });
    const service = createService();

    const response = await service.generateGuestToken({
      restaurantId: "restaurant-1",
      seatId: "21",
      qrCode: "signed-seat-qr",
    });

    expect(response).toMatchObject({
      wsUrl: expect.stringContaining("/customer/customer:10?token="),
    });
    await expect(
      service.verifyWebSocketToken("token" in response ? response.token : ""),
    ).resolves.toMatchObject({
      valid: true,
      payload: {
        tableId: "10",
        seatId: "21",
        roomId: "customer:10",
      },
    });
  });

  it("validates signed QR guest order ownership", async () => {
    const publicId = "018f0000-0000-7000-8000-000000000042";
    mocks.utils.parseSignedQRUrl.mockReturnValue({
      formatVersion: 2,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      identifier: "T1",
      version: 1,
      signature: "signature",
    });
    mocks.utils.verifyQRSignature.mockResolvedValue(true);
    setSelectFixtures({
      restaurants: [
        [activeGuestRestaurant()],
        [activeGuestRestaurant()],
        [activeGuestRestaurant()],
      ],
      tables: [
        [activeGuestTable()],
        [activeGuestTable()],
        [activeGuestTable()],
      ],
      orders: [
        [{ id: 42, publicId, restaurantId: "restaurant-1", tableId: 10 }],
        [{ id: 42, publicId, restaurantId: "restaurant-1", tableId: 10 }],
        [{ id: 43, restaurantId: "restaurant-2", tableId: 10 }],
      ],
    });
    const service = createService();

    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        orderId: "42",
        qrCode: "signed-qr",
      }),
    ).resolves.toMatchObject({
      expiresAt: "2026-06-07T00:15:00.000Z",
      wsUrl: expect.stringContaining("/customer/order:42?token="),
    });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        orderId: publicId,
        qrCode: "signed-qr",
      }),
    ).resolves.toMatchObject({
      expiresAt: "2026-06-07T00:15:00.000Z",
      wsUrl: expect.stringContaining(`/customer/order:${publicId}?token=`),
    });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        orderId: "43",
        qrCode: "signed-qr",
      }),
    ).resolves.toEqual({ error: "Order does not belong to this table" });
  });

  it("returns guest token validation errors", async () => {
    const service = createService({
      CACHE_KV: createKV({
        "guest_token:wrong": {
          restaurantId: "restaurant-2",
          orderId: "99",
        },
      }),
    });

    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        orderId: "42",
        guestToken: "missing",
      }),
    ).resolves.toEqual({ error: "Guest token expired or invalid" });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        orderId: "42",
        guestToken: "wrong",
      }),
    ).resolves.toEqual({ error: "Guest token does not match this order" });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
      }),
    ).resolves.toEqual({
      error: "A guest token or signed table QR code is required",
    });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        qrCode: "bad-qr",
      }),
    ).resolves.toEqual({
      error: "A valid signed table QR code is required",
    });

    mocks.utils.parseSignedQRUrl.mockReturnValue({
      formatVersion: 2,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      identifier: "T1",
      version: 1,
      signature: "signature",
    });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        qrCode: "signed-qr",
      }),
    ).resolves.toEqual({ error: "Invalid QR signature" });

    mocks.utils.verifyQRSignature.mockResolvedValue(true);
    mocks.utils.parseSignedQRUrl.mockReturnValue({
      formatVersion: 2,
      type: "table",
      restaurantId: "restaurant-2",
      tableId: 10,
      identifier: "T1",
      version: 1,
      signature: "signature",
    });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        qrCode: "signed-qr",
      }),
    ).resolves.toEqual({ error: "QR code does not match restaurant" });
  });

  it("returns guest restaurant and table validation errors", async () => {
    mocks.utils.parseSignedQRUrl.mockReturnValue({
      formatVersion: 2,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      identifier: "T1",
      version: 1,
      signature: "signature",
    });
    mocks.utils.verifyQRSignature.mockResolvedValue(true);
    const service = createService();

    setSelectFixtures({ restaurants: [[]] });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        qrCode: "signed-qr",
      }),
    ).resolves.toEqual({ error: "Restaurant not found" });

    setSelectFixtures({
      restaurants: [
        [{ ...activeGuestRestaurant(), settings: { allowGuestOrders: false } }],
      ],
    });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        qrCode: "signed-qr",
      }),
    ).resolves.toEqual({
      error: "Guest realtime is not enabled for this restaurant",
    });

    setSelectFixtures({
      restaurants: [[activeGuestRestaurant()]],
      tables: [[]],
    });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        qrCode: "signed-qr",
      }),
    ).resolves.toEqual({ error: "Table not found or inactive" });

    setSelectFixtures({
      restaurants: [[activeGuestRestaurant()]],
      tables: [[{ ...activeGuestTable(), number: "T2" }]],
    });
    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        tableId: "10",
        qrCode: "signed-qr",
      }),
    ).resolves.toEqual({ error: "QR code does not match table" });
  });

  it("wraps unexpected guest token validation failures", async () => {
    const service = createService({
      CACHE_KV: {
        get: vi.fn(async () => {
          throw new Error("kv unavailable");
        }),
      },
    });

    await expect(
      service.generateGuestToken({
        restaurantId: "restaurant-1",
        orderId: "42",
        guestToken: "guest-1",
      }),
    ).resolves.toEqual({ error: "Failed to generate guest realtime token" });
  });

  it("enforces guest realtime channel scope", () => {
    const service = createService();

    expect(
      service.verifyChannelAccess(
        {
          roomType: "customer",
          roomId: "order:42",
          restaurantId: "restaurant-1",
          role: "customer",
          scope: "guest-realtime",
          orderId: "42",
          exp: 1,
          iat: 1,
        },
        "order:42",
      ),
    ).toEqual({ allowed: true });
    expect(
      service.verifyChannelAccess(
        {
          roomType: "customer",
          roomId: "order:42",
          restaurantId: "restaurant-1",
          role: "customer",
          scope: "guest-realtime",
          orderId: "42",
          exp: 1,
          iat: 1,
        },
        "order:99",
      ),
    ).toEqual({
      allowed: false,
      error: "Token is not scoped to this channel",
    });
    expect(
      service.verifyChannelAccess(
        {
          roomType: "restaurant",
          roomId: "restaurant-1",
          restaurantId: "restaurant-1",
          role: "admin",
          exp: 1,
          iat: 1,
        },
        "anything",
      ),
    ).toEqual({ allowed: true });
    expect(
      service.verifyChannelAccess(
        {
          roomType: "customer",
          roomId: "order:42",
          restaurantId: "restaurant-1",
          role: "customer",
          scope: "guest-realtime",
          exp: 1,
          iat: 1,
        },
        "order:42",
      ),
    ).toEqual({
      allowed: false,
      error: "Invalid guest token payload",
    });
  });

  it("rejects invalid, expired, and malformed websocket tokens", async () => {
    const service = createService();
    const invalidPayloadToken = sign(
      {
        roomType: "customer",
        roomId: "customer:1",
      },
      realtimeSecret,
    );
    const badGuestToken = sign(
      {
        roomType: "customer",
        roomId: "customer:1",
        restaurantId: "restaurant-1",
        role: "customer",
        guestFlag: true,
        orderId: "42",
        exp: 1780790700,
      },
      realtimeSecret,
    );
    const manuallyExpiredToken = sign(
      {
        roomType: "customer",
        roomId: "customer:1",
        restaurantId: "restaurant-1",
        role: "customer",
        exp: 1780790399,
      },
      realtimeSecret,
      { noTimestamp: true },
    );
    const jwtExpiredToken = sign(
      {
        roomType: "customer",
        roomId: "customer:1",
        restaurantId: "restaurant-1",
        role: "customer",
      },
      realtimeSecret,
      { expiresIn: -1 },
    );

    await expect(
      service.verifyWebSocketToken(invalidPayloadToken),
    ).resolves.toEqual({ valid: false, error: "Invalid token payload" });
    await expect(service.verifyWebSocketToken(badGuestToken)).resolves.toEqual({
      valid: false,
      error: "Invalid guest token payload",
    });
    await expect(
      service.verifyWebSocketToken(manuallyExpiredToken),
    ).resolves.toEqual({ valid: false, error: "Token expired" });
    await expect(
      service.verifyWebSocketToken(jwtExpiredToken),
    ).resolves.toEqual({ valid: false, error: "Token expired" });
    await expect(service.verifyWebSocketToken("not-a-token")).resolves.toEqual({
      valid: false,
      error: "Invalid token",
    });
  });

  it("reports revoked tokens and delegates blacklist operations", async () => {
    mocks.blacklist.isTokenRevoked.mockResolvedValueOnce(true);
    mocks.blacklist.revokeToken.mockResolvedValue({ success: true });
    mocks.blacklist.revokeUserTokens.mockResolvedValue({
      success: true,
      count: 3,
    });
    mocks.blacklist.getStats.mockResolvedValue({
      estimatedCount: 3,
      sampleRecords: [{ tokenId: "token-1" }],
    });
    const service = createService();

    await expect(
      service.verifyWebSocketToken("revoked-token"),
    ).resolves.toEqual({
      valid: false,
      error: "Token has been revoked",
      revoked: true,
    });
    await expect(
      service.revokeToken("token-1", "logout", "admin"),
    ).resolves.toEqual({ success: true });
    await expect(
      service.revokeUserTokens("7", "permission_change", "admin"),
    ).resolves.toEqual({ success: true, count: 3 });
    await expect(service.isTokenRevoked("token-2")).resolves.toBe(false);
    await expect(service.getBlacklistStats()).resolves.toEqual({
      available: true,
      estimatedCount: 3,
      sampleRecords: [{ tokenId: "token-1" }],
    });

    expect(mocks.blacklist.revokeToken).toHaveBeenCalledWith(
      "token-1",
      "logout",
      {
        revokedBy: "admin",
      },
    );
    expect(mocks.blacklist.revokeUserTokens).toHaveBeenCalledWith(
      "7",
      "permission_change",
      "admin",
    );
  });

  it("reports unavailable blacklist services and operation failures", async () => {
    await expect(
      createService({
        TOKEN_BLACKLIST: undefined,
        CACHE_KV: undefined,
      }).revokeToken("token-1", "logout"),
    ).resolves.toEqual({
      success: false,
      error: "Token blacklist service not available",
    });
    await expect(
      createService({
        TOKEN_BLACKLIST: undefined,
        CACHE_KV: undefined,
      }).revokeUserTokens("7", "manual"),
    ).resolves.toEqual({
      success: false,
      error: "Token blacklist service not available",
    });
    await expect(
      createService({
        TOKEN_BLACKLIST: undefined,
        CACHE_KV: undefined,
      }).isTokenRevoked("token-1"),
    ).resolves.toBe(false);
    await expect(
      createService({
        TOKEN_BLACKLIST: undefined,
        CACHE_KV: undefined,
      }).getBlacklistStats(),
    ).resolves.toEqual({ available: false });

    mocks.blacklist.revokeToken.mockRejectedValueOnce(new Error("kv failed"));
    mocks.blacklist.revokeUserTokens.mockRejectedValueOnce(
      new Error("kv failed"),
    );
    const service = createService();

    await expect(service.revokeToken("token-1", "logout")).resolves.toEqual({
      success: false,
      error: "Failed to revoke token",
    });
    await expect(service.revokeUserTokens("7", "manual")).resolves.toEqual({
      success: false,
      error: "Failed to revoke user tokens",
    });
  });
});
