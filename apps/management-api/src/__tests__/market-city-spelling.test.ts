import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import { marketsRouter } from "../routes/markets";
import { assertMarketInCity } from "../routes/onboarding";
import type { ManagementEnv } from "../types";

// Production markets may be stored under either spelling of Taichung; the
// onboarding form now only offers 臺中市.
function env() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE markets (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL, city TEXT NOT NULL, district TEXT NOT NULL,
      is_active INTEGER NOT NULL, deleted_at_ms INTEGER
    );
    INSERT INTO markets VALUES
      ('legacy', 'a', 'Legacy Spelling', 'night_market', '台中市', 'X', 1, NULL),
      ('canon', 'b', 'Canonical Spelling', 'night_market', '臺中市', 'Y', 1, NULL),
      ('taipei', 'c', 'Taipei', 'night_market', '臺北市', 'Z', 1, NULL);
  `);
  return {
    PLATFORM_DB: new D1DatabaseAdapter(sqlite) as unknown as D1Database,
  } as ManagementEnv;
}

async function listIds(city: string) {
  const response = await marketsRouter.request(
    `/?country=TW&city=${encodeURIComponent(city)}`,
    {},
    env(),
  );
  const body = (await response.json()) as {
    data: { markets: Array<{ id: string }> };
  };
  return body.data.markets.map((market) => market.id).sort();
}

describe("market city spelling", () => {
  it.each(["臺中市", "台中市"])(
    "lists markets under both spellings for city=%s",
    async (city) => {
      expect(await listIds(city)).toEqual(["canon", "legacy"]);
    },
  );

  it.each([
    ["legacy", "臺中市"],
    ["canon", "台中市"],
    ["legacy", "台中市"],
    ["canon", "臺中市"],
  ])("accepts market %s on submit for city %s", async (id, city) => {
    await expect(assertMarketInCity(env(), id, city)).resolves.toBeUndefined();
  });

  it("still rejects a market in a different city", async () => {
    await expect(assertMarketInCity(env(), "taipei", "臺中市")).rejects.toThrow(
      "Market is not in the selected city",
    );
  });
});
