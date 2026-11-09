import type { Router } from "vue-router";

/**
 * Starts downloading a route's lazy chunks. vue-router swaps a record's
 * `() => import()` for the resolved component once it loads, so a function
 * means "not fetched yet". Failures are ignored: the real navigation retries
 * and goes through chunk recovery.
 */
export function prefetchRoute(router: Router, path: string): void {
  try {
    for (const record of router.resolve(path).matched) {
      for (const component of Object.values(record.components ?? {})) {
        if (typeof component === "function") {
          void (component as () => Promise<unknown>)().catch(() => {});
        }
      }
    }
  } catch {
    // unresolvable path: nothing to warm
  }
}

/** Warms every path while the browser is idle, unless the user opted out of data use. */
export function prefetchWhenIdle(router: Router, paths: string[]): void {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData || /2g$/.test(connection?.effectiveType ?? "")) {
    return;
  }
  const idle: (cb: () => void) => unknown =
    window.requestIdleCallback?.bind(window) ?? ((cb) => setTimeout(cb, 1500));
  paths.forEach((path) => idle(() => prefetchRoute(router, path)));
}
