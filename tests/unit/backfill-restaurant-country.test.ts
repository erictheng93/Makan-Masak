import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const BACKFILL_PATH = resolve(
  process.cwd(),
  "scripts/backfill-restaurant-country.sql",
);

type RestaurantRow = {
  id: string;
  city: string;
  country_code: string | null;
  timezone: string | null;
  settings: string | null;
};

describe("restaurant country backfill", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("backfills only legacy Taichung restaurants whose effective currency is TWD", () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE restaurants (
        id TEXT PRIMARY KEY,
        city TEXT NOT NULL,
        country_code TEXT,
        timezone TEXT,
        settings TEXT
      ) STRICT;
    `);

    const insert = db.prepare(
      `INSERT INTO restaurants (id, city, country_code, timezone, settings)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const fixtures: Array<
      [string, string, string | null, string | null, string | null]
    > = [
      [
        "known-twd",
        "台中市",
        null,
        "Asia/Taipei",
        JSON.stringify({ currency: "TWD", receiptFooter: "謝謝光臨" }),
      ],
      ["known-null-settings", "臺中市", null, null, null],
      [
        "legacy-null-currency",
        "台中市",
        null,
        null,
        JSON.stringify({ currency: null, theme: "light" }),
      ],
      [
        "legacy-missing-currency",
        "台中市",
        null,
        "",
        JSON.stringify({ theme: "dark" }),
      ],
      [
        "legacy-blank-currency",
        "臺中市",
        null,
        null,
        JSON.stringify({ currency: "  " }),
      ],
      [
        "malaysia",
        "Kuala Lumpur",
        null,
        "Asia/Kuala_Lumpur",
        JSON.stringify({ currency: "MYR" }),
      ],
      [
        "taichung-myr",
        "台中市",
        null,
        "Asia/Kuala_Lumpur",
        JSON.stringify({ currency: "MYR" }),
      ],
      [
        "taichung-unknown",
        "臺中市",
        null,
        null,
        JSON.stringify({ currency: "USD" }),
      ],
      ["unknown-city", "新北市", null, null, null],
      ["invalid-settings", "台中市", null, null, "not-json"],
      ["non-object-settings", "台中市", null, null, "[]"],
      [
        "double-encoded-myr",
        "台中市",
        null,
        null,
        JSON.stringify(JSON.stringify({ currency: "MYR" })),
      ],
      ["already-classified", "台中市", "MY", "Asia/Kuala_Lumpur", null],
    ];
    for (const fixture of fixtures) insert.run(...fixture);

    const backfillSql = readFileSync(BACKFILL_PATH, "utf8");
    db.exec(backfillSql);

    const rows = db
      .prepare("SELECT * FROM restaurants ORDER BY id")
      .all() as RestaurantRow[];
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(eligibleState(byId["known-twd"])).toEqual({
      countryCode: "TW",
      timezone: "Asia/Taipei",
      settings: { currency: "TWD", receiptFooter: "謝謝光臨" },
    });
    expect(eligibleState(byId["known-null-settings"])).toEqual({
      countryCode: "TW",
      timezone: "Asia/Taipei",
      settings: { currency: "TWD" },
    });
    expect(eligibleState(byId["legacy-null-currency"])).toEqual({
      countryCode: "TW",
      timezone: "Asia/Taipei",
      settings: { currency: "TWD", theme: "light" },
    });
    expect(eligibleState(byId["legacy-missing-currency"])).toEqual({
      countryCode: "TW",
      timezone: "Asia/Taipei",
      settings: { theme: "dark", currency: "TWD" },
    });
    expect(eligibleState(byId["legacy-blank-currency"])).toEqual({
      countryCode: "TW",
      timezone: "Asia/Taipei",
      settings: { currency: "TWD" },
    });

    for (const id of [
      "malaysia",
      "taichung-myr",
      "taichung-unknown",
      "unknown-city",
      "invalid-settings",
      "non-object-settings",
      "double-encoded-myr",
      "already-classified",
    ]) {
      expect(byId[id]).toEqual(
        expect.objectContaining({
          ...rowFromFixture(fixtures.find(([fixtureId]) => fixtureId === id)!),
        }),
      );
    }

    const stateAfterFirstRun = JSON.stringify(rows);
    db.exec(backfillSql);
    expect(db.prepare("SELECT changes() AS count").get()).toEqual({ count: 0 });
    expect(
      JSON.stringify(db.prepare("SELECT * FROM restaurants ORDER BY id").all()),
    ).toBe(stateAfterFirstRun);
  });
});

function eligibleState(row: RestaurantRow) {
  return {
    countryCode: row.country_code,
    timezone: row.timezone,
    settings: JSON.parse(row.settings ?? "null") as unknown,
  };
}

function rowFromFixture(
  fixture: [string, string, string | null, string | null, string | null],
): RestaurantRow {
  const [id, city, countryCode, timezone, settings] = fixture;
  return { id, city, country_code: countryCode, timezone, settings };
}
