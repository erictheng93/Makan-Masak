import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "@/composables/useWebSocket";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn();
  send = vi.fn();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  drop() {
    this.readyState = 3; // CLOSED, as the browser sets it before onclose
    this.onclose?.({ code: 1006, wasClean: false } as CloseEvent);
  }

  static instances: MockWebSocket[] = [];
}

function buildSocket(reconnectAttempts: number) {
  const getUrl = vi.fn(async () => "ws://localhost/customer?token=t");
  const onAuthFailure = vi.fn();
  const socket = useWebSocket({
    getUrl,
    onAuthFailure,
    reconnectAttempts,
    reconnectInterval: 1_000,
  });
  return { socket, getUrl, onAuthFailure };
}

describe("customer WebSocket reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not restore the retry budget for connections that drop at once", async () => {
    const { socket, onAuthFailure } = buildSocket(2);

    await socket.connect();
    for (let round = 0; round < 3; round++) {
      const ws = MockWebSocket.instances.at(-1)!;
      ws.open();
      ws.drop();
      await vi.runOnlyPendingTimersAsync();
    }

    // Initial connect plus the two allowed retries, then it gives up.
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(onAuthFailure).toHaveBeenCalledTimes(2);
    expect(socket.connectionStatus.value).toBe("error");
  });

  it("restores the retry budget once a connection has stayed up", async () => {
    const { socket } = buildSocket(1);

    await socket.connect();
    for (let round = 0; round < 3; round++) {
      const ws = MockWebSocket.instances.at(-1)!;
      ws.open();
      vi.advanceTimersByTime(30_000);
      ws.drop();
      await vi.runOnlyPendingTimersAsync();
    }

    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it("backs off exponentially with jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { socket } = buildSocket(3);

    await socket.connect();
    for (let round = 0; round < 3; round++) {
      MockWebSocket.instances.at(-1)!.drop();
      await vi.runOnlyPendingTimersAsync();
    }

    // random() = 0 is the low edge of the jitter: half of each 1s/2s/4s step.
    const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms);
    expect(delays).toEqual([500, 1_000, 2_000]);
  });
});
