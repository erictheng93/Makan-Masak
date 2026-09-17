import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { checkTemplateCurrency } =
  require("../../scripts/check-template-currency.cjs") as {
    checkTemplateCurrency: (options?: { root?: string }) => {
      violations: Array<{ file: string; line: number }>;
    };
  };
const roots: string[] = [];
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "template-currency-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Vue template currency guard", () => {
  it("passes on the real repository", () => {
    expect(checkTemplateCurrency().violations).toEqual([]);
  });
  it("scans every app and nested templates with exact line diagnostics", () => {
    const root = fixture({
      "apps/admin-dashboard/src/Total.vue":
        "<template>\n<span>${{ amount }}</span>\n</template>",
      "apps/future-app/src/nested/Total.vue":
        '<template><template v-if="ok">\n$ {{ formatPrice(amount) }}</template></template>',
      "apps/kitchen-display/src/Total.vue":
        '<template>{{ ok ? `$${amount}` : "-" }}</template>',
    });
    expect(checkTemplateCurrency({ root }).violations).toEqual([
      { file: "apps/admin-dashboard/src/Total.vue", line: 2 },
      { file: "apps/future-app/src/nested/Total.vue", line: 2 },
      { file: "apps/kitchen-display/src/Total.vue", line: 1 },
    ]);
  });
  it("allows formatters, dollar prose, comments and script literals", () => {
    const root = fixture({
      "apps/customer-app/src/Good.vue":
        '<script setup>const sample = "${{ amount }}";</script>\n<template><!-- ${{ amount }} --><span>{{ formatPrice(amount) }}</span><p>Prices in $</p></template>',
      "apps/customer-app/fixtures/Example.vue":
        "<template>${{ amount }}</template>",
    });
    expect(checkTemplateCurrency({ root }).violations).toEqual([]);
  });
});
