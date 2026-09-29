<template>
  <section
    v-if="memberships.length > 0"
    data-testid="market-open-today-card"
    class="rounded-2xl bg-white p-6 shadow-ios-card"
    aria-labelledby="market-open-today-title"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2
          id="market-open-today-title"
          class="text-lg font-semibold text-ios-text"
        >
          {{ t("dashboard.marketOpenToday.title") }}
        </h2>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ t("dashboard.marketOpenToday.description") }}
        </p>
      </div>
      <RouterLink
        :to="{ name: 'MarketOpenReport' }"
        class="min-h-11 shrink-0 rounded-full px-3 py-2.5 text-sm font-medium text-ios-blue-deep transition-colors duration-200 ease-out hover:bg-ios-bg"
      >
        {{ t("dashboard.marketOpenToday.report") }}
      </RouterLink>
    </div>
    <ul class="mt-4 space-y-3" role="list">
      <li
        v-for="membership in memberships"
        :key="membership.marketId"
        :data-testid="`market-open-${membership.marketId}`"
        :data-status="membership.isOpenToday ? 'open' : 'closed'"
        class="flex items-center justify-between gap-3 rounded-2xl bg-ios-bg px-4 py-3"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-ios-text">
            {{ membership.market.name }}
          </p>
          <p class="mt-0.5 text-xs text-ios-secondary">
            {{
              membership.isOpenToday
                ? t("dashboard.marketOpenToday.openSince", {
                    time: formatTime(membership.openedAt, membership.timezone),
                  })
                : t("dashboard.marketOpenToday.closed")
            }}
          </p>
        </div>
        <button
          v-if="!membership.isOpenToday"
          :data-testid="`market-open-button-${membership.marketId}`"
          type="button"
          :disabled="pendingMarketId === membership.marketId"
          class="min-h-11 shrink-0 rounded-full bg-ios-blue px-5 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue focus-visible:ring-offset-2 disabled:opacity-60"
          @click="setOpen(membership, true)"
        >
          {{ t("dashboard.marketOpenToday.open") }}
        </button>
        <button
          v-else
          :data-testid="`market-close-button-${membership.marketId}`"
          type="button"
          :disabled="pendingMarketId === membership.marketId"
          class="min-h-11 shrink-0 rounded-full px-4 text-sm font-medium text-ios-red-deep transition-colors duration-200 ease-out hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-red disabled:opacity-60"
          @click="closeEarly(membership)"
        >
          {{ t("dashboard.marketOpenToday.close") }}
        </button>
      </li>
    </ul>
    <p v-if="hasError" role="alert" class="mt-3 text-sm text-ios-red-deep">
      {{ t("dashboard.marketOpenToday.error") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import {
  marketsService,
  type RestaurantMarketMembership,
} from "@/services/marketsService";

const { t } = useI18n();
const authStore = useAuthStore();
const memberships = ref<RestaurantMarketMembership[]>([]);
const pendingMarketId = ref<string | null>(null);
const hasError = ref(false);
let rolloverTimer: ReturnType<typeof setTimeout> | undefined;
let active = true;

function formatTime(value: string | number | null, timezone: string) {
  if (value === null) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function scheduleRollover() {
  clearTimeout(rolloverTimer);
  if (memberships.value.length === 0) return;
  const next = Math.min(
    ...memberships.value.map((membership) => membership.nextBusinessDayStartMs),
  );
  rolloverTimer = setTimeout(
    () => void loadMemberships(),
    Math.max(next - Date.now(), 1_000),
  );
}

async function loadMemberships() {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;
  try {
    const latest = await marketsService.listRestaurantMemberships(restaurantId);
    if (!active) return;
    memberships.value = latest;
    scheduleRollover();
  } catch {
    if (active && memberships.value.length > 0) {
      rolloverTimer = setTimeout(() => void loadMemberships(), 60_000);
    }
  }
}

async function setOpen(membership: RestaurantMarketMembership, open: boolean) {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;
  pendingMarketId.value = membership.marketId;
  hasError.value = false;
  try {
    const state = await marketsService.setMarketOpenToday(
      restaurantId,
      membership.marketId,
      open,
    );
    Object.assign(membership, state);
  } catch {
    hasError.value = true;
  } finally {
    pendingMarketId.value = null;
  }
}

function closeEarly(membership: RestaurantMarketMembership) {
  if (!window.confirm(t("dashboard.marketOpenToday.confirmClose"))) return;
  void setOpen(membership, false);
}

onMounted(() => {
  if (authStore.user?.role !== 1 || !authStore.restaurantId) return;
  void loadMemberships();
});
onUnmounted(() => {
  active = false;
  clearTimeout(rolloverTimer);
});
</script>
