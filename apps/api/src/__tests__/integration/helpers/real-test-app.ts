import type { Hono } from "hono";
import { createApp } from "../../../app-factory";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import type { Env } from "../../../types/env";
import { buildAuthHelper, type AuthHelper } from "./issue-test-jwt";

type TestCachesGlobal = typeof globalThis & {
  caches?: {
    default: {
      match: () => Promise<undefined>;
      put: () => Promise<void>;
      delete: () => Promise<boolean>;
    };
  };
};

const testGlobal = globalThis as TestCachesGlobal;
if (typeof testGlobal.caches === "undefined") {
  testGlobal.caches = {
    default: {
      match: async () => undefined,
      put: async () => {},
      delete: async () => false,
    },
  };
}

export interface RealIntegrationTestApp {
  app: Hono<{ Bindings: Env }>;
  testDb: TestDatabase;
  env: Env;
  authHelper: AuthHelper;
  dispose(): Promise<void>;
}

export interface RealIntegrationTestAppOptions {
  /**
   * Extra env applied over the defaults. A feature that ships switched off --
   * see shared/feature-adoption.ts -- answers 404 until its flag is set, so a
   * suite exercising one has to ask for it here. Making that explicit is the
   * point: the test states which unlaunched feature it depends on rather than
   * silently relying on a default that could change.
   */
  env?: Partial<Env>;
}

export async function createRealIntegrationTestApp(
  options: RealIntegrationTestAppOptions = {},
): Promise<RealIntegrationTestApp> {
  const testDb = await createTestDatabase();
  const env = { ...buildTestEnv(testDb), ...options.env } as Env;
  const honoApp = createApp(env, {
    disableEdgeCache: true,
    disableObservability: true,
  });
  const authHelper = buildAuthHelper(env.DB);

  const app = new Proxy(honoApp, {
    get(target, prop, receiver) {
      if (prop === "fetch") {
        return async (req: Request, envArg?: Env, ctx?: ExecutionContext) => {
          if (ctx) return target.fetch(req, envArg ?? env, ctx);
          // Settle waitUntil work before handing the response back, so a test
          // reading D1/KV right after a write sees the background side effects
          // (search sync, cache sweeps) instead of racing them.
          const background: Array<Promise<unknown>> = [];
          const testCtx = {
            waitUntil: (promise: Promise<unknown>) => {
              background.push(promise);
            },
            passThroughOnException: () => {},
          } as unknown as ExecutionContext;
          const res = await target.fetch(req, envArg ?? env, testCtx);
          await Promise.allSettled(background);
          return res;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof honoApp;

  return {
    app,
    testDb,
    env,
    authHelper,
    dispose: async () => {
      await testDb.dispose();
    },
  };
}

function buildTestEnv(testDb: TestDatabase): Env {
  return {
    NODE_ENV: "development",
    JWT_SECRET: "test-jwt-secret-do-not-use-in-prod",
    QR_SIGNING_KEY: "test-qr-signing-key-32-bytes-minimum",
    API_VERSION: "v1",
    ENCRYPTION_KEY: "test-encryption-key-32-bytes-long!!",
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
    TOKEN_BLACKLIST: testDb.bindings.TOKEN_BLACKLIST,
    RATE_LIMIT_KV: testDb.bindings.RATE_LIMIT_KV,
    IMAGES_BUCKET: testDb.bindings.IMAGES_BUCKET,
    BACKUP_STORAGE: testDb.bindings.BACKUP_STORAGE,
    INTERNAL_API_TOKEN: "test-internal-api-token",
    MANAGEMENT_API: {
      fetch: async (request: Request) => {
        const url = new URL(request.url);
        const parts = url.pathname.split("/");
        const restaurantId =
          parts[parts.indexOf("platform-restaurants") + 1] ?? "test-restaurant";

        return Response.json({
          success: true,
          data: {
            tenant: {
              id: `tenant-${restaurantId}`,
              platformRestaurantId: restaurantId,
            },
          },
        });
      },
    } as Fetcher,
    JOB_QUEUE: { send: async () => {} } as never,
    PRELOAD_QUEUE: { send: async () => {} } as never,
    REVALIDATION_QUEUE: { send: async () => {} } as never,
    REALTIME_ORDERS: undefined as never,
    REALTIME_SESSION: undefined as never,
    ANALYTICS_ENGINE: { writeDataPoint: () => {} },
  } as Env;
}
