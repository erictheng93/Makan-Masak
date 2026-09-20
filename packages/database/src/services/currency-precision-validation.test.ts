/**
 * Money input must sit on the restaurant currency's real precision: a TWD
 * restaurant cannot price anything at NT$12.50, an MYR one can price RM12.50.
 * Real D1, because the currency comes from the restaurant row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  categories,
  coupons,
  menuItems,
  optionChoices,
  optionGroups,
  orders,
  restaurants,
} from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { CouponService } from "./coupon";
import { MenuService } from "./menu";
import { OrderService } from "./order";
import { RestaurantService } from "./restaurant";

const twdId = "restaurant-twd";
const myrId = "restaurant-myr";
const env = { JWT_SECRET: "test" };

const precisionError = (fields: Array<{ field: string; amount: number }>) =>
  expect.objectContaining({
    code: "CURRENCY_PRECISION",
    status: 400,
    details: expect.objectContaining({ fields }),
  });

describe("currency precision validation", () => {
  let testDb: TestDatabase;
  const categoryIds: Record<string, number> = {};

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    for (const [id, currency] of [
      [twdId, "TWD"],
      [myrId, "MYR"],
    ] as const) {
      await testDb.drizzle.insert(restaurants).values({
        id,
        name: `${currency} Restaurant`,
        type: "restaurant",
        category: "casual",
        address: "1 Test St",
        district: "Test District",
        city: "Test City",
        phone: "0912345678",
        isAvailable: true,
        settings: { currency, deliveryFee: 30 },
      });
      const [category] = await testDb.drizzle
        .insert(categories)
        .values({ restaurantId: id, name: "Meals", sortOrder: 1 })
        .returning({ id: categories.id });
      categoryIds[id] = category.id;
    }
  });

  const menu = () => new MenuService(testDb.bindings.DB, env);
  const couponService = () => new CouponService(testDb.bindings.DB, env);
  const restaurantService = () =>
    new RestaurantService(testDb.bindings.DB, env);

  describe("menu items", () => {
    it("rejects a NT$12.50 price for a TWD restaurant", async () => {
      await expect(
        menu().createMenuItem({
          restaurantId: twdId,
          categoryId: categoryIds[twdId],
          name: "Tea",
          price: 12.5,
        }),
      ).rejects.toEqual(precisionError([{ field: "price", amount: 12.5 }]));
      expect(await testDb.drizzle.select().from(menuItems)).toHaveLength(0);
    });

    it("accepts RM12.50 for an MYR restaurant", async () => {
      const item = await menu().createMenuItem({
        restaurantId: myrId,
        categoryId: categoryIds[myrId],
        name: "Teh",
        price: 12.5,
        originalPrice: 15.5,
      });
      expect(item.price).toBe(12.5);
    });

    it("names every fractional field, including legacy option prices", async () => {
      await expect(
        menu().createMenuItem({
          restaurantId: twdId,
          categoryId: categoryIds[twdId],
          name: "Rice",
          price: 100,
          originalPrice: 120.5,
          options: {
            sizes: [{ id: "l", name: "Large", priceAdjustment: 10.5 }],
            customizations: [
              {
                id: "spice",
                name: "Spice",
                type: "single",
                required: false,
                choices: [{ id: "hot", name: "Hot", priceAdjustment: 5 }],
              },
            ],
            addOns: [{ id: "egg", name: "Egg", price: 0.5 }],
          },
        }),
      ).rejects.toEqual(
        precisionError([
          { field: "originalPrice", amount: 120.5 },
          { field: "options.sizes[0].priceAdjustment", amount: 10.5 },
          { field: "options.addOns[0].price", amount: 0.5 },
        ]),
      );
    });

    it("validates updates, bulk creates and batch price changes", async () => {
      const item = await menu().createMenuItem({
        restaurantId: twdId,
        categoryId: categoryIds[twdId],
        name: "Noodles",
        price: 100,
      });

      await expect(
        menu().updateMenuItem(item.id, { price: 99.5 }),
      ).rejects.toEqual(precisionError([{ field: "price", amount: 99.5 }]));
      await expect(
        menu().bulkCreateMenuItems([
          {
            restaurantId: twdId,
            categoryId: categoryIds[twdId],
            name: "A",
            price: 10,
          },
          {
            restaurantId: twdId,
            categoryId: categoryIds[twdId],
            name: "B",
            price: 10.1,
          },
        ]),
      ).rejects.toEqual(
        precisionError([{ field: "items[1].price", amount: 10.1 }]),
      );
      await expect(
        menu().batchUpdatePricesScoped(twdId, [
          { id: item.id, price: 80, originalPrice: 90.9 },
        ]),
      ).rejects.toEqual(
        precisionError([{ field: "updates[0].originalPrice", amount: 90.9 }]),
      );

      const [row] = await testDb.drizzle
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, item.id));
      expect(row.priceCents).toBe(10000);
    });

    it("validates option choice and override price adjustments", async () => {
      const item = await menu().createMenuItem({
        restaurantId: twdId,
        categoryId: categoryIds[twdId],
        name: "Soup",
        price: 100,
      });
      const [group] = await testDb.drizzle
        .insert(optionGroups)
        .values({
          id: "group-size",
          restaurantId: twdId,
          publicId: "size",
          kind: "size",
          name: "Size",
          type: "single",
        })
        .returning();

      await expect(
        menu().createOptionChoice({
          id: "choice-large-bad",
          groupId: group.id,
          publicId: "large",
          name: "Large",
          priceAdjustmentCents: 1050,
        }),
      ).rejects.toEqual(
        precisionError([{ field: "priceAdjustment", amount: 10.5 }]),
      );

      const choice = await menu().createOptionChoice({
        id: "choice-large",
        groupId: group.id,
        publicId: "large",
        name: "Large",
        priceAdjustmentCents: 1000,
      });
      await expect(
        menu().updateOptionChoice(choice.id, { priceAdjustmentCents: 550 }),
      ).rejects.toEqual(
        precisionError([{ field: "priceAdjustment", amount: 5.5 }]),
      );
      await expect(
        menu().upsertMenuItemOptionChoiceOverride({
          menuItemId: item.id,
          choiceId: choice.id,
          priceAdjustmentCents: 250,
        }),
      ).rejects.toEqual(
        precisionError([{ field: "priceAdjustment", amount: 2.5 }]),
      );

      await expect(
        menu().replaceMenuItemOptionGroups(item.id, [
          {
            groupId: group.id,
            choiceOverrides: [
              { choiceId: choice.id, priceAdjustmentCents: 350 },
            ],
          },
        ]),
      ).rejects.toEqual(
        precisionError([
          {
            field: "groups[0].choiceOverrides[0].priceAdjustment",
            amount: 3.5,
          },
        ]),
      );

      const [stored] = await testDb.drizzle
        .select()
        .from(optionChoices)
        .where(eq(optionChoices.id, choice.id));
      expect(stored.priceAdjustmentCents).toBe(1000);
    });
  });

  describe("coupons", () => {
    const baseCoupon = {
      code: "SAVE",
      name: "Save",
      validFrom: new Date("2020-01-01T00:00:00.000Z"),
      validTo: new Date("2099-12-31T00:00:00.000Z"),
    };

    it("rejects fractional TWD fixed amounts, cap and minimum", async () => {
      await expect(
        couponService().createCoupon({
          ...baseCoupon,
          restaurantId: twdId,
          discountType: "fixed",
          discountValue: 12.5,
          minOrderAmount: 100.5,
        }),
      ).rejects.toEqual(
        precisionError([
          { field: "discountValue", amount: 12.5 },
          { field: "minOrderAmount", amount: 100.5 },
        ]),
      );
      await expect(
        couponService().createCoupon({
          ...baseCoupon,
          restaurantId: twdId,
          discountType: "percentage",
          discountValue: 12.5,
          maxDiscountAmount: 20.5,
        }),
      ).rejects.toEqual(
        precisionError([{ field: "maxDiscountAmount", amount: 20.5 }]),
      );
      expect(await testDb.drizzle.select().from(coupons)).toHaveLength(0);
    });

    it("accepts a 12.5% coupon for TWD and sen amounts for MYR", async () => {
      await expect(
        couponService().createCoupon({
          ...baseCoupon,
          restaurantId: twdId,
          discountType: "percentage",
          discountValue: 12.5,
        }),
      ).resolves.toMatchObject({ discountValue: 12.5 });
      await expect(
        couponService().createCoupon({
          ...baseCoupon,
          restaurantId: myrId,
          discountType: "fixed",
          discountValue: 2.5,
        }),
      ).resolves.toMatchObject({ discountValue: 2.5 });
    });

    it("refuses a percentage above 100 on create and on update", async () => {
      await expect(
        couponService().createCoupon({
          ...baseCoupon,
          restaurantId: twdId,
          discountType: "percentage",
          discountValue: 150,
        }),
      ).rejects.toMatchObject({ code: "INVALID_DISCOUNT_VALUE", status: 400 });

      const coupon = await couponService().createCoupon({
        ...baseCoupon,
        restaurantId: twdId,
        discountType: "percentage",
        discountValue: 10,
      });
      await expect(
        couponService().updateCoupon(coupon.id, { discountValue: 101 }),
      ).rejects.toMatchObject({ code: "INVALID_DISCOUNT_VALUE" });
    });

    it("validates updates against the coupon's restaurant", async () => {
      const coupon = await couponService().createCoupon({
        ...baseCoupon,
        restaurantId: twdId,
        discountType: "fixed",
        discountValue: 20,
      });

      await expect(
        couponService().updateCoupon(coupon.id, { discountValue: 19.9 }),
      ).rejects.toEqual(
        precisionError([{ field: "discountValue", amount: 19.9 }]),
      );
      await expect(
        couponService().updateCoupon(coupon.id, { minOrderAmount: 50 }),
      ).resolves.toMatchObject({ minOrderAmount: 50 });
    });

    it("leaves platform-wide coupons to redemption-time flooring", async () => {
      await expect(
        couponService().createCoupon({
          ...baseCoupon,
          discountType: "fixed",
          discountValue: 2.5,
        }),
      ).resolves.toMatchObject({ discountValue: 2.5 });
    });
  });

  describe("restaurant settings", () => {
    it("rejects a fractional TWD delivery fee or minimum order", async () => {
      await expect(
        restaurantService().updateRestaurant(twdId, {
          settings: { deliveryFee: 30.5, minOrderAmount: 99.5 },
        }),
      ).rejects.toEqual(
        precisionError([
          { field: "settings.minOrderAmount", amount: 99.5 },
          { field: "settings.deliveryFee", amount: 30.5 },
        ]),
      );
    });

    it("accepts sen for MYR", async () => {
      await expect(
        restaurantService().updateRestaurant(myrId, {
          settings: { deliveryFee: 3.5 },
        }),
      ).resolves.toMatchObject({ id: myrId });
    });

    it("validates against the currency in the same request", async () => {
      // Switching to MYR in the same request makes RM3.50 valid.
      await expect(
        restaurantService().updateRestaurant(twdId, {
          settings: { currency: "MYR", deliveryFee: 3.5 },
        }),
      ).resolves.toMatchObject({ id: twdId });

      // Switching an MYR restaurant with a stored RM3.50 fee to TWD is not.
      await expect(
        restaurantService().updateRestaurant(twdId, {
          settings: { currency: "TWD" },
        }),
      ).rejects.toEqual(
        precisionError([{ field: "settings.deliveryFee", amount: 3.5 }]),
      );
    });

    it("ignores settings updates that touch no money", async () => {
      await testDb.drizzle
        .update(restaurants)
        .set({ settings: { currency: "TWD", deliveryFee: 30.5 } })
        .where(eq(restaurants.id, twdId));

      // A legacy fractional fee already on file does not block unrelated edits.
      await expect(
        restaurantService().updateRestaurant(twdId, {
          settings: { enableDelivery: true },
        }),
      ).resolves.toMatchObject({ id: twdId });
    });

    it("validates settings on create", async () => {
      await expect(
        restaurantService().createRestaurant({
          name: "New",
          type: "restaurant",
          category: "casual",
          address: "2 Test St",
          district: "Test District",
          phone: "0912345678",
          settings: { currency: "VND", deliveryFee: 15000.5 },
        } as never),
      ).rejects.toEqual(
        precisionError([{ field: "settings.deliveryFee", amount: 15000.5 }]),
      );
    });
  });
  /**
   * `settings.currency` is a zod enum on write, so an unsupported value can
   * only come from a legacy row. It used to default to TWD everywhere the
   * database package read it, which is how a restaurant configured in ringgit
   * ended up taking orders priced on the TWD step that the payment side —
   * always strict — then refused. The two policies now differ on purpose:
   * money refuses, display falls back.
   */
  describe("a legacy unsupported currency", () => {
    const legacyId = "restaurant-legacy-currency";
    let legacyMenuItemId: number;

    beforeEach(async () => {
      await testDb.drizzle.insert(restaurants).values({
        id: legacyId,
        name: "Legacy Restaurant",
        type: "restaurant",
        category: "casual",
        address: "3 Test St",
        district: "Test District",
        city: "Test City",
        phone: "0912345678",
        isAvailable: true,
        // "RM" is the ringgit's symbol, not its ISO code — exactly the kind of
        // value an older admin build let through.
        settings: { currency: "RM" },
      });
      const [category] = await testDb.drizzle
        .insert(categories)
        .values({ restaurantId: legacyId, name: "Meals", sortOrder: 1 })
        .returning({ id: categories.id });
      // Inserted directly: the menu service refuses this restaurant too.
      const [item] = await testDb.drizzle
        .insert(menuItems)
        .values({
          restaurantId: legacyId,
          categoryId: category.id,
          name: "Legacy Dish",
          price: 100,
          priceCents: 10000,
          isAvailable: true,
        } as never)
        .returning({ id: menuItems.id });
      legacyMenuItemId = item.id;
    });

    const currencyError = expect.objectContaining({
      code: "RESTAURANT_CURRENCY_INVALID",
      status: 500,
    });

    it("refuses to price an order instead of writing an uncollectable one", async () => {
      await expect(
        new OrderService(testDb.bindings.DB, env).createOrder({
          restaurantId: legacyId,
          items: [{ menuItemId: legacyMenuItemId, quantity: 1 }],
        }),
      ).rejects.toEqual(currencyError);
      expect(await testDb.drizzle.select().from(orders)).toHaveLength(0);
    });

    it("refuses a menu price write that needs to know the currency", async () => {
      // A whole-unit price is valid in every supported currency, so the write
      // path never looks one up (`isAlignedInEveryCurrency`) and stays
      // allowed. A fractional one does have to ask, and asking now refuses
      // instead of answering TWD.
      await expect(
        menu().updateMenuItem(legacyMenuItemId, { price: 120 }),
      ).resolves.toMatchObject({ price: 120 });
      await expect(
        menu().updateMenuItem(legacyMenuItemId, { price: 120.5 }),
      ).rejects.toEqual(currencyError);
    });

    it("still labels a read-only order listing rather than failing it", async () => {
      // A customer's order history spans restaurants; a 500 there would take
      // the whole page down over one merchant's broken JSON, and a label
      // cannot become a charge.
      await testDb.drizzle.insert(orders).values({
        id: "order-legacy-1",
        restaurantId: legacyId,
        orderNumber: "LEGACY-1",
        totalAmountCents: 10000,
        subtotalCents: 10000,
      } as never);

      const listed = await new OrderService(testDb.bindings.DB, env).getOrders({
        restaurantId: legacyId,
      });
      expect(listed.orders).toHaveLength(1);
      expect(listed.orders[0].currency).toBe("TWD");
    });
  });
});
