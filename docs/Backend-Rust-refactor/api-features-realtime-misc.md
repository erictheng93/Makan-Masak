# `apps/api` — Realtime-adjacent & Misc Feature Modules

Source reviewed (non-test `.ts` files only): `apps/api/src/features/{realtime,sse,push,notifications,discovery,feedback,scheduling,leaves,manager}/**`, plus the `apps/api/src/app-factory.ts` mount table, the backing `packages/database/src/services/*Service.ts` implementations these routes delegate to, the `packages/database/migrations_fresh/0061_dish_search_fts5.sql` FTS5 migration, and `apps/api/src/index.ts` (queue/cron consumers). Cross-referenced against `docs/Backend-Rust-refactor/realtime.md` (the separate `apps/realtime` Durable Object worker) and `docs/Backend-Rust-refactor/shared-packages.md` — this document does **not** re-describe `apps/realtime` internals, only the `apps/api` side and the bridge into it.

All full paths below assume the `app-factory.ts` mount chain: `app.route("/api/v1", apiV1)` (app-factory.ts:696) and then the per-feature `apiV1.route("/<prefix>", ...)` calls (app-factory.ts:543-692).

| Feature dir | Mount prefix | Global middleware applied in app-factory.ts |
|---|---|---|
| `features/realtime` | `/api/v1/realtime` | none — public route registered at :550; every route applies its own (`authMiddleware`/`requireRole`) at the route level |
| `features/sse` | `/api/v1/sse` | none — routes self-gate (`sseAuthMiddleware` or `authMiddleware`) |
| `features/push` | `/api/v1/push` | none — both routes apply `authMiddleware` individually |
| `features/notifications` | `/api/v1/notifications` | `authMiddleware` (:620) |
| `features/discovery` | `/api/v1/discovery` | none — public GETs; `/index-status` and `/reindex` self-gate `authMiddleware` + `requireRole([0])` |
| `features/feedback` | `/api/v1/feedback` | `authMiddleware` (:618) + `moduleGate("analytics")` (:619) |
| `features/scheduling` | `/api/v1/scheduling` | `authMiddleware` (:612) + `moduleGate("staff_management")` (:613) |
| `features/leaves` | `/api/v1/leaves` | `authMiddleware` (:610) + `moduleGate("staff_management")` (:611) |
| `features/manager` | `/api/v1/manager` (actions) and `/api/v1/audit-logs` (audit read) | none — both self-gate per route |

Role numbers referenced below: `0` Admin, `1` Shop Owner, `2` Chef, `3` Service Crew, `4` Cashier, `5` Customer (`apps/api/src/shared/constants/index.ts:21-28`).

---

## 1. `features/realtime` — WebSocket auth broker

### Purpose

This module issues, verifies, and revokes the short-lived JWTs that authorize a client to open a WebSocket connection to the separate `apps/realtime` Durable-Object worker. It never holds a socket itself — it is purely a token-issuance/introspection API that the realtime worker's `RealtimeSession` DO trusts. It also proxies room statistics from that DO back through the main API so admin dashboards don't need a second base URL.

### Routes

| Method | Full path | Auth | Purpose | Request summary | Response summary |
|---|---|---|---|---|---|
| POST | `/api/v1/realtime/auth/token` | public route; the body's `sessionId` staff JWT is the credential | Issue a room-scoped WS token for **staff rooms only** | `{ roomType: kitchen\|admin\|restaurant, roomId, restaurantId, sessionId }` | `{ success, data: { token, expiresIn, wsUrl } }` |
| POST | `/api/v1/realtime/auth/guest-token` | public, rate-limited (10 req/60s per key `realtime_guest_token`) | Issue a guest (unauthenticated diner) WS token scoped to a table or order | `{ restaurantId, guestToken? \| (tableId+qrCode), orderId? }` | `{ success, data: { token, expiresAt, wsUrl } }` |
| POST | `/api/v1/realtime/auth/group-token` | public, rate-limited (10 req/60s per key `realtime_group_token`, plus the durable KV limiter) | Exchange a group order membership credential for a WS token scoped to that group order room | `{ groupOrderId, memberToken }` | `{ success, data: { token, expiresAt, wsUrl } }` |
| POST | `/api/v1/realtime/auth/verify` | public | Verify a token (and optional channel) — used by tests/tools, not by the realtime worker itself (it verifies inline) | `{ token, channel? }` | `{ success, data: { valid, payload } }` |
| POST | `/api/v1/realtime/auth/revoke` | role `0` (`authMiddleware` + `requireRole([0])`) | Blacklist one token (logout, breach, etc.) | `{ token, reason, revokedBy? }` | `{ success, data: { revoked, reason } }` |
| POST | `/api/v1/realtime/auth/revoke-user` | role `0` | Blacklist every tracked token for a user | `{ userId, reason, revokedBy? }` | `{ success, data: { userId, revokedCount, reason } }` |
| GET | `/api/v1/realtime/auth/blacklist/stats` | role `0` | KV-list sample of revoked-token records | — | `{ success, data: { available, estimatedCount, sampleRecords } }` |
| GET | `/api/v1/realtime/stats/:roomType/:roomId` | `authMiddleware`; role `0` bypasses ownership check, others must own `roomId===restaurantId` | Proxy a single room's live connection stats from the DO | — | `{ success, data: <DO /stats JSON> }` |
| GET | `/api/v1/realtime/stats/overview?restaurantId=` | same ownership rule as above | Aggregate stats across `kitchen`/`admin`/`customer` rooms for one restaurant | query `restaurantId` | `{ success, data: { restaurantId, totalConnections, roomStats[], health } }` |
| GET | `/api/v1/realtime/health` | public | Liveness probe of the `apps/realtime` worker via plain `fetch` to `REALTIME_SERVICE_URL` | — | `{ success, data: { status, realtimeService, ... } }` (always 200, even when degraded) |

Custom rate limit for `/api/v1/realtime/auth/token` is also set globally in `app-factory.ts` (20 req/60s, burst 2.0) — separate from the route-local guest-token limiter.

### Business logic

`RealtimeAuthService` (`apps/api/src/features/realtime/services/RealtimeAuthService.ts`):

1. **`generateWebSocketToken`** — branches on `roomType`:
   - `customer`: **rejected outright.** This endpoint has no session middleware, so it cannot verify a customer, and `roomId` was never bound to `tableId` — a caller who guessed any active table integer received a token valid for *any* `customer:*` room, including `customer:{groupOrderId}` whose events skip restaurant filtering (issue #96). Re-adding a "validate `tableId` and issue anyway" branch reopens the hole: a table ID is not a secret. Customer rooms come from `generateGuestToken` only.
   - `kitchen`/`admin`/`restaurant`: requires `sessionId` (the caller's existing app JWT) and `roomId === restaurantId`; calls `validateSessionAccess` to re-verify that JWT (signature, `TOKEN_BLACKLIST` KV check, expiry/nbf, role range 0-4, `canAccessRoomType` role gate, DB user lookup + `tokenVersion` match, `canAccessRestaurant` ownership).
   - Signs a new payload (`roomType, roomId, restaurantId, role, userId, publicUserId, appRole, exp, iat`) with `jsonwebtoken`'s `sign()`, 5-minute expiry, secret = `REALTIME_JWT_SECRET` or fallback `JWT_SECRET` (must be ≥32 chars or the service throws in the constructor).
   - Builds `wsUrl` as `${REALTIME_WS_URL}/${roomType}/${roomId}?token=${token}`.
2. **`generateGuestToken`** — for unauthenticated diners. Two paths: (a) an existing `guestToken` (format `gt_[0-9a-f]{64}`) looked up in `CACHE_KV` under `guest_token:<token>`, cross-checked against `orderId`/`restaurantId`; (b) a signed table QR code (`parseSignedQRUrl` + `verifyQRSignature` against `QR_SIGNING_KEY`), then DB lookups confirming the restaurant is active/available with `settings.allowGuestOrders===true`, the table is active and its `number` matches the QR payload identifier, and (if `orderId` supplied) the order belongs to that table. Token expiry is 15 minutes; payload sets `guestFlag: true` and, when order-scoped, `scope: "guest-realtime"`.
3. **`generateGroupOrderToken`** — for group order members. `memberToken` is `group_members.session_id`, handed to a member exactly once at create/join (it is deliberately absent from `formatMember`, which feeds member *listings*). Joins `group_members` to `group_orders` on `(groupOrderId, sessionId)` and requires the member to be active and not departed, the group to be `active`, and `expiresAt` to be in the future. Every rejection returns the same `"Invalid group order membership"` string so a caller probing group order IDs learns nothing. Token expiry 15 minutes; payload sets `guestFlag: true`, `scope: "group-order-realtime"`, `groupOrderId`, and `roomId` = the bare group order UUID (that is the room `RealtimeBroadcastService` fans group events to).
4. **`verifyWebSocketToken`** — checks the KV blacklist (SHA-256 token-id lookup via `TokenBlacklistService`), verifies JWT signature/expiry, and for guest tokens enforces that the room/scope/role combination matches one of three accepted shapes (order-scoped `guest-realtime`, legacy table-scoped, or `group-order-realtime` with `roomId === groupOrderId`).
5. **`verifyChannelAccess`** — for `scope==="guest-realtime"` tokens, requires the requested channel to equal `order:${orderId}` exactly; for `scope==="group-order-realtime"`, to equal `groupOrderId` exactly (prevents a token for one order/group being reused to subscribe to another channel).
6. **`revokeToken`/`revokeUserTokens`/`isTokenRevoked`/`getBlacklistStats`** — thin delegates to `TokenBlacklistService`.

`TokenBlacklistService` (`.../services/TokenBlacklistService.ts`): KV-backed. Token identity = `sha256:<base64url digest>` of the raw token string (not the JWT's `jti`, since these tokens carry no `jti`). Revocation record stored at `token:revoked:<tokenId>` with a TTL (default 300s, aligned to the 5-minute token lifetime) containing `{tokenId, revokedAt, reason, revokedBy?, metadata?}`. `revokeUserTokens` reads a per-user tracked-token-id list at `user:tokens:<userId>` (populated by `trackUserToken`, capped at the last 10, TTL 600s) and revokes them all in parallel; **`trackUserToken` is defined but never called from any route in this module** — nothing currently populates the per-user list outside tests, so `revoke-user` only revokes tokens some other, unseen code path chose to track. `getStats` does a KV `list()` (max 100 keys) and returns the first 5 as sample records — this is an approximation, not an exact count (KV has no native count).

### Data

- **D1 reads**: `tables`, `seats` joined to `tables`, `restaurants` (id/settings JSON/isActive/isAvailable), `orders` (id/restaurantId/tableId) — all from the guest-token path only — plus a raw `users` lookup (`id, username, role, restaurant_id, is_active, token_version`) inside `loadSessionUser`.
- **KV**: `CACHE_KV` for guest-token lookup (`guest_token:<token>`, written elsewhere — not in this module); `TOKEN_BLACKLIST` (or `CACHE_KV` fallback) for both the app-session blacklist check and the realtime-token blacklist (two different key prefixes: `token:<sessionId>` for app sessions vs. `token:revoked:sha256:<hash>` for realtime tokens).
- **No SQL tables owned by this module** — it is entirely a token/crypto layer over other features' tables.
- **DO bridge**: `fetchRealtimeRoomStats` calls `env.REALTIME_SESSION.idFromName(\`${roomType}:${roomId}\`)` then `durableObjectHandle.fetch("https://realtime-internal/stats")` — same DO addressing scheme (`roomType:roomId` name) used by the write-side bridge (see below), so stats and broadcast always target the same DO instance.

### Cross-module dependencies

- **Bridge into `apps/realtime` (event publishing path)**: the actual event-broadcast side is `RealtimeBroadcastService` in `packages/database/src/services/RealtimeBroadcastService.ts` (not in this feature dir, but this is the concrete mechanism the task asked to document). It is instantiated by `OrdersService`, `KitchenService`, and group-orders routes (`apps/api/src/features/{orders,kitchen,group-orders}/...`), **not** by anything in `features/realtime`. Mechanism: `env.REALTIME_SESSION.idFromName(\`${roomType}:${roomId}\`)` → `.get(id)` → `stub.fetch("https://realtime-internal/broadcast", { method: "POST", body: JSON.stringify(event) })`. `broadcastNewOrder/broadcastOrderStatusUpdate/broadcastOrderItemStatusUpdate/broadcastOrderCancelled/broadcastKitchenItemStatus` all fan out to **both** `restaurant:<restaurantId>` and `kitchen:<restaurantId>` rooms in parallel; `broadcastMenuAvailabilityUpdate` targets only `restaurant:<restaurantId>`. If `REALTIME_SESSION` is unbound (tests/local), it logs a warning and returns `success: true, recipientCount: 0` — broadcast failures never fail the originating order/kitchen mutation (best-effort fire-and-forget by design).
- The realtime worker's `RealtimeSession` DO independently re-verifies the JWT (`apps/realtime/src/utils/jwtVerifier.ts`) using the same `REALTIME_JWT_SECRET` — this module and that worker must stay in sync on the JWT shape (`RealtimeAuthPayload` in `@makanmasak/shared-types`) and secret.
- Depends on `@makanmasak/utils` (`parseSignedQRUrl`, `verifyQRSignature`) — the same QR signing scheme used by the tables/QR-codes feature.

### Rust rewrite notes

- JWT signing/verification (`jsonwebtoken` npm package, HS256 by default) maps directly to a Rust `jsonwebtoken` crate equivalent; watch for the `nbf`/`iat`/`tv` (token version) custom claim validation logic in `validateSessionAccess`, which is hand-rolled beyond what most JWT crates check automatically.
- The token-blacklist identity scheme (`sha256:` + base64url of the digest) is trivial to port with `sha2` + a base64url encoder; KV `expirationTtl` maps to whatever TTL mechanism the Rust target's KV client exposes (Cloudflare KV bindings via `worker-rs`, or an external cache).
- `TokenBlacklistService.trackUserToken` is currently dead code from this module's perspective — worth deciding in the rewrite whether to keep, wire it in, or drop `revoke-user`'s reliance on it.
- The DO stub-fetch pattern (`idFromName` + `stub.fetch(internal URL)`) is Workers-Durable-Object-specific; a Rust rewrite that keeps Durable Objects (via `worker-rs`) can port this 1:1, but a rewrite that moves off DOs entirely would need a different session/room registry (e.g. a KV or external pub-sub layer) and this module's "generate token, let the other service verify independently" pattern would need to change to match.
- `NODE_ENV` gates (`allowTokenOnlySessionValidation`) intentionally skip the DB user lookup in test/dev — do not carry this bypass into any production Rust binary path; gate it behind an explicit test-only feature flag instead.

---

## 2. `features/sse` — legacy compatibility shim (no live streaming)

### Purpose

This module is **not** an active SSE implementation. Every substantive endpoint returns HTTP 410 Gone pointing callers at the realtime WebSocket URL instead. It exists purely so old clients hitting the pre-WebSocket-migration SSE paths get a clear, typed redirect-away response rather than a 404, plus two trivial liveness/clock endpoints.

### Routes

| Method | Full path | Auth | Purpose | Request summary | Response summary |
|---|---|---|---|---|---|
| GET | `/api/v1/sse/events` | `sseAuthMiddleware` (bearer header or `?token=` query, checks `TOKEN_BLACKLIST`) | Legacy SSE stream — **retired** | — | 410 `{ success:false, error, data:{ realtimeWsUrl } }` |
| GET | `/api/v1/sse/connections` | `authMiddleware` | Legacy connection list — retired | — | 410 (same shape) |
| POST | `/api/v1/sse/test` | `authMiddleware` | Legacy test broadcast — retired | — | 410 |
| POST | `/api/v1/sse/broadcast/*` | `authMiddleware` | Legacy broadcast — retired | — | 410 |
| POST | `/api/v1/sse/notify/group` | `authMiddleware` | Legacy group notify — retired | — | 410 |
| GET | `/api/v1/sse/group/:groupOrderId/health` | `authMiddleware` | Legacy group health — retired | — | 410 |
| GET | `/api/v1/sse/group/:groupOrderId/sync` | `authMiddleware` | Legacy group sync — retired | — | 410 |
| GET | `/api/v1/sse/ping` | `authMiddleware` | Trivial liveness probe | — | `{ success:true, data:{ pong:true, timestamp, realtime:"websocket" } }` |
| GET | `/api/v1/sse/time` | `authMiddleware` | Server clock | — | `{ success:true, data:{ timestamp, iso } }` |

### Business logic

`sseAuthMiddleware` (local to this file, distinct from the kitchen feature's own copy of the same pattern) extracts a bearer token from `Authorization` or `?token=` (EventSource cannot set headers), checks `TOKEN_BLACKLIST` KV, verifies with `verifyJwtToken(token, JWT_SECRET)`, and sets `c.set("user", ...)`. Every "real" route handler is just `realtimeGone(c)`, which returns a constant 410 payload embedding `c.env.REALTIME_WS_URL` so the caller knows where to reconnect.

**Notable inconsistency worth flagging for the rewrite**: the global rate-limiter's `skipPaths` in `app-factory.ts:235` and the edge-cache middleware's `shouldCache`/`path.includes("/sse/")` exclusion both special-case `/api/v1/sse/events` / any `/sse/` path with a comment referencing "Kitchen SSE — long-lived stream, rate limiting would reject reconnects." But the actual long-lived kitchen SSE stream lives at `/api/v1/kitchen/:restaurantId/events` (a different feature, see `apps/api/src/features/kitchen/routes/index.ts:280`), not under `/api/v1/sse/*` — which, per this module, immediately 410s. The comment/skip-path appears stale from before the SSE→WebSocket migration; the actual kitchen SSE endpoint's own rate-limit/cache exemption is separate and not verified here.

### Data

None. No DB, KV, or queue usage in this module beyond the shared `TOKEN_BLACKLIST` check inside `sseAuthMiddleware`.

### Cross-module dependencies

- Reads `REALTIME_WS_URL` env var, same one used by `features/realtime`.
- The kitchen feature (`features/kitchen`) has its own, still-functional SSE endpoint (`GET /:restaurantId/events`) that emits only a "connected" event and heartbeats — real order/kitchen events flow through the realtime WebSocket via `RealtimeBroadcastService`, not through that SSE stream either. That endpoint is out of scope for this document but is the reason "SSE" still appears in rate-limit/cache config.

### Rust rewrite notes

- Nothing to port functionally beyond a static 410 responder — a Rust rewrite could collapse this whole module into a handful of route entries returning a fixed JSON body, or drop it entirely if legacy clients are confirmed gone.
- If any Rust-side worker needs genuine SSE streaming (unlike this dead module), Cloudflare Workers support `ReadableStream`-backed `text/event-stream` responses; `worker-rs` exposes streaming bodies, so a real SSE implementation is possible in Rust, but this module is not an example of one — the working example to study is the kitchen feature's heartbeat-only stream.

---

## 3. `features/push` — web-push subscription management (staff/admin)

### Purpose

Manages Web Push subscriptions for restaurant staff/admin clients (distinct from the customer-facing waiting-list push subscriptions, which live in `packages/database`'s `CustomerWebPushService`/`customer_push_subscriptions` table under the `customer`/`waiting-list` features). Stores subscriptions in KV and, via `RestaurantOrderPushService`, delivers "new order" notifications by invoking an injected VAPID delivery function.

### Routes

| Method | Full path | Auth | Purpose | Request summary | Response summary |
|---|---|---|---|---|---|
| POST | `/api/v1/push/subscribe` | `authMiddleware` (route-level, no global gate) | Register/update a browser push subscription for the current user | `{ subscription:{endpoint,keys:{p256dh,auth}}, user_type?, role?, restaurant_id?, device_info? }` (passthrough — extra fields tolerated) | `{ success, data:{ subscriptionId, subscribed, restaurantId, updatedAt } }` |
| POST | `/api/v1/push/unsubscribe` | `authMiddleware` | Remove a subscription by endpoint or subscriptionId | `{ endpoint?, subscriptionId?, restaurant_id? }` | `{ success, data:{ unsubscribed, subscriptionId, restaurantId, updatedAt } }` |

### Business logic

Route handlers (`apps/api/src/features/push/routes/index.ts`):

1. Resolve target `restaurantId` from the body or fall back to the authenticated user's own `restaurantId`.
2. `canWriteRestaurantScope` — role `0` (admin) or a `restaurantId===null` request bypasses the check; everyone else must have `user.restaurantId === restaurantId` (string-compared) or gets `403 PUSH_SUBSCRIPTION_FORBIDDEN`.
3. `subscriptionId` = SHA-256 hex digest of the subscription `endpoint` (via `crypto.subtle`, with a non-cryptographic FNV-1a fallback `fallbackHash` if `crypto.subtle` is unavailable — dead in the Workers runtime, present for portability/tests).
4. KV key shape: `push:subscription:<restaurantId-or-"global">:<userId>:<subscriptionId>` (restaurant segment URL-encoded). Subscribe upserts a JSON record (`{id, userId, username, userRole, requestedRole, userType, restaurantId, subscription, deviceInfo, createdAt, updatedAt}`) with a 1-year `expirationTtl`; unsubscribe deletes the same key.

`RestaurantOrderPushService` (`apps/api/src/features/push/services/RestaurantOrderPushService.ts`) — **not called from any route in this module**; it is the consumer-side service invoked directly by `OrdersService` only (market-checkouts reaches it transitively via `OrdersService.createOrder`, never directly) to actually push a "new order" notification:

1. `notifyNewOrder(input)` no-ops (`{attempted:0, delivered:0}`) if `env.WEB_PUSH_DELIVERER` is unset.
2. `listRestaurantSubscriptions` does a KV `list({prefix: "push:subscription:<restaurantId>:"})`, fetches each key, and filters to well-formed records matching the restaurant.
3. For each subscription, calls `env.WEB_PUSH_DELIVERER({subscription:{id,endpoint,p256dhKey,authKey}, payload})` in parallel (`Promise.all`). On `status 404` or `410` (subscription gone/expired per the Push API spec), deletes the KV record — self-pruning stale subscriptions.
4. `buildNewOrderPayload` differentiates `market_checkout`-sourced orders (Chinese title "市場結帳新訂單", `priority:"high"`, `requireInteraction:true`) from direct orders ("新訂單", normal priority).

**VAPID crypto is not implemented in this module.** `env.WEB_PUSH_DELIVERER` is a function-typed env binding (`apps/api/src/types/env.ts:146-154`) — the actual RFC 8291 (`aes128gcm`) message encryption + VAPID JWT signing (ECDSA P-256) lives in `packages/database/src/services/CustomerWebPushService.ts` (`deliverWithFetch`/`encryptPayload`/`createVapidToken`, using raw Web Crypto: ECDH key agreement, HKDF via HMAC-SHA256, AES-128-GCM). That implementation currently backs only the **customer** waiting-list push path (`sendWaitingCalled`), keyed off `WEB_PUSH_VAPID_PUBLIC_KEY`/`WEB_PUSH_VAPID_PRIVATE_KEY`/`WEB_PUSH_VAPID_SUBJECT`. `RestaurantOrderPushService` (the staff-side path documented in this module) never falls back to that VAPID implementation directly — it only ever calls the injected `WEB_PUSH_DELIVERER`, which in tests/integration is a hand-rolled stub (see `apps/api/src/__tests__/integration/market-checkouts.real.integration.test.ts:135` and `waiting-list-push.real.integration.test.ts:31`). Whether `WEB_PUSH_DELIVERER` is wired to the same `deliverWithFetch` VAPID codec in a real deployment, or is unset (silent no-op), is **not shown by the code in this feature dir** — flagged as ambiguous.

### Data

- **KV only** (`CACHE_KV`): `push:subscription:<restaurantId|global>:<userId>:<subscriptionId>` — no D1 tables owned by this module.
- No FTS5, no queue, no Durable Object usage.

### Cross-module dependencies

- `RestaurantOrderPushService` is instantiated only by `features/orders/services/OrdersService.ts` (market-checkouts orders flow through OrdersService and hence reach it transitively) to fire staff notifications after an order is placed.
- Shares the `WEB_PUSH_DELIVERER`/`WEB_PUSH_VAPID_*` env surface with `packages/database`'s `CustomerWebPushService` (customer/waiting-list push), but the two maintain **separate subscription stores** (KV for staff via this module, the `customer_push_subscriptions` D1 table for customers) and separate call sites.

### Rust rewrite notes

- The subscribe/unsubscribe handlers are a thin KV CRUD layer — trivial to port.
- The real crypto work for a Rust rewrite is RFC 8291 web-push encryption + VAPID (ES256 JWT): needs an ECDH P-256 key-agreement primitive, HKDF-SHA256, AES-128-GCM AEAD, and ECDSA P-256 signing — all available via `ring`, `p256`, or `aws-lc-rs` in Rust; this is the same shape already hand-rolled in `CustomerWebPushService.ts` using WebCrypto, so that file is the reference implementation to port, not anything in this feature dir.
- Decide explicitly in the rewrite whether staff push (this module) and customer push (`CustomerWebPushService`) should share one crypto/delivery implementation — today they're duplicated by injection point, and only the customer path has a fallback VAPID codec at all.
- 404/410-triggers-cleanup is a standard Push API convention worth preserving verbatim.

---

## 4. `features/notifications` — email/SMS test & manual-send endpoints

### Purpose

Thin admin-only HTTP surface over the shared `NotificationService` (`packages/database`), used to send a one-off test notification, list the available notification templates/categories, and manually trigger a notification to a specific recipient. It is a debugging/ops tool, not the primary notification-dispatch path — most notifications (leave/schedule/swap events) are sent by other services calling `NotificationService` directly (see §7/§8 below), not through this HTTP API.

### Routes

| Method | Full path | Auth | Purpose | Request summary | Response summary |
|---|---|---|---|---|---|
| POST | `/api/v1/notifications/test` | `authMiddleware` (global, :620) + `requireRole([0,1])` | Send a canned test email/SMS to a given address | `{ recipientEmail, category, type: "email"\|"sms" }` | `{ success, data:{ message, details } }` or 500 on provider failure |
| GET | `/api/v1/notifications/templates` | `authMiddleware` + `requireRole([0,1])` | List all 11 leave/schedule/swap template metadata entries + which providers are configured | — | `{ success, data:{ templates[], totalCount, supportedChannels, configuredProviders:{email,sms} } }` |
| POST | `/api/v1/notifications/send` | `authMiddleware` + `requireRole([0,1])` | Manually send a notification to a specific recipient | `{ recipientId, recipientEmail, category, type, data, priority?, recipientPhone? }` | `{ success, data:{ message, channel, category } }` or 500 |

### Business logic

- `/test` and `/templates` are role-gated to Admin/Owner only; `/templates` additionally reports `configuredProviders.email = resolveEmailProviderName(env) !== "noop"` (true exactly when the `NOTIFICATION_EMAIL` binding exists) and `.sms = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)`.
- `/send` additionally runs `validateNotificationRecipientScope`: Admin (`role===0`) bypasses; everyone else must have a `restaurantId` matching the recipient's `users.restaurant_id` (raw `DB.prepare` lookup, not Drizzle) **and** the caller-supplied `recipientEmail` must case-insensitively match the recipient's stored email, else `403`/`400`/`404` respectively.
- `NotificationService` (`packages/database/src/services/NotificationService.ts`) is the actual dispatch engine, constructed fresh per request from `env`:
  - **Email provider selection**: Cloudflare Email Service only — `createEmailProvider(env, from)` returns a `CloudflareEmailProvider` over the `NOTIFICATION_EMAIL` send_email binding, or `null` (email off) without it. MailChannels and Resend were both removed.
  - **SMS provider**: Twilio, only if all three of `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER` are set (Basic-Auth POST to the Twilio Messages REST endpoint).
  - **Templates**: a static `notificationTemplates` map keyed by `NotificationCategory` (28 categories spanning leave/schedule/swap/reservation/service-booking/waiting-list/verification flows — the route module only exposes 11 of these via `/templates`' hardcoded list, the rest are used internally by other features), each with an HTML `body` (or plain SMS text for the waiting-list/OTP categories) using `{{variable}}` placeholders and a minimal `{{#if var}}...{{/if}}` conditional-block renderer (regex-based, not a real template engine).
  - `sendNotification` renders subject+body, dispatches to the matching provider based on `payload.type`, and returns `{success, errors[]}` — errors are collected, not thrown, so a missing provider degrades to a soft failure rather than a 500 from inside the service (the route layer still surfaces it as HTTP 500 when `success:false`).
  - `sendTestNotification` bypasses templates entirely with a hardcoded test message.
  - **No persistence**: despite an exported `NotificationRecord` interface describing a DB-backed notification log (`status`, `sentAt`, `retryCount`, etc.), `NotificationService` never writes to any table — no notification history is stored by this service. (A separate `notification_dispatch_log` table exists in the schema but is used only by the unrelated `features/billing` module's `BillingNotificationService`, not by this one.)

### Data

- **D1**: only a raw `users` lookup (`restaurant_id, email`) inside `validateNotificationRecipientScope` — no writes.
- **No DB persistence of notifications themselves** (see above).
- **External calls**: Cloudflare Email Service (binding call, not `fetch`) and the SMS vendor's HTTP API — no queue/retry layer; a failed provider call is a one-shot failure surfaced to the caller.

### Cross-module dependencies

- `NotificationService` is the same class instantiated directly (bypassing this HTTP module) by `LeaveService` and `SchedulingService` (see §7/§8) to send `leave_request_*`/`schedule_*`/`swap_request_*` emails as side effects of their own mutations — this module's `/send` endpoint is a manual/admin escape hatch into the same engine, not the primary trigger path.
- Shares the `NOTIFICATION_EMAIL` binding and `NOTIFICATION_FROM_EMAIL` (and `TWILIO_*`) with the billing feature's separate notification path; both build their email provider through `createEmailProvider`.

### Rust rewrite notes

- The template renderer is a hand-rolled two-pass regex substitution (`{{var}}` replace, then `{{#if var}}...{{/if}}` block strip, then cleanup of any leftover `{{var}}`) — a Rust port should use a real template engine (e.g. `handlebars` crate) rather than reproduce the regex approach, since the current implementation does not escape HTML and does not support nested conditionals.
- Provider selection logic (MailChannels-by-default, Resend-fallback, Twilio-if-fully-configured) is simple env-driven branching — straightforward to port as a trait-based `EmailProvider`/`SmsProvider` pair.
- No retry/queue/backoff exists today; if the Rust rewrite wants delivery reliability, this is a gap to close deliberately rather than something to preserve.
- Decide whether to finally wire up notification-history persistence (the currently-unused `NotificationRecord` shape) during the rewrite, since none exists today for this service.

---

## 5. `features/discovery` — cross-restaurant dish/service/restaurant search

### Purpose

Public-facing search and browse API over a denormalized `dish_search_index` D1 table (kept in sync by a separate sync service, not searched directly against the live `menu_items`/`restaurants` tables), plus restaurant/service browsing and an admin-only reindex/index-status pair. This is the search backend for the customer-facing "discover restaurants near me" / cross-restaurant dish search experience, spanning both single restaurants and multi-vendor "markets".

### Routes

| Method | Full path | Auth | Purpose | Request summary | Response summary |
|---|---|---|---|---|---|
| GET | `/api/v1/discovery/index-status` | role `0` | Compare indexed vs. source-of-truth dish counts (freshness check) | — | `{ success, data:{ version, lastReindexedAt, indexedDishCount, availableDishCount, indexedRestaurantCount, sourceAvailableDishCount, unindexedAvailableDishCount, restaurantsWithUnindexedAvailableDishes } }` |
| GET | `/api/v1/discovery/search` | public | Dish/product full-text + filtered search | query: `q?, district?, city?, categoryName?, catalogType?, marketId?, marketSlug?, lat?, lng?, radiusKm?, priceMin?, priceMax?, openNow?, takeaway?, delivery?, sortBy?, page, limit` (at least one search-scope field required unless geo given) | `{ success, data:{ results[], total, page, limit, scope? } }` |
| GET | `/api/v1/discovery/categories` | public | Distinct category names matching filters | query subset of search filters | `{ success, data:{ categories[] } }` |
| GET | `/api/v1/discovery/services` | public | Search bookable/restaurant "service items" (not menu dishes) | query similar to `/search` plus `serviceType?` | `{ success, data:{ results[], total, page, limit, scope? } }` |
| GET | `/api/v1/discovery/service-types` | public | Facet counts of service types (respects `openNow` by post-filtering in JS) | query filters | `{ success, data:{ serviceTypes:[{serviceType,count}] } }` |
| GET | `/api/v1/discovery/restaurants` | public | Browse/filter restaurants (with KV-cached district browsing) | query filters incl. `cuisineType?, priceRange?` | `{ success, data:{ results[], total, page, limit } }` |
| GET | `/api/v1/discovery/restaurants/:id/takeaway-eligibility` | public | Whether a restaurant's shop-QR takeaway mode is currently usable | path `id` | `{ success, data:{ eligible, reason? \| shopQrCode } }` |
| GET | `/api/v1/discovery/restaurants/:id/markets` | public | Market memberships for a restaurant | path `id` | `{ success, data:{ memberships:[...] } }` |
| GET | `/api/v1/discovery/restaurants/:id/services` | public | Public service items for a restaurant | path `id` | `{ success, data:{ services:[...] } }` |
| GET | `/api/v1/discovery/restaurants/:id/menu` | public | Available menu items for a restaurant, grouped by visible/active categories | path `id` | `{ success, data:{ items:[...] } }` |
| GET | `/api/v1/discovery/popular` | public | Top-10 dishes by order count + top-10 restaurants + cached popular keywords | — | `{ success, data:{ keywords[], dishes[], restaurants[] } }` |
| POST | `/api/v1/discovery/reindex` | role `0` | Full rebuild of `dish_search_index`, KV tag index, and semantic (vector) index | — | `{ success, data:{ dishes, restaurants, semanticDishes, duration_ms } }` |

### Business logic

**Read path (`DiscoveryService`, `apps/api/src/features/discovery/services/DiscoveryService.ts`, 2306 lines):**

1. `createDiscoveryRead(env, {waitUntil})` (the factory used by every read route **except** `GET /index-status`, which deliberately constructs `new DiscoveryService(c.env.DB, c.env.CACHE_KV)` pinned to the primary for an admin freshness check — `discovery/routes/index.ts:22-29`) builds the service with `sessionConstraint="first-unconstrained"`, which calls `d1.withSession("first-unconstrained")` so read queries can be served by a D1 read replica once regional replication is enabled in the Cloudflare dashboard (currently a no-op until that's turned on) — so the actual split is three-way: replica-eligible reads / the primary-pinned `index-status` read / the `reindex` write path, which also constructs `DiscoveryService` directly and stays on the primary.
2. `searchDishes`: resolves `marketSlug`→`marketId`, checks a KV cache (`search:query:*`, keyed by every filter + a monotonically-bumped `search:query:version` counter, 15-min TTL), then builds a Drizzle query against `dish_search_index` joined to `restaurants`/`menu_items`. Text matching combines: (a) an FTS5 trigram substring `MATCH` sub-select (see Data section) for queries ≥3 characters, (b) a normalized-prefix `LIKE` on `dish_name_normalized`, (c) plain `LIKE` on tags/category/district/restaurant name/city/district, (d) catalog-alias expansion (`getCatalogQueryAliases`, e.g. mapping "商品"/"product" synonyms), (e) a KV-backed tag index (`search:tags:index`, built at reindex time, mapping normalized tag→menuItemIds) merged in as extra candidates up to 50, and (f) semantic (vector) search results (see below) added as an `inArray` condition, capped at 50 ids. When `openNow`/geo-radius/`sortBy∈{open_now,distance}` filters are present, the query switches to "post-filter pagination" mode: it over-fetches up to `POST_FILTER_SCAN_LIMIT=50000` rows unpaginated, filters/sorts in JS, then slices the page — because open-now/distance can't be expressed as a SQL `WHERE`/`ORDER BY` against denormalized business-hours JSON and haversine distance. Geo filtering pre-narrows via a lat/lng bounding box (`boundingBoxFromCircle`) in SQL, then does exact haversine (`distanceKm`) filtering in JS.
3. `searchServices`/`listServiceTypes`/`browseRestaurants` follow the same shape (conditions builder → Drizzle select + count → JS post-filter for geo/openNow → optional KV caching) against `restaurant_service_items` or `restaurants` respectively. `browseRestaurants` has a dedicated KV cache for the common "browse by district, no other filters, page 1" case (`search:restaurants:district:<district>`, 30-min TTL).
4. `isOpenNow` (`utils/isOpenNow.ts`) converts the Worker's UTC clock to `Asia/Taipei` via `Intl.DateTimeFormat`, looks up the matching weekday key in the restaurant's `businessHours` JSON, and does a string-compare `HH:MM` range check — timezone is hardcoded to Taipei by default (parameterizable but never overridden by callers in this module).
5. **Market-vendor context**: for any market-scoped search, results are annotated with a per-row correlated sub-select (`marketVendorMarketId`/`StallNumber`/`LocationLabel`/`IsPrimary`/`MarketSlug`/`MarketName`) joining `restaurant_market_memberships`↔`markets`, preferring the primary membership when `marketId` isn't specified.
6. `getTakeawayEligibility`: `false` unless the restaurant is active+not-deleted, `supportsTakeaway && enableShopMode && shopQrCode` are all set, and `isOpenNow` is true right now.

**Write path — `reindex()`**: full-table rebuild, not incremental. Selects every menu item (with category/restaurant join, plus correlated sub-selects computing `marketIds`/`primaryMarketId` JSON via `restaurant_market_memberships`), computes `isAvailable` in JS (item available AND category active/visible/not-deleted AND restaurant not deleted), normalizes the dish name (`trim().toLowerCase().replace(/\s+/g," ")`... actually strips all whitespace, not just collapsing it — `replace(/\s+/g, "")`), and batch-`INSERT OR REPLACE`s into `dish_search_index` via raw `D1PreparedStatement`s in batches of 100 (Drizzle's `.batch()` doesn't support the same batching semantics as native D1 batch, per the code comment). Deletes then reloads the whole table (`this.db.delete(dishSearchIndex)` before the batched inserts, then a follow-up delete of any now-orphaned rows), rebuilds the KV tag index, upserts semantic-search vectors in chunks of 50, and bumps the search-version KV key (invalidating all query caches).

**Incremental sync — `SearchIndexSyncService`** (`apps/api/src/features/discovery/services/SearchIndexSyncService.ts`) is the *actual* steady-state keeper of `dish_search_index`; `reindex()` above is a full-rebuild escape hatch, not the normal path:
- `onMenuItemChanged(menuItemId)`: re-derives one row's `isAvailable`/tags/market fields and `INSERT ... ON CONFLICT(menuItemId) DO UPDATE`s it (or deletes the index row if the source menu item no longer exists), then bumps the search version.
- `onRestaurantChanged(restaurantId, {previousDistrict?})`: bulk-updates every index row for that restaurant (district/type/takeaway/delivery/market fields, or just flips `isAvailable=false` if the restaurant itself is now inactive/deleted), invalidates the district-browse KV cache for both the old and new district, bumps version.
- `onCategoryChanged(categoryId)` / `onMarketChanged(marketId)`: **fan-out** operations — a category or market can touch hundreds of menu items/restaurants. When a `Queue` binding (`SEARCH_SYNC_QUEUE`) is configured, these enqueue one `{type:"menuItem"|"restaurant", ...}` message per affected entity (batched at ≤100 messages per `sendBatch` call, Cloudflare Queues' hard limit) instead of processing inline, explicitly to stay under D1's 1000-subrequest-per-Worker-invocation cap. Without a queue (tests, or the queue consumer itself, which intentionally constructs the service **without** a queue to avoid re-enqueue loops), they fall back to sequential/parallel inline processing.
- The Worker's top-level `queue()` handler (`apps/api/src/index.ts:18-42`) is the consumer: for each message, dynamically imports `SearchIndexSyncService`, constructs it without a queue, calls `processMessage(body)` (which only ever calls the bounded single-entity handlers — never re-enqueues), `ack()`s on success or `retry()`s on thrown error.
- Every mutation bumps both `search:query:version` (discovery's own cache-buster) and a **separate** `markets:version` KV counter (`bumpMarketPublicCacheVersion`) — used by the markets feature's own public-facing caches, a cross-feature side effect worth knowing about.

**Semantic (vector) search — `SemanticDiscoveryService`** (`apps/api/src/features/discovery/services/SemanticDiscoveryService.ts`): optional layer, no-ops entirely if `AI`/`DISCOVERY_VECTORIZE` bindings are absent.
- Embeddings generated via Workers AI (`env.AI.run(model, {text})`, default model `@cf/baai/bge-m3`), cached in KV keyed by `semantic:embedding:sha256(model\0normalizedQuery)` for 7 days by default.
- `searchDishIdsWithStatus` supports `embeddingMode: "cache-only"` (used by the live `/search` route, to avoid paying embedding-generation latency on every request) vs `"generate"` (used nowhere in this dir currently, available for future/offline callers). On a cache-miss during a live search, `warmQueryEmbedding` fires an async, non-blocking embedding generation via `c.executionCtx.waitUntil` so the *next* identical query hits the cache — the current request proceeds without semantic results.
- `upsertDishes` (called from `reindex()`) embeds dish text (`dishName + categoryName + tags`, via `semanticDishText`, not shown above but referenced) in batches of 50 and upserts into the Vectorize index under namespace `"dishes"`, vector id `dish:<menuItemId>`.

### Data

- **Primary table**: `dish_search_index` (`packages/database/src/schema/discovery.ts`) — denormalized copy of searchable dish/product attributes (`menu_item_id` unique, `restaurant_id`, `dish_name`/`dish_name_normalized`, `category_name`, `price_cents`, `catalog_type` (`menu_item`|`product`), `is_available`, `tags` JSON, `district`, `restaurant_type`, `supports_takeaway`/`supports_delivery`, `primary_market_id`, `market_ids` JSON, `latitude`/`longitude`, `updated_at_ms`). Six covering indexes on `(field, is_available)` pairs plus the menu-item unique index.
- **FTS5 virtual table**: `dish_search_fts` (`packages/database/migrations_fresh/0061_dish_search_fts5.sql`) — `CREATE VIRTUAL TABLE ... USING fts5(dish_name, category_name, tags, content='dish_search_index', content_rowid='id', tokenize='trigram')`. This is an **external-content** FTS5 table (no independent copy of the text, reads through to `dish_search_index`), kept in sync purely by three SQL triggers (`_ai`/`_ad`/`_au` on INSERT/DELETE/UPDATE of `dish_search_index`) — `SearchIndexSyncService`'s existing delete/insert/upsert calls maintain the FTS index "for free," no application code touches `dish_search_fts` directly except the read-side `MATCH` query. The `trigram` tokenizer gives true CJK substring matching (e.g. "牛肉麵" matches inside "蕃茄牛肉麵"), which prefix-only `LIKE` cannot do; the tradeoff is `MATCH` only works for queries ≥3 characters (`DiscoveryService.ftsMatchCondition` gates on `[...term].length < 3` and returns `undefined` below that, so 1-2 character queries fall back to `LIKE` only, unicode-codepoint-aware via spread).
- **KV** (`CACHE_KV`): `search:query:version` (cache-buster counter), `search:last_reindexed_at`, `search:query:*` (per-filter-combo cached responses, 15 min), `search:categories:*` (15 min), `search:restaurants:district:<district>` (30 min), `search:tags:index` (normalized-tag→menuItemId[] map, 30 min), `search:meta:popular-keywords` (read by `/popular`, written elsewhere — not in this module), `semantic:embedding:<hash>` (7 days), plus the shared `markets:version` counter.
- **Queue**: `SEARCH_SYNC_QUEUE` (optional binding) carrying `SearchSyncMessage = {type:"restaurant", restaurantId} | {type:"menuItem", menuItemId}`.
- **Vectorize**: `DISCOVERY_VECTORIZE` index, namespace `"dishes"`, vector ids `dish:<menuItemId>`.
- **Workers AI**: `AI` binding, model configurable via `DISCOVERY_EMBEDDING_MODEL`.
- **Reads (not writes)**: `restaurants`, `menu_items`, `categories`, `restaurant_market_memberships`, `markets`, `restaurant_service_items`.

### Cross-module dependencies

- `SearchIndexSyncService` is invoked from **outside** this feature directory: `features/menu/routes/index.ts` (on menu-item and category changes), `features/restaurants/routes/index.ts` (on restaurant changes), and `features/markets/routes/admin.ts` (on market/membership changes) — discovery is a downstream consumer of mutations owned by three other features, not a module that mutates its own source data.
- Shares the `markets:version` KV counter with the markets feature's public caches.
- Uses `packages/database`'s `RealtimeBroadcastService`-adjacent infra only indirectly (none directly) — no realtime coupling.
- `boundingBoxFromCircle`/`distanceKm` geo helpers are imported from `features/markets/services/geo` — a direct intra-repo dependency on another feature's utility module.

### Rust rewrite notes

- **FTS5 trigram is SQLite/D1-specific but portable**: the `content=` external-content table + trigger-maintained-index pattern is standard SQLite FTS5, so it survives a Rust rewrite as long as the target stays on D1/SQLite; the `MATCH` query syntax (`dish_search_fts MATCH ?` returning `rowid`) and the FTS string-literal escaping (doubling embedded `"` before wrapping the whole term in `"..."`, to force phrase semantics rather than letting user input hit FTS5 query-operator syntax) must be replicated exactly — any Rust SQLite/D1 driver that supports raw SQL can issue the same query. If the rewrite ever moves off SQLite (e.g. to Postgres), trigram FTS as configured here has no direct equivalent and would need `pg_trgm` or an external search engine (Meilisearch/Typesense/Elasticsearch) as a replacement — a materially different design, not a drop-in port.
- The dual-write "index table + FTS shadow table via triggers" means a Rust rewrite must either keep D1 SQL triggers as-is (they're DB-level, language-agnostic) or move the sync responsibility into application code if triggers aren't available on the target datastore.
- JSON columns (`tags`, `market_ids`) are stored as TEXT and JSON-(de)serialized in application code (Drizzle's `{mode:"json"}` sugar) — a Rust ORM/query layer needs the same manual `serde_json` (de)serialize step; there's no native JSON column type enforcement at the SQL layer.
- Timestamp convention matches repo-wide standard: `updated_at_ms` INTEGER unix-ms (`{mode:"timestamp_ms"}`), safe to carry forward unchanged.
- The `first-unconstrained` D1 Session read-replica hook is currently a no-op (replication not yet enabled) — decide during the rewrite whether the target datastore's read-replica story requires an equivalent seam, or whether it can be simplified away.
- The semantic-search layer (Workers AI + Vectorize) is entirely optional/best-effort in the current code (every failure path returns empty matches, never throws) — a Rust rewrite could treat this as an optional feature flag rather than a hard dependency, matching current production behavior.
- Post-filter-pagination-by-overfetching (`POST_FILTER_SCAN_LIMIT=50000`) for geo/open-now queries is a known scaling limitation already, not something introduced by the rewrite — worth flagging to whoever owns the Rust port as pre-existing tech debt rather than a regression to fix silently.

---

## 6. `features/feedback` — in-app shop feedback / support tickets

### Purpose

Lets shop owners (role `1`) file bug reports/feature requests/support tickets against their own restaurant, lets admins (role `0`) triage all tickets across restaurants, and supports a threaded response/notes system (with admin-only "internal" notes hidden from owners). Also exposes an offline-client "batch sync" endpoint that is a KV write-behind buffer, not a feedback-creation path.

### Routes

| Method | Full path | Auth | Purpose | Request summary | Response summary |
|---|---|---|---|---|---|
| POST | `/api/v1/feedback` | `authMiddleware` (global) + `requireRole([1])` | Owner submits new feedback for their own restaurant | `{ category, priority?, relatedModule?, subject, description, attachmentUrls? }` | `201 { success, data: feedback }` |
| POST | `/api/v1/feedback/batch-sync` | `authMiddleware` | Store an arbitrary client payload snapshot in KV (offline-queue sync, not DB writes) | any JSON body (passthrough) | `{ success, data:{ syncId, synced, itemCount, restaurantId, syncedAt } }` |
| GET | `/api/v1/feedback/stats` | role `0` | Global feedback counts by status/category/priority + avg resolution time | — | `{ success, data: FeedbackStats }` |
| GET | `/api/v1/feedback` | role `0` or `1` | List feedback (owners see only their own; admin can filter by `restaurantId`) | query: `category?, status?, priority?, relatedModule?, search?, restaurantId? (admin only), page, limit` | `{ success, feedback:[...], pagination }` |
| GET | `/api/v1/feedback/:id` | role `0` or `1` (owner must own the record) | Fetch one feedback ticket + its responses (internal notes stripped for non-admins) | path `id` | `{ success, data: feedback+responses }` |
| PUT | `/api/v1/feedback/:id/status` | role `0` only | Change ticket status (auto-stamps `resolvedBy`/`resolvedAt` when moving to `resolved`) | `{ status }` | `{ success, data, message }` |
| PATCH | `/api/v1/feedback/:id` | role `0` or `1` (owner limited to own, `open`-status records) | Edit ticket fields | partial create-schema | `{ success, data }` or 404 if not editable |
| DELETE | `/api/v1/feedback/:id` | role `0` or `1` (owner limited to own, `open`-status) | Delete a ticket (and its responses) | — | `{ success:true }` or 404 |
| POST | `/api/v1/feedback/:id/responses` | role `0` or `1` (owner must own) | Add a threaded response; only admins may mark `isInternal` | `{ message, isInternal? }` | `201 { success, data }` |
| PUT | `/api/v1/feedback/:id/responses/:responseId` | role `0` or `1` | Edit a response (non-admin limited to their own response) | `{ message }` | `{ success, data }` or 404 |
| DELETE | `/api/v1/feedback/:id/responses/:responseId` | role `0` or `1` | Delete a response (non-admin limited to their own) | — | `{ success:true }` or 404 |

### Business logic

- `assertOwnerAccess` — every owner-scoped route re-fetches the feedback row and 403s (`FEEDBACK_ACCESS_DENIED`) if `user.role===1 && feedback.userId !== user.id`; admins always pass.
- `GET /:id` strips `responses.filter(r => !r.isInternal)` for non-admins after fetch — internal notes are fetched then filtered in the route layer, not excluded at the DB query level for this endpoint (though `FeedbackService.getFeedbackById` always joins `isAdmin=true` for the full set, and the separate `getResponses(feedbackId, isAdmin)` helper *does* filter at the query level when called with `isAdmin=false` — the two code paths differ).
- `PATCH`/`DELETE` restrict non-admins to `status==="open"` records only (enforced in the SQL `WHERE`, e.g. `and(eq(id,x), eq(userId,y), eq(status,"open"))`) — once a ticket moves past `open`, only an admin can edit/delete it.
- `updateFeedbackStatus` stamps `resolvedAt`/`resolvedBy` only when the new status is `"resolved"` and a `resolvedBy` was passed (route only passes it in that case).
- `deleteFeedback` uses a D1 **batch** (`this.db.batch([...])`) to delete child `feedback_responses` rows (via a correlated `IN (SELECT id FROM shop_feedback WHERE <authorized filter>)` subquery) and the parent row together — a manual cascade, since there's no DB-level `ON DELETE CASCADE` FK shown in the schema.
- `addResponse` also batches: bump the parent ticket's `updatedAt` + insert the response row, in one D1 batch call.
- `getFeedbackStats` computes `avgResolutionTimeMs` via `AVG(resolvedAt - createdAt)` directly in SQL (both are `timestamp_ms` integer columns, so the subtraction is already in milliseconds) — filtered to `resolvedAt IS NOT NULL` rows only.
- `/batch-sync` is a **separate, disconnected mechanism** from the `shop_feedback` table: it takes any JSON body, derives a `syncId` from `payload.sync_id` if present (else the current timestamp), and writes two KV keys — `feedback:batch-sync:<restaurantId|global>:<userId>:<syncId>` and a `:latest` alias — with a 30-day TTL. It never inserts into `shop_feedback`. This reads as an offline-client "last known state" snapshot store rather than a feedback-creation mechanism; whether any code elsewhere later drains these KV snapshots into real feedback rows is **not present in this feature directory** — flagged as ambiguous/likely-incomplete.

### Data

- **Tables** (`packages/database/src/schema/feedback.ts`): `shop_feedback` (id, restaurant_id, user_id, category ∈ {bug_report,feature_request,usability,performance,billing,other}, priority ∈ {low,medium,high,urgent} default medium, status ∈ {open,in_progress,resolved,closed} default open, related_module ∈ {menu,orders,pos,tables,reservations,scheduling,analytics,settings,integrations,other} default other, subject, description, attachment_urls TEXT-JSON, created/updated/resolved_at_ms, resolved_by) and `feedback_responses` (id, feedback_id, user_id, message, is_internal, created_at_ms). Seven indexes on `shop_feedback` (restaurant, user, status, category, createdAt, and two composite restaurant+status / category+status), one on `feedback_responses.feedback_id`.
- **KV** (`CACHE_KV`): `feedback:batch-sync:<scope>:<userId>:<syncId|latest>` (30-day TTL) — entirely separate from the D1 tables above.
- No FTS5, no queue, no DO usage.

### Cross-module dependencies

- None beyond the shared `users`/`restaurants` FK relations (for join-enrichment of feedback rows with submitter/restaurant display info).
- Gated behind `moduleGate("analytics")` at the app-factory level, i.e. tenants without the "analytics" module entitlement can't reach any `/feedback/*` route regardless of role.

### Rust rewrite notes

- Straightforward CRUD + role-scoped row filtering — no unusual crypto/streaming/FTS surface here, a good candidate for an early/simple Rust port.
- The manual "batch delete via correlated subquery in a D1 `.batch()`" pattern for cascading deletes should probably become either a real `ON DELETE CASCADE` FK or an explicit multi-statement transaction in whatever the rewrite's DB layer is — currently it's neither declared as a DB constraint nor wrapped in `db.transaction()`, just two statements sent together in one D1 batch call (D1 batches are atomic, so this is safe today, but it's implicit).
- `AVG(resolvedAt - createdAt)` on `timestamp_ms` integer columns ports directly to any SQL engine; keep the "already milliseconds" unit convention.
- Decide what to do with `/batch-sync` before porting — as documented, it's a dead-end KV write with no drain-back path visible in this codebase; either find the consumer elsewhere in the repo, treat it as intentionally client-only ephemeral state, or drop it.
- The internal-note-filtering inconsistency (`GET /:id` filters in the route layer; `getResponses` filters in the service layer when told to) should be unified to one enforcement point during the rewrite to avoid a future endpoint accidentally leaking internal notes by calling the wrong code path.

---

## 7. `features/scheduling` — employee shift scheduling, clock-in/out, conflict detection

### Purpose

Full shift-scheduling system for restaurant staff: shift templates, individual/bulk schedule creation, clock-in/clock-out with overtime computation, a rule-based conflict-detection engine modeled on Taiwan's Labor Standards Act, shift-swap request workflow, and daily/weekly reporting (including CSV export). Integrates with the leaves feature so approved leave auto-cancels conflicting schedules.

### Routes

All paths below are relative to `/api/v1/scheduling`; every route requires `authMiddleware` (global) + `moduleGate("staff_management")` (global); role/ownership notes are per-row below.

| Method | Full path | Auth | Purpose | Request/Response summary |
|---|---|---|---|---|
| GET | `/:restaurantId/templates` | role `0`/`1` + `requireRestaurantAccess` | List shift templates | → `ShiftTemplate[]` |
| GET | `/templates/:id` | role `0`/`1` | Get one shift template | 404 if missing |
| POST | `/:restaurantId/templates` | role `0`/`1` + restaurant access | Create shift template | body: name/times/duration/break/min-max employees/hourlyRate/overtimeMultiplier/color/icon/etc. |
| PUT | `/templates/:id` | role `0`/`1` | Update shift template | partial body |
| DELETE | `/templates/:id` | role `0`/`1` | Soft-delete (`isActive=false`) | 404 if missing |
| GET | `/:restaurantId/schedules` | any authenticated + restaurant access | List schedules (non-managers forced to `employeeId=self`) | query filters + pagination |
| GET | `/schedules/:id` | any authenticated (ownership enforced) | Get one schedule | 403 if not own and not manager |
| POST | `/:restaurantId/schedules` | role `0`/`1` + restaurant access | Create one schedule (runs full conflict check first, throws on any conflict) | body incl. `employeeId, workDate, startTime, endTime, scheduledHours` |
| POST | `/:restaurantId/schedules/bulk` | role `0`/`1` + restaurant access | Bulk-create from a template across a date range + day-of-week filter (≤50 employees) | → `{ count }` |
| PUT | `/schedules/:id` | role `0`/`1` | Update a schedule | partial body |
| DELETE | `/schedules/:id` | role `0`/`1` | Cancel (soft-delete, `status="cancelled"`) | 404 if missing |
| POST | `/schedules/:id/clock-in` | any authenticated (self, unless manager) | Employee clocks in | `{ employeeId, notes? }`, 403 if not self and not manager |
| POST | `/schedules/:id/clock-out` | any authenticated (self, unless manager) | Employee clocks out, computes `actualHours`/`overtimeHours` | same shape |
| GET | `/:restaurantId/clocked-in` | role `0`/`1` + restaurant access | Currently-clocked-in employees | — |
| GET | `/:restaurantId/attendance-report` | role `0`/`1` + restaurant access | Attendance summary for a date range | query `startDate, endDate, employeeId?` |
| GET | `/:restaurantId/attendance-report/export` | role `0`/`1` + restaurant access | Same report, as CSV download | `Content-Disposition: attachment` |
| POST | `/schedules/:id/admin-clock-in` | role `0`/`1` | Manager clocks in on an employee's behalf | `{ notes? }` |
| POST | `/schedules/:id/admin-clock-out` | role `0`/`1` | Manager clocks out on an employee's behalf | `{ notes? }` |
| POST | `/:restaurantId/swap-requests` | any authenticated + restaurant access | Create a swap/cover/drop request | `{ requesterEmployeeId, requesterScheduleId, targetEmployeeId?, targetScheduleId?, requestType, reason, urgency?, isOpenRequest?, expiresAt? }` |
| GET | `/:restaurantId/swap-requests` | any authenticated + restaurant access (non-managers forced to own requests) | List swap requests | query filters |
| POST | `/swap-requests/:id/accept` | any authenticated (self, unless manager) | Employee accepts an open/targeted swap | `{ employeeId }` |
| POST | `/swap-requests/:id/approve` | role `0`/`1` | Manager approves a swap (**does not actually swap employees on the schedule rows** — see below) | `{ managerId }` |
| POST | `/swap-requests/:id/reject` | role `0`/`1` | Manager rejects | `{ managerId, reason }` |
| POST | `/swap-requests/:id/cancel` | any authenticated | Requester cancels their own request | — |
| GET | `/:restaurantId/available-employees` | role `0`/`1` + restaurant access | Active employees not on leave and not already scheduled for a date | query `date, shiftTemplateId?` |
| GET | `/:restaurantId/conflicts` | role `0`/`1` + restaurant access | List detected scheduling conflicts | query filters + pagination |
| GET | `/conflicts/:id` | role `0`/`1` | Get one conflict | 404 if missing |
| POST | `/conflicts/:id/resolve` | role `0`/`1` | Mark a conflict resolved with notes | `{ userId, resolutionNotes }` |
| GET | `/:restaurantId/stats/daily` | role `0`/`1` + restaurant access | Daily aggregate stats (status/shift-type breakdown, clock metrics) | query `date` |
| GET | `/:restaurantId/stats/weekly` | role `0`/`1` + restaurant access | Weekly aggregate + daily breakdown | query `weekStartDate` |

### Business logic

`SchedulingService` (`packages/database/src/services/SchedulingService.ts`, 2032 lines):

- **Conflict-detection engine** (`checkScheduleConflicts`, run before every single-schedule create): runs five independent checks in sequence and aggregates into `{hasConflicts, conflicts[], warnings[], info[]}`:
  1. `checkOverlappingShifts` — any non-cancelled schedule the same employee already has that day, with overlapping `HH:MM` ranges (`timesOverlap` handles overnight shifts by adding 24h to the end time when `end <= start`) → **error**, blocks creation.
  2. `checkRestPeriod` — compares against the *previous calendar day's* schedules; if the gap between yesterday's end time and today's start time is `< 11` hours → **error**. (`calculateRestHours` also handles the overnight-wrap case.)
  3. `checkDailyHours` — sums that employee's scheduled hours for the day (excluding cancelled) plus the new shift; `> 12` → **warning** (not blocking).
  4. `checkWeeklyHours` — sums scheduled hours for the Sun-Sat week containing `workDate`; `> 46` → **warning**.
  5. `checkConsecutiveDays` — walks backward day-by-day (max 7 lookback) counting unbroken worked days including the new one; `> 6` → **warning**.
  6. `checkLeaveConflict` — any `approved` leave request spanning `workDate` → **error**.
  - Only `conflicts` (errors) block `createSchedule` (it throws, joining all conflict messages with `"; "`); `warnings` are computed but not enforced anywhere in this file.
  - **`bulkCreateSchedules` re-implements a subset of this logic itself** rather than calling `checkScheduleConflicts` per row: it pre-fetches all schedules in a `[start-7d, end+1d]` window and all approved leaves overlapping the date range in two queries, then does in-process overlap/leave-conflict detection per generated schedule and **writes conflict rows to `scheduling_conflicts` instead of blocking creation** — i.e. bulk-create schedules through conflicts and record them for later review, whereas single-create hard-blocks on the same conflict types. This is an intentional-looking but easy-to-miss asymmetry between the two creation paths.
- **Clock-in/out**: `clockIn` rejects if already clocked in or if `!isAdmin && schedule.employeeId !== data.employeeId`; sets `status="confirmed"`. `clockOut` rejects if not yet clocked in or already clocked out; computes `actualHours = (clockOut - clockIn) / 3.6e6` and `overtimeHours = max(0, actualHours - scheduledHours)`, sets `status="completed"`.
- **Swap requests are "simplified"** (the code's own section comment): `createSwapRequest` just inserts a `pending` row and notifies the target employee (if any); `acceptSwapRequest` flips status to `accepted`; `approveSwapRequest` flips status to `approved` and sends notifications to requester + target — **it does not modify `employee_schedules.employee_id` on either schedule**, i.e. approving a swap does not actually reassign who is on the shift in the schedule data model. Any actual reassignment must happen through a separate manual schedule update — not automated by this service.
- **Notifications**: every schedule create/update/cancel and every swap create/approve/reject fires a best-effort `NotificationService.sendNotification` call (email only, category ∈ `schedule_created/updated/cancelled`, `swap_request_created/approved/rejected`) — wrapped in try/catch, logged on failure, never fails the mutation.
- **Leave integration**: `cancelSchedulesByDateRange(employeeId, startDate, endDate, reason, cancelledBy)` bulk-cancels (soft, `status="cancelled"`) every non-cancelled schedule for an employee in a date range and returns the affected schedule ids — called by `LeaveService.approveLeaveRequest` (see §8), **not** by anything inside this module itself; from this module's own perspective it's an unused-looking public method, but it is the deliberate integration seam.
- **Attendance report**: single query over the date range, then a single JS pass computing `totalPresent` (status ∈ confirmed/completed, or has a clock-in), `totalAbsent` (status===no_show), `totalLate` (clock-in time after scheduled start), summed actual/overtime hours, and `attendanceRate = present/scheduled*100`.
- **Daily/weekly stats**: pure SQL aggregation (`SUM(CASE WHEN status=... THEN 1 ELSE 0 END)` pattern) for status/shift-type breakdowns and clock metrics.

### Data

- **Tables** (`packages/database/src/schema/scheduling/`): `shift_templates`, `employee_schedules`, `scheduling_conflicts`, `schedule_swap_requests` (file `swap-requests.ts`), plus `scheduling_rules` referenced only via feature-layer types/schemas (no corresponding service methods were found reading/writing a `schedulingRules` table in this service — the CRUD schemas for scheduling rules exist in `schemas/validation.ts` but there is no route in `routes/index.ts` exposing them, and no `SchedulingService` method manipulates that table; flagged as defined-but-unwired, mirroring the leave-approval-rule/calendar-event situation in §8).
- Reads `users` (employee lookups, availability), `leave_requests` (conflict/availability checks — cross-schema read into the leaves feature's table).
- Money: `shiftTemplates.hourlyRateCents` stored in cents, converted at the service boundary via `amountFromCents`/`toCents` (`packages/database/src/utils/money`).
- No KV/queue/DO/FTS5 usage in this module.

### Cross-module dependencies

- **Leaves → Scheduling**: `LeaveService.approveLeaveRequest` instantiates `SchedulingService` directly and calls `cancelSchedulesByDateRange` — a same-process, cross-service call (not an event/queue), explicitly outside any DB transaction ("SchedulingService calls OUTSIDE the transaction... If schedule cancellation fails, leave is still approved").
- **Scheduling → Notifications**: every state-changing method constructs/uses `NotificationService` (see §4) directly.
- Shares the `staff_management` module-gate with the leaves feature — both are entitlement-gated together at the plan level even though they're separate Hono sub-apps.

### Rust rewrite notes

- The conflict-detection rules (11h rest, 12h/day, 46h/week, 6 consecutive days) are plain arithmetic over `HH:MM` strings and date arithmetic — trivially portable, but note the two different enforcement paths (single-create hard-blocks on errors; bulk-create only records conflicts) must both be preserved distinctly, not unified accidentally during the port.
- `timesOverlap`/`calculateRestHours`'s "add 24h if end <= start" trick for overnight shifts is a common but easy-to-get-wrong pattern; a Rust port should use a proper duration/interval type (e.g. treat times as minutes-since-midnight with explicit day-wrap handling, or better, real `chrono::NaiveTime`/`Duration` arithmetic) rather than reproducing raw string parsing.
- Swap requests being "simplified" (no automatic schedule reassignment on approval) is existing product behavior, not a bug to silently fix during the rewrite — confirm with product owners before changing.
- CSV export is hand-built string joining (`headers.join(","), ...rows`) with manual quote-wrapping of every field and no escaping of embedded quotes — the exported columns are id/date/time/hours/status values (no free-text `notes` column), so corruption requires a literal quote in those fields; note also the "Employee Name" column is populated with `r.employeeId` (an id, not a name — `scheduling/routes/index.ts:477-518`) — a Rust rewrite should use a real CSV writer (e.g. `csv` crate) for correctness.
- `scheduling_rules` (and, in §8, `leave_approval_rules`/`leave_calendar_events` beyond the basic holiday read) appear to be schema/validation-schema-only scaffolding with no live service/route wiring — worth a deliberate decision (build it out, or drop the dead schema) rather than porting silently.
- Timestamps are `Date` objects at the Drizzle/TS boundary over `timestamp_ms` INTEGER columns — standard repo convention, carries forward directly.

---

## 8. `features/leaves` — leave/time-off requests, balances, and holiday calendar

### Purpose

Employee leave-type configuration, per-employee/per-year leave balance tracking (with manual adjustment and bulk accrual), a multi-level approval workflow for leave requests (which auto-cancels conflicting shift schedules on final approval), and a company/public holiday calendar used to answer "is this a working day" queries.

### Routes

All paths relative to `/api/v1/leaves`; every route requires `authMiddleware` (global) + `moduleGate("staff_management")` (global).

| Method | Full path | Auth | Purpose | Request/Response summary |
|---|---|---|---|---|
| GET | `/:restaurantId/types` | role `0`/`1` + restaurant access | List leave types for a restaurant | → `LeaveType[]` |
| GET | `/types/:id` | role `0`/`1` | Get one leave type | 404 if missing |
| POST | `/:restaurantId/types` | role `0`/`1` + restaurant access | Create a leave type | body: code/name/accrual rules/approval levels/carryover/documentation/payment/restrictions |
| PUT | `/types/:id` | role `0`/`1` | Update a leave type | partial body |
| DELETE | `/types/:id` | role `0`/`1` | Delete a leave type | 404 if not deletable |
| GET | `/balances?employeeId=&year=` | any authenticated (self, unless manager) | Employee's leave balances for a year | 403 if querying another employee and not manager |
| POST | `/balances/adjust` | role `0`/`1` | Manual balance adjustment (+/-) | `{ employeeId, leaveTypeId, year, adjustment, reason, adjustedBy }` |
| GET | `/:restaurantId/balances?year=` | role `0`/`1` + restaurant access | Bulk balances for every employee in a restaurant | — |
| POST | `/:restaurantId/balances/accrue` | role `0`/`1` + restaurant access | Accrue balances for every active employee × every accrual-enabled leave type missing a row for that year | `{ year }` → `{ count }` |
| GET | `/:restaurantId/requests` | any authenticated + restaurant access (non-managers forced to own) | List leave requests | query filters + pagination |
| GET | `/requests/:id` | any authenticated (ownership enforced) | Get one leave request | 403 if not own and not manager |
| POST | `/:restaurantId/requests` | any authenticated + restaurant access | Submit a leave request; server computes `totalDays` and checks balance sufficiency before insert | `{ leaveTypeId, startDate, endDate, startPeriod?, endPeriod?, reason, attachmentUrl?, emergencyContact? }`; 400 if insufficient balance |
| POST | `/requests/:id/approve` | role `0`/`1` | Approve one level of the approval chain (or finalize on the last level) | `{ approverId, comments? }` |
| POST | `/requests/:id/reject` | role `0`/`1` | Reject a pending request | `{ approverId, reason }` |
| POST | `/requests/:id/cancel` | any authenticated (self, unless manager) | Cancel a pending or approved request | `{ userId, reason }` |
| GET | `/:restaurantId/holidays?year=` | any authenticated + restaurant access | List holiday-calendar events for a year | — |
| GET | `/:restaurantId/working-day/:date` | any authenticated + restaurant access | Is a given date a working day (accounts for compensatory work days) | `{ date, isWorkingDay }` |

### Business logic

`LeaveService` (`packages/database/src/services/LeaveService.ts`, 1382 lines):

- **Balance model**: `employee_leave_balances` rows are per `(employeeId, leaveTypeId, year)`; `remainingDays` is always computed at read time as `totalDays - usedDays - pendingDays` (not a stored/generated column). Creating a request increments `pendingDays` (floored at 0 via `MAX(0, ...)` in SQL); final approval moves that amount from `pendingDays` to `usedDays`; rejection/cancellation moves it back out of `pendingDays` (or out of `usedDays` if cancelling an already-approved request) — all guarded by an `EXISTS (SELECT 1 FROM leave_requests WHERE id=? AND status=?)` condition in the same `UPDATE ... WHERE` so a balance adjustment only actually applies if the request is still in the expected status at write time (optimistic-concurrency-style guard without an explicit transaction wrapping both statements — they're sent together via `db.batch()`, which is atomic on D1, but there's no read-modify-write lock; a `getLeaveBalance` read happens before the batch, then the batch does the guarded write).
- **Approval chain**: `buildApprovalChain(restaurantId, leaveTypeId, levels)` builds a simple `[{level, approverRole: (level===1 ? 1 : 0), required:true}, ...]` array (level 1 = Owner, all subsequent levels = Admin) stored as JSON on the request row at creation time — this is **not** driven by the `leave_approval_rules` table/schema despite that table existing (`packages/database/src/schema/leaves/leave-approval-rules.ts`) and having full CRUD schemas defined in `features/leaves/schemas/validation.ts` (`createLeaveApprovalRuleSchema`, role/user-based approvers, auto-approval conditions, auto-escalation) — **no route in `routes/index.ts` exposes leave-approval-rule CRUD, and `LeaveService` never reads that table**; the actual chain is the hardcoded two-tier Owner-then-Admin logic. Same status for `leave_calendar_events` CRUD schemas (`createLeaveCalendarEventSchema`) — only reads (`getHolidays`/`isWorkingDay`) are wired to routes; there is no create/update/delete route for calendar events in this feature, so holidays must be seeded by some other means (migration seed data, admin tooling elsewhere, or direct DB access) not visible in this directory.
- **`approveLeaveRequest`**: reads the request + its leave type; if `currentApprovalLevel + 1 >= type.requiredApprovalLevels` this is the *final* approval — moves the balance from pending→used (guarded update as above) and flips `status="approved"`, `finalApproverId`, `finalApprovedAt` in one D1 batch; otherwise it just increments `currentApprovalLevel` (single write, no balance change, request stays `pending` for the next approver). On final approval it then, **outside the batch/transaction**, constructs a fresh `SchedulingService` and calls `cancelSchedulesByDateRange` to auto-cancel any shifts in the leave date range, storing the returned `scheduleIds` back onto the leave request's `affectedScheduleIds` JSON column for audit; a failure here is caught, logged, and does not roll back or fail the already-committed leave approval. Finally sends a `leave_request_approved` email — also best-effort, also outside the critical write path.
- **`rejectLeaveRequest`/`cancelLeaveRequest`**: same guarded-batch pattern for balance reversal, plus a best-effort notification (`leave_request_rejected`/`leave_request_cancelled`). `cancelLeaveRequest` accepts both `pending` and `approved` requests (rejecting only accepts `pending`), with different balance-reversal math depending on which status it's cancelling from.
- **`createLeaveRequest`**: the route layer (not the service) computes `totalDays` via `calculateLeaveDays` (whole days between start/end inclusive, minus 0.5 for a PM-only start or AM-only end) and checks `balance.remainingDays < totalDays` before calling the service — the service itself does not re-validate balance sufficiency, so a race between two concurrent submissions could both pass the route-layer check before either's `pendingDays` increment lands (no row lock, no transaction spanning both the balance check and the insert).
- **`accrueLeaveBalances`**: reads every active accrual-enabled leave type (`accrualType != 'none'`, restaurant-specific or global `restaurantId IS NULL`) and every active employee in the restaurant, then for every `(employee, type)` pair not already having a balance row for that year, inserts one with `totalDays = type.accrualAmount` — this is an **N+1 existence check** (`getLeaveBalance` called once per employee×type pair inside a loop) before a single batched insert of the missing rows; no partial-accrual/proration logic (e.g. by hire date or seniority) despite `accrualBasedOnSeniority` existing as a leave-type flag — that flag is not read anywhere in this accrual method.
- **Holiday calendar**: `getHolidays(restaurantId|null, year)` reads `leave_calendar_events` for the given year, restaurant-specific rows only (no `restaurantId IS NULL` fallback merge, unlike `isWorkingDay` which explicitly `OR`s in the global rows) — so `/​:restaurantId/holidays` will **not** show system-wide public holidays unless a restaurant-specific copy exists, which looks like it could be an oversight relative to `isWorkingDay`'s more permissive `OR restaurantId IS NULL` matching for the same table.

### Data

- **Tables** (`packages/database/src/schema/leaves/`): `leave_types`, `employee_leave_balances`, `leave_requests`, `leave_approval_rules` (schema exists, unused by any route/service in this dir), `leave_calendar_events`.
- Cross-reads `users` (employee display info, restaurant ownership checks) and writes/reads into `scheduling`'s `employee_schedules` indirectly via the `SchedulingService.cancelSchedulesByDateRange` call.
- No KV/queue/DO/FTS5 usage.

### Cross-module dependencies

- **Leaves → Scheduling** (see §7): the one concrete cross-feature side effect in this whole document set that reaches across a service boundary synchronously, in-process, without a queue or event — a same-Worker function call, not a durable message.
- **Leaves → Notifications** (see §4): every workflow transition (submit/approve/reject/cancel) sends an email via `NotificationService`, constructed fresh per call.
- Shares `staff_management` module-gate with scheduling.

### Rust rewrite notes

- The pending/used/carryover balance bookkeeping is arithmetic-only and portable, but the "guarded UPDATE via `EXISTS` subquery, sent in the same D1 batch as the status-changing UPDATE" pattern is a manual optimistic-concurrency technique specific to D1's atomic-batch guarantee; a Rust rewrite on a different datastore should use that datastore's native transaction isolation instead of reproducing the `EXISTS`-guard trick, provided it can still express "only apply this balance delta if the request is still in the expected status" atomically.
- The **leave-request creation balance check race** (route-layer check, no lock, no transaction spanning check+insert) is a pre-existing correctness gap, not something to preserve — worth flagging explicitly for the Rust rewrite to fix with a proper transaction or row-level lock around "check balance, then insert + increment pending" as one atomic unit.
- `leave_approval_rules` and `leave_calendar_events` write paths are schema-and-validation-only scaffolding with zero live route/service wiring — decide up front whether the Rust port implements the configurable approval-chain/calendar-event-CRUD features properly, or continues with the current hardcoded two-tier chain and read-only holiday calendar (and if the latter, drop the dead schema/validation code rather than port it).
- `getHolidays` vs. `isWorkingDay`'s differing restaurant-scope fallback (no global-holiday merge in one, `OR restaurantId IS NULL` in the other) should be resolved as one behavior, not preserved as an inconsistency, unless there's a product reason for the asymmetry not visible in this code.
- `accrueLeaveBalances`'s N+1 per-pair existence check should become a single batched "anti-join" query (`INSERT ... SELECT ... WHERE NOT EXISTS`) in the rewrite rather than N sequential reads — a straightforward performance improvement available in any SQL engine.
- Timestamps/JSON columns follow the same repo-wide conventions documented in §5/§7 (INTEGER `_ms` timestamps, TEXT-JSON for `approvalChain`/`affectedScheduleIds`/etc.) — carry forward unchanged.

---

## 9. `features/manager` — delegation-aware proxy actions & audit log

### Purpose

A narrow, deliberately-small "manager acts on behalf of owner" action gateway (currently supporting exactly one action type) plus the admin-only read endpoint for the audit trail those actions produce. Two independent Hono sub-routers sharing one service/table but mounted at two different paths with two different role gates.

### Routes

| Method | Full path | Auth | Purpose | Request summary | Response summary |
|---|---|---|---|---|---|
| POST | `/api/v1/manager/actions` | `authMiddleware` + `requireRole([0,1])` | Execute a supported delegation-aware action and write an audit row | `{ restaurantId, action: "update_menu_availability", resource: "menu_item", resourceId, onBehalfOfUserId?, reason?, payload? }` | `201 { success, data: ManagerActionResult }` |
| GET | `/api/v1/audit-logs` | `authMiddleware` + `requireRole([0])` | Query the audit log | query: `resourceId?, resource?, actorId?, onBehalfOfUserId?, restaurantId?, action?, limit? (≤100, default 50), offset? (default 0)` | `{ success, data:{ logs[], count } }` |

Note: `/api/v1/manager` and `/api/v1/audit-logs` are mounted as two separate `apiV1.route()` calls from the same `managerFeature` module object (`{actionsRoutes, auditLogsRoutes}` — `features/manager/index.ts`), each a distinct Hono sub-app with its own role gate; there's no shared `/manager/*` prefix for the audit read.

### Business logic

`ManagerActionsService` (`apps/api/src/features/manager/services/ManagerActionsService.ts`):

1. `assertActionResourcePair` — a hardcoded allowlist check: today, the **only** valid `(action, resource)` pair is `("update_menu_availability", "menu_item")`; any other resource for that action is rejected with `400 MANAGER_ACTION_INVALID`. The Zod schema (`schemas/validation.ts`) also constrains `action`/`resource` to single-value enums (`["update_menu_availability"] as const`, `["menu_item"] as const`), so this is effectively double-enforced (schema + service) — the code comment explicitly frames this as deliberate: "Start narrow and grow the enum deliberately; every addition needs a matching handler branch."
2. `updateMenuAvailability` — parses `resourceId` as a positive integer menu-item id, loads its current `isAvailable`, and either sets it to `payload.isAvailable` (if that's an explicit boolean in the request) or **toggles** it (`!item.isAvailable`) if no explicit value was given — this toggle-by-default behavior means calling the same action twice with no payload flips availability back and forth, which is a meaningful behavioral detail for any caller/UI.
3. Regardless of which action ran, `execute()` always inserts one `audit_logs` row: `userId` = the actual authenticated actor (`actor.id`, i.e. the manager/owner making the call), `onBehalfOfUserId` = the optional delegated-user id from the request body (this is the field that distinguishes "I am acting for myself" from "I am a manager acting on behalf of the owner"), `description` = the caller's `reason` if provided else an auto-generated `"<action> on <resource>#<resourceId>"`, and `changes.metadata` = `{onBehalfOfUserId, payload, reason}` (the whole request context, for forensics) — note this means the actual before/after value change (e.g. old vs. new `isAvailable`) is **not** captured in `changes.before`/`changes.after` despite the schema supporting that shape; only the raw request payload is stored, so reconstructing "what changed" from the audit log requires re-deriving it, not reading it directly.
4. `success` is always written as `true` — there's no code path in this service that writes a `success:false` audit row; any failure (bad resource pair, missing menu item) throws an `ApiError` before the insert runs, so failed attempts leave no audit trail at all (not even a failed-attempt record).

`AuditLogService.list` (`apps/api/src/features/manager/services/AuditLogService.ts`): a straightforward filtered/paginated Drizzle select over `audit_logs`, ordered `desc(createdAt)`, `limit` hard-capped at 100 server-side regardless of what the client requests. The returned shape deliberately duplicates each identity field under two names (`actorId`/`userId` both = `row.userId`; `onBehalfOfUserId`/`delegatedUserId` both = `row.onBehalfOfUserId`) — per an inline comment, this is so tests/consumers can match on either naming convention, not because the underlying data differs.

### Data

- **Table**: `audit_logs` (`packages/database/src/schema/audit-logs.ts`) — shared with the rest of the codebase's general-purpose audit trail (also referenced by `AUDIT_ACTIONS` constants for login/order/menu/system events used elsewhere), not a table exclusive to the manager feature. Columns: `id, user_id (FK users), on_behalf_of_user_id (FK users), restaurant_id, action, resource, resource_id, description, changes (JSON: before/after/metadata), ip_address, user_agent, success, error_message, execution_time_ms, created_at_ms`. Five indexes: user+action+time, restaurant+action+time, resource+resourceId+time, time-only, and on_behalf_of+time.
- **Also reads/writes**: `menu_items.isAvailable` (the one currently-supported action target).
- No KV/queue/DO/FTS5 usage.

### Cross-module dependencies

- Directly mutates `menu_items`, a table owned by the menu feature — this module bypasses the menu feature's own service layer and writes to the table directly via Drizzle, rather than calling into `features/menu`'s service.
- There is a **separate, distinct** `features/audit` module (mounted at `/api/v1/audit`, outside this document's scope) that coexists with this module's `/api/v1/audit-logs` — two differently-named, differently-implemented audit surfaces exist side by side in the same API; whether they read/write the same `audit_logs` table or a different one was not verified as part of this review (only `features/manager` was in scope) and should be checked before assuming they're interchangeable in a Rust rewrite.
- The `ip_address`/`user_agent`/`error_message`/`execution_time_ms` columns on `audit_logs` are never populated by this module's insert (`ManagerActionsService.execute` only sets `userId/onBehalfOfUserId/restaurantId/action/resource/resourceId/description/changes/success`) — those columns may be populated by other audit-writing code paths elsewhere in the repo (e.g. the separate `features/audit` module, or middleware), which is additional reason to treat `audit_logs` as a shared, multi-writer table rather than one owned solely by this feature.

### Rust rewrite notes

- The action-dispatch shape (`assertActionResourcePair` + a `switch`/`if` per action calling a dedicated handler) is a natural fit for a Rust enum + match — the "grow the enum deliberately" pattern in the comment is exactly the kind of exhaustive-match safety a Rust port gets for free (the compiler will force handling every new `Action` variant).
- Decide during the rewrite whether to close the "toggle-when-no-explicit-payload-value" implicit behavior gap by requiring an explicit `isAvailable` in the payload, or keep the toggle convenience — it's a real behavioral choice embedded in current production code, not an accident to silently fix.
- Decide whether to start capturing real before/after diffs in `changes.before`/`changes.after` (the schema already supports it; today only `changes.metadata` — the raw request — is populated) — this would meaningfully improve audit-log usefulness and is a good candidate for a deliberate improvement during the rewrite rather than a straight port.
- Audit-write-on-success-only (no failed-attempt trail) is a real security/observability gap worth flagging explicitly to whoever owns the Rust rewrite's security posture — silently reproducing it means failed unauthorized/invalid attempts remain invisible in the audit trail.
- Before the rewrite, resolve whether `features/audit` (separate module, out of scope here) and this module's `audit_logs` usage are the same table/concept or two parallel systems — this materially affects how much of the "audit" concept can be unified into one Rust service versus kept as two.

---

## Cross-cutting summary for the Rust rewrite

- **Realtime bridge is the one true event-publishing mechanism** across all nine modules: `RealtimeBroadcastService` (`packages/database`) → `env.REALTIME_SESSION.idFromName("<roomType>:<roomId>")` → DO `stub.fetch(internal URL)`. It is best-effort/fire-and-forget everywhere it's used (orders, kitchen, group-orders — none of which are in this document's scope, but all of which feed the `features/realtime`-issued tokens). A Rust rewrite that keeps Durable Objects can port this addressing scheme 1:1 via `worker-rs`; one that doesn't will need a new pub-sub/session-routing design and must change every caller.
- **`features/sse` is dead weight** (pure 410 responder) and **`features/push`/`features/notifications`/`features/manager` are all thin CRUD/dispatch layers** with no unusual runtime requirements — good early Rust-port candidates.
- **The two heaviest/most distinctive modules are `discovery` (FTS5 trigram + optional Workers-AI/Vectorize semantic layer + queue-based fan-out sync) and `scheduling`/`leaves` (rule-engine + cross-service, non-transactional side effects)** — these carry the real design decisions the rewrite needs to make deliberately rather than mechanically translate.
- **Web-push VAPID crypto is implemented once** (`packages/database/CustomerWebPushService.ts`, RFC 8291 `aes128gcm` + ECDSA VAPID JWT via raw WebCrypto) but **wired to only one of two subscription stores** (customer waiting-list push); the staff-side `features/push` module in this document depends on an injected `WEB_PUSH_DELIVERER` whose production wiring was not found in this feature directory. A Rust rewrite needs `ring`/`p256`/`aws-lc-rs`-based ECDH+HKDF+AES-GCM+ECDSA, and should resolve the two-stores-one-crypto-impl split deliberately.
- **Two audit-adjacent tables/systems coexist** (`features/manager`'s use of `audit_logs`, and the separate out-of-scope `features/audit` module) and **at least three examples of schema-defined-but-route-unwired functionality** were found (`leave_approval_rules`, `leave_calendar_events` CRUD, `scheduling_rules`) — all worth resolving (build out or delete) before or during the rewrite rather than silently porting dead code paths.
- **Timestamp/JSON conventions are uniform** across every module reviewed here: INTEGER `_ms` unix-millisecond columns (Drizzle `{mode:"timestamp_ms"}`), TEXT columns holding JSON for arrays/objects (tags, market_ids, approvalChain, changes, etc.) with manual `JSON.parse`/`JSON.stringify` at the application boundary — a Rust ORM layer will need the equivalent manual `serde_json` (de)serialization step, since none of these are native SQL JSON columns.
