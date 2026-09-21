<template>
  <div class="space-y-4">
    <!-- Existing lines -->
    <div
      class="bg-white rounded-2xl shadow-ios-sm divide-y divide-ios-separator"
    >
      <div
        v-for="item in order.items"
        :key="item.id"
        class="p-3 flex items-center gap-3"
        :data-testid="`edit-line-${item.id}`"
      >
        <div class="flex-1 min-w-0">
          <p class="font-medium text-ios-text truncate">
            {{ lineName(item) }}
          </p>
          <p class="text-sm text-ios-secondary">
            {{ formatPrice(item.unitPrice) }} ×
            {{ item.quantity }}
          </p>
        </div>

        <div class="flex items-center gap-1">
          <button
            type="button"
            class="w-8 h-8 rounded-full bg-ios-bg text-ios-text disabled:opacity-40 transition-colors hover:bg-ios-separator"
            :disabled="busy || item.quantity <= 1"
            :aria-label="t('orders.edit.decrease')"
            :data-testid="`decrease-${item.id}`"
            @click="setQuantity(item, item.quantity - 1)"
          >
            −
          </button>
          <span
            class="w-8 text-center font-semibold tabular-nums"
            :data-testid="`quantity-${item.id}`"
          >
            {{ item.quantity }}
          </span>
          <button
            type="button"
            class="w-8 h-8 rounded-full bg-ios-bg text-ios-text disabled:opacity-40 transition-colors hover:bg-ios-separator"
            :disabled="busy || item.quantity >= 99"
            :aria-label="t('orders.edit.increase')"
            :data-testid="`increase-${item.id}`"
            @click="setQuantity(item, item.quantity + 1)"
          >
            +
          </button>
        </div>

        <p class="w-20 text-right font-medium tabular-nums">
          {{ formatPrice(item.unitPrice * item.quantity) }}
        </p>

        <button
          type="button"
          class="p-2 rounded-full text-ios-red hover:bg-ios-red-soft disabled:opacity-40 transition-colors"
          :disabled="busy || (order.items?.length ?? 0) <= 1"
          :title="
            (order.items?.length ?? 0) <= 1
              ? t('orders.edit.lastItemHint')
              : t('orders.edit.remove')
          "
          :aria-label="t('orders.edit.remove')"
          :data-testid="`remove-${item.id}`"
          @click="removeLine(item)"
        >
          <TrashIcon class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Add an item -->
    <div class="bg-white rounded-2xl shadow-ios-sm p-3 space-y-3">
      <div class="flex items-center justify-between">
        <p class="font-medium text-ios-text">{{ t("orders.edit.addItem") }}</p>
        <button
          v-if="!pickerOpen"
          type="button"
          class="btn-secondary text-xs"
          :disabled="busy"
          data-testid="open-picker"
          @click="openPicker"
        >
          {{ t("orders.edit.browseMenu") }}
        </button>
      </div>

      <template v-if="pickerOpen">
        <input
          v-model="search"
          type="search"
          class="form-input"
          :placeholder="t('orders.edit.searchPlaceholder')"
          data-testid="menu-search"
        />
        <p v-if="menuLoading" class="text-sm text-ios-secondary">
          {{ t("common.loading") }}
        </p>
        <p
          v-else-if="!filteredMenu.length"
          class="text-sm text-ios-secondary"
          data-testid="menu-empty"
        >
          {{ t("orders.edit.noMatches") }}
        </p>
        <ul
          v-else
          class="max-h-56 overflow-y-auto divide-y divide-ios-separator"
        >
          <li
            v-for="menuItem in filteredMenu"
            :key="menuItem.id"
            class="py-2 flex items-center gap-3"
          >
            <span class="flex-1 min-w-0 truncate text-ios-text">
              {{ menuItem.name }}
            </span>
            <span class="text-sm text-ios-secondary tabular-nums">
              {{ formatPrice(menuItem.price) }}
            </span>
            <button
              type="button"
              class="btn-primary text-xs"
              :disabled="busy"
              :data-testid="`add-${menuItem.id}`"
              @click="addLine(menuItem)"
            >
              {{ t("orders.edit.add") }}
            </button>
          </li>
        </ul>
      </template>
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-ios-red-deep bg-ios-red-soft rounded-xl px-3 py-2"
      role="alert"
      data-testid="edit-error"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Staff-side order editing (#273).
 *
 * Every mutation replaces the local order with the server's response rather
 * than patching the row optimistically, because the server is the only place
 * that knows the recomputed tax, service charge and `version`. Guessing them
 * here would show a total that disagrees with the receipt.
 *
 * The parent decides *whether* this is shown; the status rule lives there and
 * in the API. This component only assumes the order is editable.
 */
import { computed, ref } from "vue";
import { TrashIcon } from "@heroicons/vue/24/outline";
import { useOrderStore } from "@/stores/order";
import { api } from "@/services/api";
import { useCurrency } from "@/composables/useCurrency";
import { t } from "@/i18n";
import type { Order, OrderItem } from "@/types";

const props = defineProps<{ order: Order }>();
const emit = defineEmits<{ (e: "updated", order: Order): void }>();

const orderStore = useOrderStore();
// The restaurant's own currency, not this component's guess at one. OrdersView
// formats the same amounts through the same composable, so the editor and the
// total it sits above cannot disagree.
const { formatPrice } = useCurrency();

const busy = ref(false);
const errorMessage = ref("");
const pickerOpen = ref(false);
const search = ref("");

interface PickableMenuItem {
  id: number;
  name: string;
  price: number;
  isAvailable?: boolean;
  options?: {
    customizations?: Array<{ required?: boolean }>;
  };
}
const menuItems = ref<PickableMenuItem[]>([]);
const menuLoading = ref(false);
const loadedMenuRestaurantId = ref<string | null>(null);

function canAddWithoutCustomization(item: PickableMenuItem): boolean {
  return !item.options?.customizations?.some((group) => group.required);
}

const filteredMenu = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const available = menuItems.value.filter(
    (item) => item.isAvailable !== false && canAddWithoutCustomization(item),
  );
  if (!needle) return available.slice(0, 30);
  return available
    .filter((item) => item.name.toLowerCase().includes(needle))
    .slice(0, 30);
});

function lineName(item: OrderItem): string {
  return item.name ?? item.menuItem?.name ?? `#${item.menuItemId}`;
}

/**
 * Fetched on demand, not on mount. Most order-detail views are opened to read,
 * not to edit, and the menu payload is the whole catalogue.
 */
async function openPicker() {
  pickerOpen.value = true;
  const restaurantId = props.order.restaurantId;
  if (menuItems.value.length && loadedMenuRestaurantId.value === restaurantId) {
    return;
  }

  menuLoading.value = true;
  // An editor instance may receive a different selected order without being
  // remounted. Do not leave the previous restaurant's items visible while the
  // correct catalogue is being fetched.
  menuItems.value = [];
  try {
    const response = await api.get<{ menuItems: PickableMenuItem[] }>(
      `/menu/${restaurantId}`,
    );
    menuItems.value = response.data?.success
      ? (response.data.data?.menuItems ?? [])
      : [];
    loadedMenuRestaurantId.value = restaurantId;
  } catch (error) {
    console.error("Failed to load menu for order editing:", error);
    errorMessage.value = t("orders.edit.menuLoadFailed");
  } finally {
    menuLoading.value = false;
  }
}

async function run(action: () => Promise<Order | null>) {
  if (busy.value) return;
  busy.value = true;
  errorMessage.value = "";
  try {
    const updated = await action();
    if (updated) {
      emit("updated", updated);
    } else {
      // The store already turned the failure into a user-facing string; a
      // second generic message here would hide the specific one (a 409 telling
      // the user to reload, say).
      errorMessage.value = orderStore.error ?? t("orders.edit.failed");
    }
  } finally {
    busy.value = false;
  }
}

function setQuantity(item: OrderItem, quantity: number) {
  if (quantity < 1 || quantity > 99) return;
  return run(() =>
    orderStore.changeOrderItemQuantity(
      props.order.id,
      item.id,
      quantity,
      props.order.version,
    ),
  );
}

function removeLine(item: OrderItem) {
  return run(() =>
    orderStore.removeOrderItem(props.order.id, item.id, props.order.version),
  );
}

function addLine(menuItem: PickableMenuItem) {
  return run(() =>
    orderStore.addOrderItems(
      props.order.id,
      [{ menuItemId: menuItem.id, quantity: 1 }],
      props.order.version,
    ),
  );
}
</script>
