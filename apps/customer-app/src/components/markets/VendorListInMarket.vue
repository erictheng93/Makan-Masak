<template>
  <section class="space-y-3">
    <div class="flex items-center gap-2">
      <input
        :value="query"
        type="search"
        class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
        :placeholder="t('markets.vendors.searchPlaceholder')"
        @input="
          $emit('update:query', ($event.target as HTMLInputElement).value)
        "
      />
      <label
        class="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
      >
        <input
          :checked="takeawayOnly"
          type="checkbox"
          class="rounded border-gray-300 text-ios-blue focus:ring-ios-blue"
          @change="
            $emit(
              'update:takeawayOnly',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        {{ t("markets.common.takeaway") }}
      </label>
      <label
        class="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
      >
        <input
          :checked="deliveryOnly"
          data-testid="vendor-delivery-filter"
          type="checkbox"
          class="rounded border-gray-300 text-ios-blue focus:ring-ios-blue"
          @change="
            $emit(
              'update:deliveryOnly',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        {{ t("markets.common.delivery") }}
      </label>
      <button
        type="button"
        data-testid="vendor-use-location"
        class="h-10 shrink-0 rounded-lg border border-ios-blue px-3 text-sm font-medium text-ios-blue"
        @click="$emit('useLocation')"
      >
        {{ t("markets.common.nearest") }}
      </button>
    </div>

    <div v-if="loading" class="py-8 text-center text-sm text-gray-500">
      {{ t("markets.vendors.loading") }}
    </div>
    <div
      v-else-if="vendors.length === 0"
      class="py-8 text-center text-sm text-gray-500"
    >
      {{ t("markets.vendors.empty") }}
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="vendor in vendors"
        :key="vendor.restaurantId"
        class="rounded-xl border border-gray-200 bg-white"
        :class="{ 'opacity-60': !vendor.isOpen }"
        :data-testid="`market-vendor-${vendor.restaurantId}`"
        :data-status="vendor.isOpen ? 'open' : 'closed-today'"
      >
        <RestaurantCard
          :restaurant="vendor"
          class="border-0"
          @select="selectPrimaryVendorEntry(vendor)"
          @takeaway="vendor.isOpen && $emit('takeaway', vendor)"
        />
        <div
          class="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-sm"
        >
          <div class="min-w-0 text-gray-500">
            <span v-if="vendor.stallNumber">
              {{
                tWithParams("markets.common.stallWithNumber", {
                  number: vendor.stallNumber,
                })
              }}
            </span>
            <span v-else>{{ t("markets.vendors.noStallNumber") }}</span>
            <span
              v-if="!vendor.isOpen"
              class="mt-1 inline-block rounded-full bg-ios-bg px-2 py-0.5 text-xs font-medium text-ios-secondary"
            >
              {{ t("markets.vendors.notOpenToday") }}
            </span>
            <span v-if="vendor.locationLabel">
              · {{ vendor.locationLabel }}
            </span>
            <span
              v-if="vendorMarketHoursLabel(vendor)"
              data-testid="vendor-market-hours"
              class="block text-xs text-gray-400"
            >
              {{
                tWithParams("markets.vendors.marketHours", {
                  hours: vendorMarketHoursLabel(vendor),
                })
              }}
            </span>
          </div>
          <span
            v-if="vendor.isPrimary"
            class="shrink-0 rounded bg-ios-blue/10 px-2 py-0.5 text-xs font-medium text-ios-blue"
          >
            {{ t("markets.vendors.primaryVendor") }}
          </span>
        </div>
        <div
          class="flex flex-wrap gap-2 border-t border-gray-100 px-4 py-3"
          :data-testid="`vendor-availability-${vendor.restaurantId}`"
        >
          <span
            class="rounded px-2 py-0.5 text-xs font-medium"
            :class="
              vendor.availableMenuItemCount > 0
                ? 'bg-ios-blue/10 text-ios-blue'
                : 'bg-gray-50 text-gray-500'
            "
          >
            {{
              vendor.availableMenuItemCount > 0
                ? tWithParams("markets.common.menuItemCount", {
                    count: vendor.availableMenuItemCount,
                  })
                : t("markets.common.noMenuItems")
            }}
          </span>
          <span
            class="rounded px-2 py-0.5 text-xs font-medium"
            :class="
              vendor.publicServiceItemCount > 0
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-gray-50 text-gray-500'
            "
          >
            {{
              vendor.publicServiceItemCount > 0
                ? tWithParams("markets.common.serviceCount", {
                    count: vendor.publicServiceItemCount,
                  })
                : t("markets.common.noServices")
            }}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            class="rounded-lg bg-ios-blue px-3 py-2 text-sm font-medium text-white disabled:bg-gray-200 disabled:text-gray-400"
            :data-testid="`open-vendor-menu-${vendor.restaurantId}`"
            :disabled="!vendor.isOpen || vendor.availableMenuItemCount <= 0"
            @click="$emit('selectVendor', vendor)"
          >
            {{ t("markets.common.viewMenu") }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-emerald-500 px-3 py-2 text-sm font-medium text-emerald-700 disabled:border-gray-200 disabled:text-gray-400"
            :data-testid="`open-vendor-services-${vendor.restaurantId}`"
            :disabled="!vendor.isOpen || vendor.publicServiceItemCount <= 0"
            @click="$emit('selectServices', vendor)"
          >
            {{ t("markets.common.viewServices") }}
          </button>
          <button
            type="button"
            class="col-span-2 rounded-lg border border-ios-blue px-3 py-2 text-sm font-medium text-ios-blue"
            @click="$emit('contactVendor', vendor)"
          >
            {{ t("markets.vendors.contactVendor") }}
          </button>
        </div>
      </div>
      <button
        v-if="hasMore"
        type="button"
        data-testid="vendor-list-load-more"
        class="h-10 w-full rounded-lg border border-ios-blue px-4 text-sm font-medium text-ios-blue disabled:border-gray-300 disabled:text-gray-400"
        :disabled="loading"
        @click="$emit('loadMore')"
      >
        {{
          loading
            ? t("markets.common.loading")
            : t("markets.vendors.loadMoreVendors")
        }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import RestaurantCard from "@/components/discovery/RestaurantCard.vue";
import type { MarketVendor } from "@/services/marketsApi";
import { useI18n } from "@/composables/useI18n";

const { t, tWithParams } = useI18n();

defineProps<{
  vendors: MarketVendor[];
  loading: boolean;
  query: string;
  takeawayOnly: boolean;
  deliveryOnly: boolean;
  hasMore?: boolean;
}>();

const emit = defineEmits<{
  "update:query": [query: string];
  "update:takeawayOnly": [value: boolean];
  "update:deliveryOnly": [value: boolean];
  selectVendor: [vendor: MarketVendor];
  selectServices: [vendor: MarketVendor];
  takeaway: [vendor: MarketVendor];
  contactVendor: [vendor: MarketVendor];
  useLocation: [];
  loadMore: [];
}>();

function vendorMarketHoursLabel(vendor: MarketVendor) {
  if (!vendor.marketHours) return "";

  const rows = Object.entries(vendor.marketHours)
    .filter(([, hours]) => hours && !hours.closed && hours.open && hours.close)
    .map(
      ([day, hours]) =>
        `${t(`markets.weekday.short.${day}`)} ${hours.open}-${hours.close}`,
    );

  return rows.slice(0, 2).join(t("format.listSeparator"));
}

function selectPrimaryVendorEntry(vendor: MarketVendor) {
  if (!vendor.isOpen) return;
  if (vendor.availableMenuItemCount > 0) {
    emit("selectVendor", vendor);
    return;
  }

  if (vendor.publicServiceItemCount > 0) {
    emit("selectServices", vendor);
  }
}
</script>
