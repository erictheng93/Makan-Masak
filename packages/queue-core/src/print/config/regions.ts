/**
 * 地區配置
 * 不同國家的稅務、法規和收據格式配置
 */

import type { CountryCode, RegionConfig } from "@makanmasak/shared-types";
import { currencyDecimals, formatRegionMoney } from "../utils/money";

export const REGION_CONFIGS: Record<CountryCode, RegionConfig> = {
  TW: {
    country: "TW",
    currency: "TWD",
    locale: "zh-TW",
    timezone: "Asia/Taipei",
    dateFormat: "YYYY/MM/DD",
    timeFormat: "HH:mm:ss",
    numberFormat: {
      decimal: ".",
      thousand: ",",
      currency: {
        symbol: "NT$",
        position: "before",
        space: false,
      },
    },
    tax: {
      name: "Tax",
      nameLocal: "營業稅",
      rate: 0.05,
      inclusive: false,
      displayFormat: "營業稅 (5%)",
    },
    legal: {
      requiresTaxNumber: true,
      requiresLicense: true,
      invoiceFormat: "government",
      retentionPeriod: 1825, // 5年
      electronicInvoice: true,
    },
    receipt: {
      width: 32,
      headerLines: 8,
      footerLines: 6,
      itemNameMaxLength: 20,
      showItemCodes: false,
      showTaxBreakdown: true,
      defaultFont: "normal",
      paperSize: "80mm",
    },
  },

  MY: {
    country: "MY",
    currency: "MYR",
    locale: "ms-MY",
    timezone: "Asia/Kuala_Lumpur",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm:ss",
    numberFormat: {
      decimal: ".",
      thousand: ",",
      currency: {
        symbol: "RM",
        position: "before",
        space: true,
      },
    },
    tax: {
      name: "SST",
      nameLocal: "SST",
      rate: 0.06,
      inclusive: false,
      displayFormat: "SST (6%)",
    },
    legal: {
      requiresTaxNumber: false,
      requiresLicense: true,
      invoiceFormat: "detailed",
      retentionPeriod: 2555, // 7年
      electronicInvoice: false,
    },
    receipt: {
      width: 32,
      headerLines: 6,
      footerLines: 4,
      itemNameMaxLength: 18,
      showItemCodes: true,
      showTaxBreakdown: true,
      defaultFont: "normal",
      paperSize: "80mm",
    },
  },

  VN: {
    country: "VN",
    currency: "VND",
    locale: "vi-VN",
    timezone: "Asia/Ho_Chi_Minh",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm:ss",
    numberFormat: {
      decimal: ",",
      thousand: ".",
      currency: {
        symbol: "₫",
        position: "after",
        space: true,
      },
    },
    tax: {
      name: "VAT",
      nameLocal: "VAT",
      rate: 0.1,
      inclusive: true,
      displayFormat: "VAT (10%)",
    },
    legal: {
      requiresTaxNumber: true,
      requiresLicense: true,
      invoiceFormat: "government",
      retentionPeriod: 1825, // 5年
      electronicInvoice: true,
    },
    receipt: {
      width: 32,
      headerLines: 6,
      footerLines: 5,
      itemNameMaxLength: 16,
      showItemCodes: false,
      showTaxBreakdown: true,
      defaultFont: "normal",
      paperSize: "80mm",
    },
  },
};

// 預設地區
export const DEFAULT_REGION: CountryCode = "TW";

// 支援的地區列表
export const SUPPORTED_REGIONS: CountryCode[] = Object.keys(
  REGION_CONFIGS,
) as CountryCode[];

// 根據地區獲取貨幣配置
export const getCurrencyConfig = (country: CountryCode) => {
  const region = REGION_CONFIGS[country];
  if (!region) return null;

  return {
    code: region.currency,
    symbol: region.numberFormat.currency.symbol,
    position: region.numberFormat.currency.position,
    // TWD and VND have no fractional unit in circulation.
    decimals: currencyDecimals(region.currency),
    thousandSeparator: region.numberFormat.thousand,
    decimalSeparator: region.numberFormat.decimal,
  };
};

// 根據地區格式化金額
export const formatCurrency = (
  amount: number,
  country: CountryCode,
): string => {
  const region = REGION_CONFIGS[country];
  if (!region) return amount.toString();

  // Not Intl style:"currency": zh-TW renders TWD as "$350.00", with a bare
  // dollar sign and ISO-4217's two decimals the currency does not use.
  return formatRegionMoney(amount, region);
};

// 根據地區格式化日期時間
export const formatDateTime = (date: Date, country: CountryCode): string => {
  const region = REGION_CONFIGS[country];
  if (!region) return date.toISOString();

  return new Intl.DateTimeFormat(region.locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: region.timezone,
  }).format(date);
};

// 獲取稅率配置
export const getTaxConfig = (country: CountryCode) => {
  const region = REGION_CONFIGS[country];
  return region?.tax || null;
};

// 計算稅額
export const calculateTax = (
  amount: number,
  country: CountryCode,
): {
  taxAmount: number;
  taxableAmount: number;
  totalAmount: number;
} => {
  const taxConfig = getTaxConfig(country);
  if (!taxConfig) {
    return {
      taxAmount: 0,
      taxableAmount: amount,
      totalAmount: amount,
    };
  }

  if (taxConfig.inclusive) {
    // 含稅價格，需要反推稅額
    const taxableAmount = amount / (1 + taxConfig.rate);
    const taxAmount = amount - taxableAmount;
    return {
      taxAmount,
      taxableAmount,
      totalAmount: amount,
    };
  } else {
    // 未稅價格，直接計算稅額
    const taxAmount = amount * taxConfig.rate;
    return {
      taxAmount,
      taxableAmount: amount,
      totalAmount: amount + taxAmount,
    };
  }
};
