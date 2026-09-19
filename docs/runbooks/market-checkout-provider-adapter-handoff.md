# Market Checkout Provider Adapter Handoff

Use this handoff when a payment provider is selected for market checkout
provider split mode. The market checkout core is provider-agnostic; provider
work should stay inside adapter endpoints, provider-specific customer
confirmation, and provider-specific webhook translation.

## Scope

Provider adapter implementation owns:

- Creating one aggregate payment intent for a market checkout.
- Returning one provider-agnostic `nextAction` when customer confirmation is
  required.
- Looking up provider status for manual and automatic reconciliation.
- Verifying provider callbacks and translating them into the generic webhook
  status model.
- Requesting or translating aggregate refunds.

Provider adapter implementation must not:

- Mark market checkouts paid without a paid provider response, verified webhook,
  or reconciliation response.
- Mutate child order payment state directly outside the market checkout payment
  path.
- Add provider SDK dependencies to the customer app before the selected provider
  requires `client_secret` or `sdk_confirmation` handling.
- Change market checkout ledger schema unless the existing provider payload
  fields cannot represent the provider state.

## Required Endpoints

### Create Payment

Configure with `MARKET_CHECKOUT_PROVIDER_SPLIT_URL`.

The endpoint receives the provider split gateway request documented in
`docs/superpowers/specs/2026-06-02-market-checkout-provider-contract.md`.

The adapter must:

- Treat `idempotencyKey` as stable for retries.
- Authorize exactly the requested amount in `currency` — convert it with the
  [money units](#money-units) table, never pass `amountCents` to a gateway
  as-is.
- Return `currency` and `authorizedAmountCents` (internal cents) on a `paid`
  response; both are checked against the request.
- Preserve `checkoutId`, `marketSlug`, and allocation metadata for later
  webhook or status lookup.
- Return `status: "paid"` only when the provider has authorized or captured the
  aggregate payment.
- Return `status: "requires_action"` or `status: "pending"` when customer or
  provider-side confirmation is still incomplete.

### Status Lookup

Configure with `MARKET_CHECKOUT_PROVIDER_STATUS_URL`.

The adapter must return one of:

- `pending`
- `paid`
- `failed`
- `refunded`
- `partial_refunded`

This response powers manual admin reconciliation and the automatic stale pending
payment worker. It should include `eventId`, `eventType`, and
`providerPayload` whenever the provider exposes enough detail.

### Refund

Configure with `MARKET_CHECKOUT_PROVIDER_REFUND_URL`.

The adapter must:

- Treat refund `idempotencyKey` as stable for the same refund attempt.
- Return `pending` when refund completion is delayed.
- Return `refunded` or `partial_refunded` only when provider refund state proves
  the refund amount.
- Return `failed` with provider diagnostics in `providerPayload` when the
  provider rejects the refund.

### Health Check

Configure with `MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL`.

The health endpoint should return `2xx` plus optional:

```json
{
  "message": "Provider gateway ready",
  "capabilities": ["aggregate_authorization", "provider_allocations"]
}
```

## Money Units

MakanMasak stores every amount as integer **cents = major units × 100**, for
every currency. That is a storage convention, not any provider's unit, and it
is where 100× errors come from. Every amount-bearing request the core sends
therefore carries two forms:

| field | meaning | NT$250 | RM12.50 | ₫100,000 |
| --- | --- | --- | --- | --- |
| `amountCents` | internal cents (major × 100) | 25000 | 1250 | 10000000 |
| `amountMinor` | ISO 4217 minor units | 25000 | 1250 | 100000 |
| `currencyExponent` | ISO 4217 exponent | 2 | 2 | 0 |

Allocations carry `amountCents` and `amountMinor` too. The core refuses to send
an amount that is not on the currency's step (TWD and VND are whole units), so
the conversions below are always exact.

What to hand each gateway, verified against the provider docs on 2026-09-19:

| gateway | TWD | MYR | VND | source |
| --- | --- | --- | --- | --- |
| Stripe `amount` | `amountMinor` (two-decimal) | `amountMinor` | `amountMinor` (zero-decimal: whole dong) | <https://docs.stripe.com/currencies> — VND is in the zero-decimal list; TWD is charged as two-decimal, and TWD payouts must be divisible by 100 |
| LINE Pay `amount` | `amountMinor / 100` (whole NT$) | not supported | not supported | <https://developers-pay.line.me/online-api-v3/request-payment> — currencies USD, TWD, THB; examples send `"amount": 100, "currency": "TWD"` |
| ECPay `TotalAmount` | `amountMinor / 100` | not supported | not supported | ECPay AIO: "請帶整數，不可有小數點。僅限新台幣" |
| NewebPay `Amt` | `amountMinor / 100` | not supported | not supported | NewebPay MPG manual (integer TWD) |

Coming back, the core converts with the same table (see
`apps/api/src/shared/utils/provider-money.ts`):

- Responses from **your adapter** (create payment, status lookup, refund) and
  generic `market_checkout.payment_*` webhooks are read as **internal cents**:
  `authorizedAmountCents`, `amountReceivedCents`, `amountRefundedCents`,
  `refundedAmountCents`, `amount_cents`, `amount_received`,
  `amount_refunded`. Always include `currency`.
- Raw **Stripe** events posted to `/market-checkouts/payment-webhooks/stripe`
  are read in Stripe's unit for `data.object.currency`.
- **LINE Pay** confirm results posted to `/market-checkouts/payment-webhooks/linepay`
  are read in whole TWD. The confirm response has no currency, so add the
  `currency` you confirmed at the top level.

A paid amount must equal the payment exactly, in the same currency; a refund
must not exceed what was paid. Anything else is **held for review**, not
applied: the payment keeps its status, `review_required` is recorded with the
reason, a `failure` row goes to `payment_audit_log`, and the admin sees the
`provider_amount_mismatch` alert. Webhooks still get a 2xx so the provider stops
redelivering; a refund response that fails the check makes the refund call
answer `502 MARKET_CHECKOUT_PROVIDER_REFUND_MISMATCH`.

## Required Environment Values

Production provider split mode requires:

```env
MARKET_CHECKOUT_SPLIT_MODE=provider_split
MARKET_CHECKOUT_PROVIDER_SPLIT_URL=
MARKET_CHECKOUT_PROVIDER_STATUS_URL=
MARKET_CHECKOUT_PROVIDER_REFUND_URL=
MARKET_CHECKOUT_WEBHOOK_SECRET=
```

Strongly recommended before production traffic:

```env
MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN=
MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET=
MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL=
```

## Customer Confirmation Contract

The adapter may return exactly one of these `nextAction` types:

- `redirect`: include non-empty `redirectUrl`; the customer app opens it in the
  current tab.
- `client_secret`: include non-empty `clientSecret`; provider-specific payment
  element work can be added after provider selection.
- `sdk_confirmation`: include object `providerPayload`; provider-specific SDK
  confirmation work can be added after provider selection.

Invalid or unsupported `nextAction` payloads are rejected before the checkout is
persisted as a pending provider payment.

## Webhook Translation

Provider callbacks must translate into the generic webhook status model:

- paid: `market_checkout.payment_paid`
- failed: `market_checkout.payment_failed`
- refunded: `market_checkout.payment_refunded`
- partial refund: `market_checkout.payment_partial_refunded`

Callbacks must include at least one stable identifier:

- `marketCheckoutPaymentId`
- `marketCheckoutId`
- provider transaction ID

Unsigned callbacks fail before audit, ledger, session, or cache mutation.
Duplicate provider event IDs are idempotent through the payment audit log.

## Required Test Fixtures

Before enabling production traffic, add provider-specific fixtures for:

- Immediate paid payment response.
- Pending redirect payment response.
- `client_secret` or `sdk_confirmation` response if the selected provider needs
  it.
- Paid webhook event.
- Failed webhook event.
- Pending status lookup response.
- Paid status lookup response.
- Refunded status lookup response.
- Pending refund response.
- Completed refund response.

Keep the generic mock fixtures in
`apps/api/src/features/market-checkouts/testing/mockMarketCheckoutProviderContract.ts`
as the baseline contract.

## Acceptance Gates

Run these commands after the adapter is wired:

```bash
pnpm exec vitest run apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentProvider.test.ts
pnpm exec vitest run apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentWebhookService.test.ts
pnpm exec vitest run apps/api/src/workers/market-checkout-reconciliation.test.ts
pnpm exec vitest run apps/api/src/features/market-checkouts/routes/index.test.ts
pnpm exec vitest run apps/customer-app/src/tests/views/market-checkout-tracking-view.test.ts
pnpm exec vitest run apps/admin-dashboard/src/views/PlatformMarketCheckoutsView.test.ts
```

Production enablement is allowed only when:

- Admin provider status reports `ready`.
- Provider connectivity check passes or the missing health URL is an explicit
  launch decision.
- Create payment, status lookup, webhook verification, and refund fixtures pass.
- Pending payment paths stay pending until webhook or reconciliation proves the
  final state.
- Accounting export includes payment clearing, vendor payable, platform fee, and
  refund journal lines for provider split payments.
