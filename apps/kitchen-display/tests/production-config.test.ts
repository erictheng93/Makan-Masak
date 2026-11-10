import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(__dirname, "..");

describe("kitchen-display production config", () => {
  it("serves a restrictive Cloudflare Pages security policy", () => {
    const headers = readFileSync(resolve(appRoot, "public/_headers"), "utf-8");

    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("object-src 'none'");
    expect(headers).toContain("base-uri 'self'");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).not.toContain("'unsafe-eval'");
    expect(headers).not.toContain("http://localhost");
    expect(headers).not.toContain("ws://localhost");
  });

  it("does not ship a looser CSP meta tag in the HTML template", () => {
    const html = readFileSync(resolve(appRoot, "index.html"), "utf-8");

    expect(html).not.toMatch(/http-equiv=["']Content-Security-Policy["']/i);
  });

  it("builds the deploy artifact from a clean tree before direct Pages deploys", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(appRoot, "package.json"), "utf-8"),
    ) as { scripts?: Record<string, string> };

    // Refuse a dirty tree first (Codex edits the main checkout live), then
    // always build, so the uploaded dist is this commit and nothing else.
    expect(pkg.scripts?.["deploy:prod"]).toMatch(
      /^node \.\.\/\.\.\/scripts\/require-clean-build\.cjs && pnpm run build && wrangler pages deploy /,
    );
  });
});
