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
