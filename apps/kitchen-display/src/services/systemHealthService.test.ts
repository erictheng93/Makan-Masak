import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./performanceService", () => ({
  performanceService: { getMetrics: vi.fn(() => []) },
}));
vi.mock("./errorReportingService", () => ({
  errorReportingService: { reportError: vi.fn() },
}));
vi.mock("./offlineService", () => ({ offlineService: {} }));
vi.mock("./enhancedAudioService", () => ({ enhancedAudioService: {} }));

type ProbeService = { testNetworkConnectivity(): Promise<boolean> };

// Re-import so the singleton reads the stubbed VITE_API_BASE_URL.
async function loadService(): Promise<ProbeService> {
  vi.resetModules();
  const { systemHealthService } = await import("./systemHealthService");
  return systemHealthService as unknown as ProbeService;
}

describe("systemHealthService connectivity probe", () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    await import("./systemHealthService");
  }, 30_000);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("probes /info on the API origin, not the kitchen's own host", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.makanmasak.com/api/v1");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect((await loadService()).testNetworkConnectivity()).resolves.toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.makanmasak.com/info",
      expect.objectContaining({ method: "GET", credentials: "omit" }),
    );
  });

  it("stays relative for the dev proxy when the base is relative", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "/api/v1");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await (await loadService()).testNetworkConnectivity();
    expect(fetchMock).toHaveBeenCalledWith("/info", expect.any(Object));
  });
});
