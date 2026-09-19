/**
 * Receipt Formatter Factory
 * Creates region-specific receipt formatters
 */

import type {
  CountryCode,
  ItemModifier,
  PrintContent,
  RegionConfig,
} from "@makanmasak/shared-types";
import { formatRegionMoney, roundMoney } from "../utils/money";

/**
 * What the regional formatters actually read off a receipt payload.
 *
 * Every field is optional and every read site already falls back, because the
 * callers hand in either a PrintRequest or an object flattened by
 * getReceiptData. Modelling it keeps that leniency while making a misspelt
 * field a compile error instead of an "undefined" printed on a customer's
 * receipt.
 */
export interface ReceiptOrderItem {
  name: string;
  quantity: number;
  price: number;
  nameLocal?: string;
  modifiers?: ItemModifier[];
  category?: string;
}

export interface ReceiptData {
  order?: {
    id?: string;
    tableNumber?: string;
    deliveryAddress?: string;
    deliveryPhone?: string;
    deliveryFee?: number;
    createdAt?: string | number | Date;
    items?: ReceiptOrderItem[];
    subtotal?: number;
    tax?: number;
    total?: number;
  };
  restaurant?: {
    name?: string;
    nameLocal?: string;
    address?: string;
    addressLocal?: string;
    phone?: string;
    taxNumber?: string;
    licenseNumber?: string;
    logo?: string;
    website?: string;
    supportEmail?: string;
    supportPhone?: string;
    promotionalMessage?: string;
  };
  payment?: {
    method?: string;
    amount?: number;
    change?: number;
    cardLast4?: string;
    details?: string;
  };
  customer?: { name?: string };
  cashier?: string | { name?: string };
  receiptNumber?: string;
  restaurantId?: string;
}

/**
 * A payload still wrapped the way PrintRequest carries it, with the fields
 * getReceiptData lifts from the top level alongside it.
 */
export interface WrappedReceiptInput {
  data?: ReceiptData;
  restaurant?: ReceiptData["restaurant"];
  cashier?: ReceiptData["cashier"];
  receiptNumber?: string;
  restaurantId?: string;
}

/** A wrapped payload, or one already flattened by an earlier caller. */
export type ReceiptInput = WrappedReceiptInput | ReceiptData;

export interface IReceiptFormatter {
  formatReceipt(data: ReceiptInput): PrintContent;
  validateData(data: ReceiptData): boolean;
  getRequiredFields(): string[];
}

export abstract class BaseReceiptFormatter implements IReceiptFormatter {
  protected region: RegionConfig;
  protected countryCode: CountryCode;

  constructor(region: RegionConfig, countryCode: CountryCode) {
    this.region = region;
    this.countryCode = countryCode;
  }

  abstract formatReceipt(data: ReceiptInput): PrintContent;
  abstract validateData(data: ReceiptData): boolean;
  abstract getRequiredFields(): string[];

  protected getReceiptData(input: ReceiptInput): ReceiptData {
    const wrapped = input as WrappedReceiptInput;

    if (wrapped?.data?.order) {
      return {
        ...wrapped.data,
        restaurant: wrapped.data.restaurant ?? wrapped.restaurant,
        cashier: wrapped.data.cashier ?? wrapped.cashier,
        receiptNumber: wrapped.data.receiptNumber ?? wrapped.receiptNumber,
        restaurantId: wrapped.restaurantId,
      };
    }

    return (input as ReceiptData) ?? {};
  }

  protected generateBusinessNumber(prefix: string, now = Date.now()): string {
    const suffix = globalThis.crypto
      .randomUUID()
      .replace(/-/g, "")
      .slice(0, 8)
      .toUpperCase();

    return `${prefix}${now}-${suffix}`;
  }

  protected getCashierName(data: ReceiptData, fallback: string): string {
    if (typeof data.cashier === "string") {
      return data.cashier;
    }

    return data.cashier?.name || fallback;
  }

  protected getPaymentDetails(
    payment: ReceiptData["payment"],
  ): string | undefined {
    if (payment?.cardLast4) {
      return `**** ${payment.cardLast4}`;
    }

    return payment?.details;
  }

  /**
   * Walk a dotted required-field path without indexing a typed object by an
   * arbitrary string. Shared by every region's validateData, which used to
   * carry its own copy.
   */
  protected readFieldPath(data: ReceiptData, path: string): unknown {
    return path
      .split(".")
      .reduce<unknown>(
        (value, key) =>
          value && typeof value === "object"
            ? (value as Record<string, unknown>)[key]
            : undefined,
        data,
      );
  }

  protected formatCurrency(amount: number): string {
    return formatRegionMoney(amount, this.region);
  }

  /** A derived amount (tax from a rate) on the currency's precision. */
  protected roundMoney(amount: number): number {
    return roundMoney(amount, this.region.currency);
  }

  protected formatDate(date: Date): string {
    return date.toLocaleDateString(this.region.locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  protected formatTime(date: Date): string {
    return date.toLocaleTimeString(this.region.locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
}

export class TWReceiptFormatter extends BaseReceiptFormatter {
  formatReceipt(input: ReceiptInput): PrintContent {
    const data = this.getReceiptData(input);
    const order = data.order;
    const restaurant = data.restaurant;
    const payment = data.payment;
    const subtotal = order?.subtotal ?? 0;
    const taxAmount = order?.tax ?? this.roundMoney(subtotal * 0.05);

    return {
      header: {
        restaurantInfo: {
          name: restaurant?.name || "餐廳名稱",
          nameLocal: restaurant?.nameLocal,
          address: restaurant?.address || "餐廳地址",
          addressLocal: restaurant?.addressLocal,
          phone: restaurant?.phone || "電話號碼",
          taxNumber: restaurant?.taxNumber, // 統一編號
          licenseNumber: restaurant?.licenseNumber,
        },
        transactionInfo: {
          orderId: order?.id || "N/A",
          tableNumber: order?.tableNumber,
          deliveryAddress: order?.deliveryAddress,
          deliveryPhone: order?.deliveryPhone,
          customerName: data.customer?.name,
          cashier: this.getCashierName(data, "System"),
          timestamp: new Date(order?.createdAt || Date.now()),
          receiptNumber:
            data.receiptNumber || this.generateBusinessNumber("TW"),
        },
        logo: restaurant?.logo
          ? {
              type: "text",
              data: restaurant.logo,
              alignment: "center",
            }
          : undefined,
      },
      items:
        order?.items?.map((item: ReceiptOrderItem) => ({
          name: item.name,
          nameLocal: item.nameLocal,
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.quantity * item.price,
          modifiers: item.modifiers || [],
          category: item.category,
          taxRate: 0.05, // Taiwan VAT rate
        })) || [],
      summary: {
        currency: this.region.currency,
        subtotal,
        tax: [
          {
            name: "營業稅",
            rate: 0.05,
            amount: taxAmount,
            taxableAmount: subtotal,
          },
        ],
        deliveryFee: order?.deliveryFee,
        total: order?.total || 0,
        payment: payment
          ? [
              {
                method: this.translatePaymentMethod(payment.method || "cash"),
                amount: payment.amount || 0,
                details: this.getPaymentDetails(payment),
              },
            ]
          : [],
        change:
          payment?.change && payment.change > 0 ? payment.change : undefined,
      },
      footer: {
        thankYouMessage: "Thank you for your visit!",
        thankYouMessageLocal: "謝謝光臨！",
        promotionalMessage: restaurant?.promotionalMessage,
        qrCode: {
          data: `https://makanmasak.com/receipt/${order?.id || "unknown"}`,
          size: "medium",
          label: "數位收據",
        },
        legalNotice: "本收據為電子發票證明聯",
        contactInfo: {
          supportPhone: restaurant?.supportPhone,
          supportEmail: restaurant?.supportEmail,
          website: restaurant?.website || "https://makanmasak.com",
        },
      },
    };
  }

  validateData(data: ReceiptData): boolean {
    const required = this.getRequiredFields();
    return required.every((field) => {
      const value = this.readFieldPath(data, field);
      return value !== undefined && value !== null;
    });
  }

  getRequiredFields(): string[] {
    return [
      "restaurant.name",
      "restaurant.address",
      "order.id",
      "order.items",
      "order.total",
      "cashier.name",
    ];
  }

  private translatePaymentMethod(method: string): string {
    const translations: Record<string, string> = {
      cash: "現金",
      credit_card: "信用卡",
      debit_card: "金融卡",
      mobile_payment: "行動支付",
      e_wallet: "電子錢包",
    };

    return translations[method] || method;
  }
}

export class MYReceiptFormatter extends BaseReceiptFormatter {
  formatReceipt(input: ReceiptInput): PrintContent {
    const data = this.getReceiptData(input);
    const order = data.order;
    const restaurant = data.restaurant;
    const payment = data.payment;
    const subtotal = order?.subtotal ?? 0;
    const taxAmount = order?.tax ?? this.roundMoney(subtotal * 0.06);

    return {
      header: {
        restaurantInfo: {
          name: restaurant?.name || "Restaurant Name",
          nameLocal: restaurant?.nameLocal,
          address: restaurant?.address || "Restaurant Address",
          addressLocal: restaurant?.addressLocal,
          phone: restaurant?.phone || "Phone Number",
          licenseNumber: restaurant?.licenseNumber, // Business license
        },
        transactionInfo: {
          orderId: order?.id || "N/A",
          tableNumber: order?.tableNumber,
          deliveryAddress: order?.deliveryAddress,
          deliveryPhone: order?.deliveryPhone,
          customerName: data.customer?.name,
          cashier: this.getCashierName(data, "Cashier"),
          timestamp: new Date(order?.createdAt || Date.now()),
          receiptNumber: data.receiptNumber || `MY${Date.now()}`,
        },
      },
      items:
        order?.items?.map((item: ReceiptOrderItem) => ({
          name: item.name,
          nameLocal: item.nameLocal,
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.quantity * item.price,
          modifiers: item.modifiers || [],
          category: item.category,
          taxRate: 0.06, // Malaysia SST rate
        })) || [],
      summary: {
        currency: this.region.currency,
        subtotal,
        tax: [
          {
            name: "SST",
            rate: 0.06,
            amount: taxAmount,
            taxableAmount: subtotal,
          },
        ],
        deliveryFee: order?.deliveryFee,
        total: order?.total || 0,
        payment: payment
          ? [
              {
                method: this.translatePaymentMethod(payment.method || "cash"),
                amount: payment.amount || 0,
                details: this.getPaymentDetails(payment),
              },
            ]
          : [],
        change:
          payment?.change && payment.change > 0 ? payment.change : undefined,
      },
      footer: {
        thankYouMessage: "Thank you for dining with us!",
        thankYouMessageLocal: "Terima kasih kerana makan bersama kami!",
        qrCode: {
          data: `https://makanmasak.com/receipt/${order?.id || "unknown"}`,
          size: "medium",
          label: "Digital Receipt / Resit Digital",
        },
        legalNotice: "GST/SST No: 000123456789 | Company No: 123456-A",
        contactInfo: {
          supportPhone: restaurant?.supportPhone,
          supportEmail: restaurant?.supportEmail,
          website: restaurant?.website || "https://makanmasak.com",
        },
      },
    };
  }

  validateData(data: ReceiptData): boolean {
    const required = this.getRequiredFields();
    return required.every((field) => {
      const value = this.readFieldPath(data, field);
      return value !== undefined && value !== null;
    });
  }

  getRequiredFields(): string[] {
    return [
      "restaurant.name",
      "restaurant.address",
      "order.id",
      "order.items",
      "order.total",
      "cashier.name",
    ];
  }

  private translatePaymentMethod(method: string): string {
    const translations: Record<string, string> = {
      cash: "Tunai / Cash",
      credit_card: "Kad Kredit / Credit Card",
      debit_card: "Kad Debit / Debit Card",
      grabpay: "GrabPay",
      tng: "Touch 'n Go eWallet",
    };

    return translations[method] || method;
  }
}

export class VNReceiptFormatter extends BaseReceiptFormatter {
  formatReceipt(input: ReceiptInput): PrintContent {
    const data = this.getReceiptData(input);
    const order = data.order;
    const restaurant = data.restaurant;
    const payment = data.payment;
    const total = order?.total ?? 0;
    const subtotal = order?.subtotal ?? this.roundMoney(total / 1.1);
    const taxAmount = order?.tax ?? total - subtotal;

    return {
      header: {
        restaurantInfo: {
          name: restaurant?.name || "Tên nhà hàng",
          nameLocal: restaurant?.nameLocal,
          address: restaurant?.address || "Địa chỉ nhà hàng",
          addressLocal: restaurant?.addressLocal,
          phone: restaurant?.phone || "Số điện thoại",
          taxNumber: restaurant?.taxNumber, // Mã số thuế
        },
        transactionInfo: {
          orderId: order?.id || "N/A",
          tableNumber: order?.tableNumber,
          deliveryAddress: order?.deliveryAddress,
          deliveryPhone: order?.deliveryPhone,
          customerName: data.customer?.name,
          cashier: this.getCashierName(data, "Thu ngân"),
          timestamp: new Date(order?.createdAt || Date.now()),
          receiptNumber: data.receiptNumber || `VN${Date.now()}`,
        },
      },
      items:
        order?.items?.map((item: ReceiptOrderItem) => ({
          name: item.name,
          nameLocal: item.nameLocal,
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.quantity * item.price,
          modifiers: item.modifiers || [],
          category: item.category,
          taxRate: 0.1, // Vietnam VAT rate
        })) || [],
      summary: {
        currency: this.region.currency,
        subtotal,
        tax: [
          {
            name: "VAT",
            rate: 0.1,
            amount: taxAmount,
            taxableAmount: subtotal,
          },
        ],
        deliveryFee: order?.deliveryFee,
        total,
        payment: payment
          ? [
              {
                method: this.translatePaymentMethod(payment.method || "cash"),
                amount: payment.amount || 0,
                details: this.getPaymentDetails(payment),
              },
            ]
          : [],
        change:
          payment?.change && payment.change > 0 ? payment.change : undefined,
      },
      footer: {
        thankYouMessage: "Thank you for your visit!",
        thankYouMessageLocal: "Cảm ơn bạn đã ghé thăm!",
        qrCode: {
          data: `https://makanmasak.com/receipt/${order?.id || "unknown"}`,
          size: "medium",
          label: "Hóa đơn điện tử / Digital Receipt",
        },
        legalNotice: "Mã số thuế: 0123456789",
        contactInfo: {
          supportPhone: restaurant?.supportPhone,
          supportEmail: restaurant?.supportEmail,
          website: restaurant?.website || "https://makanmasak.com",
        },
      },
    };
  }

  validateData(data: ReceiptData): boolean {
    const required = this.getRequiredFields();
    return required.every((field) => {
      const value = this.readFieldPath(data, field);
      return value !== undefined && value !== null;
    });
  }

  getRequiredFields(): string[] {
    return [
      "restaurant.name",
      "restaurant.address",
      "order.id",
      "order.items",
      "order.total",
      "cashier.name",
    ];
  }

  private translatePaymentMethod(method: string): string {
    const translations: Record<string, string> = {
      cash: "Tiền mặt / Cash",
      credit_card: "Thẻ tín dụng / Credit Card",
      debit_card: "Thẻ ghi nợ / Debit Card",
      momo: "Ví MoMo",
      zalopay: "ZaloPay",
      vnpay: "VNPay",
    };

    return translations[method] || method;
  }
}

export class ReceiptFormatterFactory {
  private static formatters = new Map<
    CountryCode,
    new (region: RegionConfig, countryCode: CountryCode) => IReceiptFormatter
  >();

  static {
    // Register default formatters
    this.registerFormatter("TW", TWReceiptFormatter);
    this.registerFormatter("MY", MYReceiptFormatter);
    this.registerFormatter("VN", VNReceiptFormatter);
  }

  static registerFormatter(
    countryCode: CountryCode,
    formatterClass: new (
      region: RegionConfig,
      countryCode: CountryCode,
    ) => IReceiptFormatter,
  ): void {
    this.formatters.set(countryCode, formatterClass);
  }

  static createFormatter(
    countryCode: CountryCode,
    region: RegionConfig,
  ): IReceiptFormatter {
    // Validate countryCode against registered formatters (allowlist)
    if (!this.formatters.has(countryCode)) {
      throw new Error(
        `No formatter found for country code: ${String(countryCode)
          .replace(/[\r\n\t]/g, " ")
          .slice(0, 10)}`,
      );
    }

    const FormatterClass = this.formatters.get(countryCode)!;
    return new FormatterClass(region, countryCode);
  }

  static getSupportedCountries(): CountryCode[] {
    return Array.from(this.formatters.keys());
  }

  static hasFormatter(countryCode: CountryCode): boolean {
    return this.formatters.has(countryCode);
  }
}
