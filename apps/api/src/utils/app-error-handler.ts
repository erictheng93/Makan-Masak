import type { Context } from "hono";
import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";
import { ErrorSanitizer } from "./errorSanitizer";
import { ApiError, sanitizeApiErrorDetails } from "../shared/utils/api-error";

type ErrorResponseStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;

const ERROR_RESPONSE_STATUS_CODES = new Set<number>([
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
  415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500,
  501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
]);

function toErrorResponseStatusCode(status: number): ErrorResponseStatusCode {
  return ERROR_RESPONSE_STATUS_CODES.has(status)
    ? (status as ErrorResponseStatusCode)
    : 500;
}

/**
 * Unified error formatter for ALL thrown errors. Shared by the app and by
 * route tests, which mount a bare router and would otherwise see every throw
 * as a 500.
 */
export function handleAppError(err: Error, c: Context) {
  // Log the original error server-side
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err);
  const requestId = c.get("requestId");

  if (err instanceof ApiError) {
    const status = toErrorResponseStatusCode(err.status);
    // `details` on a 4xx tells the caller what to change (which field, which
    // amount). On a 5xx there is nothing for them to change — the payload
    // describes our side, and it has carried a restaurant's internal id and
    // a per-tenant configuration readout. Logged above, never served.
    const serveDetails = err.details !== undefined && status < 500;
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: ErrorSanitizer.sanitizeMessage(err.message),
          requestId,
          ...(serveDetails && {
            details: sanitizeApiErrorDetails(err.details),
          }),
        },
      },
      status,
    );
  }

  // Non-ApiError: auto-classify via ErrorSanitizer
  const sanitized = ErrorSanitizer.sanitizeError(err);

  const STATUS_MAP: Record<string, number> = {
    validation: 400,
    authentication: 401,
    authorization: 403,
    not_found: 404,
    rate_limit: 429,
    server_error: 500,
  };
  const status = STATUS_MAP[sanitized.type] ?? 500;

  return c.json(
    {
      success: false,
      error: {
        code: sanitized.code ?? "INTERNAL_ERROR",
        message: sanitized.message,
        requestId,
      },
    },
    toErrorResponseStatusCode(status),
  );
}
