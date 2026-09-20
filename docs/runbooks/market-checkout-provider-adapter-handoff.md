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

## Local End-To-End Run With The Fake Provider

`scripts/dev/fake-payment-provider.mjs` is a dependency-free Node adapter that
implements create payment, status lookup, refund and health, signs the
webhooks it sends back, and also serves the credit top-up charge endpoint.
Use it to run the real pay -> webhook -> paid -> reconcile -> refund flow
against a local API before any gateway exists.

1. Add to `apps/api/.dev.vars` (gitignored; keep your existing secrets):

   ```env
   MARKET_CHECKOUT_SPLIT_MODE=provider_split
   MARKET_CHECKOUT_PROVIDER_SPLIT_URL=http://127.0.0.1:8799/payments
   MARKET_CHECKOUT_PROVIDER_STATUS_URL=http://127.0.0.1:8799/status
   MARKET_CHECKOUT_PROVIDER_REFUND_URL=http://127.0.0.1:8799/refunds
   MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL=http://127.0.0.1:8799/health
   MARKET_CHECKOUT_WEBHOOK_SECRET=fake-market-webhook-secret
   CREDIT_TOPUP_PROVIDER_URL=http://127.0.0.1:8799/topups
   CREDIT_TOPUP_WEBHOOK_SECRET=fake-topup-webhook-secret
   ```

2. Start the API and the fake provider (the provider's defaults match the
   secrets above; point it at the API's port):

   ```bash
   pnpm dev:api                                   # http://127.0.0.1:8787
   node scripts/dev/fake-payment-provider.mjs     # http://127.0.0.1:8799
   # API on another port (8787 taken by another session):
   #   cd apps/api && pnpm exec wrangler dev --port 8797
   #   FAKE_PROVIDER_API_BASE=http://127.0.0.1:8797 node scripts/dev/fake-payment-provider.mjs
   ```

3. Create a market checkout and `POST /api/v1/market-checkouts/:id/pay` with
   `{"method":"market_online","country":"TW","currency":"TWD"}` from the
   customer app, or with curl sending `Origin: http://localhost:3000` (an
   origin in `CORS_ORIGIN`) and the `x-guest-token` returned at creation. The
   response is `pending` with a `redirect` next action pointing at the fake
   provider, which logs `amountCents`, `amountMinor` and `currencyExponent`.

4. Open (or curl) the redirect URL to "confirm" the payment; the fake provider
   posts a signed webhook and prints the API's answer:

   ```bash
   curl "http://127.0.0.1:8799/confirm/<checkoutId>"                  # Stripe payment_intent.succeeded, correct amount
   curl "http://127.0.0.1:8799/confirm/<checkoutId>?amount=19900"     # underpaid -> reviewRequired AMOUNT_MISMATCH
   curl "http://127.0.0.1:8799/confirm/<checkoutId>?currency=USD"     # wrong currency -> reviewRequired CURRENCY_MISMATCH
   curl "http://127.0.0.1:8799/confirm/<checkoutId>?style=linepay"    # LINE Pay confirm result in whole TWD
   curl "http://127.0.0.1:8799/topups/confirm/<intentId>?amountCents=1" # underpaid top-up -> not credited
   ```

5. Reconcile and refund as a platform admin (role 0): log in with
   `POST /api/v1/auth/login`, then send `Authorization: Bearer <token>`, the
   returned `X-CSRF-Token` both as `x-csrf-token` and as the
   `__Host-mm_csrf` cookie, and `Origin: http://localhost:3000` to
   `POST /api/v1/market-checkouts/admin/:id/reconcile` and
   `POST /api/v1/market-checkouts/:id/refund`.

6. Inspect what was stored:

   ```bash
   cd apps/api && pnpm exec wrangler d1 execute makanmakan-local --local \
     --persist-to ../../.wrangler/shared-state --command \
     "SELECT status, currency, amount_cents, paid_amount_cents, refunded_amount_cents FROM market_checkout_payments"
   ```

   Held events show up in `payment_audit_log` with `event_type = 'failure'`.

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

## Per-Shop E-Wallets (Touch 'n Go eWallet, GrabPay)

Everything above describes **one platform adapter** settling on the platform's
behalf. A Malaysian shop can instead connect **its own** Touch 'n Go eWallet or
GrabPay merchant account, so the customer pays that shop directly and the
platform never holds the money. The settlement machinery is shared — a shop
wallet is a provider-split gateway like any other — and only the credential
resolution and the gateway call differ.

### Where The Credentials Live

`shop_payment_credentials` (migration
`packages/database/migrations_fresh/0026_shop_payment_credentials.sql`,
Drizzle schema `packages/database/src/schema/shop-payment-credentials.ts`).
One row per `(restaurant_id, provider)`, `STRICT`, `ON DELETE CASCADE` from
`restaurants` plus a guard trigger.

| column | holds | secret? |
| --- | --- | --- |
| `provider` | `tng` \| `grabpay` (no CHECK — see the migration comment) | no |
| `status` | `connected` \| `disabled` (CHECK) | no |
| `merchant_id` | the provider's public id for the shop's account | no |
| `display_name`, `environment` | owner-facing label; `sandbox` \| `production` (CHECK) | no |
| `config` | non-secret JSON flags (`note`, `returnUrl`) | no |
| `secret_payload_encrypted` | merchant key, client secret, webhook secret | **yes** |
| `secret_updated_at_ms`, `connected_at_ms`, `disabled_at_ms`, `updated_by` | audit trail | no |

Secrets are AES-256-GCM via `@makanmasak/utils`, under their own domain salt
(`SHOP_PAYMENT_CREDENTIALS_ENCRYPTION_SALT` in
`apps/api/src/shared/utils/encryption.ts`) so a bug in the delivery-integration
path cannot decrypt them. `merchant_id` is plaintext on purpose, for the same
reason `platform_integrations.store_id` is (#338): a callback has to resolve
the account before anything has authenticated it.

**Nothing decrypts on a read path.** `ShopPaymentCredentialService` returns a
`ShopPaymentCredentialView` — `merchantIdMasked`, `secretConfigured`,
`secretUpdatedAtMs` — and never a secret or the full merchant id. The single
door out is `loadGatewayCredentials`, used only by the adapter, and it refuses a
`disabled` row.

### Owner API

`/api/v1/shop-payments/:restaurantId` — platform admin (role 0) and shop owner
(role 1) only, and an owner may only name their own restaurant (403 otherwise).

- `GET /:restaurantId` — every connection, plus `supportedProviders`.
- `GET /:restaurantId/:provider`
- `POST /:restaurantId/:provider/connect` — connect or rotate. `secret` is
  write-only and at least one field is required.
- `PUT /:restaurantId/:provider` — non-secret edits, rotation, enable/disable.
  Omitting `secret` keeps the stored one; supplying it **replaces** the whole
  payload rather than merging.
- `DELETE /:restaurantId/:provider` — disconnect, dropping the ciphertext.

Connecting is refused with `SHOP_PAYMENT_PROVIDER_CURRENCY_UNSUPPORTED` (400)
when the restaurant's currency is not one the wallet settles. The currency comes
from `resolveRestaurantCurrency`, never from the request.

### The Adapter Seam

`apps/api/src/features/shop-payments/services/ShopWalletGateway.ts`.
`ShopWalletPaymentAdapter` owns every money decision; the provider call itself
is one injected function:

```ts
export type ShopWalletGateway = (
  request: ShopWalletGatewayRequest,
) => Promise<ShopWalletGatewayResponse>;
```

`charge` / `refund` / `status` each build the request (converting
`amountCents` → `providerAmount` through `PROVIDER_AMOUNT_FACTORS`, plus
`amountMinor` and `currencyExponent`), call the gateway once, convert the
answer back with `providerAmountToCents`, and compare with
`verifyProviderMoney` — exactly (`charge`, `status`) or at-most (`refund`).
A mismatch is `SHOP_WALLET_AMOUNT_MISMATCH` / `SHOP_WALLET_CURRENCY_MISMATCH`
(502) and never reaches a `paid` write.

With no gateway wired up, `notImplementedShopWalletGateway` throws
`SHOP_WALLET_GATEWAY_NOT_IMPLEMENTED` (501) naming the provider's docs. That is
the state today: **there is no real Touch 'n Go or GrabPay HTTP call in this
repository**, deliberately, because no sandbox credentials exist to verify one
against.

**A real integration still has to supply, per provider and per `environment`:**

1. **Endpoint and authentication.** Credentials arrive decrypted in
   `request.credentials`; they must not be logged, echoed into an error, or
   attached to a trace.
2. **Webhook signature verification.** `credentials.webhookSecret` is the
   *shop's* callback secret, so verification is per-shop: resolve the credential
   from the merchant id in the callback, then verify, then trust the body.
3. **A confirmed amount unit.** See the warning below.
4. **Idempotency.** `request.idempotencyKey` is stable per operation.

### Money Units — UNVERIFIED

`PROVIDER_AMOUNT_FACTORS` records both wallets as **sen-based for MYR**
(factor 1 against internal cents, since MYR is ISO exponent 2). That row is an
assumption:

| gateway | MYR | TWD / VND | source |
| --- | --- | --- | --- |
| Touch 'n Go `amount` | `amountMinor` (sen) — **UNVERIFIED** | not supported | no open merchant reference; onboarding at <https://www.touchngo.com.my/merchant/>, and the only public TNG Digital developer site, <https://miniprogram.tngdigital.com.my/docs/>, documents the in-wallet Mini Program runtime |
| GrabPay `amount` | `amountMinor` (sen) — **UNVERIFIED** | not supported | <https://developer.grab.com/docs/grabpay/> needs partner credentials to read past the overview |

Every reachable third-party integration of both wallets (Stripe, Adyen, 2C2P,
Nuvei, Checkout.com) takes MYR in the smallest unit — Stripe states the rule
generally at <https://docs.stripe.com/currencies>. That is corroboration from
resellers, not either provider's own contract. **Re-derive both factors from
the sandbox contract you are issued before the first real charge.** A wrong
factor is a 100× error and `verifyProviderMoney` cannot catch it: it compares
our own converted number against itself.

### Market Checkout Wiring

`createMarketCheckoutPaymentProvider` gains one branch, keyed on the payment
`method`: `shop_wallet:tng` / `shop_wallet:grabpay` returns the existing
`ProviderSplitMarketCheckoutPaymentProvider` wrapped around a
`ShopWalletMarketCheckoutGateway`. Refunds dispatch on the stored
`payment.provider` through `refundShopWalletMarketCheckoutPayment`, so a
shop-wallet charge is refunded from the shop's own account rather than the
platform adapter.

**One merchant account per charge.** A market checkout is multi-vendor by
construction (`createMarketCheckoutSchema` requires at least two vendors) and a
wallet charge settles into exactly one merchant account. Every vendor in the
cart must therefore have connected the *same* account — one operator running
several stalls, the ordinary night-market case. A cart whose stalls resolve to
different merchant accounts would need two authorizations and two customer
redirects against one payment row, which this contract cannot express, so it is
refused with `SHOP_WALLET_MULTI_MERCHANT_UNSUPPORTED` (409) rather than settled
into whichever account came first. A genuinely mixed-merchant cart needs the
platform adapter.

### Local End-To-End Run

`SHOP_WALLET_GATEWAY_URL` points the seam at an out-of-process adapter, which
is how the local fake provider and the integration tests drive it. The request
posted there is the built `ShopWalletGatewayRequest` **with `credentials`
stripped** — an adapter running elsewhere gets the merchant id and must hold
its own keys.

```bash
# apps/api/.dev.vars
SHOP_WALLET_GATEWAY_URL="http://127.0.0.1:8799/wallet"
SHOP_WALLET_GATEWAY_TOKEN="fake-wallet-token"
MARKET_CHECKOUT_WEBHOOK_SECRET="fake-market-webhook-secret"
ENCRYPTION_KEY="a-local-encryption-key-at-least-32-chars"
```

1. `pnpm dev:api`, and start the fake provider with
   `node scripts/dev/fake-payment-provider.mjs`.
2. As the shop owner, connect a wallet:
   `POST /api/v1/shop-payments/<restaurantId>/tng/connect` with
   `{"merchantId":"TNG-MERCHANT-7788","environment":"sandbox","secret":{"merchantKey":"local-key"}}`.
   The response must contain `merchantIdMasked` and no secret.
3. Connect the **second** stall to the same `merchantId` — a market checkout
   needs at least two vendors, and they must share one merchant account.
4. Create an **MYR** market checkout across both stalls, then
   `POST /api/v1/market-checkouts/<id>/pay` with
   `{"method":"shop_wallet:tng","country":"MY","currency":"MYR"}`. The wallet
   request should carry `providerAmount`, `amountMinor`, `currencyExponent: 2`
   and no `credentials` key.
5. Confirm with the generic style:
   `curl "http://127.0.0.1:8799/confirm/<checkoutId>?style=generic"`, which
   posts a signed `market_checkout.payment_paid` event. Try
   `&amount=<cents-1>` first — it must be held for review, not paid.
6. Refund as platform admin:
   `POST /api/v1/market-checkouts/<id>/refund`. The refund request must reach
   the same merchant account.
7. Inspect:
   `pnpm wrangler d1 execute makanmakan-local --local --persist-to ./.wrangler/shared-state --config=./apps/api/wrangler.toml --command "SELECT provider, status, merchant_id, length(secret_payload_encrypted) FROM shop_payment_credentials"`.

### Acceptance Gates

```bash
pnpm exec vitest run --root apps/api --config vitest.config.ts src/features/shop-payments
pnpm exec vitest run --root apps/admin-dashboard --config vitest.config.ts src/components/settings/ShopWalletSettings.test.ts
cd apps/api && pnpm exec vitest run --config vitest.real-integration.config.ts shop-wallet-market-checkout
```

Enabling a shop wallet for real traffic is allowed only when:

- A real `ShopWalletGateway` exists for that provider, and the not-implemented
  default is no longer reachable for it.
- The amount unit is confirmed against the provider's own sandbox contract and
  `PROVIDER_AMOUNT_FACTORS` matches it.
- Per-shop webhook signature verification is in place and rejects an unsigned
  or mis-signed callback.
- `ENCRYPTION_KEY` is set in the target environment — `encryptionSettings`
  refuses a weak key in production, so a missing one fails the connect rather
  than storing a guessable ciphertext.
