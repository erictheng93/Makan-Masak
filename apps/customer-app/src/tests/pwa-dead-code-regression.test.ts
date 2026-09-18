// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const appRoot = resolve(__dirname, "../..");

const removedPwaModules = [
  "src/utils/pwa-performance-optimizer.ts",
  "src/utils/offline-storage-optimized.ts",
  "src/utils/offline-storage.ts",
] as const;

const viteConfigFiles = ["vite.config.ts", "vite.config.optimized.ts"] as const;

describe("customer-app PWA dead code regression", () => {
  it("ships the PNG icons referenced by the web app manifest", () => {
    for (const configFile of viteConfigFiles) {
      const manifestSource = readFileSync(resolve(appRoot, configFile), "utf8");
      const referencedPngIcons = [
        ...manifestSource.matchAll(/src: "\/(pwa-\d+x\d+\.png)"/g),
      ].map((match) => match[1]);

      expect(new Set(referencedPngIcons)).toEqual(
        new Set(["pwa-192x192.png", "pwa-512x512.png"]),
      );

      for (const icon of referencedPngIcons) {
        const iconPath = resolve(appRoot, "public", icon);

        expect(existsSync(iconPath), `${configFile}: ${icon}`).toBe(true);
        expect(readFileSync(iconPath).subarray(0, 8)).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
      }
    }
  });

  it("does not ship the unused PWA optimizer or offline storage modules", () => {
    for (const modulePath of removedPwaModules) {
      expect(existsSync(resolve(appRoot, modulePath)), modulePath).toBe(false);
    }

    const mainSource = readFileSync(resolve(appRoot, "src/main.ts"), "utf8");

    expect(mainSource).not.toContain("PWAPerformanceManager");
    expect(mainSource).not.toContain("pwa-performance-optimizer");
    expect(mainSource).not.toContain("/assets/critical.css");
    expect(mainSource).not.toContain("/assets/app-shell.js");
  });

  it("reloads when an updated service worker takes control", () => {
    const mainSource = readFileSync(resolve(appRoot, "src/main.ts"), "utf8");
    const viteConfig = readFileSync(resolve(appRoot, "vite.config.ts"), "utf8");

    expect(viteConfig).toContain("injectRegister: false");
    expect(viteConfig).toContain("skipWaiting: true");
    expect(viteConfig).toContain("clientsClaim: true");
    expect(mainSource).toContain('from "virtual:pwa-register"');
    expect(mainSource).toMatch(/registerSW\(\{\s*immediate:\s*true\s*\}\)/);
  });

  it("does not register API responses for service-worker runtime caching", () => {
    for (const configFile of viteConfigFiles) {
      const viteConfig = readFileSync(resolve(appRoot, configFile), "utf8");

      expect(viteConfig).not.toMatch(/urlPattern:\s*\/\^https:\\\/\\\/api\\/);
      expect(viteConfig).not.toContain("api-cache");
    }
  });

  it("prevents HTTP cache from delaying worker update checks", () => {
    const headers = readFileSync(resolve(appRoot, "public/_headers"), "utf8");

    expect(headers).toMatch(/\/sw\.js\s+Cache-Control: no-cache/s);
    expect(headers).toMatch(/\/registerSW\.js\s+Cache-Control: no-cache/s);
  });

  it("reloads old clients after a replacement worker activates", async () => {
    const listeners = new Map<string, (event: Event) => void>();
    const navigate = vi.fn().mockResolvedValue(undefined);
    const cacheDelete = vi.fn().mockResolvedValue(true);
    const entries = new Map<string, Response>();
    const match = vi.fn((key: string) => Promise.resolve(entries.get(key)));
    const put = vi.fn((key: string, value: Response) => {
      entries.set(key, value);
      return Promise.resolve();
    });
    const open = vi.fn().mockResolvedValue({
      match,
      put,
      delete: vi.fn().mockResolvedValue(true),
    });
    const waitUntil: Promise<unknown>[] = [];
    const self = {
      addEventListener: vi.fn(
        (type: string, listener: (event: Event) => void) => {
          listeners.set(type, listener);
        },
      ),
      registration: { active: {} },
      clients: {
        matchAll: vi
          .fn()
          .mockResolvedValue([
            { url: "https://makanmasak.com/restaurant/shop/menu", navigate },
          ]),
      },
    };

    runInNewContext(
      readFileSync(resolve(appRoot, "public/sw-cache-cleanup.js"), "utf8"),
      { self, caches: { open, delete: cacheDelete }, Promise, Response },
    );
    const installWork: Promise<unknown>[] = [];
    listeners.get("install")?.({
      waitUntil: (work: Promise<unknown>) => installWork.push(work),
    } as unknown as Event);
    await Promise.all(installWork);
    // The browser may stop the worker between lifecycle events. Pending
    // migration intent must survive a fresh worker global at activation.
    runInNewContext(
      readFileSync(resolve(appRoot, "public/sw-cache-cleanup.js"), "utf8"),
      { self, caches: { open, delete: cacheDelete }, Promise, Response },
    );
    listeners.get("activate")?.({
      waitUntil: (work: Promise<unknown>) => waitUntil.push(work),
    } as unknown as Event);
    await Promise.all(waitUntil);

    expect(cacheDelete).toHaveBeenCalledWith("api-cache");
    expect(open).toHaveBeenCalledWith("makanmasak-sw-migration");
    expect(put).toHaveBeenCalledTimes(2);
    expect(self.clients.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(navigate).toHaveBeenCalledWith(
      "https://makanmasak.com/restaurant/shop/menu",
    );
  });

  it("leaves later updates to the PWA registration reload listener", async () => {
    const listeners = new Map<string, (event: Event) => void>();
    const navigate = vi.fn().mockResolvedValue(undefined);
    const waitUntil: Promise<unknown>[] = [];
    const self = {
      addEventListener: vi.fn(
        (type: string, listener: (event: Event) => void) => {
          listeners.set(type, listener);
        },
      ),
      registration: { active: {} },
      clients: {
        matchAll: vi.fn().mockResolvedValue([{ navigate }]),
      },
    };

    const migrationCache = {
      match: vi.fn((key: string) =>
        Promise.resolve(
          key === "/issue-395-complete" ? new Response("1") : undefined,
        ),
      ),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
    };
    runInNewContext(
      readFileSync(resolve(appRoot, "public/sw-cache-cleanup.js"), "utf8"),
      {
        self,
        caches: {
          open: vi.fn().mockResolvedValue(migrationCache),
          delete: vi.fn().mockResolvedValue(true),
        },
        Promise,
        Response,
      },
    );
    const installWork: Promise<unknown>[] = [];
    listeners.get("install")?.({
      waitUntil: (work: Promise<unknown>) => installWork.push(work),
    } as unknown as Event);
    await Promise.all(installWork);
    listeners.get("activate")?.({
      waitUntil: (work: Promise<unknown>) => waitUntil.push(work),
    } as unknown as Event);
    await Promise.all(waitUntil);

    expect(self.clients.matchAll).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  function stubIndexedDB() {
    const deletedDatabases: string[] = [];
    const open = vi.fn();
    const deleteDatabase = vi.fn((name: string) => {
      deletedDatabases.push(name);
      const request = {};
      queueMicrotask(() => {
        (request as IDBOpenDBRequest).onsuccess?.(new Event("success"));
      });
      return request as IDBOpenDBRequest;
    });

    vi.stubGlobal("indexedDB", { open, deleteDatabase });
    return { open, deleteDatabase, deletedDatabases };
  }

  function stubLocalStorage() {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
      clear: () => values.clear(),
    });
    return values;
  }

  it("cleans known empty legacy IndexedDBs without opening new databases", async () => {
    const { open, deleteDatabase, deletedDatabases } = stubIndexedDB();
    stubLocalStorage();

    const { LEGACY_CUSTOMER_INDEXED_DB_NAMES, cleanupLegacyPWAStorage } =
      await import("../utils/legacy-pwa-storage-cleanup");

    await cleanupLegacyPWAStorage();

    expect(open).not.toHaveBeenCalled();
    expect(deleteDatabase).toHaveBeenCalledTimes(
      LEGACY_CUSTOMER_INDEXED_DB_NAMES.length,
    );
    expect(deletedDatabases).toEqual(LEGACY_CUSTOMER_INDEXED_DB_NAMES);
  });

  // Without this the cleanup becomes what it removed: six IndexedDB round
  // trips on every page load of the busiest app, for the rest of time.
  it("sweeps once and then stays out of the way", async () => {
    const { deleteDatabase } = stubIndexedDB();
    const stored = stubLocalStorage();

    const { LEGACY_CLEANUP_DONE_KEY, cleanupLegacyPWAStorage } =
      await import("../utils/legacy-pwa-storage-cleanup");

    await cleanupLegacyPWAStorage();
    expect(stored.get(LEGACY_CLEANUP_DONE_KEY)).toBe("1");

    const callsAfterFirstSweep = deleteDatabase.mock.calls.length;
    await cleanupLegacyPWAStorage();

    expect(deleteDatabase.mock.calls.length).toBe(callsAfterFirstSweep);
  });

  it("still sweeps when storage is unavailable", async () => {
    const { deleteDatabase } = stubIndexedDB();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
      clear: () => undefined,
    });

    const { cleanupLegacyPWAStorage } =
      await import("../utils/legacy-pwa-storage-cleanup");

    await expect(cleanupLegacyPWAStorage()).resolves.toBeUndefined();
    expect(deleteDatabase).toHaveBeenCalled();
  });
});
