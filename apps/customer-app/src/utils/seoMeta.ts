import type { MarketDetail } from "@/services/marketsApi";
import type { Category, MenuItem, Restaurant } from "@makanmasak/shared-types";
import {
  getCurrencyConfig,
  normalizeCurrencyCode,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@makanmasak/utils";

const SITE_NAME = "MakanMasak";
const DEFAULT_IMAGE = "/og-image.png";

interface MarketSeoMetaInput {
  market: MarketDetail;
  vendorCount: number;
  path: string;
  origin?: string;
}

interface ShopMenuSeoMetaInput {
  restaurant: Restaurant;
  categories: Category[];
  menuItems: MenuItem[];
  path: string;
  origin?: string;
}

function getOrigin(origin?: string) {
  if (origin) return origin.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return "https://makanmasak.com";
}

function absoluteUrl(value: string, origin: string) {
  return new URL(value, origin).href;
}

function canonicalPath(path: string) {
  return path.split(/[?#]/)[0] || "/";
}

function ensureMeta(
  attribute: "name" | "property",
  key: string,
): HTMLMetaElement {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  );
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  return element;
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  ensureMeta(attribute, key).content = content;
}

function ensureCanonical() {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  return element;
}

function ensureJsonLd(key: "market" | "shop-menu") {
  document.head
    .querySelectorAll<HTMLScriptElement>(
      `script[type="application/ld+json"][data-seo]:not([data-seo="${key}"])`,
    )
    .forEach((element) => element.remove());

  let element = document.head.querySelector<HTMLScriptElement>(
    `script[type="application/ld+json"][data-seo="${key}"]`,
  );
  if (!element) {
    element = document.createElement("script");
    element.type = "application/ld+json";
    element.dataset.seo = key;
    document.head.appendChild(element);
  }
  return element;
}

function marketImage(market: MarketDetail, origin: string) {
  const image =
    market.bannerUrl ||
    market.logoUrl ||
    market.imageUrls?.[0] ||
    DEFAULT_IMAGE;
  return absoluteUrl(image, origin);
}

function restaurantImage(restaurant: Restaurant, origin: string) {
  const image =
    restaurant.bannerUrl ||
    restaurant.logoUrl ||
    restaurant.imageUrls?.[0] ||
    DEFAULT_IMAGE;
  return absoluteUrl(image, origin);
}

function marketDescription(market: MarketDetail, vendorCount: number) {
  const base =
    market.description?.trim() ||
    `探索${market.name}的店家、商品與服務，直接查看菜單並開始點餐。`;
  return `${base} ${market.city}${market.district}，目前收錄 ${vendorCount} 間店家。`;
}

function shopMenuDescription(
  restaurant: Restaurant,
  availableItemCount: number,
) {
  const base =
    restaurant.description?.trim() ||
    `查看${restaurant.name}的店鋪菜單、商品與服務，直接線上點餐。`;
  const location = [restaurant.city, restaurant.district]
    .filter(Boolean)
    .join("");
  return `${base} ${location}，目前提供 ${availableItemCount} 項可點餐商品。`;
}

const schemaDays: Record<string, string> = {
  monday: "https://schema.org/Monday",
  tuesday: "https://schema.org/Tuesday",
  wednesday: "https://schema.org/Wednesday",
  thursday: "https://schema.org/Thursday",
  friday: "https://schema.org/Friday",
  saturday: "https://schema.org/Saturday",
  sunday: "https://schema.org/Sunday",
};

function openingHoursSpecification(market: MarketDetail) {
  return Object.entries(market.openingHours ?? {})
    .filter(([, hours]) => !hours.closed && hours.open && hours.close)
    .map(([day, hours]) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: schemaDays[day.toLowerCase()] ?? day,
      opens: hours.open,
      closes: hours.close,
    }));
}

function marketStructuredData({
  market,
  vendorCount,
  canonicalUrl,
  image,
}: {
  market: MarketDetail;
  vendorCount: number;
  canonicalUrl: string;
  image: string;
}) {
  const description = marketDescription(market, vendorCount);
  const hours = openingHoursSpecification(market);

  return {
    "@context": "https://schema.org",
    "@type": "Place",
    name: market.name,
    description,
    url: canonicalUrl,
    image,
    address: {
      "@type": "PostalAddress",
      streetAddress: market.address,
      addressLocality: market.district,
      addressRegion: market.city,
      addressCountry: "TW",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: market.latitude,
      longitude: market.longitude,
    },
    ...(hours.length > 0 ? { openingHoursSpecification: hours } : {}),
  };
}

const COUNTRY_BY_TIMEZONE: Record<string, string> = {
  "Asia/Taipei": "TW",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Ho_Chi_Minh": "VN",
};

const COUNTRY_BY_CURRENCY: Record<CurrencyCode, string> = {
  TWD: "TW",
  MYR: "MY",
  VND: "VN",
};

function restaurantCurrency(restaurant: Restaurant): CurrencyCode {
  return (
    normalizeCurrencyCode(restaurant.settings?.currency) ?? DEFAULT_CURRENCY
  );
}

function restaurantCountry(restaurant: Restaurant): string {
  return (
    (restaurant.timezone && COUNTRY_BY_TIMEZONE[restaurant.timezone]) ||
    COUNTRY_BY_CURRENCY[restaurantCurrency(restaurant)]
  );
}

/**
 * schema.org wants a plain decimal string. The menu API already sends
 * `price` in major units (amountFromCents), so dividing by 100 again turned a
 * NT$75 dish into "0.75".
 */
function itemPrice(price: number, currency: CurrencyCode) {
  return price.toFixed(getCurrencyConfig(currency)?.decimals ?? 2);
}

function menuStructuredData(
  categories: Category[],
  menuItems: MenuItem[],
  currency: CurrencyCode,
) {
  const availableItems = menuItems.filter((item) => item.isAvailable);
  const sections = categories
    .map((category) => {
      const items = availableItems
        .filter((item) => item.categoryId === category.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, 20)
        .map((item) => ({
          "@type": "MenuItem",
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
          offers: {
            "@type": "Offer",
            price: itemPrice(item.price, currency),
            priceCurrency: currency,
            availability: "https://schema.org/InStock",
          },
        }));

      if (items.length === 0) return null;

      return {
        "@type": "MenuSection",
        name: category.name,
        hasMenuItem: items,
      };
    })
    .filter((section): section is NonNullable<typeof section> =>
      Boolean(section),
    );

  return {
    "@type": "Menu",
    hasMenuSection: sections,
  };
}

function shopMenuStructuredData({
  restaurant,
  categories,
  menuItems,
  canonicalUrl,
  image,
}: {
  restaurant: Restaurant;
  categories: Category[];
  menuItems: MenuItem[];
  canonicalUrl: string;
  image: string;
}) {
  const availableItemCount = menuItems.filter(
    (item) => item.isAvailable,
  ).length;
  const description = shopMenuDescription(restaurant, availableItemCount);

  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    description,
    url: canonicalUrl,
    image,
    ...(restaurant.category ? { servesCuisine: restaurant.category } : {}),
    ...(restaurant.phone ? { telephone: restaurant.phone } : {}),
    ...(restaurant.address || restaurant.city || restaurant.district
      ? {
          address: {
            "@type": "PostalAddress",
            ...(restaurant.address
              ? { streetAddress: restaurant.address }
              : {}),
            ...(restaurant.district
              ? { addressLocality: restaurant.district }
              : {}),
            ...(restaurant.city ? { addressRegion: restaurant.city } : {}),
            addressCountry: restaurantCountry(restaurant),
          },
        }
      : {}),
    ...(restaurant.latitude != null && restaurant.longitude != null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: restaurant.latitude,
            longitude: restaurant.longitude,
          },
        }
      : {}),
    potentialAction: {
      "@type": "OrderAction",
      target: canonicalUrl,
    },
    hasMenu: menuStructuredData(
      categories,
      menuItems,
      restaurantCurrency(restaurant),
    ),
  };
}

export function applyMarketSeoMeta({
  market,
  vendorCount,
  path,
  origin,
}: MarketSeoMetaInput) {
  const siteOrigin = getOrigin(origin);
  const canonicalUrl = absoluteUrl(path, siteOrigin);
  const title = `${market.name}｜${market.city}${market.district}美食與店家菜單｜${SITE_NAME}`;
  const description = marketDescription(market, vendorCount);
  const image = marketImage(market, siteOrigin);

  document.title = title;
  setMeta("name", "description", description);
  setMeta(
    "name",
    "keywords",
    [market.name, market.city, market.district, ...(market.tags ?? [])].join(
      ",",
    ),
  );
  setMeta("property", "og:type", "website");
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:image", image);
  setMeta("property", "og:url", canonicalUrl);
  setMeta("property", "og:site_name", SITE_NAME);
  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", image);
  ensureCanonical().href = canonicalUrl;
  ensureJsonLd("market").textContent = JSON.stringify(
    marketStructuredData({ market, vendorCount, canonicalUrl, image }),
  );
}

export function applyShopMenuSeoMeta({
  restaurant,
  categories,
  menuItems,
  path,
  origin,
}: ShopMenuSeoMetaInput) {
  const siteOrigin = getOrigin(origin);
  const canonicalUrl = absoluteUrl(canonicalPath(path), siteOrigin);
  const availableItemCount = menuItems.filter(
    (item) => item.isAvailable,
  ).length;
  const title = `${restaurant.name}菜單｜線上點餐｜${SITE_NAME}`;
  const description = shopMenuDescription(restaurant, availableItemCount);
  const image = restaurantImage(restaurant, siteOrigin);

  document.title = title;
  setMeta("name", "description", description);
  setMeta(
    "name",
    "keywords",
    [
      restaurant.name,
      restaurant.city,
      restaurant.district,
      restaurant.category,
      "菜單",
      "線上點餐",
    ]
      .filter(Boolean)
      .join(","),
  );
  setMeta("property", "og:type", "restaurant");
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:image", image);
  setMeta("property", "og:url", canonicalUrl);
  setMeta("property", "og:site_name", SITE_NAME);
  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", image);
  ensureCanonical().href = canonicalUrl;
  ensureJsonLd("shop-menu").textContent = JSON.stringify(
    shopMenuStructuredData({
      restaurant,
      categories,
      menuItems,
      canonicalUrl,
      image,
    }),
  );
}
