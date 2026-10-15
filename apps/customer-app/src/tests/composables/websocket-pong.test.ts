import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { useWebSocket } from "@/composables/useWebSocket";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;

  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
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

describe("customer WebSocket raw pong handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("crypto", { randomUUID: () => "subscriber-1" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ignores raw pong in useWebSocket", async () => {
    const onMessage = vi.fn();
    // useWebSocket registers onUnmounted, so it has to run inside setup().
    let socket!: ReturnType<typeof useWebSocket>;
    mount(
      defineComponent({
        setup() {
          socket = useWebSocket({ url: "ws://localhost/customer", onMessage });
          return () => null;
        },
      }),
    );

    await socket.connect();
    const ws = MockWebSocket.instances[0];
    ws.onmessage?.({ data: "pong" } as MessageEvent);

    expect(onMessage).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
