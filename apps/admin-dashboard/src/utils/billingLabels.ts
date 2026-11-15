/**
 * Message paths for the names BillingView shows next to usage meters and plan
 * modules.
 *
 * Meter keys are dotted ("api.requests") and vue-i18n reads every dot in a
 * path as a nesting level, so a catalog entry spelled `"api.requests"` can
 * never be found — the page printed the raw key for every meter. The catalog
 * spells them with underscores instead.
 *
 * Module names already live under `subscriptions.moduleNames`, where the
 * platform's subscription console reads them; one list keeps both screens
 * naming a module the same way.
 */
export function meterMessagePath(meterKey: string): string {
  return `billing.meter.${meterKey.replaceAll(".", "_")}`;
}

export function moduleMessagePath(moduleKey: string): string {
  return `subscriptions.moduleNames.${moduleKey}`;
}

/** Thousands separators in the page's locale: 10,000, not 10000. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Decimal units, because plan limits are round decimal numbers: 1,000,000,000
 * bytes is "1 GB", not "953.7 MB". The usage bars and the plan cards share this.
 */
export function formatBytes(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

/** Meter value for display: bytes for storage, a plain count otherwise. */
export function formatMeterValue(
  meterKey: string,
  value: number,
  locale: string,
): string {
  return meterKey === "storage.bytes"
    ? formatBytes(value, locale)
    : formatCount(value, locale);
}
