import { computed } from "vue";
import {
  RealtimeEventType,
  type RealtimeEvent,
} from "@makanmasak/shared-types";
import { useWebSocketService } from "./websocketService";

type RealtimeMessageFor<TEvent extends RealtimeEvent> = {
  id: string;
  type: TEvent["type"];
  data: TEvent["data"];
  timestamp: string;
  restaurantId?: string;
};

export type RealtimeMessage<TEvent extends RealtimeEvent = RealtimeEvent> =
  TEvent extends RealtimeEvent ? RealtimeMessageFor<TEvent> : never;

export interface RealtimeSubscription {
  id: string;
  types: string[];
  callback: (message: RealtimeMessage) => void;
  restaurantId?: string;
  websocketSubscriptionId: string;
}

export type RealtimeConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

function toRealtimeMessage<TEvent extends RealtimeEvent>(
  event: TEvent,
): RealtimeMessage<TEvent> {
  return {
    id: event.eventId,
    type: event.type,
    data: event.data,
    timestamp: new Date(event.timestamp).toISOString(),
    restaurantId: String(event.restaurantId),
  } as RealtimeMessage<TEvent>;
}

class RealtimeService {
  private websocketService = useWebSocketService();
  private subscriptions: Map<string, RealtimeSubscription> = new Map();
  private lastEventId: string | null = null;
  private messageBuffer: RealtimeMessage[] = [];
  private maxBufferSize = 100;
  private currentRestaurantId: string | null = null;
  private connectionStatus = computed<RealtimeConnectionStatus>(() => {
    const status = this.websocketService.status.value;
    if (status === "connected") return "connected";
    if (status === "connecting" || status === "reconnecting") {
      return "connecting";
    }
    if (status === "error") return "error";
    return "disconnected";
  });

  async connect(restaurantId?: string): Promise<void> {
    const targetRestaurantId = restaurantId ?? this.currentRestaurantId;
    if (!targetRestaurantId) {
      console.warn("Realtime WebSocket requires a restaurant ID");
      return;
    }

    this.currentRestaurantId = targetRestaurantId;
    await this.websocketService.connect(targetRestaurantId);
  }

  subscribe(
    types: string | string[],
    callback: (message: RealtimeMessage) => void,
    restaurantId?: string,
  ): string {
    const subscriptionTypes = Array.isArray(types) ? types : [types];
    const normalizedTypes = subscriptionTypes.filter(
      (type) => type !== "*",
    ) as RealtimeEventType[];
    const websocketTypes =
      normalizedTypes.length > 0
        ? normalizedTypes
        : (Object.values(RealtimeEventType) as RealtimeEventType[]);
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const websocketSubscriptionId = this.websocketService.subscribe(
      websocketTypes,
      (event) => {
        const message = toRealtimeMessage(event);
        this.handleMessage(message);
        callback(message);
      },
      (event) =>
        !restaurantId || String(event.restaurantId) === String(restaurantId),
    );

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      types: subscriptionTypes,
      callback,
      restaurantId,
      websocketSubscriptionId,
    });

    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    this.websocketService.unsubscribe(subscription.websocketSubscriptionId);
    return this.subscriptions.delete(subscriptionId);
  }

  disconnect(): void {
    for (const subscription of this.subscriptions.values()) {
      this.websocketService.unsubscribe(subscription.websocketSubscriptionId);
    }
    this.subscriptions.clear();
    this.websocketService.disconnect();
  }

  reconnect(): void {
    const restaurantId = this.currentRestaurantId;
    this.websocketService.disconnect();
    if (restaurantId) {
      void this.websocketService.connect(restaurantId);
    }
  }

  async ping(): Promise<boolean> {
    if (this.websocketService.isConnected.value) {
      this.websocketService.send("ping");
      return true;
    }
    return false;
  }

  async getServerTime(): Promise<Date> {
    return new Date();
  }

  getConnectionStatus() {
    return this.connectionStatus;
  }

  getMessageBuffer(): RealtimeMessage[] {
    return [...this.messageBuffer];
  }

  getMessageLatency(): number {
    const lastMessage = this.messageBuffer[this.messageBuffer.length - 1];
    if (!lastMessage) return 0;

    const messageTime = new Date(lastMessage.timestamp).getTime();
    return Math.max(0, Date.now() - messageTime);
  }

  getConnectionStats() {
    return {
      status: this.connectionStatus.value,
      totalMessages: this.messageBuffer.length,
      subscriptions: this.subscriptions.size,
      lastEventId: this.lastEventId,
      reconnectAttempts: 0,
      latency: this.getMessageLatency(),
    };
  }

  cleanup(): void {
    this.disconnect();
    this.messageBuffer = [];
  }

  private handleMessage(message: RealtimeMessage): void {
    this.lastEventId = message.id;
    this.messageBuffer.push(message);
    if (this.messageBuffer.length > this.maxBufferSize) {
      this.messageBuffer.shift();
    }
  }
}

export const realtimeService = new RealtimeService();

export function useRealtime() {
  return {
    connectionStatus: realtimeService.getConnectionStatus(),
    connect: (restaurantId?: string) => realtimeService.connect(restaurantId),
    disconnect: () => realtimeService.disconnect(),
    subscribe: (
      types: string | string[],
      callback: (message: RealtimeMessage) => void,
      restaurantId?: string,
    ) => realtimeService.subscribe(types, callback, restaurantId),
    unsubscribe: (subscriptionId: string) =>
      realtimeService.unsubscribe(subscriptionId),
    reconnect: () => realtimeService.reconnect(),
    ping: () => realtimeService.ping(),
    getMessageBuffer: () => realtimeService.getMessageBuffer(),
  };
}

export default realtimeService;
