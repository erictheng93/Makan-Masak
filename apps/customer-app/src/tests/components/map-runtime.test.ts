import { expect, it, vi } from "vitest";
import { loadMarketMapRuntime } from "@/components/markets/mapRuntime";

const dependencyLoaded = vi.hoisted(() => vi.fn());
const setWorkerUrl = vi.hoisted(() => vi.fn());
const addProtocol = vi.hoisted(() => vi.fn());
const protocolTile = vi.hoisted(() => vi.fn());
const Protocol = vi.hoisted(() =>
  vi.fn().mockImplementation(function () {
    return { tile: protocolTile };
  }),
);

vi.mock("maplibre-gl", () => {
  dependencyLoaded("maplibre");
  return { setWorkerUrl, addProtocol };
});
vi.mock("pmtiles", () => {
  dependencyLoaded("pmtiles");
  return { Protocol };
});
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({
  default: "/assets/maplibre-worker.js",
}));

it("loads the map lazily with its bundled worker and registers PMTiles once", async () => {
  expect(dependencyLoaded).not.toHaveBeenCalled();

  const runtime = await loadMarketMapRuntime();

  expect(dependencyLoaded).toHaveBeenCalledWith("maplibre");
  expect(dependencyLoaded).toHaveBeenCalledWith("pmtiles");
  expect(setWorkerUrl).toHaveBeenCalledWith("/assets/maplibre-worker.js");
  expect(addProtocol).not.toHaveBeenCalled();

  runtime.registerPmTilesProtocol();
  const nextRuntime = await loadMarketMapRuntime();
  nextRuntime.registerPmTilesProtocol();

  expect(Protocol).toHaveBeenCalledExactlyOnceWith({ metadata: true });
  expect(addProtocol).toHaveBeenCalledExactlyOnceWith("pmtiles", protocolTile);
});
