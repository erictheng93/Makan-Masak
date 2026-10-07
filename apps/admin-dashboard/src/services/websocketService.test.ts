// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocketService from "./websocketService";

const apiPost = vi.hoisted(() => vi.fn());

vi.mock("@/services/api", () => ({
  api: {
    post: apiPost,
  },
}));

vi.mock("@/utils/authTokenProvider", () => ({
  getAuthToken: vi.fn(() => "session-token"),
}));

// 房間型別由登入角色決定，所以取 token 時會讀 auth store。這裡沿用本檔既有的
// 模組 mock 作風，避免為了一個角色值把 pinia 拉進 service 的單元測試。
const currentUserRole = vi.hoisted(() => ({ value: 0 as number | undefined }));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ userRole: currentUserRole.value }),
}));

vi.mock("@/utils/sanitize", () => ({
  sanitizeForLog: (value: unknown) => value,
}));

class MockWebSocket {
  static OPEN = 1;

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn();
  send = vi.fn();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];
}

describe("WebSocketService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    currentUserRole.value = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    apiPost.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        data: {
          token: "ws-token",
          wsUrl: "ws://localhost:8788/admin/restaurant-1?token=ws-token",
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 伺服器端只讓 role 0/1 進 admin 房間（該房間會廣播帶顧客姓名的候位事件），
  // 所以廚師/送菜員/收銀員要求 admin 會被擋成 400，接著重連到上限、即時更新全失效。
  it.each([
    [0, "admin"],
    [1, "admin"],
    [2, "kitchen"],
    [3, "kitchen"],
    [4, "kitchen"],
  ])(
    "requests the room type role %i is allowed into",
    async (role, roomType) => {
      currentUserRole.value = role;

      await new WebSocketService().connect("restaurant-1");

      expect(apiPost).toHaveBeenCalledWith(
        "/realtime/auth/token",
        expect.objectContaining({ roomType, restaurantId: "restaurant-1" }),
        expect.anything(),
      );
    },
  );

  it("closes heartbeat timeouts with a reconnectable close code", async () => {
    const service = new WebSocketService({
      heartbeatInterval: 1_000,
      heartbeatTimeout: 500,
    });

    await service.connect("restaurant-1");
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(500);

    expect(ws.close).toHaveBeenCalledWith(4000, "Heartbeat timeout");
  });

  it("clears heartbeat timeouts when the runtime returns raw pong", async () => {
    const service = new WebSocketService({
      heartbeatInterval: 1_000,
      heartbeatTimeout: 500,
    });

    await service.connect("restaurant-1");
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    vi.advanceTimersByTime(1_000);
    ws.onmessage?.({ data: "pong" } as MessageEvent);
    vi.advanceTimersByTime(500);

    expect(ws.close).not.toHaveBeenCalled();
  });

  it("does not restore the retry budget for connections that drop at once", async () => {
    const service = new WebSocketService({ maxReconnectAttempts: 2 });

    await service.connect("restaurant-1");
    for (let round = 0; round < 3; round++) {
      const ws = MockWebSocket.instances.at(-1)!;
      ws.onopen?.();
      ws.readyState = 3; // CLOSED, as the browser sets it before onclose
      ws.onclose?.({ code: 1006, reason: "" } as CloseEvent);
      await vi.runOnlyPendingTimersAsync();
    }

    // Initial connect plus the two allowed retries, then it gives up.
    expect(apiPost).toHaveBeenCalledTimes(3);
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(service.status.value).toBe("error");
  });

  it("restores the retry budget once a connection has stayed up", async () => {
    const service = new WebSocketService({ maxReconnectAttempts: 1 });

    await service.connect("restaurant-1");
    for (let round = 0; round < 3; round++) {
      const ws = MockWebSocket.instances.at(-1)!;
      ws.onopen?.();
      vi.advanceTimersByTime(30_000);
      ws.onmessage?.({ data: "pong" } as MessageEvent);
      ws.readyState = 3; // CLOSED, as the browser sets it before onclose
      ws.onclose?.({ code: 1006, reason: "" } as CloseEvent);
      await vi.runOnlyPendingTimersAsync();
    }

    expect(apiPost).toHaveBeenCalledTimes(4);
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it("backs off exponentially with jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const service = new WebSocketService({
      reconnectDelay: 1_000,
      maxReconnectAttempts: 3,
    });

    await service.connect("restaurant-1");
    for (let round = 0; round < 3; round++) {
      const ws = MockWebSocket.instances.at(-1)!;
      ws.readyState = 3; // CLOSED, as the browser sets it before onclose
      ws.onclose?.({ code: 1006, reason: "" } as CloseEvent);
      await vi.runOnlyPendingTimersAsync();
    }

    const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
  });
});
