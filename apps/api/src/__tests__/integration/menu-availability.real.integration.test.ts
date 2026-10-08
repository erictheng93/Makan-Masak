import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { MenuService } from "../../features/menu/services/MenuService";
import { ManagerActionsService } from "../../features/manager/services/ManagerActionsService";
import { RealtimeAuthService } from "../../features/realtime/services/RealtimeAuthService";
import {
  menuItems,
  categories,
  MenuService as DatabaseMenuService,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import type { AuthUser } from "../../middleware/auth";

describe("menu availability — real D1", () => {
  let app: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;
  beforeAll(async () => {
    app = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(app.testDb);
  });
  afterAll(async () => {
    await app?.dispose();
  });

  it("notifies restoration from a stale prefetched snapshot and suppresses actual no-ops", async () => {
    const restaurant = await seed.restaurant({ isActive: true });
    const fixture = await seed.menuItem(restaurant.id, { isAvailable: true });
    const statuses: boolean[] = [];
    app.env.REALTIME_SESSION = {
      idFromName: (room: string) => room,
      get: (room: string) => ({
        fetch: async (_url: string, init: RequestInit) => {
          const event = JSON.parse(String(init.body));
          if (room.startsWith("admin:")) statuses.push(event.data.isAvailable);
          return Response.json({ success: true });
        },
      }),
    } as unknown as DurableObjectNamespace;
    try {
      const service = new MenuService(app.env);
      // Two handlers obtained the same snapshot before either write committed.
      const before = await service.getMenuItem(fixture.id);
      await service.updateMenuItem(fixture.id, { isAvailable: false }, before!);
      await service.updateMenuItem(fixture.id, { isAvailable: true }, before!);
      expect(statuses).toEqual([false, true]);
      const staleSoldOut = { ...before!, isAvailable: false };
      await service.updateMenuItem(
        fixture.id,
        { isAvailable: true },
        staleSoldOut,
      );
      expect(statuses).toEqual([false, true]);
    } finally {
      app.env.REALTIME_SESSION = undefined as never;
    }
  });

  it("invalidates cached menus before sanitized public refresh, from all write paths", async () => {
    const restaurant = await seed.restaurant({ isActive: true });
    const fixture = await seed.menuItem(restaurant.id, {
      isAvailable: true,
      name: "Supply test",
    });
    const [row] = await app.testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, fixture.id));
    await app.testDb.drizzle
      .update(categories)
      .set({ isActive: true, isVisible: true })
      .where(eq(categories.id, row.categoryId));
    const events: {
      room: string;
      event: { type: string; data: Record<string, unknown> };
    }[] = [];
    const observed: boolean[] = [];
    app.env.REALTIME_SESSION = {
      idFromName: (room: string) => room,
      get: (room: string) => ({
        fetch: async (_url: string, init: RequestInit) => {
          const event = JSON.parse(String(init.body));
          events.push({ room, event });
          const fresh = await new MenuService(app.env).getMenu(restaurant.id, {
            skipCache: true,
          });
          observed.push(
            !!fresh?.menuItems.some((item) => item.id === fixture.id),
          );
          return Response.json({ success: true, recipientCount: 1 });
        },
      }),
    } as unknown as DurableObjectNamespace;
    const service = new MenuService(app.env);
    await service.getMenu(restaurant.id); // warm query cache
    await service.updateMenuItem(fixture.id, { isAvailable: false });
    expect(observed).toEqual([false, false, false]);
    expect(events.map((event) => event.room)).toEqual([
      `admin:${restaurant.id}`,
      `kitchen:${restaurant.id}`,
      `menu:${restaurant.id}`,
    ]);
    expect(events[2].event.data).toEqual({
      menuItemId: fixture.id,
      action: "updated",
    });
    events.length = 0;
    observed.length = 0;
    await service.batchUpdateAvailability(restaurant.id, [
      { id: fixture.id, isAvailable: false },
      { id: fixture.id, isAvailable: true },
    ]);
    expect(observed).toEqual([true, true, true]);
    expect(events).toHaveLength(3);
    events.length = 0;
    await service.batchUpdateAvailability(restaurant.id, [
      { id: fixture.id, isAvailable: true },
    ]);
    await service.updateMenuItem(fixture.id, { name: "Renamed" });
    expect(events).toHaveLength(0);
    observed.length = 0;
    const actor = await seed.user({ restaurantId: restaurant.id, role: 1 });
    await new ManagerActionsService(app.env).execute(
      {
        action: "update_menu_availability",
        resource: "menu_item",
        resourceId: String(fixture.id),
        restaurantId: restaurant.id,
        payload: { isAvailable: false },
        reason: "Sold out",
      },
      {
        id: actor.id,
        username: actor.username,
        role: 1,
        restaurantId: restaurant.id,
      } as AuthUser,
    );
    expect(events).toHaveLength(3);
    expect(observed).toEqual([false, false, false]);
    app.env.REALTIME_SESSION = undefined as never;
  });

  it("rolls back the whole batch if a later write fails", async () => {
    const restaurant = await seed.restaurant();
    const first = await seed.menuItem(restaurant.id, { isAvailable: true });
    const second = await seed.menuItem(restaurant.id, { isAvailable: true });
    await app.env.DB.exec(
      `CREATE TRIGGER fail_availability BEFORE UPDATE OF is_available ON menu_items WHEN NEW.id = ${second.id} BEGIN SELECT RAISE(ABORT, 'forced failure'); END;`,
    );
    try {
      await expect(
        new DatabaseMenuService(app.env.DB, app.env).batchUpdateAvailability(
          restaurant.id,
          [
            { id: first.id, isAvailable: false },
            { id: second.id, isAvailable: false },
          ],
        ),
      ).rejects.toThrow();
      const [actual] = await app.testDb.drizzle
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, first.id));
      expect(actual.isAvailable).toBe(true);
    } finally {
      await app.env.DB.exec("DROP TRIGGER fail_availability;");
    }
  });

  it("scopes batch writes and rejects deleted items and restaurant transfers", async () => {
    const own = await seed.restaurant();
    const other = await seed.restaurant();
    const foreign = await seed.menuItem(other.id, { isAvailable: true });
    const deleted = await seed.menuItem(own.id, {
      isAvailable: true,
      deletedAt: new Date(),
    });
    const db = new DatabaseMenuService(app.env.DB, app.env);
    expect(
      await db.batchUpdateAvailability(own.id, [
        { id: foreign.id, isAvailable: false },
        { id: deleted.id, isAvailable: false },
      ]),
    ).toEqual([]);
    const service = new MenuService(app.env);
    await expect(
      service.updateMenuItem(deleted.id, { isAvailable: false }),
    ).rejects.toThrow();
    await expect(
      service.updateMenuItem(foreign.id, { restaurantId: own.id }),
    ).rejects.toThrow();
    await expect(
      new ManagerActionsService(app.env).execute(
        {
          action: "update_menu_availability",
          resource: "menu_item",
          resourceId: String(foreign.id),
          restaurantId: own.id,
        },
        { id: "unused", role: 1 } as AuthUser,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses public tokens for inactive, deleted, and missing restaurants", async () => {
    const inactive = await seed.restaurant({ isActive: false });
    const deleted = await seed.restaurant({
      isActive: true,
      deletedAt: new Date(),
    });
    const auth = new RealtimeAuthService(app.env);
    for (const restaurantId of [inactive.id, deleted.id, "missing"]) {
      expect(await auth.generateMenuToken({ restaurantId })).toHaveProperty(
        "error",
      );
    }
  });
});
