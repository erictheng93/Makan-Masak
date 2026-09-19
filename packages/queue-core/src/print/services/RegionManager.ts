/**
 * 地區管理器
 * 負責管理不同地區的格式化配置和多國語言支持
 */

import type { CountryCode, RegionConfig } from "@makanmasak/shared-types";
import { REGION_CONFIGS } from "../config/regions";
import { formatRegionMoney, roundMoney } from "../utils/money";

export class RegionManager {
  private regions: Map<CountryCode, RegionConfig>;

  constructor() {
    this.regions = new Map();
    this.initializeDefaultRegions();
  }

  // =============================================
  // 地區配置管理
  // =============================================

  getRegion(country: CountryCode): RegionConfig {
    const region = this.regions.get(country);
    if (!region) {
      throw new Error(`Region configuration not found for country: ${country}`);
    }
    return region;
  }

  setRegion(country: CountryCode, config: RegionConfig): void {
    this.validateRegionConfig(config);
    this.regions.set(country, config);
  }

  hasRegion(country: CountryCode): boolean {
    return this.regions.has(country);
  }

  getSupportedRegions(): CountryCode[] {
    return Array.from(this.regions.keys());
  }

  // =============================================
  // 貨幣格式化
  // =============================================

  formatCurrency(amount: number, country: CountryCode): string {
    // The decimals used to be looked up by the *symbol* ("₫") in a list of
    // currency *codes* ("VND"), so VND never matched and printed two
    // decimals; and Intl renders TWD as "$350.00". formatRegionMoney keys the
    // precision on the currency code and uses the region's own symbol.
    return formatRegionMoney(amount, this.getRegion(country));
  }

  formatNumber(number: number, country: CountryCode): string {
    const region = this.getRegion(country);
    return new Intl.NumberFormat(region.locale).format(number);
  }

  // =============================================
  // 日期時間格式化
  // =============================================

  formatDate(date: Date, country: CountryCode): string {
    const region = this.getRegion(country);
    return new Intl.DateTimeFormat(region.locale, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: region.timezone,
    }).format(date);
  }

  formatDateTime(
    date: Date,
    country: CountryCode,
    options?: {
      dateStyle?: "full" | "long" | "medium" | "short";
      timeStyle?: "full" | "long" | "medium" | "short";
    },
  ): string {
    const region = this.getRegion(country);
    return new Intl.DateTimeFormat(region.locale, {
      dateStyle: options?.dateStyle || "short",
      timeStyle: options?.timeStyle || "short",
      timeZone: region.timezone,
    }).format(date);
  }

  // =============================================
  // 稅務計算
  // =============================================

  calculateTax(
    subtotal: number,
    country: CountryCode,
  ): {
    taxAmount: number;
    taxableAmount: number;
    totalAmount: number;
    taxConfig: RegionConfig["tax"];
  } {
    const region = this.getRegion(country);
    const { tax: taxConfig } = region;

    if (taxConfig.inclusive) {
      // 含稅價格計算稅額
      // Rounded to the currency so the two parts still sum to the subtotal.
      const taxAmount = roundMoney(
        subtotal - subtotal / (1 + taxConfig.rate),
        region.currency,
      );
      const taxableAmount = subtotal - taxAmount;
      return {
        taxAmount,
        taxableAmount,
        totalAmount: subtotal,
        taxConfig,
      };
    } else {
      // 未稅價格計算稅額
      const taxAmount = roundMoney(subtotal * taxConfig.rate, region.currency);
      return {
        taxAmount,
        taxableAmount: subtotal,
        totalAmount: subtotal + taxAmount,
        taxConfig,
      };
    }
  }

  // =============================================
  // 地址格式化
  // =============================================

  formatAddress(
    address: {
      street?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    },
    country: CountryCode,
  ): string {
    // 根據地區調整地址格式
    switch (country) {
      case "TW":
        // 台灣格式: 郵遞區號 + 城市 + 街道
        return [address.postalCode, address.city, address.state, address.street]
          .filter(Boolean)
          .join(" ");

      case "MY":
        // 馬來西亞格式: 街道, 郵遞區號 城市, 州
        return [
          address.street,
          [address.postalCode, address.city].filter(Boolean).join(" "),
          address.state,
        ]
          .filter(Boolean)
          .join(", ");

      case "VN":
        // 越南格式: 街道, 城市, 州 郵遞區號
        return [
          address.street,
          address.city,
          [address.state, address.postalCode].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ");

      default:
        // 預設格式
        return [
          address.street,
          address.city,
          address.state,
          address.postalCode,
          address.country,
        ]
          .filter(Boolean)
          .join(", ");
    }
  }

  // =============================================
  // 地區特定設定
  // =============================================

  getReceiptConfig(country: CountryCode): RegionConfig["receipt"] {
    const region = this.getRegion(country);
    return region.receipt;
  }

  getTaxConfig(country: CountryCode): RegionConfig["tax"] {
    const region = this.getRegion(country);
    return region.tax;
  }

  getLegalConfig(country: CountryCode): RegionConfig["legal"] {
    const region = this.getRegion(country);
    return region.legal;
  }

  getNumberFormat(country: CountryCode): RegionConfig["numberFormat"] {
    const region = this.getRegion(country);
    return region.numberFormat;
  }

  // =============================================
  // 驗證和初始化
  // =============================================

  private validateRegionConfig(config: RegionConfig): void {
    if (!config.country || !config.currency || !config.locale) {
      throw new Error(
        "Region config missing required fields: country, currency, locale",
      );
    }

    if (!config.numberFormat || !config.tax || !config.receipt) {
      throw new Error(
        "Region config missing required sections: numberFormat, tax, receipt",
      );
    }

    // 驗證稅率
    if (config.tax.rate < 0 || config.tax.rate > 1) {
      throw new Error("Tax rate must be between 0 and 1");
    }

    // 驗證收據寬度
    if (config.receipt.width < 16 || config.receipt.width > 80) {
      throw new Error("Receipt width must be between 16 and 80 characters");
    }
  }

  private initializeDefaultRegions(): void {
    // 載入所有預設地區配置
    for (const [country, config] of Object.entries(REGION_CONFIGS)) {
      this.regions.set(country as CountryCode, config);
    }
  }

  // =============================================
  // 工具方法
  // =============================================

  getTimezone(country: CountryCode): string {
    const region = this.getRegion(country);
    return region.timezone;
  }

  getLocale(country: CountryCode): string {
    const region = this.getRegion(country);
    return region.locale;
  }

  getCurrency(country: CountryCode): string {
    const region = this.getRegion(country);
    return region.currency;
  }

  isRegionSupported(country: CountryCode): boolean {
    return this.regions.has(country);
  }

  // 獲取所有地區的摘要信息
  getRegionsSummary(): Array<{
    country: CountryCode;
    currency: string;
    locale: string;
    timezone: string;
    taxRate: number;
    receiptWidth: number;
  }> {
    return Array.from(this.regions.entries()).map(([country, config]) => ({
      country,
      currency: config.currency,
      locale: config.locale,
      timezone: config.timezone,
      taxRate: config.tax.rate,
      receiptWidth: config.receipt.width,
    }));
  }
}
