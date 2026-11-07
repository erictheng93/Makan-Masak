import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { prunePlaceholders } =
  require("../../scripts/prune-coverage-shard-placeholders.cjs") as {
    prunePlaceholders: (coverages: Array<Record<string, unknown>>) => number;
  };

function buildFile(hits: number[]) {
  return {
    data: { s: Object.fromEntries(hits.map((n, i) => [String(i), n])) },
  };
}

describe("prune-coverage-shard-placeholders", () => {
  it("drops zero-hit placeholders where another shard executed the file", () => {
    const a = { "x.vue": buildFile([0, 0, 0]) };
    const b = { "x.vue": buildFile([1, 0]) };
    const c = { "x.vue": buildFile([0, 0, 0]) };

    expect(prunePlaceholders([a, b, c])).toBe(2);
    expect(a).toEqual({});
    expect(c).toEqual({});
    expect(b["x.vue"]).toBeDefined();
  });

  it("keeps every shard that executed the file", () => {
    const a = { "y.ts": buildFile([1, 0]) };
    const b = { "y.ts": buildFile([0, 2]) };

    expect(prunePlaceholders([a, b])).toBe(0);
    expect(Object.keys(a)).toEqual(["y.ts"]);
    expect(Object.keys(b)).toEqual(["y.ts"]);
  });

  it("keeps one placeholder for a file no shard loaded, so it still counts as uncovered", () => {
    const a = { "z.ts": buildFile([0]) };
    const b = { "z.ts": buildFile([0]) };

    expect(prunePlaceholders([a, b])).toBe(1);
    expect(Object.keys(a)).toEqual(["z.ts"]);
    expect(b).toEqual({});
  });
});
