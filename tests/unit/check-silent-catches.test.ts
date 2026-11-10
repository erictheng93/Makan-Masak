import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { findSilentCatches, scan } =
  require("../../scripts/check-silent-catches.cjs") as {
    findSilentCatches: (source: string) => number[];
    scan: () => Record<string, number[]>;
  };

describe("check-silent-catches", () => {
  it("flags a catch that only logs", () => {
    const source = [
      "async function start() {",
      "  try {",
      "    await api.post('/pos/shifts/start');",
      "  } catch (error) {",
      "    console.error('Failed to start shift:', error);",
      "  }",
      "}",
    ].join("\n");
    expect(findSilentCatches(source)).toEqual([4]);
  });

  it.each([
    ["a toast", "toast.error(t('x'));"],
    ["markErrorHandled", "markErrorHandled(error);"],
    ["a rethrow", "throw error;"],
    ["an emitted event", "emit('error', error);"],
    ["an error the view renders", "errorMessage.value = t('x');"],
    ["the opt-out comment", "// silent-catch-ok: best-effort storage"],
  ])("accepts a catch that surfaces the failure via %s", (_label, line) => {
    const source = `try { x(); } catch (error) {\n  console.error(error);\n  ${line}\n}`;
    expect(findSilentCatches(source)).toEqual([]);
  });

  it("accepts a catch that returns the error to its caller", () => {
    const source =
      "try { a(); } catch (error) {\n  console.error(error);\n  return loginFailure(error);\n}";
    expect(findSilentCatches(source)).toEqual([]);
  });

  it("still flags a catch that returns something unrelated to the error", () => {
    const source =
      "try { a(); } catch (error) {\n  console.error(error);\n  return null;\n}";
    expect(findSilentCatches(source)).toEqual([1]);
  });

  it("ignores catches that do not log (deliberate fallbacks)", () => {
    expect(findSilentCatches("try { a(); } catch { return null; }")).toEqual(
      [],
    );
  });

  it("is not fooled by braces or keywords inside strings", () => {
    const source = [
      "try { a(); } catch (e) {",
      "  console.warn('toast { } throw', e);",
      "}",
    ].join("\n");
    expect(findSilentCatches(source)).toEqual([1]);
  });

  it("handles nested blocks inside the catch", () => {
    const source = [
      "try { a(); } catch (e) {",
      "  if (e) { console.error(e); }",
      "}",
    ].join("\n");
    expect(findSilentCatches(source)).toEqual([1]);
  });

  // The guard only bites on regressions: the repo must stay within its baseline.
  it("keeps the repo within the shipped baseline", () => {
    const baseline = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../scripts/silent-catches-baseline.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as Record<string, number>;
    const over = Object.entries(scan()).filter(
      ([file, lines]) => lines.length > (baseline[file] ?? 0),
    );
    expect(over).toEqual([]);
  });
});
