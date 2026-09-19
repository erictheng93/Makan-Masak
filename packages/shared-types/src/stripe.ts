export interface StripeConfig {
  // 基本 API 金鑰
  publishableKey: string; // pk_test_... 或 pk_live_...
  secretKey: string; // sk_test_... 或 sk_live_...
  webhookSecret: string; // whsec_...

  // 帳戶設定
  accountId?: string; // acct_... (多帳戶時使用)
  applicationFee?: number; // 平台手續費百分比

  // 環境設定
  testMode: boolean;
  apiVersion: string; // Stripe API 版本

  // 國家特定設定
  country: "TW" | "MY" | "VN";
  currency: "TWD" | "MYR" | "VND";

  // 支付設定
  paymentMethodTypes: string[]; // ['card', 'alipay', 'grabpay']
  automaticTax: boolean; // 自動稅務計算

  // 3D Secure 設定
  requireAuthentication: "automatic" | "always" | "never";

  // 業務設定
  captureMethod: "automatic" | "manual"; // 自動扣款或手動確認
  confirmationMethod: "automatic" | "manual";

  // 本地化設定
  locale?: string; // 'zh-TW', 'en-MY', 'vi-VN'

  // 限制設定
  minimumAmount: number; // 最小支付金額
  maximumAmount: number; // 最大支付金額

  // 超時設定
  paymentTimeout: number; // 支付超時時間 (秒)
  webhookTimeout: number; // Webhook 超時時間 (秒)

  // 重試設定
  maxRetries: number;
  retryBackoffMs: number;

  // 風險管理
  radarRules?: string[]; // Stripe Radar 規則
  blockSuspiciousPayments: boolean;

  // 發票設定 (台灣特用)
  invoiceSettings?: {
    businessNumber: string; // 統一編號
    enableInvoiceGeneration: boolean;
    defaultInvoiceFormat: string;
  };
}

export interface StripePaymentIntentOptions {
  amount: number;
  currency: string;
  paymentMethodTypes?: string[];
  captureMethod?: "automatic" | "manual";
  confirmationMethod?: "automatic" | "manual";
  description?: string;
  metadata?: Record<string, string>;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  receiptEmail?: string;
  statementDescriptor?: string; // 帳單上顯示的描述
  applicationFeeAmount?: number; // 平台手續費金額
  transferGroup?: string;
  onBehalfOf?: string; // 代理帳戶
  setupFutureUsage?: "on_session" | "off_session";
  returnUrl?: string;
  automaticTax?: {
    enabled: boolean;
  };
}

export interface StripeWebhookEvent {
  id: string;
  object: "event";
  type: string;
  created: number;
  data: {
    object: unknown;
    previous_attributes?: unknown;
  };
  livemode: boolean;
  pending_webhooks: number;
  request?: {
    id: string;
    idempotency_key: string;
  };
}

export interface StripeErrorDetails {
  type:
    | "card_error"
    | "invalid_request_error"
    | "api_error"
    | "authentication_error"
    | "rate_limit_error";
  code?: string;
  decline_code?: string;
  param?: string;
  message: string;
  doc_url?: string;
  charge?: string;
  payment_intent?: {
    id: string;
    status: string;
  };
  payment_method?: {
    id: string;
    type: string;
  };
}

// Stripe 專用的支付方式映射
export const STRIPE_PAYMENT_METHOD_MAP = {
  credit_card: "card",
  debit_card: "card",
  alipay: "alipay",
  wechat_pay: "wechat_pay",
  grabpay: "grabpay",
  sepa_debit: "sepa_debit",
  ideal: "ideal",
  sofort: "sofort",
  bancontact: "bancontact",
  p24: "p24",
  eps: "eps",
  giropay: "giropay",
  oxxo: "oxxo",
} as const;

// 各國支援的 Stripe 支付方式
export const STRIPE_COUNTRY_METHODS = {
  TW: ["card", "alipay"],
  MY: ["card", "grabpay", "alipay"],
  VN: ["card", "alipay"],
} as const;

// Stripe amount units live in apps/api/src/shared/utils/provider-money.ts
// (TWD and MYR are two-decimal in Stripe, VND is zero-decimal). The table that
// used to sit here said TWD was zero-decimal, which would have charged 1/100
// of every TWD amount; nothing imported it.

export interface StripeCountryConfig {
  country: "TW" | "MY" | "VN";
  currency: "TWD" | "MYR" | "VND";
  supportedMethods: string[];
  minimumAmount: number; // 該貨幣的最小金額
  maximumAmount: number; // 該貨幣的最大金額
  feeStructure: {
    percentage: number; // 百分比手續費
    fixedAmount: number; // 固定手續費
  };
  taxRate: number; // 稅率
  requiresBusiness: boolean; // 是否需要商業註冊
  invoiceRequired: boolean; // 是否需要發票功能
  localRegulations: string[]; // 當地法規要求
}
