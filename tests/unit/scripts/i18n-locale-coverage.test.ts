import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildHandoffMessages,
  csvCell,
  parseCsv,
} from "../../../scripts/i18n-locale-coverage";

const existing = {
  statisticsDashboard: { minutes: " min", title: "Statistics" },
  payment: { bankTransfer: { step3Desc: "Order number: " } },
};
const rows = [
  ["statisticsDashboard.minutes", " min"],
  ["statisticsDashboard.title", "Statistics"],
  ["payment.bankTransfer.step3Desc", "Order number: "],
];
const expectedKeys = new Set(rows.map(([key]) => key));

// Use the same cell encoder and parser as --export-handoff and import.
function roundTrip(input: string[][]) {
  return parseCsv(input.map((row) => row.map(csvCell).join(",")).join("\n"));
}

describe("handoff import (#429)", () => {
  it("warns and rejects import when an entire CSV row is missing", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const directory = mkdtempSync(path.join(tmpdir(), "handoff-missing-row-"));
    try {
      const csv = parseCsv(
        readFileSync(
          path.join(root, "docs/i18n/locale-translator-handoff.csv"),
          "utf8",
        ),
      );
      const incomplete = csv.filter(
        (row) =>
          !(
            row[0] === "admin-dashboard" &&
            row[1] === "statisticsDashboard.minutes"
          ),
      );
      const csvPath = path.join(directory, "handoff.csv");
      writeFileSync(
        csvPath,
        incomplete.map((row) => row.map(csvCell).join(",")).join("\n"),
      );
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(root, "scripts/i18n-locale-coverage.ts"),
          "--import-handoff",
          csvPath,
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "admin-dashboard/statisticsDashboard.minutes is missing from the handoff CSV",
      );
      expect(result.stderr).toContain(
        "Handoff CSV has missing approved translations",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves leading and trailing spaces through CSV export/import", () => {
    const result = buildHandoffMessages(
      roundTrip(rows),
      0,
      1,
      expectedKeys,
      existing,
    );
    expect(result.messages).toEqual(existing);
    expect(result.unchanged).toBe(true);
    expect(result.missingKeys).toEqual([]);
  });

  it("still treats whitespace-only cells as missing", () => {
    const blankRows = rows.map(([key]) => [key, " \t "]);
    const result = buildHandoffMessages(
      roundTrip(blankRows),
      0,
      1,
      expectedKeys,
      existing,
    );
    expect(result.missingKeys).toEqual([...expectedKeys]);
    expect(result.messages).toEqual({});
    expect(result.unchanged).toBe(false);
  });

  it("reports unchanged despite a different CSV row order", () => {
    const result = buildHandoffMessages(
      roundTrip([...rows].reverse()),
      0,
      1,
      expectedKeys,
      existing,
    );
    expect(result.unchanged).toBe(true);
    expect(JSON.stringify(result.messages)).toBe(JSON.stringify(existing));
  });

  it("marks only the edited locale as changed and keeps all key order", () => {
    const localeRows = rows
      .map(([key, value]) => [key, value, value])
      .reverse();
    localeRows.find(([key]) => key === "statisticsDashboard.minutes")![1] =
      " minutes";
    const outputs = [1, 2].map((column) =>
      buildHandoffMessages(
        roundTrip(localeRows),
        0,
        column,
        expectedKeys,
        existing,
      ),
    );
    expect(outputs.map(({ unchanged }) => unchanged)).toEqual([false, true]);
    expect(JSON.stringify(outputs[0].messages)).toBe(
      JSON.stringify({
        ...existing,
        statisticsDashboard: { minutes: " minutes", title: "Statistics" },
      }),
    );
    expect(JSON.stringify(outputs[1].messages)).toBe(JSON.stringify(existing));
  });
});
