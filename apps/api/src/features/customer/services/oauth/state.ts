/**
 * Authorization-request state: PKCE verifier, CSRF state, and OIDC nonce.
 *
 * Workers have no session storage, so the three values that must survive the
 * round trip to the provider live in KV under the opaque `state` handle. The
 * customer's browser carries only `state`; the verifier never leaves the edge,
 * which is the whole point of PKCE for a confidential client behind a redirect.
 */

import type { CustomerOAuthProvider } from "@makanmasak/shared-types";
import { timingSafeEqual } from "../../../../shared/utils/timing-safe-equal";

/** Long enough for a human to finish a provider login, short enough to expire. */
export const OAUTH_STATE_TTL_SECONDS = 600;

export interface OAuthRequestState {
  codeVerifier: string;
  nonce: string;
  /** Where to send the browser once the callback resolves. */
  redirectTo?: string;
  /**
   * Set when an already-signed-in customer started the flow, meaning "attach
   * this provider to that account" rather than "sign me in". Captured at start
   * so the callback cannot be tricked into linking to a different account.
   */
  linkCustomerId?: string;
  /**
   * SHA-256 of the random value set as an HttpOnly cookie on the browser that
   * started the flow. The callback must present the cookie, so a state minted
   * in the attacker's browser cannot be completed in the victim's (login/link
   * CSRF). Absent on legacy entries, which are rejected.
   */
  bindingHash?: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomBase64Url(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function generateState(): string {
  return randomBase64Url(32);
}

export function generateNonce(): string {
  return randomBase64Url(32);
}

/** RFC 7636 allows 43–128 characters; 32 random bytes lands at 43. */
export function generateCodeVerifier(): string {
  return randomBase64Url(32);
}

export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function stateKey(provider: CustomerOAuthProvider, state: string): string {
  return `oauth_state:${provider}:${state}`;
}

export async function saveRequestState(
  kv: KVNamespace,
  provider: CustomerOAuthProvider,
  state: string,
  value: OAuthRequestState,
): Promise<void> {
  await kv.put(stateKey(provider, state), JSON.stringify(value), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
}

/**
 * Read the state once and delete it, so a replayed callback finds nothing.
 *
 * `bindingHash` is the hash of the browser's binding cookie. A missing or
 * mismatched binding returns null WITHOUT deleting, so a cross-site attempt
 * cannot burn the legitimate browser's pending state.
 *
 * KV has no atomic read-and-delete, so two simultaneous callbacks could both
 * read before either deletes. That race is not load-bearing: the provider's
 * authorization code is itself single-use, so the second token exchange fails
 * at the provider. This delete is the near layer of that pair, not the only one.
 */
export async function consumeRequestState(
  kv: KVNamespace,
  provider: CustomerOAuthProvider,
  state: string,
  bindingHash: string | undefined,
): Promise<OAuthRequestState | null> {
  const key = stateKey(provider, state);
  const raw = await kv.get(key, "json");

  const value = (
    raw && typeof raw === "object" ? raw : {}
  ) as Partial<OAuthRequestState>;
  if (
    raw &&
    (typeof value.bindingHash !== "string" ||
      !bindingHash ||
      !timingSafeEqual(value.bindingHash, bindingHash))
  ) {
    return null;
  }
  await kv.delete(key);

  if (!raw || typeof raw !== "object") return null;
  if (
    typeof value.codeVerifier !== "string" ||
    typeof value.nonce !== "string"
  ) {
    return null;
  }

  return {
    codeVerifier: value.codeVerifier,
    nonce: value.nonce,
    bindingHash: value.bindingHash,
    redirectTo:
      typeof value.redirectTo === "string" ? value.redirectTo : undefined,
    linkCustomerId:
      typeof value.linkCustomerId === "string"
        ? value.linkCustomerId
        : undefined,
  };
}

/**
 * Only same-origin paths are accepted as a post-login destination. An absolute
 * URL here would turn the callback into an open redirect that borrows the
 * provider's trust, so anything that is not a single-slash-prefixed path is
 * dropped rather than sanitised.
 */
export function sanitizeRedirectTo(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
  if (trimmed.includes("\\")) return undefined;
  return trimmed;
}
