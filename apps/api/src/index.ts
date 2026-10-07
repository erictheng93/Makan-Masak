import { createApp } from "./app-factory";
import type { Env } from "./types/env";
import type {
  MessageBatch,
  ExecutionContext as CfExecutionContext,
} from "@cloudflare/workers-types";
import type { SearchSyncMessage } from "./features/discovery/services/SearchIndexSyncService";
import { cronMatches } from "./utils/cron";
import { GROUP_ORDER_EXPIRY_CRON } from "./workers/group-order-expiry";

const app = createApp();

// 匯出應用
export default {
  fetch: app.fetch,

  // Queue consumer: drains search-index fan-out jobs enqueued by
  // SearchIndexSyncService.onMarketChanged / onCategoryChanged. Each message
  // re-syncs one entity in its own invocation, well under D1's subrequest cap.
  queue: async (
    batch: MessageBatch<SearchSyncMessage>,
    env: Env,
    _ctx: CfExecutionContext,
  ) => {
    const { SearchIndexSyncService } =
      await import("./features/discovery/services/SearchIndexSyncService");
    // Construct WITHOUT a queue so consumer work stays inline and never
    // re-enqueues (defense-in-depth; processMessage only calls bounded handlers).
    const sync = new SearchIndexSyncService(env.DB, env.CACHE_KV);

    for (const message of batch.messages) {
      try {
        await sync.processMessage(message.body);
        message.ack();
      } catch (error) {
        console.error(
          "[Queue] search-sync message failed, will retry:",
          message.body,
          error,
        );
        message.retry();
      }
    }
  },

  // 計畫任務處理器 (Cron Jobs)
  scheduled: async (
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ) => {
    console.log("Scheduled event triggered:", event.cron);

    // Import scheduled tasks dynamically
    const {
      cleanupExpiredTokens,
      cleanupOldLogs,
      cleanupExpiredIdempotencyKeys,
    } = await import("./scheduled/cleanup-tokens");

    // Each job gets its own try/catch. They used to share one, so a single
    // failure (usually a transient D1 error) silently skipped every job after
    // it in the same tick — the */5 group-order sweep failing also skipped the
    // overdue order alert sweep.
    const runJob = async (name: string, job: () => Promise<void>) => {
      try {
        await job();
      } catch (error) {
        console.error(`[Cron] ${name} failed:`, error);
        try {
          const { AlertService } = await import("./services/AlertService");
          await new AlertService(env).systemError(
            error instanceof Error ? error : new Error(String(error)),
            `Cron Job Execution: ${name}`,
          );
        } catch (alertError) {
          // A failed alert must not take the remaining jobs down with it.
          console.error("[Cron] Failed to send cron alert:", alertError);
        }
      }
    };

    // Daily cleanup at 2 AM UTC: Clean expired verification tokens
    if (cronMatches(event.cron, "0 2 * * *")) {
      await runJob("token cleanup", async () => {
        console.log("[Cron] Running daily token cleanup...");
        const result = await cleanupExpiredTokens(env);
        console.log("[Cron] Token cleanup result:", result);
      });

      // Same tick: idempotency reservations. The platform webhook route
      // takes no authentication, so anyone can make these rows and nothing
      // else deletes them (#338).
      await runJob("idempotency key cleanup", async () => {
        console.log("[Cron] Running idempotency key cleanup...");
        const idempotency = await cleanupExpiredIdempotencyKeys(env);
        console.log("[Cron] Idempotency cleanup result:", idempotency);
      });
    }

    // Weekly cleanup on Sunday at 3 AM UTC: Clean old logs
    if (cronMatches(event.cron, "0 3 * * SUN")) {
      await runJob("weekly log cleanup", async () => {
        console.log("[Cron] Running weekly log cleanup...");
        await cleanupOldLogs(env);
      });
    }

    if (cronMatches(event.cron, "0 3 * * *")) {
      await runJob("usage events TTL cleanup", async () => {
        console.log("[Cron] Running usage events TTL cleanup...");
        const { cleanupExpiredUsageEvents } =
          await import("./workers/usage-events-ttl");
        const result = await cleanupExpiredUsageEvents(env);
        console.log("[Cron] Usage events TTL result:", result);
      });
    }

    // Daily forecast warmup at 2:30 AM UTC
    if (cronMatches(event.cron, "30 2 * * *")) {
      await runJob("forecast warmup", async () => {
        console.log("[Cron] Running daily forecast warmup...");
        const { ForecastService } =
          await import("./features/forecast/services/ForecastService");
        const forecastService = new ForecastService(env.DB, env.CACHE_KV);

        // Get active restaurants
        const restaurants = await env.DB.prepare(
          "SELECT id FROM restaurants WHERE is_active = 1 AND deleted_at_ms IS NULL",
        ).all<{ id: string }>();

        const tomorrow = new Date(Date.now() + 86400000);
        const day3 = new Date(Date.now() + 3 * 86400000);
        const formatDate = (d: Date) => d.toISOString().split("T")[0];

        let successCount = 0;
        for (const restaurant of restaurants.results) {
          try {
            await forecastService.generateForecast(restaurant.id, {
              startDate: formatDate(tomorrow),
              endDate: formatDate(day3),
            });
            successCount++;
          } catch (error) {
            console.error(
              `[Cron] Forecast warmup failed for restaurant ${restaurant.id}:`,
              error,
            );
          }
        }
        console.log(
          `[Cron] Forecast warmup complete: ${successCount}/${restaurants.results.length} restaurants`,
        );
      });
    }

    // Hourly, not */5: aggregation over a handful of meters gains nothing
    // from running 288 times a day, and it used to share the reconciliation
    // tick, which meant neither could be tuned without moving the other.
    if (cronMatches(event.cron, "0 * * * *")) {
      await runJob("usage aggregation", async () => {
        console.log("[Cron] Running usage aggregation...");
        const { aggregateUsageMeters } =
          await import("./workers/usage-aggregator");
        await aggregateUsageMeters(env);
      });
    }

    // Stays on */5: this settles money, so latency here is worth more than
    // the invocations it costs.
    if (cronMatches(event.cron, "*/5 * * * *")) {
      await runJob("market checkout reconciliation", async () => {
        console.log("[Cron] Running market checkout payment reconciliation...");
        const { reconcilePendingMarketCheckoutPayments } =
          await import("./workers/market-checkout-reconciliation");
        const result = await reconcilePendingMarketCheckoutPayments(env);
        console.log("[Cron] Market checkout reconciliation result:", result);
      });
    }

    if (cronMatches(event.cron, GROUP_ORDER_EXPIRY_CRON)) {
      await runJob("group order expiry sweep", async () => {
        console.log("[Cron] Running group order expiry sweep...");
        const { sweepExpiringGroupOrders } =
          await import("./workers/group-order-expiry");
        const result = await sweepExpiringGroupOrders(env);
        console.log("[Cron] Group order expiry sweep result:", result);
      });
    }

    // Rides the shared */5 tick rather than adding a cron entry (#285).
    if (cronMatches(event.cron, "*/5 * * * *")) {
      await runJob("overdue order alert sweep", async () => {
        console.log("[Cron] Running overdue order alert sweep...");
        const { raiseOverdueOrderAlerts } =
          await import("./workers/overdue-order-alerts");
        const result = await raiseOverdueOrderAlerts(env);
        console.log("[Cron] Overdue order alert sweep result:", result);
      });
    }

    if (cronMatches(event.cron, "0 2 * * *")) {
      await runJob("storage usage snapshot", async () => {
        console.log("[Cron] Running storage usage snapshot...");
        const { snapshotStorageUsage } =
          await import("./workers/storage-snapshot");
        await snapshotStorageUsage(env);
      });
    }

    if (cronMatches(event.cron, "0 2 * * *")) {
      await runJob("customer push subscription pruning", async () => {
        console.log("[Cron] Running customer push subscription pruning...");
        const { pruneStaleCustomerPushSubscriptions } =
          await import("./features/customer/routes");
        const result = await pruneStaleCustomerPushSubscriptions(env);
        console.log("[Cron] Customer push pruning result:", result);
      });
    }

    if (cronMatches(event.cron, "0 4 * * *")) {
      await runJob("stored-value credit expiry", async () => {
        console.log("[Cron] Running stored-value credit expiry...");
        const { expireStaleCredits } = await import("./workers/credit-expiry");
        const result = await expireStaleCredits(env);
        console.log("[Cron] Credit expiry result:", result);
      });
    }

    if (cronMatches(event.cron, "15 2 * * *")) {
      await runJob("billing lifecycle", async () => {
        console.log("[Cron] Running billing cycle closer...");
        const { BillingCycleService } =
          await import("./features/billing/services/BillingCycleService");
        const { BillingReminderService } =
          await import("./features/billing/services/BillingNotificationService");
        const cycleCloser = new BillingCycleService(env);
        const reminderService = new BillingReminderService(env);
        const [cycleResult, reminderResult] = await Promise.all([
          cycleCloser.closeDueCycles(),
          reminderService.sendTrialEndingReminders(),
        ]);
        console.log("[Cron] Billing lifecycle result:", {
          ...cycleResult,
          ...reminderResult,
        });
      });
    }
  },
};
