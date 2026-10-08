/**
 * WebSocket Service for Admin Dashboard
 * 基於 Cloudflare Durable Objects 的 WebSocket 連接管理
 */

import { ref, computed } from "vue";
import {
  RealtimeEventType,
  type RealtimeEvent,
  type RealtimeAuthTokenResponse,
} from "@makanmasak/shared-types";
import { api } from "@/services/api";
import { getAuthToken } from "@/utils/authTokenProvider";
import { sanitizeForLog } from "@/utils/sanitize";
import { getApiErrorStatus } from "@makanmasak/shared/utils/unknown";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";

/**
 * 後台同時服務店主與內場人員，但 admin 房間會廣播帶顧客姓名的候位事件，
 * 所以伺服器端只開放 role 0/1。廚師、送菜員、收銀員要改走 kitchen 房間：
 * 訂單與內場事件本來就同時扇出到 restaurant/kitchen/admin，他們拿得到需要的
 * 全部內容。寫死 "admin" 會讓這三種角色的 token 申請直接被擋成 400，接著一路
 * 重連到上限並停在錯誤狀態，等於整個即時更新失效。
 */
function resolveRoomType(): "admin" | "kitchen" {
  const role = useAuthStore().userRole;
  return role === UserRole.ADMIN || role === UserRole.OWNER
    ? "admin"
    : "kitchen";
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface WebSocketConfig {
  /** 重連最大嘗試次數 */
  maxReconnectAttempts?: number;
  /** 重連延遲（毫秒） */
  reconnectDelay?: number;
  /** 心跳間隔（毫秒） */
  heartbeatInterval?: number;
  /** 心跳超時（毫秒） */
  heartbeatTimeout?: number;
}

export interface EventSubscription {
  id: string;
  eventTypes: RealtimeEventType[];
  callback: (event: RealtimeEvent) => void;
  filter?: (event: RealtimeEvent) => boolean;
}

// A connection has to stay up this long before the retry budget is restored.
// Resetting on open let "connect, drop at once" loop forever, re-minting a
// token and waking the room's Durable Object every few seconds.
const STABLE_CONNECTION_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

const DEFAULT_CONFIG: Required<WebSocketConfig> = {
  maxReconnectAttempts: 5,
  reconnectDelay: 3000,
  heartbeatInterval: 30000,
  heartbeatTimeout: 10000,
};

class WebSocketService {
  private ws: WebSocket | null = null;
  private connectionStatus = ref<ConnectionStatus>("disconnected");
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private stableTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private heartbeatTimeoutTimer: number | null = null;
  private subscriptions = new Map<string, EventSubscription>();
  private subscriptionCounter = 0;
  private config: Required<WebSocketConfig>;
  private wsToken: string | null = null;
  private wsUrl: string | null = null;
  private restaurantId: string | null = null;

  constructor(config?: WebSocketConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupVisibilityHandlers();
    this.setupNetworkHandlers();
  }

  /**
   * 獲取 WebSocket Token
   */
  private async getWebSocketToken(
    restaurantId: string,
  ): Promise<RealtimeAuthTokenResponse> {
    const token = getAuthToken();
    if (!token) {
      throw new Error("No authentication token found");
    }

    const response = await api.post<{
      success?: boolean;
      data?: RealtimeAuthTokenResponse;
    }>(
      "/realtime/auth/token",
      {
        roomType: resolveRoomType(),
        roomId: restaurantId,
        restaurantId,
        sessionId: token,
      },
      {
        validateStatus: () => true,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      const error = new Error(
        `Failed to get WebSocket token: ${response.statusText}`,
      );
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }

    // API wraps every success response in `{ success, data }`. Unwrap `data`
    // here so callers can treat the return value as RealtimeAuthTokenResponse
    // directly (previously the singleton bailed with
    // "WebSocket URL or token missing from auth response" because it read
    // `.token` / `.wsUrl` off the outer envelope).
    const envelope = response.data as unknown as {
      success?: boolean;
      data?: RealtimeAuthTokenResponse;
    };
    if (!envelope?.data?.token || !envelope?.data?.wsUrl) {
      throw new Error("Realtime auth response missing token or wsUrl");
    }
    return envelope.data;
  }

  /**
   * 連接到 WebSocket 服務
   */
  async connect(restaurantId: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log("WebSocket already connected");
      return;
    }

    if (this.connectionStatus.value === "connecting") {
      console.log("WebSocket connection already in progress");
      return;
    }

    this.restaurantId = restaurantId;
    this.connectionStatus.value = "connecting";

    try {
      // 獲取 WebSocket Token
      const authResponse = await this.getWebSocketToken(restaurantId);
      this.wsToken = authResponse.token;
      this.wsUrl = authResponse.wsUrl;

      // Validate WebSocket URL and token before connecting
      if (!this.wsUrl || !this.wsToken) {
        console.warn(
          "WebSocket URL or token missing from auth response, aborting connect",
        );
        this.connectionStatus.value = "error";
        return;
      }

      // 建立 WebSocket 連接 — wsUrl 已由後端 buildWebSocketUrl 附好 ?token=，
      // 不要再 append 一次（會變成 ?token=TOKEN1?token=TOKEN2，realtime DO
      // 解析不出合法 JWT 就 HTTP 401）。
      this.ws = new WebSocket(this.wsUrl);

      this.setupWebSocketHandlers();
    } catch (error: unknown) {
      console.error("Failed to connect to WebSocket:", error);
      this.connectionStatus.value = "error";
      // Don't retry on client errors that won't resolve with retries
      const status = getApiErrorStatus(error);
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 429
      ) {
        console.warn(
          `WebSocket connection aborted (HTTP ${status}), not retrying`,
        );
        return;
      }
      this.scheduleReconnect();
    }
  }

  /**
   * 設置 WebSocket 事件處理器
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log("✅ WebSocket connected");
      this.connectionStatus.value = "connected";
      this.clearStableTimer();
      this.stableTimer = window.setTimeout(() => {
        this.reconnectAttempts = 0;
        this.stableTimer = null;
      }, STABLE_CONNECTION_MS);
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      if (event.data === "pong") {
        this.resetHeartbeatTimeout();
        return;
      }

      try {
        const message: RealtimeEvent = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("❌ Failed to parse WebSocket message:", error);
      }
    };

    this.ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
      this.connectionStatus.value = "error";
    };

    this.ws.onclose = (event) => {
      console.log("🔌 WebSocket closed:", event.code, event.reason);
      this.connectionStatus.value = "disconnected";
      this.stopHeartbeat();
      this.clearStableTimer();

      // 非正常關閉，嘗試重連
      if (event.code !== 1000 && event.code !== 1001) {
        this.scheduleReconnect();
      }
    };
  }

  /**
   * 處理接收到的訊息
   */
  private handleMessage(event: RealtimeEvent): void {
    // 心跳響應
    if (event.type === RealtimeEventType.HEARTBEAT) {
      this.resetHeartbeatTimeout();
      return;
    }

    // 連接確認
    if (event.type === RealtimeEventType.CONNECTION_ACK) {
      console.log("✅ Connection acknowledged:", sanitizeForLog(event.data));
      return;
    }

    // 錯誤事件
    if (event.type === RealtimeEventType.ERROR) {
      console.error("❌ Server error:", sanitizeForLog(event.data));
      return;
    }

    // 分發給訂閱者
    this.subscriptions.forEach((subscription) => {
      if (subscription.eventTypes.includes(event.type as RealtimeEventType)) {
        // 如果有過濾器，檢查是否通過
        if (!subscription.filter || subscription.filter(event)) {
          try {
            subscription.callback(event);
          } catch (error) {
            console.error("❌ Error in subscription callback:", error);
          }
        }
      }
    });
  }

  /**
   * 訂閱事件
   */
  subscribe(
    eventTypes: RealtimeEventType[],
    callback: (event: RealtimeEvent) => void,
    filter?: (event: RealtimeEvent) => boolean,
  ): string {
    const id = `sub_${++this.subscriptionCounter}`;
    this.subscriptions.set(id, {
      id,
      eventTypes,
      callback,
      filter,
    });
    return id;
  }

  /**
   * 取消訂閱
   */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * 發送訊息
   */
  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
    } else {
      console.warn("⚠️ WebSocket not connected, cannot send message");
    }
  }

  /**
   * 開始心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send("ping");

        // 設置心跳超時
        this.heartbeatTimeoutTimer = window.setTimeout(() => {
          console.warn("⚠️ Heartbeat timeout, closing connection");
          this.ws?.close(4000, "Heartbeat timeout");
        }, this.config.heartbeatTimeout);
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 重置心跳超時
   */
  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 安排重連
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error("❌ Max reconnect attempts reached");
      this.connectionStatus.value = "error";
      return;
    }

    this.connectionStatus.value = "reconnecting";
    this.reconnectAttempts++;

    // Exponential with jitter, so a fleet dropped together by a deploy does not
    // reconnect in lockstep: half the step is fixed, half is random.
    const step = Math.min(
      this.config.reconnectDelay * 2 ** (this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    const delay = Math.round(step / 2 + (Math.random() * step) / 2);

    console.log(
      `🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`,
    );

    this.reconnectTimer = window.setTimeout(() => {
      if (this.restaurantId) {
        this.connect(this.restaurantId);
      }
    }, delay);
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  /**
   * 斷開連接
   */
  disconnect(): void {
    this.stopHeartbeat();
    this.clearStableTimer();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.connectionStatus.value = "disconnected";
    this.reconnectAttempts = 0;
  }

  /**
   * 設置頁面可見性處理
   */
  private setupVisibilityHandlers(): void {
    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        this.connectionStatus.value === "disconnected" &&
        this.restaurantId
      ) {
        console.log("📱 Page visible, reconnecting...");
        this.connect(this.restaurantId);
      }
    });
  }

  /**
   * 設置網絡狀態處理
   */
  private setupNetworkHandlers(): void {
    window.addEventListener("online", () => {
      if (this.connectionStatus.value === "disconnected" && this.restaurantId) {
        console.log("🌐 Network online, reconnecting...");
        this.connect(this.restaurantId);
      }
    });

    window.addEventListener("offline", () => {
      console.log("🔌 Network offline, disconnecting...");
      this.disconnect();
    });
  }

  /**
   * 獲取連接狀態
   */
  get status() {
    return computed(() => this.connectionStatus.value);
  }

  /**
   * 是否已連接
   */
  get isConnected() {
    return computed(() => this.connectionStatus.value === "connected");
  }
}

// 單例模式
let instance: WebSocketService | null = null;

export function useWebSocketService(
  config?: WebSocketConfig,
): WebSocketService {
  if (!instance) {
    instance = new WebSocketService(config);
  }
  return instance;
}

export default WebSocketService;
