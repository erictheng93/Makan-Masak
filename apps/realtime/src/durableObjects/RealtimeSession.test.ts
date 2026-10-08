import { describe, expect, it, vi } from "vitest";
import { sign } from "jsonwebtoken";
import { RealtimeEventType } from "@makanmasak/shared-types";
import type { RealtimeAuthPayload } from "@makanmasak/shared-types";
import { RealtimeSession } from "./RealtimeSession";
import type { ConnectionInfo } from "./RealtimeSession";
import type { Env } from "../types/env";

/**
 * What the routing helpers actually read off an event. The production
 * signatures take the full `RealtimeEvent` union, but these tests pin `type` to
 * one member at a time over an otherwise fixed payload, which the union cannot
 * express as a single literal.
 */
interface RoutableEvent {
  type: RealtimeEventType | string;
  eventId: string;
  timestamp: number;
  restaurantId: string;
  data: Record<string, unknown>;
}

/**
 * This suite drives RealtimeSession's private surface directly. Naming that
 * surface once keeps every call type-checked, instead of an `as any` per site.
 * The two validators take a partial payload because that is what the tests
 * supply — they only read the handful of fields listed at each call.
 */
interface RealtimeSessionInternals {
  roomInfo: { type: string; id: string } | null;
  handleMessage(
    socket: WebSocket,
    data: string | ArrayBuffer,
    connectionInfo: ConnectionInfo,
  ): Promise<void>;
  sendEvent(socket: WebSocket, event: RoutableEvent): void;
  sendErrorEvent(
    socket: WebSocket,
    connectionInfo: ConnectionInfo,
    code: string,
    message: string,
  ): void;
  routeEvent(event: RoutableEvent): number;
  shouldSendEventToConnection(
    event: RoutableEvent,
    connectionInfo: ConnectionInfo,
  ): boolean;
  validateRoleRoomAccess(
    role: string,
    roomType: string,
  ): { valid: boolean; error?: string };
  validateRestaurantAccess(
    authPayload: Partial<RealtimeAuthPayload> & { userId?: string },
  ): Promise<{ valid: boolean; error?: string }>;
  validateTableAccess(
    authPayload: Partial<RealtimeAuthPayload>,
  ): Promise<{ valid: boolean; error?: string }>;
}

function internals(session: RealtimeSession): RealtimeSessionInternals {
  return session as unknown as RealtimeSessionInternals;
}

const jwtSecret = "0123456789abcdefghijklmnopqrstuvwxyz";

class TestWebSocketRequestResponsePair {
  constructor(
    public readonly request: string,
    public readonly response: string,
  ) {}
}

function ensureWebSocketRequestResponsePair() {
  if (!("WebSocketRequestResponsePair" in globalThis)) {
    vi.stubGlobal(
      "WebSocketRequestResponsePair",
      TestWebSocketRequestResponsePair,
    );
  }
}

function createEnv(): Env {
  return {
    ENVIRONMENT: "test",
    API_VERSION: "1",
    JWT_SECRET: "secret",
    REALTIME_JWT_SECRET: jwtSecret,
    REALTIME_SESSION: {} as DurableObjectNamespace,
    CACHE_KV: {} as KVNamespace,
    TOKEN_BLACKLIST: {} as KVNamespace,
    DB: {} as D1Database,
  };
}

function createState(input?: {
  sockets?: WebSocket[];
  storage?: Map<string, unknown>;
}) {
  const sockets = input?.sockets ?? [];
  const storage = input?.storage ?? new Map<string, unknown>();
  const state = {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(
        async (
          keyOrEntries: string | Record<string, unknown>,
          value?: unknown,
        ) => {
          if (typeof keyOrEntries === "string") {
            storage.set(keyOrEntries, value);
            return;
          }
          for (const [key, entry] of Object.entries(keyOrEntries)) {
            storage.set(key, entry);
          }
        },
      ),
      delete: vi.fn(async (keyOrKeys: string | string[]) => {
        const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        const deleted = keys.filter((key) => storage.delete(key)).length;
        return Array.isArray(keyOrKeys) ? deleted : deleted > 0;
      }),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const prefix = options?.prefix ?? "";
        return new Map(
          [...storage.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .sort(([a], [b]) => a.localeCompare(b)),
        );
      }),
    },
    acceptWebSocket: vi.fn((socket: WebSocket) => {
      sockets.push(socket);
    }),
    getWebSockets: vi.fn(() => sockets),
    setWebSocketAutoResponse: vi.fn(),
    __sockets: sockets,
    __storage: storage,
  };

  return state as unknown as DurableObjectState & {
    __sockets: WebSocket[];
    __storage: Map<string, unknown>;
    acceptWebSocket: ReturnType<typeof vi.fn>;
    setWebSocketAutoResponse: ReturnType<typeof vi.fn>;
    storage: DurableObjectStorage & {
      get: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
    };
  };
}

function createSession(
  env: Env = createEnv(),
  state: DurableObjectState = createState(),
): RealtimeSession {
  ensureWebSocketRequestResponsePair();
  return new RealtimeSession(state, env);
}

function createAuthEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...createEnv(),
    JWT_SECRET: jwtSecret,
    REALTIME_JWT_SECRET: jwtSecret,
    TOKEN_BLACKLIST: undefined as unknown as KVNamespace,
    ...overrides,
  };
}

function createDb(results: unknown[] = []) {
  const first = vi.fn(async () => results.shift() ?? null);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));

  return {
    DB: { prepare } as unknown as D1Database,
    prepare,
    bind,
    first,
  };
}

function createSocket(overrides: Record<string, unknown> = {}) {
  let attachment: unknown = null;
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn((value: unknown) => {
      attachment = value;
    }),
    deserializeAttachment: vi.fn(() => attachment),
    ...overrides,
  } as unknown as WebSocket & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    serializeAttachment: ReturnType<typeof vi.fn>;
    deserializeAttachment: ReturnType<typeof vi.fn>;
  };
}

/**
 * A decoded token minus the two claims jsonwebtoken stamps for us — the helper
 * fills those in, so a fixture only has to state the domain half.
 */
type AuthClaims = Omit<RealtimeAuthPayload, "iat" | "exp">;

/**
 * `exp` used to be a don't-care `0` here. It stopped being one once the session
 * re-checks it on every awake path, so the default is now a live token and a
 * test that wants an expired connection asks for one via `expiresInSeconds`.
 */
function connection(
  overrides: Partial<Omit<ConnectionInfo, "auth">> & {
    auth?: AuthClaims;
    expiresInSeconds?: number;
  } = {},
): ConnectionInfo {
  const { auth, expiresInSeconds = 3600, ...rest } = overrides;
  const claims: AuthClaims = auth ?? {
    role: "customer",
    roomType: "customer",
    roomId: "table-1",
    restaurantId: "restaurant-1",
    // RealtimeAuthPayload declares tableId/seatId as strings — a JWT claim is
    // JSON, and the token minter writes them as text.
    tableId: "7",
  };
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    id: "conn-1",
    type: "customer",
    roomId: "table-1",
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    ...rest,
    auth:
      "auth" in overrides && auth === undefined
        ? undefined
        : { ...claims, iat: issuedAt, exp: issuedAt + expiresInSeconds },
  };
}

function event(id: string, timestamp = Date.now()): RoutableEvent {
  return {
    type: RealtimeEventType.NEW_ORDER,
    eventId: id,
    timestamp,
    restaurantId: "restaurant-1",
    data: {
      orderId: 1001,
    },
  };
}

function tokenFor(payload: Record<string, unknown>) {
  return sign(
    {
      roomType: "admin",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      role: "admin",
      sid: "session-1",
      tv: 1,
      appRole: 0,
      ...payload,
    },
    jwtSecret,
    { expiresIn: "1h" },
  );
}

describe("RealtimeSession HTTP endpoints", () => {
  it("configures WebSocket hibernation auto-response", () => {
    const state = createState();

    createSession(createEnv(), state);

    expect(state.setWebSocketAutoResponse).toHaveBeenCalledWith(
      expect.any(WebSocketRequestResponsePair),
    );
  });

  it("returns 404 for unknown HTTP endpoints", async () => {
    const state = createState();
    const session = createSession(createEnv(), state);

    const response = await session.fetch(new Request("https://do.test/nope"));

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("rejects malformed broadcast events", async () => {
    const session = createSession(createEnv());
    const response = await session.fetch(
      new Request("https://do.test/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: RealtimeEventType.NEW_ORDER }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Invalid event format",
    });
  });

  it("routes a broadcast without persisting it", async () => {
    const state = createState();
    const session = createSession(createEnv(), state);

    const broadcast = await session.fetch(
      new Request("https://do.test/broadcast", {
        method: "POST",
        body: JSON.stringify(event("evt-1")),
      }),
    );
    expect(broadcast.status).toBe(200);
    await expect(broadcast.json()).resolves.toMatchObject({
      success: true,
      eventId: "evt-1",
      recipientCount: 0,
    });

    // No replay consumer exists, so a broadcast costs no storage at all.
    expect(state.storage.put).not.toHaveBeenCalled();
    expect(state.__storage.size).toBe(0);
    const history = await session.fetch(new Request("https://do.test/history"));
    expect(history.status).toBe(404);
  });

  it("reports stats for rooms without active websocket connections", async () => {
    const session = createSession(createEnv());
    await session.fetch(
      new Request("https://do.test/broadcast", {
        method: "POST",
        body: JSON.stringify(event("evt-1")),
      }),
    );

    const response = await session.fetch(new Request("https://do.test/stats"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      roomInfo: null,
      connectionCount: 0,
      connections: [],
    });
  });
});

describe("RealtimeSession message, routing, and validation behavior", () => {
  it("responds to ping messages and reports invalid or malformed client messages", async () => {
    const session = createSession(createEnv());
    const socket = createSocket();
    const info = connection();

    await internals(session).handleMessage(socket, "ping", info);
    await internals(session).handleMessage(
      socket,
      JSON.stringify({ type: "subscribe", channel: "orders" }),
      info,
    );
    await internals(session).handleMessage(
      socket,
      JSON.stringify({ type: "unsubscribe", channel: "orders" }),
      info,
    );
    await internals(session).handleMessage(
      socket,
      JSON.stringify({ type: "subscribe", channel: "" }),
      info,
    );
    await internals(session).handleMessage(socket, "not-json", info);

    const sent = socket.send.mock.calls.map(([payload]) => JSON.parse(payload));
    expect(sent[0]).toMatchObject({
      type: RealtimeEventType.HEARTBEAT,
      restaurantId: "restaurant-1",
      data: { serverTime: expect.any(Number) },
    });
    expect(sent[1]).toMatchObject({
      type: RealtimeEventType.ERROR,
      data: {
        code: "INVALID_MESSAGE",
        message: expect.stringContaining("channel"),
      },
    });
    expect(sent[2]).toMatchObject({
      type: RealtimeEventType.ERROR,
      data: {
        code: "MESSAGE_PARSE_ERROR",
        message: "Failed to parse message",
      },
    });
    expect(info.lastActivity).toEqual(expect.any(Number));
  });

  it("rejects websocket upgrades with missing room parameters or tokens", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const session = createSession(createAuthEnv());

      const missingRoom = await session.fetch(
        new Request("https://do.test/admin", {
          headers: { Upgrade: "websocket" },
        }),
      );
      expect(missingRoom.status).toBe(400);
      await expect(missingRoom.text()).resolves.toBe("Invalid room parameters");

      const missingToken = await session.fetch(
        new Request("https://do.test/admin/restaurant-1", {
          headers: { Upgrade: "websocket" },
        }),
      );
      expect(missingToken.status).toBe(401);
      await expect(missingToken.text()).resolves.toBe(
        "Unauthorized: Token required",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects websocket upgrades for invalid token and room claims", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const invalidToken = await createSession(createAuthEnv()).fetch(
        new Request("https://do.test/admin/restaurant-1?token=not-a-jwt", {
          headers: { Upgrade: "websocket" },
        }),
      );
      expect(invalidToken.status).toBe(401);
      await expect(invalidToken.text()).resolves.toBe(
        "Unauthorized: Invalid token format",
      );

      const roomMismatch = await createSession(createAuthEnv()).fetch(
        new Request(
          `https://do.test/admin/restaurant-1?token=${tokenFor({
            roomId: "restaurant-2",
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );
      expect(roomMismatch.status).toBe(403);
      await expect(roomMismatch.text()).resolves.toBe(
        "Forbidden: Room ID does not match token",
      );

      const typeMismatch = await createSession(createAuthEnv()).fetch(
        new Request(
          `https://do.test/admin/restaurant-1?token=${tokenFor({
            roomType: "kitchen",
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );
      expect(typeMismatch.status).toBe(403);
      await expect(typeMismatch.text()).resolves.toBe(
        "Forbidden: Room type does not match token",
      );

      const roleRoomMismatch = await createSession(createAuthEnv()).fetch(
        new Request(
          `https://do.test/admin/restaurant-1?token=${tokenFor({
            role: "staff",
            appRole: 2,
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );
      expect(roleRoomMismatch.status).toBe(403);
      await expect(roleRoomMismatch.text()).resolves.toContain(
        'Role "staff" is not authorized',
      );
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("uses JWT_SECRET to verify websocket tokens when REALTIME_JWT_SECRET is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = await createSession(
        createAuthEnv({ REALTIME_JWT_SECRET: undefined }),
      ).fetch(
        new Request(
          `https://do.test/admin/restaurant-1?token=${tokenFor({
            roomId: "restaurant-2",
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );

      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe(
        "Forbidden: Room ID does not match token",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects websocket upgrades when restaurant or table access fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const staffDb = createDb([
        { restaurant_id: "restaurant-2", role: 2 },
        { id: "session-1" },
      ]);
      const staffDenied = await createSession(
        createAuthEnv({ DB: staffDb.DB }),
      ).fetch(
        new Request(
          `https://do.test/kitchen/restaurant-1?token=${tokenFor({
            roomType: "kitchen",
            role: "staff",
            userId: "10",
            sid: "session-1",
            tv: 1,
            appRole: 2,
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );
      expect(staffDenied.status).toBe(403);
      await expect(staffDenied.text()).resolves.toBe(
        "Forbidden: User does not belong to this restaurant",
      );

      const tableDb = createDb([{ id: 7, restaurant_id: "restaurant-2" }]);
      const tableDenied = await createSession(
        createAuthEnv({ DB: tableDb.DB }),
      ).fetch(
        new Request(
          `https://do.test/customer/7?token=${tokenFor({
            roomType: "customer",
            roomId: "customer:7",
            role: "customer",
            guestFlag: true,
            tableId: "7",
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );
      expect(tableDenied.status).toBe(403);
      await expect(tableDenied.text()).resolves.toBe(
        "Forbidden: Table does not belong to this restaurant",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects customer room upgrades that are not backed by a guest-scoped token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Reproduces issue #96: a customer-role token minted without any
      // table/seat binding must not open a customer room, no matter which
      // roomId it names. `customer:{groupOrderId}` is the sensitive case —
      // group order events skip the restaurantId filter entirely.
      const db = createDb([]);
      const denied = await createSession(createAuthEnv({ DB: db.DB })).fetch(
        new Request(
          `https://do.test/customer/group-order-42?token=${tokenFor({
            roomType: "customer",
            roomId: "group-order-42",
            role: "customer",
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );

      expect(denied.status).toBe(403);
      await expect(denied.text()).resolves.toBe(
        "Forbidden: Customer rooms require a guest-scoped token",
      );
      // Denied before any table lookup, and no socket was accepted.
      expect(db.prepare).not.toHaveBeenCalled();

      // A verified tableId on a non-guest token does not help either.
      const tableDb = createDb([{ id: 7, restaurant_id: "restaurant-1" }]);
      const deniedWithTable = await createSession(
        createAuthEnv({ DB: tableDb.DB }),
      ).fetch(
        new Request(
          `https://do.test/customer/group-order-42?token=${tokenFor({
            roomType: "customer",
            roomId: "group-order-42",
            role: "customer",
            tableId: "7",
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );
      expect(deniedWithTable.status).toBe(403);
      expect(tableDb.prepare).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects a derived staff token after its source session is terminated", async () => {
    const db = createDb([
      { restaurant_id: "restaurant-1", role: 1, token_version: 1 },
      null,
    ]);
    const response = await internals(
      createSession(createAuthEnv({ DB: db.DB })),
    ).validateRestaurantAccess({
      userId: "1",
      appRole: 1,
      sid: "session-1",
      tv: 1,
      restaurantId: "restaurant-1",
      role: "admin",
    });
    expect(response).toEqual({
      valid: false,
      error: "Session has been invalidated",
    });
  });

  it("sets up authenticated websocket connections before 101 responses fail in node", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createSocket();
    const server = createSocket({
      accept: vi.fn(),
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("WebSocketPair", function WebSocketPair() {
      return { 0: client, 1: server };
    });
    try {
      const db = createDb([
        { restaurant_id: null, role: 0 },
        { id: "session-1" },
      ]);
      const state = createState();
      const session = createSession(createAuthEnv({ DB: db.DB }), state);

      await expect(
        session.fetch(
          new Request(
            `https://do.test/admin/restaurant-1?token=${tokenFor({
              userId: "1",
            })}`,
            { headers: { Upgrade: "websocket" } },
          ),
        ),
      ).rejects.toThrow('init["status"] must be in the range');

      expect(state.acceptWebSocket).toHaveBeenCalledWith(server, [
        "admin",
        "restaurant-1",
      ]);
      expect(server.serializeAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "admin",
          roomId: "restaurant-1",
          auth: expect.objectContaining({
            userId: "1",
            role: "admin",
          }),
        }),
      );
      expect(internals(session).roomInfo).toEqual({
        type: "admin",
        id: "restaurant-1",
      });
      expect(state.storage.put).toHaveBeenCalledWith("roomInfo", {
        type: "admin",
        id: "restaurant-1",
      });
      expect(server.send).toHaveBeenCalledWith(
        expect.stringContaining(RealtimeEventType.CONNECTION_ACK),
      );
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("sets guest websocket room metadata and preserves existing room info", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pairs = [
      [
        createSocket(),
        createSocket({ accept: vi.fn(), addEventListener: vi.fn() }),
      ],
      [
        createSocket(),
        createSocket({ accept: vi.fn(), addEventListener: vi.fn() }),
      ],
    ];
    vi.stubGlobal("WebSocketPair", function WebSocketPair() {
      const [client, server] = pairs.shift()!;
      return { 0: client, 1: server };
    });
    try {
      const db = createDb([
        { id: 7, restaurant_id: "restaurant-1" },
        { id: 7, restaurant_id: "restaurant-1" },
      ]);
      const state = createState();
      const session = createSession(
        createAuthEnv({
          DB: db.DB,
          REALTIME_JWT_SECRET: jwtSecret,
        }),
        state,
      );
      const guestToken = tokenFor({
        roomType: "customer",
        roomId: "customer:7",
        role: "customer",
        guestFlag: true,
        tableId: "7",
      });

      await expect(
        session.fetch(
          new Request(`https://do.test/customer/7?token=${guestToken}`, {
            headers: { Upgrade: "websocket" },
          }),
        ),
      ).rejects.toThrow('init["status"] must be in the range');
      await expect(
        session.fetch(
          new Request(`https://do.test/customer/7?token=${guestToken}`, {
            headers: { Upgrade: "websocket" },
          }),
        ),
      ).rejects.toThrow('init["status"] must be in the range');

      expect(internals(session).roomInfo).toEqual({
        type: "customer",
        id: "7",
      });
      expect(state.storage.put).toHaveBeenCalledWith("roomInfo", {
        type: "customer",
        id: "7",
      });
      expect(state.__sockets).toHaveLength(2);
      expect(state.__sockets[0].deserializeAttachment()).toMatchObject({
        type: "customer",
        roomId: "7",
      });
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("accepts scoped guest order websocket rooms with public order ids", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const publicId = "018f0000-0000-7000-8000-000000000042";
    const client = createSocket();
    const server = createSocket({
      accept: vi.fn(),
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("WebSocketPair", function WebSocketPair() {
      return { 0: client, 1: server };
    });
    try {
      const state = createState();
      const session = createSession(createAuthEnv(), state);
      const guestToken = tokenFor({
        roomType: "customer",
        roomId: `order:${publicId}`,
        role: "customer",
        guestFlag: true,
        scope: "guest-realtime",
        orderId: publicId,
      });

      await expect(
        session.fetch(
          new Request(
            `https://do.test/customer/order:${publicId}?token=${guestToken}`,
            { headers: { Upgrade: "websocket" } },
          ),
        ),
      ).rejects.toThrow('init["status"] must be in the range');

      expect(internals(session).roomInfo).toEqual({
        type: "customer",
        id: `order:${publicId}`,
      });
      expect(server.deserializeAttachment()).toMatchObject({
        type: "customer",
        roomId: `order:${publicId}`,
        auth: expect.objectContaining({
          scope: "guest-realtime",
          orderId: publicId,
        }),
      });
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("accepts group-order scoped websocket rooms addressed by group order id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const groupOrderId = "018f0000-0000-7000-8000-000000000099";
    const client = createSocket();
    const server = createSocket({
      accept: vi.fn(),
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("WebSocketPair", function WebSocketPair() {
      return { 0: client, 1: server };
    });
    try {
      const db = createDb([]);
      const state = createState();
      const session = createSession(createAuthEnv({ DB: db.DB }), state);
      const groupToken = tokenFor({
        roomType: "customer",
        roomId: groupOrderId,
        role: "customer",
        guestFlag: true,
        scope: "group-order-realtime",
        groupOrderId,
        memberId: "member-1",
      });

      await expect(
        session.fetch(
          new Request(
            `https://do.test/customer/${groupOrderId}?token=${groupToken}`,
            { headers: { Upgrade: "websocket" } },
          ),
        ),
      ).rejects.toThrow('init["status"] must be in the range');

      // Room is the bare group order id — the same one RealtimeBroadcastService
      // fans group events out to via `customer:{groupOrderId}`.
      expect(internals(session).roomInfo).toEqual({
        type: "customer",
        id: groupOrderId,
      });
      expect(server.deserializeAttachment()).toMatchObject({
        type: "customer",
        roomId: groupOrderId,
        auth: expect.objectContaining({
          scope: "group-order-realtime",
          groupOrderId,
        }),
      });
      // No table lookup is possible for a group room, so none should happen.
      expect(db.prepare).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("rejects a group-order token whose roomId is not its group order id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // The binding is roomId === groupOrderId. A token naming a different room
      // must not be usable to reach it.
      const denied = await createSession(createAuthEnv()).fetch(
        new Request(
          `https://do.test/customer/someone-elses-group?token=${tokenFor({
            roomType: "customer",
            roomId: "someone-elses-group",
            role: "customer",
            guestFlag: true,
            scope: "group-order-realtime",
            groupOrderId: "018f0000-0000-7000-8000-000000000099",
          })}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );

      expect(denied.status).toBe(401);
      await expect(denied.text()).resolves.toContain("Invalid guest token");
    } finally {
      warn.mockRestore();
    }
  });

  it("covers event routing decisions for roles and event families", () => {
    const session = createSession(createEnv());
    const customer = connection();
    const staff = connection({
      auth: {
        role: "staff",
        restaurantId: "restaurant-1",
        roomType: "kitchen",
        roomId: "restaurant-1",
      },
    });
    const admin = connection({
      auth: {
        role: "admin",
        restaurantId: "restaurant-1",
        roomType: "admin",
        roomId: "restaurant-1",
      },
    });
    const unauthenticated = connection({ auth: undefined });
    const statusEvent = event("status");
    statusEvent.type = RealtimeEventType.ORDER_STATUS_UPDATE;
    const itemStatusEvent = event("item-status");
    itemStatusEvent.type = RealtimeEventType.ORDER_ITEM_STATUS_UPDATE;
    const kitchenItemEvent = event("kitchen-item");
    kitchenItemEvent.type = RealtimeEventType.KITCHEN_ITEM_STATUS;
    const tableStatusEvent = event("table-status");
    tableStatusEvent.type = RealtimeEventType.TABLE_STATUS_UPDATE;
    const tableServiceEvent = event("table-service");
    tableServiceEvent.type = RealtimeEventType.TABLE_CALL_SERVICE;
    const menuEvent = event("menu");
    menuEvent.type = RealtimeEventType.MENU_ITEM_UPDATE;
    const menuAvailabilityEvent = event("menu-availability");
    menuAvailabilityEvent.type = RealtimeEventType.MENU_AVAILABILITY_UPDATE;
    const systemEvent = event("system");
    systemEvent.type = RealtimeEventType.SYSTEM_NOTIFICATION;
    const restaurantEvent = event("restaurant");
    restaurantEvent.type = RealtimeEventType.RESTAURANT_STATUS_UPDATE;
    const unknownEvent = event("unknown");
    unknownEvent.type = "unknown-event";

    expect(
      internals(session).shouldSendEventToConnection(statusEvent, customer),
    ).toBe(true);
    expect(
      internals(session).shouldSendEventToConnection(itemStatusEvent, staff),
    ).toBe(true);
    expect(
      internals(session).shouldSendEventToConnection(itemStatusEvent, admin),
    ).toBe(true);
    expect(
      internals(session).shouldSendEventToConnection(
        kitchenItemEvent,
        customer,
      ),
    ).toBe(false);
    for (const candidate of [
      tableStatusEvent,
      tableServiceEvent,
      menuEvent,
      menuAvailabilityEvent,
      systemEvent,
      restaurantEvent,
    ]) {
      expect(
        internals(session).shouldSendEventToConnection(candidate, customer),
      ).toBe(true);
    }
    expect(
      internals(session).shouldSendEventToConnection(unknownEvent, admin),
    ).toBe(true);
    expect(
      internals(session).shouldSendEventToConnection(unknownEvent, customer),
    ).toBe(false);
    expect(
      internals(session).shouldSendEventToConnection(
        statusEvent,
        unauthenticated,
      ),
    ).toBe(false);
  });

  it("handles send failures and unauthenticated error responses", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const session = createSession(createEnv());
      const failingSocket = createSocket({
        send: vi.fn(() => {
          throw new Error("send failed");
        }),
      });

      internals(session).sendEvent(failingSocket, event("send-failed"));
      expect(console.error).toHaveBeenCalledWith(
        "Failed to send event:",
        expect.any(Error),
      );

      const socket = createSocket();
      internals(session).sendErrorEvent(
        socket,
        connection({ auth: undefined }),
        "NO_AUTH",
        "Missing auth",
      );
      expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
        restaurantId: "",
        data: { code: "NO_AUTH", message: "Missing auth" },
      });
    } finally {
      error.mockRestore();
    }
  });

  it("routes broadcast events by restaurant, role, event type, and socket readiness", async () => {
    const sockets: WebSocket[] = [];
    const session = createSession(createEnv(), createState({ sockets }));
    const customer = createSocket();
    const staff = createSocket();
    const admin = createSocket();
    const closed = createSocket({ readyState: WebSocket.CLOSED });
    const otherRestaurant = createSocket();

    customer.serializeAttachment(connection());
    staff.serializeAttachment(
      connection({
        id: "staff-1",
        type: "kitchen",
        auth: {
          role: "staff",
          restaurantId: "restaurant-1",
          roomType: "kitchen",
          roomId: "restaurant-1",
        },
      }),
    );
    admin.serializeAttachment(
      connection({
        id: "admin-1",
        type: "admin",
        auth: {
          role: "admin",
          restaurantId: "restaurant-1",
          roomType: "admin",
          roomId: "restaurant-1",
        },
      }),
    );
    closed.serializeAttachment(connection({ id: "closed-1" }));
    otherRestaurant.serializeAttachment(
      connection({
        id: "other-1",
        auth: {
          role: "admin",
          restaurantId: "restaurant-2",
          roomType: "admin",
          roomId: "restaurant-2",
        },
      }),
    );
    sockets.push(customer, staff, admin, closed, otherRestaurant);

    const kitchenEvent = event("kitchen-1");
    kitchenEvent.type = RealtimeEventType.KITCHEN_QUEUE_UPDATE;
    const kitchenCount = internals(session).routeEvent(kitchenEvent);

    expect(kitchenCount).toBe(2);
    expect(customer.send).not.toHaveBeenCalled();
    expect(staff.send).toHaveBeenCalledWith(JSON.stringify(kitchenEvent));
    expect(admin.send).toHaveBeenCalledWith(JSON.stringify(kitchenEvent));
    expect(closed.send).not.toHaveBeenCalled();
    expect(otherRestaurant.send).not.toHaveBeenCalled();

    const heartbeat = event("heartbeat-1");
    heartbeat.type = RealtimeEventType.HEARTBEAT;
    expect(internals(session).routeEvent(heartbeat)).toBe(0);
  });

  // Revocation only reaches a live socket if something re-reads the token after
  // the handshake. These three are every path the object is already awake on.
  it("closes connections whose token expired instead of routing events to them", () => {
    const sockets: WebSocket[] = [];
    const session = createSession(createEnv(), createState({ sockets }));
    const expiredAdmin = createSocket();
    const liveAdmin = createSocket();

    const adminAuth = {
      role: "admin" as const,
      restaurantId: "restaurant-1",
      roomType: "admin" as const,
      roomId: "restaurant-1",
    };
    expiredAdmin.serializeAttachment(
      connection({
        id: "expired-admin",
        type: "admin",
        auth: adminAuth,
        expiresInSeconds: -60,
      }),
    );
    liveAdmin.serializeAttachment(
      connection({ id: "live-admin", type: "admin", auth: adminAuth }),
    );
    sockets.push(expiredAdmin, liveAdmin);

    const liveEvent = event("evt-live");
    const sent = internals(session).routeEvent(liveEvent);

    expect(sent).toBe(1);
    expect(expiredAdmin.send).not.toHaveBeenCalled();
    expect(expiredAdmin.close).toHaveBeenCalledWith(1008, "Token expired");
    expect(expiredAdmin.serializeAttachment).toHaveBeenLastCalledWith(null);
    expect(liveAdmin.send).toHaveBeenCalledWith(JSON.stringify(liveEvent));
  });

  it("closes an expired connection on its next message instead of answering it", async () => {
    const session = createSession(createEnv());
    const socket = createSocket();
    socket.serializeAttachment(
      connection({ id: "expired-ping", expiresInSeconds: -1 }),
    );

    await session.webSocketMessage(socket, "ping");

    expect(socket.close).toHaveBeenCalledWith(1008, "Token expired");
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("treats a connection with no auth payload as expired", () => {
    const sockets: WebSocket[] = [];
    const session = createSession(createEnv(), createState({ sockets }));
    const anonymous = createSocket();
    anonymous.serializeAttachment(
      connection({ id: "anonymous", auth: undefined }),
    );
    sockets.push(anonymous);

    expect(internals(session).routeEvent(event("evt-anon"))).toBe(0);
    expect(anonymous.close).toHaveBeenCalledWith(1008, "Token expired");
  });

  it("handles malformed broadcast request bodies as failed broadcasts", async () => {
    const session = createSession(createEnv());
    const response = await session.fetch(
      new Request("https://do.test/broadcast", {
        method: "POST",
        body: "{bad-json",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Failed to broadcast event",
    });
  });

  it("reports active connection stats with ISO timestamps", async () => {
    const sockets: WebSocket[] = [];
    const session = createSession(createEnv(), createState({ sockets }));
    const socket = createSocket();
    internals(session).roomInfo = { type: "kitchen", id: "restaurant-1" };
    socket.serializeAttachment(
      connection({
        id: "staff-1",
        type: "kitchen",
        connectedAt: Date.parse("2026-06-07T00:00:00.000Z"),
        lastActivity: Date.parse("2026-06-07T00:01:00.000Z"),
        auth: {
          role: "staff",
          restaurantId: "restaurant-1",
          roomType: "kitchen",
          roomId: "restaurant-1",
        },
      }),
    );
    const anonymous = createSocket();
    anonymous.serializeAttachment(
      connection({
        id: "anonymous",
        auth: undefined,
      }),
    );
    sockets.push(socket, anonymous);

    const response = await session.fetch(new Request("https://do.test/stats"));

    await expect(response.json()).resolves.toMatchObject({
      roomInfo: { type: "kitchen", id: "restaurant-1" },
      connectionCount: 2,
      connections: [
        {
          id: "staff-1",
          type: "kitchen",
          role: "staff",
          connectedAt: "2026-06-07T00:00:00.000Z",
          lastActivity: "2026-06-07T00:01:00.000Z",
        },
        {
          id: "anonymous",
        },
      ],
    });
  });

  it("validates role-room access rules", () => {
    const session = createSession(createEnv());

    expect(
      internals(session).validateRoleRoomAccess("customer", "customer"),
    ).toEqual({ valid: true });
    expect(internals(session).validateRoleRoomAccess("staff", "admin")).toEqual(
      {
        valid: false,
        error: 'Role "staff" is not authorized to access "admin" rooms',
      },
    );
    expect(
      internals(session).validateRoleRoomAccess("admin", "kitchen"),
    ).toEqual({ valid: true });
    expect(
      internals(session).validateRoleRoomAccess("manager", "customer"),
    ).toEqual({
      valid: false,
      error: 'Role "manager" is not authorized to access "customer" rooms',
    });
  });

  it("validates restaurant access for active users, platform admins, and failures", async () => {
    const regularDb = createDb([
      { restaurant_id: "restaurant-1", role: 2 },
      { id: "session-1" },
    ]);
    const regularSession = createSession({
      ...createEnv(),
      DB: regularDb.DB,
    });
    await expect(
      internals(regularSession).validateRestaurantAccess({
        userId: "10",
        sid: "session-1",
        tv: 1,
        appRole: 2,
        restaurantId: "restaurant-1",
        role: "staff",
      }),
    ).resolves.toEqual({ valid: true });

    const mismatchDb = createDb([
      { restaurant_id: "restaurant-2", role: 2 },
      { id: "session-1" },
    ]);
    const mismatchSession = createSession({
      ...createEnv(),
      DB: mismatchDb.DB,
    });
    await expect(
      internals(mismatchSession).validateRestaurantAccess({
        userId: "10",
        sid: "session-1",
        tv: 1,
        appRole: 2,
        restaurantId: "restaurant-1",
        role: "staff",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "User does not belong to this restaurant",
    });

    const adminDb = createDb([
      { restaurant_id: null, role: 0 },
      { id: "session-1" },
    ]);
    const adminSession = createSession({
      ...createEnv(),
      DB: adminDb.DB,
    });
    await expect(
      internals(adminSession).validateRestaurantAccess({
        userId: "1",
        sid: "session-1",
        tv: 1,
        appRole: 0,
        restaurantId: "restaurant-any",
        role: "admin",
      }),
    ).resolves.toEqual({ valid: true });

    const missingSession = createSession(createEnv());
    await expect(
      internals(missingSession).validateRestaurantAccess({
        restaurantId: "restaurant-1",
        role: "staff",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "User ID is required for staff/admin access",
    });

    const inactiveDb = createDb([]);
    const inactiveSession = createSession({
      ...createEnv(),
      DB: inactiveDb.DB,
    });
    await expect(
      internals(inactiveSession).validateRestaurantAccess({
        userId: "11",
        restaurantId: "restaurant-1",
        role: "staff",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "User not found or inactive",
    });
  });

  it("validates table and seat access including mismatch and DB error paths", async () => {
    // No tableId used to fail open as "shop mode". It now requires a scope that
    // pins roomId to something verified at mint time.
    const denied = {
      valid: false,
      error:
        "Customer rooms require a table/seat, an order-scoped, or a group-order-scoped token",
    };
    const noTableSession = createSession(createEnv());
    await expect(
      internals(noTableSession).validateTableAccess({
        restaurantId: "restaurant-1",
      }),
    ).resolves.toEqual(denied);

    await expect(
      internals(noTableSession).validateTableAccess({
        restaurantId: "restaurant-1",
        scope: "guest-realtime",
        orderId: "018f0000-0000-7000-8000-000000000042",
      }),
    ).resolves.toEqual({ valid: true });

    // A scope without an orderId is not a binding.
    await expect(
      internals(noTableSession).validateTableAccess({
        restaurantId: "restaurant-1",
        scope: "guest-realtime",
      }),
    ).resolves.toEqual(denied);

    // Group order members carry no tableId; their binding is groupOrderId.
    await expect(
      internals(noTableSession).validateTableAccess({
        restaurantId: "restaurant-1",
        scope: "group-order-realtime",
        groupOrderId: "018f0000-0000-7000-8000-000000000099",
      }),
    ).resolves.toEqual({ valid: true });

    // ...and the scope alone is not a binding either.
    await expect(
      internals(noTableSession).validateTableAccess({
        restaurantId: "restaurant-1",
        scope: "group-order-realtime",
      }),
    ).resolves.toEqual(denied);

    const tableMissingDb = createDb([]);
    const tableMissingSession = createSession({
      ...createEnv(),
      DB: tableMissingDb.DB,
    });
    await expect(
      internals(tableMissingSession).validateTableAccess({
        restaurantId: "restaurant-1",
        tableId: "7",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "Table not found or inactive",
    });

    const validTableOnlyDb = createDb([
      { id: 7, restaurant_id: "restaurant-1" },
    ]);
    const validTableOnlySession = createSession({
      ...createEnv(),
      DB: validTableOnlyDb.DB,
    });
    await expect(
      internals(validTableOnlySession).validateTableAccess({
        restaurantId: "restaurant-1",
        tableId: "7",
      }),
    ).resolves.toEqual({ valid: true });

    const seatMissingDb = createDb([{ id: 7, restaurant_id: "restaurant-1" }]);
    const seatMissingSession = createSession({
      ...createEnv(),
      DB: seatMissingDb.DB,
    });
    await expect(
      internals(seatMissingSession).validateTableAccess({
        restaurantId: "restaurant-1",
        tableId: "7",
        seatId: "3",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "Seat not found or inactive",
    });

    const okDb = createDb([
      { id: 7, restaurant_id: "restaurant-1" },
      { id: 3, table_id: 7 },
    ]);
    const okSession = createSession({ ...createEnv(), DB: okDb.DB });
    await expect(
      internals(okSession).validateTableAccess({
        restaurantId: "restaurant-1",
        tableId: "7",
        seatId: "3",
      }),
    ).resolves.toEqual({ valid: true });

    const mismatchDb = createDb([{ id: 7, restaurant_id: "restaurant-2" }]);
    const mismatchSession = createSession({
      ...createEnv(),
      DB: mismatchDb.DB,
    });
    await expect(
      internals(mismatchSession).validateTableAccess({
        restaurantId: "restaurant-1",
        tableId: "7",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "Table does not belong to this restaurant",
    });

    const seatMismatchDb = createDb([
      { id: 7, restaurant_id: "restaurant-1" },
      { id: 3, table_id: 8 },
    ]);
    const seatMismatchSession = createSession({
      ...createEnv(),
      DB: seatMismatchDb.DB,
    });
    await expect(
      internals(seatMismatchSession).validateTableAccess({
        restaurantId: "restaurant-1",
        tableId: "7",
        seatId: "3",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "Seat does not belong to this table",
    });

    const errorDb = {
      prepare: vi.fn(() => {
        throw new Error("d1 offline");
      }),
    };
    const errorSession = createSession({
      ...createEnv(),
      DB: errorDb as unknown as D1Database,
    });
    await expect(
      internals(errorSession).validateTableAccess({
        restaurantId: "restaurant-1",
        tableId: "7",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "Failed to validate table access",
    });
  });
});
