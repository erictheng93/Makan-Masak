<template>
  <div class="min-h-screen bg-ios-bg" data-testid="cart-page">
    <!-- 頂部導航 -->
    <nav class="sticky top-0 z-40 bg-white/80 backdrop-blur-xl shadow-card-sm">
      <div class="max-w-md mx-auto px-5 py-4">
        <div class="flex items-center justify-between">
          <button
            class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-ios-text transition-all duration-200"
            @click="router.back()"
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
            <h1 class="text-lg font-semibold text-ios-text">
              {{ t("cart.title") }}
            </h1>
            <p class="text-sm text-ios-secondary">
              {{ restaurant?.name }} · {{ t("order.details.table") }}
              {{ orderContextLabel }}
            </p>
          </div>

          <div class="w-8 h-8" />
          <!-- 占位符保持居中 -->
        </div>
      </div>
    </nav>

    <!-- 主要內容 -->
    <main class="max-w-md mx-auto">
      <!-- 空購物車狀態 -->
      <div v-if="cartStore.isEmpty" class="px-4 py-16 text-center">
        <div
          class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6"
        >
          <svg
            class="w-10 h-10 text-gray-400"
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
        </div>
        <h2 class="text-xl font-semibold text-ios-text mb-2">
          {{ t("cart.empty") }}
        </h2>
        <p class="text-ios-secondary mb-8">
          {{ t("cart.emptyDesc") }}
        </p>
        <button
          class="px-6 py-3 bg-ios-blue text-white font-semibold rounded-full active:scale-[0.98] transition-transform duration-150"
          @click="router.push(menuRoute)"
        >
          {{ t("cart.goToMenu") }}
        </button>
      </div>

      <!-- 購物車項目 -->
      <div v-else class="px-4 py-6 space-y-6">
        <!-- 餐點列表 -->
        <div class="space-y-4">
          <CartItemCard
            v-for="item in cartStore.items"
            :key="item.id"
            :item="item"
            @update-quantity="handleUpdateQuantity"
            @update-notes="handleUpdateNotes"
            @remove="handleRemoveItem"
          />
        </div>

        <!-- 訂單摘要 -->
        <div class="bg-white rounded-2xl p-6 shadow-card">
          <h3 class="text-lg font-semibold text-ios-text mb-4">
            {{ t("order.title") }}
          </h3>

          <div class="space-y-3">
            <!-- 小計 -->
            <div class="flex justify-between text-ios-secondary">
              <span>{{ t("cart.subtotal") }}</span>
              <span>{{ formatPrice(cartStore.subtotal) }}</span>
            </div>

            <!-- 服務費 -->
            <div
              v-if="serviceCharge > 0"
              class="flex justify-between text-ios-secondary"
            >
              <span>{{ t("cart.serviceCharge") }}</span>
              <span>{{ formatPrice(serviceCharge) }}</span>
            </div>

            <!-- 稅費 -->
            <div v-if="tax > 0" class="flex justify-between text-ios-secondary">
              <span>{{ t("cart.tax") }}</span>
              <span>{{ formatPrice(tax) }}</span>
            </div>

            <!-- 折扣 -->
            <div
              v-if="discount > 0"
              class="flex justify-between text-green-600"
            >
              <span>{{ t("cart.discount") }}</span>
              <span>-{{ formatPrice(discount) }}</span>
            </div>

            <!-- 分隔線 -->
            <div class="border-t border-ios-separator" />

            <!-- 最低消費提醒 -->
            <div
              v-if="minimumOrderEnabled && minimumOrderAmount > 0"
              class="p-3 rounded-2xl"
              :class="[
                isMinimumOrderMet ? 'bg-ios-green/10' : 'bg-ios-orange/10',
              ]"
            >
              <div class="flex items-center space-x-2">
                <svg
                  v-if="isMinimumOrderMet"
                  class="w-5 h-5 text-ios-green"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <svg
                  v-else
                  class="w-5 h-5 text-ios-orange"
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
                <div class="flex-1">
                  <p
                    class="text-sm font-medium"
                    :class="[
                      isMinimumOrderMet ? 'text-ios-green' : 'text-ios-orange',
                    ]"
                  >
                    {{
                      tWithParams("cart.minimumOrderNote", {
                        amount: formatPrice(minimumOrderAmount),
                      })
                    }}
                  </p>
                  <p
                    v-if="!isMinimumOrderMet"
                    class="text-sm text-ios-orange mt-1"
                  >
                    {{
                      tWithParams("cart.minimumOrderShortfall", {
                        amount: formatPrice(minimumOrderShortfall),
                      })
                    }}
                  </p>
                  <p v-else class="text-sm text-ios-green mt-1">
                    {{ t("cart.minimumOrderMet") }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 總計 -->
            <div class="flex justify-between text-lg font-bold text-ios-text">
              <span>{{ t("cart.total") }}</span>
              <span>{{ formatPrice(totalAmount) }}</span>
            </div>
          </div>
        </div>

        <!-- 優惠券區域 -->
        <div class="bg-white rounded-2xl p-6 shadow-card">
          <!-- 區域標題 -->
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-ios-text">
              {{ t("cart.coupons") }}
            </h3>
            <button
              v-if="!showAvailableCoupons"
              data-testid="cart-view-coupons"
              class="text-sm text-ios-blue font-medium"
              @click="toggleAvailableCoupons"
            >
              {{ t("cart.viewAvailable") }}
            </button>
          </div>

          <!-- 可用優惠券列表 -->
          <div v-if="showAvailableCoupons" class="mb-6">
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-md font-medium text-ios-text">
                {{ t("cart.availableCoupons") }}
              </h4>
              <button
                class="text-sm text-ios-secondary"
                @click="toggleAvailableCoupons"
              >
                {{ t("common.close") }}
              </button>
            </div>

            <!-- 加載中 -->
            <div v-if="isLoadingCoupons" class="flex justify-center py-4">
              <div
                class="animate-spin rounded-full h-6 w-6 border-2 border-ios-blue/20 border-t-ios-blue"
              />
            </div>

            <!-- 無可用優惠券 -->
            <div
              v-else-if="!availableCoupons.length"
              class="text-center py-4 text-gray-500"
            >
              {{ t("cart.noCouponsAvailable") }}
            </div>

            <!-- 優惠券列表 -->
            <div v-else class="space-y-3 max-h-60 overflow-y-auto">
              <div
                v-for="coupon in availableCoupons"
                :key="coupon.id"
                class="rounded-2xl p-4 bg-ios-bg active:bg-ios-separator cursor-pointer transition-all duration-200"
                :class="{
                  'bg-ios-blue/10 shadow-card-sm':
                    selectedCoupon?.id === coupon.id,
                }"
                @click="selectCoupon(coupon)"
              >
                <div class="flex justify-between items-start">
                  <div class="flex-1">
                    <div class="flex items-center space-x-2">
                      <h5 class="font-semibold text-ios-text">
                        {{ coupon.name }}
                      </h5>
                      <span
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                        :class="getCouponTypeClass(coupon.discountType)"
                      >
                        {{ getCouponTypeText(coupon.discountType) }}
                      </span>
                    </div>
                    <p class="text-sm text-ios-secondary mt-1">
                      {{ coupon.description }}
                    </p>

                    <!-- 折扣信息 -->
                    <div class="mt-2 flex items-center space-x-4 text-sm">
                      <span class="text-ios-blue font-semibold">
                        {{ formatCouponDiscount(coupon) }}
                      </span>
                      <span v-if="coupon.minOrderAmount" class="text-gray-500">
                        {{ t("cart.minOrder") }}: ${{
                          formatPrice(coupon.minOrderAmount)
                        }}
                      </span>
                      <span
                        v-if="
                          coupon.maxDiscountAmount &&
                          coupon.discountType === 'percentage'
                        "
                        class="text-gray-500"
                      >
                        {{ t("cart.maxDiscount") }}: ${{
                          formatPrice(coupon.maxDiscountAmount)
                        }}
                      </span>
                    </div>

                    <!-- 有效期 -->
                    <div class="mt-2 text-xs text-gray-400">
                      {{ t("cart.validUntil") }}:
                      {{
                        formatCouponExpiry(
                          coupon.validTo ?? coupon.expiresAt ?? "",
                        )
                      }}
                    </div>
                  </div>

                  <!-- 選擇指示器 -->
                  <div class="ml-3">
                    <div
                      v-if="selectedCoupon?.id === coupon.id"
                      class="w-5 h-5 bg-ios-blue rounded-full flex items-center justify-center"
                    >
                      <svg
                        class="w-3 h-3 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <div
                      v-else
                      class="w-5 h-5 border-2 border-ios-separator rounded-full"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- 應用選擇的優惠券 -->
            <div
              v-if="selectedCoupon && !appliedCoupon"
              class="mt-4 pt-4 border-t border-ios-separator"
            >
              <button
                class="w-full bg-ios-blue text-white py-2.5 px-4 rounded-full active:scale-[0.98] transition-transform duration-150 font-medium"
                @click="applyCouponFromList"
              >
                {{ t("cart.applyCoupon") }} -
                {{ formatCouponDiscount(selectedCoupon) }}
              </button>
            </div>
          </div>

          <!-- 手動輸入優惠券 -->
          <div>
            <div class="flex items-center space-x-2 mb-3">
              <span class="text-sm font-medium text-ios-text">{{
                t("cart.orEnterCode")
              }}</span>
              <div class="flex-1 h-px bg-ios-separator" />
            </div>

            <div class="flex space-x-3">
              <input
                id="coupon-code"
                v-model="couponCode"
                data-testid="coupon-code"
                type="text"
                :placeholder="t('cart.couponPlaceholder')"
                :disabled="isValidatingCoupon"
                class="flex-1 px-4 py-2.5 bg-ios-bg rounded-xl border-0 focus:ring-2 focus:ring-ios-blue/30 focus:bg-white text-ios-text placeholder:text-ios-tertiary transition-all duration-200 disabled:opacity-50"
                @input="onCouponInput"
                @keyup.enter="validateCoupon"
              />
              <button
                data-testid="coupon-apply"
                :disabled="!couponCode.trim() || isValidatingCoupon"
                class="px-5 py-2.5 bg-ios-blue text-white text-sm font-semibold rounded-full active:scale-95 transition-transform duration-150 disabled:bg-ios-separator disabled:text-ios-tertiary"
                @click="validateCoupon"
              >
                <div
                  v-if="isValidatingCoupon"
                  class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mx-1"
                />
                <span v-else>{{ t("cart.applyCoupon") }}</span>
              </button>
            </div>
          </div>

          <!-- 優惠券驗證狀態 -->
          <div v-if="couponValidationMessage" class="mt-3">
            <div
              v-if="couponValidationError"
              class="flex items-center text-sm text-ios-red"
            >
              <svg
                class="w-4 h-4 mr-2"
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
              {{ couponValidationMessage }}
            </div>
            <div v-else class="flex items-center text-sm text-ios-green">
              <svg
                class="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {{ couponValidationMessage }}
            </div>
          </div>

          <!-- 已應用的優惠券 -->
          <div
            v-if="appliedCoupon"
            class="mt-4 p-3.5 bg-ios-green/10 rounded-2xl"
          >
            <div class="flex justify-between items-center">
              <div>
                <div class="flex items-center space-x-2">
                  <svg
                    class="w-5 h-5 text-ios-green"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span class="text-sm font-medium text-ios-green">{{
                    appliedCoupon.name || appliedCoupon.code
                  }}</span>
                </div>
                <p class="text-sm text-ios-green mt-1">
                  {{ t("cart.saving") }} ${{
                    formatPrice(couponDiscountAmount)
                  }}
                </p>
              </div>
              <button
                class="text-sm text-ios-green font-medium"
                @click="clearCoupon"
              >
                {{ t("cart.removeCoupon") }}
              </button>
            </div>
          </div>
        </div>

        <!-- 智能推薦優惠券 -->
        <CouponRecommendation
          v-if="!appliedCoupon && availableCoupons.length > 0"
          :coupons="availableCoupons"
          :order-amount="cartStore.subtotal"
          @select-coupon="selectAndApplyCoupon"
        />

        <!-- 備註欄位 -->
        <div class="bg-white rounded-2xl p-6 shadow-card">
          <label
            for="order-notes"
            class="block text-sm font-medium text-ios-text mb-3"
          >
            {{ t("cart.notes") }} ({{ t("menuItem.optional") }})
          </label>
          <textarea
            id="order-notes"
            v-model="orderNotes"
            data-testid="order-notes"
            rows="3"
            :placeholder="t('menuItem.notesPlaceholder')"
            class="w-full px-4 py-3 bg-ios-bg rounded-xl border-0 focus:ring-2 focus:ring-ios-blue/30 focus:bg-white text-ios-text placeholder:text-ios-tertiary resize-none transition-all duration-200"
          />
        </div>

        <!-- 顧客資訊 -->
        <div class="bg-white rounded-2xl p-6 shadow-card">
          <h3 class="text-lg font-semibold text-ios-text mb-4">
            {{ t("order.details.customerInfo") }}
          </h3>

          <div class="space-y-4">
            <div>
              <label
                for="customer-name"
                class="block text-sm font-medium text-ios-text mb-2"
              >
                {{ t("order.details.customerName") }} ({{
                  t("menuItem.optional")
                }})
              </label>
              <input
                id="customer-name"
                v-model="customerInfo.name"
                type="text"
                :placeholder="t('order.details.customerName')"
                class="w-full px-4 py-3 bg-ios-bg rounded-xl border-0 focus:ring-2 focus:ring-ios-blue/30 focus:bg-white text-ios-text placeholder:text-ios-tertiary transition-all duration-200"
              />
            </div>

            <div>
              <label
                for="customer-phone"
                class="block text-sm font-medium text-ios-text mb-2"
              >
                {{ t("order.details.phone") }} ({{ t("menuItem.optional") }})
              </label>
              <input
                id="customer-phone"
                v-model="customerInfo.phone"
                type="tel"
                :placeholder="t('order.details.phone')"
                class="w-full px-4 py-3 bg-ios-bg rounded-xl border-0 focus:ring-2 focus:ring-ios-blue/30 focus:bg-white text-ios-text placeholder:text-ios-tertiary transition-all duration-200"
              />
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 底部確認按鈕 -->
    <div
      v-if="!cartStore.isEmpty"
      class="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl p-4 shadow-[0_-4px_16px_rgb(0,0,0,0.04)]"
    >
      <div class="max-w-md mx-auto">
        <button
          :disabled="!canPlaceOrder"
          data-testid="submit-order-btn"
          :class="[
            'w-full font-semibold py-4 px-6 rounded-full flex items-center justify-center space-x-2',
            canPlaceOrder
              ? 'bg-ios-blue text-white active:scale-[0.98] transition-transform duration-150'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed',
          ]"
          @click="handleSubmitOrder"
        >
          <div
            v-if="isSubmitting"
            class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"
          />
          <span v-if="isSubmitting">{{ t("order.placeOrder") }}...</span>
          <span v-else-if="!isMinimumOrderMet && minimumOrderEnabled">{{
            tWithParams("cart.minimumOrderShortfall", {
              amount: formatPrice(minimumOrderShortfall),
            })
          }}</span>
          <span v-else
            >{{ t("order.placeOrder") }} · {{ formatPrice(totalAmount) }}</span
          >
        </button>

        <!-- 最低消費提醒（按鈕下方） -->
        <div
          v-if="
            !isMinimumOrderMet && minimumOrderEnabled && minimumOrderAmount > 0
          "
          class="mt-2 text-center"
        >
          <p class="text-sm text-ios-orange">
            {{
              tWithParams("cart.minimumOrderNote", {
                amount: formatPrice(minimumOrderAmount),
              })
            }}
          </p>
        </div>

        <div class="mt-3 text-center">
          <p class="text-sm text-ios-secondary">
            <!-- These connectives need their own keys. Borrowing the generic
                 button labels rendered the consent line as "確認 服務條款 下一步
                 隱私權政策" — four unrelated words where a sentence saying what
                 the diner is agreeing to should be. -->
            {{ t("cart.legalPrefix") }}
            <router-link to="/terms" class="text-ios-blue">
              {{ t("terms.title") }}
            </router-link>
            {{ t("cart.legalConjunction") }}
            <router-link to="/privacy" class="text-ios-blue">
              {{ t("privacy.title") }}
            </router-link>
          </p>
        </div>
      </div>
    </div>

    <!-- 訂單確認對話框 -->
    <ConfirmationModal
      :show="showConfirmation"
      :title="t('order.placeOrder')"
      :message="
        tWithParams('cart.confirmOrderMessage', {
          amount: formatPrice(totalAmount),
        })
      "
      :confirm-text="t('common.confirm')"
      :cancel-text="t('common.cancel')"
      @confirm="submitOrder"
      @cancel="showConfirmation = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation } from "@tanstack/vue-query";
import { useToast } from "vue-toastification";
import { useI18n } from "@/composables/useI18n";
import { useSeatContext } from "@/composables/useSeatContext";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";
import { useCartStore } from "@/stores/cart";
import CartItemCard from "@/components/CartItemCard.vue";
import ConfirmationModal from "@/components/ConfirmationModal.vue";
import CouponRecommendation from "@/components/CouponRecommendation.vue";
import { orderApi } from "@/services/orderApi";
import { apiClient } from "@/services/api";
import { hasCustomerAccessToken } from "@/services/customerAccessToken";
import type { CreateGuestOrderRequest } from "@/services/orderApi";
import menuApi from "@/services/menuApi";
import { useCurrency } from "@/composables/useCurrency";
import { getOrderSubmitErrorI18nKey } from "@/utils/order-submit-error";
import type { CreateOrderRequest } from "@makanmasak/shared-types";
import type { CouponValidationResult, CustomerCoupon } from "@/types/coupon";

// Props
const props = defineProps<{
  restaurantId: string;
  tableId: number;
}>();

// Composables
const router = useRouter();
const toast = useToast();
const { t, tWithParams, currentLanguage } = useI18n();
const cartStore = useCartStore();
const { formatPrice } = useCurrency();

const { seatId, seatLabel, seatQuery } = useSeatContext();

// Staff route food by the label printed on the table, not by the row id, so the
// cart header must agree with the menu header and with the physical table.
const tableLabel = computed(
  () => tableValidation.value?.table?.number ?? String(props.tableId),
);

const orderContextLabel = computed(() =>
  seatLabel.value
    ? tWithParams("menu.seatContext", {
        table: tableLabel.value,
        seat: seatLabel.value,
      })
    : tableLabel.value,
);

const menuRoute = computed(() => ({
  name: "RestaurantMenu",
  params: {
    restaurantId: props.restaurantId,
    tableId: props.tableId,
  },
  query: seatQuery.value,
}));

// State
const orderNotes = ref("");
const customerInfo = ref({
  name: "",
  phone: "",
});
const showConfirmation = ref(false);
const isSubmitting = ref(false);

// 優惠券相關狀態
const couponCode = ref("");
const appliedCoupon = ref<CustomerCoupon | null>(null);
const isValidatingCoupon = ref(false);
const couponValidationMessage = ref("");
const couponValidationError = ref(false);
const couponDiscountAmount = ref(0);

// 可用優惠券列表相關狀態
const showAvailableCoupons = ref(false);
const isLoadingCoupons = ref(false);
const availableCoupons = ref<CustomerCoupon[]>([]);
const selectedCoupon = ref<CustomerCoupon | null>(null);

// 最低消費相關狀態
const minimumOrderAmount = ref(0);
const minimumOrderEnabled = ref(false);

// API Queries
const { data: restaurant } = useQuery({
  queryKey: ["restaurant", props.restaurantId],
  queryFn: () => menuApi.getRestaurant(props.restaurantId),
  staleTime: 5 * 60 * 1000,
});

// Same query key MenuView uses, so arriving from the menu reads its cache and
// costs no extra request. Needed because the route only carries the numeric
// table id and the header must show the label printed on the table (#f7e47cc
// fixed this on the menu screen but not here, so a diner at "A1" watched the
// header flip to "桌號 2" the moment they opened the cart).
const { data: tableValidation } = useQuery({
  queryKey: ["table-validation", props.restaurantId, props.tableId],
  queryFn: () => menuApi.validateTable(props.restaurantId, props.tableId),
  enabled: computed(() => Number.isFinite(Number(props.tableId))),
  staleTime: 5 * 60 * 1000,
});

// 最低消費設定直接讀取 restaurant.settings，不再呼叫不存在的
// /orders/restaurant/:id/minimum-order 端點 (該路由從未實作，且
// /orders/* 全域套用 authMiddleware，訪客呼叫一律 401 污染 log)。
watch(
  restaurant,
  (r) => {
    const settings = (r?.settings ?? {}) as Record<string, unknown>;
    const amount = Number(settings.minOrderAmount);
    minimumOrderAmount.value = Number.isFinite(amount) ? amount : 0;
    minimumOrderEnabled.value = minimumOrderAmount.value > 0;
  },
  { immediate: true },
);

const getOrderSubmitErrorMessage = (error: unknown) => {
  return t(getOrderSubmitErrorI18nKey(error));
};

/**
 * Idempotency key for the cart currently being submitted. Generated once and
 * reused for every retry of the *same* cart, which is the whole point: a
 * customer whose connection dropped mid-submit is told "please try again", and
 * the second tap has to be recognisable as the same order rather than a new
 * one. Cleared on success so the next cart gets a fresh key.
 *
 * Deliberately shared by both submit branches. Signing in is one of the things
 * a customer may well do between two attempts at the same cart, and the key
 * has to survive that: `/orders` and `/guest-orders` write the same column
 * under the same unique index, so the same key still deduplicates across the
 * switch. A per-branch ref would mint a second key and book a second order.
 */
const pendingOrderMutationId = ref<string | null>(null);

// 提交訂單 Mutation (authenticated)
const { mutate: createOrder } = useMutation({
  mutationFn: (orderData: CreateOrderRequest) =>
    orderApi.createOrder(orderData),
  onSuccess: (order) => {
    toast.success(t("toast.orderSubmitSuccess"));
    pendingOrderMutationId.value = null;
    cartStore.clearCart();
    router.push(
      `/restaurant/${props.restaurantId}/table/${props.tableId}/order/${order.id}`,
    );
  },
  onError: (error: unknown) => {
    toast.error(getOrderSubmitErrorMessage(error));
    isSubmitting.value = false;
  },
});

// 訪客訂單 Mutation (dine-in without login)
const { mutate: createGuestOrder } = useMutation({
  mutationFn: (orderData: CreateGuestOrderRequest) =>
    orderApi.createGuestOrder(orderData),
  onSuccess: (response) => {
    toast.success(t("toast.orderSubmitSuccess"));
    pendingOrderMutationId.value = null;
    cartStore.clearCart();
    router.push(
      `/restaurant/${props.restaurantId}/table/${props.tableId}/order/${response.order.id}`,
    );
  },
  onError: (error: unknown) => {
    toast.error(getOrderSubmitErrorMessage(error));
    isSubmitting.value = false;
  },
});

// 計算費用 — 稅率與服務費率必須從餐廳設定讀取，與後端 OrderService.createOrder
// 使用同一份來源 (restaurant.settings)。前端寫死任何 rate 會導致 cart 顯示
// 與 DB 實際入帳不一致 (bug: customer 看到 76，後端存 71.5)。
const serviceChargeRate = computed(() => {
  const settings = (restaurant.value?.settings ?? {}) as Record<
    string,
    unknown
  >;
  const rate = Number(settings.serviceChargeRate);
  return Number.isFinite(rate) ? rate : 0;
});

const taxRate = computed(() => {
  const settings = (restaurant.value?.settings ?? {}) as Record<
    string,
    unknown
  >;
  const rate = Number(settings.taxRate);
  return Number.isFinite(rate) ? rate : 0;
});

// 對齊後端 calculateOrderTotal: subtotal * rate，不 round，折扣在最後扣除
const serviceCharge = computed(() => {
  return cartStore.subtotal * serviceChargeRate.value;
});

const tax = computed(() => {
  return cartStore.subtotal * taxRate.value;
});

const discount = computed(() => {
  return couponDiscountAmount.value;
});

const totalAmount = computed(() => {
  return cartStore.subtotal + serviceCharge.value + tax.value - discount.value;
});

// 最低消費驗證
const orderAmountAfterDiscount = computed(() => {
  return cartStore.subtotal - discount.value;
});

const isMinimumOrderMet = computed(() => {
  if (!minimumOrderEnabled.value || minimumOrderAmount.value <= 0) {
    return true;
  }
  return orderAmountAfterDiscount.value >= minimumOrderAmount.value;
});

const minimumOrderShortfall = computed(() => {
  if (isMinimumOrderMet.value) return 0;
  return minimumOrderAmount.value - orderAmountAfterDiscount.value;
});

const canPlaceOrder = computed(() => {
  return !cartStore.isEmpty && isMinimumOrderMet.value && !isSubmitting.value;
});

// 初始化購物車
onMounted(() => {
  cartStore.initializeCart(props.restaurantId, props.tableId, seatId.value);

  // 如果購物車為空，重定向到菜單頁面
  if (cartStore.isEmpty) {
    router.replace(menuRoute.value);
  }
});

// Methods
const handleUpdateQuantity = (itemId: string, quantity: number) => {
  cartStore.updateQuantity(itemId, quantity);
};

const handleUpdateNotes = (itemId: string, notes: string) => {
  cartStore.updateItemNotes(itemId, notes);
};

const handleRemoveItem = (itemId: string) => {
  const item = cartStore.getItemById(itemId);
  if (item) {
    cartStore.removeItem(itemId);
    toast.success(
      tWithParams("toast.itemRemoved", {
        name: getLocalizedMenuName(item.menuItem, currentLanguage?.value),
      }),
    );
  }
};

const handleSubmitOrder = () => {
  // 驗證必要資訊
  if (cartStore.isEmpty) {
    toast.warning(t("toast.cartCannotBeEmpty"));
    return;
  }

  // 顯示確認對話框
  showConfirmation.value = true;
};

// 優惠券相關方法
const onCouponInput = () => {
  // 清除之前的驗證狀態
  couponValidationMessage.value = "";
  couponValidationError.value = false;
};

// Client-side coupon code validation
const validateCouponCode = (
  code: string,
): { isValid: boolean; error?: string } => {
  if (!code || typeof code !== "string") {
    return { isValid: false, error: t("toast.couponCodeRequired") };
  }

  const trimmedCode = code.trim();

  if (trimmedCode.length === 0) {
    return { isValid: false, error: t("toast.couponCodeRequired") };
  }

  if (trimmedCode.length > 50) {
    return { isValid: false, error: t("toast.couponCodeTooLong") };
  }

  // Allow alphanumeric characters, hyphens, and underscores only
  if (!/^[A-Za-z0-9\-_]+$/.test(trimmedCode)) {
    return {
      isValid: false,
      error: t("toast.couponCodeInvalidChars"),
    };
  }

  return { isValid: true };
};

const validateCoupon = async () => {
  if (!couponCode.value.trim()) return;

  // Client-side input validation
  const validation = validateCouponCode(couponCode.value);
  if (!validation.isValid) {
    couponValidationMessage.value = validation.error || "";
    couponValidationError.value = true;
    return;
  }

  isValidatingCoupon.value = true;
  couponValidationMessage.value = "";
  couponValidationError.value = false;

  try {
    // Sanitize input: trim whitespace and convert to uppercase
    const sanitizedCode = couponCode.value.trim().toUpperCase();

    const result = await apiClient.post<CouponValidationResult>(
      "/coupons/validate",
      {
        code: sanitizedCode,
        restaurantId: props.restaurantId.toString(),
        orderAmount: cartStore.subtotal,
        menuItems: cartStore.items.map((item) => ({
          menuItemId: item.menuItem.id,
          quantity: item.quantity,
        })),
      },
    );

    if (result.valid) {
      // 驗證成功
      appliedCoupon.value = result.coupon ?? null;
      couponDiscountAmount.value = result.discountAmount || 0;
      couponValidationMessage.value = tWithParams("toast.couponApplied", {
        amount: formatPrice(couponDiscountAmount.value),
      });
      couponValidationError.value = false;
    } else {
      // 驗證失敗
      appliedCoupon.value = null;
      couponDiscountAmount.value = 0;
      couponValidationMessage.value = result.error || t("toast.couponFailed");
      couponValidationError.value = true;
    }
  } catch (error) {
    console.error("Coupon validation error:", error);
    appliedCoupon.value = null;
    couponDiscountAmount.value = 0;
    couponValidationMessage.value = t("toast.couponValidationError");
    couponValidationError.value = true;
  } finally {
    isValidatingCoupon.value = false;
  }
};

const clearCoupon = () => {
  couponCode.value = "";
  appliedCoupon.value = null;
  couponDiscountAmount.value = 0;
  couponValidationMessage.value = "";
  couponValidationError.value = false;
  selectedCoupon.value = null;
};

// 可用優惠券相關方法
const toggleAvailableCoupons = async () => {
  showAvailableCoupons.value = !showAvailableCoupons.value;
  if (showAvailableCoupons.value && availableCoupons.value.length === 0) {
    await loadAvailableCoupons();
  }
};

const loadAvailableCoupons = async () => {
  if (isLoadingCoupons.value) return;

  isLoadingCoupons.value = true;
  try {
    availableCoupons.value = await apiClient.get<CustomerCoupon[]>(
      `/coupons/available/${props.restaurantId}`,
    );
  } catch (error) {
    console.error("Error loading available coupons:", error);
    availableCoupons.value = [];
  } finally {
    isLoadingCoupons.value = false;
  }
};

const selectCoupon = (coupon: CustomerCoupon) => {
  if (appliedCoupon.value) return; // 如果已有應用的優惠券，不允許選擇
  selectedCoupon.value = selectedCoupon.value?.id === coupon.id ? null : coupon;
};

const applyCouponFromList = async () => {
  if (!selectedCoupon.value) return;

  // 使用選中的優惠券代碼進行驗證
  couponCode.value = selectedCoupon.value.code;
  await validateCoupon();
};

// 優惠券格式化方法
const formatCouponDiscount = (coupon: CustomerCoupon) => {
  if (coupon.discountType === "percentage") {
    return `${coupon.discountValue}% ${t("common.off")}`;
  } else {
    return `$${formatPrice(coupon.discountValue)} ${t("common.off")}`;
  }
};

const formatCouponExpiry = (dateString: string | number | Date) => {
  if (dateString === "") return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString(currentLanguage.value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return String(dateString);
  }
};

const getCouponTypeClass = (discountType: CustomerCoupon["discountType"]) => {
  return discountType === "percentage"
    ? "bg-ios-blue-soft text-ios-blue-deep"
    : "bg-ios-green-soft text-ios-green-deep";
};

const getCouponTypeText = (discountType: CustomerCoupon["discountType"]) => {
  return discountType === "percentage"
    ? t("cart.percentage")
    : t("cart.fixedAmount");
};

const selectAndApplyCoupon = async (coupon: CustomerCoupon) => {
  selectedCoupon.value = coupon;
  await applyCouponFromList();
};

const submitOrder = async () => {
  try {
    isSubmitting.value = true;
    showConfirmation.value = false;

    // Minted once per cart, not per tap -- see pendingOrderMutationId.
    if (!pendingOrderMutationId.value) {
      pendingOrderMutationId.value = crypto.randomUUID();
    }

    const isAuthenticated = hasCustomerAccessToken();
    const isDineIn = !!props.tableId;

    if (!isAuthenticated && isDineIn) {
      // 訪客內用點餐 — 使用 guest-orders API（不需要登入）
      const guestOrderData: CreateGuestOrderRequest = {
        restaurantId: props.restaurantId,
        guestName: customerInfo.value.name.trim() || "Guest",
        orderType: seatId.value ? "seat" : "table",
        tableId: props.tableId,
        seatId: seatId.value ?? undefined,
        items: cartStore.items.map((item) => ({
          menuItemId: item.menuItem.id,
          quantity: item.quantity,
          customizations: item.customizations,
          notes: item.notes,
        })),
        notes: orderNotes.value.trim() || undefined,
        clientMutationId: pendingOrderMutationId.value ?? undefined,
      };

      createGuestOrder(guestOrderData);
    } else {
      // 已登入用戶 — 使用一般 orders API
      const orderData: CreateOrderRequest = {
        restaurantId: props.restaurantId,
        tableId: props.tableId,
        customerName: customerInfo.value.name.trim() || undefined,
        customerPhone: customerInfo.value.phone.trim() || undefined,
        items: cartStore.items.map((item) => ({
          menuItemId: item.menuItem.id,
          quantity: item.quantity,
          customizations: item.customizations,
          notes: item.notes,
        })),
        notes: orderNotes.value.trim() || undefined,
        couponCode: appliedCoupon.value
          ? couponCode.value.trim().toUpperCase()
          : undefined,
        clientMutationId: pendingOrderMutationId.value ?? undefined,
      };

      createOrder(orderData);
    }
  } catch (error) {
    console.error("submitOrder failed:", error);
    toast.error(t("toast.orderSubmitFailed"));
    isSubmitting.value = false;
  }
};

// 保存顧客資訊到 localStorage
const saveCustomerInfo = () => {
  try {
    localStorage.setItem(
      "makanmakan_customer_info",
      JSON.stringify(customerInfo.value),
    );
  } catch (error) {
    console.warn("保存顧客資訊失敗:", error);
  }
};

// 恢復顧客資訊
const restoreCustomerInfo = () => {
  try {
    const saved = localStorage.getItem("makanmakan_customer_info");
    if (saved) {
      const parsed = JSON.parse(saved);
      customerInfo.value = {
        name: parsed.name || "",
        phone: parsed.phone || "",
      };
    }
  } catch (error) {
    console.warn("恢復顧客資訊失敗:", error);
  }
};

// 監聽顧客資訊變化並保存
watch(customerInfo, saveCustomerInfo, { deep: true });

// 組件掛載時恢復顧客資訊
onMounted(() => {
  restoreCustomerInfo();
});
</script>
