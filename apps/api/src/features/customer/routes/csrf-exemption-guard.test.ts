import { describe, expect, it } from "vitest";
import routes from "./index";
import { canonicalCustomerAuthMiddleware } from "../../../middleware/auth";

/**
 * app-factory exempts all of /api/v1/customer from CSRF. That is only safe
 * because nothing here authenticates a write by an ambient credential: every
 * write either requires a bearer token (canonicalCustomerAuthMiddleware), which
 * a browser never attaches cross-site, or is one of the sign-in flows below,
 * which authorize by possession of a password, code, OAuth state or the
 * refresh cookie.
 *
 * A new write route must therefore either take the bearer middleware or be
 * added to this list deliberately. A cookie-authenticated write added without
 * either would be silently unprotected; this test is what makes it loud.
 */
const PUBLIC_WRITE_ROUTES = [
  "POST /auth/request-otp",
  "POST /auth/register",
  "POST /auth/login",
  "POST /auth/forgot-password",
  "POST /auth/reset-password",
  "POST /auth/verify-email",
  "POST /auth/resend-verification",
  "POST /auth/verify-otp",
  "POST /auth/refresh",
  "POST /auth/oauth/:provider/callback",
  "POST /auth/oauth/complete",
];

function writeRoutesWithoutBearer(): string[] {
  const bearer = new Map<string, boolean>();
  for (const route of routes.routes) {
    if (route.method === "GET") continue;
    const key = `${route.method} ${route.path}`;
    bearer.set(
      key,
      (bearer.get(key) ?? false) ||
        route.handler === canonicalCustomerAuthMiddleware,
    );
  }
  return [...bearer].filter(([, hasBearer]) => !hasBearer).map(([key]) => key);
}

describe("customer router CSRF exemption guard", () => {
  it("has no write route outside the reviewed sign-in flows that skips bearer auth", () => {
    expect(writeRoutesWithoutBearer().sort()).toEqual(
      [...PUBLIC_WRITE_ROUTES].sort(),
    );
  });

  it("finds the bearer middleware at all (guards the guard)", () => {
    // If the middleware reference ever stopped matching, every route would
    // look public and the first test would fail on the full list rather than
    // pass silently — but say so plainly.
    expect(writeRoutesWithoutBearer()).not.toContain("POST /favorites");
  });
});
