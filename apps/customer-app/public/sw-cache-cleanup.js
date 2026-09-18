// `cleanupOutdatedCaches` only removes Workbox precaches. This migration
// removes the old broad runtime cache and bridges clients from the former
// injected registration script exactly once.
const MIGRATION_CACHE = "makanmasak-sw-migration";
const MIGRATION_COMPLETE_MARKER = "/issue-395-complete";
const MIGRATION_PENDING_MARKER = "/issue-395-pending";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(MIGRATION_CACHE).then(async (migrationCache) => {
      const hasCompletedMigration = Boolean(
        await migrationCache.match(MIGRATION_COMPLETE_MARKER),
      );

      if (!hasCompletedMigration && self.registration.active) {
        await migrationCache.put(MIGRATION_PENDING_MARKER, new Response("1"));
      }
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.open(MIGRATION_CACHE).then(async (migrationCache) => {
      const shouldBridgeOldClient = Boolean(
        await migrationCache.match(MIGRATION_PENDING_MARKER),
      );
      await migrationCache.put(MIGRATION_COMPLETE_MARKER, new Response("1"));
      await migrationCache.delete(MIGRATION_PENDING_MARKER);
      await caches.delete("api-cache");

      if (!shouldBridgeOldClient) return;

      // Do not await navigation from activation: a navigation can wait for
      // activation to finish, creating a worker lifecycle deadlock.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        void client.navigate(client.url).catch(() => undefined);
      }
    }),
  );
});
