<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import menuApi from "@/services/menuApi";
import GroupCartPanel from "@/components/group/GroupCartPanel.vue";
import HostRecoveryPanel from "@/components/group/HostRecoveryPanel.vue";
import { useGroupOrder } from "@/composables/useGroupOrder";
import { useI18n } from "@/composables/useI18n";
import { getGroupOrderErrorI18nKey } from "@/utils/group-order-error";
import { getOrderSubmitErrorCodeI18nKey } from "@/utils/order-submit-error";
import type { SplitBillConfig } from "@/composables/useGroupOrder";
import type { GroupOrderFeeMode } from "@makanmasak/shared-types";

const props = defineProps<{
  groupOrderId: string;
}>();

const router = useRouter();
const { t } = useI18n();
const group = useGroupOrder({ restaurantId: "" });
const viewError = ref("");
const splitNotice = ref("");
const submitError = ref("");
const orderPlacedWarning = ref("");
const isSubmitting = ref(false);
const hasSessionExpired = computed(() => group.sessionExpired?.value === true);

const isLocked = computed(() => {
  const status = group.groupOrder.value?.status;
  return status !== undefined && status !== "active" && status !== "completed";
});

const canSubmitOrder = computed(
  () => group.isHost.value && group.groupOrder.value?.status === "active",
);

const currentUserId = computed(() => group.currentMemberId?.value ?? "");

const menuRoute = computed(() => {
  const groupOrder = group.groupOrder.value;
  if (!groupOrder?.restaurantId || !groupOrder.tableId) return null;

  return {
    name: "RestaurantMenu",
    params: {
      restaurantId: groupOrder.restaurantId,
      tableId: Number(groupOrder.tableId),
    },
  };
});

const autoSubmitError = ref("");
const isSavingAutoSubmit = ref(false);

async function toggleAutoSubmit(): Promise<void> {
  if (isSavingAutoSubmit.value) return;
  isSavingAutoSubmit.value = true;
  autoSubmitError.value = "";

  try {
    await group.setAutoSubmitOnExpiry(!group.autoSubmitOnExpiry.value);
  } catch (error) {
    autoSubmitError.value = t(
      getGroupOrderErrorI18nKey(error, "group.autoSubmitFailed"),
    );
  } finally {
    isSavingAutoSubmit.value = false;
  }
}

/**
 * Rates come from the restaurant, the same source the ordinary cart reads. A
 * preview built on anything else shows a number the kitchen will not charge —
 * the bug the cart already carries a comment about.
 */
async function loadChargeRates(restaurantId: string): Promise<void> {
  if (!restaurantId) return;
  try {
    const restaurant = await menuApi.getRestaurant(restaurantId);
    const settings = (restaurant?.settings ?? {}) as Record<string, unknown>;
    group.setChargeRates({
      serviceChargeRate: Number(settings.serviceChargeRate),
      taxRate: Number(settings.taxRate),
    });
  } catch {
    // Leaving the rates at zero shows food-only figures rather than blocking
    // the whole cart on a settings lookup.
  }
}

async function loadGroupOrder(): Promise<void> {
  try {
    await group.loadGroupOrder(props.groupOrderId);
    void loadChargeRates(group.groupOrder.value?.restaurantId ?? "");
    await group.connectToGroupOrder(props.groupOrderId);
  } catch (error) {
    viewError.value = t(getGroupOrderErrorI18nKey(error, "group.loadFailed"));
  }
}

async function updateQuantity(itemId: string, quantity: number): Promise<void> {
  try {
    await group.updateCartItem(itemId, { quantity });
  } catch (error) {
    viewError.value = t(
      getGroupOrderErrorI18nKey(error, "group.updateItemFailed"),
    );
  }
}

async function removeItem(itemId: string): Promise<void> {
  try {
    await group.removeFromCart(itemId);
  } catch (error) {
    viewError.value = t(
      getGroupOrderErrorI18nKey(error, "group.removeItemFailed"),
    );
  }
}

async function changeFeeMode(mode: GroupOrderFeeMode): Promise<void> {
  try {
    await group.setFeeMode(mode);
  } catch (error) {
    viewError.value = t(
      getGroupOrderErrorI18nKey(error, "group.feeModeFailed"),
    );
  }
}

async function settleMyShare(): Promise<void> {
  try {
    await group.settleMyShare();
  } catch (error) {
    viewError.value = t(getGroupOrderErrorI18nKey(error, "group.settleFailed"));
  }
}

async function changeSplitMode(mode: SplitBillConfig["mode"]): Promise<void> {
  try {
    await group.setSplitBillMode(mode);
  } catch {
    splitNotice.value = t("group.splitUnavailable");
  }
}

async function submitGroupOrder(): Promise<void> {
  if (isSubmitting.value) return;

  isSubmitting.value = true;
  submitError.value = "";
  orderPlacedWarning.value = "";

  try {
    await group.submitOrder();
  } catch (error) {
    if (isOrderAlreadyPlacedError(error)) {
      orderPlacedWarning.value = t("group.orderAlreadyPlaced");
    } else if (isHostOnlyError(error)) {
      submitError.value = t("group.hostOnlySubmit");
    } else {
      // Finalizing runs the group cart through the same `createOrder` a solo
      // diner uses, so a refusal arrives with the checkout screen's codes —
      // out of stock, below the minimum, restaurant closed. The host is the
      // one holding the cart, so say which rule they tripped rather than
      // "submitting failed" (#359).
      submitError.value = t(
        getOrderSubmitErrorCodeI18nKey(error) ??
          getGroupOrderErrorI18nKey(error, "group.submitFailed"),
      );
    }
  } finally {
    isSubmitting.value = false;
  }
}

function isHostOnlyError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { isHostOnly?: unknown }).isHostOnly === true
  );
}

function isOrderAlreadyPlacedError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { orderAlreadyPlaced?: unknown }).orderAlreadyPlaced === true
  );
}

onMounted(() => {
  void loadGroupOrder();
});

onUnmounted(() => {
  group.disconnectRealtime();
});
</script>

<template>
  <main class="min-h-screen bg-ios-bg px-4 py-6">
    <section class="mx-auto w-full max-w-2xl">
      <div class="mb-5">
        <p class="text-sm font-medium text-ios-secondary">
          {{ t("group.groupOrderLabel") }}
        </p>
        <h1 class="text-2xl font-semibold text-ios-text">
          {{ group.groupOrder.value?.hostName || t("group.sharedCart") }}
        </h1>
      </div>

      <p
        v-if="viewError"
        class="mb-4 rounded-xl bg-ios-red/10 p-4 text-sm text-ios-red"
      >
        {{ viewError }}
      </p>

      <p
        v-if="hasSessionExpired"
        data-testid="group-order-session-expired"
        class="mb-4 rounded-xl bg-ios-orange/10 p-4 text-sm text-ios-orange"
      >
        {{ t("group.sessionExpiredNotice") }}
      </p>

      <div
        v-if="isLocked"
        data-testid="group-order-locked"
        class="rounded-2xl bg-ios-card p-6 shadow-card-sm"
      >
        <h2 class="text-lg font-semibold text-ios-text">
          {{ t("group.lockedTitle") }}
        </h2>
        <p class="mt-2 text-sm text-ios-secondary">
          {{ t("group.lockedDesc") }}
        </p>
      </div>

      <template v-else-if="group.groupOrder.value">
        <GroupCartPanel
          :cart-items="group.groupOrder.value.cartItems"
          :members="group.groupOrder.value.members"
          :current-user-id="currentUserId"
          :split-bill-config="group.groupOrder.value.splitBillConfig"
          :total-amount="group.totalAmount.value"
          :my-subtotal="group.mySubtotal.value"
          :my-service-charge="group.myServiceCharge.value"
          :my-tax="group.myTax.value"
          :my-share="group.myShare.value"
          :fee-mode="group.groupOrder.value.feeMode"
          :is-host="group.isHost.value"
          :order-status="group.groupOrder.value.status"
          :split-bills="group.splitBills.value"
          :my-split-bill="group.mySplitBill.value"
          @update-quantity="updateQuantity"
          @remove-item="removeItem"
          @change-split-mode="changeSplitMode"
          @change-fee-mode="changeFeeMode"
          @settle-my-share="settleMyShare"
        />

        <button
          v-if="!isLocked && menuRoute"
          data-testid="group-order-menu-link"
          type="button"
          class="mt-4 w-full rounded-full border border-ios-blue/25 bg-ios-blue/10 px-4 py-3.5 text-base font-semibold text-ios-blue transition-all duration-200 active:scale-[0.98]"
          @click="router.push(menuRoute)"
        >
          {{ t("group.orderMore") }}
        </button>
      </template>

      <div v-else class="py-16 text-center text-ios-secondary">
        {{ t("group.loading") }}
      </div>

      <div v-if="canSubmitOrder" class="mt-4">
        <button
          data-testid="group-order-submit"
          type="button"
          class="w-full rounded-full bg-ios-blue px-4 py-3.5 text-base font-semibold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          :disabled="isSubmitting"
          @click="submitGroupOrder"
        >
          {{ isSubmitting ? t("group.submitting") : t("group.submitOrder") }}
        </button>
      </div>

      <p
        v-if="orderPlacedWarning"
        data-testid="group-order-placed-warning"
        class="mt-4 rounded-xl bg-ios-orange/10 p-4 text-sm text-ios-orange"
      >
        {{ orderPlacedWarning }}
      </p>

      <p
        v-else-if="submitError"
        data-testid="group-order-submit-error"
        class="mt-4 rounded-xl bg-ios-red/10 p-4 text-sm text-ios-red"
      >
        {{ submitError }}
      </p>

      <p
        v-if="splitNotice"
        class="mt-4 rounded-xl bg-ios-orange/10 p-4 text-sm text-ios-orange"
      >
        {{ splitNotice }}
      </p>

      <!--
        Host only. What this switch decides — whether a table that never
        pressed submit still gets an order — is the same decision as submitting,
        so it sits with whoever owns the group.
      -->
      <div
        v-if="group.isHost.value && !isLocked"
        class="mt-6 rounded-2xl bg-ios-card p-5 shadow-card-sm"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-base font-semibold text-ios-text">
              {{ t("group.autoSubmitTitle") }}
            </p>
            <p class="mt-1 text-sm text-ios-secondary">
              {{ t("group.autoSubmitDesc") }}
            </p>
          </div>

          <button
            data-testid="auto-submit-toggle"
            type="button"
            role="switch"
            :aria-checked="group.autoSubmitOnExpiry.value ? 'true' : 'false'"
            :aria-label="t('group.autoSubmitTitle')"
            :disabled="isSavingAutoSubmit"
            class="relative mt-1 h-8 w-[52px] flex-shrink-0 rounded-full transition-all duration-300 ease-out disabled:opacity-60"
            :class="
              group.autoSubmitOnExpiry.value ? 'bg-ios-green' : 'bg-ios-gray-4'
            "
            @click="toggleAutoSubmit"
          >
            <span
              class="absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-all duration-300 ease-out"
              :class="group.autoSubmitOnExpiry.value ? 'left-6' : 'left-1'"
            />
          </button>
        </div>

        <p
          data-testid="auto-submit-state"
          class="mt-3 text-sm font-medium"
          :class="
            group.autoSubmitOnExpiry.value
              ? 'text-ios-green'
              : 'text-ios-secondary'
          "
        >
          {{
            group.autoSubmitOnExpiry.value
              ? t("group.autoSubmitOn")
              : t("group.autoSubmitOff")
          }}
        </p>

        <p
          v-if="autoSubmitError"
          data-testid="auto-submit-error"
          class="mt-3 rounded-xl bg-ios-red/10 p-3 text-sm text-ios-red"
        >
          {{ autoSubmitError }}
        </p>
      </div>

      <HostRecoveryPanel
        :group-order-id="props.groupOrderId"
        :recover="group.recoverHost"
      />
    </section>
  </main>
</template>
