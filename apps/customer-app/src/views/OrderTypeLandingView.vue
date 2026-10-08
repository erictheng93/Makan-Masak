<template>
  <div class="min-h-screen bg-ios-bg">
    <div class="max-w-md mx-auto px-4 py-8">
      <div
        v-if="isLoading"
        class="flex justify-center items-center min-h-[60vh]"
      >
        <div
          class="animate-spin rounded-full h-8 w-8 border-b-2 border-ios-blue"
        ></div>
      </div>

      <div v-else-if="error" class="text-center py-12">
        <p class="text-red-500 mb-4">{{ error }}</p>
        <button class="text-ios-blue underline" @click="loadEntry">
          {{ t("common.retry") }}
        </button>
      </div>

      <!--
        Terminal state: the server says this entry cannot order. No retry —
        retrying a retired sticker gives the same answer, and offering the
        button reads as "we're having trouble" when the truth is "ask the
        shop for the current code".
      -->
      <div
        v-else-if="blockedReason"
        data-testid="shop-entry-blocked"
        :data-block-reason="blockedReason"
        class="bg-ios-card rounded-2xl shadow-card-sm px-5 py-8 text-center"
      >
        <div
          class="w-14 h-14 rounded-full bg-red-50 mx-auto mb-4 flex items-center justify-center"
        >
          <span class="text-2xl">🚫</span>
        </div>
        <h2 class="text-base font-semibold text-ios-text">
          {{ t(BLOCKED_COPY[blockedReason].title) }}
        </h2>
        <p class="mt-2 text-sm text-ios-secondary">
          {{ t(BLOCKED_COPY[blockedReason].description) }}
        </p>
      </div>

      <div v-else>
        <div class="text-center mb-8">
          <div
            v-if="restaurant?.logoUrl"
            class="w-16 h-16 rounded-2xl mx-auto mb-3 overflow-hidden"
          >
            <img
              :src="restaurant.logoUrl"
              :alt="restaurant.name"
              class="w-full h-full object-cover"
            />
          </div>
          <div
            v-else
            class="w-16 h-16 rounded-2xl mx-auto mb-3 bg-gray-200 flex items-center justify-center"
          >
            <span class="text-2xl">🍽️</span>
          </div>
          <h1 class="text-xl font-bold text-gray-900">
            {{ restaurant?.name }}
          </h1>
          <p v-if="restaurantDescription" class="text-sm text-gray-500 mt-1">
            {{ restaurantDescription }}
          </p>
        </div>

        <section
          v-if="restaurant?.isDemo"
          data-testid="order-type-demo-banner"
          class="mb-6 rounded-2xl bg-ios-orange-soft px-4 py-3"
        >
          <p class="text-sm font-semibold text-ios-orange-deep">
            {{ t("demoShop.bannerTitle") }}
          </p>
          <p class="mt-1 text-sm text-ios-orange-deep">
            {{ t("demoShop.bannerBody") }}
          </p>
        </section>

        <div
          v-if="!hasFulfillmentMethods"
          data-testid="order-type-empty-state"
          class="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center"
        >
          <h2 class="text-base font-semibold text-gray-900">
            {{ t("orderTypeLanding.noMethodsTitle") }}
          </h2>
          <p class="mt-2 text-sm text-gray-500">
            {{ t("orderTypeLanding.noMethodsDescription") }}
          </p>
        </div>

        <template v-else>
          <p class="text-sm font-semibold text-gray-500 mb-3">
            {{ t("orderTypeLanding.selectMethod") }}
          </p>
          <div class="flex flex-col gap-3">
            <!-- 內用 -->
            <button
              v-if="dineInEnabled"
              :class="[
                'flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left',
                selectedType === 'dine-in'
                  ? 'border-ios-blue bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300',
              ]"
              @click="selectedType = 'dine-in'"
            >
              <span class="text-3xl">🍽️</span>
              <div class="flex-1">
                <div class="font-semibold text-gray-900">
                  {{ t("orderTypeLanding.dineIn") }}
                </div>
                <div class="text-xs text-gray-500">
                  {{ t("orderTypeLanding.dineInDesc") }}
                </div>
              </div>
              <svg
                v-if="selectedType === 'dine-in'"
                class="w-5 h-5 text-ios-blue"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>

            <!-- 外帶 -->
            <button
              v-if="takeawayEnabled"
              :class="[
                'flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left',
                selectedType === 'takeaway'
                  ? 'border-ios-blue bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300',
              ]"
              @click="selectedType = 'takeaway'"
            >
              <span class="text-3xl">🛍️</span>
              <div class="flex-1">
                <div class="font-semibold text-gray-900">
                  {{ t("orderTypeLanding.takeaway") }}
                </div>
                <div class="text-xs text-gray-500">
                  {{ t("orderTypeLanding.takeawayDesc") }}
                </div>
              </div>
              <svg
                v-if="selectedType === 'takeaway'"
                class="w-5 h-5 text-ios-blue"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>

            <!-- 外送 -->
            <button
              v-if="deliveryEnabled"
              :class="[
                'flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left',
                selectedType === 'delivery'
                  ? 'border-ios-blue bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300',
              ]"
              @click="selectedType = 'delivery'"
            >
              <span class="text-3xl">🛵</span>
              <div class="flex-1">
                <div class="font-semibold text-gray-900">
                  {{ t("orderTypeLanding.delivery") }}
                </div>
                <div class="text-xs text-gray-500">
                  {{ t("orderTypeLanding.deliveryDesc") }}
                </div>
              </div>
              <svg
                v-if="selectedType === 'delivery'"
                class="w-5 h-5 text-ios-blue"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>

          <button
            data-testid="continue-btn"
            :disabled="!selectedType"
            class="w-full mt-6 py-3.5 bg-ios-blue text-white font-semibold rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleContinue"
          >
            {{ t("orderTypeLanding.continue") }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "@/composables/useI18n";
import { useShopCartStore } from "@/stores/shopCart";
import { menuApi } from "@/services/menuApi";
import { shopQrApi } from "@/services/shopQrApi";
import type { Restaurant } from "@makanmasak/shared-types";

type FulfillmentType = "dine-in" | "takeaway" | "delivery";

/**
 * Why the page can refuse to open, in the server's words.
 *
 * `qrRevoked` — the `?qr=` in the URL is not the restaurant's current shop
 * code, so the owner has regenerated the sticker since it was printed or
 * shared. `shopDisabled` — the owner has shop ordering switched off entirely.
 *
 * Both are exactly what `assertShopOrderingEnabled` throws at checkout
 * (`SHOP_QR_REVOKED` / `SHOP_MODE_DISABLED`). Asking here is not a second
 * security boundary — the shop code is public and possession proves nothing —
 * it just moves the refusal to the door, instead of after a full cart.
 */
type BlockedReason = "qrRevoked" | "shopDisabled";

/**
 * Spelled out rather than built as `orderTypeLanding.${reason}Title`, so the
 * keys stay greppable from the locale files, and so adding a reason without
 * adding its copy is a compile error rather than a blank panel.
 */
const BLOCKED_COPY: Record<
  BlockedReason,
  { title: string; description: string }
> = {
  qrRevoked: {
    title: "orderTypeLanding.qrRevokedTitle",
    description: "orderTypeLanding.qrRevokedDescription",
  },
  shopDisabled: {
    title: "orderTypeLanding.shopDisabledTitle",
    description: "orderTypeLanding.shopDisabledDescription",
  },
};
type RestaurantWithPlaceholderFlag = Restaurant & {
  isPlaceholderDescription?: boolean;
};

const ONBOARDING_PLACEHOLDER_DESCRIPTION_PREFIX =
  "Provisioned from onboarding application ";

const props = defineProps<{ restaurantId: string }>();

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const shopCartStore = useShopCartStore();

const selectedType = ref<FulfillmentType | null>(null);
const restaurant = ref<RestaurantWithPlaceholderFlag | null>(null);
const isLoading = ref(true);
const error = ref<string | null>(null);
const blockedReason = ref<BlockedReason | null>(null);

const scannedQrCode = computed(() => {
  const qr = route.query.qr;
  const value = Array.isArray(qr) ? qr[0] : qr;
  return typeof value === "string" && value.length > 0 ? value : null;
});

const dineInEnabled = computed(() => {
  return restaurant.value?.settings?.enableDineIn ?? false;
});

const takeawayEnabled = computed(() => {
  return restaurant.value?.settings?.enableTakeaway ?? false;
});

const deliveryEnabled = computed(() => {
  return restaurant.value?.settings?.enableDelivery ?? false;
});

const hasFulfillmentMethods = computed(
  () => dineInEnabled.value || takeawayEnabled.value || deliveryEnabled.value,
);

const restaurantDescription = computed(() => {
  if (restaurant.value?.isPlaceholderDescription) {
    return "";
  }

  const description = restaurant.value?.description?.trim() ?? "";
  if (description.startsWith(ONBOARDING_PLACEHOLDER_DESCRIPTION_PREFIX)) {
    return "";
  }
  return description;
});

// Auto-select the first available option
function autoSelectType() {
  if (dineInEnabled.value) {
    selectedType.value = "dine-in";
  } else if (takeawayEnabled.value) {
    selectedType.value = "takeaway";
  } else if (deliveryEnabled.value) {
    selectedType.value = "delivery";
  }
}

/**
 * Load the page from what the server says, not from the route.
 *
 * `restaurantId` arriving in the path is not permission to order: it is public,
 * and so is the `?qr=` beside it. The two questions that actually decide
 * whether this entry can order — is the shop channel open, and is this the
 * current sticker — are the server's to answer, so both are asked before any
 * fulfillment button is offered.
 *
 * The two requests are independent, so they run together; a scan should not pay
 * for the verification serially.
 */
async function loadEntry() {
  isLoading.value = true;
  error.value = null;
  blockedReason.value = null;
  try {
    const qrCode = scannedQrCode.value;
    const [res, verification] = await Promise.all([
      menuApi.getRestaurant(props.restaurantId),
      qrCode ? shopQrApi.verify(qrCode) : Promise.resolve(null),
    ]);

    restaurant.value = res;

    // Either the code is not the shop's current sticker, or it verified against
    // a different restaurant than the path claims — trusting one half without
    // the other is how a mismatched pair walks in. Checked ahead of the
    // shop-mode flag because "ask the shop for the current code" is the more
    // actionable thing to tell someone holding a retired sticker.
    if (
      verification &&
      (!verification.valid || verification.restaurantId !== props.restaurantId)
    ) {
      blockedReason.value = "qrRevoked";
      return;
    }

    // Carries the entries that arrive with no code at all — a bookmarked link,
    // the recent-restaurants picker — which is where the old `settings.enable*`
    // reads let a switched-off shop straight through. Redundant after a passing
    // verification, which already requires the flag, and cheap to keep so the
    // page never depends on which branch it came down.
    if (!res.enableShopMode) {
      blockedReason.value = "shopDisabled";
      return;
    }

    autoSelectType();
  } catch {
    error.value = t("toast.restaurantLoadFailed");
  } finally {
    isLoading.value = false;
  }
}

function handleContinue() {
  if (!selectedType.value) return;
  shopCartStore.setFulfillmentType(selectedType.value);
  if (
    selectedType.value === "delivery" &&
    restaurant.value?.settings?.deliveryFee
  ) {
    shopCartStore.setDeliveryFee(restaurant.value.settings.deliveryFee);
  }

  // 取餐識別用訂單編號，不再攔一個末三碼頁面。
  router.push({
    name: "ShopMenu",
    params: { restaurantId: props.restaurantId },
    query: {
      ...route.query,
      fulfillmentType: selectedType.value,
    },
  });
}

onMounted(loadEntry);
</script>
