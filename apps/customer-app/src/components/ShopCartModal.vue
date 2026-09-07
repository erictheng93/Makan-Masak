<template>
  <!-- Modal Overlay -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        data-testid="shop-cart-modal"
        class="fixed inset-0 bg-black/30 z-50 flex items-end justify-center"
        @click.self="emit('close')"
      >
        <!-- Modal Content -->
        <Transition
          enter-active-class="transition-transform duration-300"
          leave-active-class="transition-transform duration-200"
          enter-from-class="translate-y-full"
          leave-to-class="translate-y-full"
        >
          <div
            v-if="show"
            class="bg-white rounded-t-ios-lg shadow-card-lg w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col"
          >
            <!-- Header -->
            <div class="px-6 py-4">
              <div class="flex items-center justify-between">
                <h2 class="text-xl font-bold text-ios-text">
                  {{ t("shopCart.title") }}
                </h2>
                <button
                  class="w-8 h-8 flex items-center justify-center text-ios-secondary hover:text-ios-text transition-colors"
                  @click="emit('close')"
                >
                  <svg
                    class="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Cart Items -->
            <div class="flex-1 overflow-y-auto px-6 py-4">
              <!-- Empty cart state -->
              <div v-if="shopCartStore.isEmpty" class="text-center py-12">
                <div
                  class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"
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
                <p class="text-ios-secondary">{{ t("shopCart.empty") }}</p>
              </div>

              <!-- Non-empty cart content -->
              <div v-else>
                <!-- Fulfillment Type Toggle -->
                <div class="mb-4">
                  <p class="text-sm font-semibold text-ios-text mb-2">
                    {{ t("shopCart.pickupMethod") }}
                  </p>
                  <div class="flex gap-2">
                    <button
                      :class="[
                        'flex-1 py-2 px-3 rounded-full text-sm font-semibold transition-colors',
                        shopCartStore.fulfillmentType === 'takeaway'
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-100 text-ios-secondary',
                      ]"
                      @click="shopCartStore.setFulfillmentType('takeaway')"
                    >
                      {{ t("shopCart.takeaway") }}
                    </button>
                    <button
                      v-if="deliveryEnabled"
                      :class="[
                        'flex-1 py-2 px-3 rounded-full text-sm font-semibold transition-colors',
                        shopCartStore.fulfillmentType === 'delivery'
                          ? 'bg-amber-500 text-white'
                          : 'bg-gray-100 text-ios-secondary',
                      ]"
                      @click="shopCartStore.setFulfillmentType('delivery')"
                    >
                      {{ t("shopCart.delivery") }}
                    </button>
                  </div>
                </div>

                <!-- Delivery Form -->
                <div
                  v-if="shopCartStore.fulfillmentType === 'delivery'"
                  class="mb-4 space-y-3"
                >
                  <div>
                    <label class="block text-xs text-ios-secondary mb-1">{{
                      t("shopCart.deliveryAddress")
                    }}</label>
                    <input
                      v-model="deliveryAddress"
                      type="text"
                      :placeholder="t('shopCart.deliveryAddressPlaceholder')"
                      class="w-full px-3 py-2.5 bg-gray-100 rounded-xl border-0 text-sm focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all duration-200"
                    />
                  </div>
                  <div>
                    <label class="block text-xs text-ios-secondary mb-1">{{
                      t("shopCart.contactPhone")
                    }}</label>
                    <input
                      v-model="deliveryPhone"
                      type="tel"
                      :placeholder="t('shopCart.contactPhonePlaceholder')"
                      class="w-full px-3 py-2.5 bg-gray-100 rounded-xl border-0 text-sm focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all duration-200"
                    />
                  </div>
                  <div>
                    <label class="block text-xs text-ios-secondary mb-1">{{
                      t("shopCart.deliveryNotes")
                    }}</label>
                    <input
                      v-model="deliveryInstructions"
                      type="text"
                      :placeholder="t('shopCart.deliveryNotesPlaceholder')"
                      class="w-full px-3 py-2.5 bg-gray-100 rounded-xl border-0 text-sm focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all duration-200"
                    />
                  </div>
                </div>

                <!-- Takeaway Info -->
                <div
                  v-if="shopCartStore.fulfillmentType === 'takeaway'"
                  class="mb-4 p-3 bg-gray-50 rounded-lg"
                >
                  <p class="text-xs text-ios-secondary">
                    {{ t("shopCart.estimatedPickup") }}
                  </p>
                  <p class="font-semibold text-sm">
                    {{ t("shopCart.estimatedTime") }}
                  </p>
                </div>

                <!-- Cart Items List -->
                <div class="space-y-4">
                  <div
                    v-for="item in shopCartStore.items"
                    :key="item.id"
                    class="bg-gray-50 rounded-lg p-4"
                  >
                    <div class="flex items-start justify-between mb-2">
                      <div class="flex-1">
                        <h3 class="font-semibold text-ios-text">
                          {{
                            getLocalizedMenuName(item.menuItem, currentLanguage)
                          }}
                        </h3>
                        <p class="text-sm text-ios-secondary mt-1">
                          {{ formatPrice(item.price) }}
                        </p>

                        <!-- Customizations -->
                        <div
                          v-if="item.customizations"
                          class="mt-2 space-y-1 text-sm text-ios-secondary"
                        >
                          <p v-if="item.customizations.size">
                            {{ t("customization.size") }}:
                            {{ item.customizations.size.name }}
                          </p>
                          <p
                            v-if="
                              item.customizations.options &&
                              item.customizations.options.length > 0
                            "
                          >
                            {{ t("customization.options") }}:
                            {{
                              item.customizations.options
                                .map((o) => o.choiceName)
                                .join(", ")
                            }}
                          </p>
                          <p
                            v-if="
                              item.customizations.addOns &&
                              item.customizations.addOns.length > 0
                            "
                          >
                            {{ t("customization.addOns") }}:
                            {{
                              item.customizations.addOns
                                .map((a) => a.name)
                                .join(", ")
                            }}
                          </p>
                        </div>

                        <!-- Notes -->
                        <p
                          v-if="item.notes"
                          class="mt-2 text-sm text-ios-secondary italic"
                        >
                          {{ t("shopCart.notes") }} {{ item.notes }}
                        </p>
                      </div>

                      <button
                        data-testid="remove-item"
                        class="ml-4 text-red-500 hover:text-red-700 transition-colors"
                        @click="shopCartStore.removeItem(item.id)"
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
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>

                    <!-- Quantity Controls -->
                    <div class="flex items-center justify-between mt-3">
                      <div class="flex items-center space-x-3">
                        <button
                          class="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full text-ios-secondary hover:bg-gray-200 transition-colors"
                          @click="
                            shopCartStore.updateQuantity(
                              item.id,
                              item.quantity - 1,
                            )
                          "
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M20 12H4"
                            />
                          </svg>
                        </button>
                        <span
                          class="text-lg font-semibold text-ios-text w-8 text-center"
                          >{{ item.quantity }}</span
                        >
                        <button
                          class="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full text-ios-secondary hover:bg-gray-200 transition-colors"
                          @click="
                            shopCartStore.updateQuantity(
                              item.id,
                              item.quantity + 1,
                            )
                          "
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M12 4v16m8-8H4"
                            />
                          </svg>
                        </button>
                      </div>
                      <div class="text-lg font-bold text-ios-text">
                        {{ formatPrice(item.totalPrice) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <!-- end v-else (non-empty cart) -->
            </div>

            <!-- Footer -->
            <div
              v-if="!shopCartStore.isEmpty"
              class="bg-white/95 backdrop-blur-xl shadow-[0_-4px_16px_rgb(0,0,0,0.04)] px-6 py-4 space-y-4"
            >
              <!-- Subtotal / Totals -->
              <div
                v-if="shopCartStore.fulfillmentType === 'delivery'"
                class="flex justify-between text-sm text-ios-secondary"
              >
                <span>{{ t("shopCart.subtotal") }}</span>
                <span>{{ formatPrice(shopCartStore.subtotal) }}</span>
              </div>
              <div
                v-if="
                  shopCartStore.fulfillmentType === 'delivery' &&
                  shopCartStore.deliveryFee > 0
                "
                class="flex justify-between text-sm text-ios-secondary"
              >
                <span>{{ t("shopCart.deliveryFee") }}</span>
                <span>{{ formatPrice(shopCartStore.deliveryFee) }}</span>
              </div>
              <div class="flex justify-between font-bold text-lg">
                <span>{{ t("shopCart.total") }}</span>
                <span class="text-ios-text">{{
                  formatPrice(shopCartStore.totalWithDelivery)
                }}</span>
              </div>

              <!-- Checkout Button -->
              <button
                :disabled="isSubmitting || orderingDisabled"
                data-testid="submit-order-btn"
                class="w-full bg-ios-blue text-white py-4 px-6 rounded-full font-semibold shadow-lg hover:shadow-xl active:scale-[0.98] transition-transform duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                @click="handleCheckout"
              >
                <span
                  v-if="!isSubmitting"
                  class="flex items-center justify-center"
                >
                  <svg
                    class="w-5 h-5 mr-2"
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
                  {{ t("shopCart.confirmOrder") }}
                </span>
                <span v-else class="flex items-center justify-center">
                  <svg
                    class="animate-spin h-5 w-5 mr-2"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  {{ t("shopCart.processing") }}
                </span>
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "vue-toastification";
import { useShopCartStore } from "@/stores/shopCart";
import { apiClient } from "@/services/api";
import { hasCustomerAccessToken } from "@/services/customerAccessToken";
import { useI18n } from "@/composables/useI18n";
import { useCurrency } from "@/composables/useCurrency";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";
import { WAITING_LIST_LAST_TICKET_KEY } from "@/composables/useWaitingTicket";
import { getOrderSubmitErrorI18nKey } from "@/utils/order-submit-error";

interface SubmittedOrder {
  id: string | number;
}

interface GuestOrderResponse {
  guestToken?: string;
  order: SubmittedOrder;
}

const props = defineProps<{
  show: boolean;
  restaurantId: string;
  /** The scanned sticker's code, when this session started from one. */
  shopQrCode?: string;
  waitingTicketId?: string;
  /**
   * The shop cannot take this order — QR ordering switched off, or the code
   * that got the customer here has been retired. The cart stays readable so
   * an existing basket can be reviewed or cleared; only submitting is off,
   * which is the same answer the order endpoint would give.
   */
  orderingDisabled?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const router = useRouter();
const toast = useToast();
const { t, currentLanguage } = useI18n();
const { formatPrice } = useCurrency();
const shopCartStore = useShopCartStore();
const isSubmitting = ref(false);

/**
 * Idempotency key for the cart currently being submitted, minted once per cart
 * and reused by every retry of it. `orders` carries a unique index on
 * (restaurant_id, client_mutation_id), so a second attempt at the same cart
 * comes back as CLIENT_MUTATION_DUPLICATE / 409 instead of a second order.
 *
 * Shared by both branches below on purpose: signing in between two attempts
 * moves the same cart from /guest-orders to /orders, and both write that same
 * column. Cleared on success so the next cart gets a fresh key.
 */
const pendingOrderMutationId = ref<string | null>(null);

const deliveryAddress = ref("");
const deliveryPhone = ref("");
const deliveryInstructions = ref("");

const deliveryEnabled = computed(() => {
  if (props.waitingTicketId) {
    return false;
  }
  // If user got to delivery selection on landing page, delivery is enabled
  return (
    shopCartStore.fulfillmentType === "delivery" ||
    shopCartStore.deliveryFee >= 0
  );
});

const getWaitingListCustomerPhone = () => {
  if (!props.waitingTicketId) {
    return undefined;
  }

  try {
    const raw = localStorage.getItem(WAITING_LIST_LAST_TICKET_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as {
      ticketId?: string;
      restaurantId?: string;
      customerPhone?: string;
    };
    if (
      parsed.ticketId === props.waitingTicketId &&
      parsed.restaurantId === props.restaurantId
    ) {
      return parsed.customerPhone;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const handleCheckout = async () => {
  // The button is disabled in this state; this holds if it is ever submitted
  // another way, and says the same thing the server would.
  if (props.orderingDisabled) {
    toast.error(t("shopCart.orderingUnavailable"));
    return;
  }

  // Validate delivery fields before submitting
  if (shopCartStore.fulfillmentType === "delivery") {
    if (!deliveryAddress.value.trim()) {
      toast.error(t("toast.deliveryAddressRequired"));
      return;
    }
    if (
      !deliveryPhone.value.trim() ||
      deliveryPhone.value.replace(/\D/g, "").length < 8
    ) {
      toast.error(t("toast.invalidPhoneNumber"));
      return;
    }
    shopCartStore.setDeliveryInfo({
      address: deliveryAddress.value.trim(),
      phone: deliveryPhone.value.trim(),
      instructions: deliveryInstructions.value.trim(),
    });
  }

  try {
    isSubmitting.value = true;

    // Minted once per cart, not per tap — see pendingOrderMutationId.
    if (!pendingOrderMutationId.value) {
      pendingOrderMutationId.value = crypto.randomUUID();
    }

    // 準備訂單資料
    const waitingListCustomerPhone = getWaitingListCustomerPhone();
    if (props.waitingTicketId && !waitingListCustomerPhone) {
      toast.error(t("waitingList.errors.ticketLoadFailed"));
      return;
    }

    const orderData = {
      restaurantId: props.restaurantId,
      orderType: "shop",
      // Let the server retire this order if the owner has since regenerated
      // their QR code. Omitted entirely when this session did not start from a
      // scan, which the server reads as "nothing to check".
      ...(props.shopQrCode ? { shopQrCode: props.shopQrCode } : {}),
      waitingListId: props.waitingTicketId,
      customerPhone: waitingListCustomerPhone,
      items: shopCartStore.items.map((item) => ({
        menuItemId: item.menuItem.id,
        quantity: item.quantity,
        price: item.price,
        customizations: item.customizations,
        notes: item.notes,
      })),
      customerInfo: {
        orderType: "shop",
      },
      totalAmount: shopCartStore.totalWithDelivery,
      clientMutationId: pendingOrderMutationId.value,
      deliveryInfo: {
        type: props.waitingTicketId ? "dine_in" : shopCartStore.fulfillmentType,
        ...(!props.waitingTicketId &&
        shopCartStore.fulfillmentType === "delivery"
          ? {
              address: deliveryAddress.value,
              phone: deliveryPhone.value,
              instructions: deliveryInstructions.value,
              deliveryFee: shopCartStore.deliveryFee,
            }
          : {}),
      },
    };

    // Use guest endpoint if no customer auth token
    const hasCustomerToken = hasCustomerAccessToken();
    let orderResult: SubmittedOrder;

    if (hasCustomerToken) {
      orderResult = await apiClient.post<SubmittedOrder>("/orders", orderData);
    } else {
      // Guest ordering — use /guest-orders endpoint (no auth required)
      const guestOrderData = {
        restaurantId: props.restaurantId,
        guestName: "Guest",
        orderType: "shop" as const,
        ...(props.shopQrCode ? { shopQrCode: props.shopQrCode } : {}),
        waitingListId: props.waitingTicketId,
        customerPhone: waitingListCustomerPhone,
        items: shopCartStore.items.map((item) => ({
          menuItemId: item.menuItem.id,
          quantity: item.quantity,
          customizations: item.customizations,
          notes: item.notes,
        })),
        notes: orderData.deliveryInfo?.instructions,
        deliveryInfo: orderData.deliveryInfo,
        clientMutationId: pendingOrderMutationId.value,
      };
      const guestResult = await apiClient.post<GuestOrderResponse>(
        "/guest-orders",
        guestOrderData,
      );
      // Store guest token for order tracking
      if (guestResult.guestToken) {
        localStorage.setItem("guest_auth_token", guestResult.guestToken);
      }
      orderResult = guestResult.order;
    }
    // apiClient unwraps response.data.data, so orderResult IS the order object
    const orderId = orderResult.id;

    // This cart is committed; the next one must not be deduplicated against it.
    pendingOrderMutationId.value = null;

    // 清空購物車
    shopCartStore.clearCart();

    // 顯示成功訊息
    toast.success(t("toast.orderSent"));

    // 關閉彈窗
    emit("close");

    // 導航到訂單追蹤頁面
    router.push({
      name: "ShopOrderTracking",
      params: {
        restaurantId: props.restaurantId,
        orderId,
      },
      // No `phone` here: the ShopOrderTracking route never mapped it to a prop,
      // and the tracking screen reads the pickup number off the order itself
      // (`order.pickupNumber`). A number echoed back from the URL would be
      // whatever the customer last typed, not what the kitchen sees.
      query: {
        type: "shop",
      },
    });
  } catch (error: unknown) {
    // The server's own sentence stays here, where it helps whoever reads the
    // logs, and out of the toast, where it would be untranslated English.
    console.error("結帳失敗:", error);
    toast.error(t(getOrderSubmitErrorI18nKey(error)));
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<style scoped>
/* Scrollbar styling */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
}

::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #555;
}
</style>
