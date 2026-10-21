import { describe, expect, it, vi } from "vitest";
import {
  getAppleClientSecret,
  AppleClientSecretError,
} from "./appleClientSecret";
import {
  createCustomerForIdentity,
  findActiveCustomerIdByEmail,
  findLiveIdentity,
  hasAnotherAuthMethod,
  listLiveIdentities,
  maskEmail,
  revokeIdentity,
  touchIdentityUse,
} from "./identity";
import {
  consumeRequestState,
  deriveCodeChallenge,
  saveRequestState,
} from "./state";
import { exchangeCodeForIdToken } from "./tokenExchange";
import { OAUTH_PROVIDERS, type OAuthEnv } from "./providers";
import oauthRoutes from "../../routes/oauth";
import { ApiError } from "../../../../shared/utils/api-error";

function buildEnv(overrides: Partial<OAuthEnv> = {}): OAuthEnv {
  return {
    API_BASE_URL: "https://api.example.test",
    LINE_LOGIN_CHANNEL_ID: "line-client",
    LINE_LOGIN_CHANNEL_SECRET: "line-secret",
    GOOGLE_OAUTH_CLIENT_ID: "google-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    ...overrides,
  } as OAuthEnv;
}

describe("authorization-code exchange", () => {
  it("posts the PKCE verifier and returns only the identity token metadata", async () => {
    let requestedBody = "";
    const fetchImpl = vi.fn(
      async (_url: unknown, init?: { body?: unknown }) => {
        requestedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            id_token: "provider-id-token",
            expires_in: 3600,
            scope: "openid profile",
          }),
          { status: 200 },
        );
      },
    );

    await expect(
      exchangeCodeForIdToken({
        env: buildEnv(),
        provider: "google",
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({
      idToken: "provider-id-token",
      expiresIn: 3600,
      scope: "openid profile",
    });

    const body = new URLSearchParams(requestedBody);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("authorization-code");
    expect(body.get("client_id")).toBe("google-client");
    expect(body.get("client_secret")).toBe("google-secret");
    expect(body.get("code_verifier")).toBe("pkce-verifier");
    expect(body.get("redirect_uri")).toBe(
      "https://api.example.test/api/v1/customer/auth/oauth/google/callback",
    );
  });

  it("does not expose a provider rejection body and rejects a missing id token", async () => {
    const rejected = vi.fn(
      async () => new Response("client_secret=leaked", { status: 401 }),
    ) as unknown as typeof fetch;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      exchangeCodeForIdToken({
        env: buildEnv(),
        provider: "line",
        code: "code",
        codeVerifier: "verifier",
        fetchImpl: rejected,
      }),
    ).rejects.toMatchObject({ providerStatus: 401 });
    expect(consoleError).toHaveBeenCalledWith(
      "[customer-oauth] token exchange failed",
      expect.objectContaining({ provider: "line", status: 401 }),
    );
    consoleError.mockRestore();

    await expect(
      exchangeCodeForIdToken({
        env: buildEnv(),
        provider: "line",
        code: "code",
        codeVerifier: "verifier",
        fetchImpl: (async () =>
          new Response(JSON.stringify({ scope: "openid" }), {
            status: 200,
          })) as typeof fetch,
      }),
    ).rejects.toThrow("Provider response carried no id_token");
  });

  it("fails before calling a provider when its local credentials are incomplete", async () => {
    const fetchImpl = vi.fn();

    await expect(
      exchangeCodeForIdToken({
        env: buildEnv({ GOOGLE_OAUTH_CLIENT_ID: "" }),
        provider: "google",
        code: "code",
        codeVerifier: "verifier",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("google client id missing");

    await expect(
      exchangeCodeForIdToken({
        env: buildEnv({ LINE_LOGIN_CHANNEL_SECRET: " " }),
        provider: "line",
        code: "code",
        codeVerifier: "verifier",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("LINE channel secret missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not invent expiry or scope metadata when a provider omits their expected types", async () => {
    await expect(
      exchangeCodeForIdToken({
        env: buildEnv(),
        provider: "google",
        code: "code",
        codeVerifier: "verifier",
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              id_token: "id-token",
              expires_in: "3600",
              scope: 1,
            }),
            { status: 200 },
          )) as typeof fetch,
      }),
    ).resolves.toEqual({
      idToken: "id-token",
      expiresIn: undefined,
      scope: undefined,
    });
  });

  it("omits a fractional expiry so it cannot be written to an INTEGER timestamp column", async () => {
    await expect(
      exchangeCodeForIdToken({
        env: buildEnv(),
        provider: "google",
        code: "code",
        codeVerifier: "verifier",
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({ id_token: "id-token", expires_in: 3600.5 }),
            { status: 200 },
          )) as typeof fetch,
      }),
    ).resolves.toEqual({
      idToken: "id-token",
      expiresIn: undefined,
      scope: undefined,
    });
  });
});

describe("Apple client secret", () => {
  it("requires all Apple signing settings before minting a client assertion", async () => {
    await expect(
      getAppleClientSecret({ env: buildEnv({ APPLE_TEAM_ID: "TEAM" }) }),
    ).rejects.toBeInstanceOf(AppleClientSecretError);
  });

  it("returns an unexpired cached assertion without importing the private key", async () => {
    const cache = {
      get: vi.fn(async () => "cached-client-assertion"),
      put: vi.fn(),
    } as unknown as KVNamespace;

    await expect(
      getAppleClientSecret({
        env: buildEnv({
          APPLE_TEAM_ID: "TEAM",
          APPLE_KEY_ID: "KEY",
          APPLE_CLIENT_ID: "com.example.app",
          APPLE_SIGN_IN_PRIVATE_KEY: "not-needed-for-a-cache-hit",
        }),
        cache,
      }),
    ).resolves.toBe("cached-client-assertion");
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("signs and caches a short-lived ES256 assertion when no cache entry exists", async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(
      (await crypto.subtle.exportKey(
        "pkcs8",
        keyPair.privateKey,
      )) as ArrayBuffer,
    );
    let binary = "";
    for (const byte of pkcs8) binary += String.fromCharCode(byte);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
    const cache = {
      get: vi.fn(async () => null),
      put: vi.fn(),
    } as unknown as KVNamespace;

    const token = await getAppleClientSecret({
      env: buildEnv({
        APPLE_TEAM_ID: "TEAM",
        APPLE_KEY_ID: "KEY",
        APPLE_CLIENT_ID: "com.example.app",
        APPLE_SIGN_IN_PRIVATE_KEY: pem,
      }),
      cache,
      now: 1_700_000_000_000,
    });

    const [header, payload, signature] = token.split(".");
    expect([header, payload, signature]).toHaveLength(3);
    expect(
      JSON.parse(atob(header.replace(/-/g, "+").replace(/_/g, "/"))),
    ).toMatchObject({
      alg: "ES256",
      kid: "KEY",
    });
    expect(cache.put).toHaveBeenCalledWith("oauth_apple_client_secret", token, {
      expirationTtl: 2_588_400,
    });
  });

  it("rejects malformed private-key material before attempting an Apple token exchange", async () => {
    await expect(
      getAppleClientSecret({
        env: buildEnv({
          APPLE_TEAM_ID: "TEAM",
          APPLE_KEY_ID: "KEY",
          APPLE_CLIENT_ID: "com.example.app",
          APPLE_SIGN_IN_PRIVATE_KEY:
            "-----BEGIN PRIVATE KEY-----\\nnot-base64\\n-----END PRIVATE KEY-----",
        }),
      }),
    ).rejects.toThrow("not valid base64 PKCS#8");
  });
});

describe("one-time OAuth request state", () => {
  it("persists PKCE state for ten minutes and consumes it only once", async () => {
    const stored = new Map<string, unknown>();
    const kv = {
      put: vi.fn(async (key: string, value: string) =>
        stored.set(key, JSON.parse(value)),
      ),
      get: vi.fn(async (key: string) => stored.get(key) ?? null),
      delete: vi.fn(async (key: string) => stored.delete(key)),
    } as unknown as KVNamespace;
    const value = {
      codeVerifier: "verifier",
      nonce: "nonce",
      redirectTo: "/orders",
      linkCustomerId: "customer-1",
      bindingHash: "hash",
    };

    await saveRequestState(kv, "google", "opaque-state", value);
    await expect(
      consumeRequestState(kv, "google", "opaque-state", "hash"),
    ).resolves.toEqual(value);
    await expect(
      consumeRequestState(kv, "google", "opaque-state", "hash"),
    ).resolves.toBeNull();

    expect(kv.put).toHaveBeenCalledWith(
      "oauth_state:google:opaque-state",
      JSON.stringify(value),
      { expirationTtl: 600 },
    );
    expect(kv.delete).toHaveBeenCalledTimes(2);
  });

  it("drops malformed state while still deleting its replay key", async () => {
    const kv = {
      get: vi.fn(async () => ({
        codeVerifier: "verifier",
        bindingHash: "hash",
      })),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    await expect(
      consumeRequestState(kv, "line", "state", "hash"),
    ).resolves.toBeNull();
    expect(kv.delete).toHaveBeenCalledWith("oauth_state:line:state");
  });

  it("allows absent optional redirect and linking fields without manufacturing values", async () => {
    const kv = {
      get: vi.fn(async () => ({
        codeVerifier: "verifier",
        nonce: "nonce",
        bindingHash: "hash",
      })),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    await expect(
      consumeRequestState(kv, "google", "state", "hash"),
    ).resolves.toEqual({
      codeVerifier: "verifier",
      nonce: "nonce",
      bindingHash: "hash",
      redirectTo: undefined,
      linkCustomerId: undefined,
    });
  });
});

describe("OAuth identity creation", () => {
  it("creates a new customer without claiming an unverified provider email", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...values: unknown[]) => {
            statements.push({ sql, values });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        }),
      },
    };

    const customerId = await createCustomerForIdentity(env as never, {
      provider: "line",
      providerUid: "line-subject",
      profile: {
        email: "claimed-but-unverified@example.test",
        emailVerified: false,
      },
      now: 123,
    });

    expect(customerId).toEqual(expect.any(String));
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain("INSERT INTO customers");
    expect(statements[0].values).toEqual([
      customerId,
      "MakanMasak 會員",
      null,
      null,
      123,
      123,
    ]);
    expect(statements[1].sql).toContain("INSERT INTO customer_auth_identities");
    expect(statements[1].values).toContain(null);
  });

  it("reads, updates, lists, and revokes identities through customer-scoped queries", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    let revokeChanges = 1;
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...values: unknown[]) => {
            calls.push({ sql, values });
            return {
              first: async () => {
                if (sql.includes("provider_uid")) {
                  return {
                    id: "identity-1",
                    customer_id: "customer-1",
                    provider: "google",
                    provider_uid: "subject-1",
                    revoked_at_ms: null,
                  };
                }
                if (sql.includes("primary_email")) return { id: "customer-1" };
                if (sql.includes("primary_phone")) {
                  return { primary_phone: null };
                }
                return { remaining: 1 };
              },
              all: async () => ({
                results: [
                  {
                    id: "identity-1",
                    provider: "google",
                    provider_email: "person@example.test",
                    provider_display_name: "Person",
                    created_at_ms: 100,
                    last_used_at_ms: 200,
                  },
                ],
              }),
              run: async () => ({ meta: { changes: revokeChanges } }),
            };
          },
        }),
      },
    };

    await expect(
      findLiveIdentity(env as never, "google", "subject-1"),
    ).resolves.toMatchObject({ customer_id: "customer-1" });
    await expect(
      findActiveCustomerIdByEmail(env as never, " Person@Example.Test "),
    ).resolves.toBe("customer-1");
    await expect(
      touchIdentityUse(env as never, "identity-1", 123),
    ).resolves.toBeUndefined();
    await expect(
      listLiveIdentities(env as never, "customer-1"),
    ).resolves.toEqual([
      {
        id: "identity-1",
        provider: "google",
        providerEmail: "person@example.test",
        providerDisplayName: "Person",
        createdAt: 100,
        lastUsedAt: 200,
      },
    ]);
    await expect(
      hasAnotherAuthMethod(env as never, "customer-1", "identity-1"),
    ).resolves.toBe(true);
    await expect(
      revokeIdentity(env as never, "identity-1", "customer-1", 456),
    ).resolves.toBe(true);
    revokeChanges = 0;
    await expect(
      revokeIdentity(env as never, "identity-1", "customer-1", 456),
    ).resolves.toBe(false);

    expect(
      calls.some(({ values }) => values.includes("person@example.test")),
    ).toBe(true);
  });

  it("handles absent identity records and preserves phone-based login as an alternate method", async () => {
    const noIdentityEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({}),
            run: async () => ({ meta: {} }),
          }),
        }),
      },
    };
    const phoneLoginEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ primary_phone: "+886900000000" }),
          }),
        }),
      },
    };

    expect(maskEmail("not-an-email")).toBe("***");
    await expect(
      findActiveCustomerIdByEmail(
        noIdentityEnv as never,
        "nobody@example.test",
      ),
    ).resolves.toBeNull();
    await expect(
      listLiveIdentities(noIdentityEnv as never, "customer-1"),
    ).resolves.toEqual([]);
    await expect(
      hasAnotherAuthMethod(phoneLoginEnv as never, "customer-1", "identity-1"),
    ).resolves.toBe(true);
    await expect(
      revokeIdentity(noIdentityEnv as never, "identity-1", "customer-1", 456),
    ).resolves.toBe(false);
  });
});

async function bindingCookieNameFor(state: string): Promise<string> {
  return `oauth_binding_${(await deriveCodeChallenge(state)).slice(0, 16)}`;
}

oauthRoutes.onError((error, context) => {
  if (error instanceof ApiError) {
    return context.json({ code: error.code }, error.status as 400 | 503);
  }
  return context.json({ code: "UNEXPECTED" }, 500);
});

describe("OAuth start route", () => {
  it("advertises configured providers and saves a PKCE-bound redirect request", async () => {
    const values = new Map<string, string>();
    const cache = {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => values.set(key, value)),
      delete: vi.fn(async (key: string) => values.delete(key)),
    } as unknown as KVNamespace;
    const env = { ...buildEnv(), CACHE_KV: cache };

    const providers = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/providers",
      undefined,
      env as never,
    );
    expect(await providers.json()).toEqual({
      success: true,
      data: { providers: ["line", "google"] },
    });

    const start = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/google/start?redirectTo=/orders",
      undefined,
      env as never,
    );
    expect(start.status).toBe(302);
    const destination = new URL(start.headers.get("location") as string);
    expect(destination.origin).toBe("https://accounts.google.com");
    expect(destination.searchParams.get("client_id")).toBe("google-client");
    expect(destination.searchParams.get("code_challenge_method")).toBe("S256");

    expect(values.size).toBe(1);
    const state = destination.searchParams.get("state") as string;
    const cookieName = await bindingCookieNameFor(state);
    const setCookie = start.headers.get("set-cookie") as string;
    expect(setCookie.startsWith(`${cookieName}=`)).toBe(true);
    expect(setCookie).toMatch(
      /^oauth_binding_[A-Za-z0-9_-]{16}=[A-Za-z0-9_-]{43};/,
    );
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const bindingNonce = /^[^=]+=([^;]+)/.exec(setCookie)?.[1] as string;
    const stored = JSON.parse([...values.values()][0]) as {
      bindingHash: string;
      codeVerifier: string;
      nonce: string;
      redirectTo: string;
    };
    expect(stored).toMatchObject({ redirectTo: "/orders" });
    expect(stored.bindingHash).toBe(await deriveCodeChallenge(bindingNonce));
    expect(stored.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("keeps the first flow's binding intact when a second start follows before its callback", async () => {
    const values = new Map<string, string>();
    const cache = {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => values.set(key, value)),
      delete: vi.fn(async (key: string) => values.delete(key)),
    } as unknown as KVNamespace;
    const env = { ...buildEnv(), CACHE_KV: cache };

    // A browser cookie jar: each start adds its own cookie; same-name cookies
    // would overwrite, which is exactly the double-click failure.
    const jar = new Map<string, string>();
    const starts: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const start = await oauthRoutes.request(
        "https://api.example.test/auth/oauth/google/start",
        undefined,
        env as never,
      );
      expect(start.status).toBe(302);
      starts.push(
        new URL(start.headers.get("location") as string).searchParams.get(
          "state",
        ) as string,
      );
      const [pair] = (start.headers.get("set-cookie") as string).split(";");
      const [name, value] = pair.split("=");
      jar.set(name, value);
    }

    expect(cache.put).toHaveBeenCalledTimes(2);
    expect(starts[0]).not.toBe(starts[1]);
    expect(jar.size).toBe(2);
    for (const state of starts) {
      const saved = JSON.parse(
        values.get(`oauth_state:google:${state}`) as string,
      ) as { bindingHash: string };
      const binding = jar.get(await bindingCookieNameFor(state)) as string;
      expect(binding).toEqual(expect.any(String));
      expect(saved.bindingHash).toBe(await deriveCodeChallenge(binding));
    }
  });

  it("returns safe callback outcomes before attempting a token exchange", async () => {
    const cache = {
      get: vi.fn(async () => null),
      delete: vi.fn(),
    } as unknown as KVNamespace;
    const env = { ...buildEnv(), CACHE_KV: cache };

    const declined = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/google/callback?error=access_denied",
      undefined,
      env as never,
    );
    expect(declined.status).toBe(302);
    expect(declined.headers.get("location")).toBe(
      "http://localhost:3000/login?oauth_error=declined",
    );

    const missing = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/google/callback?state=state-only",
      undefined,
      env as never,
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ code: "OAUTH_CALLBACK_INVALID" });

    const expired = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/google/callback?code=code&state=expired",
      undefined,
      env as never,
    );
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ code: "OAUTH_STATE_INVALID" });
    expect(cache.delete).toHaveBeenCalledWith("oauth_state:google:expired");
  });

  it("consumes an OAuth result code before rejecting an expired completion", async () => {
    const cache = {
      get: vi.fn(async () => null),
      delete: vi.fn(),
    } as unknown as KVNamespace;
    const response = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/complete",
      {
        method: "POST",
        body: JSON.stringify({ code: "expired-result" }),
        headers: { "Content-Type": "application/json" },
      },
      { ...buildEnv(), CACHE_KV: cache } as never,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "OAUTH_RESULT_INVALID" });
    expect(cache.delete).toHaveBeenCalledWith("oauth_result:expired-result");
  });

  it("accepts Apple form-post cancellations and rejects unknown or unconfigured start providers", async () => {
    const env = {
      ...buildEnv({
        APPLE_TEAM_ID: "TEAM",
        APPLE_KEY_ID: "KEY",
        APPLE_CLIENT_ID: "com.example.app",
        APPLE_SIGN_IN_PRIVATE_KEY: "unused-for-declined-callback",
      }),
      CACHE_KV: {},
    };
    const declined = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/apple/callback",
      {
        method: "POST",
        body: new URLSearchParams({ error: "user_cancelled" }),
      },
      env as never,
    );
    expect(declined.status).toBe(302);
    expect(declined.headers.get("location")).toBe(
      "http://localhost:3000/login?oauth_error=declined",
    );

    const unknown = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/not-a-provider/start",
      undefined,
      env as never,
    );
    expect(unknown.status).toBe(404);

    const unavailable = await oauthRoutes.request(
      "https://api.example.test/auth/oauth/apple/start",
      undefined,
      { ...buildEnv(), CACHE_KV: {} } as never,
    );
    expect(unavailable.status).toBe(503);
  });
});

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signedGoogleIdToken(
  keyPair: CryptoKeyPair,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = encodeBase64Url(
    JSON.stringify({ alg: "RS256", kid: "oauth-route-key", typ: "JWT" }),
  );
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keyPair.privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${encodeBase64Url(new Uint8Array(signature))}`;
}

describe("OAuth callback identity resolution", () => {
  it("creates a new customer only after a signed token, nonce, and state all agree", async () => {
    const keyPair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey(
      "jwk",
      keyPair.publicKey,
    )) as JsonWebKey & { kid?: string; alg?: string };
    jwk.kid = "oauth-route-key";
    jwk.alg = "RS256";
    const idToken = await signedGoogleIdToken(keyPair, {
      iss: OAUTH_PROVIDERS.google.issuers[0],
      aud: "google-client",
      sub: "google-subject",
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: "nonce",
      email: "new@example.test",
      email_verified: true,
    });
    const stored = new Map<string, unknown>([
      [
        "oauth_state:google:state",
        {
          codeVerifier: "verifier",
          nonce: "nonce",
          bindingHash: await deriveCodeChallenge("binding"),
        },
      ],
    ]);
    const cache = {
      get: vi.fn(async (key: string) => stored.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) =>
        stored.set(key, JSON.parse(value)),
      ),
      delete: vi.fn(async (key: string) => stored.delete(key)),
    } as unknown as KVNamespace;
    const database = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => null,
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === OAUTH_PROVIDERS.google.tokenUrl) {
        return new Response(
          JSON.stringify({ id_token: idToken, expires_in: 60 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const callback = (cookie?: string) =>
        oauthRoutes.request(
          "https://api.example.test/auth/oauth/google/callback?code=code&state=state",
          cookie ? { headers: { cookie } } : undefined,
          { ...buildEnv(), CACHE_KV: cache, DB: database } as never,
        );

      const cookieName = await bindingCookieNameFor("state");
      // A second, still-pending flow's cookie sits beside this one.
      const otherCookie = `${await bindingCookieNameFor("state-2")}=other-binding`;
      for (const bad of [
        undefined,
        `${cookieName}=attacker`,
        // The other flow's binding must not satisfy this state.
        `${cookieName.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"))}=binding`,
        otherCookie,
      ]) {
        const rejected = await callback(bad);
        expect(rejected.status).toBe(400);
        expect(await rejected.json()).toEqual({ code: "OAUTH_STATE_INVALID" });
        expect(cache.delete).not.toHaveBeenCalled();
        expect(stored.has("oauth_state:google:state")).toBe(true);
        expect(fetchImpl).not.toHaveBeenCalled();
      }

      const response = await callback(`${otherCookie}; ${cookieName}=binding`);
      expect(response.status).toBe(302);
      const cleared = response.headers.get("set-cookie") as string;
      expect(cleared).toContain(`${cookieName}=;`);
      expect(cleared).not.toContain(otherCookie.split("=")[0]);
      expect(
        new URL(response.headers.get("location") as string).searchParams.get(
          "oauth_code",
        ),
      ).toEqual(expect.any(String));
      expect([...stored.keys()]).toContainEqual(
        expect.stringMatching(/^oauth_result:/),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
