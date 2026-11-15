/**
 * The shop-owner guide is served by the onboarding app under `/guide/`. The
 * admin app has no config for that origin of its own, so it reads the same
 * `VITE_ONBOARDING_URL` the customer app uses, defaulting to production.
 */
const ONBOARDING_ORIGIN = (
  (import.meta.env.VITE_ONBOARDING_URL as string | undefined) ??
  "https://onboarding.makanmasak.com"
).replace(/\/$/, "");

/** Handbook folder per UI language; zh-TW is the master at the guide root. */
const GUIDE_LOCALE_PATH: Record<string, string> = {
  "en-US": "en-US/",
  "zh-CN": "zh-CN/",
  "ja-JP": "ja-JP/",
  "vi-VN": "vi-VN/",
  "id-ID": "id-ID/",
};

/** Sections of the plans-and-usage guide worth a deep link. */
export type PlansGuideAnchor = "trial" | "limit" | "downgrade";

/** The owner guide on plans and usage; no anchor means the top of the page. */
export function plansGuideUrl(
  locale: string,
  anchor?: PlansGuideAnchor,
): string {
  const folder = GUIDE_LOCALE_PATH[locale] ?? "";
  return `${ONBOARDING_ORIGIN}/guide/${folder}plans-and-usage.html${anchor ? `#${anchor}` : ""}`;
}

/** Path of a locale's page under `public/guide/` (used to check it exists). */
export function plansGuideRelativePath(locale: string): string {
  return `${GUIDE_LOCALE_PATH[locale] ?? ""}plans-and-usage.html`;
}
