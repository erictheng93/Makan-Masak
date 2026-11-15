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
  "ja-JP": "ja-JP/",
  "vi-VN": "vi-VN/",
  "id-ID": "id-ID/",
};

/** Part 16 of the handbook: plans, modules, quotas and regional policy. */
export function plansGuideUrl(locale: string): string {
  const folder = GUIDE_LOCALE_PATH[locale] ?? "";
  return `${ONBOARDING_ORIGIN}/guide/${folder}system-handbook.html#modules-heading`;
}
