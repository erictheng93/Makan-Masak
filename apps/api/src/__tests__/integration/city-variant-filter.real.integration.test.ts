import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { markets } from "@makanmasak/database";
import { DiscoveryService } from "../../features/discovery/services/DiscoveryService";
import { MarketsService } from "../../features/markets/services/MarketsService";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";

// Production rows still say 台中市; new data says 臺中市. Either filter finds both.
// queryMarkets is private; listMarkets only adds the public-readiness gate on top.
describe("city spelling variants — real D1", () => {
  let app: RealIntegrationTestApp;
  let seed: SeedHelpers;
  beforeAll(async () => {
    app = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(app.testDb);
  });
  afterAll(async () => {
    await app.dispose();
  });
  beforeEach(async () => {
    await app.testDb.truncateAll();
  });

  const kv = { get: async () => null, put: async () => undefined };

  async function seedMarket(name: string, city: string) {
    await app.testDb.drizzle.insert(markets).values({
      id: crypto.randomUUID(),
      slug: crypto.randomUUID(),
      name,
      type: "night_market",
      city,
      district: "Central",
      address: "1 Test Street",
      latitude: 24,
      longitude: 120,
    });
  }

  it("browseRestaurants matches legacy and canonical Taichung spellings", async () => {
    await seed.restaurant({ name: "Legacy", city: "台中市" });
    await seed.restaurant({ name: "Canonical", city: "臺中市" });
    await seed.restaurant({ name: "Elsewhere", city: "台北市" });
    const service = new DiscoveryService(app.env.DB, kv as never);

    for (const city of ["臺中市", "台中市"]) {
      const { results } = await service.browseRestaurants({ city });
      expect(results.map((r) => r.name).sort()).toEqual([
        "Canonical",
        "Legacy",
      ]);
    }
  });

  it("queryMarkets matches legacy and canonical Taichung spellings", async () => {
    await seedMarket("Legacy", "台中市");
    await seedMarket("Canonical", "臺中市");
    await seedMarket("Elsewhere", "台北市");
    const service = new MarketsService(app.env.DB);

    for (const city of ["臺中市", "台中市"]) {
      const { markets: found } = await service["queryMarkets"]({ city });
      expect(found.map((m) => m.name).sort()).toEqual(["Canonical", "Legacy"]);
    }
  });
  it("browseRestaurants keyword matches both 台/臺 spellings", async () => {
    await seed.restaurant({ name: "台中小館", city: "台中市" });
    await seed.restaurant({ name: "臺中茶室", city: "臺中市" });
    await seed.restaurant({ name: "高雄小館", city: "高雄市" });
    const service = new DiscoveryService(app.env.DB, kv as never);

    for (const q of ["台中", "臺中"]) {
      const { results } = await service.browseRestaurants({ q });
      expect(results.map((r) => r.name).sort()).toEqual([
        "台中小館",
        "臺中茶室",
      ]);
    }
  });

  it("queryMarkets keyword matches both 台/臺 spellings", async () => {
    await seedMarket("台中夜市", "台中市");
    await seedMarket("臺中市場", "臺中市");
    await seedMarket("高雄夜市", "高雄市");
    const service = new MarketsService(app.env.DB);

    for (const q of ["台中", "臺中"]) {
      const { markets: found } = await service["queryMarkets"]({ q });
      expect(found.map((m) => m.name).sort()).toEqual(["台中夜市", "臺中市場"]);
    }
  });

  it("keyword 臺南 finds restaurants and markets stored as 台南", async () => {
    await seed.restaurant({ name: "台南小館", city: "台南市" });
    await seed.restaurant({ name: "高雄小館", city: "高雄市" });
    await seedMarket("台南夜市", "台南市");
    await seedMarket("高雄夜市", "高雄市");

    const discovery = new DiscoveryService(app.env.DB, kv as never);
    const { results } = await discovery.browseRestaurants({ q: "臺南" });
    expect(results.map((r) => r.name)).toEqual(["台南小館"]);

    const { markets: found } = await new MarketsService(app.env.DB)[
      "queryMarkets"
    ]({ q: "臺南" });
    expect(found.map((m) => m.name)).toEqual(["台南夜市"]);
  });
});
