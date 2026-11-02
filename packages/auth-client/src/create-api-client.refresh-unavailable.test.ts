import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedApiClient } from "./create-api-client";

function installStorage(seed: Record<string, string>) {
  const values = new Map(Object.entries(seed));
  const adapter = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  vi.stubGlobal("localStorage", adapter);
  vi.stubGlobal("sessionStorage", adapter);
  return values;
}

function httpError(config: InternalAxiosRequestConfig, status?: number) {
  const response =
    status === undefined
      ? undefined
      : { status, statusText: "", data: {}, headers: {}, config };
  return new AxiosError("failed", undefined, config, null, response);
}

/** A client whose protected route always 401s and whose refresh answers `refreshStatus`. */
function buildClient(refreshStatus: number | undefined) {
  const onAuthFailure = vi.fn();
  const client = createAuthenticatedApiClient({
    baseURL: "https://api.test/api/v1",
    storageKeyPrefix: "auth",
    storageKeys: {
      token: "auth_token",
      refreshToken: "auth_refresh_token",
      user: "auth_user",
    },
    onAuthFailure,
  });
  const calls: string[] = [];
  client.instance.defaults.adapter = async (config) => {
    calls.push(config.url ?? "");
    throw httpError(
      config,
      config.url === "/auth/refresh" ? refreshStatus : 401,
    );
  };
  return { client, onAuthFailure, calls };
}

describe("refresh failing while the access token is rejected", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("document", { cookie: "" });
  });

  it.each([503, 500, 429, undefined])(
    "keeps the session when the refresh endpoint answers %s",
    async (refreshStatus) => {
      const values = installStorage({ auth_token: "stale" });
      const { client, onAuthFailure, calls } = buildClient(refreshStatus);

      await expect(client.instance.get("/orders")).rejects.toMatchObject({
        response: { status: 401 },
      });

      expect(calls).toEqual(["/orders", "/auth/refresh"]);
      expect(onAuthFailure).not.toHaveBeenCalled();
      expect(values.get("auth_token")).toBe("stale");
    },
  );

  it.each([400, 401, 403])(
    "still ends the session when the refresh endpoint rejects with %s",
    async (refreshStatus) => {
      const values = installStorage({ auth_token: "stale" });
      const { client, onAuthFailure } = buildClient(refreshStatus);

      await expect(client.instance.get("/orders")).rejects.toMatchObject({
        response: { status: 401 },
      });

      expect(onAuthFailure).toHaveBeenCalled();
      expect(values.get("auth_token")).toBeUndefined();
    },
  );
});
