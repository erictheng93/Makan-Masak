/**
 * `id_token` verification against a provider's JWKS.
 *
 * The token arrives over TLS straight from the provider's token endpoint, which
 * is exactly the argument people use to skip this step. It is not sufficient:
 * TLS proves who sent the bytes, not who the token was minted for. Without
 * checking `aud` a token issued for a different client of the same provider is
 * accepted, and without checking the signature a `code` obtained through a
 * mis-registered redirect can carry an attacker-chosen `sub`. Apple compounds
 * this by putting the user's only copy of name/email inside the token.
 *
 * So: verify the signature against the published JWKS, then check
 * `iss` / `aud` / `exp` / `nonce` before anything downstream reads `sub`.
 */

import type { OAuthProviderConfig } from "./providers";

/** JWKS responses are cached in KV; providers rotate keys, not fleets of them. */
const JWKS_CACHE_TTL_SECONDS = 24 * 60 * 60;
/** Tolerance for clock skew between us and the provider, in seconds. */
const CLOCK_SKEW_SECONDS = 120;

export interface VerifiedIdToken {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
}

export class IdTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdTokenError";
  }
}

interface JwkKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  const text = new TextDecoder().decode(base64UrlToBytes(segment));
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new IdTokenError("id_token segment is not an object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Structural stand-ins for the WebCrypto algorithm records. The Workers type
 * surface names these differently from lib.dom, so they are described here
 * rather than imported from either.
 */
interface ImportAlgorithm {
  name: string;
  hash?: string;
  namedCurve?: string;
}
interface VerifyAlgorithm {
  name: string;
  hash?: string;
}

/**
 * Only asymmetric algorithms whose public half is published in the JWKS are
 * accepted. Rejecting everything else by name is what stops the `alg: "none"`
 * and HMAC-confusion families of attack — never take the algorithm from the
 * token and look up a key to match it.
 */
function importParamsFor(alg: string): {
  importAlgorithm: ImportAlgorithm;
  verifyAlgorithm: VerifyAlgorithm;
} {
  switch (alg) {
    case "RS256":
      return {
        importAlgorithm: {
          name: "RSASSA-PKCS1-v1_5",
          hash: "SHA-256",
        },
        verifyAlgorithm: { name: "RSASSA-PKCS1-v1_5" },
      };
    case "ES256":
      return {
        importAlgorithm: { name: "ECDSA", namedCurve: "P-256" },
        verifyAlgorithm: { name: "ECDSA", hash: "SHA-256" },
      };
    default:
      throw new IdTokenError(`Unsupported id_token algorithm: ${alg}`);
  }
}

async function loadJwks(
  config: OAuthProviderConfig,
  cache: KVNamespace | undefined,
  fetchImpl: typeof fetch,
): Promise<JwkKey[]> {
  const cacheKey = `oauth_jwks:${config.provider}`;

  if (cache) {
    const cached = await cache.get(cacheKey, "json");
    if (cached && Array.isArray((cached as { keys?: unknown }).keys)) {
      return (cached as { keys: JwkKey[] }).keys;
    }
  }

  const response = await fetchImpl(config.jwksUrl);
  if (!response.ok) {
    throw new IdTokenError(
      `JWKS fetch failed for ${config.provider}: ${response.status}`,
    );
  }
  const body = (await response.json()) as { keys?: JwkKey[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new IdTokenError(`JWKS for ${config.provider} contains no keys`);
  }

  if (cache) {
    await cache.put(cacheKey, JSON.stringify({ keys: body.keys }), {
      expirationTtl: JWKS_CACHE_TTL_SECONDS,
    });
  }

  return body.keys;
}

export interface VerifyIdTokenOptions {
  idToken: string;
  config: OAuthProviderConfig;
  audience: string;
  /** The nonce placed in the authorize request; must round-trip unchanged. */
  expectedNonce?: string;
  cache?: KVNamespace;
  fetchImpl?: typeof fetch;
  now?: number;
}

export async function verifyIdToken({
  idToken,
  config,
  audience,
  expectedNonce,
  cache,
  fetchImpl = fetch,
  now = Date.now(),
}: VerifyIdTokenOptions): Promise<VerifiedIdToken> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new IdTokenError("id_token is not a compact JWS");
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeJsonSegment(headerSegment);
  const alg = typeof header.alg === "string" ? header.alg : "";
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  const { importAlgorithm, verifyAlgorithm } = importParamsFor(alg);

  const keys = await loadJwks(config, cache, fetchImpl);
  // Match on kid when the token names one. A JWKS with a single key and a token
  // with no kid is legitimate; a token naming an unknown kid is not, and must
  // not silently fall back to trying every key.
  const jwk = kid
    ? keys.find((key) => key.kid === kid)
    : keys.length === 1
      ? keys[0]
      : undefined;
  if (!jwk) {
    throw new IdTokenError(
      `No JWKS key for ${config.provider} matching kid ${kid ?? "(absent)"}`,
    );
  }
  if (typeof jwk.alg === "string" && jwk.alg !== alg) {
    throw new IdTokenError("id_token algorithm does not match the JWKS key");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    importAlgorithm,
    false,
    ["verify"],
  );

  const signed = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const signature = base64UrlToBytes(signatureSegment);
  const valid = await crypto.subtle.verify(
    verifyAlgorithm,
    key,
    signature,
    signed,
  );
  if (!valid) {
    throw new IdTokenError("id_token signature verification failed");
  }

  const payload = decodeJsonSegment(payloadSegment);

  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  if (!config.issuers.includes(issuer)) {
    throw new IdTokenError(`Unexpected id_token issuer: ${issuer}`);
  }

  // `aud` is a string or an array of strings; ours must be present either way.
  const audienceClaim = payload.aud;
  const audienceOk = Array.isArray(audienceClaim)
    ? audienceClaim.includes(audience)
    : audienceClaim === audience;
  if (!audienceOk) {
    throw new IdTokenError("id_token audience does not match this client");
  }

  const nowSeconds = Math.floor(now / 1000);
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new IdTokenError("id_token has expired");
  }
  if (
    typeof payload.nbf === "number" &&
    payload.nbf - CLOCK_SKEW_SECONDS > nowSeconds
  ) {
    throw new IdTokenError("id_token is not yet valid");
  }

  if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
    throw new IdTokenError("id_token nonce does not match the request");
  }

  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub) {
    throw new IdTokenError("id_token has no subject");
  }

  return {
    sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    // Google sends a boolean; some providers send the string "true".
    emailVerified:
      typeof payload.email_verified === "boolean"
        ? payload.email_verified
        : payload.email_verified === "true"
          ? true
          : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
    nonce: typeof payload.nonce === "string" ? payload.nonce : undefined,
  };
}
