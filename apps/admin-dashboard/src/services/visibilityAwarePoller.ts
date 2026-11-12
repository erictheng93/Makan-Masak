/**
 * A polling loop that does not run while its tab is in the background.
 *
 * Browsers throttle setInterval in a hidden tab but never stop it, so a
 * dashboard left open overnight keeps paying for requests nobody can see. This
 * skips those ticks and catches up when the tab returns, which is the part that
 * makes skipping safe: without it the operator comes back to stale panels and
 * has to wait out the remainder of an interval.
 *
 * Both the monitoring panel refresh and the alert poll need exactly this, and
 * they used to implement it separately.
 */
export interface VisibilityAwarePollerOptions {
  /** Milliseconds between ticks while the tab is visible. */
  intervalMs: number;
  /** Runs on each tick, and on return to the foreground when stale. */
  onTick: () => void | Promise<void>;
  /**
   * Whether returning to the foreground should trigger an immediate tick.
   * Defaults to always. The panel refresh passes a staleness check so that
   * flicking between tabs does not spend a request.
   */
  shouldCatchUp?: () => boolean;
  /**
   * Whether something else (a connected realtime socket) is keeping the data
   * current. While it returns true, ticks run every `liveIntervalMs` instead,
   * as a safety net rather than the source of truth.
   */
  isLive?: () => boolean;
  /** Defaults to 5 minutes. */
  liveIntervalMs?: number;
}

export interface VisibilityAwarePoller {
  /** Idempotent: starting an already-running poller does nothing. */
  start(): void;
  stop(): void;
  /** Runs a tick now, subject to the same hidden-tab rule. */
  tick(): void;
  readonly isRunning: boolean;
}

export function createVisibilityAwarePoller(
  options: VisibilityAwarePollerOptions,
): VisibilityAwarePoller {
  const {
    intervalMs,
    onTick,
    shouldCatchUp,
    isLive,
    liveIntervalMs = 5 * 60_000,
  } = options;

  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTickAt = Date.now();

  const runTick = () => {
    if (document.hidden) return;
    if (isLive?.() && Date.now() - lastTickAt < liveIntervalMs) return;
    lastTickAt = Date.now();
    void onTick();
  };

  const handleVisibilityChange = () => {
    if (document.hidden) return;
    if (shouldCatchUp && !shouldCatchUp()) return;
    lastTickAt = Date.now();
    void onTick();
  };

  return {
    get isRunning() {
      return timer !== null;
    },

    start() {
      if (timer !== null) return;
      timer = setInterval(runTick, intervalMs);
      document.addEventListener("visibilitychange", handleVisibilityChange);
    },

    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    },

    tick: runTick,
  };
}
