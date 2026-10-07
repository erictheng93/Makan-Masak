import { computed, ref } from "vue";
import {
  RealtimeEventType,
  type RealtimeAuthTokenResponse,
  type RealtimeEvent,
} from "@makanmasak/shared-types";
import { apiClient } from "@/services/authApi";

export type KitchenRealtimeConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

// A connection has to stay up this long before the retry budget is restored.
// Resetting on open let "connect, drop at once" loop forever, re-minting a
// token and waking the room's Durable Object on every lap.
const STABLE_CONNECTION_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface KitchenRealtimeSubscription {
  id: string;
  eventTypes: RealtimeEventType[];
  callback: (event: RealtimeEvent) => void;
}

class KitchenRealtimeService {
  private ws: WebSocket | null = null;
  private statusValue = ref<KitchenRealtimeConnectionStatus>("disconnected");
  private subscriptions = new Map<string, KitchenRealtimeSubscription>();
  private subscriptionCounter = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private restaurantId: string | null = null;

  get status() {
    return computed(() => this.statusValue.value);
  }

  get isConnected() {
    return computed(() => this.statusValue.value === "connected");
  }

  async connect(restaurantId: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.statusValue.value === "connecting") return;

    this.restaurantId = restaurantId;
    this.statusValue.value = "connecting";

    try {
      const auth = await this.getWebSocketToken(restaurantId);
      this.ws = new WebSocket(auth.wsUrl);
      this.ws.onopen = () => {
        this.statusValue.value = "connected";
        this.clearStableTimer();
        this.stableTimer = setTimeout(() => {
          this.reconnectAttempts = 0;
          this.stableTimer = null;
        }, STABLE_CONNECTION_MS);
      };
      this.ws.onmessage = (message) => {
        try {
          this.handleMessage(JSON.parse(message.data) as RealtimeEvent);
        } catch (error) {
          console.error("Failed to parse kitchen realtime message:", error);
        }
      };
      this.ws.onerror = (error) => {
        console.error("Kitchen realtime WebSocket error:", error);
        this.statusValue.value = "error";
      };
      this.ws.onclose = (event) => {
        this.ws = null;
        this.statusValue.value = "disconnected";
        this.clearStableTimer();
        if (event.code !== 1000 && event.code !== 1001) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error("Failed to connect kitchen realtime WebSocket:", error);
      this.statusValue.value = "error";
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.clearStableTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000, "Kitchen display disconnect");
    this.ws = null;
    this.statusValue.value = "disconnected";
    this.reconnectAttempts = 0;
  }

  subscribe(
    eventTypes: RealtimeEventType[],
    callback: (event: RealtimeEvent) => void,
  ): string {
    const id = `kitchen_sub_${++this.subscriptionCounter}`;
    this.subscriptions.set(id, { id, eventTypes, callback });
    return id;
  }

  unsubscribe(id: string): void {
    this.subscriptions.delete(id);
  }

  private async getWebSocketToken(
    restaurantId: string,
  ): Promise<RealtimeAuthTokenResponse> {
    const sessionId = apiClient.tokens.getToken();
    if (!sessionId) {
      throw new Error("No kitchen session token found");
    }

    const response = await apiClient.instance.post<{
      success?: boolean;
      data?: RealtimeAuthTokenResponse;
    }>("/realtime/auth/token", {
      roomType: "kitchen",
      roomId: restaurantId,
      restaurantId,
      sessionId,
    });

    const tokenResponse = response.data?.data;
    if (!tokenResponse?.token || !tokenResponse.wsUrl) {
      throw new Error("Realtime auth response missing token or wsUrl");
    }
    return tokenResponse;
  }

  private handleMessage(event: RealtimeEvent): void {
    if (
      event.type === RealtimeEventType.HEARTBEAT ||
      event.type === RealtimeEventType.CONNECTION_ACK ||
      event.type === RealtimeEventType.ERROR
    ) {
      return;
    }

    this.subscriptions.forEach((subscription) => {
      if (subscription.eventTypes.includes(event.type as RealtimeEventType)) {
        subscription.callback(event);
      }
    });
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (
      !this.restaurantId ||
      this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS
    ) {
      this.statusValue.value = "error";
      return;
    }

    this.statusValue.value = "reconnecting";
    this.reconnectAttempts += 1;
    // Exponential with jitter, so every kitchen screen dropped by one deploy
    // does not reconnect in lockstep: half the step is fixed, half is random.
    const step = Math.min(
      RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    const delay = Math.round(step / 2 + (Math.random() * step) / 2);
    this.reconnectTimer = setTimeout(() => {
      if (this.restaurantId) void this.connect(this.restaurantId);
    }, delay);
  }
}

export { KitchenRealtimeService };

let instance: KitchenRealtimeService | null = null;

export function useKitchenRealtimeService() {
  if (!instance) {
    instance = new KitchenRealtimeService();
  }
  return instance;
}
