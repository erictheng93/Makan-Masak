import { isRecord } from "./unknown";

export type ErrorPresentation =
  | "dedicated"
  | "code"
  | "status"
  | "network"
  | "unknown";

export interface UserFacingError {
  message: string;
  code?: string;
  requestId?: string;
  presentation: ErrorPresentation;
}

export type ErrorTranslator = (key: string) => string;

export interface ResolveUserFacingErrorOptions {
  /**
   * Keys for actions with a dedicated recovery path. These are supplied by the
   * owning app so the shared resolver remains agnostic about UI workflows.
   */
  dedicatedCodeKeys?: Record<string, string>;
  /** Keys for reusable, actionable API error codes. */
  codeKeys?: Record<string, string>;
  /**
   * Per-status overrides for a screen where the shared copy is wrong. The one
   * that matters is 401 on a login form: everywhere else it means the session
   * lapsed, and there it means the password was rejected.
   */
  statusKeys?: Record<number, string>;
  /**
   * Key to use in place of the generic unknown copy, naming the action that
   * failed ("Saving the shift template failed").
   *
   * It replaces only the unknown branch. A classified error already says
   * something truer than the action name -- a 403 is "you lack permission",
   * not "saving failed" -- so those keep their own copy.
   */
  fallbackKey?: string;
}

type ParsedError = {
  code?: string;
  status?: number;
  requestId?: string;
  hasResponse: boolean;
};

const STATUS_KEYS: Record<number, string> = {
  400: "errorPresentation.invalidRequest",
  401: "errorPresentation.sessionExpired",
  403: "errorPresentation.permissionDenied",
  404: "errorPresentation.notFound",
  409: "errorPresentation.conflict",
  422: "errorPresentation.invalidRequest",
  429: "errorPresentation.tooManyRequests",
};

/** Keys every supported locale must provide before the resolver can ship. */
export const ERROR_PRESENTATION_KEYS = [
  "errorPresentation.invalidRequest",
  "errorPresentation.sessionExpired",
  "errorPresentation.permissionDenied",
  "errorPresentation.notFound",
  "errorPresentation.conflict",
  "errorPresentation.tooManyRequests",
  "errorPresentation.serviceUnavailable",
  "errorPresentation.network",
  "errorPresentation.timeout",
  "errorPresentation.unknown",
] as const;

const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT", "TIMEOUT"]);
const NETWORK_CODES = new Set(["ERR_NETWORK", "NETWORK_ERROR"]);

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!isRecord(headers)) return undefined;
  return stringValue(headers[name]) ?? stringValue(headers[name.toLowerCase()]);
}

/** Extract transport facts only. Deliberately does not read `message`. */
export function parseUserFacingError(error: unknown): ParsedError {
  if (!isRecord(error)) return { hasResponse: false };

  const response = isRecord(error.response) ? error.response : undefined;
  const body = response && isRecord(response.data) ? response.data : undefined;
  const envelope = body && isRecord(body.error) ? body.error : undefined;

  return {
    code:
      stringValue(envelope?.code) ??
      stringValue(body?.code) ??
      stringValue(error.code),
    status:
      typeof response?.status === "number"
        ? response.status
        : typeof error.status === "number"
          ? error.status
          : undefined,
    requestId:
      stringValue(envelope?.requestId) ??
      stringValue(body?.requestId) ??
      headerValue(response?.headers, "X-Request-ID") ??
      stringValue(error.requestId),
    hasResponse: response !== undefined,
  };
}

/**
 * Resolves UI copy from stable transport facts and localization keys. Server
 * prose is intentionally excluded: retain it at the caller only for logging
 * and telemetry, never presentation.
 */
export function resolveUserFacingError(
  error: unknown,
  translate: ErrorTranslator,
  options: ResolveUserFacingErrorOptions = {},
): UserFacingError {
  const parsed = parseUserFacingError(error);
  const withMessage = (key: string, presentation: ErrorPresentation) => ({
    message: translate(key),
    ...(parsed.code && { code: parsed.code }),
    ...(parsed.requestId && { requestId: parsed.requestId }),
    presentation,
  });

  /**
   * For the two answers that describe nothing: "the system cannot process this"
   * and "something went wrong". Both are an improvement for the person reading
   * them and a loss for whoever they then phone, who used to at least get the
   * server's sentence repeated back. The identifier is what makes the call
   * actionable -- brackets rather than 全形括號 because this string is appended
   * in every locale.
   */
  const withReference = (key: string, presentation: ErrorPresentation) => {
    const base = withMessage(key, presentation);
    const reference = parsed.requestId ?? parsed.code;
    return reference
      ? { ...base, message: `${base.message} [${reference}]` }
      : base;
  };

  if (parsed.code) {
    const dedicatedKey = options.dedicatedCodeKeys?.[parsed.code];
    if (dedicatedKey) return withMessage(dedicatedKey, "dedicated");

    const codeKey = options.codeKeys?.[parsed.code];
    if (codeKey) return withMessage(codeKey, "code");
  }

  // A CSRF 403 is not a permission problem: the session's CSRF cookie is gone
  // or stale, and signing in again issues a fresh one.
  if (parsed.code?.startsWith("CSRF_")) {
    return withMessage("errorPresentation.sessionExpired", "status");
  }

  if (parsed.code && TIMEOUT_CODES.has(parsed.code)) {
    return withMessage("errorPresentation.timeout", "network");
  }

  if (
    (parsed.code && NETWORK_CODES.has(parsed.code)) ||
    (!parsed.hasResponse && isRecord(error) && error.request !== undefined)
  ) {
    return withMessage("errorPresentation.network", "network");
  }

  if (parsed.status !== undefined) {
    const key =
      options.statusKeys?.[parsed.status] ?? STATUS_KEYS[parsed.status];
    if (key) return withMessage(key, "status");
    if (parsed.status >= 500) {
      return withReference("errorPresentation.serviceUnavailable", "status");
    }
    // A 4xx with no entry above (405, 410, 415, 418 …) falls through to the
    // unknown copy on purpose. Those statuses mean the request itself was
    // malformed by the client, not that the person using it typed something
    // wrong, so "check your input" would send them looking for a mistake they
    // cannot find. Reaching one is a bug worth the request id, not advice.
  }

  return withReference(
    options.fallbackKey ?? "errorPresentation.unknown",
    "unknown",
  );
}
