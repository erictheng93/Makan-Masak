import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CORS_ALLOWED_REQUEST_HEADERS } from "../../apps/api/src/middleware/cors-headers";

/**
 * A custom request header that the API's CORS policy does not list is refused
 * in the browser's preflight: the request is never sent, and the page sees
 * only "Network Error". Unit tests call handlers directly and the admin E2E
 * runs behind vite's same-origin proxy, so neither ever preflights. That is how
 * CashierView's Idempotency-Key (#310) broke every POS checkout in production
 * while CI stayed green.
 *
 * This reads the frontends that call apps/api and requires every header name
 * they set to be on CORS_ALLOWED_REQUEST_HEADERS. management-portal and
 * onboarding-app are left out on purpose: they call apps/management-api, which
 * keeps its own list.
 */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const SOURCE_ROOTS = [
  "apps/admin-dashboard/src",
  "apps/customer-app/src",
  "apps/kitchen-display/src",
  "packages/auth-client/src",
  "packages/shared/src",
  "packages/shared/utils",
];

// `"X-Guest-Token": token` inside a headers object, or `headers["X-Request-ID"] =`.
const HEADER_NAME = /["'](X-[A-Za-z0-9-]+|Idempotency-Key)["']\s*[:\]]/g;

function sourceFiles(root: string): string[] {
  const dir = join(repoRoot, root);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((file) => /\.(ts|vue)$/.test(file))
    .filter((file) => !/(\.test\.|\.spec\.|__tests__|node_modules)/.test(file))
    .map((file) => join(dir, file));
}

describe("CORS request headers", () => {
  it("allows every custom header the API's browser clients send", () => {
    const allowed = new Set(
      CORS_ALLOWED_REQUEST_HEADERS.map((header) => header.toLowerCase()),
    );
    const sent = new Map<string, string>();

    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(root)) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            for (const match of line.matchAll(HEADER_NAME)) {
              const name = match[1].toLowerCase();
              if (!sent.has(name)) {
                sent.set(
                  name,
                  `${match[1]} (${relative(repoRoot, file)}:${index + 1})`,
                );
              }
            }
          });
      }
    }

    // A scanner that matched nothing would pass without checking anything.
    expect(sent.has("idempotency-key")).toBe(true);
    expect(sent.has("x-guest-token")).toBe(true);

    const missing = [...sent]
      .filter(([name]) => !allowed.has(name))
      .map(([, where]) => where);
    expect(missing).toEqual([]);
  });
});
