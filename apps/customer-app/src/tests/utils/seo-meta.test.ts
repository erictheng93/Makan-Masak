import { beforeEach, describe, expect, it } from "vitest";
import { applyMarketSeoMeta, applyShopMenuSeoMeta } from "@/utils/seoMeta";
import type { MarketDetail } from "@/services/marketsApi";
import type { Category, MenuItem, Restaurant } from "@makanmasak/shared-types";

function market(overrides: Partial<MarketDetail> = {}): MarketDetail {
  return {
    id: "market-1",
    slug: "fengjia",
    name: "逢甲夜市",
    type: "night_market",
    description: "台中最受歡迎的夜市小吃聚落",
    city: "台中市",
    district: "西屯區",
    address: "台中市西屯區文華路",
    latitude: 24.1764,
    longitude: 120.6466,
    openingHours: null,
    bannerUrl: "https://example.com/banner.jpg",
    logoUrl: null,
    imageUrls: null,
    tags: ["夜市", "小吃"],
    vendorCount: 12,
    ...overrides,
  };
}

function metaByName(name: string) {
  return document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
    ?.content;
}

function metaByProperty(property: string) {
  return document.head.querySelector<HTMLMetaElement>(
    `meta[property="${property}"]`,
  )?.content;
}

function marketJsonLd() {
  const script = document.head.querySelector<HTMLScriptElement>(
    'script[type="application/ld+json"][data-seo="market"]',
  );
  return script ? JSON.parse(script.textContent ?? "{}") : null;
}

function shopMenuJsonLd() {
  const script = document.head.querySelector<HTMLScriptElement>(
    'script[type="application/ld+json"][data-seo="shop-menu"]',
  );
  return script ? JSON.parse(script.textContent ?? "{}") : null;
}

function restaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "restaurant-1",
    name: "阿明鹽酥雞",
    type: "stall",
    category: "food",
    description: "夜市人氣炸物攤",
    address: "台中市西屯區文華路100號",
    district: "西屯區",
    city: "台中市",
    latitude: 24.1764,
    longitude: 120.6466,
    phone: "0212345678",
    logoUrl: "/logo.jpg",
    bannerUrl: undefined,
    imageUrls: [],
    isAvailable: true,
    isActive: true,
    status: 1,
    planType: 1,
    supportsTakeaway: true,
    supportsDelivery: false,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 10,
    restaurantId: "restaurant-1",
    name: "招牌炸物",
    sortOrder: 1,
    status: 1,
    createdAt: 1786_000_000_000,
    updatedAt: 1786_000_000_000,
    ...overrides,
  };
}

function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 101,
    restaurantId: "restaurant-1",
    categoryId: 10,
    catalogType: "menu_item",
    name: "鹽酥雞",
    description: "現炸招牌鹽酥雞",
    // Major units: the menu API sends amountFromCents(priceCents).
    price: 75,
    spiceLevel: 0,
    sortOrder: 1,
    isAvailable: true,
    isFeatured: true,
    inventoryCount: null,
    orderCount: 20,
    createdAt: 1786_000_000_000,
    updatedAt: 1786_000_000_000,
    ...overrides,
  };
}

describe("applyMarketSeoMeta", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.title = "";
  });

  it("updates title, description, share image, and canonical URL", () => {
    applyMarketSeoMeta({
      market: market(),
      vendorCount: 12,
      path: "/markets/fengjia",
      origin: "https://makanmasak.com",
    });

    expect(document.title).toBe(
      "逢甲夜市｜台中市西屯區美食與店家菜單｜MakanMasak",
    );
    expect(metaByName("description")).toContain("12 間店家");
    expect(metaByProperty("og:title")).toBe(
      "逢甲夜市｜台中市西屯區美食與店家菜單｜MakanMasak",
    );
    expect(metaByProperty("og:image")).toBe("https://example.com/banner.jpg");
    expect(metaByProperty("og:url")).toBe(
      "https://makanmasak.com/markets/fengjia",
    );
    expect(metaByName("twitter:image")).toBe("https://example.com/banner.jpg");
    expect(
      document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
        ?.href,
    ).toBe("https://makanmasak.com/markets/fengjia");
  });

  it("falls back to gallery image and generated description", () => {
    applyMarketSeoMeta({
      market: market({
        description: null,
        bannerUrl: null,
        imageUrls: ["/market-gallery.jpg"],
      }),
      vendorCount: 3,
      path: "/markets/fengjia",
      origin: "https://makanmasak.com",
    });

    expect(metaByName("description")).toContain("探索逢甲夜市");
    expect(metaByProperty("og:image")).toBe(
      "https://makanmasak.com/market-gallery.jpg",
    );
  });

  it("adds structured data for the market page", () => {
    applyMarketSeoMeta({
      market: market({
        openingHours: {
          monday: { open: "17:00", close: "23:30" },
          tuesday: { open: "17:00", close: "23:30", closed: true },
        },
      }),
      vendorCount: 12,
      path: "/markets/fengjia",
      origin: "https://makanmasak.com",
    });

    const jsonLd = marketJsonLd();

    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Place",
      name: "逢甲夜市",
      description: expect.stringContaining("12 間店家"),
      url: "https://makanmasak.com/markets/fengjia",
      image: "https://example.com/banner.jpg",
      address: {
        "@type": "PostalAddress",
        streetAddress: "台中市西屯區文華路",
        addressLocality: "西屯區",
        addressRegion: "台中市",
        addressCountry: "TW",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: 24.1764,
        longitude: 120.6466,
      },
    });
    expect(jsonLd.openingHoursSpecification).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Monday",
        opens: "17:00",
        closes: "23:30",
      },
    ]);

    applyMarketSeoMeta({
      market: market({ name: "一中商圈" }),
      vendorCount: 4,
      path: "/markets/yizhong",
      origin: "https://makanmasak.com",
    });

    expect(
      document.head.querySelectorAll(
        'script[type="application/ld+json"][data-seo="market"]',
      ),
    ).toHaveLength(1);
    expect(marketJsonLd()?.name).toBe("一中商圈");
  });
});

describe("applyShopMenuSeoMeta", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.title = "";
  });

  it("updates share metadata, canonical URL, and restaurant menu structured data", () => {
    applyMarketSeoMeta({
      market: market(),
      vendorCount: 12,
      path: "/markets/fengjia",
      origin: "https://makanmasak.com",
    });

    applyShopMenuSeoMeta({
      restaurant: restaurant(),
      categories: [category()],
      menuItems: [
        menuItem(),
        menuItem({
          id: 102,
          name: "地瓜薯條",
          description: undefined,
          price: 50,
        }),
        menuItem({ id: 103, name: "售完雞排", isAvailable: false }),
      ],
      path: "/restaurant/restaurant-1/shop/menu?phone=1234",
      origin: "https://makanmasak.com",
    });

    expect(document.title).toBe("阿明鹽酥雞菜單｜線上點餐｜MakanMasak");
    expect(metaByName("description")).toContain("2 項可點餐商品");
    expect(metaByProperty("og:type")).toBe("restaurant");
    expect(metaByProperty("og:url")).toBe(
      "https://makanmasak.com/restaurant/restaurant-1/shop/menu",
    );
    expect(metaByProperty("og:image")).toBe("https://makanmasak.com/logo.jpg");
    expect(
      document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
        ?.href,
    ).toBe("https://makanmasak.com/restaurant/restaurant-1/shop/menu");
    expect(marketJsonLd()).toBeNull();

    const jsonLd = shopMenuJsonLd();

    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: "阿明鹽酥雞",
      description: expect.stringContaining("2 項可點餐商品"),
      url: "https://makanmasak.com/restaurant/restaurant-1/shop/menu",
      image: "https://makanmasak.com/logo.jpg",
      servesCuisine: "food",
      address: {
        "@type": "PostalAddress",
        streetAddress: "台中市西屯區文華路100號",
        addressLocality: "西屯區",
        addressRegion: "台中市",
        addressCountry: "TW",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: 24.1764,
        longitude: 120.6466,
      },
    });
    expect(jsonLd.potentialAction).toMatchObject({
      "@type": "OrderAction",
      target: "https://makanmasak.com/restaurant/restaurant-1/shop/menu",
    });
    expect(jsonLd.hasMenu.hasMenuSection).toEqual([
      {
        "@type": "MenuSection",
        name: "招牌炸物",
        hasMenuItem: [
          {
            "@type": "MenuItem",
            name: "鹽酥雞",
            description: "現炸招牌鹽酥雞",
            offers: {
              "@type": "Offer",
              price: "75",
              priceCurrency: "TWD",
              availability: "https://schema.org/InStock",
            },
          },
          {
            "@type": "MenuItem",
            name: "地瓜薯條",
            offers: {
              "@type": "Offer",
              price: "50",
              priceCurrency: "TWD",
              availability: "https://schema.org/InStock",
            },
          },
        ],
      },
    ]);
  });

  it("prices the menu in the restaurant's own currency and country", () => {
    applyShopMenuSeoMeta({
      restaurant: restaurant({
        timezone: "Asia/Kuala_Lumpur",
        settings: { currency: "MYR" },
      } as Partial<Restaurant>),
      categories: [category()],
      menuItems: [menuItem({ price: 12.5 })],
      path: "/restaurant/restaurant-1/shop/menu",
      origin: "https://makanmasak.com",
    });

    const jsonLd = shopMenuJsonLd();
    expect(jsonLd.address.addressCountry).toBe("MY");
    expect(jsonLd.hasMenu.hasMenuSection[0].hasMenuItem[0].offers).toEqual(
      expect.objectContaining({ price: "12.50", priceCurrency: "MYR" }),
    );
  });

  it("uses whole đồng and VN for a Vietnamese shop without a timezone", () => {
    applyShopMenuSeoMeta({
      restaurant: restaurant({
        settings: { currency: "VND" },
      } as Partial<Restaurant>),
      categories: [category()],
      menuItems: [menuItem({ price: 35000 })],
      path: "/restaurant/restaurant-1/shop/menu",
      origin: "https://makanmasak.com",
    });

    const jsonLd = shopMenuJsonLd();
    expect(jsonLd.address.addressCountry).toBe("VN");
    expect(jsonLd.hasMenu.hasMenuSection[0].hasMenuItem[0].offers).toEqual(
      expect.objectContaining({ price: "35000", priceCurrency: "VND" }),
    );
  });
});
