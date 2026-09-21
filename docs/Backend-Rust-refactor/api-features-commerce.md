# `apps/api` Commerce Feature Modules — Reference for Rust Rewrite

Covers 8 feature modules under `apps/api/src/features/*`:
`market-checkouts`, `markets`, `credits`, `coupons`, `payments`, `billing`,
`subscriptions`, `service-bookings`. All paths are repo-relative to
`/Users/eric/Documents/Code/Makan-makan`. Line numbers cited as `path:L`
are a snapshot at review time and may drift.

## 0. Mount prefixes (from `apps/api/src/app-factory.ts`)

All routes below are relative to `/api/v1` unless noted. Source: `apps/api/src/app-factory.ts`.

| Feature export | Mounted at | Auth wiring at mount |
| --- | --- | --- |
| `marketCheckoutsFeature.routes` | `/market-checkouts` | Mounted in the **public** block (before the `hasConcreteApiRoute` 404 guard and before the protected-routes auth block). No blanket `authMiddleware`. Individual routes apply `authMiddleware` + `requireRole([0])` themselves (refund, all `/admin/*`). |
| `creditsFeature.routes` | `/credits` | Same public-block mount. Admin routes apply `authMiddleware` + `requireRole([0])` per-route. |
| `couponsFeature.routes` | `/coupons` | Mounted in the **public** block (`app-factory.ts:546` — before the `hasConcreteApiRoute` 404 guard at :557-569 and before CSRF registration at :627-649, same tier as market-checkouts/credits) with no blanket middleware; `/validate` and `/available/:restaurantId` are public by omission, all other routes apply `authMiddleware` + `moduleGate("coupons")` + `requireRole(...)` per-route. CSRF is excluded for `/api/v1/coupons/validate` only. |
| `paymentsFeature.routes` | `/payments` | `apiV1.use("/payments/*", authMiddleware)` + `apiV1.use("/payments/*", moduleGate("online_ordering"))` applied at mount. CSRF excluded for all of `/api/v1/payments` (comment: "protected by auth + idempotency"). |
| `billingFeature.routes` | `/billing` | **No** blanket auth at mount — the module only exposes the public HMAC-verified webhook route. CSRF excluded for `/api/v1/billing/webhooks`. |
| `subscriptionsFeature.routes` | `/admin/subscriptions` | Mounted after `apiV1.use("/admin/*", authMiddleware)`; the router itself additionally does `router.use("*", authMiddleware, requireRole([0]))` (redundant double gate — harmless). |
| `serviceBookingsFeature` (default export = routes, no `.routes` wrapper) | `/service-bookings` | Public-block mount (same tier as market-checkouts/credits). Public routes declared first; `app.use("/*", authMiddleware)` is applied **inside the router** partway through the file, before the staff/admin routes. |
| `marketsFeature.routes` | `/markets` | No blanket auth — fully public directory endpoints. |
| `marketsFeature.adminRoutes` | `/admin/markets` | Mounted after `apiV1.use("/admin/*", authMiddleware)`; router also does its own `routes.use("*", requireRole([0]))`. |
| `marketsFeature.seoRoutes` | `/` (**root**, not under `/api/v1`) | `app.route("/", marketsFeature.seoRoutes)` — public, GET-only (`/sitemap.xml`, `/robots.txt`). |

Global middleware that touches these modules regardless of mount tier (app-factory.ts):
- `geoIntelligentRateLimitMiddleware` has a custom limit specifically for `/api/v1/payments` (10 req/60s, burst 1.0, 300s block).
- `smartCacheMiddleware.shouldCache` explicitly skips `path.includes('/payments/')`.
- `usageTracker` middleware (`apiV1.use("*", usageTracker)`) runs on every request after the auth-block wiring, before CSRF.

---

## 1. `market-checkouts` — 市場多攤位訪客結帳

### 1.1 Purpose

Lets an anonymous guest at a physical market (a directory of independently
operated vendor stalls, see §2) build one checkout across **multiple vendor
restaurants at once**: it fans out to `OrdersService.createOrder` once per
vendor to create N real (guest) child orders sharing one `checkoutId`, then
pays them either as N separate child payment-service calls or as a single
aggregated "provider split" charge, optionally net of a platform/vendor-funded
voucher (卷) discount split proportionally across vendors. It also owns
webhook-driven reconciliation, provider-split refunds, and an admin
settlement/accounting export surface (per-vendor payable, platform fee,
CSV exports for ops/accounting).

### 1.2 Routes

All paths relative to `/api/v1/market-checkouts`. Source: `apps/api/src/features/market-checkouts/routes/index.ts`.

| Method | Path | Auth | Purpose | Request summary | Response summary |
| --- | --- | --- | --- | --- | --- |
| POST | `/payment-webhooks/:provider` | public, HMAC-verified in service | Provider payment webhook (stripe/linepay/generic) | raw JSON body + provider headers | `{provider, eventId, eventType, duplicate, reconciled, checkoutId?, paymentId?, status?}` |
| POST | `/` | public | Create a multi-vendor guest checkout | `{marketSlug, guestName, phoneLastDigits, vendors:[{restaurantId, items:[...], notes?, clientMutationId?}], notes?}` (Zod `createMarketCheckoutSchema`) | 201 `{checkout, childOrders}` — `childOrders[i]` includes a per-vendor `guestToken` |
| POST | `/:id/voucher` | public | Apply a 卷 code to an unpaid checkout | `{code}` | `{checkout, voucher, vouchers, subtotalCents, discountCents, payableCents}` |
| DELETE | `/:id/voucher` | public | Remove all applied vouchers from an unpaid checkout | — | `{checkout}` |
| POST | `/:id/pay` | public | Pay a checkout (full amount, one provider call) | `{method, country?, currency?, customerInfo?, providerInput?}` + `Idempotency-Key` header (used as provider idempotency, not the generic `idempotencyMiddleware`) | 200 if `paid`/already-paid, 202 if `pending`/`failed` — `{checkout, payment}` |
| POST | `/:id/guest-token` | public, rate-limited (10/15min per IP + 5-attempt lockout per checkout) | Recover a child order's guest token via last-3-digits phone verification | `{orderId, phoneLastDigits}` | `{orderId, restaurantId, guestToken, tokenExpiresAt}` |
| POST | `/:id/refund` | `authMiddleware` + `requireRole([0])` | Refund a paid/partially-paid checkout | `{reason?}` | `{checkout, payment, refunds:[...]}` |
| GET | `/admin/summary` | `authMiddleware` + `requireRole([0])` | Aggregate stats (counts, totals) with market/status/date filters | query: `marketSlug, paymentStatus, dateFrom, dateTo` | admin summary object |
| GET | `/admin` | `authMiddleware` + `requireRole([0])` | Paginated checkout list with operation-alert filter | query: `page, limit, marketSlug, paymentStatus, operationAlert, status, dateFrom, dateTo` | `{checkouts, total, page, limit}` |
| GET | `/admin/export` | `authMiddleware` + `requireRole([0])` | CSV export of checkout list | same filters as `/admin` | `text/csv` |
| GET | `/admin/vendors` | `authMiddleware` + `requireRole([0])` | Per-vendor settlement rollup | query: `marketSlug, paymentStatus, dateFrom, dateTo` | `{vendors:[...]}` |
| GET | `/admin/vendors/export` | `authMiddleware` + `requireRole([0])` | CSV of vendor settlement rollup | same | `text/csv` |
| GET | `/admin/accounting/export` | `authMiddleware` + `requireRole([0])` | Double-entry accounting CSV (debit/credit rows) | same | `text/csv` |
| GET | `/admin/provider-status` | `authMiddleware` + `requireRole([0])` | Provider-split config/readiness introspection | — | `MarketCheckoutPaymentProviderStatus` |
| POST | `/admin/provider-status/check` | `authMiddleware` + `requireRole([0])` | Live connectivity check against configured provider health URL | — | connectivity check result |
| POST | `/admin/:id/reconcile` | `authMiddleware` + `requireRole([0])` | Manually trigger provider status reconciliation for one checkout | — | `{reconciliation}` |
| GET | `/admin/:id` | `authMiddleware` + `requireRole([0])` | Admin view of one checkout (DB-hydrated, includes parent payment) | — | `{checkout}` |
| GET | `/:id` | public | Public view of one checkout (KV-first, DB fallback) | — | `{checkout}` |

### 1.3 Business logic

**Create (`POST /`)** — `apps/api/src/features/market-checkouts/routes/index.ts:295-541`
1. Validate body against `createMarketCheckoutSchema`; look up the active market by slug.
2. Reject duplicate `restaurantId` in `vendors`.
3. Per-restaurant idempotent guest-active-order guard: KV key `guest_active:{restaurantId}:{phoneLastDigits|anon:ip}` — if any vendor already has an active guest order for this identifier, reject with `MARKET_VENDOR_ACTIVE_ORDER_EXISTS` (409). This is a KV read, not transactional — a race between two concurrent checkouts for the same phone can both pass this check.
4. `enforceQuota(c, "orders.created", {restaurantId})` per vendor (billing quota gate, §7 cross-module).
5. Per vendor: verify the restaurant is an **active market member** (`restaurant_market_memberships` row with `leftAt IS NULL`), active/available, and has `settings.allowGuestOrders === true` (a JSON flag on `restaurants.settings`), else 400/403.
6. Per vendor: verify every requested `menuItemId` exists, belongs to that restaurant, and `isAvailable = true`, else 409 `MENU_ITEM_UNAVAILABLE`.
7. For each vendor **sequentially** (not batched): call `OrdersService.createOrder(...)` with `orderSource: "market_checkout"`, `isGuestOrder: true`, notes embedding `市場結帳：{marketName}/{marketSlug}/{checkoutId}`. Then mint a guest token (`generateGuestToken()`), write 3 KV entries per vendor (`guest_token:{token}` TTL 4h, `guest_active:{restaurantId}:{identifier}` TTL 2h, `guest_active_lookup:{orderId}` TTL 2h), and `meterEmit(c, "orders.created", ...)`.
8. Compute `subtotal` = sum of child order totals (cents). Build the `MarketCheckoutSession` object, write it to KV (`market_checkout:{id}`, TTL 4h — the **primary read path** during the checkout's active life) and persist it to D1 (`persistMarketCheckoutSession`, §1.4) and to a KV index (`upsertMarketCheckoutIndex`, capped at 200 entries, TTL 4h, used as the admin-list fallback when D1 has none).
9. **No rollback on partial vendor failure**: if `createOrder` throws for vendor 3 of 5, orders for vendors 1-2 remain created with no compensating cancellation — the route lets the error propagate and the whole request fails, but earlier child orders are not cleaned up. Document this as a known gap when reproducing in Rust unless product wants it fixed.

**Apply voucher (`POST /:id/voucher`)** — lines 549-654
1. Load session from KV first, D1 fallback. Reject if already paid.
2. Reject if the code is already in the applied-voucher set (stacking of *different* codes is allowed; the same code twice is not).
3. Compute each child order's remaining (post-existing-discount) amount, sum to `subtotalCents`.
4. `MarketCheckoutVoucherService.validateAndPrice` — validates the coupon (existence, active/visible, date window, usage-limit-not-exhausted, min-order, restaurant scope) and computes a discount (§1.3 voucher pricing below), throwing typed `VOUCHER_*` errors.
5. `reserveUsage` — **claims a usage slot immediately** on apply (not deferred to payment) via the atomic `claimUsageSlot` guarded UPDATE (`coupons.used_count`). This reserves capacity against the coupon's global `usage_limit` the instant a voucher is applied, before payment succeeds — released on voucher removal, checkout-pay failure, or explicit deletion.
6. Combine with any existing vouchers into `AppliedMarketCheckoutVoucher` (single voucher or `AppliedVoucherBundle` for 2+ stacked codes), persist to KV + D1 (`updatePersistedMarketCheckoutVoucher`). On persistence failure, the just-reserved slot is released (compensating action) before rethrowing.

**Voucher pricing** (`MarketCheckoutVoucherService`, pure static methods, unit-testable):
- `computeDiscountCents`: percentage discounts round to nearest cent then clamp to `maxDiscountAmountCents`; fixed discounts use `discountValueCents` directly. Both clamp to `[0, subtotalCents]`.
- `splitDiscount`: proportional split across child orders by `amountCents` share, using `Math.floor` per child then handing the rounding remainder to the largest child order (deterministic tie-break: smaller `orderId` wins ties) — so allocations always sum exactly to the total discount, no float drift.
- Platform-wide coupons (`coupons.restaurant_id IS NULL`) apply to all child orders; restaurant-scoped coupons apply only to that vendor's child order(s) and 400 if none match (`VOUCHER_NOT_APPLICABLE`).
- `fundedBy` is derived from `restaurantId == null ? "platform" : "vendor"` — this drives accounting attribution (§1.6 CSV: platform-funded = `discounts_contra_revenue` 5000; vendor-funded reduces the vendor's `settlementBaseCents` directly, i.e. the vendor absorbs its own coupon's discount before the platform fee is computed).

**Pay (`POST /:id/pay`)** — lines 694-976
1. Load session (KV-first). If already `paid`, return the existing payment idempotently (200). If no child orders, 400.
2. Select provider: `method === "credits"` forces `provider_split` mode via `CreditBalanceMarketCheckoutPaymentProvider`; otherwise mode follows `env.MARKET_CHECKOUT_SPLIT_MODE` (`"provider_split"` → HTTP gateway adapter, else `"child_transactions"` → N separate internal `PaymentService.processPayment` calls, one per child order).
3. If vouchers are applied but not yet in `reserved` state (edge case — normally already reserved from step §1.3-5), (re-)reserve them here before charging, persisting the reservation to KV+D1; on provider failure, release the reservation.
4. Compute `payableChildOrders`: each child order's total minus its voucher-allocation discount (floor at 0), i.e. the provider is charged the **net** (post-discount) amount per vendor — vouchers reduce the actual charge, they are not refunded separately later.
5. Call `paymentProvider.process(...)`. On thrown error: release voucher reservations, build a `failed` payment summary (all child orders marked `failed`), persist, return 202 (soft failure — checkout is *not* deleted, caller can retry `/pay`).
6. On success: derive aggregate `paymentStatus` — `"paid"` only if every child order's payment status is `"paid"`; `"partial_paid"` if some but not all paid; `"failed"` if the provider itself reports non-pending failure and none paid; `"pending"` if the provider's own aggregate status is `pending` (async provider-split flow awaiting webhook/redirect). Persist `MarketCheckoutPaymentSummary` (with nested `parentPayment` — the aggregate provider-split record — and `settlement`, the per-vendor platform-fee breakdown, §1.3 settlement below) to KV, D1 `market_checkout_sessions`, and upsert `market_checkout_payments` (the parent payment row, keyed by `payment_id`, `ON CONFLICT DO UPDATE`).
7. **Voucher redemption only on verified full payment** (`payment.status === "paid"`): calls `voucherService.redeem(voucher)` for each applied voucher, which is a **best-effort, audit-only** step — failures are caught and logged, never surfaced to the caller or rolled back into the payment response. If payment ends up `failed` here, release the (already-reserved) voucher usage slots and persist the released state.

**Settlement computation** (`buildMarketCheckoutSettlement`, lines 1918-1991) — for each child order: `grossAmountCents` = the child payment's charged amount if `paid`/`refunded` else 0; `settlementBaseCents` (only when `paid`) = `originalAmountCents - vendorDiscountCents` (vendor-funded voucher reduces the vendor's own settlement base, **before** the platform fee); `platformFeeCents = round(settlementBaseCents * platformFeeRateBps / 10000)`; `netAmountCents = settlementBaseCents - platformFeeCents`. Platform-funded voucher discounts do **not** reduce `settlementBaseCents` (the platform absorbs that discount out of its own fee/revenue, tracked separately as `platformDiscountCents`).

**Refund (`POST /:id/refund`)**, role 0 only — lines 1090-1392. Two paths:
- **`provider_split`**: refunds the aggregate parent payment. Provider is `credit_balance` → `refundCreditMarketCheckoutPayment` (delegates to `CreditService.refundByOriginalSpend`, §3); otherwise → `refundMarketCheckoutProviderSplitPayment` (HTTP call to `MARKET_CHECKOUT_PROVIDER_REFUND_URL`). Refunds **all** paid child orders in one call (no partial-child refund support in this mode) — `amountCents` = sum of all paid child payment amounts. On `refunded`/`partial_refunded` result, all previously-paid child payments flip to `refunded` and `markMarketCheckoutVoucherRefunded` marks the voucher's `coupon_usage` rows `refunded` (§1.4).
- **`child_transactions`**: refunds each `paid` child payment individually via `refundPaymentTransaction` (§5, payments module) in a loop (not batched/parallel — sequential `await` per child). Aggregate status becomes `refunded` only when zero child payments remain `paid`, else `partial_refunded`.

**Reconciliation** (`MarketCheckoutPaymentReconciliationService`) — only supports `provider_split` payments; throws 400 for `child_transactions` mode. `listPendingStatusLookupInputs` selects `market_checkout_payments` rows that are either `status = 'pending'` or have a pending refund recorded in the JSON `provider_payload.lastRefund.status`, joined to sessions, filtered by `updated_at < updatedBeforeMs`. Driven by the `*/5 * * * *` cron (§7). `reconcile()` updates `paid_amount_cents`/`refunded_amount_cents` from the provider's authoritative status, merges a `lastReconciliation` entry into the JSON `provider_payload`, and re-triggers voucher redemption if the reconciled status is `paid`.

**Webhook handling** (`MarketCheckoutPaymentWebhookService`) — verifies HMAC per provider (stripe: `stripe-signature` header, `t=...,v1=...` format, HMAC-SHA256 hex over `${timestamp}.${body}`, **constant-time compare**; linepay: `x-linepay-nonce`/`x-linepay-signature`, HMAC-SHA256 **base64** over `${secret}${body}${nonce}`, constant-time compare; generic: `x-webhook-signature` header, HMAC-SHA256 hex over the raw body). Records every event into `payment_audit_log` via `PaymentAuditService.append`, which is itself the **idempotency gate**: the partial unique index `(provider, provider_event_id) WHERE provider_event_id IS NOT NULL` on `payment_audit_log` makes a re-delivered webhook a no-op insert (`inserted: false` short-circuits before any state mutation — return `{duplicate: true}`).

### 1.4 Data

- **D1 tables** (packages/database/src/schema/markets.ts): `market_checkout_sessions` (one row per checkout; `payment_summary` and `applied_voucher` are JSON blobs holding the *entire* current state — this is the durable mirror of the KV session object, not a normalized ledger), `market_checkout_child_orders` (unique `(checkout_id, order_id)`), `market_checkout_payments` (the parent/aggregate payment row for `provider_split` mode — **partial unique index on `idempotency_key` WHERE NOT NULL**).
- **Cross-referenced tables**: `coupons`, `coupon_usage` (voucher redemption — see §4 coupons module for the `used_count` claim/release and the `(coupon_id, order_id)` partial-unique active-usage index), `orders`/`order_items` (via `OrdersService`), `payment_transactions`/`refund_transactions` (`child_transactions` mode, via `PaymentService`/`refundPaymentTransaction`), `credit_accounts`/`credit_ledger_entries` (credits payment method, via `CreditService`).
- **KV** (`CACHE_KV`): `market_checkout:{id}` (session, TTL 4h — primary hot-path read/write), `market_checkout:index` (bounded list of up to 200 summaries, TTL 4h, admin-list fallback when D1 empty), `guest_token:{token}` (TTL 4h), `guest_active:{restaurantId}:{identifier}` (TTL 2h), `guest_active_lookup:{orderId}` (TTL 2h), `market_checkout_recover_attempts:{checkoutId}` (TTL 1h, brute-force counter for guest-token recovery).
- **No queue usage** in this module. No Durable Object usage.
- **Events published**: none formal (no pub/sub) — state changes are polled via KV/D1 reads; the only "event"-shaped surface is the incoming webhook and the outgoing HTTP calls to the configured provider-split gateway (`MARKET_CHECKOUT_PROVIDER_SPLIT_URL`, `..._STATUS_URL`, `..._REFUND_URL`, `..._SPLIT_HEALTH_URL`).

### 1.5 Cross-module dependencies

- `orders` feature (`OrdersService.createOrder`, `getOrder`) — every child order is a real row in `orders`.
- `payments` feature (`PaymentService.processPayment`, `refundPaymentTransaction`) — used for `child_transactions` split mode.
- `credits` feature (`CreditService.spend`, `refundByOriginalSpend`) — used for the `credits` payment method (always forced into `provider_split` mode with `provider: "credit_balance"`).
- `billing` feature (`PaymentAuditService`) — webhook dedup ledger.
- `markets` feature (schema only: `markets`, `restaurant_market_memberships`).
- `middleware/quotaGate` (`enforceQuota`) and `shared/utils/meter` (`meterEmit`) — billing usage-metering hooks on order creation (`orders.created` meter).
- `middleware/guestAuth` (`generateGuestToken`, `GuestTokenData`) — shared with the `guest-orders` feature's guest-session model.

### 1.6 Rust rewrite notes

- **Money**: 100% integer cents end-to-end in this module (`amountCents`, `totalAmountCents`, `discountCents`, `platformFeeCents`, `settlementBaseCents`). The only float-looking fields (`totalAmount`, `paidAmount`, `refundedAmount`) are legacy **display mirrors** derived from cents via `fromCents()` (`cents/100`) — never the source of truth. A Rust port should drop the float mirrors entirely and expose cents everywhere, converting to display units only at the API boundary if a client still needs it.
- **No cross-vendor transactional guarantee.** Vendor child-order creation (step 7 above) is a plain sequential loop of independent `OrdersService.createOrder` calls with no D1 transaction and no compensating saga on partial failure — this is the single biggest correctness gap to consciously carry forward or fix in Rust. D1 has no multi-statement cross-call transaction primitive available here anyway (each `createOrder` call is its own set of statements); a Rust rewrite targeting D1 would need an explicit saga/outbox pattern to get atomicity, since D1's `.batch()` only atomically groups statements known *up front* in one call, not a dynamic loop of service calls.
- **`db.batch()` is used** (via Drizzle `.batch()` and raw `env.DB.batch()`) for genuinely atomic multi-statement writes: `upsertMarketCheckoutParentPayment` uses a single parameterized `INSERT ... ON CONFLICT DO UPDATE` (one statement, not a batch) — atomic by construction. Session/child-order initial persist (`persistMarketCheckoutSession`) is two separate `db.insert()` calls (session, then child orders) with **no batch** — if the process crashes between them, a session row can exist with no child-order rows. Treat as an at-least-once/eventually-consistent write pattern, not a single transaction.
- **Idempotency layers, three distinct mechanisms** — do not conflate them in the Rust port: (1) the generic HTTP `Idempotency-Key` header replay-cache (`idempotency_keys` table, request-hash-scoped) is **not used** by this module (market-checkout `/pay` reads the header directly and forwards it as the *provider* idempotency key, it does not go through `middleware/idempotency.ts`); (2) `market_checkout_payments.idempotency_key` has its own partial unique index, enforced by `ON CONFLICT(payment_id) DO UPDATE` on the payment_id PK, not the idempotency key — so a provider retry with the same idempotency key but a *different* payment_id would not be caught by DB constraint, only by the provider gateway's own dedup; (3) `payment_audit_log`'s `(provider, provider_event_id)` partial unique index is the actual webhook-replay guard.
- **Voucher usage-slot claim is a separate atomic guarded UPDATE**, independent of the payment: `claimUsageSlot`/`releaseUsageSlot` (shared with the coupons module's base `CouponService`) do `UPDATE coupons SET used_count = used_count + 1 WHERE id=? AND (usage_limit IS NULL OR used_count < usage_limit)` and check `meta.changes` — this is the concurrency-safety primitive for coupon usage limits; port it as a single conditional UPDATE, not read-then-write.
- **JSON columns**: `market_checkout_sessions.payment_summary` and `.applied_voucher`, `market_checkout_payments.provider_payload` (holds `nextAction`/`lastWebhook`/`lastReconciliation`/`lastRefund` sub-objects, each independently parsed/validated by hand-rolled type guards e.g. `parseProviderPayloadNextAction`) are large denormalized JSON blobs re-serialized on every mutation. A Rust rewrite should decide whether to keep this denormalized-blob approach (simpler, matches current read patterns) or normalize into columns/child tables (safer, but is a schema migration).
- **Timestamps**: DB columns are `_ms` INTEGER (`created_at_ms` etc., matches repo convention); but in-flight `MarketCheckoutSession`/`Payment` objects use **ISO-8601 strings** (`new Date().toISOString()`) for `createdAt`/`paidAt`/`failedAt`/etc. — conversion happens at persist time (`toIsoString`, `parseTimestampMs`). A Rust port should pick one representation (recommend: keep `_ms` integers end-to-end, including in the KV-cached session JSON, to avoid the string↔ms round-trip entirely).

---

## 2. `markets` — 市場 (directory of independently-operated vendor stalls)

### 2.1 Purpose

A **market** (traditional wet market / night market / food court) is a
physical location with its own geo-boundary, opening hours, and a
`platform_fee_rate_bps` used downstream by `market-checkouts` settlement.
Restaurants join a market as **vendors** via `restaurant_market_memberships`
(soft join/leave, one active membership per restaurant per market). This
module is a **directory/CRUD + admin operations service** — it owns no money
movement itself (no payments, no ledger); its only "commerce" surface is the
`platformFeeRateBps` field it stores and the vendor-membership graph that
`market-checkouts` settlement reads. It also runs a market "readiness" scoring
system (public-facing quality gates) and bulk vendor/market import tooling for
platform ops.

### 2.2 Routes

Public routes at `/api/v1/markets` (`apps/api/src/features/markets/routes/index.ts`), admin routes at `/api/v1/admin/markets` (`.../routes/admin.ts`, all `requireRole([0])` via `routes.use("*", requireRole([0]))` — mount already applies `authMiddleware`), SEO routes at root (`.../routes/seo.ts`).

| Method | Path | Auth | Purpose | Request summary | Response summary |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | public | List markets (public-ready only, filterable) | query: `q, city, district, type, page, limit` | `{markets:[...]}` (paginated) |
| GET | `/nearby` | public | Geo radius search | query: `lat, lng, radiusKm, limit` | markets sorted by distance |
| GET | `/areas` | public | Distinct city/district list (public-ready markets only) | — | `{areas:[{city, districts:[...]}]}` |
| GET | `/:slug/vendors` | public | Vendor list for a market with filters | params: `slug`; query filters (open now, takeaway/delivery, search, geo, sort, paging) | vendor list or 404 |
| GET | `/:slug` | public | Market detail by slug | — | market object or 404 |
| — | | | | | |
| GET | `/admin/readiness` | admin (0) | Admin readiness list (top 100, includes vendor breakdown) | — | readiness list |
| GET | `/admin/area-readiness` | admin (0) | City/district readiness rollup | — | `{areas:[...]}` sorted by catalog-gap count desc |
| GET | `/admin/vendor-candidates` | admin (0) | Search restaurants eligible to become vendors | query filters | candidate list |
| GET | `/admin/join-requests` | admin (0) | List market join requests | query: `status` | request list |
| POST | `/admin/join-requests/:requestId/approve` | admin (0) | Approve a pending join request → creates/updates vendor membership | body: stall/location/hours/isPrimary | `{request, membership}` or 404/409 |
| POST | `/admin/join-requests/:requestId/reject` | admin (0) | Reject a pending join request | — | `{request}` or 404/409 |
| POST | `/admin/` | admin (0) | Create a market | market fields | 201 `{market}` |
| POST | `/admin/bulk` | admin (0) | Bulk-create markets (dry-run supported) | `{dryRun?, markets:[...]}` | dry-run preview or 201 created summary |
| PUT | `/admin/:id` | admin (0) | Update a market | partial market fields | `{market}` or 404 |
| DELETE | `/admin/:id` | admin (0) | Soft-delete a market | — | `{deleted: bool}` or 404 |
| POST | `/admin/:id/vendors` | admin (0) | Attach a vendor to a market | `{restaurantId, stallNumber?, ...}` | 201 `{membership}` or 409 already-attached / 404 |
| PUT | `/admin/:id/vendors/:restaurantId` | admin (0) | Update an existing vendor membership | stall/location/hours/isPrimary | `{membership}` or 404 |
| POST | `/admin/:id/vendor-imports` | admin (0) | Bulk vendor import (create-restaurant-if-missing + attach), dry-run supported | `{dryRun?, vendors:[...]}` | dry-run preview or created/attached summary |
| DELETE | `/admin/:id/vendors/:restaurantId` | admin (0) | Detach (soft-leave) a vendor | — | `{removed: bool}` |
| — | | | | | |
| GET | `/sitemap.xml` (root) | public | Sitemap of public-ready markets | — | `application/xml` |
| GET | `/robots.txt` (root) | public | robots.txt referencing the sitemap | — | `text/plain` |

### 2.3 Business logic

- **Public readiness gate** (`publicReadyConditions`, `MarketsService.ts:1959+`): a market only appears in public list/areas/sitemap queries if it has non-empty `description`/`city`/`district`/`address`, non-null lat/lng, and **at least one day** in `opening_hours` JSON with `closed != 1` and non-empty `open`/`close` strings (checked via a `json_each` SQL subquery). Admin readiness (`listAdminReadiness`) does not apply this filter and additionally returns a per-market `catalogCoverage`/`publicReadiness` score object (`evaluateMarketPublicReadiness`, `utils/publicReadiness.ts`) so ops can see *why* a market is or isn't public-ready.
- **Vendor membership is soft join/leave**: `restaurant_market_memberships` has a partial unique index `(restaurant_id, market_id) WHERE left_at IS NULL` — a restaurant can rejoin the same market after leaving (a new row), but cannot have two simultaneously-active memberships in the same market. `addVendor` upserts: if an active membership exists, it updates in place (preserving `joinedAt`); otherwise inserts a new row. `isPrimary` is exclusive per restaurant across all its active memberships (`clearPrimaryMembership` unsets any other primary flag first).
- **Join-request lifecycle**: `market_join_requests` has a partial unique index `(restaurant_id, market_id) WHERE status = 'pending'` — a restaurant cannot have two pending requests for the same market. `createJoinRequest` rejects if already an active member (`already_member`) or already has a pending request (`already_pending`). `approveJoinRequest` calls `addVendor` (idempotent) then flips the request to `approved`; `rejectJoinRequest` flips to `rejected`. Both are simple two-step (not batched) writes — a crash between `addVendor` and the request-status update leaves the membership created but the request still `pending` (retryable, not double-charged since `addVendor` is itself idempotent on the active-membership check).
- **Bulk market import** (`POST /admin/bulk`): a "preflight" pass (`preflightMarketBulkImport`) detects in-payload duplicate slugs and pre-existing slugs *before* any writes, producing per-row `issues` (all `severity: "blocking"`); only non-blocked rows are actually inserted via **`d1.batch()` of individual parameterized `INSERT` statements** (one per market) — this is the one place in this module using a real D1 batch for atomicity-adjacent bulk insert (still not a single transaction across the whole batch in the traditional multi-row-rollback sense, but D1 batch executes sequentially and Cloudflare's implementation treats a batch as an implicit transaction — see Rust notes).
- **Bulk vendor import** (`POST /admin/:id/vendor-imports`): per vendor row, either creates a brand-new `restaurants` row (defaulting missing `phone`→`00000000`, `city`→ the market's city, both flagged as `warning`-severity issues) or attaches an existing restaurant (blocking issues for not-found/inactive/already-attached/duplicate-in-payload). Live (non-dry-run) mode processes vendors **sequentially in a loop**, calling `RestaurantsService.createRestaurant` and `MarketsService.addVendor` per row with no batch/transaction — partial failure mid-loop leaves prior rows committed.
- **Geo**: `boundingBoxFromCircle`/`distanceKm`/`pointInGeoJsonBoundary` (`services/geo.ts`) support `/nearby` and open-now vendor filtering; `restaurantId` scan for open-now filtering is capped at `OPEN_NOW_VENDOR_SCAN_LIMIT = 50000` rows.
- **Cache invalidation**: all public list/detail reads go through a **version-tagged cache key** (`markets:v{version}:{scope}:{value}`, `CacheService` = `KVCacheService` when `CACHE_KV` is bound else a no-op). `bumpPublicCacheVersion()` is called after every create/update/delete/vendor-attach/vendor-remove — this invalidates the *entire* public cache namespace in one KV write (bump a counter) rather than deleting individual keys, so stale cache entries are simply never looked up again (they expire naturally via TTL, `CACHE_TTL.SHORT`).

### 2.4 Data

- **D1 tables**: `markets` (`platformFeeRateBps` integer bps, `boundary_geojson`/`opening_hours`/`map_layout`/`image_urls`/`tags` JSON columns), `restaurant_market_memberships` (partial unique `(restaurant_id, market_id) WHERE left_at IS NULL`), `market_join_requests` (partial unique `(restaurant_id, market_id) WHERE status='pending'`). Cross-referenced for catalog coverage: `menu_items`, `dish_search_index`, `restaurant_service_items`.
- **KV**: `markets:version` (cache-bust counter), `markets:v{n}:{scope}:{key}` (list/area query result cache, `CACHE_TTL.SHORT`).
- **No queue usage directly**, but `createSearchIndexSync(c.env)` (discovery feature) is invoked after every mutating admin action (`onMarketChanged`, `onMarketMembershipChanged`) — this feeds the discovery search-index queue pipeline (`SEARCH_SYNC_QUEUE`, documented in `api-core.md`).
- **Events published**: search-index sync triggers (`onMarketChanged`/`onMarketMembershipChanged`), no other pub/sub.

### 2.5 Cross-module dependencies

- `restaurants` feature (`RestaurantsService.createRestaurant`, `getRestaurant`) — vendor-import restaurant creation/lookup.
- `discovery` feature (`createSearchIndexSync`) — search index invalidation on market/vendor changes.
- `market-checkouts` feature reads `markets.platformFeeRateBps` and `restaurant_market_memberships` (schema-level dependency only, no service call).
- The **public** join-request creation endpoint lives in the `restaurants` feature, not here: `POST /api/v1/restaurants/:id/market-join-requests` (`apps/api/src/features/restaurants/routes/index.ts:488`) calls `MarketsService.createJoinRequest` — i.e. restaurant owners request to join through the `restaurants` router, while admins approve/reject through this module's admin router.

### 2.6 Rust rewrite notes

- **No money/ledger in this module** — `platformFeeRateBps` is a plain integer (basis points, 0-10000, clamped via `clampPlatformFeeRateBps` at the *consumer* — `market-checkouts` — not here) stored and returned as-is; no cents fields exist in this module's own tables.
- **Bulk-create markets uses `d1.batch()` of N individual `INSERT` statements** built with raw `.prepare()`/`.bind()` (not the Drizzle query builder) — a Rust port using a D1-equivalent should replicate the "preflight validation pass, then one batch of inserts" shape to keep the failure semantics (all successfully-preflighted rows land, or none do, depending on how the target DB implements batch atomicity — Cloudflare D1 documents `batch()` as running in an implicit transaction, so a mid-batch failure rolls back the whole batch; this differs from the *sequential loop of independent calls* pattern used elsewhere in this module for vendor import, which has no such guarantee).
- **Cache-version-bump invalidation pattern** (bump a KV integer counter to invalidate a whole cache namespace) is reused verbatim from a common idiom elsewhere in the codebase — worth extracting as a shared primitive in the Rust rewrite rather than reimplementing per-module.
- **Timestamps**: `_ms` INTEGER throughout (`created_at_ms`, `joined_at_ms`, `left_at_ms`, `requested_at_ms`, `resolved_at_ms`) — no string-timestamp legacy in this module's schema.
- **JSON columns**: `boundary_geojson`, `opening_hours`, `map_layout`, `image_urls`, `tags` on `markets`; `map_position`, `market_hours` on `restaurant_market_memberships`. All typed via Drizzle `$type<...>()` generics only — no runtime schema validation on read (a malformed JSON blob written outside this code path would silently type-lie until it crashes a consumer).

---

## 3. `credits` — 代幣 (stored-value credits)

### 3.1 Purpose

A platform-level (not per-restaurant) stored-value balance held by a
lightweight card/QR identity (`credit_cards.public_id`), spendable at any
vendor across any market that funds it (single-currency per card). This is
the money-safety-critical module in this set: it implements the
append-only, idempotent, PIN-gated ledger that both `market-checkouts` and
`service-bookings` call into as a payment method. Phase 1 top-ups are
cash/manual (admin-only); Phase 2 (present in code) supports online top-up
via a pending-intent + webhook-confirm flow mirroring the market-checkout
payment pattern.

### 3.2 Routes

All paths relative to `/api/v1/credits`. Source: `apps/api/src/features/credits/routes/index.ts`.

| Method | Path | Auth | Purpose | Request summary | Response summary |
| --- | --- | --- | --- | --- | --- |
| POST | `/cards` | `authMiddleware` + `requireRole([0])` | Issue a new stored-value card | `{currency, ownerCustomerId?, pin?, initialBalanceCents?}` (`idempotencyMiddleware({scope:"credit", requireKey:false})`) | 201 `{cardId, publicId, accountId, currency}` |
| POST | `/cards/:publicId/topup` | `authMiddleware` + `requireRole([0])` | Cash/manual top-up | `{amountCents, currency, fundingSource, reference?}` + **required** `Idempotency-Key` header (`idempotencyMiddleware({scope:"credit"})`, `requireKey` defaults true) | `{ledgerEntryId, accountId, balanceAfterCents}` |
| POST | `/cards/:publicId/topup/online` | public, rate-limited (10/60s) | Start a Phase-2 online top-up intent | `{amountCents, currency}` | 201 `{intentId, status, amountCents, currency, providerTransactionId, nextAction}` |
| POST | `/topup-webhooks/:provider` | public, HMAC-verified in service | Confirm an online top-up | raw body + `x-credit-topup-signature`/`-timestamp` headers | `{duplicate, credited, intentId?, status?, balanceAfterCents?}` |
| GET | `/cards/:publicId/balance` | public, rate-limited (30/60s) | Public balance lookup (no PII) | — | `{publicId, accountId, currency, balanceCents, status, cardStatus, expiresAtMs}` |
| POST | `/cards/:publicId/pin` | `authMiddleware` + `requireRole([0])`, rate-limited (10/60s) | Set/reset PIN | `{newPin}` | `{success:true}` |
| POST | `/cards/:publicId/freeze` | `authMiddleware` + `requireRole([0])` | Freeze/mark-lost/reactivate a card | `{status: "frozen"\|"lost"\|"active"}` | `{success:true}` |
| GET | `/cards/:publicId/ledger` | `authMiddleware` + `requireRole([0])` | Ledger history for a card's account | query: `limit, offset` | `{accountId, entries:[...]}` |
| GET | `/accounting/export` | `authMiddleware` + `requireRole([0])` | Credits-liability (account 2100) sub-ledger CSV | query: `from, to` (ms) | `text/csv` |

Note: the two `idempotencyMiddleware` uses here are the **generic HTTP replay-cache** layer (`middleware/idempotency.ts`, `idempotency_keys` table) — distinct from `CreditService`'s own ledger-level `idempotencyKey` uniqueness (see §3.6).

### 3.3 Business logic

**Ledger invariant** (`CreditService.ts:93-101` doc comment, verified by `findBalanceLedgerDrift`): `credit_accounts.balance_cents` must always equal `Σ credit_ledger_entries.amount_cents` for that account. Every balance-changing operation writes exactly one ledger row per idempotency key, and the opening balance at card issue is itself audited as an `adjust` entry — so there is never an unaudited balance change.

**Spend** (`spend`, lines 187-259) — the money-safety-critical path:
1. Idempotency replay check first: if `idempotencyKey` already has a ledger row, return its recorded result immediately (no re-deduction).
2. Load card+account; require `account.status === "active"`; require `account.currency === input.currency` (no cross-currency spend); reject a spend over the currency's per-transaction cap; `assertPinIfRequired` — PIN is required only when `amountCents` exceeds the card currency's configured threshold (defaults: TWD 200, MYR 50, VND 200,000 major units; overrides: `CREDIT_PIN_THRESHOLD_CENTS_TWD`, `_MYR`, and `_VND`); enforces `card.status === "active"`, a `lockedUntilMs` lockout (15 min after 5 failed PIN attempts, `bcrypt.compare` against `secretHash`, cost factor 10), and clears the retry counter on success.
3. **Atomic guarded deduction**: `UPDATE credit_accounts SET balance_cents = balance_cents - :amt, version = version + 1, expires_at_ms = :rolling_expiry WHERE id=:id AND currency=:cur AND status='active' AND balance_cents >= :amt`. If 0 rows changed → `409 INSUFFICIENT_BALANCE`. This single conditional UPDATE is simultaneously the overspend guard *and* the concurrency-safety mechanism — two concurrent spends against the same balance cannot both succeed if the sum would overdraw, because D1/SQLite serializes writes to the same row and the second UPDATE re-evaluates the guard against the already-decremented balance.
4. Append the ledger entry (`entryType: "spend"`, negative `amountCents`) via `appendLedgerOrCompensate` (§3.3 below) with `reverseAmountCents: input.amountCents` (i.e. if the ledger insert loses an idempotency race, compensate by crediting the amount back).

**`appendLedgerOrCompensate`** (lines 699-752) — the idempotency-vs-mutation race resolver used by `spend`/`topup`/`refund` alike: insert the ledger row with `.onConflictDoNothing({target: idempotencyKey})`. If the insert actually landed, return it. If it conflicted (a concurrent identical-key call already inserted first), the balance mutation this call *already made* is now a duplicate — reverse it via `applyDelta(accountId, reverseAmountCents)`, then look up and return the canonical (first-writer's) ledger entry. This means every balance mutation is applied optimistically *before* the idempotency check is finalized, and corrected after — a deliberate design choice documented in the source, not an oversight.

**Rolling expiry**: every `spend`/`topup`/`refund` extends `expires_at_ms` to `now + 365 days` (activity resets the clock). A daily cron (`0 4 * * *` → `workers/credit-expiry.ts`) zeroes balances whose `expires_at_ms` has lapsed with zero recent activity, writing an `expire` ledger entry (`amountCents = -balance`) guarded by an optimistic-lock `version` column (a concurrent spend/topup that races the expiry job wins via the `version` guard, since expiry's own UPDATE also checks `WHERE version = :expectedVersion`). Batches of up to 200 accounts, up to 50 batches per run (10,000 account cap per invocation), integrity-checks for drift after each run, and raises `AlertService` alerts for drift or incomplete/failed batches (never auto-repairs).

**Online top-up (Phase 2)**: `CreditTopupService.createIntent` creates a `pending` `credit_topup_intents` row (30-min TTL), asks the configured `CreditTopupGateway` (HTTP adapter with optional bearer token + HMAC request signing, or an "unconfigured" stub that always throws) to start a charge, and stores the returned `providerTransactionId` + client `nextAction` (redirect/client_secret). **The balance is never credited from `createIntent`** — only `confirmIntent` (called exclusively from the webhook handler, never directly reachable from a route) credits it, via `CreditService.topup` keyed by `credit-topup:{intentId}` — replay-safe by construction. `confirmIntent` resolves the intent by `intentId` **or** `providerTransactionId` but never an OR-query across both (to prevent a spoofed webhook resolving a different intent than the caller intended) — if both are supplied they must agree with the resolved row or 400.

### 3.4 Data

- **D1 tables** (`packages/database/src/schema/credits.ts`, `credit-topup-intents.ts`): `credit_accounts` (materialized `balance_cents` + `reserved_cents` (declared, unused by any read path in this module — likely reserved for a future hold/authorize flow) + optimistic-lock `version`; partial unique `(owner_customer_id, currency) WHERE owner_customer_id IS NOT NULL`), `credit_cards` (`public_id` globally unique — this is the QR-encoded value), `credit_ledger_entries` (append-only; **`idempotency_key` globally UNIQUE**, `source_type`/`source_id` free-text traceability, denormalized `market_checkout_payment_id` for cross-reference — not a hard FK since `market_checkout_payments.payment_id` isn't itself the join key structure), `credit_topup_intents` (`provider_transaction_id` indexed, not unique-constrained at the DB level).
- **No queue usage.** No Durable Object usage.
- **Cron**: `0 4 * * *` → `expireStaleCredits` (`apps/api/src/workers/credit-expiry.ts`).
- **Events published**: none formal; alerts via `AlertService.sendAlert` on drift/incomplete expiry runs (Slack, presumably — not traced further in this doc).

### 3.5 Cross-module dependencies

- `market-checkouts` (`CreditBalanceMarketCheckoutPaymentProvider`, `refundCreditMarketCheckoutPayment`) — the `credits` payment method for market checkouts.
- `service-bookings` (`payWithCredits`) — the 代幣 payment method for service bookings.
- No dependency the other direction — `credits` never imports from `market-checkouts`/`service-bookings`.

### 3.6 Rust rewrite notes

- **100% integer cents** in this module — `balanceCents`, `amountCents`, `balanceAfterCents` are all `INTEGER`; there is no float money representation anywhere in `CreditService`. This is the cleanest module in the set to port money-wise.
- **Concurrency/atomicity model is the reference pattern to replicate exactly**: single conditional `UPDATE ... WHERE balance_cents >= :amt` for spend (no read-modify-write), a separate optimistic-lock `version` column used *only* by the expiry job (not by spend/topup/refund, which rely on the balance-guard instead), and a UNIQUE `idempotency_key` on the ledger table as the source-of-truth dedup, with an explicit "apply-then-compensate-on-conflict" pattern (`appendLedgerOrCompensate`) rather than "check-then-apply". A Rust port on D1 (or any SQLite-compatible store without cross-statement transactions available per-call) **must** preserve this apply-then-compensate ordering — do not "improve" it into a naive check-then-insert, since D1 has no `SELECT ... FOR UPDATE` and the guarded-UPDATE-plus-compensation is what actually makes it safe under concurrent requests.
- **No `db.batch()` at all in this service** — every operation is a sequence of independent awaited statements (select card → select account → guarded update → insert ledger row, with an extra compensating update on conflict). Each individual statement is atomic; the *sequence* is not, and is deliberately designed so that partial completion is either harmless (idempotency key not yet claimed, retry is safe) or self-correcting (ledger conflict triggers compensation). A Rust rewrite should preserve "each statement individually atomic + idempotent to retry the *whole* multi-step operation from scratch" rather than trying to wrap it all into one transaction — the existing design already tolerates crash-at-any-point.
- **PIN hashing**: `bcryptjs`, cost factor 10 (matches repo-wide convention per code comment). A Rust port should use a bcrypt-compatible crate (`bcrypt` crate) with the same cost factor to keep hash compatibility if migrating live data, or plan a rehash-on-next-use migration if switching to argon2/similar.
- **Timestamps**: `_ms` INTEGER throughout, `expiresAtMs` recomputed (not incremented) on every activity — always `now + 365d`, not `existing + 365d`, so rolling expiry does not compound.
- **JSON columns**: `credit_topup_intents.provider_payload` only (raw webhook payload passthrough, `Record<string, unknown> | null`, no schema validation on read).
- **HMAC verification** in `CreditTopupWebhookService` includes a **replay-window check** (`WEBHOOK_MAX_SKEW_MS = 5 min`) on top of the signature — a captured-and-replayed (but validly-signed) webhook older than 5 minutes is rejected. This is stronger than the `market-checkouts`/`billing` webhook verifiers, which check signature only with no timestamp-skew bound; worth normalizing across modules in the Rust rewrite rather than porting the inconsistency.

---

## 4. `coupons` — 優惠券 (single-shop discount codes)

### 4.1 Purpose

Single-restaurant (or platform-wide, `restaurant_id IS NULL`) discount codes
applied to a **single order** at checkout time, with usage-limit and
per-user-usage-limit enforcement, percentage/fixed discount types, and
admin CRUD + bulk operations + trend analytics. This is the base coupon
primitive that `market-checkouts` (§1) and `service-bookings` (§8) both
build on top of — `market-checkouts` reuses the validation logic but records
its own `coupon_usage` rows per child order (multi-vendor split); `coupons`
itself is the single-order case.

### 4.2 Routes

All paths relative to `/api/v1/coupons`. Source: `apps/api/src/features/coupons/routes/index.ts`.

| Method | Path | Auth | Purpose | Request summary | Response summary |
| --- | --- | --- | --- | --- | --- |
| POST | `/validate` | public | Validate a code against a cart (no mutation) | `{code, restaurantId, orderAmount, userId?, menuItems?}` | `{valid, coupon?, discountAmount?, finalAmount?, error?}` |
| GET | `/available/:restaurantId` | public | List coupons visible/available for a restaurant | — | coupon list |
| POST | `/` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | Create a coupon | full coupon fields (Zod `createCouponSchema`) | 201 coupon |
| GET | `/` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | List coupons (owner scoped to own restaurant) | query filters + `page, limit` | paginated list |
| GET | `/stats/summary` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | Cross-coupon summary stats | — | `{total, active, totalUsed, totalSavings}` |
| GET | `/:id` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | Coupon detail (owner-scoped) | — | coupon or 404/403 |
| PUT | `/:id` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | Update a coupon (owner-scoped) | partial fields | updated coupon |
| POST | `/:id/deactivate` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | Deactivate a coupon (owner-scoped) | — | deactivated coupon |
| DELETE | `/:id` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0])` | Hard-delete a coupon | — | success message |
| GET | `/:id/stats` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | Per-coupon usage stats | — | `{coupon:{...}, stats}` |
| POST | `/bulk` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | Bulk activate/deactivate/delete (owner-scoped; delete requires role 0) | `{couponIds:[...], action}` | `{success, failed}` counts |
| POST | `/use` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1,4])` | Record coupon usage against an order (internal) | `{couponId, orderId, userId?}` | usage record or 409 `COUPON_USAGE_LIMIT_REACHED` |
| GET | `/analytics/trends` | `authMiddleware` + `moduleGate("coupons")` + `requireRole([0,1])` | Usage/savings trend over time | query: `restaurantId, startDate, endDate` | trend series |

### 4.3 Business logic

**`validateCoupon`** (base `CouponService` in `packages/database/src/services/coupon.ts:121-262`, wrapped by `CouponsService.validateCouponWithBusinessRules` which currently adds no extra rules): looks up by `code.toUpperCase()` scoped to `(restaurant_id = :id OR restaurant_id IS NULL)`, requires `is_active AND is_visible`, requires `now` within `[valid_from_ms, valid_to_ms]` (**INTEGER Unix milliseconds** since #271 — a plain instant comparison; they were TEXT date strings until then), requires `used_count < usage_limit` (if set), requires `orderAmount >= min_order_amount` (if set), requires `usage_limit_per_user` not exceeded for the given `userId` (counts `coupon_usage` rows with `status = 'active'`), requires at least one cart item to be in `applicable_menu_items` or its category in `applicable_categories` if either restriction is set. Discount computed the same way as the market-checkout voucher pricer (percentage rounds then clamps to `maxDiscountAmountCents`, fixed uses `discountValueCents`, both clamp to `[0, orderAmountCents]`) but this base implementation does **not** split across multiple orders — it is single-order by design.

**`useCoupon`** (base service, lines 267-310) — the usage-recording write path: checks for an existing **non-cancelled** usage row for `(couponId, orderId)` first (app-level pre-check, redundant with the DB partial-unique index below but throws a friendlier error), then `claimUsageSlot` (atomic guarded `UPDATE coupons SET used_count = used_count+1 WHERE id=? AND (usage_limit IS NULL OR used_count < usage_limit)`, throws plain `Error("Coupon usage limit reached")` on 0 rows changed — the route layer translates this specific message string into a typed `409 COUPON_USAGE_LIMIT_REACHED`, a **string-match dependency** worth replacing with a typed error in Rust), then inserts the `coupon_usage` row. If the insert throws (most likely the partial-unique-index conflict on a race), it best-effort calls `releaseUsageSlot` to undo the claim and rethrows.

**`CouponsService.useCouponForOrder`** (feature-layer wrapper, `apps/api/src/features/coupons/services/CouponsService.ts:297-372`) — used by the `/use` route: loads the order's `subtotalCents` from `orders`, re-verifies the coupon belongs to that restaurant (or is platform-wide), recomputes the discount server-side from the *order's authoritative subtotal* (never trusts a client-supplied amount), then delegates to the base `useCoupon`.

**Update semantics** (`packages/database/src/services/coupon.ts:545-600`): `updateCoupon` is careful about partial money-field updates — if only `discountValue` OR only `discountType` is provided (not both), it re-reads the current row to compute the correct paired `_cents`/`_bps` value, so a lone `discountType` change (percentage↔fixed) without a `discountValue` in the same call still produces a consistent stored value rather than nulling one field out.

### 4.4 Data

- **D1 tables** (`packages/database/src/schema/coupons.ts`): `coupons` (cents-only: `discount_percentage_bps`, `discount_value_cents`, `max_discount_amount_cents`, `min_order_amount_cents`; `valid_from_ms`/`valid_to_ms` are **INTEGER Unix milliseconds** since #271, matching `partnership_plans`), `coupon_usage` (cents-only `discount_amount_cents`/`original_amount_cents`/`final_amount_cents`; **partial unique index `(coupon_id, order_id) WHERE status IS NULL OR status != 'cancelled'`** — the concurrency-safety net behind `claimUsageSlot`/insert; also `refund_count_released_at_ms` — a one-shot marker so a refunded usage's `used_count` decrement (§1 market-checkout refund flow, `markMarketCheckoutVoucherRefunded`) fires at most once per usage row), `coupon_distributions`, `coupon_templates` (not touched by any route documented above — CRUD-only schema with no service methods found in this feature; likely dead/future-reserved).
- **Historical note (resolved)**: migration `0023_integrity_audit_and_money_cents.sql` (numbers cited from the `migrations_fresh/` track; the wrangler-deploy `migrations/` track holds the same content at `0086`/`0087` — see migration-dual-track.json) created `coupons_cents_sync_ai/au` and `coupon_usage_cents_sync_ai/au` SQL triggers that kept legacy float columns (`discount_value`, `max_discount_amount`, `min_order_amount` on `coupons`; `discount_amount`, `original_amount`, `final_amount` on `coupon_usage`) in sync with the new `_cents` columns during the transition period. Migration `0070_money_cents_cutover.sql` **dropped both the triggers and the legacy float columns** — the tables are now cents-only with no trigger-based sync in play. Do not port these triggers; they are historical, not current schema.
- **No KV, R2, queue, or Durable Object usage** in this module.
- **Events published**: none.

### 4.5 Cross-module dependencies

- `market-checkouts` (`MarketCheckoutVoucherService`) reuses `coupons`/`coupon_usage` tables directly via its own Drizzle queries (not via `CouponsService`) — it re-implements platform-wide-coupon validation with multi-order splitting rather than calling into this module's service. **Two independent code paths validate/redeem coupons against the same tables** — a Rust rewrite should evaluate whether to unify them (shared discount-pricing core, module-specific redemption/splitting) since the pricing math (`computeDiscountCents`) is currently duplicated near-verbatim between `MarketCheckoutVoucherService.computeDiscountCents` and the base `CouponService`'s inline discount block.
- `service-bookings` (`CouponService` from `@makanmasak/database` directly, via `priceVoucher`) — pricing-only reuse (`validateCoupon`), then records redemption itself via raw SQL against `coupons.used_count` (not `coupon_usage` — a booking is explicitly documented as not being an order).
- `orders` (`orders` table, read-only for subtotal in `useCouponForOrder`).

### 4.6 Rust rewrite notes

- **Cents-only now**, and the validity window is `_ms` too: `valid_from_ms`/`valid_to_ms` are INTEGER Unix milliseconds since #271 (port them as instants, e.g. `DateTime<Utc>`). The earlier advice here was to keep them as date-only strings — that described the schema comment rather than the data. The API has always written full ISO-8601 instants (`z.iso.datetime()`), and the SQL paths compared those TEXT values *lexicographically* against `new Date().toISOString()`, which is only equivalent to a time comparison while every row happens to be a fixed-width `Z`-suffixed string. One schema idiosyncrasy does remain: `used_count` claim/release is duplicated as near-identical SQL in **three places**: base `CouponService` (`packages/database/src/services/coupon.ts`), `MarketCheckoutVoucherService`, and `ServiceBookingService` — all three independently hand-write the same guarded `UPDATE coupons SET used_count = ... WHERE (usage_limit IS NULL OR used_count < usage_limit)` pattern. Consolidate into one shared function in the Rust port.
- **`useCoupon`'s error signaling is a raw `Error` with a matched message string** (`"Coupon usage limit reached"`), caught by string-inclusion check at the route layer to produce a typed API error — replace with a typed/enum error in Rust so the mapping isn't string-fragile.
- **No D1 `.batch()` anywhere in this module** — `useCoupon`'s claim-then-insert-then-compensate-on-failure is the same sequential-statement + compensating-action pattern as `credits`, just without an idempotency-key uniqueness backstop on `coupon_usage` (the backstop here is the partial-unique `(coupon_id, order_id)` index instead, which is a *different* order-scoped guarantee, not a replay-key guarantee — a client retry with a new random request but the same `orderId` is still caught, but retry-with-different-orderId is not, unlike the credits ledger's key-based idempotency).
- **`coupon_templates` and `coupon_distributions` tables exist with no corresponding service/route logic found** in this feature — flag for the Rust rewrite as either dead schema to drop or functionality that lives elsewhere (not found in this audit's scope) before assuming it needs porting.

---

## 5. `payments` — generic order payment/refund

### 5.1 Purpose

The generic (non-market-checkout, non-service-booking) payment path for a
single `orders` row: full or split/partial payment across one or more
declared `payments[]` methods, always idempotency-key-gated at the HTTP
layer, plus a role-gated manual refund endpoint shared by both this module
and `market-checkouts`' `child_transactions` refund path.

### 5.2 Routes

All paths relative to `/api/v1/payments`. Mount-level `authMiddleware` + `moduleGate("online_ordering")` applies to the whole prefix (app-factory.ts). Source: `apps/api/src/features/payments/routes/index.ts`.

| Method | Path | Auth | Purpose | Request summary | Response summary |
| --- | --- | --- | --- | --- | --- |
| POST | `/create` | mount-level auth + `moduleGate` | Process a payment (alias of `/`) | body per `createPaymentRequestSchema` (requires `orderId, restaurantId, country, currency, amount, method`), **required** `Idempotency-Key` | `{id, paymentId, transactionId, status, metadata:{...}}` |
| POST | `/` | mount-level auth + `moduleGate` | Process a payment (full/partial mode) | body per `rootPaymentRequestSchema` (`paymentMode: full\|partial`, `payments[]` for partial), **required** `Idempotency-Key` | same shape as `/create` |
| GET | `/status/:transactionId` | mount-level auth + `moduleGate` | Look up payment status | — | `{transactionId, orderId, paymentStatus, status}` — falls back to `orders.payment_transaction_id` if no `payment_transactions` row |
| POST | `/refund` | `requireRole([0,1,4])` (route-level, on top of mount-level auth) | Refund a payment transaction (full or partial) | `{transactionId, amount?, reason?}` | `{refundId, transactionId, amount, status, paymentStatus}` |
| GET | `/methods/:country` | mount-level auth + `moduleGate` | List supported payment methods for a country | — | `{country, supportedMethods:[...]}` |

### 5.3 Business logic

**`processPayment`** (`PaymentService.ts:75-263`):
1. Load the order; 404 if missing.
2. Access check: if the caller has a `restaurantId` and role ≠ 0, it must match `order.restaurantId`, else 403. Role must be in `[0,1,4]` (admin/owner/cashier) — `canProcessPayment`.
3. **Already-finalized guard**: reject (409 `ORDER_NOT_PAYABLE`) if `order.status` is `cancelled`/`paid`/`refunded` or `order.paymentStatus` is `paid`/`completed`/`refunded`/`partial_refunded`.
4. **Server-authoritative amount reconciliation**: `serverTotal = amountFromCents(order.totalAmountCents)`. If the caller supplied `expectedTotal`, it must match `serverTotal` to the cent (409 `PAYMENT_TOTAL_MISMATCH` with `{expected, actual}` in details) — this is a client sanity check only, never a source of truth. For `paymentMode: "partial"`, the sum of `payments[].amount` must equal `serverTotal` to the cent (409 `PARTIAL_PAYMENT_TOTAL_MISMATCH`). For `"full"`, `input.amount` must equal `serverTotal` (409 `PAYMENT_AMOUNT_MISMATCH`).
5. **Claim payability atomically first**, before any other writes: a single guarded `UPDATE orders SET status='paid'(if closeOrder), payment_status='paid', payment_method=?, payment_transaction_id=? WHERE id=? AND payment_status NOT IN (paid,completed,refunded,partial_refunded) AND status NOT IN (paid,cancelled,refunded)`. Zero rows changed → 409 `ORDER_NOT_PAYABLE` (this is the race-safety net against a concurrent duplicate payment attempt on the same order, independent of the idempotency-key layer).
6. **Then** `db.batch([...])` — a genuinely atomic multi-statement group: insert the `payment_transactions` row (`status: "pending"`), append a `PAYMENT_AUDIT_EVENT_TYPES.ATTEMPT` audit row, conditionally free the table (`tables.is_occupied=false` etc., only if `shouldCloseOrder && tableId`), flip the payment transaction to `status: "paid"` with `completedAt`, append a `SUCCESS` audit row. All five (or four, if no table) statements are one D1 batch call.
7. Post-batch side effects (best-effort, errors logged not thrown): if `closeOrder`, call `finalizeOrderStatusSideEffects` (orders feature — notifications/analytics/cache); else just invalidate the order's cache entry.
8. Note the **payment method special-case**: `method = "split"` is hardcoded whenever `paymentMode === "partial"`, regardless of what `payments[].method` values were supplied — the per-payment-method breakdown of a partial payment is not separately persisted per line item in `payment_transactions` (only the aggregate transaction row exists); if per-method partial-payment reporting is needed downstream, it isn't available from this table alone in the current design.

**`refundPaymentTransaction`** (`refundPayment.ts:37-180`):
1. Require an authenticated user; role must be `[0,1,4]`, and non-admins are restricted to their own restaurant (`assertRefundAccess`).
2. Look up the order by `payment_transaction_id`; reject (409 `PAYMENT_NOT_REFUNDABLE`) if `paymentStatus` is `pending`/`failed`/`cancelled`/`refunded`.
3. Compute `refundAmount = input.amount ?? paymentTotal` (full refund if unspecified); `nextRefundTotal = currentRefundTotal + refundAmount`; reject (409 `REFUND_AMOUNT_EXCEEDS_PAYMENT`) if `nextRefundTotal > paymentTotal` (cent-exact comparison via the same `cents()` helper).
4. `isFullRefund = nextRefundTotal >= paymentTotal` → `paymentStatus = "refunded"` else `"partial_refunded"`.
5. **Atomic guarded UPDATE** (mirrors the payment-claim pattern): `UPDATE orders SET payment_status=?, refund_amount_cents = refund_amount_cents + ?, status = (refunded ? 'refunded' : status) WHERE id=? AND payment_transaction_id=? AND payment_status NOT IN (pending,failed,cancelled,refunded) AND refund_amount_cents + ? <= total_amount_cents`. Zero rows changed → 409 `REFUND_AMOUNT_EXCEEDS_PAYMENT` (this re-checks the ceiling *inside* the SQL guard too, closing a TOCTOU race between step 3's application-level check and this write, for concurrent refund requests against the same payment).
6. Then a `db.batch([...])`: an `onConflictDoNothing` legacy-backfill insert into `payment_transactions` (a defensive no-op for a pre-existing/mid-migration row shape, see Rust notes), the actual `payment_transactions` status update, the `refund_transactions` insert (`refundId = "ref_{transactionId}_{now}"`, `status: "completed"` — refunds in this module are always synchronous/immediate, no pending-refund state machine), and a `PAYMENT_AUDIT_EVENT_TYPES.REFUND` audit row.

### 5.4 Data

- **D1 tables** (`packages/database/src/schema/payments.ts`): `payment_transactions` (`amount_cents` INTEGER; **partial unique index on `idempotency_key` WHERE NOT NULL** — note this column exists on the table but `PaymentService.processPayment` does **not** populate it from the HTTP `Idempotency-Key` header in the write path shown — it's passed through as `data.idempotencyKey` from the route via `options.idempotencyKey`, so it *is* stored; the uniqueness constraint is real and enforced), `refund_transactions` (`amount_cents` INTEGER, references `payment_transactions.transaction_id`). Also writes to `orders` (payment/refund status + amounts) and conditionally `tables` (occupancy release on close).
- **No KV/R2/queue/Durable Object usage directly** in this module; `finalizeOrderStatusSideEffects`/`invalidateOrderCache` (orders feature) touch `CACHE_KV` on the caller's behalf.
- **Events published**: none formal beyond the `payment_audit_log` append (shared audit trail, see §6).

### 5.5 Cross-module dependencies

- `billing` feature (`PaymentAuditService`, `PAYMENT_AUDIT_EVENT_TYPES`) — every attempt/success/refund is audited through the shared `payment_audit_log` table.
- `orders` feature (`finalizeOrderStatusSideEffects`, `invalidateOrderCache`) — post-payment side effects.
- `market-checkouts` feature calls into this module directly: `PaymentService.processPayment` (child-transactions split mode) and `refundPaymentTransaction` (child-transactions refund mode, and re-exported for its own refund route).

### 5.6 Rust rewrite notes

- **Cents-only at the DB layer**, but the **service and route layer still speak float dollars** at the API boundary (`amount: number`, `assertSameAmount` converts via a local `cents()` helper — `Math.round(value*100)` — for comparison only, never stored as float). A Rust port has a choice: keep the float-at-API-boundary/cents-at-DB-boundary split (matches current client contract) or push cents all the way to the API (breaking client contract, needs coordinated frontend change). Recommend documenting this explicitly as a decision point rather than silently picking one.
- **Two-phase write pattern, not one transaction**: (1) a single guarded UPDATE on `orders` to atomically claim payability/refundability (the *real* concurrency guard), followed by (2) a `db.batch()` of the dependent inserts/updates. If step (2) fails after step (1) succeeds, the order is left `paid`/`refunded` with **no** corresponding `payment_transactions`/`refund_transactions`/audit row — an inconsistent-but-recoverable state (the money-relevant flag on `orders` is authoritative; the detail rows would need out-of-band reconciliation). A Rust rewrite targeting a backend with real cross-statement transactions should strongly consider wrapping steps (1)+(2) into one transaction to close this gap, since nothing in the current D1-based design prevents it other than it not being one `.batch()` call today.
- **HTTP-layer idempotency** (`idempotencyMiddleware({scope:"payment", requireKey:true, effectId: paymentEffectId})`) wraps `/create` and `/` — this is the generic `idempotency_keys` replay-cache (§ see `market-checkouts` notes for the general shape), keyed by the `Idempotency-Key` header + a SHA-256 hash of the raw request body; a retried request with the *same* key+body replays the cached response (`X-Idempotent-Replay: true` header), a same-key-different-body retry is rejected (422 `IDEMPOTENCY_BODY_MISMATCH`). This is **layered on top of**, not a replacement for, the DB-level `payment_transactions.idempotency_key` unique index and the guarded-UPDATE payability claim — three independent safety nets for the same "don't double-pay" goal, worth preserving all three in a Rust port since they guard different failure modes (client retry, DB-level duplicate insert, concurrent racing request).
- **The legacy-backfill `onConflictDoNothing` insert in `refundPaymentTransaction`** (`preparePaymentLedgerForRefund`) inserts a synthetic `payment_transactions` row tagged `metadata: {source: "refund_legacy_backfill"}` — this appears to be defensive code for orders whose payment was recorded before `payment_transactions` existed as a table (or via some other code path that didn't insert one), so a refund against such an order still has a transaction row to update in the next batch statement. A Rust port should investigate whether this is still reachable in practice (i.e. are there live orders with a `payment_transaction_id` but no `payment_transactions` row) before deciding whether to carry this compatibility shim forward.
- **Timestamps**: `_ms` INTEGER throughout at the DB layer (`created_at_ms`, `completed_at_ms`, `failed_at_ms`); JS-layer `Date` objects passed to Drizzle (`timestamp_ms` mode auto-converts).

---

## 6. `billing` — subscription billing lifecycle, usage metering, webhooks

### 6.1 Purpose

Platform-side (not restaurant-facing) billing infrastructure: a shared
provider-webhook receiver + audit ledger (`payment_audit_log`) used by
*multiple* modules (payments, market-checkouts, credits all append to it —
see their sections), a usage-metering read API (`UsageService`, consumed by
`subscriptions` and `me`), a billing-cycle closer + trial reaper + trial
reminder sender driven entirely by cron, and a generic
dedup'd notification dispatcher (Slack/email) used for billing lifecycle
events. This module owns **no direct customer-facing payment flow** — there
is no "pay your subscription invoice" HTTP endpoint in this codebase; billing
is presumed to be reconciled externally (Stripe/LINE Pay) and this module
only *reacts* to webhooks and *runs scheduled lifecycle transitions*.

### 6.2 Routes

Only one HTTP route in the whole module, mounted at `/api/v1/billing` with **no** blanket auth (app-factory.ts does not list `/billing/*` in its auth-middleware block). Source: `apps/api/src/features/billing/routes/index.ts`.

| Method | Path | Auth | Purpose | Request summary | Response summary |
| --- | --- | --- | --- | --- | --- |
| POST | `/webhooks/:provider` | public, HMAC-verified in service | Stripe/LINE Pay billing webhook | raw body + provider signature headers | `{provider, eventId, eventType, duplicate, reconciled}` |

The `subscriptions` module (§7) exposes `UsageService` reads under `/api/v1/admin/subscriptions/:restaurantId/usage` and `/usage/events` — those routes live in `features/subscriptions/routes` but call directly into `features/billing/services/UsageService`, documented here since the service itself belongs to this module.

### 6.3 Business logic

**Webhook handling** (`BillingWebhookService.handle`) — same audit-then-reconcile shape as the market-checkout/credits webhook services, but with two differences worth flagging: (1) **no timing-safe comparison** — both the Stripe (`signature !== expected`) and LINE Pay (`signature !== expected`) checks use a plain `!==`, unlike `market-checkouts`' and `credits`' HMAC verifiers which use a manual constant-time XOR-accumulate compare; this is a **timing side-channel inconsistency** across otherwise-parallel webhook verifiers in the same codebase, worth normalizing in the Rust port. (2) Reconciliation only handles two event types by name: `invoice.paid` (flips `shop_subscriptions.is_active = 1` for the restaurant named in the payload's `metadata.restaurantId`, via a raw `env.DB.batch()` of an UPDATE + an audit-log INSERT) and `invoice.payment_failed` (records a `GRACE_PERIOD_START` audit row and sends a Slack `PAYMENT_FAILED` billing notification, deduped by `payment_failed:{restaurantId}:{payload.id ?? now}`). Any other event type is audited (for replay-dedup) but `reconciled: false` — no state change.

**Billing cycle closing** (`BillingCycleService.closeDueCycles`, driven by cron `15 2 * * *`) — selects up to 250 active, non-trial subscriptions whose `billing_cycle_end_at_ms <= now`, and for each: reads that cycle's `usage_meters` rows, computes a usage snapshot against `PLAN_QUOTAS[planTier]` (soft/hard limits, `overage = max(0, total - hard)`), then in **one `env.DB.batch()`**: `INSERT OR IGNORE` a `cycle_snapshots` row (idempotent per-cycle audit artifact — `total_overage_cents` is hardcoded to `0` in this INSERT, i.e. **overage is computed for the snapshot payload but never billed/charged anywhere in this code** — there is no line that converts overage into an actual charge; overage handling appears to be observability-only in the current implementation), an UPDATE advancing `shop_subscriptions.billing_cycle_start_at_ms`/`_end_at_ms` to the next `DEFAULT_BILLING_CYCLE_MS` (30 days) window, and a `CYCLE_CLOSE` audit-log INSERT.

**Trial lifecycle** (`TrialReaperService.downgradeExpiredTrials`, same cron) — selects up to 250 active `plan_tier='trial'` subscriptions whose `trial_ends_at_ms <= now`, and per row: one `env.DB.batch()` (UPDATE to `plan_tier='basic'`, reset `module_overrides='{}'`, roll a fresh 30-day billing cycle starting *now* + a `TRIAL_DOWNGRADE` audit row) followed by (outside the batch) a best-effort `TRIAL_0D` email notification. `BillingReminderService.sendTrialEndingReminders` (also same cron) sends `TRIAL_3D`/`TRIAL_1D` email reminders for trials ending in a `[now+3d, now+4d)` / `[now+1d, now+2d)` window respectively — each dedup'd by `{kind}:{restaurantId}:{trialEndsAt}`.

**Notification dedup** (`BillingNotificationService.send`) — before attempting delivery, checks for an existing `notification_dispatch_log` row matching `(restaurant_id, kind, dedup_key, channel)` (note: `restaurant_id IS ?` not `= ?`, correctly matching `NULL` when `restaurantId` is absent) and short-circuits to `SKIPPED_DUPLICATE` if found — this check-then-send is **not** atomic (no unique-index-backed insert-first pattern like the payment/webhook audit logs use), so two near-simultaneous calls with the same dedup key *could* both pass the check and both send, though in practice all current callers are single-threaded cron loops iterating sequentially, not concurrent. If the provider isn't configured (`SLACK_WEBHOOK_URL` for Slack, `RESEND_API_KEY`+`BILLING_EMAIL_FROM`/`NOTIFICATION_FROM_EMAIL`+`recipient` for email), the notification is recorded as `SKIPPED_PROVIDER_UNCONFIGURED` rather than silently dropped — always logged.

**Usage read model** (`UsageService.getCurrentUsage`) — resolves the *current* billing cycle window from `shop_subscriptions` (non-trial: stored `billing_cycle_start/end`; trial: `created_at` → `trial_ends_at` or `+14d` fallback; no subscription row at all: calendar-month fallback), sums **already-aggregated** `usage_meters.total_quantity` for that window plus **not-yet-aggregated** `usage_events` (`aggregated_at_ms IS NULL`) in the same window, so a usage-read is always current even between aggregation cron runs (aggregation itself — `workers/usage-aggregator.ts`, cron `*/5 * * * *` — is outside this feature's files but referenced from `apps/api/src/index.ts`). Attaches `PLAN_QUOTAS[planTier][meterKey]` soft/hard limits and a `percentage = total/hard` per meter.

### 6.4 Data

- **D1 tables**: `payment_audit_log` (schema at `packages/database/src/schema/payment-audit-log.ts` — **partial unique index `(provider, provider_event_id) WHERE provider_event_id IS NOT NULL`**, the idempotency backbone shared across `payments`, `market-checkouts`, `credits`, and `billing` webhook/attempt logging), `notification_dispatch_log` (**unique index `(restaurant_id, kind, dedup_key, channel)`** — declared as a DB constraint but the app-level dedup check runs *before* the constraint would fire, i.e. the constraint is a backstop against the app-level check's non-atomicity, using `INSERT OR IGNORE` at write time), `usage_events` (raw per-event log, partial index on `aggregated_at_ms IS NULL` for the pending-aggregation scan), `usage_meters` (**unique index `(restaurant_id, meter_key, cycle_start_at_ms)`** — the aggregated per-cycle total), `cycle_snapshots` (audit artifact per closed cycle, `usage`/`modules` JSON blobs), `shop_subscriptions` (read/written; owned by `subscriptions` feature, §7), `storage_counters` (read by `UsageService.emitStorageSnapshots`, not shown in detail above — feeds `usage_events` from a separately-maintained per-restaurant storage counter table).
- **No KV/R2/queue/Durable Object usage** in this module directly.
- **Cron**: `*/5 * * * *` → usage aggregation (`workers/usage-aggregator.ts`, outside this feature's directory but consuming its tables) and market-checkout reconciliation (unrelated, shares the cron slot); `0 2 * * *` → storage usage snapshot (`workers/storage-snapshot.ts`, calls `UsageService.emitStorageSnapshots`); `15 2 * * *` → `BillingCycleService.closeDueCycles` + `TrialReaperService.downgradeExpiredTrials` + `BillingReminderService.sendTrialEndingReminders`, run via `Promise.all` (three independent lifecycle jobs in parallel, each internally batching per-row). All defined in `apps/api/src/index.ts`'s `scheduled()` handler.
- **Events published**: Slack webhook posts and Resend email sends (external), both logged to `notification_dispatch_log` regardless of success/failure/skip.

### 6.5 Cross-module dependencies

- `payments`, `market-checkouts`, `credits` all import `PaymentAuditService`/`PAYMENT_AUDIT_EVENT_TYPES` from this module to append to the shared `payment_audit_log` — this module is a **dependency of** those three, not the reverse.
- `subscriptions` feature imports `UsageService` directly (no HTTP hop — in-process class construction) for its admin usage-read routes.
- `middleware/quotaGate.ts` and `middleware/moduleGate.ts` (core middleware, not a feature) both import `BillingNotificationService`/`PLAN_QUOTAS`/`PLAN_DEFAULT_MODULES` from `@makanmasak/database` and this module respectively — the quota/module enforcement gates that guard `payments`, `coupons`, and others at the route-mount level are effectively billing-module consumers.

### 6.6 Rust rewrite notes

- **No customer-money movement in this module at all** — every amount here is either a usage *count* (`quantity`, `total_quantity`, unitless meter counts, not money) or a `total_overage_cents` field that is always written as literal `0` (dead/unimplemented billing-for-overage). If overage billing is meant to be implemented in the Rust rewrite, this is the seam — currently it's purely observational.
- **Cron-only mutation surface, sequential per-row loops with individual `db.batch()` per row** (not one giant transaction for all due subscriptions) — each subscription's cycle-close or trial-downgrade is its own atomic unit; a crash mid-run leaves some subscriptions closed/downgraded and others not, which is fine to retry (the `WHERE ... <= now` selection criteria naturally re-selects only the not-yet-processed rows next run, and `cycle_snapshots`' `INSERT OR IGNORE` makes the snapshot half idempotent — but note the `shop_subscriptions` cycle-advance UPDATE has **no equivalent idempotency guard**, so if a crash happens *between* the batch's internal statements... it can't, since they're one D1 batch; the risk window is only *between* rows in the loop, not within a row).
- **Timing-unsafe signature comparison** (`!==` instead of constant-time compare) in `BillingWebhookService` — inconsistent with `market-checkouts`/`credits` webhook verifiers in the same codebase. Use one shared constant-time-compare HMAC verifier across all four webhook-consuming modules (`billing`, `market-checkouts`, `credits`, plus any others found in adjacent audits) in the Rust rewrite.
- **`notification_dispatch_log` dedup is check-then-insert, not insert-first-with-unique-constraint-as-the-gate** — even though the DB has a real unique index, the app never relies on catching its violation; it pre-checks with a `SELECT` and then does `INSERT OR IGNORE`. A Rust port should either lean on the unique-index-violation-as-signal pattern (matching how `payment_audit_log`/webhook dedup works elsewhere in this codebase) for consistency, or accept the current design's negligible race window given its cron-only, sequential-loop call sites.
- **Timestamps**: `_ms` INTEGER throughout. **JSON columns**: `cycle_snapshots.modules`/`.usage` (both serialized via `JSON.stringify` before a raw `.bind()`, not Drizzle's JSON mode — this table appears to be accessed via raw `env.DB.prepare()` rather than the Drizzle query builder throughout `BillingCycleService`, unlike most other modules in this doc which mix Drizzle + raw SQL; check whether a `cycleSnapshots` Drizzle schema object even exists before assuming Layer 1/2 compliance for a straight port), `notification_dispatch_log.payload`, `usage_events.metadata`, `shop_subscriptions.module_overrides` (owned by §7).

---

## 7. `subscriptions` — plan tier, module entitlements, admin usage views

### 7.1 Purpose

Admin-only (role 0) management of each restaurant's **one** subscription
row: plan tier (`trial`/`basic`/`pro`/`enterprise`), per-module entitlement
overrides layered on top of plan defaults, and an active/inactive kill
switch. This is the entitlement/gating source of truth consumed by
`middleware/moduleGate.ts` (KV-cached, 5-minute TTL) everywhere else in the
API — including `payments` (`online_ordering`), `coupons` (`coupons`), and
several non-commerce modules not covered by this doc. No money changes hands
here; this module only *declares* what a restaurant is entitled to and reads
usage totals (via `billing`'s `UsageService`) for admin visibility.

### 7.2 Routes

All paths relative to `/api/v1/admin/subscriptions`, `authMiddleware` + `requireRole([0])` applied both at the app-factory mount and redundantly inside the router itself. Source: `apps/api/src/features/subscriptions/routes/index.ts`.

| Method | Path | Auth | Purpose | Request summary | Response summary |
| --- | --- | --- | --- | --- | --- |
| GET | `/:restaurantId/usage` | admin (0) | Current + historical cycle usage | query: `from, to` (ISO datetime) | `{restaurantId, current, cycles}` |
| GET | `/:restaurantId/usage/events` | admin (0) | Paginated raw usage-event log | query: `meterKey, from, to, limit, page` | `{page, limit, total, events}` |
| GET | `/` | admin (0) | List all subscriptions with effective modules | — | list, each with `effectiveModules` computed |
| GET | `/:restaurantId` | admin (0) | Single subscription detail | — | subscription + `effectiveModules`, or 404 |
| POST | `/` | admin (0) | Create a subscription (client onboarding) | `{restaurantId, planTier, trialEndsAt?, billingCycleStartAt?, billingCycleEndAt?, notes?}` | 201 subscription |
| PATCH | `/:restaurantId/modules` | admin (0) | Merge module overrides | `{overrides: {moduleKey: bool\|undefined}}` | updated subscription + `effectiveModules`; invalidates the module-gate KV cache |
| PATCH | `/:restaurantId/plan` | admin (0) | Change plan tier | `{planTier}` | updated subscription (module overrides **reset to `{}`**) + `effectiveModules`; invalidates KV cache |
| PATCH | `/:restaurantId/status` | admin (0) | Kill switch (activate/deactivate) | `{isActive}` | updated subscription; invalidates KV cache |

### 7.3 Business logic

- **One subscription per restaurant**, enforced by a DB-level `UNIQUE` on `shop_subscriptions.restaurant_id` (not just app-level) — `create` still pre-checks via `getByRestaurantId` and throws a typed `409 SUBSCRIPTION_EXISTS` before attempting the insert, giving a friendlier error than a raw constraint violation.
- **Module overrides are a sparse patch, not a full replacement**: `updateModules` merges `input.overrides` on top of the *existing* `moduleOverrides` JSON map; a key explicitly set to `undefined` in the input is then **deleted** from the merged map (reverting that module to the plan default) rather than being stored as `null`/`false`. `changePlan` is the one place that **resets** `moduleOverrides` to `{}` outright — changing tiers wipes all prior per-module overrides, always falling back to the new tier's defaults.
- **`getEffectiveModules`** (pure function, no I/O): unions the key-sets of `PLAN_DEFAULT_MODULES[planTier]` and `moduleOverrides`, then for each key resolves `override ?? planDefault ?? false` — this exact same resolution logic is duplicated in `middleware/moduleGate.ts`'s `resolveModule` (which additionally layers in the trial-expiry check and the `isActive` kill-switch, neither of which `getEffectiveModules` itself checks) — **the admin-facing `effectiveModules` in list/detail responses does not account for `isActive` or trial expiry**, unlike the actual request-time gate. A Rust port should either unify these two implementations or explicitly preserve the discrepancy (admin view = "what the plan+overrides say", live gate = "what's actually enforced right now including kill-switch/trial-expiry") if that's an intentional product decision — nothing in the code comments confirms intent either way.
- **Cache invalidation**: every mutating route (`modules`, `plan`, `status`) calls `invalidateSubscriptionCache(c, restaurantId)` (from `middleware/moduleGate.ts`) — a single KV-key delete for that restaurant's cached subscription snapshot, making the kill-switch/module-override change effective on the *next* request rather than waiting out the 5-minute TTL.

### 7.4 Data

- **D1 tables** (`packages/database/src/schema/subscriptions.ts`): `shop_subscriptions` — `restaurant_id` **UNIQUE**, `plan_tier` enum-typed text, `module_overrides` JSON (`ModuleMap = Partial<Record<ModuleKey, boolean>>`), `is_active` boolean kill switch, `trial_ends_at_ms`/`billing_cycle_start_at_ms`/`billing_cycle_end_at_ms` all `_ms` nullable integers, `notes` free text (admin-only, not shown to the restaurant owner per code comment).
- **Constant tables** (not DB rows — compiled into the binary/module): `MODULES` (the full module-key enum), `PLAN_TIERS`, `PLAN_DEFAULT_MODULES` (per-tier default module map), and (in `billing`'s domain) `PLAN_QUOTAS`/`METER_KEYS` for usage soft/hard limits — all defined in `packages/database/src/schema/subscriptions.ts` and `usage-events.ts`/`usage-meters.ts` respectively, consumed by both `subscriptions` and `billing`.
- **KV**: one cache entry per restaurant (`middleware/moduleGate.ts`'s cache key scheme, TTL 300s) — read on every gated request, invalidated explicitly by this module's mutating routes.
- **No queue, R2, or Durable Object usage.**

### 7.5 Cross-module dependencies

- `billing` feature (`UsageService`) — usage-read routes construct it directly.
- `middleware/moduleGate.ts` and `middleware/quotaGate.ts` (core, not a feature) read `shop_subscriptions` directly (their own Drizzle queries, not via `SubscriptionService`) and are the actual runtime enforcement point for every module-gated/quota-gated route across the API, including `payments` and `coupons` in this doc.
- `restaurants` feature (implied, not traced in this audit): `SubscriptionService.provisionDefaultForRestaurant` exists as a public method (auto-provisions a 30-day trial subscription) but is not called from any route in this feature — it is presumably invoked from restaurant-onboarding code elsewhere (not confirmed in this pass; flag for verification before assuming dead code).

### 7.6 Rust rewrite notes

- **No money at all in this module's own tables** — it is pure entitlement/config state. The only numeric fields are timestamps and booleans/enums.
- **Two independent implementations of "effective modules" resolution** (`SubscriptionService.getEffectiveModules` vs `middleware/moduleGate.ts`'s `resolveModule`) with different inputs considered (kill-switch + trial-expiry only in the middleware version) — consolidate into one function taking an explicit "as of now, enforce kill-switch/trial" boolean flag in the Rust port, so admin-view and live-gate share one code path with an explicit mode difference instead of two hand-maintained copies.
- **`changePlan`'s full-reset-to-`{}}` semantics for `moduleOverrides`** is a deliberate, documented behavior (comment: "reset module overrides to the new plan defaults") — preserve exactly; do not "improve" it into a smarter merge, since downgrading a plan is presumably meant to strip any overrides that were only sensible under the old tier.
- **Timestamps**: `_ms` INTEGER throughout, consistent with repo convention. **JSON**: `module_overrides` only, typed via Drizzle generics with no runtime validation on read (a hand-corrupted JSON blob would only surface as a runtime type mismatch downstream, not a parse error at read time, since Drizzle's `mode:"json"` uses `JSON.parse` which *would* throw on truly invalid JSON — but would not catch a validly-parsed-but-wrong-shaped object).

---

## 8. `service-bookings` — 預約服務 (in-app service reservation MVP)

### 8.1 Purpose

Internal (non-external-URL) booking of a `restaurant_service_items` row —
e.g. a consultation, rental slot, or activity — for a specific date/time,
parallel to (but a separate table from) the dining-table `reservations`
feature. Supports anonymous public booking creation, recurring booking
series, a waitlist, optional per-slot capacity caps, three payment paths
(卷 voucher pricing-layer discount, 代幣 credits full payment, or cash/none
pay-at-venue), staff confirm/cancel/complete/no-show transitions, and
calendar-invite (.ics) generation. This module's payment/voucher logic is
intentionally lighter-weight than `market-checkouts`': a booking is
explicitly documented in the source as "not an order" — voucher redemption
here increments `coupons.used_count` directly with no `coupon_usage` row at
all (a design choice, not an oversight).

### 8.2 Routes

All paths relative to `/api/v1/service-bookings`. Public routes are declared first in the router; `app.use("/*", authMiddleware)` is applied partway through the same file (`routes/index.ts:360`), before all staff/admin routes below the `// ── Staff / admin ──` marker. Source: `apps/api/src/features/service-bookings/routes/index.ts`.

| Method | Path | Auth | Purpose | Request summary | Response summary |
| --- | --- | --- | --- | --- | --- |
| GET | `/availability` | public | Open slots for a service on a date | query: `serviceItemId, date` | `{slots:[{timeSlot, remaining, isAvailable}]}` |
| POST | `/` | public | Create a booking (status `pending`, unpaid) | `createSchema` (restaurant/service/customer/date/time/party size/employee/voucherCode/paymentRequirement/depositAmountCents/reminder prefs) | 201 `{booking}` |
| POST | `/recurring` | public, rate-limited (5/15min) | Create up to 12 weekly-spaced bookings sharing a `recurrenceGroupId` | `recurringCreateSchema` (no `voucherCode` — rejected) | 201 `{bookings:[...]}` |
| POST | `/waitlist` | public, rate-limited (5/15min) | Join the waitlist for a full/unavailable slot | `waitlistSchema` | 201 `{waitlistEntry}` |
| POST | `/:id/pay` | public | Pay a pending booking with 代幣 | `{creditCardPublicId, pin?}` | `{booking}` (now `confirmed`) |
| GET | `/verify/:code/ics` | public, rate-limited (20/15min) | Download calendar invite by confirmation code | query/contact-proof params | `text/calendar` |
| GET | `/verify/:code` | public, rate-limited (20/15min) | Look up a booking by confirmation code (ownership proof, not the booking id) | contact-proof params | `{booking}` or 404 |
| POST | `/verify/:code/cancel` | public, rate-limited (20/15min) | Anonymous self-service cancel | body/query contact-proof params | `{booking}` |
| — | *(all routes below require `authMiddleware`)* | | | | |
| GET | `/slots` | `requireRole([0,1])` + restaurant scope | List capacity slots | query: `restaurantId, serviceItemId?, date?` | `{slots}` |
| POST | `/slots` | `requireRole([0,1])` + restaurant scope | Create/upsert a capacity slot | `createSlotSchema` | 201 `{slot}` |
| POST | `/slots/batch` | `requireRole([0,1])` + restaurant scope | Bulk-create slots across a date range × time-slot list (cap 1000 total) | `batchCreateSlotsSchema` | 201 `{created, slots}` |
| POST | `/slots/block` | `requireRole([0,1])` + restaurant scope | Block a specific slot (0 capacity) | `blockSlotSchema` | `{slot}` |
| GET | `/reminders/due` | `requireRole([0,1,3,4])` + restaurant scope | List confirmed bookings due for a reminder | query: `restaurantId, before` | `{bookings}` |
| POST | `/:id/reminder-sent` | `requireRole([0,1,3,4])` + restaurant scope | Mark reminder sent | — | `{booking}` |
| GET | `/:id/ics` | `requireRole([0,1,3,4])` + restaurant scope | Staff calendar-invite download | — | `text/calendar` |
| GET | `/` | `requireRole([0,1,3,4])` + restaurant scope | List bookings for a restaurant | query: `restaurantId, date?, status?` | `{bookings}` |
| GET | `/:id` | `requireRole([0,1,3,4])` + restaurant scope | Booking detail | — | `{booking}` |
| DELETE | `/:id` | `requireRole([0,1,4])` + restaurant scope | Staff cancel | — | `{booking}` |
| POST | `/:id/confirm-cash` | `requireRole([0,1,4])` + restaurant scope | Confirm a pay-at-venue booking | — | `{booking}` |
| POST | `/:id/complete` | `requireRole([0,1,3,4])` + restaurant scope | Transition confirmed → completed | — | `{booking}` |
| POST | `/:id/no-show` | `requireRole([0,1,4])` + restaurant scope | Transition confirmed → no_show | — | `{booking}` |

"Restaurant scope" = `assertRestaurantScope`/`loadBookingInScope`: role 0 is unscoped; every other role is confined to `user.restaurantId` (derived from the auth token, never a trusted query param) — a deliberate anti-IDOR guard the code comments explicitly flag as mirroring the `reservations` feature's pattern.

### 8.3 Business logic

**State machine**: `pending → confirmed → {completed | no_show}`, or `pending|confirmed → cancelled` (terminal). Enforced by guarded UPDATEs checking `status = <expected>` in the `WHERE` clause everywhere, never a plain unconditional write — `markConfirmed` requires `status='pending'`, `transition("completed"|"no_show")` requires `status='confirmed'`, `cancelBookingRow` rejects if already `cancelled`/`completed`/`no_show`. Every one of these zero-row-changed outcomes surfaces as a typed `409 BOOKING_NOT_PAYABLE`/`BOOKING_INVALID_TRANSITION`/`BOOKING_NOT_CANCELLABLE`.

**`createBooking`** (`ServiceBookingService.ts:177-311`):
1. Load the `restaurant_service_items` row; require active/not-deleted, matching restaurant, `requiresBooking = true`.
2. `assertWithinServiceHours` against the service's `availableHours` JSON.
3. If `employeeId` given, `assertEmployeeAvailable` — validates the employee belongs to the restaurant, is active, is not a customer-role (`role === 5` rejected), matches an `employeeAvailability` rule for that day/time (specific-date rules outrank recurring, `priority` breaks further ties), and has no overlapping active booking for that employee on that date (`assertEmployeeHasNoOverlappingBooking`, in-app time-range overlap check over `pending`+`confirmed` rows — not DB-enforced).
4. **Reserve slot capacity** (`reserveSlotCapacity`, atomic guarded UPDATE incrementing `current_bookings` only if `is_available AND current_bookings < max_capacity`; **absence of a slot row at all means uncapped/always-available** — this is a deliberate "opt-in capacity" design, not a bug, but means a service with no slot rows configured can be booked without limit). Sets `capacityReserved = true` on success so a later failure can release it.
5. If `voucherCode` given, `priceVoucher` — delegates pricing to the base `CouponService.validateCoupon` (§4), converts the returned discount back to cents, clamps to `priceCents`. **Recurring bookings explicitly reject a voucher code up front** (400 `RECURRENCE_VOUCHER_UNSUPPORTED`) — vouchers are single-booking only by design.
6. `amountDueCents = max(0, priceCents - voucherDiscountCents)`. `resolvePaymentTerms` then derives `{requirement, depositRequiredCents, balanceDueCents, amountDueCents}`: `requirement` defaults to `prepay` if unspecified; `none` zeroes `amountDueCents` (nothing collected up front, full balance due at venue); `deposit` requires a positive `depositAmountCents` not exceeding the computed amount due, splitting it into `depositRequiredCents` (charged now) + `balanceDueCents` (due later, uncollected by this code path); `prepay` (implicit default branch, not shown in the excerpted read but implied by the type) charges the full `amountDueCents` now.
7. Insert the `service_bookings` row with `status: "pending"`, a random 3-part-unspecified `confirmationCode` (see §8.4), a `calendarUid`, and (if part of a recurring series) `recurrenceGroupId`/`Index`/`Count`.
8. **On any failure after capacity was reserved**, `releaseSlotCapacity` is called in a `.catch()` (best-effort, logs but never throws) before rethrowing the original error — so a mid-flight voucher-pricing failure (step 5) or insert failure (step 7) doesn't leak a phantom capacity reservation.

**`createRecurringBookings`** — loops `createBooking` `count` times (max 12) at weekly (or `intervalWeeks`-weekly) intervals sharing one `recurrenceGroupId`; on **any** iteration's failure, `rollbackRecurringBookings` walks the successfully-created bookings **in reverse order** and, for each still `pending`, deletes the row and releases its slot capacity (each step independently try/caught and logged, never re-thrown) — this is a **manual application-level saga/compensation loop**, not a DB transaction, since each `createBooking` call is itself a multi-statement sequence with no shared transaction boundary across iterations.

**`payWithCredits`** — requires the booking be `pending` (`loadPayableBooking`). If `amountDueCents > 0`, spends via `CreditService.spend` (§3) with `idempotencyKey: "service-booking:{booking.id}"` (booking-id-scoped, not per-attempt — a retried pay call for the same booking is naturally idempotent at the credits-ledger level) and `sourceType: "service_booking"`. Then `markConfirmed` — a `db.batch()` (via raw `this.d1.batch`, not Drizzle) of the guarded booking-status UPDATE plus, **only if `booking.couponId` is set**, a guarded `coupons.used_count` increment scoped with an `EXISTS` subquery re-checking the just-updated booking row's status/timestamp match (an extra correctness belt against the coupon increment firing if the booking-status UPDATE in the *same batch* didn't actually change anything — though since both are in one D1 batch and D1 batches execute all-or-nothing, this EXISTS guard is arguably redundant given D1's documented batch semantics, but costs nothing and guards against a future refactor that splits the batch).

**`confirmCash`** — same `markConfirmed` path with `amountPaidCents: 0, paymentRef: null` — cash is collected out-of-band at the venue; this call only flips the booking to `confirmed`, no money moves through this system for a cash booking at all.

**`cancelBookingRow`** — a `d1.batch()` of: guarded `service_bookings` status→`cancelled` UPDATE, a guarded `service_booking_slots.current_bookings` decrement (floored at 0, gated by an `EXISTS` re-check against the just-cancelled row), and — **only if the booking was `confirmed` (not `pending`) and had a `couponId`** — a guarded `coupons.used_count` decrement. Note the asymmetry with `markConfirmed`'s coupon increment: cancelling a **`pending`** (unconfirmed, thus never-incremented) booking correctly does *not* decrement `used_count`, since it was never incremented in the first place — the `booking.status === CONFIRMED` check in the cancel path is exactly the mirror-image guard needed to avoid a spurious decrement/underflow. Voucher (`coupon_usage`) refund marking (as done for market-checkouts, §1) has **no equivalent here** — because service bookings never write a `coupon_usage` row to begin with.

**`transition`** (complete/no-show) — a plain Drizzle guarded UPDATE (not a raw batch, since there's no coupon side-effect on these transitions), requiring `status='confirmed'`.

### 8.4 Data

- **D1 tables** (`packages/database/src/schema/service-bookings.ts`): `service_bookings` (snapshots `serviceNameSnapshot`/`durationMinutesSnapshot`/`priceCentsSnapshot` at booking time so catalog edits never retroactively change an existing booking; all money fields `_cents` INTEGER — `priceCentsSnapshot`, `voucherDiscountCents`, `depositRequiredCents`, `balanceDueCents`, `amountDueCents`, `amountPaidCents`; **unique index on `confirmation_code`** — the anonymous-ownership credential for the public `/verify/:code*` routes; a `reminder_due` composite index on `(reminderScheduledAt, reminderSentAt, status)` for the cron-driven reminder scan), `service_booking_slots` (**unique index `(service_item_id, date, time_slot)`** — the capacity-cap row, upserted via `ON CONFLICT DO UPDATE` in `createSlot`), `service_booking_waitlist` (no capacity/payment fields — pure lead-capture, converted to a real booking presumably by out-of-band staff action calling `createBooking` directly, though no explicit "convert waitlist entry to booking" route/method was found in this pass — `convertedBookingId` exists as a column but nothing in this feature's routes/service sets it, flag for verification).
- **Cross-referenced**: `coupons` (`used_count` claim/release only, **no `coupon_usage` row** — by design), `credit_accounts`/`credit_ledger_entries` (via `CreditService`, §3), `restaurant_service_items` (the bookable catalog item, owned by a different feature not in this audit's scope), `employee_availability`, `users` (employee assignment).
- **No KV, R2, or queue usage** in this module. No Durable Object usage.
- **Events published**: `ServiceBookingNotificationService.send` (email/SMS via the shared `NotificationService`, categories `service_booking_{confirmed,cancelled,completed,no_show}`) — fired best-effort (caught/logged, never fails the parent operation) after every state transition. No cron in this module itself; the *reminder* send is presumably driven by an external/scheduled caller of `GET /reminders/due` + `POST /:id/reminder-sent` (no cron entry for service-booking reminders was found in `apps/api/src/index.ts`'s `scheduled()` handler in this pass — flag for verification; the due-reminders query and mark-sent mutation exist but nothing observed in this audit invokes them on a schedule).

### 8.5 Cross-module dependencies

- `credits` feature (`CreditService.spend`) — the 代幣 payment path.
- `coupons`/database-level `CouponService` (imported directly from `@makanmasak/database`, **not** the feature-layer `CouponsService`) — voucher pricing only (`validateCoupon`), redemption reimplemented locally via raw SQL against `coupons.used_count` (a third independent reimplementation of the same guarded-increment pattern seen in `market-checkouts` and the base `CouponService`, §4.6).
- No dependency on `payments`, `market-checkouts`, `billing`, or `subscriptions` — this module is self-contained apart from `credits` and `coupons`.

### 8.6 Rust rewrite notes

- **100% integer cents** — no float money fields anywhere in this module's schema or service.
- **Three independent hand-written copies of the coupon `used_count` guarded-increment/decrement SQL** exist across this codebase (base `CouponService`, `MarketCheckoutVoucherService`, `ServiceBookingService`) — this module's copy is the third; consolidate into one shared primitive in the Rust port (cross-referenced in §4.6 and §1.6 too, repeating here since it's directly visible in this file as `claimCouponUse`/`decrementCouponUse` private methods that, notably, appear **unused** by the actual call sites shown above (`markConfirmed`/`cancelBookingRow` inline their own raw SQL rather than calling these two private methods) — possible dead code / incomplete refactor, worth a direct diff check before porting.
- **Manual saga/compensation for recurring-booking rollback** (`rollbackRecurringBookings`) is the pattern to replicate for any multi-step, no-shared-transaction operation in the Rust port: reverse-order compensation, one step at a time, each step independently fault-tolerant (log-and-continue, never abort the rollback itself). This is the same shape as `market-checkouts`' voucher-reservation release-on-failure, just applied to a different resource (slot capacity + booking rows instead of coupon usage slots).
- **`d1.batch()` used for the two state-transition writes that have a coupon side-effect** (`markConfirmed`, `cancelBookingRow`) but **plain single-statement Drizzle UPDATE for the two that don't** (`transition` for complete/no-show) — a deliberate "batch only when there's more than one statement to make atomic" pattern, not batching-for-batching's-sake. Preserve this distinction in the Rust port rather than uniformly wrapping everything in a transaction primitive, to keep the code's signal of "this operation has exactly one atomic side-effect vs. two" legible.
- **Booking cancellation guards against the confirmed-vs-pending coupon-decrement asymmetry explicitly** (`booking.status === CONFIRMED` check before decrementing `used_count`) — a subtle but important invariant: `used_count` is incremented **only** at confirm-time (`markConfirmed`), never at create-time, so a `pending` booking that's cancelled before ever being paid/confirmed must **not** trigger a decrement (there was nothing to give back). Get this ordering exactly right in a Rust port — it's easy to accidentally increment at booking-creation time instead and then need a matching decrement-on-any-cancel, which would silently break the invariant for the never-confirmed case.
- **Unexplored/flagged for follow-up** (not confirmed dead vs. live in this pass, listed so a future agent doesn't have to re-derive it): (a) no code path found that converts a `service_booking_waitlist` row into a real booking despite `convertedBookingId`/`SERVICE_BOOKING_WAITLIST_STATUS.CONVERTED` existing in the schema/enum; (b) no cron entry found that drives `GET /reminders/due` on a schedule, despite the reminder-scheduling fields (`reminderScheduledAt`, `reminderMinutesBefore`) being fully modeled on the booking row.
- **Timestamps**: `_ms` INTEGER throughout (`confirmed_at_ms`, `completed_at_ms`, `cancelled_at_ms`, `no_show_at_ms`, `reminder_scheduled_at_ms`, `reminder_sent_at_ms`). **JSON**: none observed in this table's own schema (service catalog JSON like `availableHours` lives on `restaurant_service_items`, outside this audit's scope).
