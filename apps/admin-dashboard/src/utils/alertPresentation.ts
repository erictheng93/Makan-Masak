import type { EmergencyAlert } from "@/services/ownerService";

/**
 * Owner alert bodies are stored in English by the API producer (#285) and
 * translated for display, so an owner reading the dashboard in any of the six
 * shipped locales gets their own.
 *
 * Only types listed here are translated. A producer added later without locale
 * keys falls back to the stored English rather than rendering a raw key at the
 * owner — which is the failure this list exists to prevent.
 */
export const TRANSLATABLE_ALERT_TYPES = new Set([
  "inventory_depleted",
  "inventory_low",
  "order_overdue",
  "payment_failed",
]);

/** What vue-i18n can interpolate. `details` is a JSON column, so it is wider. */
export type AlertMessageParams = Record<string, string | number>;

export type TranslateFn = (key: string, params?: AlertMessageParams) => string;

export interface AlertPresenter {
  title: (alert: EmergencyAlert) => string;
  description: (alert: EmergencyAlert) => string;
}

/**
 * `translateStatus` is passed in rather than imported so this stays a pure
 * function of its inputs: the order status inside an alert has to render the
 * same words the rest of the dashboard uses for that status.
 */
export function createAlertPresenter(
  t: TranslateFn,
  translateStatus: (status: string) => string,
): AlertPresenter {
  const params = (alert: EmergencyAlert): AlertMessageParams => {
    const details = alert.details ?? {};
    const params: AlertMessageParams = {};

    for (const [key, value] of Object.entries(details)) {
      // A JSON column can hold anything; only scalars survive into a message.
      // Nulls and nested objects are dropped rather than rendered as "null" or
      // "[object Object]" at the owner.
      if (typeof value === "string" || typeof value === "number") {
        params[key] = value;
      } else if (typeof value === "boolean") {
        params[key] = String(value);
      }
    }

    if (typeof details.status === "string") {
      params.status = translateStatus(details.status);
    }

    return params;
  };

  const render = (
    alert: EmergencyAlert,
    field: "title" | "description",
  ): string =>
    TRANSLATABLE_ALERT_TYPES.has(alert.alertType)
      ? t(`owner.alerts.${alert.alertType}.${field}`, params(alert))
      : alert[field];

  return {
    title: (alert) => render(alert, "title"),
    description: (alert) => render(alert, "description"),
  };
}
