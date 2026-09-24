import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { COUNTRY_PROFILES } from "@makanmasak/shared-types";
import { markets, regionPolicies } from "./index";

describe("policies schema", () => {
  it("maps to the policies table with ms timestamps", () => {
    const config = getTableConfig(regionPolicies);
    expect(config.name).toBe("policies");
    expect(config.columns.map((c) => c.name)).toEqual([
      "id",
      "scope_type",
      "scope_id",
      "policy_key",
      "value",
      "updated_by",
      "created_at_ms",
      "updated_at_ms",
    ]);
    const unique = config.indexes.find(
      (index) => index.config.name === "policies_scope_key_idx",
    );
    expect(unique?.config.unique).toBe(true);
  });

  it("gives markets a country code", () => {
    expect(getTableConfig(markets).columns.map((c) => c.name)).toContain(
      "country_code",
    );
  });

  it("backfills every profile city in 0032", () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          "../../migrations_fresh/0032_market_country_code.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    for (const profile of Object.values(COUNTRY_PROFILES)) {
      for (const city of profile.cities) {
        expect(sql, `${profile.countryCode} ${city}`).toContain(`'${city}'`);
      }
    }
  });
});
