<template>
  <section
    v-if="mappedVendors.length > 0"
    data-testid="stall-map"
    class="space-y-4 rounded-xl border border-gray-200 bg-white p-4"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-gray-900">
          {{ mapTitle }}
        </h2>
        <p class="mt-1 text-sm leading-5 text-gray-500">
          {{ mapDescription }}
        </p>
      </div>
      <div class="shrink-0 text-right">
        <span
          class="inline-flex rounded bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600"
        >
          {{
            tWithParams("markets.common.stallCount", {
              count: mappedVendors.length,
            })
          }}
        </span>
        <p class="mt-1 text-xs text-gray-500">
          {{
            tWithParams("markets.stallMap.openCount", {
              count: openVendorCount,
            })
          }}
        </p>
      </div>
    </div>

    <div class="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3">
      <div class="flex items-center justify-between text-xs text-gray-500">
        <span>{{ t("markets.stallMap.entrance") }}</span>
        <span>{{ t("markets.stallMap.aisle") }}</span>
        <span>{{ t("markets.stallMap.exit") }}</span>
      </div>
      <div class="mt-2 h-1 rounded-full bg-gray-200">
        <div class="h-1 w-2/3 rounded-full bg-ios-blue/60"></div>
      </div>
    </div>

    <div
      v-if="positionedVendors.length > 0"
      data-testid="stall-position-map"
      class="relative min-h-[18rem] overflow-hidden rounded-lg border border-gray-200 bg-white bg-cover bg-center"
      :aria-label="t('markets.stallMap.positionMapLabel')"
      :style="positionMapStyle"
    >
      <template v-if="!layout?.imageUrl">
        <div
          class="absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-gray-200"
          aria-hidden="true"
        ></div>
        <div
          class="absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-gray-200"
          aria-hidden="true"
        ></div>
      </template>
      <button
        v-for="vendor in positionedVendors"
        :key="vendor.restaurantId"
        type="button"
        class="absolute min-h-[4.5rem] w-32 max-w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white px-2 py-2 text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-ios-blue focus:ring-offset-2"
        :class="
          vendor.isOpen ? 'border-ios-blue/40' : 'border-gray-200 opacity-80'
        "
        :style="{
          left: `${mapAxis(vendor, 'x')}%`,
          top: `${mapAxis(vendor, 'y')}%`,
        }"
        :data-testid="`stall-position-vendor-${vendor.restaurantId}`"
        :data-status="vendor.isOpen ? 'open' : 'closed-today'"
        :disabled="!vendor.isOpen"
        @click="$emit('selectVendor', vendor)"
      >
        <span class="block text-[11px] font-semibold text-ios-blue">
          {{
            tWithParams("markets.common.stallWithNumber", {
              number: vendor.stallNumber,
            })
          }}
        </span>
        <span class="mt-1 block truncate text-xs font-semibold text-gray-900">
          {{ vendor.name }}
        </span>
        <span class="mt-1 block text-[11px] text-gray-500">
          {{ vendor.locationLabel || t("markets.common.unzoned") }}
        </span>
        <span
          v-if="!vendor.isOpen"
          class="mt-1 block text-[11px] font-medium text-ios-secondary"
        >
          {{ t("markets.vendors.notOpenToday") }}
        </span>
      </button>
    </div>

    <div v-if="groupedVendors.length > 0" class="space-y-4">
      <div
        v-for="group in groupedVendors"
        :key="group.locationLabel"
        class="space-y-2"
        data-testid="stall-map-lane"
      >
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-gray-800">
            {{ group.locationLabel }}
          </h3>
          <span class="text-xs text-gray-500">
            {{
              tWithParams("markets.common.stallCount", {
                count: group.vendors.length,
              })
            }}
          </span>
        </div>

        <div
          class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2"
          :aria-label="
            tWithParams('markets.stallMap.laneLabel', {
              zone: group.locationLabel,
            })
          "
        >
          <div class="relative flex justify-center" aria-hidden="true">
            <div class="absolute inset-y-3 w-px bg-ios-blue/20"></div>
            <div class="mt-3 h-3 w-3 rounded-full bg-ios-blue"></div>
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button
              v-for="vendor in group.vendors"
              :key="vendor.restaurantId"
              type="button"
              class="min-h-[6.5rem] rounded-lg border bg-white px-3 py-2 text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-ios-blue focus:ring-offset-2"
              :class="
                vendor.isOpen
                  ? 'border-ios-blue/30'
                  : 'border-gray-200 opacity-80'
              "
              :data-testid="`stall-map-vendor-${vendor.restaurantId}`"
              :data-status="vendor.isOpen ? 'open' : 'closed-today'"
              :disabled="!vendor.isOpen"
              @click="$emit('selectVendor', vendor)"
            >
              <span class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold text-ios-blue">
                  {{
                    tWithParams("markets.common.stallWithNumber", {
                      number: vendor.stallNumber,
                    })
                  }}
                </span>
                <span
                  class="rounded px-1.5 py-0.5 text-[11px] font-medium"
                  :class="
                    vendor.isOpen
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-gray-100 text-gray-500'
                  "
                >
                  {{
                    vendor.isOpen
                      ? t("markets.common.openShort")
                      : t("markets.vendors.notOpenToday")
                  }}
                </span>
              </span>
              <span
                class="mt-2 block min-h-[2.5rem] text-sm font-semibold leading-5 text-gray-900"
              >
                {{ vendor.name }}
              </span>
              <span class="mt-2 flex flex-wrap gap-1">
                <span
                  v-if="vendor.availableMenuItemCount > 0"
                  class="rounded bg-ios-blue/10 px-1.5 py-0.5 text-[11px] font-medium text-ios-blue"
                >
                  {{
                    tWithParams("markets.stallMap.menuCount", {
                      count: vendor.availableMenuItemCount,
                    })
                  }}
                </span>
                <span
                  v-if="vendor.publicServiceItemCount > 0"
                  class="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
                >
                  {{
                    tWithParams("markets.stallMap.serviceCount", {
                      count: vendor.publicServiceItemCount,
                    })
                  }}
                </span>
                <span
                  v-if="
                    vendor.availableMenuItemCount <= 0 &&
                    vendor.publicServiceItemCount <= 0
                  "
                  class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500"
                >
                  {{ t("markets.common.dataPending") }}
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MarketMapLayout, MarketVendor } from "@/services/marketsApi";
import { useI18n } from "@/composables/useI18n";

const props = defineProps<{
  vendors: MarketVendor[];
  layout?: MarketMapLayout | null;
}>();

defineEmits<{
  selectVendor: [vendor: MarketVendor];
}>();

const { t, tWithParams } = useI18n();

const mappedVendors = computed(() =>
  props.vendors
    .filter((vendor) => vendor.stallNumber?.trim())
    .sort((left, right) =>
      String(left.stallNumber).localeCompare(
        String(right.stallNumber),
        "zh-Hant",
        {
          numeric: true,
        },
      ),
    ),
);

const positionedVendors = computed(() =>
  mappedVendors.value.filter(
    (vendor) =>
      vendor.mapPosition &&
      Number.isFinite(vendor.mapPosition.x) &&
      Number.isFinite(vendor.mapPosition.y),
  ),
);

const openVendorCount = computed(
  () => mappedVendors.value.filter((vendor) => vendor.isOpen).length,
);

const mapTitle = computed(
  () => props.layout?.title?.trim() || t("markets.stallMap.defaultTitle"),
);

const mapDescription = computed(
  () =>
    props.layout?.description?.trim() ||
    t("markets.stallMap.defaultDescription"),
);

const positionMapStyle = computed(() => {
  const style: Record<string, string> = {};
  if (props.layout?.imageUrl) {
    style.backgroundImage = `url("${props.layout.imageUrl}")`;
  }
  if (props.layout?.width && props.layout?.height) {
    style.aspectRatio = `${props.layout.width} / ${props.layout.height}`;
  }
  return style;
});

const groupedVendors = computed(() => {
  const groups = new Map<string, MarketVendor[]>();

  for (const vendor of mappedVendors.value.filter(
    (vendor) => !positionedVendors.value.includes(vendor),
  )) {
    const label = vendor.locationLabel?.trim() || t("markets.common.unzoned");
    groups.set(label, [...(groups.get(label) ?? []), vendor]);
  }

  return Array.from(groups.entries()).map(([locationLabel, vendors]) => ({
    locationLabel,
    vendors,
  }));
});

function mapAxis(vendor: MarketVendor, axis: "x" | "y") {
  return vendor.mapPosition?.[axis] ?? 50;
}
</script>
