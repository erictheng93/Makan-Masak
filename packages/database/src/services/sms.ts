/**
 * SMS Provider Layer
 *
 * One interface, several vendors. The point of this module is that switching
 * SMS vendors is a config change (`SMS_PROVIDER=...` + credentials), never a
 * code change — so we can sign with whoever wins the price comparison without
 * touching any calling code.
 *
 * Supported vendors and where their wire formats come from:
 *
 *  - `twilio`  — REST API 2010-04-01 Messages.json (Basic auth, JSON response).
 *  - `mitake`  — 三竹 `/api/mtk/SmSend`. Status-code table transcribed from
 *                Mitake's own SDK: github.com/mitaketw/sms-java
 *                (`StatusCode.java`). Codes 0-4 are accepted/delivered,
 *                5-9 and any letter/`*` are failures.
 *  - `every8d` — API21 `sendSMS.ashx`. Wire format per the reference client
 *                github.com/minchao/go-every8d: HTTP is always 200; a body
 *                starting with `-` is `-<code>,<message>`, otherwise it is a
 *                single CSV row `credit,sent,cost,unsent,batchId`.
 *  - `noop`    — records nothing, sends nothing, always fails. Used so
 *                non-production environments can run without credentials while
 *                still making "no channel configured" explicit to the caller.
 *
 * Adding a vendor = implement `SmsProvider`, add one `case` to
 * `createSmsProvider`, add its credentials to `SmsProviderEnv`. Nothing else.
 */

// ========================================
// Types
// ========================================

export type SmsProviderName = "twilio" | "mitake" | "every8d" | "noop";

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** Vendor-specific status token, kept verbatim for log forensics. */
  providerCode?: string;
}

export interface SmsProvider {
  readonly name: SmsProviderName;
  /**
   * `to` is always E.164 (`+886912345678`). Each provider is responsible for
   * reformatting it into whatever its vendor expects.
   */
  sendSMS(params: { to: string; body: string }): Promise<SmsSendResult>;
}

/**
 * Every credential this module can consume. Kept as a standalone interface so
 * both the Worker `Env` and the database package's `CloudflareEnv` can satisfy
 * it structurally without either importing the other.
 */
export interface SmsProviderEnv {
  /**
   * Which vendor to use. Omit (or set `auto`) to pick the first vendor with
   * complete credentials, in cost order: mitake → every8d → twilio.
   */
  SMS_PROVIDER?: string;

  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;

  MITAKE_USERNAME?: string;
  MITAKE_PASSWORD?: string;
  /** Override for personal-tier accounts, which use a different host. */
  MITAKE_API_BASE?: string;

  EVERY8D_UID?: string;
  EVERY8D_PWD?: string;
  EVERY8D_API_BASE?: string;

  /** Test seam: injected in unit tests so no network call is made. */
  SMS_FETCH?: typeof fetch;
}

// ========================================
// Phone formatting
// ========================================

/**
 * E.164 → Taiwan local dialling format (`+886912345678` → `0912345678`).
 *
 * Mitake and Every8d are domestic carriers and expect the local format;
 * Twilio requires E.164. Anything that is not a +886 number is returned
 * unchanged, because sending it to a domestic-only vendor will fail at the
 * vendor anyway and we would rather see their error than mangle the number.
 */
export function toTaiwanLocalPhone(e164: string): string {
  if (e164.startsWith("+886")) return `0${e164.slice(4)}`;
  if (e164.startsWith("886")) return `0${e164.slice(3)}`;
  return e164;
}

// ========================================
// Twilio
// ========================================

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio" as const;

  constructor(
    private accountSid: string,
    private authToken: string,
    private fromPhone: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  // Detach before calling: `this.fetchImpl(...)` would invoke the Workers
  // global fetch with the provider as `this`, which workerd rejects with
  // "Illegal invocation" — every real SMS send would fail.
  private send(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    const fetchImpl = this.fetchImpl;
    return fetchImpl(...args);
  }

  async sendSMS(params: { to: string; body: string }): Promise<SmsSendResult> {
    try {
      const auth = btoa(`${this.accountSid}:${this.authToken}`);

      const response = await this.send(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: params.to,
            From: this.fromPhone,
            Body: params.body,
          }),
        },
      );

      const data = (await response.json()) as {
        message?: string;
        sid?: string;
        code?: number;
      };

      if (!response.ok) {
        return {
          success: false,
          error: data.message || `Twilio HTTP ${response.status}`,
          providerCode: data.code != null ? String(data.code) : undefined,
        };
      }

      return { success: true, messageId: data.sid };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  }
}

// ========================================
// Mitake (三竹)
// ========================================

/**
 * Send-acknowledgement codes that mean the message was accepted. From
 * Mitake's own SDK: 0 預約傳送中, 1/2/3 已送達業者, 4 已送達手機.
 * Everything else (5-9, `*`, and any letter) is a failure.
 */
const MITAKE_SUCCESS_CODES = new Set(["0", "1", "2", "3", "4"]);

/** Transcribed from mitaketw/sms-java `StatusCode.java`. */
const MITAKE_STATUS_MESSAGES: Record<string, string> = {
  "*": "系統發生錯誤，請聯絡三竹資訊窗口人員",
  a: "簡訊發送功能暫時停止服務，請稍候再試",
  b: "簡訊發送功能暫時停止服務，請稍候再試",
  c: "請輸入帳號",
  d: "請輸入密碼",
  e: "帳號、密碼錯誤",
  f: "帳號已過期",
  h: "帳號已被停用",
  k: "無效的連線位址",
  m: "必須變更密碼，在變更密碼前，無法使用簡訊發送服務",
  n: "密碼已逾期，在變更密碼前，將無法使用簡訊發送服務",
  p: "沒有權限使用外部Http程式",
  r: "系統暫停服務，請稍後再試",
  s: "帳務處理失敗，無法發送簡訊",
  t: "簡訊已過期",
  u: "簡訊內容不得為空白",
  v: "無效的手機號碼",
  "5": "內容有錯誤",
  "6": "門號有錯誤",
  "7": "簡訊已停用",
  "8": "逾時無送達",
  "9": "預約已取消",
};

export class MitakeSmsProvider implements SmsProvider {
  readonly name = "mitake" as const;

  constructor(
    private username: string,
    private password: string,
    private apiBase: string = "https://smsapi.mitake.com.tw",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  // Detach before calling: `this.fetchImpl(...)` would invoke the Workers
  // global fetch with the provider as `this`, which workerd rejects with
  // "Illegal invocation" — every real SMS send would fail.
  private send(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    const fetchImpl = this.fetchImpl;
    return fetchImpl(...args);
  }

  async sendSMS(params: { to: string; body: string }): Promise<SmsSendResult> {
    try {
      // Credentials go in the query string (Mitake's documented scheme); the
      // message body goes in the form body so long/multibyte content is not
      // subject to URL length limits.
      const url = new URL(`${this.apiBase}/api/mtk/SmSend`);
      url.searchParams.set("CharsetURL", "UTF8");
      url.searchParams.set("username", this.username);
      url.searchParams.set("password", this.password);

      const response = await this.send(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          dstaddr: toTaiwanLocalPhone(params.to),
          smbody: params.body,
        }),
      });

      const text = await response.text();

      if (!response.ok) {
        return { success: false, error: `Mitake HTTP ${response.status}` };
      }

      const parsed = parseMitakeResponse(text);
      const statusCode = parsed.statuscode;

      if (!statusCode) {
        return {
          success: false,
          error: `Mitake returned no statuscode: ${truncate(text, 200)}`,
        };
      }

      if (!MITAKE_SUCCESS_CODES.has(statusCode)) {
        return {
          success: false,
          providerCode: statusCode,
          error:
            MITAKE_STATUS_MESSAGES[statusCode] ??
            `Mitake statuscode=${statusCode}`,
        };
      }

      return {
        success: true,
        messageId: parsed.msgid,
        providerCode: statusCode,
      };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  }
}

/**
 * Mitake replies with a `[n]`-delimited block of `key=value` lines:
 *
 *   [1]
 *   msgid=1234567890
 *   statuscode=1
 *   AccountPoint=98
 *
 * We only ever send one message per call, so flattening every `key=value` line
 * into a single record is sufficient.
 */
function parseMitakeResponse(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("[")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    parsed[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return parsed;
}

// ========================================
// Every8d
// ========================================

export class Every8dSmsProvider implements SmsProvider {
  readonly name = "every8d" as const;

  constructor(
    private uid: string,
    private pwd: string,
    private apiBase: string = "https://oms.every8d.com",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  // Detach before calling: `this.fetchImpl(...)` would invoke the Workers
  // global fetch with the provider as `this`, which workerd rejects with
  // "Illegal invocation" — every real SMS send would fail.
  private send(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    const fetchImpl = this.fetchImpl;
    return fetchImpl(...args);
  }

  async sendSMS(params: { to: string; body: string }): Promise<SmsSendResult> {
    try {
      const response = await this.send(
        `${this.apiBase}/API21/HTTP/sendSMS.ashx`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            UID: this.uid,
            PWD: this.pwd,
            SB: "",
            MSG: params.body,
            DEST: toTaiwanLocalPhone(params.to),
          }),
        },
      );

      const text = (await response.text()).trim();

      // Every8d answers 200 for errors too; the body is the status channel.
      if (!response.ok) {
        return { success: false, error: `Every8d HTTP ${response.status}` };
      }

      if (text.startsWith("-")) {
        const [code, ...rest] = text.split(",");
        return {
          success: false,
          providerCode: code,
          error: rest.join(",").trim() || `Every8d error ${code}`,
        };
      }

      // credit,sent,cost,unsent,batchId
      const fields = text.split(",");
      if (fields.length < 5) {
        return {
          success: false,
          error: `Every8d unexpected response: ${truncate(text, 200)}`,
        };
      }

      const sent = Number.parseInt(fields[1], 10);
      if (!Number.isFinite(sent) || sent < 1) {
        return {
          success: false,
          error: `Every8d accepted 0 messages (unsent=${fields[3]})`,
        };
      }

      return { success: true, messageId: fields[4]?.trim() };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  }
}

// ========================================
// Noop
// ========================================

/**
 * Always fails. Exists so that "no SMS vendor is configured" is a first-class,
 * observable state rather than a silent no-op — the failure mode that made
 * production OTP unusable in the first place.
 */
export class NoopSmsProvider implements SmsProvider {
  readonly name = "noop" as const;

  async sendSMS(): Promise<SmsSendResult> {
    return {
      success: false,
      error: "No SMS provider configured (SMS_PROVIDER is unset or 'noop')",
    };
  }
}

// ========================================
// Factory
// ========================================

function hasTwilio(env: SmsProviderEnv): boolean {
  return Boolean(
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER,
  );
}

function hasMitake(env: SmsProviderEnv): boolean {
  return Boolean(env.MITAKE_USERNAME && env.MITAKE_PASSWORD);
}

function hasEvery8d(env: SmsProviderEnv): boolean {
  return Boolean(env.EVERY8D_UID && env.EVERY8D_PWD);
}

/**
 * Resolve which vendor `createSmsProvider` would build, without building it.
 *
 * `auto` (the default) prefers the domestic vendors over Twilio because
 * Twilio bills domestic TW traffic at international rates.
 */
export function resolveSmsProviderName(env: SmsProviderEnv): SmsProviderName {
  const configured = env.SMS_PROVIDER?.trim().toLowerCase();

  if (configured && configured !== "auto") {
    if (
      configured === "twilio" ||
      configured === "mitake" ||
      configured === "every8d" ||
      configured === "noop"
    ) {
      return configured;
    }
    // An unrecognised value is a deploy-config typo. Failing closed to noop
    // surfaces it at the first send instead of silently falling back to a
    // vendor the operator did not choose (and did not budget for).
    return "noop";
  }

  if (hasMitake(env)) return "mitake";
  if (hasEvery8d(env)) return "every8d";
  if (hasTwilio(env)) return "twilio";
  return "noop";
}

/**
 * Build the configured provider.
 *
 * An explicitly-selected vendor with missing credentials returns
 * `NoopSmsProvider` rather than throwing, so a misconfigured deploy degrades
 * to a clear per-request error instead of a Worker-wide crash.
 */
export function createSmsProvider(env: SmsProviderEnv): SmsProvider {
  const fetchImpl = env.SMS_FETCH ?? fetch;

  switch (resolveSmsProviderName(env)) {
    case "mitake":
      if (!hasMitake(env)) return new NoopSmsProvider();
      return new MitakeSmsProvider(
        env.MITAKE_USERNAME!,
        env.MITAKE_PASSWORD!,
        env.MITAKE_API_BASE || undefined,
        fetchImpl,
      );

    case "every8d":
      if (!hasEvery8d(env)) return new NoopSmsProvider();
      return new Every8dSmsProvider(
        env.EVERY8D_UID!,
        env.EVERY8D_PWD!,
        env.EVERY8D_API_BASE || undefined,
        fetchImpl,
      );

    case "twilio":
      if (!hasTwilio(env)) return new NoopSmsProvider();
      return new TwilioSmsProvider(
        env.TWILIO_ACCOUNT_SID!,
        env.TWILIO_AUTH_TOKEN!,
        env.TWILIO_PHONE_NUMBER!,
        fetchImpl,
      );

    case "noop":
    default:
      return new NoopSmsProvider();
  }
}

/** True when a real vendor is wired up and usable. */
export function isSmsConfigured(env: SmsProviderEnv): boolean {
  return createSmsProvider(env).name !== "noop";
}

// ========================================
// Helpers
// ========================================

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown SMS error";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
