// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVisibilityAwarePoller } from "./visibilityAwarePoller";

/** document.hidden has no setter, so it has to be redefined. */
function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("createVisibilityAwarePoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setTabHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks on the interval while the tab is visible", () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    expect(onTick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(onTick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(4);

    poller.stop();
  });

  // The whole point: a hidden tab has no viewer, but the browser keeps the
  // interval alive, so every one of these ticks would have been paid for.
  it("skips every tick while the tab is hidden", () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    setTabHidden(true);
    onTick.mockClear();

    vi.advanceTimersByTime(10_000);

    expect(onTick).not.toHaveBeenCalled();

    poller.stop();
  });

  it("catches up once when the tab returns", () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    setTabHidden(true);
    vi.advanceTimersByTime(10_000);
    expect(onTick).not.toHaveBeenCalled();

    setTabHidden(false);

    // One catch-up, not one per interval that was skipped.
    expect(onTick).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it("honours shouldCatchUp so a brief tab switch costs nothing", () => {
    const onTick = vi.fn();
    const shouldCatchUp = vi.fn(() => false);
    const poller = createVisibilityAwarePoller({
      intervalMs: 1000,
      onTick,
      shouldCatchUp,
    });

    poller.start();
    setTabHidden(true);
    setTabHidden(false);

    expect(shouldCatchUp).toHaveBeenCalled();
    expect(onTick).not.toHaveBeenCalled();

    poller.stop();
  });

  it("does not catch up when the tab goes to the background", () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    setTabHidden(true);

    expect(onTick).not.toHaveBeenCalled();

    poller.stop();
  });

  it("stops ticking and stops listening once stopped", () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    poller.stop();

    vi.advanceTimersByTime(10_000);
    setTabHidden(true);
    setTabHidden(false);

    expect(onTick).not.toHaveBeenCalled();
    expect(poller.isRunning).toBe(false);
  });

  // Guards the double-connect path: the alert poller calls start() again on
  // reconnect, and a second interval would silently double the request rate.
  it("ignores a second start instead of running two intervals", () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    poller.start();

    vi.advanceTimersByTime(1000);

    expect(onTick).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it("applies the hidden-tab rule to a manual tick too", () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    setTabHidden(true);
    poller.tick();
    expect(onTick).not.toHaveBeenCalled();

    setTabHidden(false);
    onTick.mockClear();
    poller.tick();
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("drops to the live interval while something else keeps the data current", () => {
    const onTick = vi.fn();
    let live = true;
    const poller = createVisibilityAwarePoller({
      intervalMs: 1000,
      liveIntervalMs: 10_000,
      isLive: () => live,
      onTick,
    });

    poller.start();
    vi.advanceTimersByTime(9000);
    expect(onTick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);

    // Socket drops: back to every tick.
    live = false;
    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(3);

    poller.stop();
  });
});
