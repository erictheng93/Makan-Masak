# Spec: Market Checkout Provider Contract

## Objective

Market checkout payments should be ready for a future payment provider choice
without coupling the platform to a specific gateway today.

This contract defines the HTTP provider split gateway, payment `nextAction`
model, webhook callback shape, signature rules, readiness checks, and
verification commands. A future Stripe, TapPay, ECPay, NewebPay, LINE Pay, or
custom acquirer adapter should be able to implement this contract and plug into
the existing market checkout flow.

Success means the platform can:

- Create one aggregate market payment intent for a checkout.
- Allocate the aggregate authorization across child vendor orders.
- Return provider-agnostic payment actions to the customer app.
- Reconcile asynchronous paid, failed, refunded, and partial refund callbacks.
- Expose missing provider configuration in the platform admin dashboard.

## Tech Stack

- Cloudflare Workers API with TypeScript.
- Vue 3 customer app and admin dashboard.
- D1 stores parent market checkout payment ledger rows.
- KV caches market checkout sessions and operation index entries.
- Vitest covers provider gateway parsing, route behavior, webhook reconciliation,
  customer tracking, and admin provider status.

## Commands

- Provider service tests:
  `pnpm exec vitest run apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentProvider.test.ts`
- Webhook service tests:
  `pnpm exec vitest run apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentWebhookService.test.ts`
- Market checkout route tests:
  `pnpm exec vitest run apps/api/src/features/market-checkouts/routes/index.test.ts`
- Customer tracking tests:
  `pnpm exec vitest run apps/customer-app/src/tests/views/market-checkout-tracking-view.test.ts`
- Admin provider status tests:
  `pnpm exec vitest run apps/admin-dashboard/src/views/PlatformMarketCheckoutsView.test.ts`
- Typecheck:
  `pnpm typecheck`
- Lint:
  `pnpm lint`

## Project Structure

- `apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentProvider.ts`
  owns provider split request/response parsing, HMAC request signing, readiness,
  and health checks.
- `apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentWebhookService.ts`
  owns payment webhook signature verification, audit deduplication, ledger
  updates, session summary updates, and KV cache reconciliation.
- `apps/api/src/features/market-checkouts/routes/index.ts` exposes
  `/market-checkouts/:id/pay`, `/market-checkouts/payment-webhooks/:provider`,
  and admin provider status endpoints.
- `apps/api/src/features/market-checkouts/testing/mockMarketCheckoutProviderContract.ts`
  provides reusable mock provider request, response, webhook, and signature
  fixtures for contract tests.
- `apps/customer-app/src/views/MarketCheckoutTrackingView.vue` handles provider
  `nextAction` responses after starting an aggregate market payment.
- `apps/admin-dashboard/src/views/PlatformMarketCheckoutsView.vue` displays
  provider readiness and connectivity.

## Environment Contract

Provider split mode is enabled with:

```env
MARKET_CHECKOUT_SPLIT_MODE=provider_split
MARKET_CHECKOUT_PROVIDER_SPLIT_URL=https://provider.example.test/market-split
MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL=https://provider.example.test/health
MARKET_CHECKOUT_PROVIDER_STATUS_URL=https://provider.example.test/market-split/status
MARKET_CHECKOUT_PROVIDER_REFUND_URL=https://provider.example.test/market-split/refunds
MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN=optional-bearer-token
MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET=optional-request-signing-secret
MARKET_CHECKOUT_WEBHOOK_SECRET=webhook-verification-secret
```

Readiness rules:

- Missing `MARKET_CHECKOUT_PROVIDER_SPLIT_URL` means `not_configured`.
- Configured gateway URL without `MARKET_CHECKOUT_WEBHOOK_SECRET` means
  `warning`, because payment status callbacks will be rejected.
- Configured gateway URL without `MARKET_CHECKOUT_PROVIDER_STATUS_URL` means
  `warning`, because manual reconciliation cannot query provider state.
- Configured gateway URL without `MARKET_CHECKOUT_PROVIDER_REFUND_URL` means
  `warning`, because provider split refunds cannot be requested.
- Configured gateway URL, webhook secret, provider status URL, and provider
  refund URL means `ready`.
- `MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET` is optional for non-production
  experiments, but should be configured before production because provider split
  requests include payment allocation data.
- `MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL` is optional, but without it admin
  connectivity checks are skipped.

## Provider Split Gateway Request

The API sends a JSON `POST` to `MARKET_CHECKOUT_PROVIDER_SPLIT_URL`.

Headers:

- `content-type: application/json`
- `authorization: Bearer <MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN>` when a token is
  configured.
- `x-market-checkout-signature-algorithm: hmac-sha256` when request signing is
  configured.
- `x-market-checkout-signature-timestamp: <ISO timestamp>` when request signing
  is configured.
- `x-market-checkout-signature: <hex hmac>` when request signing is configured.

The signature payload is:

```text
<x-market-checkout-signature-timestamp>.<raw JSON request body>
```

The request body is:

```json
{
  "checkoutId": "checkout-1",
  "marketSlug": "fengjia",
  "method": "market_online",
  "country": "TW",
  "currency": "TWD",
  "idempotencyKey": "market-checkout:checkout-1",
  "amountCents": 24000,
  "amountMinor": 24000,
  "currencyExponent": 2,
  "customerInfo": {
    "name": "Customer",
    "email": "customer@example.test",
    "phone": "0912345678"
  },
  "providerInput": {
    "returnUrl": "https://app.example.test/markets/fengjia/checkouts/checkout-1",
    "locale": "zh-TW"
  },
  "allocations": [
    {
      "restaurantId": "restaurant-1",
      "restaurantName": "Chicken Stall",
      "orderId": 101,
      "orderNumber": "A001",
      "amountCents": 16000,
      "amountMinor": 16000
    },
    {
      "restaurantId": "restaurant-2",
      "restaurantName": "Dessert Stall",
      "orderId": 102,
      "orderNumber": "A002",
      "amountCents": 8000,
      "amountMinor": 8000
    }
  ]
}
```

Money units (binding; full table in
`docs/runbooks/market-checkout-provider-adapter-handoff.md#money-units`):

- `amountCents` is MakanMasak's internal unit: major units × 100 for **every**
  currency. NT$240 = 24000, RM12.50 = 1250, ₫100,000 = 10000000.
- `amountMinor` + `currencyExponent` is the same amount in ISO 4217 minor
  units (TWD 2, MYR 2, VND 0). ₫100,000 is `amountMinor: 100000,
  currencyExponent: 0`.
- Never pass `amountCents` to a gateway as-is. Stripe takes `amountMinor`;
  LINE Pay / ECPay / NewebPay take `amountMinor / 10^currencyExponent` (whole
  TWD).
- The core refuses to send an amount that is not on the currency's step (TWD
  and VND whole units), so `amountMinor / 10^currencyExponent` is always an
  integer for a whole-unit gateway.

Provider requirements:

- Treat `idempotencyKey` as stable for retries of the same market checkout
  payment attempt.
- Authorize exactly the amount described by `amountCents` (equivalently
  `amountMinor` at `currencyExponent`) in `currency`.
- Preserve enough metadata to send a webhook with at least one of:
  `marketCheckoutPaymentId`, `marketCheckoutId`, or provider transaction ID.
- Return one allocation per child order when the payment is immediately paid.
- Return no child allocations when status is pending or requires customer
  action.

## Provider Split Gateway Response

Immediate paid response:

```json
{
  "provider": "future_provider",
  "providerTransactionId": "intent-market-1",
  "status": "paid",
  "authorizedAmountCents": 24000,
  "currency": "TWD",
  "allocations": [
    {
      "orderId": 101,
      "paymentId": "pay-101",
      "amountCents": 16000
    },
    {
      "orderId": 102,
      "paymentId": "pay-102",
      "amountCents": 8000
    }
  ]
}
```

Pending customer-action response:

```json
{
  "provider": "future_provider",
  "providerTransactionId": "intent-market-1",
  "status": "requires_action",
  "authorizedAmountCents": 0,
  "allocations": [],
  "nextAction": {
    "type": "redirect",
    "redirectUrl": "https://payments.example.test/confirm/intent-market-1",
    "expiresAt": "2026-06-02T10:30:00.000Z",
    "providerPayload": {
      "intentId": "intent-market-1"
    }
  }
}
```

Response validation:

- `provider` must be a non-empty string.
- `providerTransactionId` must be a non-empty string.
- `authorizedAmountCents` must be a number, in internal cents.
- For paid responses, `authorizedAmountCents` must equal the request's
  `amountCents` and `currency` must equal the request's `currency`; anything
  else fails the payment.
- `status` may be `paid`, `pending`, or `requires_action`.
- For paid responses, allocation amounts must match child order totals and each
  child order must appear once.
- `nextAction.type` may be `redirect`, `client_secret`, or `sdk_confirmation`.

## Next Action Contract

`nextAction` is provider-agnostic and stored in parent payment provider payload.

```ts
type MarketCheckoutProviderNextAction = {
  type: "redirect" | "client_secret" | "sdk_confirmation";
  redirectUrl?: string;
  clientSecret?: string;
  expiresAt?: string;
  providerPayload?: Record<string, unknown>;
};
```

Customer behavior:

- `redirect`: open `redirectUrl` in the current tab.
- `client_secret`: keep the checkout in pending state and hand the client secret
  to a provider-specific payment element once that provider is selected.
- `sdk_confirmation`: keep the checkout in pending state and hand
  `providerPayload` to a provider-specific SDK once that provider is selected.

Validation:

- `redirect` actions must include a non-empty `redirectUrl`.
- `client_secret` actions must include a non-empty `clientSecret`.
- `sdk_confirmation` actions must include an object `providerPayload`.
- Invalid `nextAction` payloads fail closed and are rejected as invalid provider
  split responses.

## Webhook Contract

Provider callbacks are sent to:

```text
POST /api/v1/market-checkouts/payment-webhooks/:provider
```

Generic HMAC webhook headers:

- `x-webhook-signature: <hex hmac>`
- `x-provider-event-id: <provider event id>` optional but recommended.
- `x-provider-event-type: <provider event type>` optional.
- `x-market-payment-id: <market checkout parent payment id>` optional.
- `x-market-checkout-id: <market checkout id>` optional.
- `x-provider-transaction-id: <provider transaction id>` optional.

The generic HMAC payload is the raw request body signed with
`MARKET_CHECKOUT_WEBHOOK_SECRET`.

Stripe-compatible callbacks may use `stripe-signature`; the signed payload is:

```text
<stripe timestamp>.<raw JSON body>
```

LINE Pay-compatible callbacks may use `x-linepay-nonce` and
`x-linepay-signature`; the signed payload is:

```text
<secret><raw JSON body><nonce>
```

Amounts in callbacks (see the runbook's money-units table):

- Generic `market_checkout.payment_*` events carry internal cents
  (`amount_cents` / `amount_received`, `refunded_amount_cents` /
  `amount_refunded`) plus `currency`.
- Stripe events posted to `/payment-webhooks/stripe` are read in Stripe's
  unit for the object's `currency` (VND whole dong).
- LINE Pay confirm results posted to `/payment-webhooks/linepay` are read in
  whole TWD (`info.payInfo[].amount`, summed) and must carry the `currency` the
  adapter confirmed.
- A paid event must report exactly the payment's amount and currency; a
  refund must not exceed what was paid. Otherwise the event is held for review
  (payment status unchanged, `lastWebhook.status: "review_required"`, a
  `failure` payment audit row, the `provider_amount_mismatch` alert) and the
  endpoint still answers 2xx so the provider stops retrying.

Generic paid callback:

```json
{
  "id": "evt-market-paid-1",
  "type": "market_checkout.payment_paid",
  "status": "paid",
  "amount_received": 24000,
  "currency": "TWD",
  "metadata": {
    "marketCheckoutId": "checkout-1",
    "marketCheckoutPaymentId": "market_pay_checkout-1",
    "providerTransactionId": "intent-market-1"
  }
}
```

Supported event/status mapping:

- `market_checkout.payment_paid`, `payment_intent.succeeded`,
  `checkout.session.completed`, or status `succeeded`, `paid`, `completed`
  becomes `paid`.
- `market_checkout.payment_failed`, `payment_intent.payment_failed`,
  `charge.failed`, or status `failed`, `payment_failed` becomes `failed`.
- `market_checkout.payment_refunded`, `charge.refunded`, `refund.succeeded`, or
  status `refunded` becomes `refunded`.
- `market_checkout.payment_partial_refunded` or status `partial_refunded`,
  `partially_refunded` becomes `partial_refunded`.

Webhook processing rules:

- Verify signature before parsing or mutating payment state.
- Insert into payment audit log before reconciliation.
- Treat duplicate provider event IDs as idempotent and do not update ledgers
  twice.
- Find the parent market checkout payment by payment ID, checkout ID, or
  provider transaction ID.
- Update `market_checkout_payments`, `market_checkout_sessions`, cached checkout
  session KV, and cached admin index KV.

## Provider Status Lookup Contract

Admin reconciliation calls send a JSON `POST` to
`MARKET_CHECKOUT_PROVIDER_STATUS_URL`. This endpoint is provider-agnostic and is
used when a webhook is delayed, missing, or suspected to have failed.

Headers match the gateway request contract:

- `content-type: application/json`
- `authorization: Bearer <MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN>` when a token is
  configured.
- `x-market-checkout-signature-algorithm: hmac-sha256` when request signing is
  configured.
- `x-market-checkout-signature-timestamp: <ISO timestamp>` when request signing
  is configured.
- `x-market-checkout-signature: <hex hmac>` when request signing is configured.

The request body is:

```json
{
  "checkoutId": "checkout-1",
  "paymentId": "market_pay_checkout-1",
  "provider": "mock_market_provider",
  "providerTransactionId": "intent-market-checkout-1",
  "idempotencyKey": "market-checkout:checkout-1",
  "amountCents": 24000,
  "amountMinor": 24000,
  "currencyExponent": 2,
  "currency": "TWD",
  "country": "TW"
}
```

Expected response:

```json
{
  "provider": "mock_market_provider",
  "providerTransactionId": "intent-market-checkout-1",
  "status": "paid",
  "amountReceivedCents": 24000,
  "amountRefundedCents": 0,
  "currency": "TWD",
  "eventId": "reconcile-market-checkout-1",
  "eventType": "market_checkout.payment_paid",
  "providerPayload": {}
}
```

Allowed `status` values are `pending`, `paid`, `failed`, `refunded`, and
`partial_refunded`. `amountReceivedCents` / `amountRefundedCents` are internal
cents and must be integers; `paid` requires `amountReceivedCents` equal to the
payment and `currency` equal to its currency, and a refund status is settled by
`amountRefundedCents` (whole payment → `refunded`, less → `partial_refunded`).
A mismatch is held for review exactly like a webhook. Reconciliation updates `market_checkout_payments`,
`market_checkout_sessions`, cached checkout session KV, and cached admin index
KV. The raw provider response is stored under
`provider_payload.lastReconciliation`.

Automatic reconciliation runs from the API worker `*/5 * * * *` cron. It scans
provider split parent payments that are still `pending` after 30 minutes, limits
each batch to 25 payments, calls `MARKET_CHECKOUT_PROVIDER_STATUS_URL`, and
applies the same ledger/session/KV update path as manual admin reconciliation.
If provider split mode or the status lookup URL is not configured, the cron task
skips without mutating payment state.

## Provider Refund Contract

Provider split refunds send a JSON `POST` to
`MARKET_CHECKOUT_PROVIDER_REFUND_URL`. Headers match the gateway request
contract, including optional bearer-token authentication and HMAC request
signing.

The request body is:

```json
{
  "checkoutId": "checkout-1",
  "paymentId": "market_pay_checkout-1",
  "provider": "mock_market_provider",
  "providerTransactionId": "intent-market-checkout-1",
  "idempotencyKey": "market-checkout:checkout-1:refund",
  "amountCents": 24000,
  "amountMinor": 24000,
  "currencyExponent": 2,
  "currency": "TWD",
  "reason": "customer_request",
  "allocations": [
    {
      "restaurantId": "restaurant-1",
      "restaurantName": "Chicken Stall",
      "orderId": 101,
      "orderNumber": "A001",
      "amountCents": 16000,
      "amountMinor": 16000
    }
  ]
}
```

Expected response:

```json
{
  "provider": "mock_market_provider",
  "providerTransactionId": "intent-market-checkout-1",
  "refundId": "refund-market-checkout-1",
  "status": "refunded",
  "refundedAmountCents": 24000,
  "currency": "TWD",
  "eventId": "refund-market-checkout-1",
  "eventType": "market_checkout.payment_refunded",
  "providerPayload": {}
}
```

Allowed refund `status` values are `refunded`, `partial_refunded`, `pending`,
and `failed`. A completed refund must report `currency` equal to the request's
and an integer `refundedAmountCents` above zero and at most the requested
`amountCents`; its amount, not its label, decides full vs partial. Otherwise the
route answers `502 MARKET_CHECKOUT_PROVIDER_REFUND_MISMATCH` and records the
response as `lastRefund.status: "review_required"` without touching the
ledger. Future route-level integration must fail closed when
`MARKET_CHECKOUT_PROVIDER_REFUND_URL` is missing for provider split payments.

## Health Check Contract

Admin connectivity checks call `MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL`.

Expected response:

```json
{
  "message": "Provider gateway ready",
  "capabilities": ["aggregate_authorization", "provider_allocations"]
}
```

Any 2xx response passes. Non-2xx responses fail. Missing health URL produces a
skipped check.

## Mock Provider Fixture

Provider contract tests should use
`apps/api/src/features/market-checkouts/testing/mockMarketCheckoutProviderContract.ts`
before adding provider-specific adapters.

Provider-specific adapters must implement the operations exported by
`MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS`:

- `create_payment`: create one aggregate market checkout payment intent.
- `status_lookup`: query provider state for manual and automatic
  reconciliation.
- `webhook_verification`: verify and translate asynchronous provider callbacks.
- `refund`: execute or translate aggregate/allocated refunds for market
  checkouts.

The fixture includes:

- `mockMarketCheckoutProviderRequiredOperations`, which must match
  `MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS`.
- `mockMarketCheckoutProviderGatewayInput` for a two-vendor checkout request.
- `mockMarketCheckoutProviderPendingResponse` for a redirect-based
  `requires_action` gateway response.
- `mockMarketCheckoutProviderPaidResponse` for an immediate paid allocation
  response.
- `mockMarketCheckoutProviderPaidWebhookPayload` for a generic HMAC paid
  callback.
- `signMockMarketCheckoutWebhook(secret, rawBody)` for
  `x-webhook-signature` tests.

## Boundaries

- Always: keep this contract provider-agnostic until a payment provider is
  selected.
- Always: fail closed when signatures are missing or invalid.
- Always: keep parent payment status pending for customer-action flows until a
  verified webhook or provider reconciliation marks it paid or failed.
- Always: preserve child order payment isolation; allocations must map to
  existing child order IDs.
- Ask first: adding provider SDK dependencies to the customer app.
- Ask first: database schema changes beyond the current market checkout payment
  ledger and provider payload fields.
- Never: accept unsigned provider split requests or webhooks in production.
- Never: mark a provider split payment paid unless the provider response or a
  verified webhook proves the aggregate amount and allocations.

## Success Criteria

- Provider split gateway request signing is documented and covered by tests.
- Provider split gateway paid and pending responses are documented and covered
  by tests.
- Customer redirect `nextAction` behavior is documented and covered by tests.
- Webhook signature verification and duplicate audit behavior are documented and
  covered by tests.
- Provider status lookup reconciliation is documented and covered by route and
  provider service tests.
- Stale pending provider payments are automatically reconciled by cron and
  covered by worker tests.
- Admin readiness clearly shows gateway URL, webhook secret, request signing,
  and health check state.
- Future provider implementation work can be scoped to a connector adapter,
  provider-specific customer SDK handling, and provider-specific webhook payload
  translation.

## Open Questions

- Which provider-specific customer confirmation flow will be needed after the
  provider is selected: hosted redirect, embedded payment element, SDK
  confirmation, or multiple modes?
- Should production require `MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET`, or
  should readiness remain `warning` instead of `ready` when request signing is
  missing?
- Should provider reconciliation eventually support polling as a backup when
  webhooks are delayed?
