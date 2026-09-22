<template>
  <div class="min-h-screen bg-ios-bg">
    <!-- 頂部固定導航 -->
    <nav class="sticky top-0 z-40 bg-white/80 backdrop-blur-xl shadow-card-sm">
      <div
        class="max-w-lg md:max-w-3xl lg:max-w-6xl mx-auto px-4 md:px-6 lg:px-8"
      >
        <!-- 餐廳資訊區域 -->
        <div class="px-5 py-3">
          <div class="flex items-center justify-between">
            <button
              class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-ios-text active:scale-95 transition-transform duration-150"
              @click="router.push('/')"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>

            <div class="min-w-0 flex-1 text-center">
              <h1 class="truncate font-semibold text-ios-text">
                {{ restaurant?.name || t("common.loading") }}
              </h1>
              <p class="truncate text-sm text-ios-secondary">
                {{ t("orderTracking.tableNumber") }} {{ orderContextLabel }}
              </p>
            </div>

            <LanguageSwitcher compact />

            <button
              data-testid="cart-btn"
              class="relative w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-ios-text active:scale-95 transition-transform duration-150"
              @click="router.push(activeCartRoute)"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4m2.6 8L6 2H3m4 11a3 3 0 100 6 3 3 0 000-6zm10 0a3 3 0 100 6 3 3 0 000-6z"
                />
              </svg>
              <!-- 購物車數量徽章 -->
              <div
                v-if="activeCartItemCount > 0"
                data-testid="cart-count"
                class="absolute -top-1 -right-1 w-5 h-5 bg-ios-red text-white text-xs rounded-full flex items-center justify-center font-medium"
              >
                {{ activeCartItemCount }}
              </div>
            </button>
          </div>
        </div>

        <!-- 分類導航 -->
        <div v-if="visibleCategories.length > 0" class="px-4 py-3">
          <div
            class="flex space-x-2 overflow-x-auto scrollbar-hide md:flex-wrap md:overflow-x-visible md:gap-2 md:space-x-0"
          >
            <button
              v-for="category in visibleCategories"
              :key="category.id"
              :class="[
                'flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors',
                activeCategoryId === category.id
                  ? 'bg-ios-blue text-white shadow-card-sm'
                  : 'bg-gray-100 text-ios-secondary active:bg-gray-200',
              ]"
              @click="scrollToCategory(category.id)"
            >
              {{ getLocalizedMenuName(category, currentLanguage) }}
            </button>
          </div>
        </div>
      </div>
    </nav>

    <!-- 主要內容區域 -->
    <main
      class="max-w-lg md:max-w-3xl lg:max-w-6xl mx-auto pb-20 px-4 md:px-6 lg:px-8"
    >
      <!-- 載入狀態 -->
      <div v-if="isLoading" class="p-8 text-center">
        <div
          class="animate-spin rounded-full h-12 w-12 border-2 border-ios-blue/20 border-t-ios-blue mx-auto mb-4"
        />
        <p class="text-ios-secondary">{{ t("shopMenu.loadingMenu") }}</p>
      </div>

      <!-- 錯誤狀態 -->
      <div v-else-if="error" class="p-8 text-center">
        <div
          class="w-16 h-16 bg-ios-red/15 rounded-full flex items-center justify-center mx-auto mb-4"
        >
          <svg
            class="w-8 h-8 text-ios-red"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 class="text-lg font-medium text-ios-text mb-2">
          {{ t("shopMenu.loadFailed") }}
        </h3>
        <p class="text-ios-secondary mb-4">
          {{ error }}
        </p>
        <button
          class="px-6 py-2.5 bg-ios-blue text-white rounded-full active:scale-[0.98] transition-transform duration-150"
          @click="() => refetch()"
        >
          {{ t("shopMenu.reload") }}
        </button>
      </div>

      <!-- 菜單內容 -->
      <div v-else-if="menuStructure" class="lg:flex lg:gap-6 lg:items-start">
        <div class="flex-1 min-w-0 px-5 space-y-6">
          <section
            data-testid="group-order-entry"
            class="rounded-2xl bg-ios-card p-4 shadow-card-sm"
          >
            <div v-if="isGroupMode" class="flex flex-col gap-3">
              <div
                class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p class="text-sm font-medium text-ios-blue">
                    {{ t("group.orderingInGroup") }}
                  </p>
                  <p class="mt-1 text-sm text-ios-secondary">
                    {{
                      tWithParams("group.groupCartItemCount", {
                        count: activeCartItemCount,
                      })
                    }}
                  </p>
                </div>
                <div class="flex flex-col gap-2 sm:flex-row">
                  <button
                    data-testid="group-cart-link"
                    type="button"
                    class="rounded-full bg-ios-blue px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98]"
                    @click="router.push(groupCartRoute)"
                  >
                    {{ t("group.viewSharedCart") }}
                  </button>
                  <button
                    data-testid="leave-group-mode"
                    type="button"
                    class="rounded-full border border-ios-gray-4 px-4 py-2.5 text-sm font-semibold text-ios-secondary transition-all duration-200 active:scale-[0.98]"
                    @click="leaveGroupMode"
                  >
                    {{ t("group.leaveGroupMode") }}
                  </button>
                </div>
              </div>

              <p
                v-if="cartStore.itemCount > 0"
                data-testid="personal-cart-hidden"
                class="rounded-xl bg-ios-orange/10 p-3 text-sm text-ios-orange"
              >
                {{
                  tWithParams("group.personalCartHidden", {
                    count: cartStore.itemCount,
                  })
                }}
              </p>
              <p
                v-if="isAddingGroupItem"
                data-testid="group-add-pending"
                class="rounded-xl bg-ios-blue/10 p-3 text-sm text-ios-blue"
              >
                {{
                  tWithParams("group.addingItems", {
                    count: pendingGroupAddCount,
                  })
                }}
              </p>
            </div>

            <div v-else>
              <div
                class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p class="text-sm font-medium text-ios-text">
                    {{ t("group.startFromMenuTitle") }}
                  </p>
                  <p class="mt-1 text-sm text-ios-secondary">
                    {{ t("group.startFromMenuDesc") }}
                  </p>
                </div>
                <button
                  data-testid="start-group-order-button"
                  type="button"
                  class="rounded-full border border-ios-blue/25 bg-ios-blue/10 px-4 py-2.5 text-sm font-semibold text-ios-blue transition-all duration-200 active:scale-[0.98]"
                  @click="showGroupStartForm = !showGroupStartForm"
                >
                  {{ t("group.startGroupOrder") }}
                </button>
              </div>

              <form
                v-if="showGroupStartForm"
                data-testid="group-create-form"
                class="mt-4 space-y-3"
                @submit.prevent="createGroupOrderFromMenu"
              >
                <label class="block text-sm font-medium text-ios-text">
                  {{ t("group.hostName") }}
                  <input
                    v-model="groupHostName"
                    data-testid="group-host-name-input"
                    class="mt-2 block w-full rounded-xl border-0 bg-ios-bg px-4 py-3 text-ios-text transition-all duration-200 placeholder:text-ios-tertiary focus:bg-white focus:ring-2 focus:ring-ios-blue/30"
                    autocomplete="name"
                    type="text"
                    :placeholder="t('group.hostNamePlaceholder')"
                  />
                </label>
                <p
                  v-if="groupOrderError"
                  data-testid="group-order-error"
                  class="text-sm text-ios-red"
                >
                  {{ groupOrderError }}
                </p>
                <button
                  data-testid="group-create-submit"
                  type="submit"
                  class="w-full rounded-full bg-ios-blue px-4 py-3 text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
                  :disabled="isCreatingGroupOrder"
                >
                  {{
                    isCreatingGroupOrder
                      ? t("group.creating")
                      : t("group.createAndOpen")
                  }}
                </button>
              </form>
            </div>
          </section>

          <!-- 搜尋框 -->
          <div class="relative">
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('menu.searchPlaceholder')"
              class="w-full pl-10 pr-4 py-3 bg-gray-100 rounded-xl text-ios-text placeholder:text-ios-tertiary border-0 focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all duration-200"
            />
            <svg
              class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-ios-secondary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          <!-- 推薦菜品 -->
          <section v-if="featuredItems.length > 0" class="mb-8">
            <h2 class="text-xl font-semibold text-ios-text mb-4">
              {{ t("menu.featured") }}
            </h2>
            <div
              class="flex gap-3 md:gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-5 px-5"
            >
              <MenuItemCard
                v-for="(item, index) in featuredItems"
                :key="item.id"
                :item="item"
                :is-featured="true"
                class="animate-slide-up min-w-[280px] md:min-w-[260px] snap-start flex-shrink-0"
                :style="{
                  animationDelay: `${index * 50}ms`,
                  animationFillMode: 'both',
                }"
                @add-to-cart="handleAddToCart"
                @view-details="handleViewDetails"
              />
            </div>
          </section>

          <!-- 分類菜單 -->
          <section
            v-for="category in filteredCategories"
            :id="`category-${category.id}`"
            :key="category.id"
            class="scroll-mt-32"
          >
            <div
              class="sticky bg-ios-bg/95 backdrop-blur-sm py-3 z-10 -mx-5 px-5"
              :class="visibleCategories.length > 0 ? 'top-32' : 'top-16'"
            >
              <h2 class="text-xl font-semibold text-ios-text">
                {{ getLocalizedMenuName(category, currentLanguage) }}
              </h2>
              <p
                v-if="category.description"
                class="text-sm text-ios-secondary mt-0.5"
              >
                {{ category.description }}
              </p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <MenuItemCard
                v-for="(item, index) in getItemsByCategory(category.id)"
                :key="item.id"
                :item="item"
                class="animate-slide-up"
                :style="{
                  animationDelay: `${index * 50}ms`,
                  animationFillMode: 'both',
                }"
                @add-to-cart="handleAddToCart"
                @view-details="handleViewDetails"
              />
            </div>

            <!-- 分類內無菜品提示 -->
            <div
              v-if="getItemsByCategory(category.id).length === 0"
              class="py-8 text-center text-gray-500"
            >
              <p>{{ t("shopMenu.noItemsInCategory") }}</p>
            </div>
          </section>

          <!-- 搜尋無結果 -->
          <div
            v-if="searchQuery && filteredCategories.length === 0"
            class="py-12 text-center"
          >
            <div
              class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"
            >
              <svg
                class="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 class="text-lg font-medium text-ios-text mb-2">
              {{ t("menu.noResults") }}
            </h3>
            <p class="text-ios-secondary">
              {{ t("menu.search") }}
            </p>
          </div>
        </div>

        <!-- Right: Desktop cart panel -->
        <Transition name="slide-in-right">
          <DesktopCartPanel
            v-if="isDesktop && !isGroupMode && cartStore.itemCount > 0"
            :items="cartStore.items"
            :item-count="cartStore.itemCount"
            :subtotal="cartStore.subtotal"
            @checkout="router.push(cartRoute)"
            @remove-item="cartStore.removeItem($event)"
            @update-quantity="(id, qty) => cartStore.updateQuantity(id, qty)"
          />
        </Transition>
      </div>
    </main>

    <!-- 底部固定購物車按鈕 -->
    <div
      v-if="isGroupMode"
      class="fixed bottom-4 left-4 right-4 z-50 max-w-lg mx-auto lg:hidden"
    >
      <button
        class="w-full bg-ios-blue text-white font-semibold py-4 px-6 rounded-full shadow-card-lg active:scale-[0.98] transition-transform duration-150 flex items-center justify-between"
        @click="router.push(groupCartRoute)"
      >
        <div class="flex items-center space-x-3">
          <div
            class="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center"
          >
            <span class="text-sm font-bold">{{ activeCartItemCount }}</span>
          </div>
          <span>{{ t("group.viewSharedCart") }}</span>
        </div>
        <span class="text-sm font-semibold">{{ t("group.sharedCart") }}</span>
      </button>
    </div>

    <div
      v-else-if="cartStore.itemCount > 0"
      class="fixed bottom-4 left-4 right-4 z-50 max-w-lg mx-auto lg:hidden"
    >
      <button
        class="w-full bg-ios-blue text-white font-semibold py-4 px-6 rounded-full shadow-card-lg active:scale-[0.98] transition-transform duration-150 flex items-center justify-between"
        @click="router.push(cartRoute)"
      >
        <div class="flex items-center space-x-3">
          <div
            class="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center"
          >
            <span class="text-sm font-bold">{{ cartStore.itemCount }}</span>
          </div>
          <span>{{ t("shopMenu.viewCart") }}</span>
        </div>
        <div class="text-lg font-bold">
          {{ formatPrice(cartStore.subtotal) }}
        </div>
      </button>
    </div>

    <!-- 菜品詳情彈窗 -->
    <MenuItemModal
      v-if="selectedItem"
      :item="selectedItem"
      :show="showItemModal"
      @close="showItemModal = false"
      @add-to-cart="handleAddToCart"
    />

    <!-- 客製化選項彈窗 -->
    <CustomizationModal
      v-if="customizingItem"
      :item="customizingItem"
      :show="showCustomizationModal"
      @close="showCustomizationModal = false"
      @add-to-cart="handleAddToCart"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useToast } from "vue-toastification";
import { useI18n } from "@/composables/useI18n";
import { getGroupOrderErrorI18nKey } from "@/utils/group-order-error";
import { useSeatContext } from "@/composables/useSeatContext";
import { useGroupOrder } from "@/composables/useGroupOrder";
import { useAppStore } from "@/stores/app";
import { useCartStore } from "@/stores/cart";
import MenuItemCard from "@/components/MenuItemCard.vue";
import MenuItemModal from "@/components/MenuItemModal.vue";
import CustomizationModal from "@/components/CustomizationModal.vue";
import DesktopCartPanel from "@/components/DesktopCartPanel.vue";
import LanguageSwitcher from "@/components/LanguageSwitcher.vue";
import { useIsDesktop } from "@/composables/useBreakpoint";
import { menuApi } from "@/services/menuApi";
import { useCurrency } from "@/composables/useCurrency";
import type {
  MenuItem,
  SelectedCustomizations,
} from "@makanmasak/shared-types";
import {
  getLocalizedMenuName,
  menuItemMatchesQuery,
} from "@/utils/localized-menu-content";
import {
  clearActiveGroupOrder,
  readActiveGroupOrder,
} from "@/utils/groupOrderSession";

// Props
const props = defineProps<{
  restaurantId: string;
  tableId: number;
}>();

// Composables
const router = useRouter();
const toast = useToast();
const { t, tWithParams, currentLanguage } = useI18n();
const appStore = useAppStore();
const cartStore = useCartStore();
const isDesktop = useIsDesktop();
const { formatPrice } = useCurrency();
const groupOrder = useGroupOrder({
  restaurantId: props.restaurantId,
  tableId: String(props.tableId),
});

// State
const searchQuery = ref("");
const activeCategoryId = ref<number | null>(null);
const selectedItem = ref<MenuItem | null>(null);
const customizingItem = ref<MenuItem | null>(null);
const showItemModal = ref(false);
const showCustomizationModal = ref(false);
const hasRedirectedInvalidTable = ref(false);
const showGroupStartForm = ref(false);
const groupHostName = ref("");
const groupOrderError = ref("");
const isCreatingGroupOrder = ref(false);
const isAddingGroupItem = ref(false);
const pendingGroupAddCount = ref(0);
let groupAddQueue: Promise<void> = Promise.resolve();
/**
 * The pending restore of this table's stored group order. Group mode stays off
 * until loadGroupOrder answers, so an addition made before then has to wait
 * for the answer rather than be routed by it being off.
 */
let groupRestore: Promise<void> = Promise.resolve();

const invalidTableMessage = "此桌號無效或已停用，請重新掃描 QR Code。";
const isValidTableId = computed(
  () => Number.isInteger(props.tableId) && props.tableId > 0,
);

const redirectInvalidTable = () => {
  if (hasRedirectedInvalidTable.value) return;

  hasRedirectedInvalidTable.value = true;
  router.replace({
    name: "Error",
    query: {
      code: "INVALID_TABLE",
      message: invalidTableMessage,
    },
  });
};

const {
  data: tableValidation,
  isLoading: isLoadingTableValidation,
  error: tableValidationError,
} = useQuery({
  queryKey: ["table-validation", props.restaurantId, props.tableId],
  queryFn: async () => {
    if (!isValidTableId.value) {
      return { isValid: false };
    }
    return menuApi.validateTable(props.restaurantId, props.tableId);
  },
  retry: false,
  staleTime: 0,
});

const isTableValid = computed(() => tableValidation.value?.isValid === true);

// The route carries the numeric table id, but the diner reads the label printed
// on the table ("A1"), and staff route food by that label too. Showing the id
// invites the wrong table being served, so prefer the validated number and only
// fall back to the id before validation resolves.
const tableLabel = computed(
  () => tableValidation.value?.table?.number ?? String(props.tableId),
);

const { seatId, seatLabel, seatQuery } = useSeatContext();

const orderContextLabel = computed(() =>
  seatLabel.value
    ? tWithParams("menu.seatContext", {
        table: tableLabel.value,
        seat: seatLabel.value,
      })
    : tableLabel.value,
);

const cartRoute = computed(() => ({
  name: "Cart",
  params: {
    restaurantId: props.restaurantId,
    tableId: props.tableId,
  },
  query: seatQuery.value,
}));

const groupCartRoute = computed(() => ({
  name: "GroupOrder",
  params: {
    groupOrderId: groupOrder.groupOrder.value?.id ?? "",
  },
}));

const isLoadedGroupForCurrentTable = computed(() => {
  const loaded = groupOrder.groupOrder.value;
  return (
    loaded?.restaurantId === props.restaurantId &&
    loaded?.tableId === String(props.tableId)
  );
});

const isGroupMode = computed(
  () =>
    groupOrder.groupOrder.value?.status === "active" &&
    isLoadedGroupForCurrentTable.value &&
    !!groupOrder.currentMemberId.value,
);

const activeCartRoute = computed(() =>
  isGroupMode.value ? groupCartRoute.value : cartRoute.value,
);

const activeCartItemCount = computed(() => {
  if (!isGroupMode.value) return cartStore.itemCount;
  return (
    groupOrder.groupOrder.value?.cartItems.reduce(
      (count, item) => count + item.quantity,
      0,
    ) ?? 0
  );
});

// API Queries
const { data: restaurant, isLoading: isLoadingRestaurant } = useQuery({
  queryKey: ["restaurant", props.restaurantId],
  queryFn: () => menuApi.getRestaurant(props.restaurantId),
  enabled: isTableValid,
  staleTime: 5 * 60 * 1000, // 5分鐘
});

const {
  data: menuStructure,
  isLoading: isLoadingMenu,
  error: menuError,
  refetch,
} = useQuery({
  queryKey: ["menu", props.restaurantId, props.tableId],
  queryFn: () => menuApi.getMenu(props.restaurantId, props.tableId),
  enabled: isTableValid,
  staleTime: 2 * 60 * 1000, // 2分鐘
  refetchOnWindowFocus: true,
});

// Computed
const isLoading = computed(
  () =>
    isLoadingTableValidation.value ||
    isLoadingRestaurant.value ||
    isLoadingMenu.value,
);
const error = computed(
  () => tableValidationError.value?.message || menuError.value?.message || null,
);

const categories = computed(() => menuStructure.value?.categories || []);
const menuItems = computed(() => menuStructure.value?.menuItems || []);
type MenuCategory = (typeof categories.value)[number];

const featuredItems = computed(() =>
  menuItems.value.filter(
    (item: MenuItem) => item.isFeatured && item.isAvailable,
  ),
);

/**
 * Categories a customer can actually order from.
 *
 * The chip strip and the sticky offset that depends on it have to agree with
 * the sections rendered below, and only the sections were filtered. A category
 * the owner created before adding dishes -- or one whose items are all sold
 * out -- got a chip that scrolls nowhere: `scrollToCategory` still marks it
 * active, so it looks selected while the page does not move.
 *
 * Search deliberately does not narrow this. The chips stay put while results
 * filter underneath, matching ShopMenuView.
 */
const visibleCategories = computed(() =>
  categories.value.filter(
    (category) => getItemsByCategory(category.id).length > 0,
  ),
);

const filteredCategories = computed(() => {
  if (!searchQuery.value.trim()) {
    return visibleCategories.value;
  }

  const query = searchQuery.value.toLowerCase().trim();
  return categories.value.filter((category: MenuCategory) => {
    const categoryItems = getItemsByCategory(category.id);
    return categoryItems.some((item: MenuItem) =>
      menuItemMatchesQuery(item, query),
    );
  });
});

// Methods
const getItemsByCategory = (categoryId: number) => {
  let items = menuItems.value.filter(
    (item: MenuItem) => item.categoryId === categoryId && item.isAvailable,
  );

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim();
    items = items.filter((item: MenuItem) => menuItemMatchesQuery(item, query));
  }

  return items.sort((a: MenuItem, b: MenuItem) => a.sortOrder - b.sortOrder);
};

const scrollToCategory = (categoryId: number) => {
  activeCategoryId.value = categoryId;
  const element = document.getElementById(`category-${categoryId}`);
  if (element) {
    element.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
};

async function createGroupOrderFromMenu(): Promise<void> {
  const hostName = groupHostName.value.trim();
  if (!hostName) {
    groupOrderError.value = t("group.hostNameRequired");
    return;
  }

  isCreatingGroupOrder.value = true;
  groupOrderError.value = "";

  try {
    const groupOrderId = await groupOrder.createGroupOrder({
      hostName,
      tableId: String(props.tableId),
    });

    if (!groupOrderId) {
      // createGroupOrder catches its own failure into the composable's error
      // ref, which holds a translation key rather than a message.
      groupOrderError.value = t(groupOrder.error.value ?? "group.createFailed");
      return;
    }

    await router.push({
      name: "GroupOrder",
      params: { groupOrderId },
    });
  } catch (error) {
    groupOrderError.value = t(
      getGroupOrderErrorI18nKey(error, "group.createFailed"),
    );
  } finally {
    isCreatingGroupOrder.value = false;
  }
}

async function restoreActiveGroupOrder(): Promise<void> {
  if (!isValidTableId.value) return;

  const activeGroupOrder = readActiveGroupOrder(
    props.restaurantId,
    String(props.tableId),
  );
  if (!activeGroupOrder) return;

  try {
    await groupOrder.loadGroupOrder(activeGroupOrder.groupOrderId);
    const loaded = groupOrder.groupOrder.value;
    if (
      loaded?.restaurantId !== props.restaurantId ||
      loaded?.tableId !== String(props.tableId) ||
      loaded?.status !== "active"
    ) {
      clearLoadedGroupMode();
      return;
    }
    void connectActiveGroupOrder(activeGroupOrder.groupOrderId);
  } catch {
    clearLoadedGroupMode();
  }
}

const handleAddToCart = async (data: {
  item: MenuItem;
  quantity: number;
  customizations?: SelectedCustomizations;
  notes?: string;
}) => {
  // Returning from the shared cart remounts this view with group mode off
  // until the stored group has loaded. Deciding before then put the item in
  // the personal cart, which group mode hides, so it never reached the group.
  await groupRestore;

  if (isGroupMode.value) {
    enqueueGroupCartAddition(data);
    return;
  } else {
    cartStore.addItem(
      data.item,
      data.quantity,
      data.customizations,
      data.notes,
    );
  }

  toast.success(
    tWithParams(isGroupMode.value ? "group.itemAdded" : "toast.itemAdded", {
      name: getLocalizedMenuName(data.item, currentLanguage?.value),
      quantity: data.quantity,
    }),
  );

  closeItemOverlays();
};

function clearLoadedGroupMode(): void {
  groupOrder.disconnectRealtime();
  clearActiveGroupOrder(props.restaurantId, String(props.tableId));
  groupOrder.groupOrder.value = null;
  groupOrder.currentMemberId.value = "";
  groupOrderError.value = "";
}

function leaveGroupMode(): void {
  clearLoadedGroupMode();
  showGroupStartForm.value = false;
}

async function connectActiveGroupOrder(groupOrderId: string): Promise<void> {
  if (!import.meta.env.VITE_REALTIME_URL) return;

  try {
    await groupOrder.connectToGroupOrder(groupOrderId);
  } catch {
    // The menu remains usable without realtime; the shared cart page can still
    // recover the session and show connection-specific errors.
  }
}

function enqueueGroupCartAddition(data: {
  item: MenuItem;
  quantity: number;
  customizations?: SelectedCustomizations;
  notes?: string;
}): void {
  const groupOrderId = groupOrder.groupOrder.value?.id;
  if (!groupOrderId) return;

  pendingGroupAddCount.value += 1;
  isAddingGroupItem.value = true;

  const operation = groupAddQueue
    .catch(() => undefined)
    .then(() => addGroupCartItem(groupOrderId, data))
    .finally(() => {
      pendingGroupAddCount.value = Math.max(0, pendingGroupAddCount.value - 1);
      isAddingGroupItem.value = pendingGroupAddCount.value > 0;
    });

  groupAddQueue = operation.catch(() => undefined);
}

async function addGroupCartItem(
  groupOrderId: string,
  data: {
    item: MenuItem;
    quantity: number;
    customizations?: SelectedCustomizations;
    notes?: string;
  },
): Promise<void> {
  groupOrderError.value = "";
  if (!isCurrentGroupMode(groupOrderId)) return;

  try {
    await groupOrder.addToCart({
      menuItemId: String(data.item.id),
      menuItemName: getLocalizedMenuName(data.item, currentLanguage.value),
      menuItemPrice: data.item.price,
      quantity: data.quantity,
      options: (data.customizations ?? {}) as Record<string, unknown>,
      notes: data.notes,
    });
  } catch (error) {
    groupOrderError.value = t(
      getGroupOrderErrorI18nKey(error, "group.addItemFailed"),
    );
    toast.error(groupOrderError.value);
    throw error;
  }
  if (!isCurrentGroupMode(groupOrderId)) return;

  toast.success(
    tWithParams("group.itemAdded", {
      name: getLocalizedMenuName(data.item, currentLanguage?.value),
      quantity: data.quantity,
    }),
  );

  closeItemOverlays();
}

function isCurrentGroupMode(groupOrderId: string): boolean {
  return isGroupMode.value && groupOrder.groupOrder.value?.id === groupOrderId;
}

function closeItemOverlays(): void {
  showItemModal.value = false;
  showCustomizationModal.value = false;
  selectedItem.value = null;
  customizingItem.value = null;
}

const handleViewDetails = (item: MenuItem) => {
  selectedItem.value = item;
  showItemModal.value = true;
};

// 監聽滾動位置更新活躍分類
const updateActiveCategoryOnScroll = () => {
  const sections = visibleCategories.value.map((category: MenuCategory) => ({
    id: category.id,
    element: document.getElementById(`category-${category.id}`),
  }));

  const _scrollTop = window.pageYOffset;
  const windowHeight = window.innerHeight;

  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (section.element) {
      const rect = section.element.getBoundingClientRect();
      if (rect.top <= windowHeight / 3) {
        activeCategoryId.value = section.id;
        break;
      }
    }
  }
};

onMounted(() => {
  window.addEventListener("scroll", updateActiveCategoryOnScroll);

  // 設定餐廳上下文
  if (restaurant.value) {
    appStore.setRestaurantContext(restaurant.value, props.tableId);
  }
});

onUnmounted(() => {
  window.removeEventListener("scroll", updateActiveCategoryOnScroll);
  groupOrder.disconnectRealtime();
});

// 監聽餐廳資料變化
watch(restaurant, (newRestaurant) => {
  if (newRestaurant) {
    appStore.setRestaurantContext(newRestaurant, props.tableId);
  }
});

watch(
  [tableValidation, tableValidationError],
  ([validation, validationError]) => {
    if (validationError || validation?.isValid === false) {
      redirectInvalidTable();
    }
  },
  { immediate: true },
);

watch(
  [isTableValid, seatId],
  ([valid, currentSeatId]) => {
    if (valid) {
      cartStore.initializeCart(
        props.restaurantId,
        props.tableId,
        currentSeatId,
      );
      groupRestore = restoreActiveGroupOrder();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

.slide-in-right-enter-active {
  transition: all 300ms ease-out;
}
.slide-in-right-leave-active {
  transition: all 200ms ease-in;
}
.slide-in-right-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.slide-in-right-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
