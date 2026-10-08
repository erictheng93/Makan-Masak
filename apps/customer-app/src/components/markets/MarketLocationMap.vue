<template>
  <section
    v-if="hasMarketCoordinates"
    data-testid="market-location-map"
    class="space-y-4 rounded-xl border border-gray-200 bg-white p-4"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-gray-900">
          {{ t("markets.map.title") }}
        </h2>
        <p
          data-testid="market-location-address"
          class="mt-1 text-sm leading-5 text-gray-500"
        >
          {{ market.address || `${market.city}${market.district}` }}
        </p>
      </div>
      <a
        data-testid="market-location-navigation"
        :href="navigationUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="shrink-0 rounded-lg bg-ios-blue px-3 py-2 text-sm font-semibold text-white"
      >
        {{ t("markets.map.navigate") }}
      </a>
    </div>

    <div
      ref="mapContainer"
      data-testid="market-location-map-canvas"
      class="h-72 overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
      :aria-label="t('markets.map.canvasLabel')"
    ></div>
    <p v-if="mapLoadError" class="text-sm text-gray-500">
      {{ t("markets.map.loadError") }}
    </p>

    <div class="flex flex-wrap gap-2 text-xs text-gray-500">
      <span class="rounded bg-gray-50 px-2 py-1">
        {{
          tWithParams("markets.map.vendorCoords", {
            count: plottedVendorCount,
          })
        }}
      </span>
      <span v-if="market.boundaryGeojson" class="rounded bg-gray-50 px-2 py-1">
        {{ t("markets.map.boundaryMarked") }}
      </span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import "maplibre-gl/dist/maplibre-gl.css";
import type * as MapLibreGL from "maplibre-gl";
import type {
  LngLatLike,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import type {
  MarketDetail,
  MarketGeoJsonBoundary,
  MarketVendor,
} from "@/services/marketsApi";
import { loadMarketMapRuntime } from "./mapRuntime";
import { useI18n } from "@/composables/useI18n";

const PRODUCTION_PM_TILES_URL =
  "https://pub-2c3683e1158d4d579317f24fc66a34b3.r2.dev/taiwan.pmtiles";
const PRODUCTION_MAP_GLYPHS_URL =
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const DEMO_STYLE_URL = "https://demotiles.maplibre.org/style.json";
const DEMO_GLYPHS_URL =
  "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

const props = defineProps<{
  market: MarketDetail;
  vendors: MarketVendor[];
}>();

const { t, tWithParams } = useI18n();

const mapContainer = ref<HTMLElement | null>(null);
const mapLoadError = ref(false);
let map: MapLibreMap | null = null;
let disposed = false;

const hasMarketCoordinates = computed(
  () =>
    Number.isFinite(props.market.latitude) &&
    Number.isFinite(props.market.longitude),
);

const plottedVendors = computed(() =>
  props.vendors.filter(
    (vendor) =>
      Number.isFinite(vendor.latitude) && Number.isFinite(vendor.longitude),
  ),
);

const plottedVendorCount = computed(() => plottedVendors.value.length);

const marketCenter = computed<LngLatLike>(() => [
  props.market.longitude,
  props.market.latitude,
]);

const navigationUrl = computed(() => {
  const destination = `${props.market.latitude},${props.market.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destination,
  )}`;
});

onMounted(async () => {
  await nextTick();
  try {
    await initializeMap();
  } catch (error) {
    mapLoadError.value = true;
    console.error("Failed to initialize market location map:", error);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  map?.remove();
  map = null;
});

async function initializeMap() {
  if (!mapContainer.value || !hasMarketCoordinates.value) return;

  const { maplibregl, registerPmTilesProtocol } = await loadMarketMapRuntime();
  if (disposed) return;

  registerPmTilesProtocol();

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: mapStyle(),
    center: marketCenter.value,
    zoom: 15,
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");

  map.on("load", () => {
    renderBoundary();
    renderMarkers(maplibregl);
    fitMapToKnownCoordinates(maplibregl);
    map?.resize();
  });
}

function mapStyle(): string | StyleSpecification {
  const configuredStyle = import.meta.env.VITE_MAP_STYLE_URL;
  if (configuredStyle) return configuredStyle;

  const pmTilesUrl =
    import.meta.env.VITE_MAP_PM_TILES_URL ||
    (import.meta.env.PROD ? PRODUCTION_PM_TILES_URL : "");
  if (!pmTilesUrl) return DEMO_STYLE_URL;

  const glyphsUrl =
    import.meta.env.VITE_MAP_GLYPHS_URL ||
    (import.meta.env.PROD ? PRODUCTION_MAP_GLYPHS_URL : DEMO_GLYPHS_URL);

  return {
    version: 8,
    glyphs: glyphsUrl,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${pmTilesUrl}`,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f8fafc" },
      },
      {
        id: "water",
        type: "fill",
        source: "protomaps",
        "source-layer": "water",
        paint: { "fill-color": "#bfdbfe" },
      },
      {
        id: "buildings",
        type: "fill",
        source: "protomaps",
        "source-layer": "buildings",
        paint: { "fill-color": "#e5e7eb", "fill-opacity": 0.45 },
      },
      {
        id: "roads",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: {
          "line-color": "#f97316",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 17, 4],
        },
      },
      {
        id: "pois",
        type: "circle",
        source: "protomaps",
        "source-layer": "pois",
        paint: {
          "circle-color": "#facc15",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1, 17, 4],
          "circle-opacity": 0.75,
        },
      },
      {
        id: "places",
        type: "symbol",
        source: "protomaps",
        "source-layer": "places",
        layout: {
          "text-field": ["coalesce", ["get", "name:zh"], ["get", "name"]],
          "text-size": 12,
        },
        paint: {
          "text-color": "#111827",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      },
    ],
  };
}

function renderBoundary() {
  if (!map || !props.market.boundaryGeojson) return;

  map.addSource("market-boundary", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: { name: props.market.name },
      geometry: props.market.boundaryGeojson,
    },
  });
  map.addLayer({
    id: "market-boundary-fill",
    type: "fill",
    source: "market-boundary",
    paint: {
      "fill-color": "#2563eb",
      "fill-opacity": 0.12,
    },
  });
  map.addLayer({
    id: "market-boundary-outline",
    type: "line",
    source: "market-boundary",
    paint: {
      "line-color": "#2563eb",
      "line-width": 2,
    },
  });
}

function renderMarkers(maplibregl: typeof MapLibreGL) {
  if (!map) return;

  new maplibregl.Marker({ color: "#2563eb" })
    .setLngLat([props.market.longitude, props.market.latitude])
    .setPopup(new maplibregl.Popup({ offset: 16 }).setText(props.market.name))
    .addTo(map);

  for (const vendor of plottedVendors.value) {
    const name = vendor.stallNumber
      ? tWithParams("markets.map.vendorPopup", {
          name: vendor.name,
          stall: vendor.stallNumber,
        })
      : vendor.name;
    new maplibregl.Marker({
      color: vendor.isOpen ? "#2da34c" : "#6b7280",
      scale: 0.82,
    })
      .setLngLat([vendor.longitude as number, vendor.latitude as number])
      .setPopup(
        new maplibregl.Popup({ offset: 14 }).setText(
          vendor.isOpen
            ? name
            : `${name} · ${t("markets.vendors.notOpenToday")}`,
        ),
      )
      .addTo(map);
  }
}

function fitMapToKnownCoordinates(maplibregl: typeof MapLibreGL) {
  if (!map) return;

  const bounds = new maplibregl.LngLatBounds(
    [props.market.longitude, props.market.latitude],
    [props.market.longitude, props.market.latitude],
  );

  for (const vendor of plottedVendors.value) {
    bounds.extend([vendor.longitude as number, vendor.latitude as number]);
  }

  for (const coordinate of boundaryCoordinates(props.market.boundaryGeojson)) {
    bounds.extend(coordinate);
  }

  map.fitBounds(bounds, {
    padding: 40,
    maxZoom: 17,
    duration: 0,
  });
}

function boundaryCoordinates(boundary?: MarketGeoJsonBoundary | null) {
  if (!boundary) return [];

  const positions: Array<[number, number]> = [];
  const scan = (value: unknown) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      positions.push([value[0], value[1]]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(scan);
    }
  };
  scan(boundary.coordinates);
  return positions;
}
</script>
