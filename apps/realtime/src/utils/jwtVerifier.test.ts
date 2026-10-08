import { beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "jsonwebtoken";
import {
  extractTokenFromUrl,
  isTokenRevoked,
  verifyWebSocketToken,
} from "./jwtVerifier";

const secret = "0123456789abcdefghijklmnopqrstuvwxyz";

const tokenFor = (payload: Record<string, unknown>) =>
  sign(
    {
      roomType: "admin",
      roomId: "restaurant-42",
      restaurantId: "restaurant-42",
      role: "admin",
      ...payload,
    },
    secret,
    { expiresIn: "1h" },
  );

async function tokenHashId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `sha256:${hash}`;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("isTokenRevoked", () => {
  it("treats missing blacklist storage as not revoked", async () => {
    await expect(isTokenRevoked("token", undefined)).resolves.toBe(false);
  });

  it("checks token revocation by SHA-256 token hash", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue("revoked"),
    } as Partial<KVNamespace> as KVNamespace;
    const token = `${"a".repeat(45)}${"z".repeat(10)}`;

    await expect(isTokenRevoked(token, kv)).resolves.toBe(true);
    expect(kv.get).toHaveBeenCalledWith(
      `token:revoked:${await tokenHashId(token)}`,
    );
  });

  it("fails closed when blacklist lookup throws", async () => {
    const kv = {
      get: vi.fn().mockRejectedValue(new Error("kv unavailable")),
    } as Partial<KVNamespace> as KVNamespace;

    await expect(isTokenRevoked("token", kv)).resolves.toBe(true);
  });
});

describe("verifyWebSocketToken", () => {
  it("accepts valid realtime JWT payloads", async () => {
    const token = tokenFor({});

    await expect(verifyWebSocketToken(token, secret)).resolves.toMatchObject({
      valid: true,
      payload: {
        roomType: "admin",
        roomId: "restaurant-42",
        restaurantId: "restaurant-42",
        role: "admin",
      },
    });
  });

  it("rejects missing tokens and weak server secrets before verification", async () => {
    await expect(verifyWebSocketToken("", secret)).resolves.toEqual({
      valid: false,
      error: "Token is required",
    });

    await expect(
      verifyWebSocketToken(tokenFor({}), "too-short"),
    ).resolves.toEqual({
      valid: false,
      error: "Server configuration error",
    });
  });

  it("rejects a forged token without spending a blacklist read", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(null),
    } as Partial<KVNamespace> as KVNamespace;
    const forged = sign({ roomType: "admin" }, "x".repeat(32));

    await expect(
      verifyWebSocketToken(forged, secret, kv),
    ).resolves.toMatchObject({ valid: false });
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("rejects revoked tokens once the signature checks out", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue("revoked"),
    } as Partial<KVNamespace> as KVNamespace;

    await expect(
      verifyWebSocketToken(tokenFor({}), secret, kv),
    ).resolves.toEqual({
      valid: false,
      error: "Token has been revoked",
      revoked: true,
    });
  });

  it("requires realtime room claims and guest token consistency", async () => {
    await expect(
      verifyWebSocketToken(
        sign({ roomType: "admin", restaurantId: "restaurant-42" }, secret, {
          expiresIn: "1h",
        }),
        secret,
      ),
    ).resolves.toEqual({
      valid: false,
      error: "Invalid token payload: missing required fields",
    });

    await expect(
      verifyWebSocketToken(
        tokenFor({
          roomType: "customer",
          roomId: "customer:table-99",
          role: "customer",
          guestFlag: true,
          tableId: "table-42",
        }),
        secret,
      ),
    ).resolves.toEqual({
      valid: false,
      error: "Invalid guest token payload",
    });

    await expect(
      verifyWebSocketToken(
        tokenFor({
          roomType: "customer",
          roomId: "order:018f0000-0000-7000-8000-000000000042",
          role: "customer",
          guestFlag: true,
          scope: "guest-realtime",
          orderId: "018f0000-0000-7000-8000-000000000042",
        }),
        secret,
      ),
    ).resolves.toMatchObject({
      valid: true,
      payload: {
        roomId: "order:018f0000-0000-7000-8000-000000000042",
        orderId: "018f0000-0000-7000-8000-000000000042",
      },
    });
  });

  it("maps invalid and expired JWT failures to stable errors", async () => {
    await expect(verifyWebSocketToken("not-a-jwt", secret)).resolves.toEqual({
      valid: false,
      error: "Invalid token format",
    });

    const expired = sign(
      {
        roomType: "admin",
        roomId: "restaurant-42",
        restaurantId: "restaurant-42",
      },
      secret,
      { expiresIn: -1 },
    );

    await expect(verifyWebSocketToken(expired, secret)).resolves.toEqual({
      valid: false,
      error: "Token has expired",
    });
  });

  it("rejects tokens signed with algorithms outside the pinned allowlist", async () => {
    const token = sign(
      {
        roomType: "admin",
        roomId: "restaurant-42",
        restaurantId: "restaurant-42",
        role: "admin",
      },
      secret,
      { algorithm: "HS384", expiresIn: "1h" },
    );

    await expect(verifyWebSocketToken(token, secret)).resolves.toEqual({
      valid: false,
      error: "Invalid token format",
    });
  });
});

describe("extractTokenFromUrl", () => {
  it("extracts token query parameters", () => {
    expect(
      extractTokenFromUrl(new URL("https://rt.example/ws?token=abc123")),
    ).toBe("abc123");
    expect(extractTokenFromUrl(new URL("https://rt.example/ws"))).toBeNull();
  });
});
