/**
 * 熱敏打印機系統類型定義
 * 支援多品牌打印機和多國發票格式
 */

import type { CountryCode, CurrencyCode } from "./payment";

// =============================================
// 打印機硬體相關類型
// =============================================

export type PrinterBrand = "epson" | "star" | "citizen" | "generic";
export type PrinterConnection = "usb" | "network" | "serial" | "bluetooth";
export type PrinterStatus =
  | "online"
  | "offline"
  | "error"
  | "paper_out"
  | "cover_open";

export interface PrinterDevice {
  id: string;
  name: string;
  brand: PrinterBrand;
  model: string;
  connection: PrinterConnection;
  address: string; // USB path, IP address, or serial port
  status: PrinterStatus;
  capabilities: PrinterCapabilities;
  lastSeen: Date;
  isDefault: boolean;
}

export interface PrinterCapabilities {
  maxWidth: number; // 字符寬度 (通常 32/48/64)
  supportsGraphics: boolean;
  supportsCutter: boolean;
  supportsDrawer: boolean; // 收銀櫃控制
  supportsQRCode: boolean;
  supportsBarcode: boolean;
  supportedEncodings: string[];
  paperSizes: PaperSize[];
}

export interface PaperSize {
  width: number; // mm
  height: number; // mm (0 for continuous)
  name: string; // '58mm', '80mm', etc.
}

// =============================================
// 打印作業相關類型
// =============================================

export type PrintJobStatus =
  | "pending"
  | "printing"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";
export type PrintJobType = "receipt" | "order" | "report" | "test";
export type PrintJobPriority = "low" | "normal" | "high" | "urgent";

export interface PrintJob {
  id: string;
  type: PrintJobType;
  priority: PrintJobPriority;
  status: PrintJobStatus;
  deviceId: string;
  content: PrintContent;
  options: PrintOptions;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  error?: PrintError;
  metadata?: {
    restaurantId?: string;
    orderId?: string;
    userId?: string;
    country?: CountryCode;
  };
}

export interface PrintOptions {
  copies: number;
  cutPaper: boolean;
  openDrawer: boolean;
  buzzer: boolean;
  feedLines: number; // 打印後走紙行數
}

export interface PrintError {
  code: string;
  message: string;
  timestamp?: Date;
  details?: unknown;
}

// =============================================
// 打印內容結構
// =============================================

export interface PrintContent {
  header: ReceiptHeader;
  items: ReceiptItem[];
  summary: ReceiptSummary;
  footer: ReceiptFooter;
  rawCommands?: PrintCommand[]; // 原始打印機命令
}

export interface ReceiptHeader {
  restaurantInfo: PrinterRestaurantInfo;
  transactionInfo: TransactionInfo;
  logo?: {
    type: "image" | "text";
    data: string;
    alignment: "left" | "center" | "right";
  };
}

export interface PrinterRestaurantInfo {
  name: string;
  nameLocal?: string; // 當地語言名稱
  address: string;
  addressLocal?: string;
  phone: string;
  email?: string;
  website?: string;
  taxNumber?: string; // 統編/GST號碼
  licenseNumber?: string; // 營業執照號
}

export interface TransactionInfo {
  orderId: string;
  tableNumber?: string;
  customerName?: string;
  /**
   * 外送單的送達地址與聯絡電話。KDS 螢幕看得到，但要出門送餐的人拿的是這張
   * 紙 —— 資訊得跟著單子走（#295）。非外送單為 undefined，不印。
   */
  deliveryAddress?: string;
  deliveryPhone?: string;
  cashier: string;
  timestamp: Date;
  receiptNumber: string;
  originalReceipt?: string; // 退款時原收據號
}

export interface ReceiptItem {
  name: string;
  nameLocal?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  modifiers?: ItemModifier[];
  category?: string;
  sku?: string;
  taxRate?: number;
  isRefund?: boolean;
}

export interface ItemModifier {
  name: string;
  nameLocal?: string;
  price: number;
}

export interface ReceiptSummary {
  /**
   * The currency every amount below is in. Set by the region formatter so a
   * driver that only sees the PrintContent can print "NT$350" rather than a
   * bare "350.00".
   */
  currency?: CurrencyCode;
  subtotal: number;
  tax: TaxBreakdown[];
  discount?: DiscountInfo;
  serviceCharge?: ServiceChargeInfo;
  tip?: number;
  /**
   * 外送費。自 #295 起它已計入 `total`，所以收據上必須看得到 —— 否則
   * 小計加稅對不上總額，那筆差額在紙上沒有出處（#348）。
   * 非外送單與 0 元一律不印。
   */
  deliveryFee?: number;
  total: number;
  payment: PaymentInfo[];
  change?: number;
}

export interface TaxBreakdown {
  name: string; // '營業稅', 'GST', 'VAT'
  rate: number; // 0.05, 0.06, 0.10
  amount: number;
  taxableAmount: number;
}

export interface DiscountInfo {
  name: string;
  type: "percentage" | "fixed";
  value: number;
  amount: number;
}

export interface ServiceChargeInfo {
  name: string;
  rate: number;
  amount: number;
}

export interface PaymentInfo {
  method: string; // '現金', '信用卡', '行動支付'
  amount: number;
  details?: string; // 卡號後四碼等
}

export interface ReceiptFooter {
  thankYouMessage: string;
  thankYouMessageLocal?: string;
  promotionalMessage?: string;
  qrCode?: QRCodeInfo;
  barcode?: BarcodeInfo;
  contactInfo?: ContactInfo;
  legalNotice?: string;
}

export interface QRCodeInfo {
  data: string;
  size: "small" | "medium" | "large";
  label?: string;
}

export interface BarcodeInfo {
  data: string;
  format: "CODE128" | "CODE39" | "EAN13" | "EAN8";
  label?: string;
}

export interface ContactInfo {
  supportPhone?: string;
  supportEmail?: string;
  website?: string;
  socialMedia?: {
    platform: string;
    handle: string;
  }[];
}

// =============================================
// 打印機命令類型
// =============================================

export type CommandType =
  | "text"
  | "line"
  | "cut"
  | "feed"
  | "image"
  | "barcode"
  | "qrcode"
  | "drawer"
  | "buzzer"
  | "raw";

export interface PrintCommand {
  type: CommandType;
  data: unknown;
  options?: {
    alignment?: "left" | "center" | "right";
    font?: "normal" | "bold" | "large";
    underline?: boolean;
    doubleHeight?: boolean;
    doubleWidth?: boolean;
  };
}

// =============================================
// 地區化配置
// =============================================

export interface RegionConfig {
  country: CountryCode;
  currency: CurrencyCode;
  locale: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  numberFormat: {
    decimal: string;
    thousand: string;
    currency: {
      symbol: string;
      position: "before" | "after";
      space: boolean;
    };
  };
  tax: TaxConfig;
  legal: LegalConfig;
  receipt: ReceiptConfig;
}

export interface TaxConfig {
  name: string;
  nameLocal: string;
  rate: number;
  inclusive: boolean; // 含稅或未稅價格
  displayFormat: string;
}

export interface LegalConfig {
  requiresTaxNumber: boolean;
  requiresLicense: boolean;
  invoiceFormat: "simple" | "detailed" | "government";
  retentionPeriod: number; // 保存期限 (天)
  electronicInvoice: boolean;
}

export interface ReceiptConfig {
  width: number; // 字符寬度
  headerLines: number;
  footerLines: number;
  itemNameMaxLength: number;
  showItemCodes: boolean;
  showTaxBreakdown: boolean;
  defaultFont: string;
  paperSize: string;
}

// =============================================
// 打印服務配置
// =============================================

export interface PrintServiceConfig {
  defaultDevice?: string | null;
  queue: {
    maxConcurrentJobs: number;
    maxRetries: number;
    retryDelay: number;
    jobTimeout: number;
    maxQueueSize: number;
  };
  drivers: {
    connectionTimeout: number;
    commandTimeout: number;
    heartbeatInterval: number;
    retryAttempts: number;
  };
  regions?: {
    default: CountryCode;
    supported: CountryCode[];
  };
  monitoring?: {
    healthCheckInterval: number;
    statisticsInterval: number;
    maxErrorHistory: number;
    alertThresholds: {
      errorRate: number;
      queueDepth: number;
      responseTime: number;
    };
  };
  cleanup?: {
    completedJobRetention: number;
    cleanupInterval: number;
  };
}

export interface ReceiptTemplate {
  id: string;
  name: string;
  description: string;
  country: CountryCode;
  type: PrintJobType;
  layout: TemplateLayout;
  styles: TemplateStyles;
}

export interface TemplateLayout {
  header: LayoutSection;
  items: LayoutSection;
  summary: LayoutSection;
  footer: LayoutSection;
}

export interface LayoutSection {
  show: boolean;
  order: number;
  spacing: number;
  alignment: "left" | "center" | "right";
  fields: string[];
}

export interface TemplateStyles {
  fonts: {
    normal: FontStyle;
    bold: FontStyle;
    large: FontStyle;
    title: FontStyle;
  };
  spacing: {
    line: number;
    section: number;
    item: number;
  };
  borders: {
    style: "none" | "dashed" | "solid";
    sections: string[];
  };
}

export interface FontStyle {
  size: "normal" | "large";
  bold: boolean;
  underline: boolean;
  doubleHeight: boolean;
  doubleWidth: boolean;
}

// =============================================
// API 請求/響應類型
// =============================================

export interface PrintRequest {
  country: CountryCode;
  type: PrintJobType;
  priority?: PrintJobPriority;
  deviceId?: string;
  templateId?: string;
  restaurantId?: string;
  userId?: string;
  data: {
    order: OrderData;
    customer?: CustomerData;
    payment?: PaymentData;
  };
  options?: Partial<PrintOptions>;
}

export interface OrderData {
  id: string;
  tableNumber?: string;
  /**
   * 外送單的送達資訊。`print/routes.ts` 的 `requestForReceipt` 送的就是這三個
   * 欄位，宣告在這裡是為了讓型別描述實際的線上格式 —— print-agent 收到
   * `req.body` 後只是 cast 成 PrintRequest，沒有 runtime schema 會補這個缺。
   */
  deliveryAddress?: string;
  deliveryPhone?: string;
  deliveryFee?: number;
  items: {
    name: string;
    quantity: number;
    price: number;
    modifiers?: {
      name: string;
      price: number;
    }[];
  }[];
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  createdAt: Date;
}

export interface CustomerData {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface PaymentData {
  method: string;
  amount: number;
  change?: number;
  cardLast4?: string;
  authCode?: string;
  transactionId: string;
}

export interface PrintResponse {
  success: boolean;
  jobId?: string;
  message?: string;
  error?: PrintError;
  estimatedTime?: number;
}

export interface PrintStatusResponse {
  jobId: string;
  status: PrintJobStatus;
  progress?: number;
  error?: PrintError;
  completedAt?: Date;
}

// =============================================
// 系統事件類型
// =============================================

export type PrinterEventType =
  | "device_connected"
  | "device_disconnected"
  | "device_error"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "paper_low"
  | "paper_out"
  | "cover_open";

export interface PrinterEvent {
  type: PrinterEventType;
  timestamp: Date;
  deviceId?: string;
  jobId?: string;
  data?: unknown;
  message?: string;
}

// =============================================
// 工具類型
// =============================================

export interface PrinterDriverConfig {
  brand: PrinterBrand;
  encoding: string;
  commandSet: "esc-pos" | "star-prnt" | "citizen";
  features: {
    cutter: boolean;
    drawer: boolean;
    buzzer: boolean;
    graphics: boolean;
  };
}

export interface ESCPOSCommand {
  name: string;
  code: number[];
  description: string;
}

// =============================================
// 統計和監控
// =============================================

export interface PrintStatistics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageJobTime: number;
  paperUsage: number;
  deviceUptime: number;
  errorRate: number;
  busyHours: {
    hour: number;
    jobCount: number;
  }[];
}

export interface PrinterHealth {
  deviceId: string;
  status: PrinterStatus;
  paperLevel: number; // 0-100%
  temperature: number;
  lastJobTime: Date;
  totalPrints: number;
  errorCount: number;
  maintenanceNeeded: boolean;
}
