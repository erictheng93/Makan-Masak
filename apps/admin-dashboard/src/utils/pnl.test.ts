// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const sheet = vi.hoisted(() => ({
  aoa_to_sheet: vi.fn(
    (rows: unknown[][]) => ({ rows }) as Record<string, unknown>,
  ),
  book_new: vi.fn(() => ({})),
  book_append_sheet: vi.fn(),
  write: vi.fn(() => new ArrayBuffer(8)),
}));

vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: sheet.aoa_to_sheet,
    book_new: sheet.book_new,
    book_append_sheet: sheet.book_append_sheet,
  },
  write: sheet.write,
}));

import { downloadXlsx, neutralizeFormula } from "./pnl";

describe("downloadXlsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("writes one named sheet from the rows, with column widths", async () => {
    const rows = [
      ["日期", "損益"],
      ["2026-11-01", 2100],
    ];
    await downloadXlsx(rows, "pnl_x.xlsx", "日帳損益表");

    expect(sheet.aoa_to_sheet).toHaveBeenCalledWith(rows);
    const created = sheet.aoa_to_sheet.mock.results[0].value;
    expect(created["!cols"]).toHaveLength(2);
    expect(sheet.book_append_sheet).toHaveBeenCalledWith(
      expect.anything(),
      created,
      "日帳損益表",
    );
    expect(sheet.write).toHaveBeenCalledWith(expect.anything(), {
      bookType: "xlsx",
      type: "array",
    });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });
});

describe("neutralizeFormula", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])(
    "prefixes %j",
    (text) => {
      expect(neutralizeFormula(text)).toBe(`'${text}`);
    },
  );
  it("leaves ordinary text alone", () => {
    expect(neutralizeFormula("11 月場租")).toBe("11 月場租");
    expect(neutralizeFormula("")).toBe("");
  });
});
