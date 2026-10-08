import { afterEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import { useWebSocket } from "./useWebSocket";

class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: (event: Event) => void;
  onclose?: (event: CloseEvent) => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: Event) => void;
  close = vi.fn();
  send = vi.fn();
  constructor(public url: string) {
    Socket.instances.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Socket.instances = [];
});
function setup(
  getUrl: () => Promise<string>,
  onAuthFailure?: () => Promise<void>,
) {
  vi.stubGlobal("WebSocket", Socket);
  let api!: ReturnType<typeof useWebSocket>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useWebSocket({ getUrl, onAuthFailure });
        return () => null;
      },
    }),
  );
  return { wrapper, api };
}
describe("socket lifecycle", () => {
  it("does not create a socket when a pending URL resolves after unmount", async () => {
    let resolve!: (url: string) => void;
    const { wrapper, api } = setup(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = api.connect();
    wrapper.unmount();
    resolve("ws://late");
    await pending;
    expect(Socket.instances).toHaveLength(0);
  });
  it("does not reconnect if auth renewal finishes after unmount", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const renew = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { wrapper, api } = setup(async () => "ws://menu?token=test", renew);
    await api.connect();
    Socket.instances[0].onclose?.({
      wasClean: false,
      code: 4001,
    } as CloseEvent);
    await vi.advanceTimersByTimeAsync(3000);
    expect(renew).toHaveBeenCalledOnce();
    wrapper.unmount();
    finish();
    await flushPromises();
    expect(Socket.instances).toHaveLength(1);
  });
  it("ignores old socket close and messages after reconnecting", async () => {
    vi.useFakeTimers();
    const { wrapper, api } = setup(async () => "ws://menu");
    await api.connect();
    const old = Socket.instances[0];
    await api.reconnect();
    const current = Socket.instances[1];
    current.readyState = 1;
    current.onopen?.(new Event("open"));
    old.onclose?.({ wasClean: false, code: 1006 } as CloseEvent);
    await flushPromises();
    expect(api.isConnected.value).toBe(true);
    expect(api.reconnectCount.value).toBe(0);
    wrapper.unmount();
  });
});
