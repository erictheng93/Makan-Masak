<template>
  <section
    data-testid="following-section"
    class="rounded-2xl bg-ios-card p-6 shadow-ios-card"
  >
    <h3 class="text-lg font-semibold text-ios-text">
      {{ t("follow.sectionTitle") }}
    </h3>
    <p class="mt-1 text-sm text-ios-secondary">{{ t("follow.sectionHint") }}</p>

    <p
      v-if="isLoading"
      data-testid="following-loading"
      class="mt-4 text-sm text-ios-secondary"
    >
      {{ t("follow.loading") }}
    </p>
    <p
      v-else-if="loadFailed"
      data-testid="following-load-error"
      class="mt-4 text-sm text-ios-red-deep"
    >
      {{ t("follow.loadFailed") }}
    </p>
    <p
      v-else-if="isEmpty"
      data-testid="following-empty"
      class="mt-4 text-sm text-ios-secondary"
    >
      {{ t("follow.empty") }}
    </p>
    <div v-else class="mt-4 space-y-5">
      <div v-if="followedMarkets.length">
        <h4 class="text-sm font-semibold text-ios-secondary">
          {{ t("follow.marketsHeading") }}
        </h4>
        <ul class="mt-2 space-y-2">
          <li
            v-for="row in followedMarkets"
            :key="row.targetId"
            :data-testid="`following-market-${row.targetId}`"
            class="flex items-center justify-between gap-3 rounded-2xl bg-ios-bg px-4 py-3"
          >
            <RouterLink
              v-if="marketOf(row.targetId)"
              :to="`/markets/${marketOf(row.targetId)?.slug}`"
              class="min-w-0 flex-1 truncate text-sm font-medium text-ios-blue"
            >
              {{ marketOf(row.targetId)?.name }}
            </RouterLink>
            <span
              v-else
              class="min-w-0 flex-1 truncate text-sm text-ios-secondary"
            >
              {{ t("follow.unknownTarget") }}
            </span>
            <button
              type="button"
              :data-testid="`following-unfollow-market-${row.targetId}`"
              class="shrink-0 rounded-full bg-ios-red-soft px-3 py-1 text-xs font-medium text-ios-red-deep transition-colors duration-200 ease-out disabled:opacity-60"
              :disabled="busyKeys.has(`market:${row.targetId}`)"
              @click="unfollowTarget('market', row.targetId)"
            >
              {{ t("follow.unfollow") }}
            </button>
          </li>
        </ul>
      </div>

      <div v-if="followedRestaurants.length">
        <h4 class="text-sm font-semibold text-ios-secondary">
          {{ t("follow.restaurantsHeading") }}
        </h4>
        <ul class="mt-2 space-y-2">
          <li
            v-for="row in followedRestaurants"
            :key="row.targetId"
            :data-testid="`following-restaurant-${row.targetId}`"
            class="flex items-center justify-between gap-3 rounded-2xl bg-ios-bg px-4 py-3"
          >
            <RouterLink
              v-if="restaurantNames[row.targetId]"
              :to="`/restaurant/${row.targetId}/shop/order-type`"
              class="min-w-0 flex-1 truncate text-sm font-medium text-ios-blue"
            >
              {{ restaurantNames[row.targetId] }}
            </RouterLink>
            <span
              v-else
              class="min-w-0 flex-1 truncate text-sm text-ios-secondary"
            >
              {{ t("follow.unknownTarget") }}
            </span>
            <button
              type="button"
              :data-testid="`following-unfollow-restaurant-${row.targetId}`"
              class="shrink-0 rounded-full bg-ios-red-soft px-3 py-1 text-xs font-medium text-ios-red-deep transition-colors duration-200 ease-out disabled:opacity-60"
              :disabled="busyKeys.has(`restaurant:${row.targetId}`)"
              @click="unfollowTarget('restaurant', row.targetId)"
            >
              {{ t("follow.unfollow") }}
            </button>
          </li>
        </ul>
      </div>
    </div>

    <p
      v-if="actionFailed"
      data-testid="following-action-error"
      class="mt-4 text-sm text-ios-red-deep"
    >
      {{ t("follow.unfollowFailed") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "@/composables/useI18n";
import { marketsApi } from "@/services/marketsApi";
import { menuApi } from "@/services/menuApi";
import {
  useFollowing,
  type FollowTargetType,
} from "@/composables/useFollowing";

/**
 * The 追蹤中 section of the profile page (#335): what this diner follows, and
 * therefore whose marketing pushes can reach them.
 *
 * Names have to be resolved separately because a favorites row stores only a
 * target id, and the two target types have different lookups available:
 *
 * - Restaurants have `GET /restaurants/:id`, so each row is resolved exactly.
 * - Markets have no by-id endpoint at all — `GET /markets/:slug` matches on slug
 *   only — so the market list is fetched once and matched locally. A market
 *   outside that page (or one that is not public-ready, which the list filters
 *   out) keeps its row and says the name is unavailable, rather than
 *   disappearing and leaving a follow the diner cannot see or undo. A by-id
 *   market summary endpoint would remove the limit; `MarketsService` already has
 *   `getMarketById` internally, with no route in front of it.
 */
const MARKET_LOOKUP_LIMIT = 100;

const { t } = useI18n();
const {
  ensureLoaded,
  isLoading,
  loadFailed,
  toggle,
  followedMarkets,
  followedRestaurants,
} = useFollowing();

const marketSummaries = ref<Record<string, { name: string; slug: string }>>({});
const restaurantNames = ref<Record<string, string>>({});
const busyKeys = ref(new Set<string>());
const actionFailed = ref(false);

const isEmpty = computed(
  () =>
    followedMarkets.value.length === 0 &&
    followedRestaurants.value.length === 0,
);

const marketOf = (marketId: string) => marketSummaries.value[marketId];

async function resolveMarketNames(): Promise<void> {
  if (followedMarkets.value.length === 0) return;
  try {
    const { markets } = await marketsApi.listMarkets({
      limit: MARKET_LOOKUP_LIMIT,
    });
    marketSummaries.value = Object.fromEntries(
      (markets ?? []).map((market) => [
        market.id,
        { name: market.name, slug: market.slug },
      ]),
    );
  } catch (error) {
    // Names are presentation. The rows and the unfollow button still work
    // without them, which is what keeps a follow undoable.
    console.warn("Failed to resolve followed market names:", error);
  }
}

async function resolveRestaurantNames(): Promise<void> {
  await Promise.all(
    followedRestaurants.value.map(async (row) => {
      try {
        const restaurant = await menuApi.getRestaurant(row.targetId);
        if (restaurant?.name) {
          restaurantNames.value[row.targetId] = restaurant.name;
        }
      } catch (error) {
        console.warn("Failed to resolve followed restaurant name:", error);
      }
    }),
  );
}

const unfollowTarget = async (
  targetType: FollowTargetType,
  targetId: string,
) => {
  const key = `${targetType}:${targetId}`;
  if (busyKeys.value.has(key)) return;
  actionFailed.value = false;
  busyKeys.value = new Set(busyKeys.value).add(key);
  try {
    await toggle(targetType, targetId);
  } catch {
    // `toggle` has already put the row back, so the list is accurate again.
    actionFailed.value = true;
  } finally {
    const next = new Set(busyKeys.value);
    next.delete(key);
    busyKeys.value = next;
  }
};

onMounted(async () => {
  await ensureLoaded();
  await Promise.all([resolveMarketNames(), resolveRestaurantNames()]);
});
</script>
