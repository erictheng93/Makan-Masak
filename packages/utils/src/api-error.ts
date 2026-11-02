/**
 * Unified API Error class.
 * Throw this from route handlers or services — the global error handler
 * in index.ts formats it into { success: false, error: { code, message } }.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const SENSITIVE_DETAIL_KEY =
  /password|passcode|token|secret|authorization|cookie|api[-_]?key|key/i;

export function sanitizeApiErrorDetails(details: unknown): unknown {
  const seen = new WeakSet<object>();

  const sanitize = (value: unknown, depth: number): unknown => {
    if (value == null || typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { name: value.name };
    if (depth >= 5) return "[MaxDepth]";

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
    }

    if (typeof value === "object") {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);

      const sanitized: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
      )) {
        sanitized[key] = SENSITIVE_DETAIL_KEY.test(key)
          ? "[REDACTED]"
          : sanitize(child, depth + 1);
      }
      return sanitized;
    }

    return String(value);
  };

  return sanitize(details, 0);
}

export function notFound(
  message = "Resource not found",
  code = "NOT_FOUND",
): ApiError {
  return new ApiError(code, message, 404);
}

export function badRequest(
  message = "Invalid request",
  code = "BAD_REQUEST",
  details?: unknown,
): ApiError {
  return new ApiError(code, message, 400, details);
}

export function unauthorized(
  message = "Unauthorized",
  code = "UNAUTHORIZED",
): ApiError {
  return new ApiError(code, message, 401);
}

export function forbidden(
  message = "Access denied",
  code = "FORBIDDEN",
): ApiError {
  return new ApiError(code, message, 403);
}

export function conflict(
  message = "Resource conflict",
  code = "CONFLICT",
): ApiError {
  return new ApiError(code, message, 409);
}

export function serviceUnavailable(
  message = "Service temporarily unavailable",
  code = "SERVICE_UNAVAILABLE",
): ApiError {
  return new ApiError(code, message, 503);
}
