/**
 * Authorization-code exchange.
 *
 * Only the `id_token` is kept. We need identity, not delegated access, so no
 * access or refresh token is stored anywhere — there is nothing to rotate and
 * nothing to leak. `token_expires_at_ms` records when the provider's access
 * token would have expired, purely so an operator can reason about staleness.
 */

import type { CustomerOAuthProvider } from "@makanmasak/shared-types";
import {
  buildRedirectUri,
  getClientId,
  OAUTH_PROVIDERS,
  type OAuthEnv,
} from "./providers";
import { getAppleClientSecret } from "./appleClientSecret";

export class TokenExchangeError extends Error {
  constructor(
    message: string,
    readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "TokenExchangeError";
  }
}

export interface TokenExchangeResult {
  idToken: string;
  /** Seconds until the provider's access token expires, when it says. */
  expiresIn?: number;
  scope?: string;
}

async function resolveClientSecret(
  env: OAuthEnv,
  provider: CustomerOAuthProvider,
  cache: KVNamespace | undefined,
): Promise<string> {
  switch (provider) {
    case "line": {
      const secret = env.LINE_LOGIN_CHANNEL_SECRET?.trim();
      if (!secret) throw new TokenExchangeError("LINE channel secret missing");
      return secret;
    }
    case "google": {
      const secret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
      if (!secret) throw new TokenExchangeError("Google client secret missing");
      return secret;
    }
    case "apple":
      return getAppleClientSecret({ env, cache });
  }
}

export interface ExchangeCodeOptions {
  env: OAuthEnv;
  provider: CustomerOAuthProvider;
  code: string;
  codeVerifier: string;
  cache?: KVNamespace;
  fetchImpl?: typeof fetch;
}

export async function exchangeCodeForIdToken({
  env,
  provider,
  code,
  codeVerifier,
  cache,
  fetchImpl = fetch,
}: ExchangeCodeOptions): Promise<TokenExchangeResult> {
  const config = OAUTH_PROVIDERS[provider];
  const clientId = getClientId(env, provider);
  if (!clientId) {
    throw new TokenExchangeError(`${provider} client id missing`);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    // Must match the authorize request byte for byte, hence the shared builder.
    redirect_uri: buildRedirectUri(env, provider),
    client_id: clientId,
    client_secret: await resolveClientSecret(env, provider, cache),
    code_verifier: codeVerifier,
  });

  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    // The provider's body can name the client or the reason it rejected the
    // request; neither belongs in a customer-facing response. Log it, return a
    // generic failure.
    const detail = await response.text().catch(() => "");
    console.error("[customer-oauth] token exchange failed", {
      provider,
      status: response.status,
      detail: detail.slice(0, 500),
    });
    throw new TokenExchangeError(
      "Authorization code exchange failed",
      response.status,
    );
  }

  const payload = (await response.json()) as {
    id_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };

  if (typeof payload.id_token !== "string" || !payload.id_token) {
    throw new TokenExchangeError("Provider response carried no id_token");
  }

  return {
    idToken: payload.id_token,
    expiresIn:
      typeof payload.expires_in === "number" &&
      Number.isSafeInteger(payload.expires_in)
        ? payload.expires_in
        : undefined,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
  };
}
