import type * as maplibregl from "maplibre-gl";
import type * as pmtiles from "pmtiles";

let protocolRegistered = false;

export interface MarketMapRuntime {
  maplibregl: typeof maplibregl;
  registerPmTilesProtocol: () => void;
}

export async function loadMarketMapRuntime(): Promise<MarketMapRuntime> {
  const [maplibreApi, pmtilesModule, { default: workerUrl }] =
    await Promise.all([
      import("maplibre-gl"),
      import("pmtiles"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    ]);
  maplibreApi.setWorkerUrl(workerUrl);
  const pmtilesApi = moduleDefault(pmtilesModule) as {
    Protocol: typeof pmtiles.Protocol;
  };

  return {
    maplibregl: maplibreApi,
    registerPmTilesProtocol: () => {
      if (protocolRegistered) return;

      const protocol = new pmtilesApi.Protocol({ metadata: true });
      maplibreApi.addProtocol("pmtiles", protocol.tile);
      protocolRegistered = true;
    },
  };
}

function moduleDefault<T>(module: T): T extends { default: infer U } ? U : T {
  return "default" in (module as Record<string, unknown>)
    ? ((module as { default: unknown }).default as never)
    : (module as never);
}
