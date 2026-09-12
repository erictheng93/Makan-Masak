/**
 * Request headers a browser may send to this API from another origin.
 *
 * Every custom header a frontend attaches has to be on this list. A header
 * that is missing does not produce a 4xx the page can read: the browser's
 * preflight refuses it, the request is never sent, and axios reports
 * "Network Error". That is how every POS checkout failed in production once
 * CashierView started sending Idempotency-Key — the admin E2E runs behind
 * vite's same-origin proxy, so it never preflights.
 *
 * `tests/unit/cors-request-headers.test.ts` scans the frontends for header
 * names and fails when one is not listed here. This module has no imports so
 * that test can load it without the Worker runtime.
 */
export const CORS_ALLOWED_REQUEST_HEADERS: readonly string[] = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "X-CSRF-Token",
  "X-Client-Version",
  "X-Client-Platform",
  "X-Request-ID",
  "X-Restaurant-ID",
  "X-Table-ID",
  "X-Guest-Device-Id",
  "X-Guest-Token",
  // POST /payments refuses a request without one (#310).
  "Idempotency-Key",
  // CashierView names the till on refunds and receipts.
  "X-Register-Id",
  "X-Shift-Id",
];
