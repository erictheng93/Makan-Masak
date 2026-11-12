/**
 * Apple's `client_secret` is not a string — it is an ES256 JWT we sign
 * ourselves, per request, from the `.p8` private key Apple issues.
 *
 * That makes Apple the one provider whose "secret" cannot simply be read from
 * `wrangler secret` and posted to the token endpoint. Apple caps the lifetime
 * at six months; we mint a much shorter one and cache it, so a leaked
 * assertion expires on its own and a key rotation takes effect quickly.
 */

import type { OAuthEnv } from "./providers";

const APPLE_AUDIENCE = "https://appleid.apple.com";
/** Well under Apple's 6-month ceiling: short enough to bound a leak. */
const CLIENT_SECRET_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Re-sign before expiry so a request never races the boundary. */
const CACHE_SAFETY_MARGIN_SECONDS = 60 * 60;
const CACHE_KEY = "oauth_apple_client_secret";

export class AppleClientSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppleClientSecretError";
  }
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Accepts the `.p8` file contents with or without its PEM armour, and with
 * either real newlines or the escaped `\n` that survives a shell round trip
 * into `wrangler secret put`.
 */
function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) {
    throw new AppleClientSecretError("APPLE_SIGN_IN_PRIVATE_KEY is empty");
  }

  let binary: string;
  try {
    binary = atob(body);
  } catch {
    throw new AppleClientSecretError(
      "APPLE_SIGN_IN_PRIVATE_KEY is not valid base64 PKCS#8",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface AppleClientSecretOptions {
  env: OAuthEnv;
  cache?: KVNamespace;
  now?: number;
}

export async function getAppleClientSecret({
  env,
  cache,
  now = Date.now(),
}: AppleClientSecretOptions): Promise<string> {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  const clientId = env.APPLE_CLIENT_ID?.trim();
  const privateKeyPem = env.APPLE_SIGN_IN_PRIVATE_KEY?.trim();

  if (!teamId || !keyId || !clientId || !privateKeyPem) {
    throw new AppleClientSecretError(
      "Apple Sign In is not fully configured (need APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID, APPLE_SIGN_IN_PRIVATE_KEY)",
    );
  }

  if (cache) {
    const cached = await cache.get(CACHE_KEY, "text");
    if (cached) return cached;
  }

  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + CLIENT_SECRET_TTL_SECONDS;

  const header = base64UrlEncode(
    JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }),
  );
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: teamId,
      iat: issuedAt,
      exp: expiresAt,
      aud: APPLE_AUDIENCE,
      sub: clientId,
    }),
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem) as unknown as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  // WebCrypto ECDSA emits the raw r||s pair, which is exactly the JWS ES256
  // signature encoding. No DER unwrapping is needed here.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  const token = `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;

  if (cache) {
    await cache.put(CACHE_KEY, token, {
      expirationTtl: CLIENT_SECRET_TTL_SECONDS - CACHE_SAFETY_MARGIN_SECONDS,
    });
  }

  return token;
}
