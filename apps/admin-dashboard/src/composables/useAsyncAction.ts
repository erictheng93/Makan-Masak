import { ref, type Ref } from "vue";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { markErrorHandled } from "@/utils/errorHandler";

/** A failure from the API's unified envelope, flattened for the UI. */
export interface ApiFailure {
  code?: string;
  /** User-safe message from the server, when it sent one. */
  message?: string;
  /** `details[].field` → message, for errors the form can pin to an input. */
  fieldErrors: Record<string, string>;
  status?: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Reads `{ success: false, error: { code, message, details } }` off an axios
 * error (or anything shaped like one). Never throws.
 */
export function parseApiError(error: unknown): ApiFailure {
  const response = asRecord(asRecord(error)?.response);
  const body = asRecord(asRecord(response?.data)?.error);
  const fieldErrors: Record<string, string> = {};
  if (Array.isArray(body?.details)) {
    for (const detail of body.details) {
      const d = asRecord(detail);
      if (typeof d?.field === "string" && typeof d.message === "string") {
        fieldErrors[d.field] ??= d.message;
      }
    }
  }
  return {
    code: typeof body?.code === "string" ? body.code : undefined,
    message: typeof body?.message === "string" ? body.message : undefined,
    fieldErrors,
    status: typeof response?.status === "number" ? response.status : undefined,
  };
}

export interface AsyncActionOptions<R> {
  /** Shown as a success toast; a function receives the action's result. */
  success?: string | ((result: R) => string);
  /**
   * Receives field-scoped errors. When given and the failure has any, no
   * toast is shown: the form renders them next to the inputs instead.
   */
  onFieldErrors?: (errors: Record<string, string>) => void;
  /** Toast text when the server sent no message. Defaults to errors.saveFailed. */
  fallbackError?: string;
}

/**
 * Every write button in the admin needs the same three things: a visible
 * in-flight state, no second request from a double tap, and the server's
 * reason when it fails. Owner-flow QA (2026-11-10) found ~15 buttons missing
 * one or more of them, each fixed by hand; new buttons should use this.
 *
 * `run` resolves to the action's result, or `undefined` when it was ignored
 * (already pending) or failed. Failures are handled here and never rethrown,
 * and marked handled so the interceptor's deferred toast skips them.
 */
export function useAsyncAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
  options: AsyncActionOptions<R> = {},
): {
  run: (...args: A) => Promise<R | undefined>;
  pending: Ref<boolean>;
  error: Ref<ApiFailure | null>;
} {
  const toast = useToast();
  const { t } = useI18n();
  const pending = ref(false);
  const error = ref<ApiFailure | null>(null);

  const run = async (...args: A): Promise<R | undefined> => {
    if (pending.value) return undefined;
    pending.value = true;
    error.value = null;
    try {
      const result = await action(...args);
      const success =
        typeof options.success === "function"
          ? options.success(result)
          : options.success;
      if (success) toast.success(success);
      return result;
    } catch (caught) {
      // We show the message; the interceptor's deferred toast must skip it.
      markErrorHandled(caught);
      const failure = parseApiError(caught);
      error.value = failure;
      const hasFieldErrors = Object.keys(failure.fieldErrors).length > 0;
      if (hasFieldErrors && options.onFieldErrors) {
        options.onFieldErrors(failure.fieldErrors);
      } else {
        toast.error(
          failure.message ?? options.fallbackError ?? t("errors.saveFailed"),
        );
      }
      return undefined;
    } finally {
      pending.value = false;
    }
  };

  return { run, pending, error };
}
