import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const repo = process.cwd();
const apps = [
  "admin-dashboard",
  "kitchen-display",
  "onboarding-app",
  "management-portal",
];
const locales = ["en-US", "zh-CN", "ja-JP", "vi-VN", "ms-MY", "id-ID"];
const original = `import type { Messages } from "../types";
// Translator notes
const messages: Messages = {
  // Keep this section
  section: { z: 'Z', /* value note */ a : "A" },
};
export default messages;
`;
let root: string;
let target: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "i18n-handoff-"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(root, "scripts"));
  // Run the real CLI against isolated locale files and approval data.
  cpSync(
    path.join(repo, "scripts/i18n-locale-coverage.ts"),
    path.join(root, "scripts/i18n-locale-coverage.ts"),
  );
  symlinkSync(
    path.join(repo, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  mkdirSync(path.join(root, "docs/i18n"), { recursive: true });
  for (const app of apps) {
    const dir = path.join(root, `apps/${app}/src/i18n/locales`);
    mkdirSync(dir, { recursive: true });
    for (const locale of ["zh-TW", ...locales]) {
      writeFileSync(path.join(dir, `${locale}.ts`), original);
    }
  }
  target = path.join(root, "apps/admin-dashboard/src/i18n/locales/ja-JP.ts");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function handoff(
  entries = [
    ["section.z", "Z"],
    ["section.a", "A"],
  ],
) {
  const rows = [
    ["app", "key", ...locales],
    ...apps.flatMap((app) =>
      entries.map(([key, value]) => [app, key, ...locales.map(() => value)]),
    ),
  ];
  const csv = rows
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  writeFileSync(path.join(root, "docs/i18n/handoff.csv"), csv);
  writeFileSync(
    path.join(root, "docs/i18n/locale-approval-manifest.json"),
    JSON.stringify({
      handoff: "docs/i18n/handoff.csv",
      sha256: createHash("sha256").update(csv).digest("hex"),
      approvedAt: "2026-10-01",
      approvedBy: [{ name: "Test reviewer" }],
      apps,
      locales,
    }),
  );
}

function run() {
  return execFileSync(
    process.execPath,
    [
      path.join(repo, "node_modules/tsx/dist/cli.mjs"),
      "scripts/i18n-locale-coverage.ts",
      "--import-handoff",
      "docs/i18n/handoff.csv",
    ],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
}

it("changes only the translated literal, preserving comments and formatting", () => {
  handoff([
    ["section.z", "Z"],
    ["section.a", ' note: "quoted"\n '],
  ]);
  run();
  expect(readFileSync(target, "utf8")).toBe(
    original.replace('"A"', '" note: \\"quoted\\"\\n "'),
  );
});

it("does not write any locale file on an unchanged import", () => {
  handoff();
  const before = apps.flatMap((app) =>
    locales.map((locale) => {
      const file = path.join(root, `apps/${app}/src/i18n/locales/${locale}.ts`);
      return {
        file,
        mtime: statSync(file).mtimeMs,
        text: readFileSync(file, "utf8"),
      };
    }),
  );
  run();
  for (const { file, mtime, text } of before) {
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(statSync(file).mtimeMs).toBe(mtime);
  }
});

it("rejects whitespace-only cells before writing any translations", () => {
  handoff([
    ["section.z", "Z"],
    ["section.a", " \t "],
  ]);
  expect(run).toThrow(/missing approved translations/);
  expect(readFileSync(target, "utf8")).toBe(original);
});

it("rejects unsupported property syntax before writing earlier locale files", () => {
  const earlier = path.join(
    root,
    "apps/admin-dashboard/src/i18n/locales/en-US.ts",
  );
  writeFileSync(
    target,
    'const base = { z: "Z", a: "A" }; export default { section: { ...base } };',
  );
  handoff([
    ["section.z", "CHANGED"],
    ["section.a", "A"],
  ]);
  expect(run).toThrow(/literal names and values/);
  expect(readFileSync(earlier, "utf8")).toBe(original);
});

it("adds nested keys and deletes obsolete keys without losing surviving comments", () => {
  for (const app of apps) {
    writeFileSync(
      path.join(root, `apps/${app}/src/i18n/locales/zh-TW.ts`),
      'export default { section: { z: "Z", added: "NEW" }, fresh: { key: "FRESH" } };',
    );
  }
  handoff([
    ["section.z", "Z"],
    ["section.added", "NEW"],
    ["fresh.key", "FRESH"],
  ]);
  run();
  const text = readFileSync(target, "utf8");
  expect(text).toContain("// Translator notes");
  expect(text).toContain("// Keep this section");
  expect(text).toContain("/* value note */");
  // A second CLI run loads the edited TypeScript and verifies it is a no-op.
  const mtime = statSync(target).mtimeMs;
  run();
  expect(statSync(target).mtimeMs).toBe(mtime);
  expect(text).not.toMatch(/a\s*:/);
  expect(text).toContain('added: "NEW"');
  expect(text).toContain('key: "FRESH"');
});

it.each([
  ['export default { a: "A", b: "B", c: "C" };', ["b", "c"]],
  ['export default { a: "A", b: "B", c: "C" };', ["a", "c"]],
  ['export default { a: "A", b: "B", c: "C" };', ["a", "b"]],
  ['export default { a: "A", b: "B", c: "C", };', ["a"]],
  ['export default { old: { a: "A" }, /* keep */ b: "B" };', ["b"]],
  ['export default { old: { a: "A" } };', ["new.key"]],
])("deletes obsolete properties safely: %s -> %j", (localeSource, keys) => {
  writeFileSync(target, localeSource);
  for (const app of apps) {
    const messages = Object.fromEntries(
      keys.map((key) => [key, key.toUpperCase()]),
    );
    if (keys.includes("new.key")) {
      delete messages["new.key"];
      writeFileSync(
        path.join(root, `apps/${app}/src/i18n/locales/zh-TW.ts`),
        'export default { new: { key: "NEW.KEY" } };',
      );
    } else {
      writeFileSync(
        path.join(root, `apps/${app}/src/i18n/locales/zh-TW.ts`),
        `export default ${JSON.stringify(messages)};`,
      );
    }
  }
  handoff(keys.map((key) => [key, key.toUpperCase()]));
  run();
  const mtime = statSync(target).mtimeMs;
  run();
  expect(statSync(target).mtimeMs).toBe(mtime);
  if (localeSource.includes("/* keep */"))
    expect(readFileSync(target, "utf8")).toContain("/* keep */");
});

it("preserves CRLF and single-quote formatting when changing a value", () => {
  writeFileSync(target, original.replaceAll("\n", "\r\n"));
  handoff([
    ["section.z", ` Z's "quote"\\path `],
    ["section.a", "A"],
  ]);
  run();
  expect(readFileSync(target, "utf8")).toBe(
    original
      .replace("'Z'", `' Z\\'s "quote"\\\\path '`)
      .replaceAll("\n", "\r\n"),
  );
  const mtime = statSync(target).mtimeMs;
  run();
  expect(statSync(target).mtimeMs).toBe(mtime);
});

it("preserves backticks and escapes interpolation in changed template values", () => {
  writeFileSync(target, original.replace("'Z'", "`Z`"));
  handoff([
    ["section.z", " use `x` and ${name}\\path "],
    ["section.a", "A"],
  ]);
  run();
  expect(readFileSync(target, "utf8")).toBe(
    original.replace("'Z'", "` use \\`x\\` and \\${name}\\\\path `"),
  );
  const mtime = statSync(target).mtimeMs;
  run();
  expect(statSync(target).mtimeMs).toBe(mtime);
});

it("rejects non-literal values instead of overwriting them", () => {
  writeFileSync(target, 'export default { section: { z: "Z" + "", a: "A" } };');
  handoff([
    ["section.z", "CHANGED"],
    ["section.a", "A"],
  ]);
  expect(run).toThrow(/literal names and values/);
  expect(readFileSync(target, "utf8")).toContain('"Z" + ""');
});

it("deletes whole lines and adds keys in the sibling key style", () => {
  writeFileSync(
    target,
    'export default {\n  keep: "K",\n  // gone\n  old: { x: "X" },\n  stale: "S",\n};\n',
  );
  for (const app of apps) {
    writeFileSync(
      path.join(root, `apps/${app}/src/i18n/locales/zh-TW.ts`),
      'export default { keep: "K", fresh: { deep: "D" } };',
    );
  }
  handoff([
    ["keep", "K"],
    ["fresh.deep", "D"],
  ]);
  run();
  expect(readFileSync(target, "utf8")).toBe(
    'export default {\n  keep: "K",\n  // gone\n  fresh: {\n    deep: "D",\n  },\n};\n',
  );
});

it("opens a single-line object without stray whitespace when adding a key", () => {
  writeFileSync(target, 'export default { keep: "K" };\n');
  for (const app of apps) {
    writeFileSync(
      path.join(root, `apps/${app}/src/i18n/locales/zh-TW.ts`),
      'export default { keep: "K", more: "M" };',
    );
  }
  handoff([
    ["keep", "K"],
    ["more", "M"],
  ]);
  run();
  expect(readFileSync(target, "utf8")).toBe(
    'export default { keep: "K",\n  more: "M",\n};\n',
  );
});

it("removes a trailing line comment together with its deleted property", () => {
  writeFileSync(
    target,
    'export default {\n  keep: "K", // keep note\n  old: "O", // old note\n};\n',
  );
  for (const app of apps) {
    writeFileSync(
      path.join(root, `apps/${app}/src/i18n/locales/zh-TW.ts`),
      'export default { keep: "K" };',
    );
  }
  handoff([["keep", "K"]]);
  run();
  expect(readFileSync(target, "utf8")).toBe(
    'export default {\n  keep: "K", // keep note\n};\n',
  );
});
