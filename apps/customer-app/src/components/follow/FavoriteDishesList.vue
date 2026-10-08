<template>
  <section
    data-testid="favorite-dishes-section"
    class="rounded-2xl bg-ios-card p-6 shadow-ios-card"
  >
    <h3 class="text-lg font-semibold text-ios-text">
      {{ t("follow.dishesTitle") }}
    </h3>

    <p
      v-if="isLoading"
      data-testid="favorite-dishes-loading"
      class="mt-4 text-sm text-ios-secondary"
    >
      {{ t("follow.loading") }}
    </p>
    <p
      v-else-if="loadFailed"
      data-testid="favorite-dishes-load-error"
      class="mt-4 text-sm text-ios-red-deep"
    >
      {{ t("follow.loadFailed") }}
    </p>
    <p
      v-else-if="favoriteDishes.length === 0"
      data-testid="favorite-dishes-empty"
      class="mt-4 text-sm text-ios-secondary"
    >
      {{ t("follow.dishesEmpty") }}
    </p>
    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="row in favoriteDishes"
        :key="row.targetId"
        :data-testid="`favorite-dish-${row.targetId}`"
        class="flex items-center justify-between gap-3 rounded-2xl bg-ios-bg px-4 py-3"
      >
        <RouterLink
          v-if="row.dish"
          :to="{
            path: `/restaurant/${row.dish.restaurantId}/shop/menu`,
            query: { [SHOP_MENU_ITEM_QUERY_KEY]: row.targetId },
          }"
          class="min-w-0 flex-1 truncate text-sm font-medium text-ios-blue"
        >
          {{ getLocalizedMenuName(row.dish, currentLanguage) }}
        </RouterLink>
        <!-- Deleted dish: keep the row so the favorite can still be removed. -->
        <span v-else class="min-w-0 flex-1 truncate text-sm text-ios-secondary">
          {{ t("follow.unknownTarget") }}
        </span>
        <button
          type="button"
          :data-testid="`favorite-dish-remove-${row.targetId}`"
          class="shrink-0 rounded-full bg-ios-red-soft px-3 py-1 text-xs font-medium text-ios-red-deep transition-colors duration-200 ease-out disabled:opacity-60"
          :disabled="busyIds.has(row.targetId)"
          @click="remove(row.targetId)"
        >
          {{ t("follow.removeFavorite") }}
        </button>
      </li>
    </ul>

    <p
      v-if="actionFailed"
      data-testid="favorite-dishes-action-error"
      class="mt-4 text-sm text-ios-red-deep"
    >
      {{ t("follow.unfavoriteFailed") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "@/composables/useI18n";
import { useFollowing } from "@/composables/useFollowing";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";
import { SHOP_MENU_ITEM_QUERY_KEY } from "@/utils/shopMenuDeepLink";

/**
 * 收藏的菜色 on the profile page. Names arrive with the favorites list itself
 * (`dish` on each row), so unlike `FollowingList` there is nothing to resolve.
 */
const { t, currentLanguage } = useI18n();
const { ensureLoaded, isLoading, loadFailed, toggle, favoriteDishes } =
  useFollowing();

const busyIds = ref(new Set<string>());
const actionFailed = ref(false);

const remove = async (targetId: string) => {
  if (busyIds.value.has(targetId)) return;
  actionFailed.value = false;
  busyIds.value = new Set(busyIds.value).add(targetId);
  try {
    await toggle("dish", targetId);
  } catch {
    // `toggle` has already put the row back.
    actionFailed.value = true;
  } finally {
    const next = new Set(busyIds.value);
    next.delete(targetId);
    busyIds.value = next;
  }
};

onMounted(() => {
  void ensureLoaded();
});
</script>
