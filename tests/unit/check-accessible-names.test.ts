import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  checkAccessibleNames,
  findUnnamed,
}: {
  checkAccessibleNames: () => { violations: unknown[] };
  findUnnamed: (source: string) => Array<{ line: number }>;
} = require("../../scripts/check-accessible-names.cjs");

const tpl = (body: string) => `<template>\n${body}\n</template>`;

describe("check-accessible-names", () => {
  it("flags an icon-only button that only has a title", () => {
    const found = findUnnamed(
      tpl(`<button title="Edit" @click="go"><Pencil class="w-4" /></button>`),
    );
    expect(found).toEqual([expect.objectContaining({ line: 2 })]);
  });

  it("flags an svg-only role=button element", () => {
    expect(
      findUnnamed(
        tpl(`<div role="button" @click="go"><svg><path d="M0"/></svg></div>`),
      ),
    ).toHaveLength(1);
  });

  it.each([
    `<button aria-label="Edit"><Pencil /></button>`,
    `<button :aria-label="t('common.edit')"><Pencil /></button>`,
    `<button aria-labelledby="x"><Pencil /></button>`,
    `<button>{{ t("common.save") }}</button>`,
    `<button><Pencil /><span>Edit</span></button>`,
    `<button><slot /></button>`,
    `<button><img src="a.png" alt="Edit" /></button>`,
    `<div class="backdrop" @click="close"></div>`,
    `<MyButton @click="go"><Pencil /></MyButton>`,
  ])("accepts a named or non-control element: %s", (html) => {
    expect(findUnnamed(tpl(html))).toEqual([]);
  });

  it("ignores controls inside comments", () => {
    expect(
      findUnnamed(tpl(`<!-- <button @click="x"><X /></button> -->`)),
    ).toEqual([]);
  });

  it("has no new unnamed controls beyond the baseline", () => {
    expect(checkAccessibleNames().violations).toEqual([]);
  });
});
