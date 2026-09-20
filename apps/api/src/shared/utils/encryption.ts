/**
 * The single place that turns a Worker environment into an encryption policy.
 *
 * `@makanmasak/utils` owns the cryptography and stays environment-agnostic: its
 * `encrypt`/`decrypt` take a `requireStrongKey` flag with no default, so every
 * call site has to state whether a missing or guessable `ENCRYPTION_KEY` is
 * fatal. This module is where that answer is computed for `apps/api`, exactly
 * once, from `NODE_ENV`.
 *
 * Production-only, and deliberately so. `apps/api/.dev.vars` ships no
 * `ENCRYPTION_KEY` and the test fixtures use short placeholders like
 * `"test-encryption-key"`; a blanket guard would break local dev and every
 * existing fixture without protecting anything, because those environments hold
 * no real customer secrets. This mirrors `assertEmailChannelAvailable` in
 * `features/customer/routes/index.ts`, which lets the noop mail provider through
 * outside production and refuses to pretend in it.
 *
 * Production is what matters: `makanmasak-api-prod` has no `ENCRYPTION_KEY`
 * secret at all, and without this flag PBKDF2 over an empty string plus the
 * hardcoded salts below yields an AES-256 key that any reader of this
 * repository can recompute (issue #300).
 */

import type { Env } from "../../types/env";

/**
 * Domain-separation salts. Keeping them in one file makes accidental reuse
 * visible: two features sharing a salt means either can decrypt the other's
 * ciphertext.
 */

/** Customer-supplied LLM API keys in `ai_configurations.api_key_encrypted`. */
export const AI_API_KEY_ENCRYPTION_SALT = "makanmakan-api-key-encryption-salt";

/** Delivery-platform OAuth credentials in `platform_integrations.credentials`. */
export const PLATFORM_CREDENTIALS_ENCRYPTION_SALT =
  "makanmakan-platform-credentials-salt";

/**
 * A shop's own e-wallet merchant secrets in
 * `shop_payment_credentials.secret_payload_encrypted`.
 *
 * Its own salt rather than the platform one: these secrets move a merchant's
 * money, and sharing a salt would mean a bug in the delivery-integration code
 * path could decrypt them.
 */
export const SHOP_PAYMENT_CREDENTIALS_ENCRYPTION_SALT =
  "makanmasak-shop-payment-credentials-salt";

/**
 * The key plus the weak-key policy, resolved together so a service can never
 * hold one without the other.
 */
export interface EncryptionSettings {
  key: string;
  requireStrongKey: boolean;
}

export type EncryptionEnv = Pick<Env, "NODE_ENV" | "ENCRYPTION_KEY">;

export function encryptionSettings(env: EncryptionEnv): EncryptionSettings {
  return {
    key: env.ENCRYPTION_KEY ?? "",
    requireStrongKey: env.NODE_ENV === "production",
  };
}
