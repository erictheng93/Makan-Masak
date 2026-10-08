import { useToast } from "vue-toastification";
import { apiUrl } from "@/services/api-url";
import { t } from "@/i18n";
import { getAuthToken } from "@/utils/authTokenProvider";

const toast = useToast();

type AuthRefreshHandler = () => Promise<boolean>;

let authRefreshHandler: AuthRefreshHandler | undefined;

export function setAuthRefreshHandler(handler: AuthRefreshHandler): void {
  authRefreshHandler = handler;
}

// 錯誤類型定義
export enum ErrorType {
  NETWORK = "network",
  API = "api",
  SSE = "sse",
  VALIDATION = "validation",
  PERMISSION = "permission",
  // 訂閱 / 方案問題（moduleGate 中介層回的 403）。刻意與 PERMISSION 分開：
  // 這不是「權限不足或登入已過期」，使用者的登入狀態是好的，該做的是
  // 升級方案或聯絡客服，因此不可觸發任何登出 / 導向登入頁的流程。
  SUBSCRIPTION = "subscription",
  UNKNOWN = "unknown",
}

/**
 * apps/api/src/middleware/moduleGate.ts 會以 403 + 這些 code 回應。
 * 它們代表「方案/訂閱」問題，不是授權問題。
 */
export const SUBSCRIPTION_ERROR_CODES = [
  "SUBSCRIPTION_NOT_FOUND",
  "MODULE_NOT_ENABLED",
  "NO_RESTAURANT",
] as const;

export type SubscriptionErrorCode = (typeof SUBSCRIPTION_ERROR_CODES)[number];

export function isSubscriptionErrorCode(
  code: unknown,
): code is SubscriptionErrorCode {
  return (
    typeof code === "string" &&
    (SUBSCRIPTION_ERROR_CODES as readonly string[]).includes(code)
  );
}

/**
 * Error codes whose recovery is already rendered by a view-level panel.
 * The global interceptor still logs/parses them, but it must not add a second
 * generic toast on top of that dedicated UI.
 */
export const DEDICATED_UI_ERROR_CODES = [
  "COUPON_CODE_EXISTS",
  "MENU_ITEM_MODIFIED",
  "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS",
  "GROUP_ORDER_FINALIZATION_RECOVERY_RECLAIMED",
] as const;

export type DedicatedUiErrorCode = (typeof DEDICATED_UI_ERROR_CODES)[number];

export function isDedicatedUiErrorCode(
  code: unknown,
): code is DedicatedUiErrorCode {
  return (
    typeof code === "string" &&
    (DEDICATED_UI_ERROR_CODES as readonly string[]).includes(code)
  );
}

/**
 * 被 throw / reject 的值可以是任何東西 —— axios error、Error、本檔產生的
 * ErrorDetails，或一個裸值。要讀它的欄位就得先確認它真的是物件。
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 從統一錯誤信封 `{ success: false, error: { code, message } }` 取出
 * 機器可讀的 error code。舊路由可能還把 error 當字串回，這時沒有 code。
 *
 * 同時接受原始 axios error 與包了一層 originalError 的形狀。auth-client 的
 * 攔截器現在一律 reject 原始 axios error（它曾經改用 errorHandler 的回傳值，
 * 那個物件沒有 response，把所有依 code 分支的復原 UI 都關掉了），所以第二
 * 層在目前的資料流下用不到 —— 留著只是為了不因呼叫端換包裝而再度失靈。
 */
export function extractApiErrorCode(error: unknown): string | undefined {
  for (const candidate of [error, asRecord(error)?.originalError]) {
    const response = asRecord(asRecord(candidate)?.response);
    const apiError = asRecord(asRecord(response?.data)?.error);
    if (typeof apiError?.code === "string") {
      return apiError.code;
    }
  }
  return undefined;
}

/**
 * 每個訂閱錯誤 code 對應一句在地化、可行動的說明。
 * 刻意用 switch + 字面 key（而非樣板字串）以便 i18n parity 測試能靜態掃到。
 */
function subscriptionErrorMessage(code: SubscriptionErrorCode): string {
  switch (code) {
    case "SUBSCRIPTION_NOT_FOUND":
      return t("errors.subscription.subscriptionNotFound");
    case "MODULE_NOT_ENABLED":
      return t("errors.subscription.moduleNotEnabled");
    case "NO_RESTAURANT":
      return t("errors.subscription.noRestaurant");
  }
}

export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export interface ErrorDetails {
  type: ErrorType;
  severity: ErrorSeverity;
  code?: string | number;
  message: string;
  originalError?: unknown;
  context?: Record<string, unknown>;
  timestamp: Date;
  userAgent?: string;
  url?: string;
  userId?: number | string;
  restaurantId?: string;
}

// 離線狀態管理
class OfflineManager {
  private isOnline = navigator.onLine;
  private callbacks: Array<(isOnline: boolean) => void> = [];
  private pendingRequests: Array<() => Promise<unknown>> = [];

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    window.addEventListener("online", () => {
      this.isOnline = true;
      this.notifyCallbacks();
      this.processPendingRequests();
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.notifyCallbacks();
    });
  }

  private notifyCallbacks() {
    this.callbacks.forEach((callback) => callback(this.isOnline));
  }

  private async processPendingRequests() {
    const requests = [...this.pendingRequests];
    this.pendingRequests = [];

    for (const request of requests) {
      try {
        await request();
      } catch (error) {
        console.error("Failed to process pending request:", error);
        // 重新加入失敗的請求
        this.pendingRequests.push(request);
      }
    }
  }

  // Transitions only. This used to invoke the callback once on registration
  // "to report the current state", which meant every app boot fired the
  // online branch and told the user their connection had been restored from
  // an outage that never happened. Callers that want the current value read
  // getStatus() instead — it has always been there.
  onStatusChange(callback: (isOnline: boolean) => void) {
    this.callbacks.push(callback);
  }

  addPendingRequest(request: () => Promise<unknown>) {
    this.pendingRequests.push(request);
  }

  getStatus() {
    return this.isOnline;
  }
}

// 錯誤上報服務
class ErrorReportingService {
  private readonly REPORT_ENDPOINT = apiUrl(
    "/system/error-report",
    import.meta.env.VITE_API_BASE_URL,
  );
  private readonly MAX_RETRIES = 3;
  private readonly MAX_QUEUE_SIZE = 50;
  private reportQueue: ErrorDetails[] = [];
  private isReporting = false;
  private retryCount = 0;

  async reportError(error: ErrorDetails) {
    if (this.reportQueue.length >= this.MAX_QUEUE_SIZE) {
      this.reportQueue.shift();
    }

    this.reportQueue.push({
      ...error,
      userAgent: navigator.userAgent,
      url: window.location.href,
    });

    if (!this.isReporting) {
      this.processReportQueue();
    }
  }

  private async processReportQueue() {
    if (this.reportQueue.length === 0 || this.retryCount >= this.MAX_RETRIES) {
      if (this.retryCount >= this.MAX_RETRIES) {
        this.reportQueue = [];
        this.retryCount = 0;
      }
      this.isReporting = false;
      return;
    }

    this.isReporting = true;

    try {
      const errors = [...this.reportQueue];
      this.reportQueue = [];

      const csrfToken = document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf_token="))
        ?.split("=")[1];
      const response = await fetch(this.REPORT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getAuthToken()
            ? { Authorization: `Bearer ${getAuthToken()}` }
            : {}),
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify({ errors }),
      });

      if (!response.ok) {
        this.reportQueue.unshift(...errors);
        throw new Error(`Report failed: ${response.status}`);
      }

      this.retryCount = 0;
    } catch {
      this.retryCount++;
      if (this.retryCount < this.MAX_RETRIES) {
        const delay = Math.min(
          30000 * Math.pow(2, this.retryCount - 1),
          120000,
        );
        setTimeout(() => void this.processReportQueue(), delay);
        return;
      }
      this.reportQueue = [];
      this.retryCount = 0;
    }

    this.isReporting = false;
  }
}

// 主要錯誤處理器
export class ErrorHandler {
  private static instance: ErrorHandler;
  public offlineManager = new OfflineManager();
  public reportingService = new ErrorReportingService();
  public userNotificationEnabled = true;

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  // 處理一般錯誤
  handleError(error: unknown, context?: Record<string, unknown>): ErrorDetails {
    const errorDetails = this.parseError(error, context);

    // 記錄錯誤
    console.error("Error handled:", errorDetails);

    // 上報錯誤（高嚴重性）
    if (
      errorDetails.severity === ErrorSeverity.HIGH ||
      errorDetails.severity === ErrorSeverity.CRITICAL
    ) {
      this.reportingService.reportError(errorDetails);
    }

    // 顯示用戶提示
    if (this.userNotificationEnabled) {
      this.showUserNotification(errorDetails);
    }

    return errorDetails;
  }

  // 解析錯誤
  private parseError(
    error: unknown,
    context?: Record<string, unknown>,
  ): ErrorDetails {
    let type = ErrorType.UNKNOWN;
    let severity = ErrorSeverity.MEDIUM;
    let message = "發生了未知錯誤";
    let code: string | number | undefined;

    // Error 實例也是物件，所以 asRecord 一樣能讀到它的 name / message。
    const record = asRecord(error);

    // 根據錯誤類型進行分類
    if (error instanceof TypeError || error instanceof ReferenceError) {
      severity = ErrorSeverity.CRITICAL;
    } else if (
      record?.name === "NetworkError" ||
      record?.code === "NETWORK_ERROR"
    ) {
      type = ErrorType.NETWORK;
      severity = ErrorSeverity.HIGH;
      message = "網絡連接錯誤，請檢查您的網絡連接";
    } else if (record?.response) {
      // API 錯誤 — unified format: { success: false, error: { code, message } }
      type = ErrorType.API;
      const response = asRecord(record.response);
      const status = response?.status;
      code =
        typeof status === "number" || typeof status === "string"
          ? status
          : undefined;
      const apiError = asRecord(response?.data)?.error;
      const apiErrorMessage = asRecord(apiError)?.message;
      if (typeof apiError === "object" && apiError !== null) {
        message =
          typeof apiErrorMessage === "string" && apiErrorMessage
            ? apiErrorMessage
            : "服務器錯誤";
      } else if (typeof apiError === "string") {
        // Backward compatibility: un-migrated routes may still return error as string
        message = apiError || "服務器錯誤";
      } else {
        message = "服務器錯誤";
      }

      const apiErrorCode = extractApiErrorCode(error);

      if (typeof code === "number" && code >= 500) {
        severity = ErrorSeverity.HIGH;
      } else if (code === 403 && isSubscriptionErrorCode(apiErrorCode)) {
        // 訂閱 / 方案問題：登入狀態正常，別誤報成「權限不足或登入已過期」。
        type = ErrorType.SUBSCRIPTION;
        severity = ErrorSeverity.MEDIUM;
        message = subscriptionErrorMessage(apiErrorCode);
      } else if (code === 403 || code === 401) {
        type = ErrorType.PERMISSION;
        severity = ErrorSeverity.MEDIUM;
        message = "權限不足或登入已過期";
      }
    } else if (typeof record?.message === "string" && record.message) {
      message = record.message;
    }

    return {
      type,
      severity,
      code,
      message,
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 已知的背景遙測 / 健康檢查 endpoint — 即使後端回 5xx 也不該彈
  // toast 干擾使用者，這些訊號自有專屬的 widget 顯示（例如儀表板的
  // 「系統健康狀態」區塊已經以警告燈號呈現 /monitoring/health 的結果）。
  private static readonly SILENT_ERROR_URL_PATTERNS: readonly string[] = [
    "/monitoring/health",
    "/monitoring/metrics",
    // The monitoring dashboard's refresh moved from /metrics to /overview and
    // its alert feed polls /alerts/recent. Both run on a timer, so a global
    // toast here would fire once a minute for as long as an outage lasts. The
    // view raises one toast on the transition into failure and then lets its
    // ageing "last update" clock carry the signal.
    "/monitoring/overview",
    "/monitoring/alerts/recent",
    "/analytics/performance",
    "/system/error-report",
  ];

  private isSilentTelemetryError(error: ErrorDetails): boolean {
    const url = (error.context?.url as string | undefined) ?? "";
    return ErrorHandler.SILENT_ERROR_URL_PATTERNS.some((pattern) =>
      url.includes(pattern),
    );
  }

  private hasDedicatedRecoveryUi(error: ErrorDetails): boolean {
    return isDedicatedUiErrorCode(extractApiErrorCode(error));
  }

  // 顯示用戶提示
  private showUserNotification(error: ErrorDetails) {
    if (
      this.isSilentTelemetryError(error) ||
      this.hasDedicatedRecoveryUi(error)
    ) {
      return;
    }

    // 在登入頁或尚無 token 時抑制「權限不足」toast — 這些是預期中的
    // 401/403 (例如初次進站觸發受保護 API 的 auto-refetch)，不應當成錯誤顯示。
    if (error.type === ErrorType.PERMISSION) {
      const onLoginPage =
        typeof window !== "undefined" &&
        window.location?.pathname?.startsWith("/login");
      const hasToken = !!getAuthToken();
      if (onLoginPage || !hasToken) {
        return;
      }
    }

    const duration = error.severity === ErrorSeverity.HIGH ? 8000 : 4000;

    if (error.severity === ErrorSeverity.CRITICAL) {
      toast.error(`嚴重錯誤: ${error.message}`, { timeout: false });
    } else if (error.severity === ErrorSeverity.HIGH) {
      toast.error(`系統錯誤: ${error.message}`, { timeout: duration });
    } else {
      if (error.severity === ErrorSeverity.LOW) {
        toast.warning(error.message, { timeout: duration });
      } else {
        toast.error(error.message, { timeout: duration });
      }
    }
  }

  // 設置用戶通知狀態
  setUserNotificationEnabled(enabled: boolean) {
    this.userNotificationEnabled = enabled;
  }

  // 獲取離線管理器
  getOfflineManager() {
    return this.offlineManager;
  }
}

// 廚房專用錯誤處理器
export class KitchenErrorHandler extends ErrorHandler {
  private sseReconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // 1秒

  static handleSSEError(error: Event, eventSource?: EventSource) {
    const handler = ErrorHandler.getInstance() as KitchenErrorHandler;
    return handler.handleSSEConnectionError(error, eventSource);
  }

  static handleAPIError(error: unknown, context?: Record<string, unknown>) {
    const handler = ErrorHandler.getInstance();
    return handler.handleError(error, context);
  }

  // 處理 SSE 連接錯誤
  handleSSEConnectionError(error: Event, eventSource?: EventSource): void {
    const errorDetails: ErrorDetails = {
      type: ErrorType.SSE,
      severity: ErrorSeverity.HIGH,
      message: "SSE 連接中斷",
      originalError: error,
      context: {
        readyState: eventSource?.readyState,
        url: eventSource?.url,
        reconnectAttempts: this.sseReconnectAttempts,
      },
      timestamp: new Date(),
    };

    console.error("SSE Connection Error:", errorDetails);

    // 上報錯誤
    this.reportingService.reportError(errorDetails);

    // 顯示連接狀態
    if (this.userNotificationEnabled) {
      toast.warning("實時連接中斷，正在嘗試重新連接...", { timeout: 3000 });
    }

    // 自動重連
    this.attemptSSEReconnect(eventSource);
  }

  // SSE 自動重連
  private attemptSSEReconnect(_eventSource?: EventSource) {
    if (this.sseReconnectAttempts >= this.maxReconnectAttempts) {
      toast.error("連接失敗: 無法重新建立實時連接，請刷新頁面", {
        timeout: false,
      });
      return;
    }

    this.sseReconnectAttempts++;

    // 指數退避重連策略
    const delay =
      this.reconnectDelay * Math.pow(2, this.sseReconnectAttempts - 1);

    setTimeout((): void => {
      try {
        console.log(
          `Attempting SSE reconnection ${this.sseReconnectAttempts}/${this.maxReconnectAttempts}`,
        );

        // 重新建立 SSE 連接的邏輯應該由呼叫方提供
        // 這裡觸發一個自定義事件，讓元件處理重連
        window.dispatchEvent(
          new CustomEvent("sse-reconnect-attempt", {
            detail: {
              attempt: this.sseReconnectAttempts,
              maxAttempts: this.maxReconnectAttempts,
            },
          }),
        );
      } catch (error) {
        console.error("SSE reconnection failed:", error);
        this.attemptSSEReconnect();
      }
    }, delay);
  }

  // 重置 SSE 重連計數
  resetSSEReconnectAttempts() {
    this.sseReconnectAttempts = 0;
  }

  // 設置 SSE 連接成功
  setSSEConnected(_eventSource: EventSource) {
    // Store event source reference if needed
    this.resetSSEReconnectAttempts();

    if (this.sseReconnectAttempts > 0) {
      toast.success("實時連接已恢復", { timeout: 2000 });
    }
  }

  // 處理 API 請求錯誤
  // 三條分支都只 reject，沒有任何 resolve 路徑，所以是 Promise<never>。
  handleAPIRequest(
    error: unknown,
    context?: Record<string, unknown>,
  ): Promise<never> {
    const errorDetails = this.handleError(error, context);

    // 如果是網絡錯誤且處於離線狀態
    if (
      errorDetails.type === ErrorType.NETWORK &&
      !this.offlineManager.getStatus()
    ) {
      return this.handleOfflineRequest(error, context);
    }

    // 如果是權限錯誤，嘗試刷新 token
    if (
      errorDetails.type === ErrorType.PERMISSION &&
      errorDetails.code === 401
    ) {
      return this.handleTokenRefresh(error, context);
    }

    return Promise.reject(errorDetails);
  }

  // 處理離線請求
  private handleOfflineRequest(
    _originalError: unknown,
    _context?: Record<string, unknown>,
  ): Promise<never> {
    const toast = useToast();
    toast.warning("當前網絡不可用，請求將在網絡恢復後重新嘗試");

    return new Promise<never>((_resolve, reject) => {
      // 創建重試請求函數
      const retryRequest = async () => {
        try {
          // 這裡應該重新執行原始請求
          // 實際實現需要根據具體的 API 客戶端來決定
          console.log("Retrying request after network recovery:", _context);
          // resolve(retriedResult)
          reject(new Error("Request retry not implemented"));
        } catch (error) {
          reject(error);
        }
      };

      // 添加到離線隊列
      this.offlineManager.addPendingRequest(retryRequest);
    });
  }

  // 處理 Token 刷新
  private async handleTokenRefresh(
    _originalError: unknown,
    _context?: Record<string, unknown>,
  ): Promise<never> {
    try {
      const success = authRefreshHandler ? await authRefreshHandler() : false;

      if (success) {
        const toast = useToast();
        toast.info("登入狀態已更新，請重新嘗試");
        // 這裡應該重新執行原始請求
        return Promise.reject(new Error("Please retry the request"));
      } else {
        // Token 刷新失敗，跳轉到登入頁
        toast.error("登入已過期，請重新登入", { timeout: 5000 });
        window.location.href = "/login";
        return Promise.reject(_originalError);
      }
    } catch (error) {
      console.error("Token refresh failed:", error);
      return Promise.reject(_originalError);
    }
  }
}

// 導出單例實例
export const errorHandler = ErrorHandler.getInstance();

// 全局錯誤處理器
export function setupGlobalErrorHandler() {
  // 處理未捕獲的 Promise 錯誤
  window.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent): void => {
      console.error("Unhandled promise rejection:", event.reason);
      errorHandler.handleError(event.reason, { type: "unhandledRejection" });
      event.preventDefault(); // 防止錯誤在控制台顯示
    },
  );

  // 處理未捕獲的 JavaScript 錯誤
  window.addEventListener("error", (event: ErrorEvent): void => {
    console.error("Unhandled error:", event.error);
    errorHandler.handleError(event.error, {
      type: "globalError",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  // 監聽網絡狀態變化
  // The two strings live under `exampleUsage` because that is where they were
  // first added; they are the only translated pair for this event, so reuse
  // them rather than growing a seventh copy across six locale files.
  errorHandler.getOfflineManager().onStatusChange((isOnline: boolean): void => {
    if (isOnline) {
      toast.success(t("exampleUsage.networkRestored"), { timeout: 2000 });
    } else {
      toast.warning(t("exampleUsage.networkDisconnected"), { timeout: false });
    }
  });
}

export default ErrorHandler;
