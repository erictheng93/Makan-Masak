# Billing Incident Response

## Scope

Use this runbook for billing cron, payment webhook, audit log, or billing
notification incidents.

## Checks

1. Inspect `payment_audit_log` for the affected `restaurant_id`,
   `provider_event_id`, or `subscription_id`.
2. Check `cycle_snapshots` for duplicate or missing rows by
   `(restaurant_id, cycle_start_at_ms)`.
3. Check `notification_dispatch_log` for skipped provider configuration,
   duplicate suppression, or provider failures.
4. Confirm the Worker cron `15 2 * * *` ran the billing lifecycle task.
5. For "shop still blocked / still has access after we changed their plan or
   modules", check the KV key `subscription:<restaurantId>` before touching the
   DB — it caches the subscription for 5 minutes and is only invalidated
   automatically by the admin API routes, not by direct D1 edits. See
   [architecture/modular-billing.md § Module Overrides](../architecture/modular-billing.md#cache-invalidation-required).

## Recovery

1. For missed cycle close, rerun the billing lifecycle cron after verifying the
   subscription has `billing_cycle_end_at_ms <= now`.
2. For duplicate webhooks, confirm `payment_audit_provider_event_idx` contains
   the provider event. The webhook endpoint is idempotent and should return
   `duplicate: true`.
3. For failed invoice reconciliation, replay the provider webhook after fixing
   signature/configuration issues.
4. For notification failures, configure `SLACK_WEBHOOK_URL`, or confirm the
   `NOTIFICATION_EMAIL` send_email binding is deployed (set `BILLING_EMAIL_FROM`
   to override the sender), then resend with a new dedup key
   when the original dispatch row was intentionally skipped.
