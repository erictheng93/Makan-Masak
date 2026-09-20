import { describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { restaurants } from "../schema";
import { RestaurantService } from "./restaurant";

function createServiceWithDb<TDb extends object>(
  db: TDb,
  env: Record<string, unknown> = {},
): RestaurantService {
  const service = new RestaurantService({} as D1Database, {
    JWT_SECRET: "test",
    ...env,
  });
  (service as unknown as { db: TDb }).db = db;
  return service;
}

describe("RestaurantService.updateRestaurant", () => {
  it("merges settings updates with existing persisted settings", async () => {
    const capturedSet: Record<string, unknown>[] = [];
    const updateBuilder = {
      set: vi.fn((values: Record<string, unknown>) => {
        capturedSet.push(values);
        return updateBuilder;
      }),
      where: vi.fn(() => updateBuilder),
      returning: vi.fn(async () => [
        {
          id: "restaurant-1",
          name: "Makan",
          type: "malaysian",
          category: "casual",
          address: "Main Street",
          district: "Central",
          city: "Taipei",
          phone: "0912345678",
          isActive: true,
          settings: {
            allowGuestOrders: true,
            currency: "TWD",
            enableTakeaway: true,
            minOrderAmount: 300,
          },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ]),
    };
    const db = {
      query: {
        restaurants: {
          findFirst: vi.fn(async () => ({
            settings: {
              allowGuestOrders: true,
              currency: "TWD",
              enableTakeaway: false,
            },
          })),
        },
      },
      select: vi.fn(() => {
        const builder = {
          from: vi.fn(() => builder),
          where: vi.fn(() => builder),
        };
        return builder;
      }),
      update: vi.fn(() => updateBuilder),
    };
    const service = createServiceWithDb(db);

    await service.updateRestaurant("restaurant-1", {
      settings: {
        enableTakeaway: true,
        minOrderAmount: 300,
      },
    });

    expect(db.query.restaurants.findFirst).toHaveBeenCalledOnce();
    expect(db.update).toHaveBeenCalledWith(restaurants);
    expect(capturedSet[0].settings).toEqual({
      allowGuestOrders: true,
      currency: "TWD",
      enableTakeaway: true,
      minOrderAmount: 300,
    });
  });

  it("preserves currency from legacy double-encoded settings", async () => {
    const capturedSet: Record<string, unknown>[] = [];
    const updateBuilder = {
      set: vi.fn((values: Record<string, unknown>) => {
        capturedSet.push(values);
        return updateBuilder;
      }),
      where: vi.fn(() => updateBuilder),
      returning: vi.fn(async () => [
        {
          id: "restaurant-1",
          name: "Makan",
          type: "malaysian",
          category: "casual",
          address: "Main Street",
          district: "Central",
          city: "Taipei",
          phone: "0912345678",
          isActive: true,
          settings: { currency: "MYR", allowGuestOrders: false },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ]),
    };
    const db = {
      query: {
        restaurants: {
          findFirst: vi.fn(async () => ({
            settings: JSON.stringify({
              currency: "MYR",
              allowGuestOrders: true,
            }),
          })),
        },
      },
      select: vi.fn(() => {
        const builder = {
          from: vi.fn(() => builder),
          where: vi.fn(() => builder),
        };
        return builder;
      }),
      update: vi.fn(() => updateBuilder),
    };

    await createServiceWithDb(db).updateRestaurant("restaurant-1", {
      settings: { allowGuestOrders: false },
    });

    expect(capturedSet[0].settings).toEqual({
      currency: "MYR",
      allowGuestOrders: false,
    });
  });

  it.each([
    { compatible: true, status: 400, code: "CURRENCY_CHANGE_NOT_ALLOWED" },
    { compatible: false, status: 409, code: "MARKET_VENDOR_CURRENCY_MISMATCH" },
  ])(
    "preserves $code when the atomic settings update is refused",
    async ({ compatible, status, code }) => {
      const selectBuilder = {
        from: vi.fn(() => selectBuilder),
        where: vi.fn(() => selectBuilder),
        then: (resolve: (rows: Array<{ id: string }>) => unknown) =>
          Promise.resolve(compatible ? [{ id: "restaurant-1" }] : []).then(
            resolve,
          ),
      };
      const updateBuilder = {
        set: vi.fn(() => updateBuilder),
        where: vi.fn(() => updateBuilder),
        returning: vi.fn(async () => []),
      };
      const db = {
        query: {
          restaurants: {
            findFirst: vi.fn(async () => ({
              settings: { currency: "TWD" },
            })),
          },
        },
        select: vi.fn(() => selectBuilder),
        update: vi.fn(() => updateBuilder),
      };

      await expect(
        createServiceWithDb(db).updateRestaurant("restaurant-1", {
          settings: { currency: "MYR" },
        }),
      ).rejects.toMatchObject({
        status,
        code,
      });
    },
  );
});

/**
 * Collect the column names a Drizzle `where` expression references, so a test
 * can assert on the filter itself instead of on a stubbed query result.
 */
function whereColumnNames(args: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const candidate = node as { name?: unknown; table?: unknown };
    if (typeof candidate.name === "string" && candidate.table) {
      names.push(candidate.name);
    }
    walk((node as { queryChunks?: unknown }).queryChunks);
  };
  walk((args as { where?: unknown })?.where);
  return names;
}

describe("RestaurantService shop QR codes", () => {
  const RESTAURANT_ID = "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1";
  const SHOP_QR_CODE = `SHOP-${RESTAURANT_ID}-1785563580`;
  const CLIENT_BASE_URL = "https://makanmasak.com";

  function buildRestaurantRow(overrides: Record<string, unknown> = {}) {
    return {
      id: RESTAURANT_ID,
      name: "雞排攤",
      type: "street_food",
      category: "casual",
      address: "逢甲路 1 號",
      district: "西屯區",
      city: "台中市",
      phone: "0912345678",
      isActive: true,
      isAvailable: true,
      enableShopMode: true,
      shopQrCode: SHOP_QR_CODE,
      shopQrCodeImageUrl: null,
      shopQrVersion: 1,
      settings: { enableTakeaway: true },
      // 兩欄在 schema 都是 notNull，真實列必定帶值
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("returns a scannable https URL alongside the stored lookup code", async () => {
    const db = {
      query: {
        restaurants: {
          findFirst: vi.fn(async () => buildRestaurantRow()),
        },
      },
    };
    const service = createServiceWithDb(db, {
      CLIENT_BASE_URL,
    });

    const result = await service.generateShopQrCode(RESTAURANT_ID);

    // The stored code stays the lookup key; the URL is what gets printed.
    expect(result.qrCode).toBe(SHOP_QR_CODE);
    expect(result.qrUrl).toBe(
      `${CLIENT_BASE_URL}/restaurant/${RESTAURANT_ID}/shop/order-type?qr=${encodeURIComponent(SHOP_QR_CODE)}`,
    );
  });

  it("exposes the same URL from getShopQrCodeInfo, and null when no code exists", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(buildRestaurantRow())
      .mockResolvedValueOnce(buildRestaurantRow({ shopQrCode: null }));
    const service = createServiceWithDb(
      { query: { restaurants: { findFirst } } },
      { CLIENT_BASE_URL },
    );

    await expect(
      service.getShopQrCodeInfo(RESTAURANT_ID),
    ).resolves.toMatchObject({
      qrCode: SHOP_QR_CODE,
      qrUrl: `${CLIENT_BASE_URL}/restaurant/${RESTAURANT_ID}/shop/order-type?qr=${encodeURIComponent(SHOP_QR_CODE)}`,
    });

    await expect(
      service.getShopQrCodeInfo(RESTAURANT_ID),
    ).resolves.toMatchObject({ qrCode: null, qrUrl: null });
  });

  it("filters verification on shop mode, not just on the code", async () => {
    // Asserting on the WHERE clause rather than on a stubbed empty result:
    // a mock that returns nothing passes whether or not the filter exists, and
    // this filter is the only thing that retires a printed sticker when an
    // owner turns shop mode off.
    const findFirst = vi.fn(async () => undefined);
    const service = createServiceWithDb(
      { query: { restaurants: { findFirst } } },
      { CLIENT_BASE_URL },
    );

    await expect(service.verifyShopQrCode(SHOP_QR_CODE)).resolves.toEqual({
      valid: false,
    });
    expect(findFirst).toHaveBeenCalledOnce();
    expect(whereColumnNames(findFirst.mock.calls[0][0])).toEqual(
      expect.arrayContaining(["shop_qr_code", "is_active", "enable_shop_mode"]),
    );
  });

  it("resolves a QR code for an active shop-mode restaurant", async () => {
    const findFirst = vi.fn(async () => buildRestaurantRow());
    const service = createServiceWithDb(
      { query: { restaurants: { findFirst } } },
      { CLIENT_BASE_URL },
    );

    await expect(service.verifyShopQrCode(SHOP_QR_CODE)).resolves.toMatchObject(
      { valid: true, restaurantId: RESTAURANT_ID },
    );
  });

  it("rejects anything that is not a shop code without hitting the database", async () => {
    const findFirst = vi.fn();
    const service = createServiceWithDb(
      { query: { restaurants: { findFirst } } },
      { CLIENT_BASE_URL },
    );

    await expect(service.verifyShopQrCode("TABLE-1")).resolves.toEqual({
      valid: false,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("RestaurantService.getShopOrderingState", () => {
  const RESTAURANT_ID = "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1";

  function serviceWithRow(
    row: { enableShopMode: boolean; shopQrCode: string | null } | undefined,
  ) {
    const findFirst = vi.fn(async () => row);
    const service = createServiceWithDb({
      query: { restaurants: { findFirst } },
    });
    return { service, findFirst };
  }

  it("reports the flag and the live code for an existing restaurant", async () => {
    const { service, findFirst } = serviceWithRow({
      enableShopMode: true,
      shopQrCode: `SHOP-${RESTAURANT_ID}-1785563580`,
    });

    await expect(service.getShopOrderingState(RESTAURANT_ID)).resolves.toEqual({
      enableShopMode: true,
      shopQrCode: `SHOP-${RESTAURANT_ID}-1785563580`,
    });
    expect(findFirst).toHaveBeenCalledWith(
      // Two columns only: this runs on every shop order, so it must not
      // quietly grow into a full-row read.
      expect.objectContaining({
        columns: { enableShopMode: true, shopQrCode: true },
      }),
    );
  });

  it("reports false when the owner turned shop mode off", async () => {
    const { service } = serviceWithRow({
      enableShopMode: false,
      shopQrCode: null,
    });

    await expect(
      service.getShopOrderingState(RESTAURANT_ID),
    ).resolves.toMatchObject({ enableShopMode: false });
  });

  it("distinguishes a missing restaurant from a disabled one", async () => {
    const { service } = serviceWithRow(undefined);

    await expect(
      service.getShopOrderingState(RESTAURANT_ID),
    ).resolves.toBeNull();
  });
});
