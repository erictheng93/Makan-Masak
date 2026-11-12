/**
 * Federated identity provider registry.
 *
 * Every provider here uses Authorization Code + PKCE(S256) + state, and every
 * one of them is verified the same way: the `id_token` is checked against the
 * provider's JWKS before its `sub` is trusted. Receiving a token over HTTPS
 * from the token endpoint is not a substitute for verifying it — Apple in
 * particular carries the only copy of the user's name and email inside that
 * token, and it is the only place the audience binding can be checked.
 *
 * Client ids are not secret and live in `[vars]`. Client secrets are read from
 * `wrangler secret` only. Apple is the exception to "secret is a string": its
 * client secret is an ES256 JWT that has to be signed per use, so it is
 * produced by `resolveClientSecret` rather than read directly.
 */

import type { CustomerOAuthProvider } from "@makanmasak/shared-types";
import type { Env } from "../../types/env";

export interface OAuthProviderConfig {
  readonly provider: CustomerOAuthProvider;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly jwksUrl: string;
  readonly issuers: readonly string[];
  readonly scope: string;
  /** Apple posts its callback back as a form; the others use a redirect GET. */
  readonly callbackMethod: "GET" | "POST";
  /** Extra params the provider requires on the authorize URL. */
  readonly extraAuthorizeParams?: Readonly<Record<string, string>>;
}

export const OAUTH_PROVIDERS: Readonly<
  Record<CustomerOAuthProvider, OAuthProviderConfig>
> = {
  line: {
    provider: "line",
    authorizeUrl: "https://access.line.me/oauth2/v2.1/authorize",
    tokenUrl: "https://api.line.me/oauth2/v2.1/token",
    jwksUrl: "https://api.line.me/oauth2/v2.1/certs",
    issuers: ["https://access.line.me"],
    scope: "openid profile email",
    callbackMethod: "GET",
  },
  google: {
    provider: "google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    scope: "openid profile email",
    callbackMethod: "GET",
  },
  apple: {
    provider: "apple",
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    scope: "name email",
    // Apple only returns name/email on the very first authorization, and only
    // when the response is form-posted back to the server.
    callbackMethod: "POST",
    extraAuthorizeParams: { response_mode: "form_post" },
  },
};

export interface OAuthEnvSlice {
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_SIGN_IN_PRIVATE_KEY?: string;
}

export type OAuthEnv = Env & OAuthEnvSlice;

export function getClientId(
  env: OAuthEnv,
  provider: CustomerOAuthProvider,
): string | undefined {
  switch (provider) {
    case "line":
      return env.LINE_LOGIN_CHANNEL_ID?.trim() || undefined;
    case "google":
      return env.GOOGLE_OAUTH_CLIENT_ID?.trim() || undefined;
    case "apple":
      return env.APPLE_CLIENT_ID?.trim() || undefined;
  }
}

/**
 * Whether this deployment can actually run a flow for `provider`.
 *
 * Configuration is checked before anything is written or redirected, so an
 * unconfigured provider answers a clean 503 instead of bouncing the customer to
 * a provider that will reject the request. This mirrors how the SMS channel
 * refuses up front rather than reporting a success nobody receives.
 */
export function isProviderConfigured(
  env: OAuthEnv,
  provider: CustomerOAuthProvider,
): boolean {
  if (!getClientId(env, provider)) return false;

  switch (provider) {
    case "line":
      return Boolean(env.LINE_LOGIN_CHANNEL_SECRET?.trim());
    case "google":
      return Boolean(env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
    case "apple":
      return Boolean(
        env.APPLE_TEAM_ID?.trim() &&
        env.APPLE_KEY_ID?.trim() &&
        env.APPLE_SIGN_IN_PRIVATE_KEY?.trim(),
      );
  }
}

export function configuredProviders(env: OAuthEnv): CustomerOAuthProvider[] {
  return (Object.keys(OAUTH_PROVIDERS) as CustomerOAuthProvider[]).filter(
    (provider) => isProviderConfigured(env, provider),
  );
}

/**
 * The redirect URI registered with the provider. It has to match byte for byte
 * on both the authorize and the token request, so it is derived in one place
 * from `API_BASE_URL` rather than rebuilt from the incoming request — a request
 * behind a proxy can carry a host the provider never saw.
 */
export function buildRedirectUri(
  env: OAuthEnv,
  provider: CustomerOAuthProvider,
  audience: "customer" | "staff" = "customer",
): string {
  const base = (env.API_BASE_URL?.trim() || "http://localhost:8787").replace(
    /\/+$/,
    "",
  );
  const prefix = audience === "staff" ? "/api/v1" : "/api/v1/customer";
  return `${base}${prefix}/auth/oauth/${provider}/callback`;
}
