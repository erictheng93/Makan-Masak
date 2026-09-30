import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import type { Messages } from "../apps/kitchen-display/src/i18n/types";

type Locale =
  | "zh-TW"
  | "en-US"
  | "zh-CN"
  | "ja-JP"
  | "vi-VN"
  | "ms-MY"
  | "id-ID";

interface AppLocaleConfig {
  name: string;
  localeDir: string;
  sourceLocale?: Locale;
  secondarySourceLocale?: Locale | null;
  targetLocales?: Locale[];
}

interface LeafEntry {
  key: string;
  value: string;
}

const APPS: AppLocaleConfig[] = [
  {
    name: "admin-dashboard",
    localeDir: "apps/admin-dashboard/src/i18n/locales",
    secondarySourceLocale: null,
    targetLocales: ["en-US", "zh-CN", "ja-JP", "vi-VN", "id-ID"],
  },
  {
    name: "kitchen-display",
    localeDir: "apps/kitchen-display/src/i18n/locales",
  },
  {
    name: "onboarding-app",
    localeDir: "apps/onboarding-app/src/i18n/locales",
  },
  {
    name: "management-portal",
    localeDir: "apps/management-portal/src/i18n/locales",
  },
];

const SOURCE_LOCALE: Locale = "zh-TW";
const SECONDARY_SOURCE_LOCALE: Locale = "en-US";
const TARGET_LOCALES: Locale[] = ["zh-CN", "vi-VN", "ms-MY", "id-ID"];
const allTargetLocales = [
  ...new Set(APPS.flatMap((app) => app.targetLocales ?? TARGET_LOCALES)),
];

const shouldExportHandoff = process.argv.includes("--export-handoff");
const importHandoffArgIndex = process.argv.findIndex(
  (arg) => arg === "--import-handoff",
);
const checkHandoffArgIndex = process.argv.findIndex(
  (arg) => arg === "--check-handoff",
);
const importHandoffPath =
  importHandoffArgIndex >= 0
    ? (process.argv
        .slice(importHandoffArgIndex + 1)
        .find((arg) => arg !== "--") ?? "")
    : "";
const checkHandoffPath =
  checkHandoffArgIndex >= 0
    ? (process.argv
        .slice(checkHandoffArgIndex + 1)
        .find((arg) => arg !== "--") ?? "")
    : "";
const shouldFailOnMissing = process.argv.includes("--fail-on-missing");
const handoffPath = path.resolve("docs/i18n/locale-translator-handoff.csv");
const approvalManifestPath = path.resolve(
  "docs/i18n/locale-approval-manifest.json",
);

function flattenMessages(
  messages: Messages,
  prefix = "",
  entries: LeafEntry[] = [],
): LeafEntry[] {
  for (const [key, value] of Object.entries(messages)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      entries.push({ key: fullKey, value });
    } else {
      flattenMessages(value, fullKey, entries);
    }
  }

  return entries;
}

function toEntryMap(entries: LeafEntry[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.key, entry.value]));
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function sourceLocaleFor(app: AppLocaleConfig): Locale {
  return app.sourceLocale ?? SOURCE_LOCALE;
}

function secondarySourceLocaleFor(app: AppLocaleConfig): Locale | undefined {
  if (app.secondarySourceLocale === null) {
    return undefined;
  }

  return app.secondarySourceLocale ?? SECONDARY_SOURCE_LOCALE;
}

function targetLocalesFor(app: AppLocaleConfig): Locale[] {
  return app.targetLocales ?? TARGET_LOCALES;
}

async function loadExistingHandoff(): Promise<
  Map<string, Map<Locale, string>>
> {
  try {
    const existingCsv = await readFile(handoffPath, "utf8");
    const rows = parseCsv(existingCsv);
    const [header, ...body] = rows;
    const localeIndexes = new Map(
      allTargetLocales.map((locale) => [locale, header.indexOf(locale)]),
    );

    return new Map(
      body.map((row) => [
        `${row[0]}.${row[1]}`,
        new Map(
          allTargetLocales.map((locale) => {
            const index = localeIndexes.get(locale) ?? -1;
            return [locale, index >= 0 ? (row[index] ?? "") : ""];
          }),
        ),
      ]),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }

    throw error;
  }
}

async function loadMessages(app: AppLocaleConfig, locale: Locale) {
  const localeUrl = new URL(
    `../${app.localeDir}/${locale}.ts`,
    import.meta.url,
  );
  const module = (await import(localeUrl.href)) as { default: Messages };
  return module.default;
}

function setNestedValue(
  messages: Record<string, unknown>,
  dottedKey: string,
  value: string,
): void {
  const parts = dottedKey.split(".");
  let current = messages;

  for (const part of parts.slice(0, -1)) {
    const next = current[part];

    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

interface HandoffLocaleOutput {
  localeFile: string;
  messages: Record<string, unknown>;
  unchanged: boolean;
}

interface HandoffValidationResult {
  missingTranslations: string[];
  localeOutputs: HandoffLocaleOutput[];
}

interface ApprovalReviewer {
  name?: string;
  role?: string;
  locales?: Locale[];
}

interface ApprovalManifest {
  handoff?: string;
  sha256?: string;
  approvedAt?: string;
  approvedBy?: ApprovalReviewer[];
  apps?: string[];
  locales?: Locale[];
  notes?: string;
}

export function buildHandoffMessages(
  rows: string[][],
  keyIndex: number,
  localeIndex: number,
  expectedKeys: Set<string>,
  existingMessages: Messages,
) {
  const messages: Record<string, unknown> = {};

  // Emptiness is judged on the trimmed cell, but the value is kept
  // verbatim: " min" and "note: " lean on their edge spaces (#429).
  const translations = new Map<string, string>();
  for (const row of rows) {
    const key = row[keyIndex];
    const translation = row[localeIndex];

    if (expectedKeys.has(key) && translation?.trim()) {
      translations.set(key, translation);
    }
  }

  // Preserve existing key order; new keys follow in CSV order.
  const existingKeys = flattenMessages(existingMessages).map(
    (entry) => entry.key,
  );
  const existingKeySet = new Set(existingKeys);
  const orderedKeys = [
    ...existingKeys.filter((key) => translations.has(key)),
    ...[...translations.keys()].filter((key) => !existingKeySet.has(key)),
  ];
  for (const key of orderedKeys) {
    setNestedValue(messages, key, translations.get(key) as string);
  }

  return {
    messages,
    unchanged: JSON.stringify(messages) === JSON.stringify(existingMessages),
    missingKeys: [...expectedKeys].filter((key) => !translations.has(key)),
  };
}

async function validateApprovedHandoff(
  csvPath: string,
): Promise<HandoffValidationResult> {
  if (!csvPath) {
    throw new Error("--check-handoff/--import-handoff requires a CSV path");
  }

  const rows = parseCsv(await readFile(path.resolve(csvPath), "utf8"));
  const [header, ...body] = rows;
  const appIndex = header.indexOf("app");
  const keyIndex = header.indexOf("key");
  const localeIndexes = new Map(
    allTargetLocales.map((locale) => [locale, header.indexOf(locale)]),
  );

  if (
    appIndex < 0 ||
    keyIndex < 0 ||
    allTargetLocales.some((locale) => (localeIndexes.get(locale) ?? -1) < 0)
  ) {
    throw new Error(
      `Handoff CSV must include app, key, and ${allTargetLocales.join(", ")} columns`,
    );
  }

  const localeOutputs: HandoffLocaleOutput[] = [];
  const missingTranslations: string[] = [];

  for (const app of APPS) {
    const targetLocales = targetLocalesFor(app);
    const sourceEntries = flattenMessages(
      await loadMessages(app, sourceLocaleFor(app)),
    );
    const expectedKeys = new Set(sourceEntries.map((entry) => entry.key));
    const appRows = body.filter((row) => row[appIndex] === app.name);

    for (const key of expectedKeys) {
      if (!appRows.some((row) => row[keyIndex] === key)) {
        warning(`${app.name}/${key} is missing from the handoff CSV`);
      }
    }

    for (const locale of targetLocales) {
      const { messages, unchanged, missingKeys } = buildHandoffMessages(
        appRows,
        keyIndex,
        localeIndexes.get(locale) ?? -1,
        expectedKeys,
        await loadMessages(app, locale),
      );
      missingTranslations.push(
        ...missingKeys.map((key) => `${app.name}/${locale}/${key}`),
      );

      const localeFile = path.join(app.localeDir, `${locale}.ts`);
      localeOutputs.push({ localeFile, messages, unchanged });
    }
  }

  return { missingTranslations, localeOutputs };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path.resolve(filePath)))
    .digest("hex");
}

async function validateApprovalManifest(csvPath: string): Promise<void> {
  let manifest: ApprovalManifest;

  try {
    manifest = JSON.parse(
      await readFile(approvalManifestPath, "utf8"),
    ) as ApprovalManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Approval manifest is missing: ${path.relative(process.cwd(), approvalManifestPath)}`,
      );
    }

    throw error;
  }

  const issues: string[] = [];
  const expectedHash = await sha256File(csvPath);

  if (
    manifest.handoff !== path.relative(process.cwd(), path.resolve(csvPath))
  ) {
    issues.push(
      `handoff must be ${path.relative(process.cwd(), path.resolve(csvPath))}`,
    );
  }

  if (manifest.sha256 !== expectedHash) {
    issues.push(`sha256 must match current handoff file (${expectedHash})`);
  }

  if (!manifest.approvedAt || Number.isNaN(Date.parse(manifest.approvedAt))) {
    issues.push("approvedAt must be an ISO-8601 date string");
  }

  if (!manifest.approvedBy?.some((reviewer) => reviewer.name?.trim())) {
    issues.push("approvedBy must include at least one named reviewer");
  }

  const appNames = APPS.map((app) => app.name);
  const missingApps = appNames.filter((app) => !manifest.apps?.includes(app));
  const expectedLocales = [...new Set(APPS.flatMap(targetLocalesFor))];
  const missingLocales = expectedLocales.filter(
    (locale) => !manifest.locales?.includes(locale),
  );

  if (missingApps.length > 0) {
    issues.push(`apps is missing: ${missingApps.join(", ")}`);
  }

  if (missingLocales.length > 0) {
    issues.push(`locales is missing: ${missingLocales.join(", ")}`);
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      warning(`Approval manifest invalid: ${issue}`);
    }

    throw new Error("Approval manifest is incomplete or stale");
  }
}

function assertNoMissingTranslations(missingTranslations: string[]): void {
  if (missingTranslations.length > 0) {
    for (const missingTranslation of missingTranslations.slice(0, 20)) {
      warning(`${missingTranslation} has no approved translation`);
    }

    if (missingTranslations.length > 20) {
      warning(
        `${missingTranslations.length - 20} additional approved translations ` +
          "are missing",
      );
    }

    throw new Error("Handoff CSV has missing approved translations");
  }
}

async function checkApprovedHandoff(csvPath: string): Promise<void> {
  const { missingTranslations } = await validateApprovedHandoff(csvPath);
  assertNoMissingTranslations(missingTranslations);
  await validateApprovalManifest(csvPath);

  console.log(`${csvPath} has complete approved translations and approval`);
}

async function importApprovedHandoff(csvPath: string): Promise<void> {
  const { missingTranslations, localeOutputs } =
    await validateApprovedHandoff(csvPath);
  assertNoMissingTranslations(missingTranslations);
  await validateApprovalManifest(csvPath);

  // Prepare every edit before writing, so unsupported source syntax cannot
  // leave an import half-applied.
  const files = [];
  for (const { localeFile, messages, unchanged } of localeOutputs) {
    if (unchanged) continue;
    const source = await readFile(localeFile, "utf8");
    files.push({ localeFile, file: updateLocaleSource(source, messages) });
  }
  for (const { localeFile, file } of files) {
    await writeFile(localeFile, file, "utf8");
  }
}

function updateLocaleSource(
  source: string,
  messages: Record<string, unknown>,
): string {
  const ast = ts.createSourceFile(
    "locale.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const exported = ast.statements.find(ts.isExportAssignment)?.expression;
  const initializer =
    exported && ts.isIdentifier(exported)
      ? ast.statements
          .filter(ts.isVariableStatement)
          .flatMap((statement) => [...statement.declarationList.declarations])
          .find(
            (declaration) =>
              ts.isIdentifier(declaration.name) &&
              declaration.name.text === exported.text,
          )?.initializer
      : exported;
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new Error("Locale default export must be a literal object");
  }
  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  function patchObject(
    node: ts.ObjectLiteralExpression,
    values: Record<string, unknown>,
  ): string {
    const edits: { start: number; end: number; text: string }[] = [];
    const keys = new Set<string>();
    const kept: ts.PropertyAssignment[] = [];
    const commaAfter = (property: ts.PropertyAssignment) => {
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        ts.LanguageVariant.Standard,
        source,
      );
      scanner.setTextPos(property.end);
      return scanner.scan() === ts.SyntaxKind.CommaToken
        ? scanner.getTokenPos()
        : undefined;
    };
    for (const property of node.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ) {
        throw new Error("Locale properties must have literal names and values");
      }
      const key = property.name.text;
      keys.add(key);
      if (!Object.hasOwn(values, key)) {
        // Remove syntax only: adjacent translator comments stay intact.
        edits.push({
          start: property.getStart(ast),
          end: property.end,
          text: "",
        });
        const comma = commaAfter(property);
        if (comma !== undefined)
          edits.push({ start: comma, end: comma + 1, text: "" });
        continue;
      }
      kept.push(property);
      const value = values[key];
      const old = property.initializer;
      let text: string;
      if (
        ts.isObjectLiteralExpression(old) &&
        typeof value === "object" &&
        value !== null
      ) {
        text = patchObject(old, value as Record<string, unknown>);
      } else if (
        (ts.isStringLiteral(old) || ts.isNoSubstitutionTemplateLiteral(old)) &&
        old.text === value
      ) {
        continue;
      } else {
        text = JSON.stringify(value);
        if (typeof value === "string" && source[old.getStart(ast)] === "'") {
          text = `'${text.slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")}'`;
        } else if (
          typeof value === "string" &&
          ts.isNoSubstitutionTemplateLiteral(old)
        ) {
          text = `\`${text.slice(1, -1).replaceAll('\\"', '"').replaceAll("`", "\\`").replaceAll("${", "\\${")}\``;
        }
      }
      edits.push({ start: old.getStart(ast), end: old.end, text });
    }

    const added = Object.entries(values).filter(([key]) => !keys.has(key));
    if (added.length) {
      const last = kept.at(-1);
      if (last && commaAfter(last) === undefined) {
        edits.push({ start: last.end, end: last.end, text: "," });
      }
      const close = node.end - 1;
      const lineStart = source.lastIndexOf("\n", close - 1) + 1;
      const closingIndent = source.slice(lineStart, close);
      const multiline = /^\s*$/.test(closingIndent);
      const objectLine = source.lastIndexOf("\n", node.getStart(ast)) + 1;
      const parentIndent = source.slice(objectLine).match(/^[\t ]*/)?.[0] ?? "";
      const first = node.properties[0];
      const firstLine = first
        ? source.lastIndexOf("\n", first.getStart(ast)) + 1
        : 0;
      const firstIndent = first
        ? source.slice(firstLine, first.getStart(ast))
        : "";
      const indent =
        first && /^[\t ]+$/.test(firstIndent)
          ? firstIndent
          : `${parentIndent}  `;
      const text = added
        .map(
          ([key, value]) =>
            `${indent}${JSON.stringify(key)}: ${JSON.stringify(value, null, 2).replaceAll("\n", `${eol}${indent}`)},`,
        )
        .join(eol);
      const start = multiline ? lineStart : close;
      edits.push({
        start,
        end: start,
        text: `${source[start - 1] === "\n" ? "" : eol}${text}${eol}${multiline ? "" : parentIndent}`,
      });
    }
    let result = source.slice(node.getStart(ast), node.end);
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      const start = edit.start - node.getStart(ast);
      const end = edit.end - node.getStart(ast);
      result = result.slice(0, start) + edit.text + result.slice(end);
    }
    return result;
  }
  return (
    source.slice(0, initializer.getStart(ast)) +
    patchObject(initializer, messages) +
    source.slice(initializer.end)
  );
}

export function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function warning(message: string): void {
  if (process.env.GITHUB_ACTIONS) {
    console.warn(`::warning::${message}`);
    return;
  }

  console.warn(`Warning: ${message}`);
}

async function main(): Promise<void> {
  if (checkHandoffArgIndex >= 0) {
    await checkApprovedHandoff(checkHandoffPath);
    return;
  }

  if (importHandoffArgIndex >= 0) {
    await importApprovedHandoff(importHandoffPath);
    return;
  }

  const existingHandoff = await loadExistingHandoff();
  const handoffRows = [
    ["app", "key", "source text", "secondary source", ...allTargetLocales],
  ];
  let hasMissingKeys = false;

  for (const app of APPS) {
    const sourceLocale = sourceLocaleFor(app);
    const secondarySourceLocale = secondarySourceLocaleFor(app);
    const targetLocales = targetLocalesFor(app);
    const sourceMessages = await loadMessages(app, sourceLocale);
    const secondaryMessages =
      secondarySourceLocale && secondarySourceLocale !== sourceLocale
        ? await loadMessages(app, secondarySourceLocale)
        : undefined;
    const sourceEntries = flattenMessages(sourceMessages).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    const sourceMap = toEntryMap(sourceEntries);
    const secondaryMap = secondaryMessages
      ? toEntryMap(flattenMessages(secondaryMessages))
      : new Map<string, string>();

    for (const entry of sourceEntries) {
      const existingTargets = existingHandoff.get(`${app.name}.${entry.key}`);

      handoffRows.push([
        app.name,
        entry.key,
        entry.value,
        secondaryMap.get(entry.key) ?? "",
        ...allTargetLocales.map((locale) =>
          targetLocales.includes(locale)
            ? (existingTargets?.get(locale) ?? "")
            : "",
        ),
      ]);
    }

    console.log(
      `${app.name}: ${sourceLocale} has ${sourceEntries.length} leaf keys`,
    );

    for (const locale of targetLocales) {
      const targetMessages = await loadMessages(app, locale);
      const targetEntries = flattenMessages(targetMessages);
      const targetKeys = new Set(targetEntries.map((entry) => entry.key));
      const missingKeys = [...sourceMap.keys()].filter(
        (key) => !targetKeys.has(key),
      );

      if (missingKeys.length > 0) {
        hasMissingKeys = true;
        warning(
          `${app.name}/${locale} is missing ${missingKeys.length} of ` +
            `${sourceEntries.length} ${sourceLocale} leaf keys`,
        );
      } else {
        console.log(`${app.name}/${locale}: complete`);
      }
    }
  }

  if (shouldExportHandoff) {
    const outputDir = path.resolve("docs/i18n");
    const csv = handoffRows
      .map((row) => row.map((cell) => csvCell(cell)).join(","))
      .join("\n");

    await mkdir(outputDir, { recursive: true });
    await writeFile(handoffPath, `${csv}\n`, "utf8");
    console.log(`Wrote ${handoffPath}`);
  }

  if (hasMissingKeys && shouldFailOnMissing) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
