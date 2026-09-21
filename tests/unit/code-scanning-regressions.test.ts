import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("CodeQL regression checks", () => {
  it("escapes markdown table note backslashes before pipe characters", () => {
    const source = readFileSync(
      join(root, "scripts/check-docs-drift.cjs"),
      "utf8",
    );

    expect(source).toContain("rawLine.match(/\\/\\/\\s*([^\\r\\n]+)\\r?$/)");
    expect(source).toContain(
      'm.note.replace(/\\\\/g, "\\\\\\\\").replace(/\\|/g, "\\\\|")',
    );
  });

  it("does not use Math.random in real workflow identifiers or credentials", () => {
    const source = readFileSync(
      join(root, "tests/e2e/integration/real-workflows.spec.ts"),
      "utf8",
    );

    expect(source).not.toContain("Math.random()");
  });

  it("matches mocked payment adapters by parsed URL origin", () => {
    const source = readFileSync(
      join(
        root,
        "apps/api/src/__tests__/integration/market-checkout-child-order-settlement.real.integration.test.ts",
      ),
      "utf8",
    );

    expect(source).toContain("new URL(url).origin !== ADAPTER");
    expect(source).not.toContain("url.startsWith(ADAPTER)");
  });
});
