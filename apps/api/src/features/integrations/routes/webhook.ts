import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  platformIntegrations,
  platformWebhookLogs,
  WEBHOOK_LOG_STATUS,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";
import { getAdapter } from "../adapters/PlatformAdapter";
import { PlatformOrderService } from "../services/PlatformOrderService";
import { PlatformIntegrationService } from "../services/PlatformIntegrationService";
import { idempotencyMiddleware } from "../../../middleware/idempotency";

const webhookRoutes = new Hono<{ Bindings: Env }>();

/**
 * Event types that announce a new order. Only these may reach
 * `processWebhook`, which builds a brand-new internal order out of the
 * payload: routing a cancellation or a status change through it would either
 * collide with the order we already have or invent one that never existed.
 *
 * An unrecognised type is acknowledged and logged as `ignored` rather than
 * guessed at. That is deliberately the safe direction — a dropped event stays
 * visible in `platform_webhook_logs` with its type and raw payload, while a
 * guessed one writes an order nobody placed.
 */
const ORDER_CREATION_EVENT_TYPES = new Set([
  "order",
  "order.created",
  "orders.notification",
  "orders.scheduled.notification",
]);

// Providers have used both American and British spellings and both singular
// and plural namespaces. Keep these explicit until production webhook logs
// establish the precise contracted event name for each provider.
const ORDER_CANCELLATION_EVENT_TYPES = new Set([
  "order.cancel",
  "order.cancelled",
  "order.canceled",
  "orders.cancel",
  "orders.cancelled",
  "orders.canceled",
]);

// Webhook error bodies are an external platform contract. Uber Eats and
// Foodpanda determine delivery success from the HTTP status, so these routes
// intentionally retain their established `{ error: string }` responses rather
// than adopting the internal API error envelope.

webhookRoutes.post(
  "/uber-eats",
  idempotencyMiddleware({
    scope: "webhook",
    // Without this the 500 below is cached and replayed for the full 24h TTL,
    // which outlives Uber's retry window — so the release of
    // `platform_webhook_logs.platform_event_id` on the failure path never gets
    // a chance to matter and the order is silently dropped.
    //
    // Re-running is safe here because two layers guard it: the unique
    // event-id index on `platform_webhook_logs` still rejects a redelivery of
    // an event that *did* process (it is only cleared on the same failure
    // path), and `PlatformOrderService.processWebhook` is idempotent per
    // platform order, so a retry after a partial failure converges instead of
    // duplicating.
    releaseOnServerError: true,
    keyResolver: (c, rawBody) => {
      const headerKey = c.req.header("Idempotency-Key");
      if (headerKey) return headerKey;

      try {
        const payload = JSON.parse(rawBody) as {
          event_id?: string;
          eventId?: string;
        };
        return payload.event_id ?? payload.eventId ?? null;
      } catch {
        return null;
      }
    },
    effectId: async (_c, response) => {
      const body = (await response.clone().json()) as {
        orderId?: number;
        data?: { orderId?: number };
      };
      const orderId = body.data?.orderId ?? body.orderId;
      return orderId == null ? null : String(orderId);
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = await c.req.text();
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          success: false,
          error: { code: "INVALID_JSON", message: "Invalid JSON payload" },
        },
        400,
      );
    }

    const storePayload = payload as {
      store?: { id?: string };
      meta?: { user_id?: string; resource_id?: string };
    };
    const storeId = storePayload.meta?.user_id ?? storePayload.store?.id;
    if (!storeId) {
      return c.json(
        {
          success: false,
          error: {
            code: "MISSING_PARAM",
            message: "Missing store id in payload",
          },
        },
        400,
      );
    }

    // Resolve the integration on the plaintext store_id column, so this
    // unauthenticated route reads one row instead of decrypting every
    // tenant's credentials to find out which one it belongs to (#338). The
    // one remaining decryption below is unavoidable: the signing secret this
    // request has to be checked against is itself inside the ciphertext.
    const [integration] = await db
      .select()
      .from(platformIntegrations)
      .where(
        and(
          eq(platformIntegrations.platform, "uber_eats"),
          eq(platformIntegrations.enabled, true),
          eq(platformIntegrations.storeId, storeId),
        ),
      )
      .limit(1);

    if (!integration) {
      return c.json(
        {
          success: false,
          error: { code: "INTEGRATION_NOT_FOUND", message: "Unknown store" },
        },
        404,
      );
    }

    const integrationService = new PlatformIntegrationService(c.env);
    const matchedCredentials = await integrationService.readStoredCredentials(
      integration.credentials,
    );

    // Verify webhook signature
    const adapter = getAdapter("uber_eats");

    const config = integration.config as {
      webhookSecret?: string;
    } | null;
    const webhookSecret =
      matchedCredentials.webhookSecret ??
      config?.webhookSecret ??
      matchedCredentials.clientSecret;

    // No secret means no verification. This used to fall back to "", and an
    // HMAC keyed on the empty string is one any caller can compute — which
    // made the signature check a formality for any row stored without a
    // secret. Refuse instead of accepting a signature that proves nothing.
    if (!webhookSecret) {
      return c.json(
        {
          success: false,
          error: { code: "INVALID_SIGNATURE", message: "Invalid signature" },
        },
        401,
      );
    }

    const clonedRequest = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body,
    });

    const isValid = await adapter.verifyWebhook(clonedRequest, webhookSecret);
    if (!isValid) {
      return c.json(
        {
          success: false,
          error: { code: "INVALID_SIGNATURE", message: "Invalid signature" },
        },
        401,
      );
    }

    // Log webhook receipt
    const now = new Date();
    const eventType = (payload.event_type as string) ?? "order";
    // Both spellings, to match the key the idempotency middleware resolves.
    const rawEventId = payload.event_id ?? payload.eventId;
    const platformEventId = typeof rawEventId === "string" ? rawEventId : null;

    const [insertedLog] = await db
      .insert(platformWebhookLogs)
      .values({
        restaurantId: integration.restaurantId,
        platform: "uber_eats",
        eventType,
        platformEventId,
        payload: body as unknown as Record<string, unknown>,
        status: WEBHOOK_LOG_STATUS.RECEIVED,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: platformWebhookLogs.id });

    // Uber reuses event_id when delivery is retried. The unique insert is the
    // durable, atomic reservation: do not enter order creation a second time.
    if (!insertedLog) {
      return c.json({ success: true, data: { duplicate: true } }, 200);
    }

    const logId = insertedLog.id;

    // Payment-related callbacks (`payment.succeeded`, `payment.failed`, etc.)
    // are acknowledged here but do not flow through order parsing. They are
    // reconciled by the payments idempotency layer; the webhook just records
    // receipt and the replay contract comes from idempotencyMiddleware.
    if (eventType.startsWith("payment.")) {
      await db
        .update(platformWebhookLogs)
        .set({
          status: WEBHOOK_LOG_STATUS.PROCESSED,
          processedAt: new Date(),
        })
        .where(eq(platformWebhookLogs.id, logId));

      return c.json(
        {
          success: true,
          data: {
            acknowledged: true,
            eventType,
          },
        },
        200,
      );
    }

    if (ORDER_CANCELLATION_EVENT_TYPES.has(eventType)) {
      try {
        const orderService = new PlatformOrderService(c.env);
        const result = await orderService.processCancellation(
          "uber_eats",
          payload,
          integration.restaurantId,
        );

        await db
          .update(platformWebhookLogs)
          .set({
            status: result.handled
              ? WEBHOOK_LOG_STATUS.PROCESSED
              : WEBHOOK_LOG_STATUS.IGNORED,
            processedAt: new Date(),
          })
          .where(eq(platformWebhookLogs.id, logId));

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await db
          .update(platformWebhookLogs)
          .set({
            status: WEBHOOK_LOG_STATUS.FAILED,
            error: errorMessage,
            processedAt: new Date(),
            platformEventId: null,
          })
          .where(eq(platformWebhookLogs.id, logId));

        return c.json(
          {
            success: false,
            error: {
              code: "WEBHOOK_PROCESSING_FAILED",
              message: "Processing failed",
            },
          },
          500,
        );
      }
    }

    if (!ORDER_CREATION_EVENT_TYPES.has(eventType)) {
      await db
        .update(platformWebhookLogs)
        .set({ status: WEBHOOK_LOG_STATUS.IGNORED, processedAt: new Date() })
        .where(eq(platformWebhookLogs.id, logId));

      return c.json(
        {
          success: true,
          data: {
            acknowledged: true,
            eventType,
            handled: false,
          },
        },
        200,
      );
    }

    // Process the order — keep internal try/catch to record failure in the log
    try {
      let orderPayload: unknown = payload;
      if (
        eventType === "orders.notification" ||
        eventType === "orders.scheduled.notification"
      ) {
        const platformOrderId = storePayload.meta?.resource_id;
        if (!platformOrderId || !adapter.fetchOrder) {
          throw new Error(
            "Uber Eats order notification is missing an order id",
          );
        }
        orderPayload = await adapter.fetchOrder(
          platformOrderId,
          matchedCredentials,
        );
        const fetched = orderPayload as {
          id?: string;
          store?: { id?: string };
        };
        if (fetched.id !== platformOrderId || fetched.store?.id !== storeId) {
          throw new Error("Uber Eats order details do not match notification");
        }
      }
      const orderService = new PlatformOrderService(c.env);
      const orderId = await orderService.processWebhook(
        "uber_eats",
        orderPayload,
        integration.restaurantId,
      );

      await db
        .update(platformWebhookLogs)
        .set({
          status: WEBHOOK_LOG_STATUS.PROCESSED,
          processedAt: new Date(),
        })
        .where(eq(platformWebhookLogs.id, logId));

      return c.json({ success: true, orderId }, 200);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await db
        .update(platformWebhookLogs)
        .set({
          status: WEBHOOK_LOG_STATUS.FAILED,
          error: errorMessage,
          processedAt: new Date(),
          // Release the reservation. The event was not processed, so the 500
          // below is an honest "retry me" and a redelivery has to be allowed
          // through. processWebhook is idempotent per platform order now, so
          // retrying it can no longer duplicate anything. The provider's event
          // id is still on this row inside `payload`.
          platformEventId: null,
        })
        .where(eq(platformWebhookLogs.id, logId));

      return c.json(
        {
          success: false,
          error: {
            code: "WEBHOOK_PROCESSING_FAILED",
            message: "Processing failed",
          },
        },
        500,
      );
    }
  },
);

webhookRoutes.post("/foodpanda", async (c) => {
  return c.json(
    {
      success: false,
      error: {
        code: "INTEGRATION_NOT_AVAILABLE",
        message: "Foodpanda integration not yet implemented",
      },
    },
    501,
  );
});

export default webhookRoutes;
