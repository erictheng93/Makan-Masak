import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/utils/api-error";
import {
  enforcePiiRevealThrottle,
  PII_REVEAL_THROTTLE,
} from "./pii-reveal-throttle";

const mocks = vi.hoisted(() => ({
  applyRateLimit: vi.fn(),
  constructed: [] as unknown[][],
}));

// The counters live in the D1 ephemeral store; hand it the fake on the env.
vi.mock("../../../shared/utils/ephemeral-store", () => ({
  ephemeralStore: (env: { EPHEMERAL: unknown }) => env.EPHEMERAL,
}));

vi.mock("../../../middleware/geo-rate-limiting", () => ({
  GeoIntelligentRateLimiter: vi.fn(function GeoIntelligentRateLimiter(
    ...args: unknown[]
  ) {
    mocks.constructed.push(args);
    return { applyRateLimit: mocks.applyRateLimit };
  }),
}));

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    env: {
      EPHEMERAL: { get: vi.fn(), put: vi.fn() },
      ANALYTICS_ENGINE: undefined,
      ...(overrides.env as object satisfies object | undefined),
    },
    req: { raw: new Request("https://test/reveal", { method: "POST" }) },
    executionCtx: { waitUntil: vi.fn() },
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.constructed.length = 0;
  mocks.applyRateLimit.mockResolvedValue({ allowed: true });
});

describe("enforcePiiRevealThrottle", () => {
  it("budgets per staff account, not per IP", async () => {
    // The thing being bounded is how much of a customer list one account can
    // copy out by hand. Keying on IP would pool every terminal on a shared
    // restaurant WiFi into one budget -- the mistake that took out QR ordering
    // in #163-#168.
    await enforcePiiRevealThrottle(createContext(), "user-42");

    expect(mocks.applyRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ requests: 30, windowSeconds: 3600 }),
      "pii-reveal:actor:user-42",
    );
  });

  it("passes a copy of the config, so a limiter cannot mutate the shared constant", async () => {
    await enforcePiiRevealThrottle(createContext(), "user-42");

    const passed = mocks.applyRateLimit.mock.calls[0][1];
    expect(passed).toEqual({ ...PII_REVEAL_THROTTLE });
    expect(passed).not.toBe(PII_REVEAL_THROTTLE);
  });

  it("has an effective ceiling of exactly 30 per hour", async () => {
    // burstMultiplier 1 is what makes the documented number the real number.
    expect(PII_REVEAL_THROTTLE.burstMultiplier).toBe(1);
    expect(PII_REVEAL_THROTTLE.requests).toBe(30);
    expect(PII_REVEAL_THROTTLE.windowSeconds).toBe(3600);
  });

  it("throws 429 carrying the limiter's retryAfter when the budget is spent", async () => {
    mocks.applyRateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });

    const error = await enforcePiiRevealThrottle(
      createContext(),
      "user-42",
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(429);
    expect(apiError.code).toBe("PII_REVEAL_RATE_LIMITED");
    expect(apiError.details).toEqual({ retryAfter: 120 });
  });

  it("falls back to the block duration when the limiter gives no retryAfter", async () => {
    mocks.applyRateLimit.mockResolvedValue({ allowed: false });

    const error = (await enforcePiiRevealThrottle(
      createContext(),
      "user-42",
    ).catch((e: unknown) => e)) as ApiError;

    expect(error.details).toEqual({
      retryAfter: PII_REVEAL_THROTTLE.blockDuration,
    });
  });

  it("counts in the ephemeral store, not RATE_LIMIT_KV", async () => {
    const c = createContext();

    await enforcePiiRevealThrottle(c, "user-42");

    expect(mocks.constructed[0][0]).toBe(
      (c as { env: { EPHEMERAL: unknown } }).env.EPHEMERAL,
    );
  });

  it("still runs when executionCtx is unavailable", async () => {
    // Outside a request scope (tests, some runtimes) reading executionCtx
    // throws; the limiter must still be constructed with a usable waitUntil.
    // The getter is defined on the finished object rather than passed through
    // createContext's spread -- a spread *reads* it, so it would throw during
    // setup instead of inside the code under test.
    const c = createContext();
    Object.defineProperty(c, "executionCtx", {
      get(): never {
        throw new Error("executionCtx is not available");
      },
    });

    await expect(
      enforcePiiRevealThrottle(c, "user-42"),
    ).resolves.toBeUndefined();

    const waitUntilArg = mocks.constructed[0][2] as {
      waitUntil: (p: Promise<unknown>) => void;
    };
    expect(() => waitUntilArg.waitUntil(Promise.resolve())).not.toThrow();
  });
});
