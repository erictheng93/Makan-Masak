import {
  eq,
  ne,
  and,
  asc,
  desc,
  count,
  sql,
  gte,
  lte,
  inArray,
  notInArray,
  isNull,
  like,
  or,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { BaseService } from "./base";
import {
  orders,
  orderItems,
  menuItems,
  restaurants,
  tables,
  customers,
  waitingList,
  couponUsage,
  ORDER_STATUS,
} from "../schema";
import {
  CANCELLABLE_ORDER_STATUSES,
  ORDER_ITEM_STATUSES,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "@makanmasak/shared-types";
import type {
  MenuItemOptions as WireMenuItemOptions,
  Order,
  OrderItem,
  OrderItemStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderStatus,
  SelectedCustomizations,
} from "@makanmasak/shared-types";
import {
  ApiError,
  badRequest,
  conflict,
  formatCurrency,
  CURRENCY_CONFIGS,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@makanmasak/utils";
import { amountFromCents, fromCents, toRequiredCents } from "../utils/money";
import { IngredientConsumptionService } from "./ingredient-consumption";
import { loadAssembledMenuItemOptions } from "./menu-options";
import { TenantMemberDirectoryService } from "./TenantMemberDirectoryService";

// `restaurants.settings.currency` is a free-form string in the schema, so it
// can hold anything an older admin build wrote. Narrow it here rather than
// casting: an unknown code falls back to the platform default instead of
// reaching `formatCurrency` and coming back as a bare number.
function resolveCurrency(currency: string | undefined): CurrencyCode {
  return currency && currency in CURRENCY_CONFIGS
    ? (currency as CurrencyCode)
    : DEFAULT_CURRENCY;
}

// Derived from the shared status machine rather than restated. These two used
// to be separate hand-maintained lists and they disagreed; the gap was not
// academic, because PUT /orders/:id/status honoured the wider one while
// restoring no inventory at all, so cancelling a `preparing` order left its
// stock deducted with no way back (#282). A comment saying "keep these in
// step" is not a mechanism — this is.
const cancellableOrderStatuses = CANCELLABLE_ORDER_STATUSES;

export const orderMenuItemSummaryColumns = {
  id: true,
  name: true,
  nameEn: true,
  description: true,
  imageUrl: true,
} as const;

export interface CreateOrderData {
  restaurantId: string;
  tableId?: number;
  customerId?: string;
  customerInfo?: { name?: string; phone?: string; email?: string };
  waitingListId?: string;
  waitingListCustomerPhone?: string;
  orderType?: "shop" | "table" | "seat";
  items: Array<{
    menuItemId: number;
    quantity: number;
    customizations?: SelectedCustomizations;
    notes?: string;
  }>;
  notes?: string;
  couponCode?: string;
  couponUserId?: string;
  clientMutationId?: string;
  orderSource?:
    | "direct"
    | "market_checkout"
    | "uber_eats"
    | "foodpanda"
    | "grabfood";
  deliveryInfo?: {
    type: "dine_in" | "takeaway" | "delivery";
    address?: string;
    phone?: string;
    instructions?: string;
    deliveryFee?: number;
  };
}

export type AddOrderItemsData = CreateOrderData["items"];

export interface UpdateOrderStatusData {
  status: string;
  notes?: string;
  expectedVersion?: number;
}

export interface OrderFilters {
  restaurantId?: string;
  tableId?: number;
  customerId?: string;
  status?: string | string[];
  paymentStatus?: string | string[];
  orderType?: "shop" | "table" | "seat";
  fulfillmentType?: "dine_in" | "takeaway" | "delivery";
  orderSource?:
    | "direct"
    | "market_checkout"
    | "uber_eats"
    | "foodpanda"
    | "grabfood";
  search?: string;
  dateRange?: [Date, Date];
  minAmount?: number;
  maxAmount?: number;
  sortBy?: "createdAt" | "totalAmount" | "status" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

const ORDER_SORT_COLUMNS = {
  createdAt: orders.createdAt,
  totalAmount: orders.totalAmountCents,
  status: orders.status,
  updatedAt: orders.updatedAt,
} as const;

type MenuItemRecord = Omit<typeof menuItems.$inferSelect, "options"> & {
  options?: WireMenuItemOptions | null;
};
type CatalogMenuItemOptions = NonNullable<MenuItemRecord["options"]>;
type MenuItemCustomizationGroup = NonNullable<
  CatalogMenuItemOptions["customizations"]
>[number];
type MenuItemCustomizationChoice =
  MenuItemCustomizationGroup["choices"][number];
type SelectedCustomizationOption = NonNullable<
  SelectedCustomizations["options"]
>[number];
type SelectedAddOn = NonNullable<SelectedCustomizations["addOns"]>[number];

type PreparedOrderItem = {
  menuItemId: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitPriceCents: number;
  totalPriceCents: number;
  customizations: SelectedCustomizations | undefined;
  notes: string | undefined;
  itemSnapshot: {
    name: string;
    description?: string;
    imageUrl?: string;
    category: string;
    price: number;
    unitPrice: number;
    customizations: SelectedCustomizations | undefined;
  };
};

type PrepTimeOrderItem = {
  quantity: number;
  customizations?: {
    options?: unknown[];
    addOns?: unknown[];
  };
};

type OrderMenuItemSummary = Pick<
  typeof menuItems.$inferSelect,
  keyof typeof orderMenuItemSummaryColumns
>;

type OrderItemWithRelations = typeof orderItems.$inferSelect & {
  menuItem?: OrderMenuItemSummary | null;
};

type OrderRestaurantRelation = Pick<
  typeof restaurants.$inferSelect,
  "id" | "name"
> &
  Partial<Pick<typeof restaurants.$inferSelect, "phone">>;
type OrderTableRelation = Pick<typeof tables.$inferSelect, "id" | "number">;
type OrderCustomerRelation = Pick<
  typeof customers.$inferSelect,
  "id" | "displayName" | "primaryPhone"
>;

type OrderWithRelations = typeof orders.$inferSelect & {
  items?: OrderItemWithRelations[];
  restaurant?: OrderRestaurantRelation | null;
  table?: OrderTableRelation | null;
  customer?: OrderCustomerRelation | null;
};

function resolveMoneyCents(
  cents: number | string | null | undefined,
  label: string,
): number {
  if (cents != null) {
    const normalizedCents = typeof cents === "string" ? Number(cents) : cents;
    if (Number.isFinite(normalizedCents)) {
      return Math.round(normalizedCents);
    }
  }

  throw new Error(`${label} cents are required`);
}

function normalizeMoneyAmount(
  amount: number | null | undefined,
  label: string,
): number {
  if (amount == null) return 0;
  if (!Number.isFinite(amount)) {
    throw new Error(`${label} must be finite`);
  }
  return amount;
}

function findCatalogChoice(
  groups: MenuItemCustomizationGroup[],
  selected: SelectedCustomizationOption,
  menuItemId: number,
): {
  group: MenuItemCustomizationGroup;
  choice: MenuItemCustomizationChoice;
} {
  const selectedChoiceId = selected.choiceId || selected.id;
  const groupCandidates =
    selected.id && selected.id !== selectedChoiceId
      ? groups.filter((group) => group.id === selected.id)
      : groups;

  for (const group of groupCandidates) {
    const choice = group.choices.find(
      (choice) => choice.id === selectedChoiceId || choice.id === selected.id,
    );
    if (choice) return { group, choice };
  }

  throw new Error(
    `Unknown customization choice ${selectedChoiceId} for menu item ${menuItemId}`,
  );
}

/**
 * Group-level rules: whether a group must be answered, and how many answers it
 * takes. Everything else about a selection is checked as it is resolved, but
 * these three can only be judged once the whole item is in hand — "no choice at
 * all" is invisible from inside the loop over what was chosen.
 *
 * They are also the rules the customer app enforces by disabling controls,
 * which is exactly why they need a second home here: a request that never went
 * through that UI would otherwise book a required 辣度 as unanswered, or put
 * five toppings in a group capped at three.
 */
/**
 * Stable prefix so the API layer can answer 400 INVALID_CUSTOMIZATION instead
 * of letting a client mistake surface as a 500. Matching on message text is the
 * convention already in use here ("Menu item N is not available"); a shared
 * prefix keeps it to one pattern instead of three.
 */
export const INVALID_CUSTOMIZATION_PREFIX = "Invalid customization:";

function assertCustomizationGroupRules(
  groups: MenuItemCustomizationGroup[],
  selectedOptions: NonNullable<SelectedCustomizations["options"]>,
  menuItemId: number,
): void {
  const chosenPerGroup = new Map<string, number>();
  for (const option of selectedOptions) {
    chosenPerGroup.set(option.id, (chosenPerGroup.get(option.id) ?? 0) + 1);
  }

  for (const group of groups) {
    const chosen = chosenPerGroup.get(group.id) ?? 0;

    if (group.required && chosen === 0) {
      throw new Error(
        `${INVALID_CUSTOMIZATION_PREFIX} group ${group.id} is required for menu item ${menuItemId}`,
      );
    }

    if (group.type === "single" && chosen > 1) {
      throw new Error(
        `${INVALID_CUSTOMIZATION_PREFIX} group ${group.id} accepts a single choice for menu item ${menuItemId}`,
      );
    }

    if (
      group.type === "multiple" &&
      group.maxSelections != null &&
      chosen > group.maxSelections
    ) {
      throw new Error(
        `${INVALID_CUSTOMIZATION_PREFIX} group ${group.id} allows at most ${group.maxSelections} choices for menu item ${menuItemId}`,
      );
    }
  }
}

/**
 * The owner's manual sold-out switch. It reaches the catalog as
 * `available: false` on the individual size / choice / add-on, and it has to be
 * refused here as well as hidden in the app: the flag is flipped mid-service,
 * so a modal opened a minute earlier still offers what has since run out.
 */
function assertChoiceAvailable(
  option: { available?: boolean },
  label: string,
  menuItemId: number,
): void {
  if (option.available === false) {
    throw new Error(
      `${INVALID_CUSTOMIZATION_PREFIX} ${label} is sold out for menu item ${menuItemId}`,
    );
  }
}

function resolveCatalogCustomizations(
  menuItem: MenuItemRecord,
  selected: SelectedCustomizations | undefined,
): {
  customizations: SelectedCustomizations | undefined;
  additionalUnitPriceCents: number;
} {
  const catalogOptions = menuItem.options ?? {};
  const customizations: SelectedCustomizations = {};
  let additionalUnitPriceCents = 0;

  if (selected?.size) {
    const size = catalogOptions.sizes?.find(
      (catalogSize) => catalogSize.id === selected.size?.id,
    );
    if (!size) {
      throw new Error(
        `Unknown size ${selected.size.id} for menu item ${menuItem.id}`,
      );
    }

    assertChoiceAvailable(size, `size ${size.id}`, menuItem.id);

    const priceAdjustment = normalizeMoneyAmount(
      size.priceAdjustment,
      `Size ${size.id} price adjustment`,
    );
    additionalUnitPriceCents += toRequiredCents(priceAdjustment);
    customizations.size = {
      id: size.id,
      name: size.name,
      priceAdjustment,
    };
  }

  if (selected?.options?.length) {
    const groups = catalogOptions.customizations ?? [];
    const seenChoiceIds = new Set<string>();
    customizations.options = selected.options.map((selectedOption) => {
      const { group, choice } = findCatalogChoice(
        groups,
        selectedOption,
        menuItem.id,
      );
      if (seenChoiceIds.has(choice.id)) {
        throw new Error(
          `Duplicate customization choice ${choice.id} for menu item ${menuItem.id}`,
        );
      }
      seenChoiceIds.add(choice.id);

      assertChoiceAvailable(choice, `choice ${choice.id}`, menuItem.id);

      const priceAdjustment = normalizeMoneyAmount(
        choice.priceAdjustment,
        `Customization choice ${choice.id} price adjustment`,
      );
      additionalUnitPriceCents += toRequiredCents(priceAdjustment);
      return {
        id: group.id,
        optionName: group.name,
        choiceId: choice.id,
        choiceName: choice.name,
        priceAdjustment,
      };
    });
  }

  if (selected?.addOns?.length) {
    const catalogAddOns = catalogOptions.addOns ?? [];
    const seenAddOnIds = new Set<string>();
    customizations.addOns = selected.addOns.map(
      (selectedAddOn: SelectedAddOn) => {
        const addOn = catalogAddOns.find(
          (catalogAddOn) => catalogAddOn.id === selectedAddOn.id,
        );
        if (!addOn) {
          throw new Error(
            `Unknown add-on ${selectedAddOn.id} for menu item ${menuItem.id}`,
          );
        }
        if (seenAddOnIds.has(addOn.id)) {
          throw new Error(
            `Duplicate add-on ${addOn.id} for menu item ${menuItem.id}`,
          );
        }
        seenAddOnIds.add(addOn.id);
        assertChoiceAvailable(addOn, `add-on ${addOn.id}`, menuItem.id);

        const quantity = selectedAddOn.quantity || 1;
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new Error(
            `Invalid add-on quantity ${quantity} for menu item ${menuItem.id}`,
          );
        }
        if (addOn.maxQuantity != null && quantity > addOn.maxQuantity) {
          throw new Error(
            `Add-on ${addOn.id} quantity exceeds maximum for menu item ${menuItem.id}`,
          );
        }

        const unitPrice = normalizeMoneyAmount(
          addOn.price,
          `Add-on ${addOn.id} price`,
        );
        const unitPriceCents = toRequiredCents(unitPrice);
        const totalPrice = fromCents(unitPriceCents * quantity);
        additionalUnitPriceCents += unitPriceCents * quantity;
        return {
          id: addOn.id,
          name: addOn.name,
          unitPrice,
          quantity,
          totalPrice,
        };
      },
    );
  }

  if (selected?.specialInstructions) {
    customizations.specialInstructions = selected.specialInstructions;
  }

  assertCustomizationGroupRules(
    catalogOptions.customizations ?? [],
    customizations.options ?? [],
    menuItem.id,
  );

  return {
    customizations:
      Object.keys(customizations).length > 0 ? customizations : undefined,
    additionalUnitPriceCents,
  };
}

// Drizzle's `timestamp_ms` mode returns `Date` objects. The wire contract for
// orders is Unix-ms integers, so convert before leaving the service boundary —
// otherwise `JSON.stringify` silently turns Dates into ISO strings and
// downstream arithmetic like `Date.now() - createdAt` coerces to NaN.
function toMillis(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : value;
}

// `orders.status`, `orders.payment_status`, `orders.payment_method` and
// `order_items.status` are all unconstrained TEXT columns, so the DTO boundary
// is where the canonical value domains get re-established. A value outside its
// domain falls back to the column default rather than being cast through as a
// valid-looking one — that silent cast is what let "unpaid" and friends drift
// into the order surface unnoticed (#206).
function toOrderStatus(value: string): OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value)
    ? (value as OrderStatus)
    : "pending";
}

function toOrderPaymentStatus(value: string | null): OrderPaymentStatus {
  return value !== null &&
    (ORDER_PAYMENT_STATUSES as readonly string[]).includes(value)
    ? (value as OrderPaymentStatus)
    : "pending";
}

function toOrderPaymentMethod(
  value: string | null,
): OrderPaymentMethod | undefined {
  return value !== null &&
    (ORDER_PAYMENT_METHODS as readonly string[]).includes(value)
    ? (value as OrderPaymentMethod)
    : undefined;
}

function toOrderItemStatus(value: string): OrderItemStatus {
  return (ORDER_ITEM_STATUSES as readonly string[]).includes(value)
    ? (value as OrderItemStatus)
    : "pending";
}

export class OrderService extends BaseService {
  // 獲取餐廳最低消費設定
  async getMinimumOrderAmount(
    restaurantId: string,
  ): Promise<{ minOrderAmount: number; enabled: boolean }> {
    try {
      const restaurant = await this.db.query.restaurants.findFirst({
        where: eq(restaurants.id, restaurantId),
        columns: {
          settings: true,
          isAvailable: true,
        },
      });

      if (!restaurant) {
        throw new Error("Restaurant not found");
      }

      const settings = restaurant.settings || {};
      const minOrderAmount = settings.minOrderAmount || 0;

      return {
        minOrderAmount,
        enabled: minOrderAmount > 0 && restaurant.isAvailable,
      };
    } catch (error) {
      this.handleError(error, "getMinimumOrderAmount");
    }
  }

  // 創建訂單
  async createOrder(data: CreateOrderData): Promise<Order> {
    try {
      // 驗證餐廳和桌子
      // Convert restaurantId to string for UUID comparison
      const restaurantIdStr = String(data.restaurantId);
      const restaurant = await this.db.query.restaurants.findFirst({
        where: eq(restaurants.id, restaurantIdStr),
      });

      // 這些是顧客請求本身的問題，不是伺服器故障。丟 ApiError（來自
      // @makanmasak/utils，與 API 層 re-export 的是同一個類別）讓
      // app-factory 的 `err instanceof ApiError` 分支直接輸出 4xx，
      // 而不是掉進 ErrorSanitizer 變成 500 GENERIC_ERROR（#352）。
      if (!restaurant || !restaurant.isAvailable) {
        throw conflict("Restaurant is not available", "RESTAURANT_UNAVAILABLE");
      }

      // 外送必須由店家開啟才收單。前端只是不顯示外送選項，直接打 API 帶
      // `deliveryInfo.type = "delivery"` 一樣建得起來（#295）。守門放在這裡而
      // 不是路由層，因為 orders / guest-orders / market-checkouts / group-orders
      // 四條路徑都經過 createOrder。
      //
      // 判斷條件與 `hasEnabledFulfillmentMethod`（探索頁與餐廳清單用來標「可外
      // 送」的那一個）相同：settings 旗標或 supports_delivery 欄位任一為真即
      // 放行，否則探索頁掛著「可外送」的店會拒收自己招來的訂單。
      //
      // 只擋外送。內用與外帶沒有相同處理：`enableDineIn` / `enableTakeaway` 對
      // 從未存過設定的店家是 undefined，在這裡當成「關閉」會把現有的內用與外帶
      // 訂單全部擋掉（market-checkouts 每一張都是 takeaway）。外送的 undefined
      // 本來就等於關閉 —— 前端也是 `?? false` —— 所以這道門只會擋掉 UI 從未
      // 提供過的訂單。
      const settings = restaurant.settings || {};
      if (data.deliveryInfo?.type === "delivery") {
        if (!settings.enableDelivery && !restaurant.supportsDelivery) {
          throw new Error("DELIVERY_NOT_ENABLED");
        }
      }

      // Only validate table for dine-in orders (tableId provided)
      if (data.tableId) {
        const table = await this.db.query.tables.findFirst({
          where: eq(tables.id, data.tableId),
        });

        if (!table || !table.isActive) {
          throw conflict("Table is not available", "TABLE_UNAVAILABLE");
        }
      }

      if (data.waitingListId) {
        await this.validateWaitingListPreOrder(
          data.waitingListId,
          data.restaurantId,
          data.waitingListCustomerPhone,
        );
      }

      const { subtotalCents, orderItemsData } = await this.prepareOrderItems(
        data.items,
      );

      const subtotal = fromCents(subtotalCents);

      // 優惠券驗證和折扣計算
      let discountAmount = 0;
      let validatedCoupon = null;
      let couponService: InstanceType<
        typeof import("./coupon").CouponService
      > | null = null;

      if (data.couponCode) {
        const { CouponService } = await import("./coupon");
        couponService = new CouponService(this.d1, this.env);

        const validationResult = await couponService.validateCoupon(
          data.couponCode,
          data.restaurantId.toString(),
          subtotal,
          data.couponUserId,
          data.items,
        );

        if (validationResult.valid) {
          discountAmount = validationResult.discountAmount || 0;
          validatedCoupon = validationResult.coupon;
        } else {
          throw badRequest(
            `優惠券驗證失敗: ${validationResult.error}`,
            "COUPON_INVALID",
          );
        }
      }

      // 驗證最低消費（在折扣後但在計算稅金前）
      const minOrderAmount = settings.minOrderAmount || 0;
      const orderAmountAfterDiscount = subtotal - discountAmount;

      if (minOrderAmount > 0 && orderAmountAfterDiscount < minOrderAmount) {
        const shortfall = minOrderAmount - orderAmountAfterDiscount;
        // 幣別跟著店家設定走。這裡曾經硬寫 `RM`，所以一家 TWD 的店會告訴
        // 顧客「最低消費 RM300」（#352）。details 帶結構化數字，前端可以自己
        // 排版，不必去 parse 這句話。
        const currency = resolveCurrency(settings.currency);
        throw badRequest(
          `訂單未達最低消費標準。最低消費：${formatCurrency(
            minOrderAmount,
            currency,
          )}，目前金額：${formatCurrency(
            orderAmountAfterDiscount,
            currency,
          )}，還需：${formatCurrency(shortfall, currency)}`,
          "MINIMUM_ORDER_NOT_MET",
          {
            minOrderAmount,
            currentAmount: orderAmountAfterDiscount,
            shortfall,
            currency,
          },
        );
      }

      // 外送費一律由店家設定決定。請求 body 帶的 `deliveryFee` 只當顯示值，
      // 不參與計價 —— 否則顧客自己填 0 元外送費就成立（#295）。
      const deliveryFee =
        data.deliveryInfo?.type === "delivery"
          ? (settings.deliveryFee ?? 0)
          : 0;

      // 計算稅金和服務費（考慮折扣）
      const taxRate = settings.taxRate || 0;
      const serviceChargeRate = settings.serviceChargeRate || 0;
      const {
        taxAmountCents,
        serviceChargeCents,
        discountAmountCents,
        totalAmountCents,
      } = this.calculateOrderTotal(
        subtotal,
        taxRate,
        serviceChargeRate,
        discountAmount,
        deliveryFee,
      );

      // 寫回伺服器端算出的金額，覆蓋顧客送上來的。除了不信任來源之外，
      // `addItemsToOrder` 重算總額時也是從這裡把外送費讀回來的，兩者必須是
      // 同一個數字。非外送單一律寫 0，順便洗掉客戶端硬塞的運費。
      const deliveryInfo = data.deliveryInfo
        ? { ...data.deliveryInfo, deliveryFee }
        : undefined;

      // 生成訂單號碼
      const orderNumber = this.generateOrderNumber(data.restaurantId);

      // ---- 原子寫入階段 ----
      // 生產環境 D1 不支援互動式 BEGIN（db.transaction 必定失敗），
      // 唯一的原子提交原語是 db.batch：整批語句在單一交易中循序執行，
      // 任一失敗即全部回滾 — 不會留下孤兒訂單、優惠券消耗或庫存漂移。
      // orders.id 是 UUID text，order_items / coupon_usage 透過唯一的
      // order_number 子查詢在同一批次內回填外鍵。
      const orderIdRef = sql<string>`(select ${orders.id} from ${orders} where ${orders.orderNumber} = ${orderNumber})`;

      const writeStatements: BatchItem<"sqlite">[] = [
        this.db
          .insert(orders)
          .values({
            restaurantId: data.restaurantId,
            tableId: data.tableId,
            customerId: data.customerId,
            waitingListId: data.waitingListId,
            orderNumber,
            orderType: data.orderType,
            subtotalCents,
            taxAmountCents,
            serviceChargeCents,
            discountAmountCents,
            totalAmountCents,
            customerInfo: data.customerInfo,
            notes: data.notes,
            couponCode: data.couponCode,
            ...(data.clientMutationId
              ? { clientMutationId: data.clientMutationId }
              : {}),
            orderSource: data.orderSource || "direct",
            deliveryInfo,
            estimatedPrepTime: this.calculateEstimatedPrepTime(orderItemsData),
          })
          .returning(),
        this.db
          .insert(orderItems)
          .values(
            orderItemsData.map((item) => ({
              ...this.toOrderItemInsert(item),
              orderId: orderIdRef as unknown as string,
            })),
          )
          .returning(),
      ];

      // 優惠券名額仍須先佔用；其餘庫存與帳本寫入一律留在下面同一個
      // D1 batch，不能靠補償交易修復。
      let claimedCouponId: number | null = null;
      const releaseClaimedCoupon = async () => {
        if (claimedCouponId !== null && couponService) {
          try {
            await couponService.releaseUsageSlot(claimedCouponId);
          } catch (releaseError) {
            console.error("Coupon slot release failed:", releaseError);
          }
        }
      };
      const ingredientConsumption = new IngredientConsumptionService(this.db);
      if (validatedCoupon && discountAmount > 0 && couponService) {
        await couponService.claimUsageSlot(validatedCoupon.id);
        claimedCouponId = validatedCoupon.id;
        writeStatements.push(
          this.db.insert(couponUsage).values({
            couponId: validatedCoupon.id,
            orderId: orderIdRef as unknown as string,
            userId: data.couponUserId,
            discountAmountCents: toRequiredCents(discountAmount),
            originalAmountCents: toRequiredCents(subtotal),
            finalAmountCents: totalAmountCents,
            status: "active",
          }),
        );
      }

      // `prepareOrderItems` already rejects insufficient menu inventory.
      // These writes share the order/items/ledger batch, so an injected D1
      // failure rolls every one back together.
      for (const { menuItemId, quantity } of data.items) {
        writeStatements.push(
          this.db
            .update(menuItems)
            .set({
              inventoryCount: sql`CASE WHEN ${menuItems.inventoryCount} IS NULL THEN NULL ELSE ${menuItems.inventoryCount} - ${quantity} END`,
            })
            .where(
              and(
                eq(menuItems.id, menuItemId),
                sql`(${menuItems.inventoryCount} IS NULL OR ${menuItems.inventoryCount} >= ${quantity})`,
              ),
            ),
          this.db
            .update(restaurants)
            .set({
              id: sql<string>`CASE WHEN changes() = 0 THEN NULL ELSE ${restaurants.id} END`,
            })
            .where(
              eq(restaurants.id, data.restaurantId),
            ) as BatchItem<"sqlite">,
        );
      }
      writeStatements.push(
        ...(await ingredientConsumption.buildConsumptionWrites(
          data.restaurantId,
          data.items,
          { orderId: orderIdRef },
        )),
      );

      for (const { menuItemId, quantity } of data.items) {
        writeStatements.push(
          this.db
            .update(menuItems)
            .set({
              orderCount: sql`${menuItems.orderCount} + ${quantity}`,
            })
            .where(eq(menuItems.id, menuItemId)),
        );
      }
      writeStatements.push(
        this.db
          .update(restaurants)
          .set({
            totalOrders: sql`${restaurants.totalOrders} + 1`,
          })
          .where(eq(restaurants.id, data.restaurantId)),
      );

      let batchResults: unknown[];
      try {
        batchResults = await this.db.batch(
          writeStatements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
        );
      } catch (error) {
        await releaseClaimedCoupon();
        if (
          error instanceof Error &&
          /NOT NULL constraint failed: restaurants\.id/i.test(error.message)
        ) {
          // 有人在這張單準備期間把庫存買走了。與改單路徑
          // (`mapOrderItemMutationError`) 對外同一個代碼與狀態碼，顧客端才
          // 不會因為走哪條路而看到兩種結果。
          throw conflict("Insufficient inventory", "INSUFFICIENT_INVENTORY");
        }
        throw error;
      }

      const [order] = batchResults[0] as (typeof orders.$inferSelect)[];
      const items = batchResults[1] as (typeof orderItems.$inferSelect)[];

      await this.recomputeMemberProjection(order);

      // Re-fetch with full relations (menuItem name/image) so callers
      // and downstream caches get complete data. The insert().returning()
      // above only returns columns from the order_items table itself.
      try {
        const fullOrder = await this.getOrder(order.id);
        if (fullOrder) return fullOrder;
      } catch {
        // Some legacy adapters do not expose query.orders;
        // fall back to the inserted rows instead of failing order creation.
      }

      // Fallback: should not happen, but safe to degrade gracefully
      return this.mapToOrder({ ...order, items });
    } catch (error) {
      // A business-rule rejection raised above already carries its code and
      // status. Everything below this line inspects `message` and ends at
      // `handleError`, which rebuilds the error as a plain `Error` — so
      // without this line an ApiError loses its identity here and surfaces
      // as a 500 anyway (#352).
      if (error instanceof ApiError) throw error;

      const message = error instanceof Error ? error.message : String(error);
      // Different SQLite / D1 surfaces quote the UNIQUE violation column
      // differently:
      //   - local miniflare:    "UNIQUE constraint failed: orders.restaurant_id, orders.client_mutation_id"
      //   - CI wrangler dev D1: "Failed query: insert into \"orders\" (..., \"client_mutation_id\", ...)"
      // Match on the column name alone so both formats map to the
      // same CLIENT_MUTATION_DUPLICATE path that the route translates
      // to 409.
      if (
        message.includes("UNIQUE constraint failed") &&
        message.includes("client_mutation_id")
      ) {
        throw new Error("CLIENT_MUTATION_DUPLICATE");
      }

      if (
        message.includes("UNIQUE constraint failed") &&
        message.includes("waiting_list_id")
      ) {
        throw new Error("WAITING_LIST_PREORDER_EXISTS");
      }

      this.handleError(error, "createOrder");
    }
  }

  private async validateWaitingListPreOrder(
    waitingListId: string,
    restaurantId: string,
    customerPhone?: string,
  ): Promise<void> {
    const entry = await this.db.query.waitingList.findFirst({
      where: eq(waitingList.id, waitingListId),
    });

    if (!entry || entry.restaurantId !== restaurantId) {
      throw new Error("WAITING_LIST_TICKET_NOT_FOUND");
    }

    if (!["waiting", "called", "confirmed"].includes(entry.status)) {
      throw new Error("WAITING_LIST_TICKET_NOT_ACTIVE");
    }

    if (!customerPhone || entry.customerPhone !== customerPhone) {
      throw new Error("WAITING_LIST_PHONE_MISMATCH");
    }
  }

  async confirmWaitingListPreOrders(
    waitingListId: string,
    tableId: number,
  ): Promise<Order[]> {
    const now = new Date();
    await this.db
      .update(orders)
      .set({
        tableId,
        status: ORDER_STATUS.CONFIRMED,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(orders.waitingListId, waitingListId),
          eq(orders.status, ORDER_STATUS.PENDING),
        ),
      );

    const confirmedOrders = await this.db.query.orders.findMany({
      where: and(
        eq(orders.waitingListId, waitingListId),
        eq(orders.status, ORDER_STATUS.CONFIRMED),
      ),
      with: {
        restaurant: {
          columns: { id: true, name: true },
        },
        table: {
          columns: { id: true, number: true },
        },
        items: {
          with: {
            menuItem: {
              columns: orderMenuItemSummaryColumns,
            },
          },
        },
      },
    });

    return confirmedOrders.map((order) => this.mapToOrder(order));
  }

  async cancelWaitingListPreOrders(waitingListId: string): Promise<void> {
    // This used to flip the status with a bare UPDATE, which put back nothing
    // -- not the menu-item inventory the pre-order held, and (once #278 landed)
    // not the ingredients it consumed either. Cancelling is not a status
    // change; it is a status change plus two restores, and cancelOrder is the
    // one place that knows that. Duplicating it here is how the halves drift
    // apart.
    const pending = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.waitingListId, waitingListId),
          eq(orders.status, ORDER_STATUS.PENDING),
        ),
      );

    for (const { id } of pending) {
      try {
        await this.cancelOrder(id, "Waiting list entry cancelled");
      } catch (error) {
        // A pre-order that moved out of pending between the read and the
        // cancel is somebody else's business now. Losing one must not leave
        // the rest of the list uncancelled.
        console.error(
          `Waiting list pre-order ${id} could not be cancelled:`,
          error,
        );
      }
    }
  }

  // 獲取訂單詳情
  async getOrder(id: string): Promise<Order | null> {
    try {
      const order = await this.db.query.orders.findFirst({
        where: eq(orders.id, id),
        with: {
          restaurant: {
            columns: {
              id: true,
              name: true,
              phone: true,
            },
          },
          table: {
            columns: {
              id: true,
              number: true,
            },
          },
          customer: {
            columns: {
              id: true,
              displayName: true,
              primaryPhone: true,
            },
          },
          items: {
            with: {
              menuItem: {
                columns: orderMenuItemSummaryColumns,
              },
            },
          },
        },
      });

      return order ? this.mapToOrder(order) : null;
    } catch (error) {
      this.handleError(error, "getOrder");
    }
  }

  async addItemsToOrder(
    id: string,
    items: AddOrderItemsData,
    expectedVersion?: number,
  ): Promise<Order> {
    try {
      if (!items.length) {
        throw new Error("Order must contain at least one item");
      }

      const existingOrder = await this.db.query.orders.findFirst({
        where: eq(orders.id, id),
      });
      if (!existingOrder) {
        throw new Error("Order not found");
      }
      const canAddItems = [ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED].some(
        (status) => status === existingOrder.status,
      );
      if (!canAddItems) {
        throw new Error(
          `Cannot add items to an order with status: ${existingOrder.status}`,
        );
      }
      // Compared here rather than at the route, and that placement is the
      // whole point: this read is the one that feeds the CAS below, so
      // "caller's version == this read" plus "this read == write-time version"
      // together mean the caller's version held for the entire operation. The
      // same check one layer up leaves a window between its read and this one.
      if (
        expectedVersion != null &&
        existingOrder.version !== expectedVersion
      ) {
        throw new Error("Order version conflict");
      }

      const { subtotalCents: addedSubtotalCents, orderItemsData } =
        await this.prepareOrderItems(items);

      const currentSubtotalCents = resolveMoneyCents(
        existingOrder.subtotalCents,
        "Order subtotal",
      );
      const currentTaxCents = resolveMoneyCents(
        existingOrder.taxAmountCents,
        "Order tax amount",
      );
      const currentServiceChargeCents = resolveMoneyCents(
        existingOrder.serviceChargeCents,
        "Order service charge",
      );
      const currentDiscountCents = resolveMoneyCents(
        existingOrder.discountAmountCents,
        "Order discount amount",
      );
      const taxRate =
        currentSubtotalCents > 0 ? currentTaxCents / currentSubtotalCents : 0;
      const serviceChargeRate =
        currentSubtotalCents > 0
          ? currentServiceChargeCents / currentSubtotalCents
          : 0;
      const nextSubtotal = fromCents(currentSubtotalCents + addedSubtotalCents);
      // 這裡是重算整張訂單的總額，不是加總差額 —— 沒有把外送費帶進來，加點
      // 就會把它從 total 裡抹掉。運費不隨品項變動，原封讀回原本存下的那筆。
      const deliveryFee =
        existingOrder.deliveryInfo?.type === "delivery"
          ? (existingOrder.deliveryInfo.deliveryFee ?? 0)
          : 0;
      const {
        subtotalCents,
        taxAmountCents,
        serviceChargeCents,
        totalAmountCents,
      } = this.calculateOrderTotal(
        nextSubtotal,
        taxRate,
        serviceChargeRate,
        fromCents(currentDiscountCents),
        deliveryFee,
      );

      // A version is not an attempt identity: a later writer can legitimately
      // reach the same version. The immediate assertion below converts a
      // zero-row state UPDATE into a SQLite constraint error, which aborts the
      // D1 batch before any dependent write can execute.
      const observedVersion = existingOrder.version;
      const ingredientConsumption = new IngredientConsumptionService(this.db);
      const writeStatements: BatchItem<"sqlite">[] = [
        this.db
          .update(orders)
          .set({
            subtotalCents,
            taxAmountCents,
            serviceChargeCents,
            totalAmountCents,
            version: sql`${orders.version} + 1`,
            estimatedPrepTime: Math.max(
              existingOrder.estimatedPrepTime ?? 0,
              this.calculateEstimatedPrepTime(orderItemsData),
            ),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(orders.id, id),
              eq(orders.version, observedVersion),
              inArray(orders.status, [
                ORDER_STATUS.PENDING,
                ORDER_STATUS.CONFIRMED,
              ]),
            ),
          )
          .returning({ id: orders.id }),
        // This must immediately follow the CAS above: SQLite's changes()
        // reports its preceding statement. The parent id is NOT NULL/PK, so a
        // stale add attempts to set it NULL and aborts the entire batch;
        // success writes the same id and is a harmless no-op.
        this.db
          .update(restaurants)
          .set({
            id: sql<string>`CASE WHEN changes() = 0 THEN NULL ELSE ${restaurants.id} END`,
          })
          .where(
            eq(restaurants.id, existingOrder.restaurantId),
          ) as BatchItem<"sqlite">,
      ];

      for (const item of orderItemsData) {
        writeStatements.push(
          this.db.insert(orderItems).values({
            ...this.toOrderItemInsert(item),
            orderId: id,
          }) as BatchItem<"sqlite">,
        );
      }

      for (const { menuItemId, quantity } of items) {
        writeStatements.push(
          this.db
            .update(menuItems)
            .set({
              inventoryCount: sql`CASE WHEN ${menuItems.inventoryCount} IS NULL THEN NULL ELSE ${menuItems.inventoryCount} - ${quantity} END`,
              orderCount: sql`${menuItems.orderCount} + ${quantity}`,
            })
            .where(
              and(
                eq(menuItems.id, menuItemId),
                sql`(${menuItems.inventoryCount} IS NULL OR ${menuItems.inventoryCount} >= ${quantity})`,
              ),
            ),
          this.db
            .update(restaurants)
            .set({
              id: sql<string>`CASE WHEN changes() = 0 THEN NULL ELSE ${restaurants.id} END`,
            })
            .where(
              eq(restaurants.id, existingOrder.restaurantId),
            ) as BatchItem<"sqlite">,
        );
      }

      writeStatements.push(
        ...(await ingredientConsumption.buildConsumptionWrites(
          existingOrder.restaurantId,
          items,
          { orderId: id },
        )),
      );

      try {
        const batchResults = await this.db.batch(
          writeStatements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
        );
        const advanced = batchResults[0] as Array<{ id: string }>;
        if (advanced.length === 0) throw new Error("Order cannot accept items");
      } catch (error) {
        if (
          error instanceof Error &&
          /NOT NULL constraint failed: restaurants\.id/i.test(error.message)
        ) {
          throw new Error("Order cannot accept items");
        }
        throw error;
      }

      const updatedOrder = await this.getOrder(id);
      if (!updatedOrder) {
        throw new Error("Order not found");
      }
      return updatedOrder;
    } catch (error) {
      this.handleError(error, "addItemsToOrder");
    }
  }

  /**
   * Set the order-level discount and recompute the total from it.
   *
   * The counter needs this because the server is the only authority on what an
   * order costs: `PaymentService` compares the client's `amount` and
   * `expectedTotal` against `orders.total_amount_cents` and refuses anything
   * else. A discount applied only in the till's own state therefore cannot be
   * paid at all -- it turns into PAYMENT_AMOUNT_MISMATCH (#327).
   *
   * Takes a *percentage*, never an amount. The money is derived here, from
   * this order's own stored cents, so no float from a caller ever becomes a
   * price -- a client-supplied total is exactly what #295 established must not
   * be trusted, and keeping the arithmetic in the cents layer avoids a
   * major-unit round trip that can land a half cent off.
   *
   * Guarded on `version` like `addItemsToOrder`, and on status via the same
   * conditional UPDATE, so a discount cannot land on an order that another
   * writer has just closed. The payable set is wider than PENDING/CONFIRMED --
   * the till works on `ready` and `delivered` orders -- so the guard is stated
   * as "not yet finalized" instead, matching what PaymentService will accept.
   */
  async applyOrderDiscount(
    id: string,
    discountPercent: number,
    expectedVersion?: number,
  ): Promise<Order> {
    try {
      const existingOrder = await this.db.query.orders.findFirst({
        where: eq(orders.id, id),
      });
      if (!existingOrder) {
        throw new Error("Order not found");
      }
      if (
        expectedVersion !== undefined &&
        existingOrder.version !== expectedVersion
      ) {
        throw new Error("Order version conflict");
      }
      // `discount_amount_cents` is one column holding one figure, and the
      // coupon path already owns it. Writing a manual discount over it would
      // silently cancel the customer's coupon while `coupon_code` went on
      // claiming otherwise, so the counter has to void and re-ring instead.
      // Separating the two is a schema change (#327).
      if (existingOrder.couponCode) {
        throw new Error("Order already carries a coupon discount");
      }

      const currentSubtotalCents = resolveMoneyCents(
        existingOrder.subtotalCents,
        "Order subtotal",
      );
      const currentTaxCents = resolveMoneyCents(
        existingOrder.taxAmountCents,
        "Order tax amount",
      );
      const currentServiceChargeCents = resolveMoneyCents(
        existingOrder.serviceChargeCents,
        "Order service charge",
      );

      // Rates are recovered from the stored cents rather than re-read from
      // settings: a rate change after the order was placed must not silently
      // reprice it.
      const taxRate =
        currentSubtotalCents > 0 ? currentTaxCents / currentSubtotalCents : 0;
      const serviceChargeRate =
        currentSubtotalCents > 0
          ? currentServiceChargeCents / currentSubtotalCents
          : 0;
      const deliveryFee =
        existingOrder.deliveryInfo?.type === "delivery"
          ? (existingOrder.deliveryInfo.deliveryFee ?? 0)
          : 0;

      // The discount may not exceed what is being charged for the food, so the
      // total can never go negative. The delivery fee is excluded from the
      // ceiling for the same reason it is excluded from tax: it is carriage,
      // not consumption, and discounting it would be giving away the courier.
      const discountCeilingCents =
        currentSubtotalCents + currentTaxCents + currentServiceChargeCents;
      if (!Number.isFinite(discountPercent)) {
        throw new Error("Discount percent must be a number");
      }
      if (discountPercent < 0 || discountPercent > 100) {
        throw new Error("Discount percent must be between 0 and 100");
      }
      const requestedDiscountCents = Math.min(
        Math.round((discountCeilingCents * discountPercent) / 100),
        discountCeilingCents,
      );

      const { discountAmountCents, totalAmountCents } =
        this.calculateOrderTotal(
          fromCents(currentSubtotalCents),
          taxRate,
          serviceChargeRate,
          fromCents(requestedDiscountCents),
          deliveryFee,
        );

      const observedVersion = existingOrder.version;
      const updated = await this.db
        .update(orders)
        .set({
          discountAmountCents,
          totalAmountCents,
          version: sql`${orders.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.version, observedVersion),
            notInArray(orders.status, [
              ORDER_STATUS.CANCELLED,
              ORDER_STATUS.PAID,
              ORDER_STATUS.REFUNDED,
            ]),
          ),
        )
        .returning({ id: orders.id });

      if (updated.length === 0) {
        // Either another writer moved the version, or the order reached a
        // finalized status between the read and the write. Both mean the
        // caller's view is stale; the distinction is not worth a second query.
        throw new Error("Order version conflict");
      }

      return (await this.getOrder(id)) as Order;
    } catch (error) {
      this.handleError(error, "applyOrderDiscount");
    }
  }

  /**
   * Change one existing line's quantity, or remove the line entirely.
   *
   * The inverse of `addItemsToOrder`, and deliberately the same shape: one
   * conditional UPDATE on `orders` guarded by `version` and status, an
   * immediate `changes()` sentinel that turns a lost race into a constraint
   * failure so D1 rolls the whole batch back, then every dependent write.
   * Nothing here is compensatable after the fact -- stock and the ingredient
   * ledger must move with the order row or not at all.
   *
   * `newQuantity === 0` deletes the row rather than marking it cancelled.
   * `order_items.status` does carry a `cancelled` value, but ReceiptService
   * and the POS read `order_items` with no status predicate, so a soft-
   * cancelled line would print on the customer's bill at full price. The
   * history lives in `audit_logs.changes` instead, which is what an
   * amount-affecting operation is supposed to leave behind (#273 section 6).
   */
  async changeOrderItemQuantity(
    orderId: string,
    orderItemId: number,
    newQuantity: number,
    expectedVersion?: number,
  ): Promise<Order> {
    try {
      if (!Number.isInteger(newQuantity) || newQuantity < 0) {
        throw new Error("Quantity must be a non-negative integer");
      }

      const existingOrder = await this.db.query.orders.findFirst({
        where: eq(orders.id, orderId),
      });
      if (!existingOrder) {
        throw new Error("Order not found");
      }
      const modifiable = [ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED].some(
        (status) => status === existingOrder.status,
      );
      if (!modifiable) {
        throw new Error(
          `Cannot modify items on an order with status: ${existingOrder.status}`,
        );
      }
      if (
        expectedVersion != null &&
        existingOrder.version !== expectedVersion
      ) {
        throw new Error("Order version conflict");
      }

      // Scope the lookup by orderId as well as by id. The route already checks
      // the caller owns the order, but an item id belonging to a *different*
      // order would otherwise be edited under this order's permission check.
      const currentItems = await this.db
        .select({
          id: orderItems.id,
          menuItemId: orderItems.menuItemId,
          quantity: orderItems.quantity,
          unitPriceCents: orderItems.unitPriceCents,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      const target = currentItems.find((item) => item.id === orderItemId);
      if (!target) {
        throw new Error("Order item not found");
      }
      if (newQuantity === 0 && currentItems.length === 1) {
        throw new Error(
          "Cannot remove the last item from an order. Cancel the order instead",
        );
      }

      const delta = newQuantity - target.quantity;
      if (delta === 0) {
        const unchanged = await this.getOrder(orderId);
        if (!unchanged) throw new Error("Order not found");
        return unchanged;
      }

      const unitPriceCents = resolveMoneyCents(
        target.unitPriceCents,
        "Order item unit price",
      );
      const currentSubtotalCents = resolveMoneyCents(
        existingOrder.subtotalCents,
        "Order subtotal",
      );
      const currentTaxCents = resolveMoneyCents(
        existingOrder.taxAmountCents,
        "Order tax amount",
      );
      const currentServiceChargeCents = resolveMoneyCents(
        existingOrder.serviceChargeCents,
        "Order service charge",
      );
      const currentDiscountCents = resolveMoneyCents(
        existingOrder.discountAmountCents,
        "Order discount amount",
      );
      const taxRate =
        currentSubtotalCents > 0 ? currentTaxCents / currentSubtotalCents : 0;
      const serviceChargeRate =
        currentSubtotalCents > 0
          ? currentServiceChargeCents / currentSubtotalCents
          : 0;
      const nextSubtotalCents = Math.max(
        0,
        currentSubtotalCents + unitPriceCents * delta,
      );
      const totals = this.calculateOrderTotal(
        fromCents(nextSubtotalCents),
        taxRate,
        serviceChargeRate,
        fromCents(currentDiscountCents),
      );
      // The discount carries across untouched, exactly as addItemsToOrder
      // carries it: a coupon is not re-validated against the new subtotal
      // here. Shrinking an order below the coupon's minimum spend can
      // therefore drive the arithmetic negative, so this floor is what keeps
      // a "refund due" figure out of the till.
      // ponytail: floor, not re-validation. Re-run coupon eligibility if
      // shrinking-below-threshold turns out to be a real pattern.
      const totalAmountCents = Math.max(0, totals.totalAmountCents);

      const observedVersion = existingOrder.version;
      const ingredientConsumption = new IngredientConsumptionService(this.db);
      const changedItems = [
        { menuItemId: target.menuItemId, quantity: Math.abs(delta) },
      ];
      const ingredientWrites =
        delta > 0
          ? await ingredientConsumption.buildConsumptionWrites(
              existingOrder.restaurantId,
              changedItems,
              { orderId },
            )
          : await ingredientConsumption.buildRestoreWritesForItems(
              existingOrder.restaurantId,
              changedItems,
              { orderId },
            );

      // Each armed guard needs its own sentinel immediately after it, because
      // changes() only ever reports the statement directly before it.
      const sentinel = () =>
        this.db
          .update(restaurants)
          .set({
            id: sql<string>`CASE WHEN changes() = 0 THEN NULL ELSE ${restaurants.id} END`,
          })
          .where(
            eq(restaurants.id, existingOrder.restaurantId),
          ) as BatchItem<"sqlite">;

      const writeStatements: BatchItem<"sqlite">[] = [
        this.db
          .update(orders)
          .set({
            subtotalCents: totals.subtotalCents,
            taxAmountCents: totals.taxAmountCents,
            serviceChargeCents: totals.serviceChargeCents,
            totalAmountCents,
            version: sql`${orders.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(orders.id, orderId),
              eq(orders.version, observedVersion),
              inArray(orders.status, [
                ORDER_STATUS.PENDING,
                ORDER_STATUS.CONFIRMED,
              ]),
            ),
          )
          .returning({ id: orders.id }),
        sentinel(),
      ];

      writeStatements.push(
        newQuantity === 0
          ? (this.db
              .delete(orderItems)
              .where(
                and(
                  eq(orderItems.id, orderItemId),
                  eq(orderItems.orderId, orderId),
                ),
              ) as BatchItem<"sqlite">)
          : (this.db
              .update(orderItems)
              .set({
                quantity: newQuantity,
                totalPriceCents: unitPriceCents * newQuantity,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(orderItems.id, orderItemId),
                  eq(orderItems.orderId, orderId),
                ),
              ) as BatchItem<"sqlite">),
      );

      // Signed, so one statement covers both directions: a positive delta
      // consumes stock, a negative one puts it back. orderCount is floored
      // because it is a lifetime popularity counter, not a balance.
      writeStatements.push(
        this.db
          .update(menuItems)
          .set({
            inventoryCount: sql`CASE WHEN ${menuItems.inventoryCount} IS NULL THEN NULL ELSE ${menuItems.inventoryCount} - ${delta} END`,
            orderCount: sql`MAX(0, ${menuItems.orderCount} + ${delta})`,
          })
          .where(
            and(
              eq(menuItems.id, target.menuItemId),
              // Only an increase can run the shelf empty; a decrease has no
              // stock precondition to meet.
              delta > 0
                ? sql`(${menuItems.inventoryCount} IS NULL OR ${menuItems.inventoryCount} >= ${delta})`
                : undefined,
            ),
          ),
      );
      if (delta > 0) {
        writeStatements.push(sentinel());
      }

      writeStatements.push(...ingredientWrites);

      try {
        const batchResults = await this.db.batch(
          writeStatements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
        );
        const advanced = batchResults[0] as Array<{ id: string }>;
        if (advanced.length === 0) {
          throw new Error("Order version conflict");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          /NOT NULL constraint failed: restaurants\.id/i.test(error.message)
        ) {
          // Two guards arm a sentinel: the CAS, and on an increase the stock
          // predicate. Re-read to report which one actually refused.
          const current = await this.db.query.orders.findFirst({
            where: eq(orders.id, orderId),
          });
          if (!current || current.version !== observedVersion) {
            throw new Error("Order version conflict");
          }
          throw new Error("Insufficient inventory for this quantity");
        }
        throw error;
      }

      const updatedOrder = await this.getOrder(orderId);
      if (!updatedOrder) {
        throw new Error("Order not found");
      }
      return updatedOrder;
    } catch (error) {
      this.handleError(error, "changeOrderItemQuantity");
    }
  }

  // 根據訂單號獲取訂單
  async getOrderByNumber(orderNumber: string): Promise<Order | null> {
    try {
      const order = await this.db.query.orders.findFirst({
        where: eq(orders.orderNumber, orderNumber),
        with: {
          restaurant: true,
          table: true,
          customer: true,
          items: {
            with: {
              menuItem: true,
            },
          },
        },
      });

      return order ? this.mapToOrder(order) : null;
    } catch (error) {
      this.handleError(error, "getOrderByNumber");
    }
  }

  // 獲取訂單列表
  async getOrders(
    filters: OrderFilters = {},
    page: number = 1,
    limit: number = 20,
  ) {
    try {
      const { offset } = this.createPagination(page, limit);
      const conditions = [];

      if (filters.restaurantId) {
        conditions.push(eq(orders.restaurantId, filters.restaurantId));
      }

      if (filters.tableId) {
        conditions.push(eq(orders.tableId, filters.tableId));
      }

      if (filters.customerId) {
        conditions.push(eq(orders.customerId, filters.customerId));
      }

      if (filters.orderType) {
        conditions.push(eq(orders.orderType, filters.orderType));
      }

      if (filters.fulfillmentType === "delivery") {
        conditions.push(
          sql`json_extract(${orders.deliveryInfo}, '$.type') = 'delivery'`,
        );
      } else if (filters.fulfillmentType === "takeaway") {
        conditions.push(
          or(
            sql`json_extract(${orders.deliveryInfo}, '$.type') = 'takeaway'`,
            eq(orders.orderType, "shop"),
          ),
        );
      } else if (filters.fulfillmentType === "dine_in") {
        conditions.push(
          or(
            sql`json_extract(${orders.deliveryInfo}, '$.type') = 'dine_in'`,
            inArray(orders.orderType, ["table", "seat"]),
          ),
        );
      }

      if (filters.orderSource) {
        conditions.push(eq(orders.orderSource, filters.orderSource));
      }

      if (filters.search) {
        const pattern = `%${filters.search}%`;
        conditions.push(
          or(
            like(orders.orderNumber, pattern),
            like(orders.notes, pattern),
            sql`json_extract(${orders.customerInfo}, '$.name') LIKE ${pattern}`,
          ),
        );
      }

      if (filters.status !== undefined && filters.status !== null) {
        if (Array.isArray(filters.status)) {
          // Handle status array with inArray
          conditions.push(inArray(orders.status, filters.status));
        } else {
          // Handle single status with eq
          conditions.push(eq(orders.status, filters.status));
        }
      }

      if (
        filters.paymentStatus !== undefined &&
        filters.paymentStatus !== null
      ) {
        conditions.push(
          Array.isArray(filters.paymentStatus)
            ? inArray(orders.paymentStatus, filters.paymentStatus)
            : eq(orders.paymentStatus, filters.paymentStatus),
        );
      }

      if (filters.dateRange) {
        const [startDate, endDate] = filters.dateRange;
        conditions.push(
          and(gte(orders.createdAt, startDate), lte(orders.createdAt, endDate)),
        );
      }

      if (filters.minAmount) {
        conditions.push(
          gte(orders.totalAmountCents, toRequiredCents(filters.minAmount)),
        );
      }

      if (filters.maxAmount) {
        conditions.push(
          lte(orders.totalAmountCents, toRequiredCents(filters.maxAmount)),
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const sortDirection = filters.sortOrder === "asc" ? asc : desc;
      const sortColumn =
        ORDER_SORT_COLUMNS[filters.sortBy ?? "createdAt"] ?? orders.createdAt;

      const orderList = await this.db.query.orders.findMany({
        where: whereClause,
        with: {
          restaurant: {
            columns: { id: true, name: true },
          },
          table: {
            columns: { id: true, number: true },
          },
          items: {
            with: {
              menuItem: {
                columns: orderMenuItemSummaryColumns,
              },
            },
          },
        },
        orderBy: sortDirection(sortColumn),
        limit,
        offset,
      });

      const countResult = await this.db
        .select({ totalCount: count() })
        .from(orders)
        .where(whereClause);

      const totalCount = countResult?.[0]?.totalCount ?? 0;

      return {
        orders: orderList.map((order) => this.mapToOrder(order)),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    } catch (error) {
      this.handleError(error, "getOrders");
    }
  }

  // 更新訂單狀態
  async updateOrderStatus(
    id: string,
    data: UpdateOrderStatusData,
  ): Promise<Order> {
    // Cancelling is not a status change -- it is a status change plus two
    // inventory restores plus a ledger entry. Doing it here with a bare UPDATE
    // left menu-item stock and ingredient stock deducted forever, with no way
    // back once the status was no longer cancellable (#282). Delegate rather
    // than reimplement: cancelWaitingListPreOrders proved that two copies of
    // "cancel" drift apart.
    //
    // Outside the try so cancelOrder's own handleError is not wrapped twice.
    if (data.status === ORDER_STATUS.CANCELLED) {
      return this.cancelOrder(id, data.notes, data.expectedVersion);
    }

    try {
      const statusField = `${data.status}At`;
      const updateData: Record<string, unknown> = {
        status: data.status,
        version: sql`${orders.version} + 1`,
        updatedAt: new Date(),
      };

      // 設置狀態時間戳
      if (
        [
          "confirmed",
          "preparing",
          "ready",
          "delivered",
          "paid",
          "cancelled",
        ].includes(data.status)
      ) {
        updateData[statusField] = new Date();
      }

      // 添加備註
      if (data.notes) {
        updateData.internalNotes = data.notes;
      }

      const [order] = await this.db
        .update(orders)
        .set(updateData)
        .where(
          data.expectedVersion == null
            ? eq(orders.id, id)
            : and(eq(orders.id, id), eq(orders.version, data.expectedVersion)),
        )
        .returning();

      if (!order) {
        if (data.expectedVersion != null) {
          throw new Error("Order version conflict");
        }
        throw new Error("Order not found");
      }

      // 如果訂單完成，釋放桌子（僅限有桌號的訂單）
      if (
        (data.status === ORDER_STATUS.PAID ||
          data.status === ORDER_STATUS.DELIVERED) &&
        order.tableId
      ) {
        await this.db
          .update(tables)
          .set({
            isOccupied: false,
            currentOrderId: null,
            occupiedAt: null,
            occupiedBy: null,
          })
          .where(eq(tables.id, order.tableId));
      }

      await this.recomputeMemberProjection(order);

      return this.mapToOrder(order);
    } catch (error) {
      this.handleError(error, "updateOrderStatus");
    }
  }

  async claimDelivery(id: string, userId: string): Promise<Order | null> {
    const now = new Date();
    const [order] = await this.db
      .update(orders)
      .set({
        deliveryAssignedTo: userId,
        deliveryStartTime: now,
        version: sql`${orders.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.status, ORDER_STATUS.READY),
          isNull(orders.deliveryAssignedTo),
        ),
      )
      .returning();

    return order ? this.mapToOrder(order) : null;
  }

  // 取消訂單
  async cancelOrder(
    id: string,
    reason?: string,
    expectedVersion?: number,
  ): Promise<Order> {
    try {
      const order = await this.getOrder(id);
      if (!order) {
        throw new Error("Order not found");
      }

      if (!cancellableOrderStatuses.includes(order.status)) {
        throw new Error("Order cannot be cancelled");
      }

      const now = new Date();

      // Build the inverse ingredient writes before the CAS, but execute them
      // only after the CAS and its immediate assertion in the same D1 batch.
      // The ledger (not the live recipe) is the source of truth for restores.
      const ingredientConsumption = new IngredientConsumptionService(this.db);
      const ingredientRestoreWrites =
        await ingredientConsumption.buildRestoreWritesForOrder(
          order.restaurantId,
          id,
        );
      const observedVersion = order.version ?? 0;

      const writeStatements: BatchItem<"sqlite">[] = (order.items || []).map(
        (item) =>
          this.db
            .update(menuItems)
            .set({
              inventoryCount: sql`CASE WHEN ${menuItems.inventoryCount} IS NULL THEN NULL ELSE ${menuItems.inventoryCount} + ${item.quantity} END`,
            })
            .where(
              and(
                eq(menuItems.id, item.menuItemId),
                // The CAS/sentinel below is first in the batch. Its success
                // is the authorization for every dependent restore.
                sql`1 = 1`,
              ),
            ),
      );

      writeStatements.unshift(
        this.db
          .update(orders)
          .set({
            status: ORDER_STATUS.CANCELLED,
            // 內部備註，不是顧客備註 —— 後者存的是「不要香菜」這類顧客自己
            // 寫的內容，被取消原因蓋掉就永遠找不回來了。
            internalNotes: reason,
            cancelledAt: now,
            updatedAt: now,
            version: sql`${orders.version} + 1`,
          })
          .where(
            and(
              eq(orders.id, id),
              eq(orders.version, observedVersion),
              inArray(orders.status, [...cancellableOrderStatuses]),
              expectedVersion == null
                ? undefined
                : eq(orders.version, expectedVersion),
            ),
          )
          .returning({ id: orders.id }),
        // Keep this immediately after the CAS. `changes()` observes that
        // statement only; stale requests set the parent PK to NULL and force
        // SQLite/D1 to roll back the entire batch before any restore runs.
        this.db
          .update(restaurants)
          .set({
            id: sql<string>`CASE WHEN changes() = 0 THEN NULL ELSE ${restaurants.id} END`,
          })
          .where(eq(restaurants.id, order.restaurantId)) as BatchItem<"sqlite">,
      );
      writeStatements.push(...ingredientRestoreWrites);

      let batchResults: unknown[];
      try {
        batchResults = await this.db.batch(
          writeStatements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
        );
      } catch (error) {
        if (
          error instanceof Error &&
          /NOT NULL constraint failed: restaurants\.id/i.test(error.message)
        ) {
          if (expectedVersion != null) {
            const current = await this.getOrder(id);
            if (
              current &&
              cancellableOrderStatuses.includes(current.status) &&
              current.version !== expectedVersion
            ) {
              throw new Error("Order version conflict");
            }
          }
          throw new Error("Order cannot be cancelled");
        }
        throw error;
      }
      const cancelledRows = batchResults[0] as Array<{ id: string }>;
      if (cancelledRows.length === 0) {
        // Two different conflicts land here and the API maps them to two
        // different codes (ORDER_VERSION_CONFLICT vs ORDER_NOT_CANCELLABLE),
        // so tell them apart rather than collapsing both into "not
        // cancellable". Re-reading after the fact is only for the message; the
        // authoritative decision was the conditional UPDATE above.
        if (expectedVersion != null) {
          const current = await this.getOrder(id);
          if (
            current &&
            cancellableOrderStatuses.includes(current.status) &&
            current.version !== expectedVersion
          ) {
            throw new Error("Order version conflict");
          }
        }
        throw new Error("Order cannot be cancelled");
      }

      const cancelledOrder = await this.getOrder(id);
      if (!cancelledOrder) {
        throw new Error("Order not found");
      }
      await this.recomputeMemberProjection(cancelledOrder);
      return cancelledOrder;
    } catch (error) {
      this.handleError(error, "cancelOrder");
    }
  }

  /** Projection failures must not turn an already-committed order into a retry. */
  private async recomputeMemberProjection(order: {
    restaurantId: string;
    customerId?: string | null;
  }) {
    if (!order.customerId) return;
    try {
      await new TenantMemberDirectoryService(
        this.d1,
        this.env,
      ).recomputeForCustomer(
        { restaurantId: order.restaurantId },
        order.customerId,
      );
    } catch (error) {
      console.error("Member projection recompute failed", {
        restaurantId: order.restaurantId,
        customerId: order.customerId,
        error,
      });
    }
  }

  // 獲取餐廳當日訂單統計
  async getOrderStatistics(restaurantId: string) {
    try {
      const stats = await this.db
        .select({
          totalOrders: count(),
          totalRevenue: sql<number>`COALESCE(SUM(COALESCE(${orders.totalAmountCents}, 0)) / 100.0, 0)`,
          avgOrderValue: sql<number>`COALESCE(AVG(COALESCE(${orders.totalAmountCents}, 0)) / 100.0, 0)`,
          pendingOrders: sql<number>`SUM(CASE WHEN ${orders.status} = 'pending' THEN 1 ELSE 0 END)`,
          preparingOrders: sql<number>`SUM(CASE WHEN ${orders.status} IN ('confirmed', 'preparing', 'ready') THEN 1 ELSE 0 END)`,
          completedOrders: sql<number>`SUM(CASE WHEN ${orders.status} IN ('delivered', 'paid') THEN 1 ELSE 0 END)`,
          cancelledOrders: sql<number>`SUM(CASE WHEN ${orders.status} = 'cancelled' THEN 1 ELSE 0 END)`,
        })
        .from(orders)
        .where(eq(orders.restaurantId, restaurantId));

      return (
        stats[0] ?? {
          totalOrders: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
          pendingOrders: 0,
          preparingOrders: 0,
          completedOrders: 0,
          cancelledOrders: 0,
        }
      );
    } catch (error) {
      this.handleError(error, "getOrderStatistics");
    }
  }

  async getDailyOrderStats(restaurantId: string, date: Date = new Date()) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const stats = await this.db
        .select({
          totalOrders: count(),
          totalRevenue: sql<number>`SUM(COALESCE(${orders.totalAmountCents}, 0)) / 100.0`,
          avgOrderValue: sql<number>`AVG(COALESCE(${orders.totalAmountCents}, 0)) / 100.0`,
          pendingOrders: sql<number>`SUM(CASE WHEN ${orders.status} = 'pending' THEN 1 ELSE 0 END)`,
          confirmedOrders: sql<number>`SUM(CASE WHEN ${orders.status} = 'confirmed' THEN 1 ELSE 0 END)`,
          completedOrders: sql<number>`SUM(CASE WHEN ${orders.status} IN ('delivered', 'paid') THEN 1 ELSE 0 END)`,
          cancelledOrders: sql<number>`SUM(CASE WHEN ${orders.status} = 'cancelled' THEN 1 ELSE 0 END)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            gte(orders.createdAt, startOfDay),
            lte(orders.createdAt, endOfDay),
          ),
        );

      return (
        stats[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
          pendingOrders: 0,
          confirmedOrders: 0,
          completedOrders: 0,
          cancelledOrders: 0,
        }
      );
    } catch (error) {
      this.handleError(error, "getDailyOrderStats");
    }
  }

  // 更新訂單項目狀態 — Drizzle-based CAS: matches row only when the
  // current status differs from the target, preventing two chefs from
  // completing the same item in parallel (H2 release gate).
  async updateOrderItemStatus(
    itemId: number,
    status: string,
    notes?: string,
  ): Promise<void> {
    try {
      const now = new Date();
      const updateData: Partial<typeof orderItems.$inferInsert> = {
        status,
        updatedAt: now,
      };
      if (notes) {
        updateData.kitchenNotes = notes;
      }
      if (status === "ready" || status === "completed") {
        updateData.preparedAt = now;
      }
      if (status === "served") {
        updateData.servedAt = now;
      }
      if (status === "cancelled") {
        updateData.cancelledAt = now;
      }

      const updated = await this.db
        .update(orderItems)
        .set(updateData)
        .where(and(eq(orderItems.id, itemId), ne(orderItems.status, status)))
        .returning({ id: orderItems.id });

      if (updated.length === 0) {
        throw new Error("Order item status conflict");
      }
    } catch (error) {
      this.handleError(error, "updateOrderItemStatus");
    }
  }

  private async prepareOrderItems(items: CreateOrderData["items"]): Promise<{
    subtotalCents: number;
    orderItemsData: PreparedOrderItem[];
    menuItemMap: Map<number, MenuItemRecord>;
  }> {
    let subtotalCents = 0;
    const orderItemsData: PreparedOrderItem[] = [];

    const menuItemIds = items.map((item) => item.menuItemId);
    const fetchedMenuItems = await this.db.query.menuItems.findMany({
      where: inArray(menuItems.id, menuItemIds),
    });
    const assembledOptions = await loadAssembledMenuItemOptions(
      this.db,
      fetchedMenuItems,
    );
    const menuItemMap = new Map(
      fetchedMenuItems.map((item) => [
        item.id,
        { ...item, options: assembledOptions.get(item.id) },
      ]),
    );
    const requestedQuantities = new Map<number, number>();

    for (const item of items) {
      const menuItem = menuItemMap.get(item.menuItemId);

      if (!menuItem || !menuItem.isAvailable) {
        throw new Error(`Menu item ${item.menuItemId} is not available`);
      }

      const requestedTotal =
        (requestedQuantities.get(item.menuItemId) ?? 0) + item.quantity;
      requestedQuantities.set(item.menuItemId, requestedTotal);
      if (
        menuItem.inventoryCount !== null &&
        menuItem.inventoryCount < requestedTotal
      ) {
        throw new Error(`Insufficient inventory for ${menuItem.name}`);
      }

      let unitPriceCents = resolveMoneyCents(
        menuItem.priceCents,
        `Menu item ${menuItem.id} price`,
      );
      const { customizations, additionalUnitPriceCents } =
        resolveCatalogCustomizations(menuItem, item.customizations);
      unitPriceCents += additionalUnitPriceCents;

      const totalPriceCents = unitPriceCents * item.quantity;
      const unitPrice = fromCents(unitPriceCents);
      const totalPrice = fromCents(totalPriceCents);
      subtotalCents += totalPriceCents;

      orderItemsData.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        unitPriceCents,
        totalPriceCents,
        customizations,
        notes: item.notes,
        itemSnapshot: {
          name: menuItem.name,
          description: menuItem.description || undefined,
          imageUrl: menuItem.imageUrl || undefined,
          category: String(menuItem.categoryId),
          price: amountFromCents(menuItem.priceCents) ?? 0,
          unitPrice,
          customizations,
        },
      });
    }

    return { subtotalCents, orderItemsData, menuItemMap };
  }

  // 計算預估準備時間
  private calculateEstimatedPrepTime(orderItems: PrepTimeOrderItem[]): number {
    let maxPrepTime = 0;
    let totalComplexity = 0;

    for (const item of orderItems) {
      // 基礎準備時間（預設 15 分鐘）
      const basePrepTime = 15;

      // 根據客製化增加時間
      let itemComplexity = 1;
      const customizations = item.customizations;
      if (customizations?.options?.length) {
        itemComplexity += customizations.options.length * 0.2;
      }
      if (customizations?.addOns?.length) {
        itemComplexity += customizations.addOns.length * 0.1;
      }

      const itemPrepTime = basePrepTime * itemComplexity * item.quantity;
      maxPrepTime = Math.max(maxPrepTime, itemPrepTime);
      totalComplexity += itemComplexity;
    }

    // 綜合計算：取最長時間和平均複雜度的平衡
    return Math.ceil(Math.max(maxPrepTime, totalComplexity * 10));
  }

  private toOrderItemInsert(item: PreparedOrderItem) {
    const { unitPrice, totalPrice, ...insertItem } = item;
    void unitPrice;
    void totalPrice;
    return insertItem;
  }

  // 資料轉換
  private mapToOrder(order: OrderWithRelations): Order {
    const mapOrderItem = (item: OrderItemWithRelations): OrderItem => {
      const snapshot = item.itemSnapshot ?? undefined;
      const menuItem = item.menuItem ?? undefined;
      const snapshotMenuItem = snapshot
        ? {
            ...(menuItem ?? { id: item.menuItemId }),
            name: snapshot.name,
            description: snapshot.description,
            imageUrl: snapshot.imageUrl,
            price: snapshot.price ?? amountFromCents(item.unitPriceCents) ?? 0,
          }
        : menuItem;

      return {
        id: item.id,
        orderId: item.orderId,
        menuItemId: item.menuItemId,
        name: snapshot?.name ?? menuItem?.name,
        description:
          snapshot?.description ?? menuItem?.description ?? undefined,
        imageUrl: snapshot?.imageUrl ?? menuItem?.imageUrl ?? undefined,
        quantity: item.quantity,
        unitPrice: amountFromCents(item.unitPriceCents) ?? 0,
        totalPrice: amountFromCents(item.totalPriceCents) ?? 0,
        customizations: item.customizations ?? undefined,
        itemSnapshot: snapshot,
        notes: item.notes ?? undefined,
        status: toOrderItemStatus(item.status),
        menuItem: snapshotMenuItem,
        createdAt: toMillis(item.createdAt)!,
        updatedAt: toMillis(item.updatedAt)!,
      };
    };

    return {
      id: order.id,
      restaurantId: order.restaurantId,
      tableId: order.tableId ?? undefined,
      customerId: order.customerId ?? undefined,
      waitingListId: order.waitingListId ?? undefined,
      orderNumber: order.orderNumber,
      orderType: order.orderType ?? undefined,
      status: toOrderStatus(order.status),
      version: order.version,
      orderSource: order.orderSource ?? undefined,
      // The *_cents columns are nullable; an order that never had an amount
      // written reads as 0 rather than as a null masquerading as a number.
      subtotal: amountFromCents(order.subtotalCents) ?? 0,
      taxAmount: amountFromCents(order.taxAmountCents) ?? undefined,
      serviceCharge: amountFromCents(order.serviceChargeCents) ?? undefined,
      discountAmount: amountFromCents(order.discountAmountCents) ?? undefined,
      totalAmount: amountFromCents(order.totalAmountCents) ?? 0,
      customerInfo: order.customerInfo ?? undefined,
      estimatedPrepTime: order.estimatedPrepTime ?? undefined,
      actualPrepTime: order.actualPrepTime ?? undefined,
      confirmedAt: toMillis(order.confirmedAt),
      preparingAt: toMillis(order.preparingAt),
      readyAt: toMillis(order.readyAt),
      deliveredAt: toMillis(order.deliveredAt),
      deliveryAssignedTo: order.deliveryAssignedTo ?? undefined,
      deliveryStartTime: toMillis(order.deliveryStartTime),
      paidAt: toMillis(order.paidAt),
      cancelledAt: toMillis(order.cancelledAt),
      paymentMethod: toOrderPaymentMethod(order.paymentMethod),
      paymentStatus: toOrderPaymentStatus(order.paymentStatus),
      paymentTransactionId: order.paymentTransactionId ?? undefined,
      rating: order.rating ?? undefined,
      reviewComment: order.reviewComment ?? undefined,
      notes: order.notes ?? undefined,
      internalNotes: order.internalNotes ?? undefined,
      deliveryInfo: order.deliveryInfo ?? undefined,
      items: order.items?.map(mapOrderItem) || [],
      restaurant: order.restaurant ?? undefined,
      table: order.table ?? undefined,
      // `customers.display_name` / `primary_phone` are the columns the relation
      // selects; CustomerProfile names them fullName / phone, so consumers
      // reading `order.customer.fullName` used to always see undefined.
      customer: order.customer
        ? {
            id: order.customer.id,
            fullName: order.customer.displayName,
            phone: order.customer.primaryPhone ?? undefined,
          }
        : undefined,
      createdAt: toMillis(order.createdAt)!,
      updatedAt: toMillis(order.updatedAt)!,
    };
  }
}
