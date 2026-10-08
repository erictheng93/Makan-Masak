import { watch, onUnmounted } from "vue";
import {
  RealtimeEventType,
  type RealtimeEvent,
} from "@makanmasak/shared-types";
import { apiClient } from "../services/api";
import { useWebSocket } from "./useWebSocket";

export function useMenuRealtime(
  restaurantId: () => string,
  refresh: () => Promise<unknown>,
): void {
  let token: { url: string; expiresAt: number } | undefined;
  let generation = 0;
  let disposed = false;
  let refreshing = false;
  let dirty = false;
  const refreshMenu = async () => {
    dirty = true;
    if (refreshing || disposed) return;
    refreshing = true;
    const current = generation;
    try {
      while (dirty && !disposed && current === generation) {
        dirty = false;
        try {
          await refresh();
        } catch (error) {
          console.warn("Failed to refresh menu:", error);
        }
      }
    } finally {
      if (current === generation) refreshing = false;
    }
  };
  const { connect, disconnect } = useWebSocket<RealtimeEvent>({
    getUrl: async () => {
      if (token && token.expiresAt > Date.now()) return token.url;
      const id = restaurantId();
      const current = generation;
      const issued = await apiClient.post<{ wsUrl: string; expiresIn: number }>(
        "/realtime/auth/menu-token",
        { restaurantId: id },
      );
      const base = import.meta.env.VITE_REALTIME_URL;
      const url = new URL(issued.wsUrl);
      if (base) {
        const configured = new URL(base);
        url.protocol = configured.protocol;
        url.host = configured.host;
      }
      if (!disposed && current === generation)
        token = {
          url: url.toString(),
          expiresAt: Date.now() + issued.expiresIn * 1000 - 5000,
        };
      return url.toString();
    },
    onAuthFailure: () => {
      token = undefined;
    },
    onOpen: () => {
      void refreshMenu();
    },
    onMessage: (event) => {
      if (
        event.type === RealtimeEventType.MENU_ITEM_UPDATE &&
        event.restaurantId === restaurantId()
      )
        void refreshMenu();
    },
  });
  watch(
    restaurantId,
    (id) => {
      ++generation;
      token = undefined;
      dirty = false;
      refreshing = false;
      disconnect();
      if (id && import.meta.env.VITE_REALTIME_URL) void connect();
    },
    { immediate: true },
  );
  onUnmounted(() => {
    disposed = true;
    ++generation;
    disconnect();
  });
}
