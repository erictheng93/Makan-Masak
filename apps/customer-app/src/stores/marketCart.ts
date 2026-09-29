import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { z } from "zod";
import type {
  CartItem,
  MenuItem,
  SelectedCustomizations,
} from "@makanmasak/shared-types";

const STORAGE_KEY = "makanmakan_market_carts_v1";
const CART_TTL_MS = 2 * 60 * 60 * 1000;

const MenuItemSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    price: z.number().min(0),
  })
  .loose();

const CartItemSchema = z
  .object({
    id: z.string().min(1).max(500),
    menuItem: MenuItemSchema,
    quantity: z.number().int().min(1).max(100),
    customizations: z.unknown().optional(),
    notes: z.string().max(500).optional(),
    price: z.number().min(0),
    totalPrice: z.number().min(0),
  })
  .loose();

const MarketCartVendorSchema = z.object({
  restaurantId: z.string().min(1),
  name: z.string().min(1).max(200),
  items: z.array(CartItemSchema).max(100),
});

const MarketCartSchema = z.object({
  marketSlug: z.string().min(1).max(120),
  marketName: z.string().min(1).max(200),
  vendors: z.array(MarketCartVendorSchema).max(100),
  updatedAt: z.number().int().positive(),
});

const MarketCartsSchema = z.record(z.string(), MarketCartSchema);

export interface MarketCartVendor {
  restaurantId: string;
  name: string;
  items: CartItem[];
}

export interface MarketCart {
  marketSlug: string;
  marketName: string;
  vendors: MarketCartVendor[];
  updatedAt: number;
}

interface AddMarketCartItemInput {
  marketSlug: string;
  marketName: string;
  restaurantId: string;
  restaurantName: string;
  item: MenuItem;
  quantity: number;
  customizations?: SelectedCustomizations;
  notes?: string;
}

export const useMarketCartStore = defineStore("marketCart", () => {
  const carts = ref<Record<string, MarketCart>>({});
  const activeMarketSlug = ref<string | null>(null);

  restoreCarts();

  const currentCart = computed(() =>
    activeMarketSlug.value ? carts.value[activeMarketSlug.value] : null,
  );
  const currentItemCount = computed(() =>
    currentCart.value ? itemCountForCart(currentCart.value) : 0,
  );
  const currentSubtotal = computed(() =>
    currentCart.value ? subtotalForCart(currentCart.value) : 0,
  );

  function initializeMarket(marketSlug: string, marketName: string) {
    activeMarketSlug.value = marketSlug;
    ensureCart(marketSlug, marketName);
    saveCarts();
  }

  function addItem(input: AddMarketCartItemInput) {
    const cart = ensureCart(input.marketSlug, input.marketName);
    const vendor = ensureVendor(cart, input.restaurantId, input.restaurantName);
    const unitPrice = calculatePrice(input.item, input.customizations);
    const id = generateCartItemId(
      input.item.id,
      input.customizations,
      input.notes,
    );
    const existingItem = vendor.items.find((item) => item.id === id);

    if (existingItem) {
      existingItem.quantity += input.quantity;
      existingItem.totalPrice = existingItem.quantity * existingItem.price;
    } else {
      vendor.items.push({
        id,
        menuItem: input.item,
        quantity: input.quantity,
        customizations: input.customizations,
        notes: input.notes,
        price: unitPrice,
        totalPrice: unitPrice * input.quantity,
      });
    }

    cart.marketName = input.marketName;
    vendor.name = input.restaurantName;
    cart.updatedAt = Date.now();
    saveCarts();
  }

  function updateQuantity(
    marketSlug: string,
    restaurantId: string,
    itemId: string,
    quantity: number,
  ) {
    const cart = carts.value[marketSlug];
    const vendor = cart?.vendors.find(
      (entry) => entry.restaurantId === restaurantId,
    );
    const item = vendor?.items.find((entry) => entry.id === itemId);
    if (!cart || !vendor || !item) return;

    if (quantity <= 0) {
      removeItem(marketSlug, restaurantId, itemId);
      return;
    }

    item.quantity = quantity;
    item.totalPrice = item.price * quantity;
    cart.updatedAt = Date.now();
    saveCarts();
  }

  function removeItem(
    marketSlug: string,
    restaurantId: string,
    itemId: string,
  ) {
    const cart = carts.value[marketSlug];
    const vendor = cart?.vendors.find(
      (entry) => entry.restaurantId === restaurantId,
    );
    if (!cart || !vendor) return;

    vendor.items = vendor.items.filter((item) => item.id !== itemId);
    cart.vendors = cart.vendors.filter((entry) => entry.items.length > 0);
    cart.updatedAt = Date.now();
    saveCarts();
  }

  function removeVendor(marketSlug: string, restaurantId: string) {
    const cart = carts.value[marketSlug];
    if (!cart) return;
    cart.vendors = cart.vendors.filter(
      (entry) => entry.restaurantId !== restaurantId,
    );
    cart.updatedAt = Date.now();
    saveCarts();
  }

  function clearMarket(marketSlug: string) {
    delete carts.value[marketSlug];
    if (activeMarketSlug.value === marketSlug) {
      activeMarketSlug.value = null;
    }
    saveCarts();
  }

  function cartForMarket(marketSlug: string) {
    return carts.value[marketSlug] ?? null;
  }

  function itemCountForCart(cart: MarketCart) {
    return cart.vendors.reduce(
      (total, vendor) =>
        total +
        vendor.items.reduce(
          (vendorTotal, item) => vendorTotal + item.quantity,
          0,
        ),
      0,
    );
  }

  function subtotalForCart(cart: MarketCart) {
    return cart.vendors.reduce(
      (total, vendor) =>
        total +
        vendor.items.reduce(
          (vendorTotal, item) => vendorTotal + item.totalPrice,
          0,
        ),
      0,
    );
  }

  function ensureCart(marketSlug: string, marketName: string) {
    if (!carts.value[marketSlug]) {
      carts.value[marketSlug] = {
        marketSlug,
        marketName,
        vendors: [],
        updatedAt: Date.now(),
      };
    }
    return carts.value[marketSlug];
  }

  function ensureVendor(
    cart: MarketCart,
    restaurantId: string,
    restaurantName: string,
  ) {
    let vendor = cart.vendors.find(
      (entry) => entry.restaurantId === restaurantId,
    );
    if (!vendor) {
      vendor = {
        restaurantId,
        name: restaurantName,
        items: [],
      };
      cart.vendors.push(vendor);
    }
    return vendor;
  }

  function restoreCarts() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const parsed = JSON.parse(saved);
      const validationResult = MarketCartsSchema.safeParse(parsed);
      if (!validationResult.success) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      const now = Date.now();
      const restored: Record<string, MarketCart> = {};
      for (const [slug, cart] of Object.entries(validationResult.data)) {
        if (now - cart.updatedAt <= CART_TTL_MS) {
          restored[slug] = cart as unknown as MarketCart;
        }
      }
      carts.value = restored;
      saveCarts();
    } catch (error) {
      console.warn("恢復市場購物籃失敗:", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function saveCarts() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(carts.value));
    } catch (error) {
      console.warn("保存市場購物籃失敗:", error);
    }
  }

  function calculatePrice(
    menuItem: MenuItem,
    customizations?: SelectedCustomizations,
  ) {
    let price = menuItem.price;
    if (!customizations) return price;

    if (customizations.size) {
      price += customizations.size.priceAdjustment || 0;
    }
    for (const option of customizations.options ?? []) {
      price += option.priceAdjustment || 0;
    }
    for (const addOn of customizations.addOns ?? []) {
      price += addOn.unitPrice;
    }
    return Math.max(0, price);
  }

  function generateCartItemId(
    menuItemId: number,
    customizations?: SelectedCustomizations,
    notes?: string,
  ) {
    const parts = [String(menuItemId)];

    if (customizations?.size) {
      parts.push(`size:${customizations.size.id}`);
    }
    if (customizations?.options?.length) {
      parts.push(
        `options:${customizations.options
          .map((option) => option.choiceId)
          .sort()
          .join(",")}`,
      );
    }
    if (customizations?.addOns?.length) {
      parts.push(
        `addons:${customizations.addOns
          .map((addOn) => addOn.id)
          .sort()
          .join(",")}`,
      );
    }
    if (notes?.trim()) {
      parts.push(`notes:${notes.trim()}`);
    }

    return parts.join("|");
  }

  return {
    carts,
    activeMarketSlug,
    currentCart,
    currentItemCount,
    currentSubtotal,
    initializeMarket,
    addItem,
    updateQuantity,
    removeItem,
    removeVendor,
    clearMarket,
    cartForMarket,
    itemCountForCart,
    subtotalForCart,
  };
});
