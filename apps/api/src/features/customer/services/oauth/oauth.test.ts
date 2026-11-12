import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  deriveCodeChallenge,
  generateCodeVerifier,
  sanitizeRedirectTo,
} from "../../../../shared/oauth/state";
import { isUsableProviderEmail, maskEmail, normalizeEmail } from "./identity";
import {
  buildRedirectUri,
  configuredProviders,
  isProviderConfigured,
  OAUTH_PROVIDERS,
  type OAuthEnv,
} from "../../../../shared/oauth/providers";
import { verifyIdToken, IdTokenError } from "../../../../shared/oauth/idToken";

function buildEnv(overrides: Partial<OAuthEnv> = {}): OAuthEnv {
  return {
    API_BASE_URL: "https://api.example.test",
    ...overrides,
  } as OAuthEnv;
}

// ---------------------------------------------------------------------------
// PKCE / state
// ---------------------------------------------------------------------------

describe("PKCE", () => {
  it("derives the S256 challenge from RFC 7636's example verifier", async () => {
    // The one published vector for code_challenge_method=S256. If this drifts,
    // every provider rejects the exchange with an opaque error, so pin it.
    const challenge = await deriveCodeChallenge(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    );
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("produces verifiers inside the RFC's length bounds", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("issues a different verifier every time", () => {
    const seen = new Set(
      Array.from({ length: 25 }, () => generateCodeVerifier()),
    );
    expect(seen.size).toBe(25);
  });
});

describe("sanitizeRedirectTo", () => {
  it("keeps a same-origin path", () => {
    expect(sanitizeRedirectTo("/profile")).toBe("/profile");
  });

  it.each([
    ["an absolute URL", "https://evil.test/steal"],
    ["a protocol-relative URL", "//evil.test/steal"],
    ["a backslash-smuggled host", "/\\evil.test"],
    ["a bare word", "profile"],
    ["an empty value", ""],
  ])("drops %s", (_label, value) => {
    expect(sanitizeRedirectTo(value)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

describe("provider configuration", () => {
  it("treats a provider with no credentials as unavailable", () => {
    expect(isProviderConfigured(buildEnv(), "line")).toBe(false);
  });

  it("requires both halves of the LINE credential pair", () => {
    expect(
      isProviderConfigured(buildEnv({ LINE_LOGIN_CHANNEL_ID: "id" }), "line"),
    ).toBe(false);
    expect(
      isProviderConfigured(
        buildEnv({
          LINE_LOGIN_CHANNEL_ID: "id",
          LINE_LOGIN_CHANNEL_SECRET: "secret",
        }),
        "line",
      ),
    ).toBe(true);
  });

  it("requires all four Apple values, not just the client id", () => {
    const partial = buildEnv({
      APPLE_CLIENT_ID: "com.example.app",
      APPLE_TEAM_ID: "TEAM",
      APPLE_KEY_ID: "KEY",
    });
    expect(isProviderConfigured(partial, "apple")).toBe(false);

    expect(
      isProviderConfigured(
        buildEnv({
          APPLE_CLIENT_ID: "com.example.app",
          APPLE_TEAM_ID: "TEAM",
          APPLE_KEY_ID: "KEY",
          APPLE_SIGN_IN_PRIVATE_KEY: "key-material",
        }),
        "apple",
      ),
    ).toBe(true);
  });

  it("lists only the providers this deployment can actually run", () => {
    const env = buildEnv({
      GOOGLE_OAUTH_CLIENT_ID: "gid",
      GOOGLE_OAUTH_CLIENT_SECRET: "gsecret",
    });
    expect(configuredProviders(env)).toEqual(["google"]);
  });

  it("builds the redirect URI from API_BASE_URL, not the request host", () => {
    expect(buildRedirectUri(buildEnv(), "line")).toBe(
      "https://api.example.test/api/v1/customer/auth/oauth/line/callback",
    );
  });

  it("tolerates a trailing slash on API_BASE_URL", () => {
    expect(
      buildRedirectUri(
        buildEnv({ API_BASE_URL: "https://api.example.test/" }),
        "google",
      ),
    ).toBe(
      "https://api.example.test/api/v1/customer/auth/oauth/google/callback",
    );
  });

  it("marks Apple as the form-post provider", () => {
    expect(OAUTH_PROVIDERS.apple.callbackMethod).toBe("POST");
    expect(OAUTH_PROVIDERS.line.callbackMethod).toBe("GET");
    expect(OAUTH_PROVIDERS.google.callbackMethod).toBe("GET");
  });
});

// ---------------------------------------------------------------------------
// Email handling
// ---------------------------------------------------------------------------

describe("provider email handling", () => {
  it("rejects an Apple private relay alias as an identity hint", () => {
    // A relay address is deliverable but per-app, so matching it against an
    // existing primary_email would link two unrelated people.
    expect(isUsableProviderEmail("abc123@privaterelay.appleid.com")).toBe(
      false,
    );
    expect(isUsableProviderEmail("eric@example.com")).toBe(true);
  });

  it("rejects absent or malformed addresses", () => {
    expect(isUsableProviderEmail(undefined)).toBe(false);
    expect(isUsableProviderEmail("not-an-email")).toBe(false);
  });

  it("lower-cases addresses before comparison", () => {
    expect(normalizeEmail("  Eric@Example.COM ")).toBe("eric@example.com");
  });

  it("masks enough to jog a memory but not to enumerate", () => {
    expect(maskEmail("eric@dacit.net")).toBe("e***@d***.net");
  });
});

// ---------------------------------------------------------------------------
// id_token verification
// ---------------------------------------------------------------------------

const ISSUER = OAUTH_PROVIDERS.google.issuers[0];
const AUDIENCE = "test-client-id";

// The Workers `JsonWebKey` surface does not carry `kid` / `alg`, and
// `exportKey` is typed as returning either a JWK or an ArrayBuffer depending on
// the format argument. A plain record keeps the test honest about what a JWKS
// entry actually is without asserting a shape the runtime never checks.
type TestJwk = Record<string, unknown>;

let signingKey: CryptoKeyPair;
let publicJwk: TestJwk;

function base64Url(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signToken(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const head = base64Url(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT", ...header }),
  );
  const body = base64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    signingKey.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${base64Url(new Uint8Array(signature))}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "provider-subject-123",
    exp: nowSeconds + 600,
    iat: nowSeconds,
    nonce: "expected-nonce",
    email: "eric@example.com",
    email_verified: true,
    name: "Eric",
    ...overrides,
  };
}

function jwksFetch(keys: TestJwk[] = [publicJwk]): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ keys }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

async function verify(
  token: string,
  overrides: Partial<Parameters<typeof verifyIdToken>[0]> = {},
) {
  return verifyIdToken({
    idToken: token,
    config: OAUTH_PROVIDERS.google,
    audience: AUDIENCE,
    expectedNonce: "expected-nonce",
    fetchImpl: jwksFetch(),
    ...overrides,
  });
}

describe("verifyIdToken", () => {
  beforeAll(async () => {
    signingKey = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    publicJwk = (await crypto.subtle.exportKey(
      "jwk",
      signingKey.publicKey,
    )) as unknown as TestJwk;
    publicJwk.kid = "test-key";
    publicJwk.alg = "RS256";
  }, 30_000);

  it("accepts a well-formed token and returns the claims we rely on", async () => {
    const claims = await verify(await signToken(validPayload()));

    expect(claims.sub).toBe("provider-subject-123");
    expect(claims.email).toBe("eric@example.com");
    expect(claims.emailVerified).toBe(true);
    expect(claims.name).toBe("Eric");
  });

  it("fetches the JWKS through the provider's published URL", async () => {
    const fetchImpl = jwksFetch();
    await verify(await signToken(validPayload()), { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(OAUTH_PROVIDERS.google.jwksUrl);
  });

  it("rejects a token signed by a key that is not in the JWKS", async () => {
    const impostor = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    const head = base64Url(
      JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
    );
    const body = base64Url(JSON.stringify(validPayload()));
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      impostor.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    const forged = `${head}.${body}.${base64Url(new Uint8Array(signature))}`;

    await expect(verify(forged)).rejects.toThrow(IdTokenError);
  });

  it("rejects a token whose payload was swapped after signing", async () => {
    const token = await signToken(validPayload());
    const [head, , signature] = token.split(".");
    const tampered = `${head}.${base64Url(
      JSON.stringify(validPayload({ sub: "someone-else" })),
    )}.${signature}`;

    await expect(verify(tampered)).rejects.toThrow(
      /signature verification failed/,
    );
  });

  it("rejects alg:none outright rather than looking for a matching key", async () => {
    const head = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const body = base64Url(JSON.stringify(validPayload()));

    await expect(verify(`${head}.${body}.`)).rejects.toThrow(
      /Unsupported id_token algorithm/,
    );
  });

  it("rejects HS256, which would let the JWKS modulus act as a shared secret", async () => {
    const head = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64Url(JSON.stringify(validPayload()));

    await expect(verify(`${head}.${body}.c2ln`)).rejects.toThrow(
      /Unsupported id_token algorithm/,
    );
  });

  it("rejects a token minted for a different client of the same provider", async () => {
    await expect(
      verify(await signToken(validPayload({ aud: "someone-elses-client" }))),
    ).rejects.toThrow(/audience does not match/);
  });

  it("accepts an aud array that contains our client id", async () => {
    const claims = await verify(
      await signToken(validPayload({ aud: ["other-client", AUDIENCE] })),
    );
    expect(claims.sub).toBe("provider-subject-123");
  });

  it("rejects an unexpected issuer", async () => {
    await expect(
      verify(await signToken(validPayload({ iss: "https://evil.test" }))),
    ).rejects.toThrow(/Unexpected id_token issuer/);
  });

  it("rejects an expired token", async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      verify(await signToken(validPayload({ exp: stale }))),
    ).rejects.toThrow(/has expired/);
  });

  it("rejects a replayed nonce from a different authorize request", async () => {
    await expect(
      verify(await signToken(validPayload({ nonce: "some-other-nonce" }))),
    ).rejects.toThrow(/nonce does not match/);
  });

  it("rejects a token naming a kid the JWKS does not publish", async () => {
    await expect(
      verify(await signToken(validPayload(), { kid: "rotated-away" })),
    ).rejects.toThrow(/No JWKS key/);
  });

  it("rejects a token with no subject", async () => {
    await expect(
      verify(await signToken(validPayload({ sub: "" }))),
    ).rejects.toThrow(/no subject/);
  });

  it("serves the JWKS from cache on the second verification", async () => {
    const store = new Map<string, string>();
    const cache = {
      get: vi.fn(async (key: string, type?: string) => {
        const raw = store.get(key);
        if (raw === undefined) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    } as unknown as KVNamespace;

    const fetchImpl = jwksFetch();
    const token = await signToken(validPayload());

    await verify(token, { cache, fetchImpl });
    await verify(token, { cache, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledWith(
      "oauth_jwks:google",
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("surfaces a JWKS endpoint failure instead of trusting the token", async () => {
    const failing = vi.fn(
      async () => new Response("upstream down", { status: 503 }),
    ) as unknown as typeof fetch;

    await expect(
      verify(await signToken(validPayload()), { fetchImpl: failing }),
    ).rejects.toThrow(/JWKS fetch failed/);
  });
});
