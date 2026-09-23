import type { Env } from "../types/env";
import type {
  RealtimeAuthPayload,
  RealtimeEvent,
  ConnectionAckEvent,
  HeartbeatEvent,
  ErrorEvent,
} from "@makanmasak/shared-types";
import {
  isValidRealtimeEvent,
  RealtimeEventType,
} from "@makanmasak/shared-types";
import {
  verifyWebSocketToken,
  extractTokenFromUrl,
} from "../utils/jwtVerifier";
import {
  formatValidationError,
  parseJsonMessage,
  validateBasicClientMessage,
} from "../utils/messageValidation";

export interface ConnectionInfo {
  id: string;
  type: "customer" | "admin" | "kitchen";
  roomId: string;
  connectedAt: number;
  lastActivity: number;
  auth?: RealtimeAuthPayload; // 認證資訊
  metadata?: Record<string, unknown>;
  // 離線重連支援
  lastEventId?: string; // 最後接收的事件 ID
  missedEvents?: RealtimeEvent[]; // 離線期間錯過的事件
}

// Legacy key: one array holding the whole history, rewritten on every
// broadcast. Read once per object so an in-flight history survives the
// deploy, then retired in favour of one key per event — see loadEventLog.
const EVENT_HISTORY_STORAGE_KEY = "eventHistory";
const EVENT_KEY_PREFIX = "evt:";
// Zero-padded so storage.list()'s lexicographic order is insertion order.
// 12 digits stays well inside Number's exact-integer range.
const EVENT_SEQ_DIGITS = 12;
// storage.delete() takes at most 128 keys per call.
const MAX_KEYS_PER_DELETE = 128;
const ROOM_INFO_STORAGE_KEY = "roomInfo";

const eventKey = (seq: number): string =>
  `${EVENT_KEY_PREFIX}${String(seq).padStart(EVENT_SEQ_DIGITS, "0")}`;

const eventSeq = (key: string): number =>
  Number(key.slice(EVENT_KEY_PREFIX.length));

interface StoredEvent {
  key: string;
  event: RealtimeEvent;
}
const HEARTBEAT_REQUEST = "ping";
const HEARTBEAT_RESPONSE = "pong";
// 1008 (policy violation) is what every client in this repo already treats as
// "re-authenticate, then reconnect" — customer-app's useWebSocket maps it to
// its onAuthFailure path, and the admin/kitchen clients re-mint a token on any
// close that is not 1000/1001.
const TOKEN_EXPIRED_CLOSE_CODE = 1008;

export class RealtimeSession implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private roomInfo: { type: string; id: string } | null = null;
  // 事件歷史記錄（用於離線重連）— 每個事件一個 storage key
  private eventLog: StoredEvent[] | null = null;
  private nextEventSeq = 0;
  private readonly MAX_EVENT_HISTORY = 100; // 最多保留 100 個事件
  private readonly MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000; // 最多保留 24 小時的事件

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get("Upgrade");

    // Handle WebSocket upgrade
    if (upgradeHeader === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // Handle HTTP requests
    switch (url.pathname) {
      case "/broadcast":
        return this.handleBroadcast(request);
      case "/stats":
        return this.handleStats(request);
      case "/history":
        return this.handleHistoryRequest(request);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, roomType, roomId] = url.pathname.split("/");

    if (!roomType || !roomId) {
      return new Response("Invalid room parameters", { status: 400 });
    }

    // 🔒 認證：提取並驗證 JWT token
    const token = extractTokenFromUrl(url);
    if (!token) {
      console.warn("WebSocket connection rejected: No token provided");
      return new Response("Unauthorized: Token required", { status: 401 });
    }

    // 驗證 token（包含黑名單檢查 - 使用專用 TOKEN_BLACKLIST 命名空間）
    const jwtSecret = this.env.REALTIME_JWT_SECRET || this.env.JWT_SECRET || "";
    if (!jwtSecret) {
      console.error("REALTIME_JWT_SECRET is not configured");
      return new Response("Server configuration error", { status: 500 });
    }

    const verification = await verifyWebSocketToken(
      token,
      jwtSecret,
      this.env.TOKEN_BLACKLIST,
    );

    if (!verification.valid) {
      console.warn(
        "WebSocket connection rejected: Invalid token",
        verification.error,
      );
      return new Response(`Unauthorized: ${verification.error}`, {
        status: 401,
      });
    }

    const authPayload = verification.payload!;

    // ========== ROOM ACCESS VALIDATION ==========

    // 1. 驗證 roomId 與 token 是否匹配
    const roomMatchesToken = authPayload.guestFlag
      ? authPayload.roomId === roomId ||
        (!authPayload.scope && authPayload.roomId === `customer:${roomId}`)
      : authPayload.roomId === roomId;

    if (!roomMatchesToken) {
      console.warn("WebSocket connection rejected: Room ID mismatch", {
        tokenRoomId: authPayload.roomId,
        requestedRoomId: roomId,
      });
      return new Response("Forbidden: Room ID does not match token", {
        status: 403,
      });
    }

    // 2. 驗證 roomType 與 token 是否匹配
    if (authPayload.roomType !== roomType) {
      console.warn("WebSocket connection rejected: Room type mismatch", {
        tokenRoomType: authPayload.roomType,
        requestedRoomType: roomType,
      });
      return new Response("Forbidden: Room type does not match token", {
        status: 403,
      });
    }

    // 3. 驗證用戶角色與房間類型的權限匹配
    const roleRoomValidation = this.validateRoleRoomAccess(
      authPayload.role,
      roomType,
    );
    if (!roleRoomValidation.valid) {
      console.warn("WebSocket connection rejected: Role-room mismatch", {
        role: authPayload.role,
        roomType,
        reason: roleRoomValidation.error,
      });
      return new Response(`Forbidden: ${roleRoomValidation.error}`, {
        status: 403,
      });
    }

    if (authPayload.guestFlag) {
      if (roomType !== "customer" || authPayload.role !== "customer") {
        return new Response("Forbidden: Guest tokens are customer-room only", {
          status: 403,
        });
      }
    }

    // 4. 驗證餐廳訪問權限（對於staff和admin）
    if (authPayload.role !== "customer") {
      const restaurantValidation =
        await this.validateRestaurantAccess(authPayload);
      if (!restaurantValidation.valid) {
        console.warn(
          "WebSocket connection rejected: Restaurant access denied",
          {
            userId: authPayload.userId,
            restaurantId: authPayload.restaurantId,
            reason: restaurantValidation.error,
          },
        );
        return new Response(`Forbidden: ${restaurantValidation.error}`, {
          status: 403,
        });
      }
    }

    // 5. 驗證桌號/座位訪問權限（對於customer房間）
    if (roomType === "customer") {
      // Customer rooms accept guest-scoped tokens only. verifyWebSocketToken
      // pins a guestFlag payload to `order:{orderId}` or `customer:{tableId}`,
      // so requiring the flag is what binds the room to something that was
      // actually verified when the token was minted. A plain customer-role
      // token carries no such binding.
      if (!authPayload.guestFlag) {
        console.warn(
          "WebSocket connection rejected: customer room requires a guest-scoped token",
          {
            roomId,
            restaurantId: authPayload.restaurantId,
          },
        );
        return new Response(
          "Forbidden: Customer rooms require a guest-scoped token",
          { status: 403 },
        );
      }

      const tableValidation = await this.validateTableAccess(authPayload);
      if (!tableValidation.valid) {
        console.warn(
          "WebSocket connection rejected: Table/seat access denied",
          {
            tableId: authPayload.tableId,
            seatId: authPayload.seatId,
            restaurantId: authPayload.restaurantId,
            reason: tableValidation.error,
          },
        );
        return new Response(`Forbidden: ${tableValidation.error}`, {
          status: 403,
        });
      }
    }

    await this.ensureRoomInfo(roomType, roomId);

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Generate unique connection ID
    const connectionId = `${roomType}_${roomId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const connectionInfo: ConnectionInfo = {
      id: connectionId,
      type: roomType as "customer" | "admin" | "kitchen",
      roomId: roomId,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      auth: authPayload, // 儲存認證資訊
    };

    server.serializeAttachment(connectionInfo);
    this.state.acceptWebSocket(server, [roomType, roomId]);

    // Send connection acknowledgment with auth info
    const ackEvent: ConnectionAckEvent = {
      type: RealtimeEventType.CONNECTION_ACK,
      eventId: this.generateEventId(),
      timestamp: Date.now(),
      restaurantId: authPayload.restaurantId,
      data: {
        connectionId,
        roomType: authPayload.roomType,
        roomId: authPayload.roomId,
        connectedAt: Date.now(),
        activeConnections: this.getActiveConnections().length,
      },
    };
    this.sendEvent(server, ackEvent);

    // Successfully established authenticated connection
    // Connection acknowledged with connectionId: ${connectionId}

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const connectionInfo = this.getConnectionInfo(socket);
    if (!connectionInfo) {
      socket.close(1008, "Missing connection metadata");
      return;
    }

    if (this.isAuthExpired(connectionInfo)) {
      this.closeExpiredConnection(socket);
      return;
    }

    await this.handleMessage(socket, message, connectionInfo);
  }

  async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    socket.serializeAttachment(null);
  }

  async webSocketError(socket: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
    socket.serializeAttachment(null);
    socket.close(1011, "WebSocket error");
  }

  private async handleMessage(
    socket: WebSocket,
    data: string | ArrayBuffer,
    connectionInfo: ConnectionInfo,
  ): Promise<void> {
    try {
      if (data === HEARTBEAT_REQUEST) {
        connectionInfo.lastActivity = Date.now();
        socket.serializeAttachment(connectionInfo);
        const heartbeatEvent: HeartbeatEvent = {
          type: RealtimeEventType.HEARTBEAT,
          eventId: this.generateEventId(),
          timestamp: Date.now(),
          restaurantId: connectionInfo.auth?.restaurantId || "",
          data: {
            serverTime: Date.now(),
          },
        };
        this.sendEvent(socket, heartbeatEvent);
        return;
      }

      const parsedMessage = parseJsonMessage(data);
      const validation = validateBasicClientMessage(parsedMessage);
      if (!validation.success) {
        this.sendErrorEvent(
          socket,
          connectionInfo,
          "INVALID_MESSAGE",
          formatValidationError(validation.error),
        );
        return;
      }
      const message = validation.data;

      // Update last activity
      connectionInfo.lastActivity = Date.now();
      socket.serializeAttachment(connectionInfo);

      // Message received and validated

      switch (message.type) {
        case "ping": {
          // 心跳響應
          const heartbeatEvent: HeartbeatEvent = {
            type: RealtimeEventType.HEARTBEAT,
            eventId: this.generateEventId(),
            timestamp: Date.now(),
            restaurantId: connectionInfo.auth?.restaurantId || "",
            data: {
              serverTime: Date.now(),
            },
          };
          this.sendEvent(socket, heartbeatEvent);
          break;
        }

        case "subscribe":
          // 訂閱特定事件類型（未來擴展）
          // Subscription processed
          break;

        case "unsubscribe":
          // 取消訂閱（未來擴展）
          // Unsubscription processed
          break;
      }
    } catch (error) {
      console.error(`Error handling message from ${connectionInfo.id}:`, error);
      this.sendErrorEvent(
        socket,
        connectionInfo,
        "MESSAGE_PARSE_ERROR",
        "Failed to parse message",
      );
    }
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    try {
      const event: RealtimeEvent = await request.json();

      // 驗證事件格式
      if (!isValidRealtimeEvent(event)) {
        return Response.json(
          { success: false, error: "Invalid event format" },
          { status: 400 },
        );
      }

      // 添加到事件歷史記錄
      await this.addToEventHistory(event);

      // 路由事件到相關的連線
      const sentCount = this.routeEvent(event);

      // Event successfully routed to connections

      return Response.json({
        success: true,
        message: "Event broadcast",
        eventId: event.eventId,
        recipientCount: sentCount,
      });
    } catch (error) {
      console.error("Broadcast error:", error);
      return Response.json(
        { success: false, error: "Failed to broadcast event" },
        { status: 500 },
      );
    }
  }

  private async handleStats(_request: Request): Promise<Response> {
    const connections = this.getConnectionEntries();
    const eventHistory = await this.loadEventHistory();
    const roomInfo = await this.loadRoomInfo();
    const stats = {
      roomInfo,
      connectionCount: connections.length,
      connections: connections.map(([, conn]) => ({
        id: conn.id,
        type: conn.type,
        role: conn.auth?.role,
        connectedAt: new Date(conn.connectedAt).toISOString(),
        lastActivity: new Date(conn.lastActivity).toISOString(),
        lastEventId: conn.lastEventId,
      })),
      eventHistorySize: eventHistory.length,
      uptime:
        Date.now() -
        (connections.length > 0
          ? Math.min(
              ...connections.map(([, connection]) => connection.connectedAt),
            )
          : Date.now()),
    };

    return Response.json(stats);
  }

  /**
   * 處理歷史事件請求（用於離線重連）
   */
  private async handleHistoryRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const sinceEventId = url.searchParams.get("since");
      const eventHistory = await this.loadEventHistory();

      if (!sinceEventId) {
        // 返回所有歷史事件
        return Response.json({
          success: true,
          events: eventHistory,
          count: eventHistory.length,
        });
      }

      // 找到指定事件 ID 之後的所有事件
      const sinceIndex = eventHistory.findIndex(
        (e) => e.eventId === sinceEventId,
      );

      if (sinceIndex === -1) {
        // 找不到指定的事件 ID，返回所有事件
        return Response.json({
          success: true,
          events: eventHistory,
          count: eventHistory.length,
          note: "Event ID not found, returning all available events",
        });
      }

      // 返回指定事件之後的所有事件
      const missedEvents = eventHistory.slice(sinceIndex + 1);

      return Response.json({
        success: true,
        events: missedEvents,
        count: missedEvents.length,
      });
    } catch (error) {
      console.error("History request error:", error);
      return Response.json(
        { success: false, error: "Failed to retrieve event history" },
        { status: 500 },
      );
    }
  }

  /**
   * 發送事件到指定的 WebSocket
   */
  private sendEvent(socket: WebSocket, event: RealtimeEvent): void {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(event));
      } catch (error) {
        console.error("Failed to send event:", error);
      }
    }
  }

  /**
   * 發送錯誤事件
   */
  private sendErrorEvent(
    socket: WebSocket,
    connectionInfo: ConnectionInfo,
    code: string,
    message: string,
  ): void {
    const errorEvent: ErrorEvent = {
      type: RealtimeEventType.ERROR,
      eventId: this.generateEventId(),
      timestamp: Date.now(),
      restaurantId: connectionInfo.auth?.restaurantId || "",
      data: {
        code,
        message,
        details: {},
      },
    };
    this.sendEvent(socket, errorEvent);
  }

  /**
   * 路由事件到相關的連線（核心路由邏輯）
   */
  private routeEvent(event: RealtimeEvent): number {
    let sentCount = 0;
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const [socket, connectionInfo] of this.getConnectionEntries()) {
      if (socket.readyState !== WebSocket.OPEN) continue;

      // Fan-out is the moment that matters for a passive listener: an attacker
      // holding a revoked token need never send us anything, so checking only
      // on inbound messages would leave the feed flowing. The object is
      // already awake here, so this costs nothing extra.
      if (this.isAuthExpired(connectionInfo, nowSeconds)) {
        this.closeExpiredConnection(socket);
        continue;
      }

      // 檢查是否應該發送此事件到此連線
      if (this.shouldSendEventToConnection(event, connectionInfo)) {
        this.sendEvent(socket, event);
        // 更新最後接收的事件 ID
        connectionInfo.lastEventId = event.eventId;
        socket.serializeAttachment(connectionInfo);
        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * 判斷是否應該發送事件到特定連線（訊息路由核心邏輯）
   */
  private shouldSendEventToConnection(
    event: RealtimeEvent,
    connectionInfo: ConnectionInfo,
  ): boolean {
    const eventType = event.type;

    // 群組訂單事件：房間（DO 實例）本身即以 groupOrderId 隔離
    // （customer:{groupOrderId}），房間內的每個連線都是同一筆群組訂單的
    // 參與者，因此直接投遞給房間內所有連線，不套用 restaurantId 過濾
    // ——部分群組事件的 payload 並未帶 restaurantId（bug-inventory #2）。
    switch (eventType) {
      case RealtimeEventType.GROUP_ORDER_CREATED:
      case RealtimeEventType.GROUP_MEMBER_JOINED:
      case RealtimeEventType.GROUP_CART_ITEM_ADDED:
      case RealtimeEventType.GROUP_CART_ITEM_UPDATED:
      case RealtimeEventType.GROUP_CART_ITEM_REMOVED:
      case RealtimeEventType.GROUP_ORDER_COMPLETED:
        return true;
    }

    // 驗證餐廳 ID 匹配
    if (event.restaurantId !== connectionInfo.auth?.restaurantId) {
      return false;
    }

    const role = connectionInfo.auth?.role || "customer";

    // 根據事件類型和連線角色決定是否發送
    switch (eventType) {
      // 訂單事件 - 所有角色都接收
      case RealtimeEventType.NEW_ORDER:
        return true;

      case RealtimeEventType.ORDER_STATUS_UPDATE:
      case RealtimeEventType.ORDER_ITEM_STATUS_UPDATE:
        // 顧客只接收與自己相關的訂單更新
        if (role === "customer") {
          // 這裡需要檢查訂單是否屬於該顧客的桌號/座位
          // 暫時允許所有顧客接收（之後可以優化）
          return true;
        }
        // 廚房和管理員接收所有訂單更新
        return role === "staff" || role === "admin";

      case RealtimeEventType.ORDER_CANCELLED:
        return true;

      // 廚房事件 - 只有廚房和管理員接收
      case RealtimeEventType.KITCHEN_ITEM_STATUS:
      case RealtimeEventType.KITCHEN_QUEUE_UPDATE:
        return role === "staff" || role === "admin";

      // 桌台事件 - 所有角色接收
      case RealtimeEventType.TABLE_STATUS_UPDATE:
      case RealtimeEventType.TABLE_CALL_SERVICE:
        return true;

      // 菜單事件 - 所有角色接收
      case RealtimeEventType.MENU_AVAILABILITY_UPDATE:
      case RealtimeEventType.MENU_ITEM_UPDATE:
        return true;

      // 系統事件 - 所有角色接收
      case RealtimeEventType.SYSTEM_NOTIFICATION:
      case RealtimeEventType.RESTAURANT_STATUS_UPDATE:
        return true;

      // 連線和心跳事件 - 不通過 broadcast（直接發送）
      case RealtimeEventType.CONNECTION_ACK:
      case RealtimeEventType.HEARTBEAT:
      case RealtimeEventType.ERROR:
        return false;

      default:
        // 未知事件類型 - 只發送給管理員
        return role === "admin";
    }
  }

  /**
   * 添加事件到歷史記錄
   */
  private async loadEventLog(): Promise<StoredEvent[]> {
    if (this.eventLog) return this.eventLog;

    const stored = await this.state.storage.list<RealtimeEvent>({
      prefix: EVENT_KEY_PREFIX,
    });
    let log: StoredEvent[] = [...stored].map(([key, event]) => ({
      key,
      event,
    }));

    // One-time move off the legacy single-array key. Guarded on the log being
    // empty: if any per-event key already exists it is newer than anything in
    // the array, and prepending would be the only ordering that is correct —
    // so simply do not migrate in that case rather than interleave wrongly.
    if (log.length === 0) {
      const legacy = await this.state.storage.get<RealtimeEvent[]>(
        EVENT_HISTORY_STORAGE_KEY,
      );
      if (legacy?.length) {
        log = legacy
          .slice(-this.MAX_EVENT_HISTORY)
          .map((event, i) => ({ key: eventKey(i), event }));
        await this.state.storage.put(
          Object.fromEntries(log.map((e) => [e.key, e.event])),
        );
        await this.state.storage.delete(EVENT_HISTORY_STORAGE_KEY);
      }
    }

    this.nextEventSeq = log.length ? eventSeq(log[log.length - 1].key) + 1 : 0;
    this.eventLog = log;
    return log;
  }

  private async loadEventHistory(): Promise<RealtimeEvent[]> {
    return (await this.loadEventLog()).map((e) => e.event);
  }

  /**
   * Appends one event and evicts whatever the size and age caps push out.
   *
   * The whole point of one key per event: this costs a single write request
   * unit plus one delete request per evicted event, where rewriting the entire
   * ~100-event array cost ceil(arrayBytes / 4 KB) write units on every
   * broadcast. Both caps are applied here because nothing schedules the alarm
   * that would otherwise trim in the background.
   */
  private async addToEventHistory(event: RealtimeEvent): Promise<void> {
    const log = await this.loadEventLog();
    const key = eventKey(this.nextEventSeq++);
    const appended = [...log, { key, event }];

    // Size cap first, then age — the order the array implementation used. It
    // lets an already-expired arrival consume a slot before being discarded,
    // which costs one retained event in the worst case; kept as-is so this
    // change is only about where the events are stored.
    const cutoffTime = Date.now() - this.MAX_EVENT_AGE_MS;
    const kept = appended
      .slice(-this.MAX_EVENT_HISTORY)
      .filter((e) => e.event.timestamp > cutoffTime);
    this.eventLog = kept;

    const keptKeys = new Set(kept.map((e) => e.key));
    if (keptKeys.has(key)) {
      await this.state.storage.put(key, event);
    }
    // An event that arrives already expired is never written, so it must not
    // be handed to the delete pass either — that would spend a delete request
    // on a key that does not exist.
    await this.deleteEventKeys(keptKeys.has(key) ? appended : log, keptKeys);
  }

  /**
   * Deletes the keys in `from` that `keptKeys` no longer covers.
   *
   * ponytail: capped at one storage.delete() call. In steady state at most one
   * event is evicted per append, and anything over the cap is picked up by the
   * next append because the eviction rule is recomputed from scratch each time.
   */
  private async deleteEventKeys(
    from: StoredEvent[],
    keptKeys: Set<string>,
  ): Promise<void> {
    const dropped = from
      .filter((e) => !keptKeys.has(e.key))
      .map((e) => e.key)
      .slice(0, MAX_KEYS_PER_DELETE);
    if (dropped.length) await this.state.storage.delete(dropped);
  }

  private async loadRoomInfo(): Promise<{ type: string; id: string } | null> {
    if (this.roomInfo) return this.roomInfo;

    this.roomInfo =
      (await this.state.storage.get<{ type: string; id: string }>(
        ROOM_INFO_STORAGE_KEY,
      )) ?? null;
    return this.roomInfo;
  }

  private async ensureRoomInfo(
    roomType: string,
    roomId: string,
  ): Promise<{ type: string; id: string }> {
    const existingRoomInfo = await this.loadRoomInfo();
    if (existingRoomInfo) return existingRoomInfo;

    this.roomInfo = { type: roomType, id: roomId };
    await this.state.storage.put(ROOM_INFO_STORAGE_KEY, this.roomInfo);
    return this.roomInfo;
  }

  private getActiveConnections(): WebSocket[] {
    return this.state.getWebSockets().filter((socket) => {
      return (
        socket.readyState === WebSocket.OPEN && !!this.getConnectionInfo(socket)
      );
    });
  }

  private getConnectionInfo(socket: WebSocket): ConnectionInfo | null {
    return socket.deserializeAttachment() as ConnectionInfo | null;
  }

  /**
   * The upgrade handshake was the only place a token's claims were ever read,
   * so a connection outlived every revocation its expiry is supposed to
   * enforce: a demoted or dismissed admin kept a cross-restaurant feed open
   * indefinitely, and re-checking role or restaurant at upgrade time alone
   * cannot reach an already-open socket. Expiry is the one claim we can
   * re-evaluate without a DB round trip, and the tokens are short (5 minutes
   * for staff, 15 for guests), so closing on it is what turns a revocation
   * into a disconnection.
   *
   * Deliberately evaluated only where the object is already awake — an inbound
   * message, a broadcast fan-out, the cleanup alarm. No timer is scheduled,
   * because waking a hibernating object on a schedule is exactly the cost
   * hibernation was enabled to avoid.
   */
  private isAuthExpired(
    connectionInfo: ConnectionInfo,
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): boolean {
    const exp = connectionInfo.auth?.exp;
    // Every minting path in RealtimeAuthService stamps `exp`, and
    // verifyWebSocketToken rejects a token whose exp has passed. A connection
    // with no exp therefore came from nowhere legitimate: treat it as expired
    // rather than as eternal.
    if (typeof exp !== "number" || !Number.isFinite(exp)) return true;
    return exp <= nowSeconds;
  }

  private closeExpiredConnection(socket: WebSocket): void {
    socket.close(TOKEN_EXPIRED_CLOSE_CODE, "Token expired");
    socket.serializeAttachment(null);
  }

  private getConnectionEntries(): Array<[WebSocket, ConnectionInfo]> {
    return this.getActiveConnections().map((socket) => [
      socket,
      this.getConnectionInfo(socket)!,
    ]);
  }

  /**
   * 生成唯一的事件 ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 驗證用戶角色與房間類型的權限匹配
   */
  private validateRoleRoomAccess(
    role: "customer" | "staff" | "admin",
    roomType: string,
  ): { valid: boolean; error?: string } {
    // 定義角色允許訪問的房間類型
    const roleRoomMap: Record<string, string[]> = {
      customer: ["customer"],
      staff: ["kitchen"],
      admin: ["admin", "kitchen", "restaurant"],
    };

    const allowedRooms = roleRoomMap[role] || [];
    if (!allowedRooms.includes(roomType)) {
      return {
        valid: false,
        error: `Role "${role}" is not authorized to access "${roomType}" rooms`,
      };
    }

    return { valid: true };
  }

  /**
   * 驗證餐廳訪問權限（對於staff和admin）
   */
  private async validateRestaurantAccess(
    authPayload: RealtimeAuthPayload,
  ): Promise<{ valid: boolean; error?: string }> {
    // 必須提供 userId
    if (!authPayload.userId) {
      return {
        valid: false,
        error: "User ID is required for staff/admin access",
      };
    }

    // 驗證用戶是否屬於該餐廳
    try {
      // 查詢數據庫驗證用戶的 restaurantId
      const stmt = this.env.DB.prepare(
        "SELECT restaurant_id, role FROM users WHERE id = ? AND is_active = 1",
      );
      const result = (await stmt.bind(authPayload.userId).first()) as {
        restaurant_id: string | null;
        role: number;
      } | null;

      if (!result) {
        return {
          valid: false,
          error: "User not found or inactive",
        };
      }

      // Platform admins can select and monitor any restaurant from the admin
      // dashboard. Other staff must be bound to the requested restaurant.
      if (Number(result.role) === 0 || authPayload.appRole === 0) {
        return { valid: true };
      }

      // 驗證 restaurantId 匹配
      if (result.restaurant_id !== authPayload.restaurantId) {
        return {
          valid: false,
          error: "User does not belong to this restaurant",
        };
      }

      return { valid: true };
    } catch (error) {
      console.error("Restaurant access validation error:", error);
      return {
        valid: false,
        error: "Failed to validate restaurant access",
      };
    }
  }

  /**
   * 驗證桌號/座位訪問權限（對於customer房間）
   */
  private async validateTableAccess(
    authPayload: RealtimeAuthPayload,
  ): Promise<{ valid: boolean; error?: string }> {
    // 沒有 tableId 時，唯一可接受的情況是訂單範圍的訪客 token
    // （scope=guest-realtime + orderId），該 token 的 roomId 已綁定 order:{orderId}。
    // 過去這裡直接 return valid，等於「沒帶 tableId 就當店鋪模式放行」，
    // 讓任何 customer token 都能進入任意房間。
    if (!authPayload.tableId) {
      if (authPayload.scope === "guest-realtime" && authPayload.orderId) {
        return { valid: true };
      }
      // 群組訂單房間沒有桌號：授權來自成員憑證，roomId 已綁定 groupOrderId。
      if (
        authPayload.scope === "group-order-realtime" &&
        authPayload.groupOrderId
      ) {
        return { valid: true };
      }
      return {
        valid: false,
        error:
          "Customer rooms require a table/seat, an order-scoped, or a group-order-scoped token",
      };
    }

    try {
      // 驗證桌號是否屬於該餐廳
      const stmt = this.env.DB.prepare(
        "SELECT id, restaurant_id FROM tables WHERE id = ? AND is_active = 1",
      );
      const table = (await stmt.bind(authPayload.tableId).first()) as {
        id: number;
        restaurant_id: string;
      } | null;

      if (!table) {
        return {
          valid: false,
          error: "Table not found or inactive",
        };
      }

      if (table.restaurant_id !== authPayload.restaurantId) {
        return {
          valid: false,
          error: "Table does not belong to this restaurant",
        };
      }

      // 如果提供了 seatId，驗證座位
      if (authPayload.seatId) {
        const seatStmt = this.env.DB.prepare(
          "SELECT id, table_id FROM seats WHERE id = ? AND is_active = 1",
        );
        const seat = (await seatStmt.bind(authPayload.seatId).first()) as {
          id: number;
          table_id: number;
        } | null;

        if (!seat) {
          return {
            valid: false,
            error: "Seat not found or inactive",
          };
        }

        if (seat.table_id !== table.id) {
          return {
            valid: false,
            error: "Seat does not belong to this table",
          };
        }
      }

      return { valid: true };
    } catch (error) {
      console.error("Table access validation error:", error);
      return {
        valid: false,
        error: "Failed to validate table access",
      };
    }
  }

  // Cleanup inactive connections and expired events
  private async cleanupConnections(): Promise<void> {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes

    // 1. 清理不活躍的連線，以及 token 已過期的連線
    const nowSeconds = Math.floor(now / 1000);
    for (const [socket, connectionInfo] of this.getConnectionEntries()) {
      if (this.isAuthExpired(connectionInfo, nowSeconds)) {
        this.closeExpiredConnection(socket);
        continue;
      }
      if (now - connectionInfo.lastActivity > timeout) {
        socket.close();
        socket.serializeAttachment(null);
        // Inactive connection cleanup completed
      }
    }

    // 2. 清理過期的事件歷史記錄
    const cutoffTime = now - this.MAX_EVENT_AGE_MS;
    const log = await this.loadEventLog();
    const beforeCount = log.length;
    const kept = log.filter((e) => e.event.timestamp > cutoffTime);
    this.eventLog = kept;
    await this.deleteEventKeys(log, new Set(kept.map((e) => e.key)));
    const afterCount = kept.length;

    // 記錄清理情況（僅在有清理時）
    if (beforeCount > afterCount) {
      // Cleaned up ${beforeCount - afterCount} expired events
    }
  }

  // Periodic cleanup
  async alarm(): Promise<void> {
    await this.cleanupConnections();
  }
}
