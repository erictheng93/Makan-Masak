import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";

/**
 * qr_codes.restaurant_id / created_by were added to the Drizzle schema without
 * a migration, so every Drizzle insert/select on qr_codes and the statistics
 * SQL failed with "no such column" on a database built from migrations_fresh.
 * These run against that real schema.
 */
describe("QR codes — tenancy columns on the real schema", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  }, 300000);

  afterAll(async () => {
    await testApp?.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  async function generate(token: string) {
    return testApp.app.fetch(
      new Request("https://test/api/v1/qr/generate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          host: "test",
          origin: "https://test",
          "x-csrf-token": "a".repeat(64),
          cookie: `csrf_token=${"a".repeat(64)}`,
        },
        body: JSON.stringify({ content: "https://example.com/t/1" }),
      }),
    );
  }

  it("generates a QR, lets the owning tenant download it and denies another tenant", async () => {
    const owner = await seed.restaurant();
    const other = await seed.restaurant();
    const ownerToken = await testApp.authHelper.ownerToken(1, owner.id);
    const otherToken = await testApp.authHelper.ownerToken(2, other.id);

    const created = await generate(ownerToken);
    expect(created.status).toBe(201);
    const qr = await readData<{ id: string; restaurantId: string }>(created);
    expect(qr.restaurantId).toBe(owner.id);

    const ok = await testApp.app.fetch(
      new Request(`https://test/api/v1/qr/${qr.id}/download`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(ok.status).toBe(200);

    const denied = await testApp.app.fetch(
      new Request(`https://test/api/v1/qr/${qr.id}/download`, {
        headers: { Authorization: `Bearer ${otherToken}` },
      }),
    );
    expect(denied.status).toBe(403);
  });

  it("fails closed for a QR row with no restaurant", async () => {
    const r = await seed.restaurant();
    const token = await testApp.authHelper.ownerToken(1, r.id);
    const id = crypto.randomUUID();
    await testApp.testDb.bindings.DB.prepare(
      `INSERT INTO qr_codes (id, content, format, created_at_ms)
       VALUES (?, 'legacy', 'png', ?)`,
    )
      .bind(id, Date.now())
      .run();

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/qr/${id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("serves per-restaurant statistics", async () => {
    const r = await seed.restaurant();
    const elsewhere = await seed.restaurant();
    const token = await testApp.authHelper.ownerToken(1, r.id);
    expect((await generate(token)).status).toBe(201);

    // Templates are scoped by created_by -> users.restaurant_id.
    const mine = await seed.user({ restaurantId: r.id });
    const theirs = await seed.user({ restaurantId: elsewhere.id });
    for (const createdBy of [mine.id, theirs.id]) {
      await testApp.testDb.bindings.DB.prepare(
        `INSERT INTO qr_templates
           (name, style_json, created_by, created_at_ms, updated_at_ms)
         VALUES ('t', '{}', ?, ?, ?)`,
      )
        .bind(createdBy, Date.now(), Date.now())
        .run();
    }

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/qr/stats", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const stats = await readData<{
      totalQRCodes: number;
      totalTemplates: number;
    }>(res);
    expect(stats.totalQRCodes).toBe(1);
    expect(stats.totalTemplates).toBe(1);
  });
});
