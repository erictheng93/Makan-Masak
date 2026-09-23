import { describe, expect, it } from "vitest";
import {
  buildMarketPublicProfilePayload,
  marketPublicProfileFormFromMarket,
} from "./marketPublicProfileForm";
import type { MarketListItem } from "@/services/marketsService";

function market(overrides: Partial<MarketListItem> = {}): MarketListItem {
  return {
    id: "market-1",
    slug: "fengjia",
    name: "逢甲夜市",
    type: "night_market",
    description: "台中夜市",
    city: "台中市",
    district: "西屯區",
    address: "文華路",
    latitude: 24.1764,
    longitude: 120.6466,
    openingHours: {
      friday: { open: "17:00", close: "23:30" },
    },
    mapLayout: {
      title: "逢甲攤位圖",
      description: "入口到出口的攤位位置",
      imageUrl: "https://example.com/map.jpg",
      width: 1200,
      height: 800,
    },
    bannerUrl: "https://example.com/banner.jpg",
    logoUrl: null,
    imageUrls: ["https://example.com/1.jpg"],
    tags: ["夜市"],
    vendorCount: 12,
    ...overrides,
  };
}

describe("market public profile form", () => {
  it("creates editable form values from a market", () => {
    expect(marketPublicProfileFormFromMarket(market())).toMatchObject({
      description: "台中夜市",
      address: "文華路",
      latitude: "24.1764",
      longitude: "120.6466",
      mapTitle: "逢甲攤位圖",
      mapDescription: "入口到出口的攤位位置",
      mapImageUrl: "https://example.com/map.jpg",
      mapWidth: "1200",
      mapHeight: "800",
      imageUrlsText: "https://example.com/1.jpg",
      tagsText: "夜市",
    });
  });

  it("builds an API payload from edited form values", () => {
    const payload = buildMarketPublicProfilePayload({
      description: " 新描述 ",
      address: " 新地址 ",
      latitude: "24.15",
      longitude: "120.65",
      openingHoursText: '{"monday":{"open":"17:00","close":"23:00"}}',
      mapTitle: " 入口地圖 ",
      mapDescription: " 主入口在左側 ",
      mapImageUrl: "https://example.com/map.png",
      mapWidth: "1200",
      mapHeight: "800",
      bannerUrl: "",
      logoUrl: "https://example.com/logo.jpg",
      imageUrlsText: "https://example.com/a.jpg\n\nhttps://example.com/b.jpg",
      tagsText: "夜市, 小吃,",
    });

    expect(payload).toEqual({
      description: "新描述",
      address: "新地址",
      latitude: 24.15,
      longitude: 120.65,
      openingHours: { monday: { open: "17:00", close: "23:00" } },
      mapLayout: {
        title: "入口地圖",
        description: "主入口在左側",
        imageUrl: "https://example.com/map.png",
        width: 1200,
        height: 800,
      },
      bannerUrl: null,
      logoUrl: "https://example.com/logo.jpg",
      imageUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      tags: ["夜市", "小吃"],
    });
  });

  it("rejects invalid coordinates and opening hours JSON", () => {
    expect(() =>
      buildMarketPublicProfilePayload({
        ...marketPublicProfileFormFromMarket(market()),
        address: "",
      }),
    ).toThrow("Address is required");

    expect(() =>
      buildMarketPublicProfilePayload({
        ...marketPublicProfileFormFromMarket(market()),
        latitude: "abc",
      }),
    ).toThrow("Latitude must be a valid number");

    expect(() =>
      buildMarketPublicProfilePayload({
        ...marketPublicProfileFormFromMarket(market()),
        openingHoursText: "{bad json",
      }),
    ).toThrow("Opening hours must be valid JSON");

    expect(() =>
      buildMarketPublicProfilePayload({
        ...marketPublicProfileFormFromMarket(market()),
        mapWidth: "0",
      }),
    ).toThrow("Map width must be a positive integer");
  });

  it.each([
    ["陣列", '[{"open":"10:00","close":"22:00"}]', "營業時間必須是物件"],
    [
      "未知星期",
      '{"nonsense":{"open":"10:00","close":"22:00"}}',
      "未知的星期「nonsense」",
    ],
    [
      "無效時間",
      '{"mon":{"open":"25:00","close":"22:00"}}',
      "星期 mon 的 open 需為 HH:MM",
    ],
    ["缺少 close", '{"mon":{"open":"10:00"}}', "星期 mon 缺少 close 時間"],
    ["星期值非物件", '{"mon":"10:00-22:00"}', "星期 mon 的營業時間必須是物件"],
    [
      "closed 型別錯誤",
      '{"mon":{"closed":"false"}}',
      "星期 mon 的 closed 必須是 true 或 false",
    ],
    [
      "多餘欄位",
      '{"mon":{"open":"10:00","close":"22:00","note":"晚市"}}',
      "星期 mon 含有不支援的欄位「note」",
    ],
  ])(
    "reports a localized reason for %s",
    (_label, openingHoursText, message) => {
      expect(() =>
        buildMarketPublicProfilePayload({
          ...marketPublicProfileFormFromMarket(market()),
          openingHoursText,
        }),
      ).toThrow(message);
    },
  );

  it.each([
    '{"mon":{"open":"10:00","close":"22:00"}}',
    '{"monday":{"open":"18:00","close":"02:00"}}',
    '{"tue":{"closed":true}}',
    "{}",
    "null",
  ])("accepts valid opening hours %s", (openingHoursText) => {
    expect(() =>
      buildMarketPublicProfilePayload({
        ...marketPublicProfileFormFromMarket(market()),
        openingHoursText,
      }),
    ).not.toThrow();
  });
});
