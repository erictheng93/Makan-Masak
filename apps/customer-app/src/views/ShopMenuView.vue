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
              data-testid="shop-menu-back"
              class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-ios-text active:scale-95 transition-transform duration-150"
              @click="goBack"
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

            <div class="flex-1 text-center">
              <div class="flex items-center justify-center">
                <h1 class="font-semibold text-ios-text">
                  {{ restaurant?.name || t("common.loading") }}
                </h1>
                <span
                  v-if="shopCartStore.fulfillmentType"
                  :class="[
                    'ml-2 px-2 py-0.5 rounded-full text-xs font-medium',
                    shopCartStore.fulfillmentType === 'delivery'
                      ? 'bg-ios-orange/15 text-ios-orange'
                      : 'bg-ios-green/15 text-ios-green',
                  ]"
                >
                  {{
                    shopCartStore.fulfillmentType === "delivery"
                      ? t("shopCart.delivery")
                      : t("shopCart.takeaway")
                  }}
                </span>
              </div>
              <p class="text-sm text-ios-secondary">
                {{ t("shopMenu.shopOrdering") }}
              </p>
            </div>

            <button
              data-testid="cart-btn"
              class="relative w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-ios-text active:scale-95 transition-transform duration-150"
              @click="showCart = true"
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
                v-if="shopCartStore.itemCount > 0"
                data-testid="cart-count"
                class="absolute -top-1 -right-1 w-5 h-5 bg-ios-red text-white text-xs rounded-full flex items-center justify-center font-medium"
              >
                {{ shopCartStore.itemCount }}
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

        <div
          v-if="marketEntryContext && currentMarketCartItemCount > 0"
          data-testid="shop-market-cart-summary"
          class="px-5 pb-3"
        >
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-900"
            @click="goToReturnContext"
          >
            <span>
              市場購物籃
              <span class="font-semibold">
                {{ currentMarketCartItemCount }}
              </span>
              項
            </span>
            <span class="font-semibold">
              {{ formatPrice(currentMarketCartSubtotal) }}
            </span>
          </button>
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
          <!-- 搜尋框 -->
          <div class="relative">
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('shopMenu.searchPlaceholder')"
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

          <!--
            The menu below stays fully browsable; only the buttons that would
            put something in a cart are gone. Placed above the entry context so
            it is the first thing read after the search box.
          -->
          <section
            v-if="orderingBlockedReason"
            data-testid="shop-ordering-blocked"
            :data-block-reason="orderingBlockedReason"
            class="bg-ios-card rounded-2xl shadow-card-sm px-4 py-3"
          >
            <p class="text-sm font-semibold text-ios-text">
              {{ t(BLOCKED_COPY[orderingBlockedReason].title) }}
            </p>
            <p class="mt-1 text-sm text-ios-secondary">
              {{ t(BLOCKED_COPY[orderingBlockedReason].description) }}
            </p>
          </section>

          <section
            v-if="linkedTargetLabel || returnContext"
            data-testid="shop-menu-entry-context"
            class="rounded-xl border border-ios-blue/20 bg-ios-blue/5 px-4 py-3"
          >
            <p
              v-if="linkedTargetLabel"
              class="text-sm font-medium text-ios-text"
            >
              {{
                tWithParams("shopMenu.locatedTo", { target: linkedTargetLabel })
              }}
            </p>
            <p v-else class="text-sm font-medium text-ios-text">
              {{ t("shopMenu.viewingShop") }}
            </p>
            <button
              v-if="returnContext"
              type="button"
              data-testid="shop-menu-return-context"
              class="mt-2 inline-flex text-sm font-medium text-ios-blue"
              @click="goToReturnContext"
            >
              返回{{ returnContext.label }}
            </button>
          </section>

          <!--
            店家評分與評價：跟著搜尋框與狀態提示之後、菜單之前，讓人在點餐前
            先看得到別人怎麼說。沒有任何評價時整塊不出現。
          -->
          <ShopReviewsSection
            :restaurant-id="restaurantId"
            :rating="restaurant?.rating"
            :review-count="restaurant?.reviewCount"
          />

          <section
            v-if="marketMemberships.length > 0"
            data-testid="shop-market-context"
            class="rounded-xl border border-gray-200 bg-white px-4 py-3"
          >
            <h2 class="text-sm font-semibold text-ios-text">所屬夜市與商圈</h2>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="membership in marketMemberships"
                :key="membership.marketId"
                type="button"
                :data-testid="`shop-market-link-${membership.market.slug}`"
                class="rounded-full border border-ios-blue/20 bg-ios-blue/5 px-3 py-1.5 text-sm font-medium text-ios-blue"
                @click="openMarketPage(membership.marketUrl)"
              >
                {{ membership.market.name }}
                <span
                  :data-testid="`shop-market-type-${membership.market.slug}`"
                  class="ml-1 text-xs text-ios-blue/70"
                >
                  {{ t(marketTypeLabelKey(membership.market.type)) }}
                </span>
                <span
                  v-if="membership.stallNumber"
                  class="ml-1 text-xs text-ios-blue/70"
                >
                  {{ membership.stallNumber }}
                </span>
              </button>
            </div>
          </section>

          <!-- 店家服務 -->
          <section
            v-if="serviceItems.length > 0"
            :id="SHOP_MENU_SERVICES_ELEMENT_ID"
            data-testid="shop-service-items"
            class="scroll-mt-32 space-y-3"
          >
            <div>
              <h2 class="text-xl font-semibold text-ios-text">店家服務</h2>
              <p class="mt-0.5 text-sm text-ios-secondary">
                查看此店鋪提供的預約、外送或其他現場服務
              </p>
            </div>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <article
                v-for="service in serviceItems"
                :id="serviceItemElementId(service.id)"
                :key="service.id"
                class="rounded-xl border bg-white p-4 shadow-[0_1px_4px_rgb(0,0,0,0.03)]"
                :class="
                  linkedServiceId === service.id
                    ? 'border-ios-blue ring-2 ring-ios-blue/20'
                    : 'border-gray-100'
                "
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="font-medium text-ios-text">
                        {{ service.name }}
                      </h3>
                      <span
                        class="rounded bg-ios-blue/10 px-2 py-0.5 text-xs font-medium text-ios-blue"
                      >
                        {{ serviceTypeLabel(service.serviceType) }}
                      </span>
                    </div>
                    <p
                      v-if="service.description"
                      class="mt-1 text-sm text-ios-secondary"
                    >
                      {{ service.description }}
                    </p>
                  </div>
                  <span
                    v-if="service.requiresBooking"
                    class="shrink-0 rounded bg-ios-orange/15 px-2 py-0.5 text-xs font-medium text-ios-orange"
                  >
                    需預約
                  </span>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span
                    v-if="servicePriceLabel(service)"
                    class="font-semibold text-ios-text"
                  >
                    {{ servicePriceLabel(service) }}
                  </span>
                  <span
                    v-if="service.durationMinutes"
                    class="text-ios-secondary"
                  >
                    約 {{ service.durationMinutes }} 分鐘
                  </span>
                </div>
                <div
                  v-if="service.tags?.length"
                  class="mt-3 flex flex-wrap gap-1"
                >
                  <span
                    v-for="tag in service.tags.slice(0, 4)"
                    :key="tag"
                    class="rounded bg-gray-50 px-2 py-0.5 text-xs text-gray-500"
                  >
                    {{ tag }}
                  </span>
                </div>
                <button
                  v-if="service.requiresBooking"
                  type="button"
                  data-testid="shop-service-booking"
                  class="mt-3 inline-flex text-sm font-medium text-ios-blue"
                  @click="openServiceBooking(service)"
                >
                  站內預約
                </button>
                <a
                  v-else-if="safeExternalHref(service.bookingUrl)"
                  :href="safeExternalHref(service.bookingUrl)!"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-3 inline-flex text-sm font-medium text-ios-blue"
                >
                  開啟預約
                </a>
              </article>
            </div>
          </section>
          <section
            v-else
            data-testid="shop-empty-services"
            class="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-5"
          >
            <h2 class="text-base font-semibold text-ios-text">
              尚未提供公開服務
            </h2>
            <p class="mt-1 text-sm leading-6 text-ios-secondary">
              這間店目前沒有公開的預約、外送或現場服務，仍可查看可點選的菜單商品。
            </p>
          </section>

          <!-- 推薦菜品 -->
          <section v-if="featuredItems.length > 0" class="mb-8">
            <h2 class="text-xl font-semibold text-ios-text mb-4">
              {{ t("shopMenu.recommended") }}
            </h2>
            <div
              class="flex gap-3 md:gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-5 px-5"
            >
              <MenuItemCard
                v-for="(item, index) in featuredItems"
                :key="item.id"
                :ordering-disabled="orderingBlocked"
                :item="item"
                :is-featured="true"
                :anchor-id="null"
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

          <!-- 分類餐點 -->
          <section
            v-if="filteredCategories.length > 0"
            data-testid="shop-dish-items"
            class="space-y-6"
          >
            <div>
              <h2 class="text-xl font-semibold text-ios-text">餐點</h2>
              <p class="mt-0.5 text-sm text-ios-secondary">
                可直接加入購物車的現點餐點
              </p>
            </div>

            <section
              v-for="category in filteredCategories"
              :id="menuCategoryElementId(category.id)"
              :key="category.id"
              class="scroll-mt-32"
            >
              <div
                class="sticky bg-ios-bg/95 backdrop-blur-sm py-3 z-10 -mx-5 px-5"
                :class="visibleCategories.length > 0 ? 'top-32' : 'top-16'"
              >
                <h3 class="text-lg font-semibold text-ios-text">
                  {{ getLocalizedMenuName(category, currentLanguage) }}
                </h3>
                <p
                  v-if="category.description"
                  class="text-sm text-ios-secondary mt-0.5"
                >
                  {{ category.description }}
                </p>
              </div>

              <div
                class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4"
              >
                <MenuItemCard
                  v-for="(item, index) in getItemsByCategory(category.id)"
                  :key="item.id"
                  :ordering-disabled="orderingBlocked"
                  :item="item"
                  :anchor-id="menuItemElementId(item.id)"
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
          </section>

          <!-- 商品型錄 -->
          <section
            v-if="filteredProductItems.length > 0"
            data-testid="shop-product-items"
            class="space-y-3"
          >
            <div>
              <h2 class="text-xl font-semibold text-ios-text">商品</h2>
              <p class="mt-0.5 text-sm text-ios-secondary">
                店家販售的伴手禮、周邊或非現點商品
              </p>
            </div>
            <div
              class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4"
            >
              <MenuItemCard
                v-for="(item, index) in filteredProductItems"
                :key="item.id"
                :ordering-disabled="orderingBlocked"
                :item="item"
                :anchor-id="menuItemElementId(item.id)"
                class="animate-slide-up"
                :style="{
                  animationDelay: `${index * 50}ms`,
                  animationFillMode: 'both',
                }"
                @add-to-cart="handleAddToCart"
                @view-details="handleViewDetails"
              />
            </div>
          </section>
          <section
            v-if="!hasAvailableCatalogItems && !searchQuery"
            data-testid="shop-empty-menu"
            class="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-5"
          >
            <h2 class="text-base font-semibold text-ios-text">
              尚未提供可點選的菜單商品
            </h2>
            <p class="mt-1 text-sm leading-6 text-ios-secondary">
              這間店目前沒有上架中的商品，仍可查看店家服務或從所屬夜市與商圈返回探索其他店鋪。
            </p>
          </section>

          <!-- 搜尋無結果 -->
          <div
            v-if="
              searchQuery &&
              filteredCategories.length === 0 &&
              filteredProductItems.length === 0
            "
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
              {{ t("shopMenu.noResults") }}
            </h3>
            <p class="text-ios-secondary">
              {{ t("shopMenu.tryOtherKeywords") }}
            </p>
          </div>
        </div>

        <!-- Right: Desktop cart panel -->
        <Transition name="slide-in-right">
          <DesktopCartPanel
            v-if="isDesktop && shopCartStore.itemCount > 0"
            :items="shopCartStore.items"
            :item-count="shopCartStore.itemCount"
            :subtotal="shopCartStore.subtotal"
            @checkout="showCart = true"
            @remove-item="shopCartStore.removeItem($event)"
            @update-quantity="
              (id, qty) => shopCartStore.updateQuantity(id, qty)
            "
          />
        </Transition>
      </div>
    </main>

    <!-- 底部固定購物車按鈕 -->
    <div
      v-if="shopCartStore.itemCount > 0"
      class="fixed bottom-4 left-4 right-4 z-50 max-w-lg mx-auto lg:hidden"
    >
      <button
        class="w-full bg-ios-blue text-white font-semibold py-4 px-6 rounded-full shadow-card-lg active:scale-[0.98] transition-transform duration-150 flex items-center justify-between"
        @click="showCart = true"
      >
        <div class="flex items-center space-x-3">
          <div
            class="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center"
          >
            <span class="text-sm font-bold">{{ shopCartStore.itemCount }}</span>
          </div>
          <span>{{ t("shopMenu.viewCart") }}</span>
        </div>
        <div class="text-lg font-bold">
          {{ formatPrice(shopCartStore.subtotal) }}
        </div>
      </button>
    </div>

    <!-- 菜品詳情彈窗 -->
    <MenuItemModal
      v-if="selectedItem"
      :item="selectedItem"
      :show="showItemModal"
      :ordering-disabled="orderingBlocked"
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

    <!-- 購物車彈窗 -->
    <ShopCartModal
      :show="showCart"
      :restaurant-id="restaurantId"
      :shop-qr-code="shopQrCode"
      :waiting-ticket-id="waitingTicketId"
      :ordering-disabled="orderingBlocked"
      @close="showCart = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useToast } from "vue-toastification";
import { useI18n } from "@/composables/useI18n";
import { useAppStore } from "@/stores/app";
import { useMarketCartStore } from "@/stores/marketCart";
import { useShopCartStore } from "@/stores/shopCart";
import MenuItemCard from "@/components/MenuItemCard.vue";
import MenuItemModal from "@/components/MenuItemModal.vue";
import CustomizationModal from "@/components/CustomizationModal.vue";
import ShopCartModal from "@/components/ShopCartModal.vue";
import DesktopCartPanel from "@/components/DesktopCartPanel.vue";
import { useIsDesktop } from "@/composables/useBreakpoint";
import ShopReviewsSection from "@/components/reviews/ShopReviewsSection.vue";
import { menuApi } from "@/services/menuApi";
import { discoveryApi } from "@/services/discoveryApi";
import { shopQrApi } from "@/services/shopQrApi";
import { restaurantContactApi } from "@/services/restaurantContactApi";
import { useCurrency } from "@/composables/useCurrency";
import type {
  MenuItem,
  RestaurantServiceItem,
  SelectedCustomizations,
} from "@makanmasak/shared-types";
import { applyShopMenuSeoMeta } from "@/utils/seoMeta";
import {
  findMenuCategoryByQuery,
  findMenuItemByQuery,
  findServiceItemByQuery,
  menuCategoryElementId,
  menuItemElementId,
  SHOP_MENU_SERVICES_ELEMENT_ID,
  serviceItemElementId,
  shouldOpenServicesSection,
} from "@/utils/shopMenuDeepLink";
import { marketTypeLabelKey } from "@/utils/marketTypes";
import { safeExternalHref } from "@/utils/safeExternalHref";
import {
  getLocalizedMenuName,
  menuItemMatchesQuery,
} from "@/utils/localized-menu-content";

// Props
const props = defineProps<{
  restaurantId: string;
  shopQrCode?: string;
  waitingTicketId?: string;
  linkedItemId?: string | string[] | null;
  linkedCategoryName?: string | string[] | null;
  linkedServiceItemId?: string | string[] | null;
  linkedServices?: string | string[] | null;
  returnPath?: string | null;
  returnLabel?: string | null;
}>();

// Composables
const router = useRouter();
const route = useRoute();
const toast = useToast();
const { t, tWithParams, currentLanguage } = useI18n();
const appStore = useAppStore();
const marketCartStore = useMarketCartStore();
const shopCartStore = useShopCartStore();
const isDesktop = useIsDesktop();
const { formatPrice } = useCurrency();

// State
const searchQuery = ref("");
const activeCategoryId = ref<number | null>(null);
const selectedItem = ref<MenuItem | null>(null);
const customizingItem = ref<MenuItem | null>(null);
const showItemModal = ref(false);
const showCustomizationModal = ref(false);
const showCart = ref(false);
const openedLinkedItemId = ref<number | null>(null);
const openedLinkedCategoryId = ref<number | null>(null);
const openedLinkedServiceItemId = ref<number | null>(null);
const openedServicesSection = ref(false);

// 初始化店家購物車
onMounted(() => {
  shopCartStore.initializeCart(props.restaurantId);
});

// API Queries
const { data: restaurant, isLoading: isLoadingRestaurant } = useQuery({
  queryKey: ["restaurant", props.restaurantId],
  queryFn: () => menuApi.getRestaurant(props.restaurantId),
  staleTime: 5 * 60 * 1000, // 5分鐘
});

const {
  data: menuStructure,
  isLoading: isLoadingMenu,
  error: menuError,
  refetch,
} = useQuery({
  queryKey: ["menu", props.restaurantId],
  queryFn: () => menuApi.getMenu(props.restaurantId),
  staleTime: 2 * 60 * 1000, // 2分鐘
  refetchOnWindowFocus: true,
});

const { data: serviceItemsData } = useQuery({
  queryKey: ["restaurant-service-items", props.restaurantId],
  queryFn: () => restaurantContactApi.listServiceItems(props.restaurantId),
  staleTime: 5 * 60 * 1000,
});

const { data: restaurantMarketsData } = useQuery({
  queryKey: ["restaurant-markets", props.restaurantId],
  queryFn: () => discoveryApi.getRestaurantMarkets(props.restaurantId),
  staleTime: 5 * 60 * 1000,
});

/**
 * This page is not only reached through `OrderTypeLandingView`. Market and
 * discovery vendor links (`openDishVendor`, `openServiceVendor`) and plain
 * bookmarks open it directly, so the entry page's checks do not cover it and
 * the same two questions have to be asked again here.
 *
 * The answer only removes ordering, never the menu: browsing a shop that has
 * paused QR orders is a legitimate thing to do, and a market page that links
 * to a vendor should not turn into a dead end.
 */
const { data: shopQrVerification } = useQuery({
  queryKey: ["shop-qr-verify", props.shopQrCode],
  queryFn: () => shopQrApi.verify(props.shopQrCode as string),
  enabled: Boolean(props.shopQrCode),
  staleTime: 5 * 60 * 1000,
  // A failed request is not a verdict — `shopQrApi.verify` only resolves for a
  // real answer and rethrows the rest, so leaving this undefined on error keeps
  // a flaky network from locking a valid shop out of ordering.
  retry: 1,
});

// Computed
const isLoading = computed(
  () => isLoadingRestaurant.value || isLoadingMenu.value,
);
const error = computed(() => menuError.value?.message || null);

/**
 * Why ordering is off, or null when it is on. Mirrors `OrderTypeLandingView`'s
 * `BlockedReason`, and like it defers to the server on both questions rather
 * than inferring anything from the route.
 *
 * Undecided while the restaurant is still loading: assuming "blocked" would
 * flash a warning at every visitor, and assuming "fine" would let a tap land
 * in the window before the answer arrives. `isLoading` already hides the menu
 * until then, so neither happens.
 */
const orderingBlockedReason = computed<"qrRevoked" | "shopDisabled" | null>(
  () => {
    if (!restaurant.value) return null;

    const verification = shopQrVerification.value;
    if (
      verification &&
      (!verification.valid || verification.restaurantId !== props.restaurantId)
    ) {
      return "qrRevoked";
    }

    return restaurant.value.enableShopMode ? null : "shopDisabled";
  },
);

const orderingBlocked = computed(() => orderingBlockedReason.value !== null);

/**
 * Spelled out rather than interpolated, so the keys stay greppable from the
 * locale files and a new reason without copy fails to compile.
 */
const BLOCKED_COPY: Record<
  "qrRevoked" | "shopDisabled",
  { title: string; description: string }
> = {
  qrRevoked: {
    title: "shopMenu.qrRevokedTitle",
    description: "shopMenu.qrRevokedDescription",
  },
  shopDisabled: {
    title: "shopMenu.shopDisabledTitle",
    description: "shopMenu.shopDisabledDescription",
  },
};

const categories = computed(() => menuStructure.value?.categories || []);
const menuItems = computed(() => menuStructure.value?.menuItems || []);
type MenuCategory = (typeof categories.value)[number];
const serviceItems = computed(() => serviceItemsData.value || []);
const isProductCatalogItem = (item: MenuItem) => item.catalogType === "product";
const isDishMenuItem = (item: MenuItem) =>
  !item.catalogType || item.catalogType === "menu_item";
const hasAvailableCatalogItems = computed(() =>
  menuItems.value.some((item: MenuItem) => item.isAvailable),
);
const visibleCategories = computed(() =>
  categories.value.filter(
    (category) => getItemsByCategory(category.id).length > 0,
  ),
);
const marketMemberships = computed(
  () => restaurantMarketsData.value?.memberships ?? [],
);
const linkedMenuItem = computed(() =>
  findMenuItemByQuery(menuItems.value, props.linkedItemId),
);
const linkedService = computed(() =>
  findServiceItemByQuery(serviceItems.value, props.linkedServiceItemId),
);
const linkedServiceId = computed(() => linkedService.value?.id ?? null);
const linkedServicesSection = computed(() =>
  shouldOpenServicesSection(props.linkedServices),
);
const returnContext = computed(() => {
  const path = props.returnPath?.trim();
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;

  const label = props.returnLabel?.trim() || "上一頁";
  return { path, label };
});
const marketEntryContext = computed(() => {
  const context = returnContext.value;
  if (!context) return null;

  const match = context.path.match(/^\/markets\/([^/?#]+)/);
  if (!match) return null;

  const marketSlug = decodeURIComponent(match[1]);
  const membership = marketMemberships.value.find(
    (entry) => entry.market.slug === marketSlug,
  );

  return {
    slug: marketSlug,
    name: membership?.market.name ?? context.label ?? marketSlug,
  };
});
const currentMarketCart = computed(() =>
  marketEntryContext.value
    ? marketCartStore.cartForMarket(marketEntryContext.value.slug)
    : null,
);
const currentMarketCartItemCount = computed(() =>
  currentMarketCart.value
    ? marketCartStore.itemCountForCart(currentMarketCart.value)
    : 0,
);
const currentMarketCartSubtotal = computed(() =>
  currentMarketCart.value
    ? marketCartStore.subtotalForCart(currentMarketCart.value)
    : 0,
);
const linkedTargetLabel = computed(() => {
  // The name was already localised here; the "服務／商品／餐點：" prefix was not,
  // so an English visitor got the mixed string "餐點：Hainanese Chicken Rice".
  // Each locale owns the whole label, punctuation included — a shared
  // "{kind}：{name}" template would impose the CJK colon on every language.
  if (linkedService.value) {
    return tWithParams("shopMenu.targetService", {
      name: linkedService.value.name,
    });
  }
  if (linkedMenuItem.value) {
    const name = getLocalizedMenuName(
      linkedMenuItem.value,
      currentLanguage?.value,
    );
    return isProductCatalogItem(linkedMenuItem.value)
      ? tWithParams("shopMenu.targetProduct", { name })
      : tWithParams("shopMenu.targetDish", { name });
  }
  return "";
});

const featuredItems = computed(() =>
  menuItems.value.filter(
    (item: MenuItem) =>
      isDishMenuItem(item) && item.isFeatured && item.isAvailable,
  ),
);

const productItems = computed(() =>
  menuItems.value
    .filter((item: MenuItem) => isProductCatalogItem(item) && item.isAvailable)
    .sort((a: MenuItem, b: MenuItem) => a.sortOrder - b.sortOrder),
);

const filteredProductItems = computed(() => {
  if (!searchQuery.value.trim()) return productItems.value;

  const query = searchQuery.value.toLowerCase().trim();
  return productItems.value.filter((item: MenuItem) =>
    menuItemMatchesQuery(item, query),
  );
});

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
    (item: MenuItem) =>
      isDishMenuItem(item) &&
      item.categoryId === categoryId &&
      item.isAvailable,
  );

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim();
    items = items.filter((item: MenuItem) => menuItemMatchesQuery(item, query));
  }

  return items.sort((a: MenuItem, b: MenuItem) => a.sortOrder - b.sortOrder);
};

const serviceTypeLabel = (type: RestaurantServiceItem["serviceType"]) => {
  const labels: Record<RestaurantServiceItem["serviceType"], string> = {
    general: "一般服務",
    booking: "預約",
    pickup: "自取",
    delivery: "外送",
    consultation: "諮詢",
    rental: "租借",
    activity: "活動",
  };
  return labels[type] ?? "服務";
};

const servicePriceLabel = (service: RestaurantServiceItem) => {
  if (service.priceLabel) return service.priceLabel;
  if (typeof service.priceCents === "number") {
    return formatPrice(service.priceCents / 100);
  }
  return "";
};

const scrollToCategory = (categoryId: number) => {
  activeCategoryId.value = categoryId;
  const element = document.getElementById(menuCategoryElementId(categoryId));
  if (element) {
    element.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
};

const goToReturnContext = () => {
  if (!returnContext.value) return;
  router.push(returnContext.value.path);
};

const currentShopPath = () => {
  const path = route.fullPath || route.path;
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return `/restaurant/${props.restaurantId}/shop/menu`;
  }
  return path;
};

const openMarketPage = (marketUrl: string) => {
  const url = new URL(marketUrl, "https://makan.local");
  url.searchParams.set("returnPath", currentShopPath());
  url.searchParams.set("returnLabel", restaurant.value?.name ?? "店鋪");

  router.push(`${url.pathname}${url.search}${url.hash}`);
};

const openServiceBooking = (service: RestaurantServiceItem) => {
  router.push({
    name: "ServiceBooking",
    params: {
      restaurantId: props.restaurantId,
      serviceItemId: String(service.id),
    },
  });
};

const goBack = () => {
  if (returnContext.value) {
    goToReturnContext();
    return;
  }
  router.back();
};

const handleAddToCart = (data: {
  item: MenuItem;
  quantity: number;
  customizations?: SelectedCustomizations;
  notes?: string;
}) => {
  // Every add — card, detail modal, customization modal — arrives here, which
  // is why the check lives at this one point rather than at each button. The
  // buttons are disabled too; this is what holds if one is ever missed.
  const blocked = orderingBlockedReason.value;
  if (blocked) {
    toast.error(t(BLOCKED_COPY[blocked].title));
    return;
  }

  shopCartStore.addItem(
    data.item,
    data.quantity,
    data.customizations,
    data.notes,
  );

  if (marketEntryContext.value) {
    marketCartStore.addItem({
      marketSlug: marketEntryContext.value.slug,
      marketName: marketEntryContext.value.name,
      restaurantId: props.restaurantId,
      restaurantName: restaurant.value?.name ?? "店鋪",
      item: data.item,
      quantity: data.quantity,
      customizations: data.customizations,
      notes: data.notes,
    });
  }

  toast.success(
    tWithParams("toast.itemAdded", {
      name: getLocalizedMenuName(data.item, currentLanguage?.value),
      quantity: data.quantity,
    }),
  );

  // 關閉彈窗
  showItemModal.value = false;
  showCustomizationModal.value = false;
  selectedItem.value = null;
  customizingItem.value = null;
};

const handleViewDetails = (item: MenuItem) => {
  selectedItem.value = item;
  showItemModal.value = true;
};

const scrollToLinkedCategory = async () => {
  const category = findMenuCategoryByQuery(
    categories.value,
    props.linkedCategoryName,
  );
  if (!category || openedLinkedCategoryId.value === category.id) return;

  openedLinkedCategoryId.value = category.id;
  activeCategoryId.value = category.id;
  await nextTick();

  document.getElementById(menuCategoryElementId(category.id))?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
};

const openLinkedMenuItem = async () => {
  const item = linkedMenuItem.value;
  if (!item) {
    await scrollToLinkedCategory();
    return;
  }
  if (openedLinkedItemId.value === item.id) return;

  openedLinkedItemId.value = item.id;
  openedLinkedCategoryId.value = item.categoryId;
  activeCategoryId.value = item.categoryId;
  await nextTick();

  document.getElementById(menuItemElementId(item.id))?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
  handleViewDetails(item);
};

const scrollToLinkedServiceItem = async () => {
  const service = linkedService.value;
  if (!service || openedLinkedServiceItemId.value === service.id) return;

  await nextTick();

  const element = document.getElementById(serviceItemElementId(service.id));
  if (!element) return;

  openedLinkedServiceItemId.value = service.id;
  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
};

const scrollToLinkedServicesSection = async () => {
  if (
    !linkedServicesSection.value ||
    linkedService.value ||
    openedServicesSection.value ||
    serviceItems.value.length === 0
  ) {
    return;
  }

  await nextTick();

  const element = document.getElementById(SHOP_MENU_SERVICES_ELEMENT_ID);
  if (!element) return;

  openedServicesSection.value = true;
  element.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
};

// 監聽滾動位置更新活躍分類
const updateActiveCategoryOnScroll = () => {
  const sections = visibleCategories.value.map((category: MenuCategory) => ({
    id: category.id,
    element: document.getElementById(menuCategoryElementId(category.id)),
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
  scrollToLinkedServiceItem();
  scrollToLinkedServicesSection();

  // 設定餐廳上下文（店家模式）
  if (restaurant.value) {
    appStore.setRestaurantContext(restaurant.value, 0); // 0 表示店家模式無桌號
  }
});

onUnmounted(() => {
  window.removeEventListener("scroll", updateActiveCategoryOnScroll);
});

// 監聽餐廳資料變化
watch(restaurant, (newRestaurant) => {
  if (newRestaurant) {
    appStore.setRestaurantContext(newRestaurant, 0);
  }
});

watch(
  [restaurant, menuStructure],
  ([newRestaurant, newMenuStructure]) => {
    if (!newRestaurant || !newMenuStructure) return;

    applyShopMenuSeoMeta({
      restaurant: newRestaurant,
      categories: newMenuStructure.categories,
      menuItems: newMenuStructure.menuItems,
      path: route.path,
    });
  },
  { immediate: true },
);

watch(
  [menuStructure, () => props.linkedItemId, () => props.linkedCategoryName],
  () => {
    openLinkedMenuItem();
  },
  { immediate: true },
);

watch(
  [serviceItems, () => props.linkedServiceItemId, () => props.linkedServices],
  () => {
    scrollToLinkedServiceItem();
    scrollToLinkedServicesSection();
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
