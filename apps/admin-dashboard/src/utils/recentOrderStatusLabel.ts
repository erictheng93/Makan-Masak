type Translate = (key: string) => string;

// t() returns the key itself for a missing translation, which is truthy, so a
// plain `||` fallback never fires. Compare against the key instead.
export function recentOrderStatusLabel(status: string, t: Translate): string {
  const key = `dashboard.recentOrdersPanel.status.${status}`;
  const label = t(key);
  return label && label !== key
    ? label
    : t("dashboard.recentOrdersPanel.status.unknown");
}
