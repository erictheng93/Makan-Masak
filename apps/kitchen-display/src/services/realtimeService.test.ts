import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());

vi.mock("@/services/authApi", () => ({
  apiClient: {
    tokens: { getToken: () => "session-token" },
    instance: { post },
  },
}));

import { KitchenRealtimeService } from "./realtimeService";

class MockWebSocket {
  static OPEN = 1;

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" } as CloseEvent);
  }

  static instances: MockWebSocket[] = [];
}

describe("KitchenRealtimeService reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    post.mockReset();
    post.mockResolvedValue({
      data: { data: { token: "ws-token", wsUrl: "ws://localhost/kitchen/r1" } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not restore the retry budget for connections that drop at once", async () => {
    const service = new KitchenRealtimeService();

    await service.connect("r1");
    for (let round = 0; round < 6; round++) {
      const ws = MockWebSocket.instances.at(-1)!;
      ws.open();
      ws.drop();
      await vi.runOnlyPendingTimersAsync();
    }

    // Initial connect plus the five allowed retries, then it gives up.
    expect(post).toHaveBeenCalledTimes(6);
    expect(service.status.value).toBe("error");
  });

  it("restores the retry budget once a connection has stayed up", async () => {
    const service = new KitchenRealtimeService();

    await service.connect("r1");
    for (let round = 0; round < 7; round++) {
      const ws = MockWebSocket.instances.at(-1)!;
      ws.open();
      vi.advanceTimersByTime(30_000);
      ws.drop();
      await vi.runOnlyPendingTimersAsync();
    }

    expect(post).toHaveBeenCalledTimes(8);
  });

  it("backs off exponentially with jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const service = new KitchenRealtimeService();

    await service.connect("r1");
    for (let round = 0; round < 3; round++) {
      MockWebSocket.instances.at(-1)!.drop();
      await vi.runOnlyPendingTimersAsync();
    }

    // random() = 0 is the low edge of the jitter: half of each 3s/6s/12s step.
    const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms);
    expect(delays).toEqual([1_500, 3_000, 6_000]);
  });
});
