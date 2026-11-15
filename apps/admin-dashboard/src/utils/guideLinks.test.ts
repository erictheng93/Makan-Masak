import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/i18n";
import { plansGuideRelativePath, plansGuideUrl } from "./guideLinks";

// Anchored on this file, not process.cwd().
const GUIDE_DIR = fileURLToPath(
  new URL("../../../onboarding-app/public/guide/", import.meta.url),
);

describe("plans-and-usage guide links", () => {
  it.each(SUPPORTED_LOCALES.map((locale) => locale.code))(
    "%s resolves to a published page with the section anchors",
    (code) => {
      const file = `${GUIDE_DIR}${plansGuideRelativePath(code)}`;
      expect(fs.existsSync(file)).toBe(true);
      const html = fs.readFileSync(file, "utf8");
      for (const id of ["trial", "limit", "downgrade"]) {
        expect(html).toContain(`id="${id}"`);
      }
    },
  );

  it("builds the zh-TW root page, localized pages, and anchors", () => {
    expect(plansGuideUrl("zh-TW")).toMatch(/\/guide\/plans-and-usage\.html$/);
    expect(plansGuideUrl("zh-CN")).toMatch(
      /\/guide\/zh-CN\/plans-and-usage\.html$/,
    );
    expect(plansGuideUrl("en-US", "limit")).toMatch(
      /\/guide\/en-US\/plans-and-usage\.html#limit$/,
    );
    expect(plansGuideUrl("fil-PH")).toMatch(/\/guide\/plans-and-usage\.html$/);
  });
});
