/**
 * Error Sanitization Utility
 * Prevents sensitive information disclosure in error messages
 */

export interface SanitizedError {
  message: string;
  code?: string | number;
  type:
    | "validation"
    | "authentication"
    | "authorization"
    | "not_found"
    | "server_error"
    | "rate_limit";
}

export class ErrorSanitizer {
  // Patterns that indicate sensitive information
  private static readonly SENSITIVE_PATTERNS = [
    // Database connection strings
    /postgres:\/\/[^@]+:[^@]+@/gi,
    /mysql:\/\/[^@]+:[^@]+@/gi,
    /mongodb:\/\/[^@]+:[^@]+@/gi,

    // API keys and tokens
    /api[_-]?key[=:][\w-]{20,}/gi,
    /access[_-]?token[=:][\w-]{20,}/gi,
    /bearer\s+[\w-]{20,}/gi,
    /jwt[=:][\w.-]{20,}/gi,

    // File paths (internal system paths)
    /[a-z]:\\[^\\]+\\[^\\]+/gi,
    /\/home\/[^/]+\/[^/\s]+/gi,
    /\/var\/[^/\s]+/gi,
    /\/opt\/[^/\s]+/gi,

    // Internal IPs
    /192\.168\.\d{1,3}\.\d{1,3}/g,
    /10\.\d{1,3}\.\d{1,3}\.\d{1,3}/g,
    /172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}/g,

    // Stack traces with file paths
    /at\s+[^(]+\([^)]+\)/gi,

    // Password patterns
    /password[=:][\w!@#$%^&*]+/gi,
    /pwd[=:][\w!@#$%^&*]+/gi,
    /pass[=:][\w!@#$%^&*]+/gi,

    // Email addresses in error contexts
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

    // Cloudflare/internal service URLs (anchored with word boundary to prevent partial matches)
    /\bhttps?:\/\/[\w-]+\.workers\.dev\b/gi,
    /\bhttps?:\/\/[\w-]+\.cloudflareworkers\.com\b/gi,
  ];

  // Safe generic messages for different error types
  private static readonly GENERIC_MESSAGES = {
    validation: "Invalid input data provided",
    authentication: "Authentication failed",
    authorization: "Access denied",
    not_found: "Requested resource not found",
    server_error: "An internal server error occurred",
    rate_limit: "Too many requests. Please try again later",
    database: "Database operation failed",
    network: "Network error occurred",
    timeout: "Request timed out",
    unknown: "An unexpected error occurred",
  };

  /**
   * Sanitizes error messages by removing sensitive information
   */
  public static sanitizeMessage(message: string): string {
    let sanitized = message;

    // Remove sensitive patterns
    this.SENSITIVE_PATTERNS.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    });

    // Drizzle/D1 put the whole statement and its bound values in the message
    // ("Failed query: delete from ... params: <id>"). Never hand that out.
    if (/Failed query:|D1_ERROR/.test(sanitized)) {
      return this.GENERIC_MESSAGES.database;
    }

    // Remove common database error prefixes that might reveal structure
    const dbPrefixes = [
      "SQLITE_CONSTRAINT",
      "FOREIGN KEY constraint failed",
      "UNIQUE constraint failed",
      "NOT NULL constraint failed",
      "CHECK constraint failed",
    ];

    dbPrefixes.forEach((prefix) => {
      if (sanitized.includes(prefix)) {
        sanitized = "Database constraint validation failed";
      }
    });

    // Limit message length to prevent information disclosure through long messages
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 197) + "...";
    }

    return sanitized;
  }

  /**
   * Categorizes and sanitizes errors based on their type
   */
  public static sanitizeError(
    error: unknown,
    defaultType: string = "server_error",
  ): SanitizedError {
    if (error instanceof Error) {
      const message = error.message;
      const name = error.name;

      // Authentication errors
      if (
        name === "JsonWebTokenError" ||
        name === "TokenExpiredError" ||
        message.includes("JWT") ||
        message.includes("token")
      ) {
        return {
          type: "authentication",
          message: this.GENERIC_MESSAGES.authentication,
          code: "AUTH_ERROR",
        };
      }

      // Validation errors (Zod, etc.)
      if (
        name === "ZodError" ||
        name === "ValidationError" ||
        message.includes("validation")
      ) {
        return {
          type: "validation",
          message: this.GENERIC_MESSAGES.validation,
          code: "VALIDATION_ERROR",
        };
      }

      // Database errors
      if (
        name.includes("Database") ||
        message.includes("SQLITE") ||
        message.includes("constraint")
      ) {
        return {
          type: "server_error",
          message: this.GENERIC_MESSAGES.database,
          code: "DATABASE_ERROR",
        };
      }

      // Network/timeout errors
      if (
        name === "TimeoutError" ||
        message.includes("timeout") ||
        message.includes("ECONNRESET")
      ) {
        return {
          type: "server_error",
          message: this.GENERIC_MESSAGES.timeout,
          code: "TIMEOUT_ERROR",
        };
      }

      // Permission/access errors
      if (
        message.includes("permission") ||
        message.includes("access denied") ||
        message.includes("forbidden")
      ) {
        return {
          type: "authorization",
          message: this.GENERIC_MESSAGES.authorization,
          code: "ACCESS_DENIED",
        };
      }

      // Rate limiting errors
      if (
        message.includes("rate limit") ||
        message.includes("too many requests")
      ) {
        return {
          type: "rate_limit",
          message: this.GENERIC_MESSAGES.rate_limit,
          code: "RATE_LIMITED",
        };
      }

      // Not found errors
      if (message.includes("not found") || message.includes("does not exist")) {
        return {
          type: "not_found",
          message: this.GENERIC_MESSAGES.not_found,
          code: "NOT_FOUND",
        };
      }

      // Generic error with sanitized message
      return {
        type: defaultType as SanitizedError["type"],
        message: this.sanitizeMessage(message),
        code: "GENERIC_ERROR",
      };
    }

    // Handle non-Error objects
    if (typeof error === "string") {
      return {
        type: defaultType as SanitizedError["type"],
        message: this.sanitizeMessage(error),
        code: "STRING_ERROR",
      };
    }

    // Handle object errors (like HTTP responses)
    if (typeof error === "object" && error !== null) {
      const errorObj = error as Record<string, unknown>;
      if (errorObj.message) {
        return this.sanitizeError(errorObj.message, defaultType);
      }
      if (errorObj.error) {
        return this.sanitizeError(errorObj.error, defaultType);
      }
    }

    // Fallback for unknown error types
    return {
      type: "server_error",
      message: this.GENERIC_MESSAGES.unknown,
      code: "UNKNOWN_ERROR",
    };
  }

  /**
   * Logs the original error securely while returning a sanitized version
   */
  public static logAndSanitize(
    error: unknown,
    context: string = "API",
  ): SanitizedError {
    // Log the original error with context for debugging (server-side only)
    if (typeof console !== "undefined") {
      console.error(`[${context}] Original error:`, {
        error,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });
    }

    // Return sanitized version for client
    return this.sanitizeError(error);
  }

  /**
   * Determines if an error should be treated as client-safe
   */
  public static isClientSafeError(error: unknown): boolean {
    if (error instanceof Error) {
      const safePrefixes = [
        "Validation failed",
        "Invalid input",
        "Resource not found",
        "Access denied",
        "Authentication required",
      ];

      return safePrefixes.some((prefix) => error.message.startsWith(prefix));
    }

    return false;
  }
}
