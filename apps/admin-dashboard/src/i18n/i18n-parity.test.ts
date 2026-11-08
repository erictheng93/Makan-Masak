import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import enUS from "./locales/en-US";
import idID from "./locales/id-ID";
import jaJP from "./locales/ja-JP";
import viVN from "./locales/vi-VN";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";
import baseline from "./untranslated-baseline.json";

type MessageTree = Record<string, unknown>;

/**
 * Compared RAW, never merged over the source locale.
 *
 * This used to assert on `mergeLocaleMessages(zhTW, locale)` — the same
 * fallback the app renders with — so a key absent from a locale resolved to its
 * zh-TW value and the key sets matched by construction. The test passed while
 * four locales were missing the entire advanced-menu-item form (#113): it was
 * measuring the fallback, not the translations.
 */
const localeMessages: Record<string, unknown> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "ja-JP": jaJP,
  "vi-VN": viVN,
  "id-ID": idID,
};

const untranslated: Record<string, string[]> = baseline.untranslated;

function flattenMessageKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as MessageTree).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return flattenMessageKeys(child, path);
  });
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(fullPath);
    }

    return /\.(vue|ts)$/.test(entry.name) ? [fullPath] : [];
  });
}

const sourceKeys = flattenMessageKeys(zhTW);

function missingKeys(messages: unknown): string[] {
  const present = new Set(flattenMessageKeys(messages));
  return sourceKeys.filter((key) => !present.has(key)).sort();
}

function resolveMessage(messages: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        node && typeof node === "object"
          ? (node as MessageTree)[segment]
          : undefined,
      messages,
    );
}

describe("admin i18n locale parity", () => {
  it("adds no untranslated key that the baseline does not already record", () => {
    const newlyMissing = Object.fromEntries(
      Object.entries(localeMessages)
        .map(([locale, messages]) => {
          const known = new Set(untranslated[locale] ?? []);
          return [
            locale,
            missingKeys(messages).filter((key) => !known.has(key)),
          ] as const;
        })
        .filter(([, keys]) => keys.length > 0),
    );

    // Translate the key. Do not append it to untranslated-baseline.json —
    // that file records the debt that predates this guard, and adding to it
    // is how the gap this test exists to catch would come back.
    expect(newlyMissing).toEqual({});
  });

  it("keeps the baseline free of keys that have since been translated", () => {
    const stale = Object.fromEntries(
      Object.entries(localeMessages)
        .map(([locale, messages]) => {
          const stillMissing = new Set(missingKeys(messages));
          return [
            locale,
            (untranslated[locale] ?? []).filter(
              (key) => !stillMissing.has(key),
            ),
          ] as const;
        })
        .filter(([, keys]) => keys.length > 0),
    );

    // The baseline can only shrink: translating a key means deleting its
    // entry, so the file stays an accurate count of what is still owed.
    expect(stale).toEqual({});
  });

  it("defines no key that the source locale does not have", () => {
    const source = new Set(sourceKeys);
    const unknownByLocale = Object.fromEntries(
      Object.entries(localeMessages)
        .map(([locale, messages]) => [
          locale,
          flattenMessageKeys(messages)
            .filter((key) => !source.has(key))
            .sort(),
        ])
        .filter(([, keys]) => keys.length > 0),
    );

    // A key no locale falls back from is either a typo or a leftover: the app
    // renders zh-TW when a lookup misses, so it can never be reached.
    expect(unknownByLocale).toEqual({});
  });

  it("defines every static translation key used in admin-dashboard source", () => {
    const availableKeys = new Set(flattenMessageKeys(zhTW));
    const i18nDir = path.dirname(fileURLToPath(import.meta.url));
    const sourceRoot = path.resolve(i18nDir, "..");
    const translationPatterns = [
      /\bt\(\s*['"]([^'"`$]+)['"]/g,
      /\$t\(\s*['"]([^'"`$]+)['"]/g,
    ];
    const missingByKey = new Map<string, Set<string>>();

    for (const file of sourceFiles(sourceRoot)) {
      const source = fs.readFileSync(file, "utf8");
      for (const pattern of translationPatterns) {
        for (const match of source.matchAll(pattern)) {
          const key = match[1];
          if (!availableKeys.has(key)) {
            if (!missingByKey.has(key)) {
              missingByKey.set(key, new Set());
            }
            missingByKey.get(key)?.add(path.relative(sourceRoot, file));
          }
        }
      }
    }

    const missing = Object.fromEntries(
      [...missingByKey.entries()].map(([key, files]) => [
        key,
        [...files].sort(),
      ]),
    );

    expect(missing).toEqual({});
  }, 15_000);

  it("keeps every interpolated placeholder present in every locale", () => {
    const i18nDir = path.dirname(fileURLToPath(import.meta.url));
    const sourceRoot = path.resolve(i18nDir, "..");
    const allLocales: Record<string, unknown> = {
      "zh-TW": zhTW,
      ...localeMessages,
    };

    // Matches a translation call that passes a params object. No current call
    // site nests braces inside that object, which keeps this a cheap regex
    // rather than a parser; a call site that starts nesting simply stops being
    // checked, it never misreports. (Written without a literal example call —
    // the key-coverage test above scans this file too and would read one as a
    // real, and missing, key.)
    const callPattern =
      /\bt\(\s*["'`]([A-Za-z0-9_.]+)["'`]\s*,\s*\{([^{}]*)\}/g;
    const paramPattern = /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*[:,}]/g;

    const passedParams = new Map<string, Set<string>>();
    for (const file of sourceFiles(sourceRoot)) {
      if (file.includes(`${path.sep}locales${path.sep}`)) continue;
      if (/\.test\.ts$/.test(file)) continue;

      for (const match of fs.readFileSync(file, "utf8").matchAll(callPattern)) {
        const names = [...match[2].matchAll(paramPattern)].map((m) => m[1]);
        if (names.length === 0) continue;

        const known = passedParams.get(match[1]) ?? new Set<string>();
        names.forEach((name) => known.add(name));
        passedParams.set(match[1], known);
      }
    }

    const dropped: Record<string, string[]> = {};
    for (const [key, names] of passedParams) {
      for (const name of names) {
        const offenders = Object.entries(allLocales)
          .filter(([, messages]) => {
            const value = resolveMessage(messages, key);
            // A key absent from a locale is the parity tests' business above,
            // not this one — it falls back to zh-TW and renders fine.
            return typeof value === "string" && !value.includes(`{${name}}`);
          })
          .map(([locale]) => locale)
          .sort();

        if (offenders.length > 0) dropped[`${key} {${name}}`] = offenders;
      }
    }

    // A value passed to t() that the message never names is dropped in silence.
    // SchedulingView shipped `t("scheduling.peopleCount", { count })` against
    // zh-TW "人", so the 目前上班中 badge read "人" with no number — invisible
    // until #314 finally made that page reachable, and invisible to component
    // tests that stub t as key => key.
    expect(dropped).toEqual({});
  }, 15_000);
});

// @makanmasak/i18n only substitutes `{name}`. vue-i18n's literal escape
// (`{'@'}`) and linked messages (`@:key`) render verbatim here, which is how
// "user{'@'}example.com" reached the add-admin form.
describe("admin i18n message syntax", () => {
  function messageValues(value: unknown, prefix = ""): [string, string][] {
    if (typeof value === "string") return [[prefix, value]];
    if (!value || typeof value !== "object") return [];
    return Object.entries(value as MessageTree).flatMap(([key, child]) =>
      messageValues(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  it("uses no vue-i18n-only syntax the runtime would print verbatim", () => {
    const offenders = Object.entries({ "zh-TW": zhTW, ...localeMessages })
      .flatMap(([locale, messages]) =>
        messageValues(messages).map(([key, text]) => [locale, key, text]),
      )
      .filter(([, , text]) => /\{'[^']*'\}|@:[\w.]/.test(text));

    expect(offenders).toEqual([]);
  });
});
