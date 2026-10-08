# `apps/customer-app` — Backend Contract (Rust-Rewrite Reference)

This document inventories everything `apps/customer-app` (the customer-facing
ordering PWA, Vue 3 + Vite, port 3000) sends to and expects back from its
backend(s). It is the "real contract" a Rust rewrite of the backend must
preserve byte-for-byte where noted — **it does not describe backend
implementation**, only what this one client actually does. Cross-reference
`docs/Backend-Rust-refactor/realtime.md` for the `apps/realtime` side of the
WebSocket picture; several findings below corroborate bugs already documented
there.

All paths are repo-relative to `apps/customer-app/` unless stated otherwise.

---

## 1. Purpose & connection topology

### Backends this app talks to

| Backend | How it's reached | Evidence |
|---|---|---|
| `apps/api` (main REST API, Hono) | HTTP via `apiClient` (axios), base path `VITE_API_BASE_URL` | `src/services/api.ts:10-19` |
| `apps/realtime` (Durable Object WS service) | Raw `WebSocket`, base URL `VITE_WS_BASE_URL` (and two other env vars, see §4 caveat) | `src/composables/useWebSocket.ts:258,293`, `src/views/OrderTrackingView.vue:417,440` |
| `apps/image-processor` | **Not called directly.** No fetch/axios call to an images host was found; `imageUrl`/`imageVariants` fields on `MenuItem`/`Restaurant` are consumed as opaque URLs already pointing at wherever the API put them. `VITE_IMAGES_BASE_URL` is declared in `src/env.d.ts`, but **no source file reads `import.meta.env.VITE_IMAGES_BASE_URL`** — grep across `src/` found zero usages. Only the PWA service-worker cache config (`vite.config.ts`) hardcodes a URL-pattern rule for `https://images.makanmasak.com/` (`CacheFirst`, 7-day expiry) — that's a caching hint, not a live call site. |
| `apps/management-api` | Never called. No reference found. |

### Base URLs / env

`.env.development` (committed, team-shared defaults):
```
VITE_API_BASE_URL=/api/v1
VITE_WS_BASE_URL=ws://localhost:8788
VITE_APP_ENV=development
VITE_DEBUG_MODE=true
```

`src/env.d.ts` (TypeScript's declared env surface) additionally lists
`VITE_IMAGES_BASE_URL`, `VITE_APP_NAME`, `VITE_APP_VERSION` — of these
three, only `VITE_APP_VERSION` is read (`composables/useErrorTracking.ts:149`,
defensively defaulted); the other two are read nowhere in `src/`.

**Important gap**: two composables read env vars that are declared **nowhere**
(`.env.development`, `.env.development.example`, or `env.d.ts`):
- `VITE_REALTIME_WS_URL` — `src/composables/useRealtimeNotifications.ts:19`
- `VITE_REALTIME_URL` — `src/composables/useGroupOrder.ts:226`

Both fail closed at runtime in dev/prod today (the code throws/logs and bails
rather than connecting) because `import.meta.env.VITE_REALTIME_WS_URL` /
`VITE_REALTIME_URL` are `undefined`. See §4 — both of these composables also
turn out to be **unreachable dead code** (never invoked from any router-mounted
view), so this is currently inert, but it means "grep the client for the
realtime contract" must not stop at these two files.

`apiClient` (`src/services/api.ts`) throws synchronously at module-load time
if `VITE_API_BASE_URL` is unset — there is no silent fallback.

### Vite dev proxy (`vite.config.ts:server.proxy`)

```
"/api" → http://localhost:8787   (apps/api worker)
"/ws"  → process.env.VITE_WS_BASE_URL || ws://localhost:8787   (ws: true)
```

Caveat worth flagging: the `/ws` proxy target reads `process.env.VITE_WS_BASE_URL`
directly inside `vite.config.ts` (Node context), which is **not** the same as
`import.meta.env.VITE_WS_BASE_URL` used by client code — Vite does not
auto-inject `.env.development` values into `process.env` for the config file
itself unless `loadEnv()` is called (it isn't, here). In practice this proxy
block likely always falls back to its `ws://localhost:8787` default rather
than picking up the committed `ws://localhost:8788`. Client-side WS code
(`useWebSocket`, `OrderTrackingView`) does **not** go through this proxy path
at all — it connects directly to `import.meta.env.VITE_WS_BASE_URL` (port
8788, the real `apps/realtime` port per `CLAUDE.md`), bypassing Vite entirely.
So the `/ws` proxy entry may be effectively unused/misconfigured; not
something a Rust rewrite needs to match, but worth knowing when reproducing
local dev behavior.

### HTTP client shape (`src/services/api.ts`)

- axios instance, `baseURL = VITE_API_BASE_URL`, `timeout: 10000ms`.
- Static headers on every request: `Content-Type: application/json`,
  `X-Client-Version: 2.0.0`, `X-Client-Platform: web`.
- Request interceptor adds (see §3 for details): `Authorization: Bearer …`,
  `X-Request-ID: <uuid v4 via crypto.randomUUID()>`, and conditionally
  `X-Restaurant-ID` / `X-Table-ID` from a `localStorage` "restaurant context"
  blob.
- Every call is unwrapped: `apiClient.get/post/...` return
  `response.data.data` if `"data" in response.data`, else `response.data`
  itself as a fallback. **Callers therefore receive the inner payload, not
  the `{success, data}` envelope** — see §5 for the failure-path implication.
- `uploadFile()` helper exists (multipart POST with progress callback) but no
  call site in the customer app uses it (no image/file upload UI here).

---

## 2. Endpoint inventory

All paths below are relative to `VITE_API_BASE_URL` (`/api/v1` in dev) unless
marked "frontend route" (client-side vue-router path, not a backend call —
listed only where a grep hit could be mistaken for an API path).

### 2.1 Customer identity & auth (`src/services/customerIdentityApi.ts`)

| Method | Path | Called from | Request | Response fields actually read |
|---|---|---|---|---|
| POST | `/customer/auth/request-otp` | `stores/auth.ts:93` | `{phone}` | `{phone, expiresInSeconds, devOtp?}` — `devOtp` implies a dev-only OTP echo exists |
| POST | `/customer/auth/verify-otp` | `stores/auth.ts:108` | `{phone, otp}` | `{accessToken, refreshToken?, expiresIn, customer:{id, primaryPhone?, primaryEmail?, displayName, ...}}` — store reads `data.accessToken` and `data.customer` (both must be truthy or login is treated as failed) |
| POST | `/customer/auth/refresh` | `stores/auth.ts:175` | `{}`, `withCredentials: true` (refresh token via cookie) | `{accessToken, ...}` minus `customer` — store checks `"accessToken" in data && data.accessToken` |
| POST | `/customer/auth/logout` | `stores/auth.ts:155` | `{}`, `withCredentials: true` | not read (fire-and-forget, failure is swallowed with `console.warn`) |
| GET | `/customer/me` | `stores/auth.ts:198,223`; `customerOrderApi.getMyProfile` | — | `{customer: CustomerSummary, preferences: CustomerPreferences}` — only `.customer` is read by the store |
| PATCH | `/customer/me` | `customerIdentityApi.updateMe` | `{displayName?, avatarUrl?, locale?}` | `{customer: CustomerSummary}` |
| PATCH | `/customer/preferences` | `customerIdentityApi.updatePreferences` | `Partial<CustomerPreferences>` | full `CustomerPreferences` object |
| GET | `/customer/favorites` | `customerIdentityApi.listFavorites` | query `{targetType?}` | `CustomerFavorite[]` (`id, targetType, targetId, createdAtMs`) |
| POST | `/customer/favorites` | `customerIdentityApi.addFavorite` | `{targetType, targetId}` | `CustomerFavorite` |
| DELETE | `/customer/favorites/:id` | `customerIdentityApi.removeFavorite` | — | not read |
| GET | `/customer/recent-markets` | `customerIdentityApi.listRecentMarkets` | query `{limit}` | `CustomerRecentMarket[]` (`marketId, visitedAtMs`) |
| POST | `/customer/recent-markets` | `customerIdentityApi.recordRecentMarket` | `{marketId, visitedAtMs?}` | `CustomerRecentMarket` |
| POST | `/customer/push-subscriptions` | `customerIdentityApi.addPushSubscription` | `{endpoint, p256dh, auth, userAgent?, deviceLabel?}` | `CustomerPushSubscription` (`id, endpoint, device_label?, created_at_ms?`) — note **snake_case `device_label`/`created_at_ms`** mixed with camelCase elsewhere; not a typo, matches the declared interface |
| GET | `/customer/push-subscriptions` | `customerIdentityApi.listPushSubscriptions` | — | `Array<{id, endpoint, device_label?}>` |
| DELETE | `/customer/push-subscriptions/:id` | `customerIdentityApi.removePushSubscription` | — | not read |
| POST | `/customer/consents` | `customerIdentityApi.grantConsent` | `{consentType, version, granted, source?}` | not read |

### 2.2 Orders & guest ordering (`src/services/orderApi.ts`, `customerOrderApi.ts`)

| Method | Path | Called from | Request | Response fields read |
|---|---|---|---|---|
| POST | `/orders` | `orderApi.createOrder`; also directly via `apiClient.post` in `components/ShopCartModal.vue:562` and `utils/background-sync.ts:98` (offline queue retry) | `CreateOrderRequest` (`restaurantId, tableId?, waitingListId?, customerName?, customerPhone?, items[], notes?, couponCode?`); ShopCartModal's variant additionally sends `orderType, customerPhone, customerInfo, totalAmount, deliveryInfo` | `Order` (full shape, §6) |
| POST | `/guest-orders` | `orderApi.createGuestOrder`; also `ShopCartModal.vue:583` | `CreateGuestOrderRequest` (`restaurantId, guestName, phoneLastDigits, orderType: "shop"\|"table"\|"seat", waitingListId?, customerPhone?, tableId?, seatId?, items[], notes?`) | `{order: Order, guestToken: string, tokenExpiresAt: string}` — client **persists `guestToken` to `localStorage["guest_auth_token"]`** as a side effect of the call |
| GET | `/orders/:orderId` | `orderApi.getOrder`, `customerOrderApi.getOrderDetail` | — | `Order` |
| GET | `/guest-orders/:orderId` | `orderApi.getGuestOrder` | — | `Order` **or** `{order: Order}` — client unwraps defensively with `"order" in response ? response.order : response`, i.e. it tolerates either shape today |
| POST | `/orders/:orderId/cancel` | `orderApi.cancelOrder` | `{reason?}` | `Order` |
| DELETE | `/orders/:orderId` | `customerOrderApi.cancelOrder` (a **second, different** cancel path — DELETE not POST) | query `?reason=` (URL-encoded) | `Order` |
| GET | `/orders/:orderId/tracking` | `orderApi.getOrderTracking` | — | `OrderTrackingInfo` (`order, timeline[], estimatedReadyTime?, currentWaitTime?, queuePosition?`) — **no call site found using this method** in any view; dead code path kept for completeness |
| PATCH | `/orders/:orderId/items/:orderItemId` | `orderApi.updateOrderItem` | `{quantity?, notes?}` | `OrderItem` |
| POST | `/orders/:orderId/items` | `orderApi.addOrderItem` | `{menuItemId, quantity, customizations?, notes?}` | `OrderItem` |
| DELETE | `/orders/:orderId/items/:orderItemId` | `orderApi.removeOrderItem` | — | not read |
| POST | `/orders/:orderId/review` | `orderApi.submitOrderReview` | `{rating, comment?, itemRatings?}` | not read |
| GET | `/orders/:orderId/receipt` | `orderApi.getOrderReceipt` (number id) **and** `customerOrderApi.getOrderReceipt` (string id, different declared response shape) | — | Two independently-typed receipt shapes exist client-side for the same path — see §6 ambiguity note |
| GET | `/customers/me/orders` | `customerOrderApi.getMyOrders` | query `{page?, limit?, status?, dateFrom?, dateTo?}` (status repeated as multiple `status=` params if array) | `{orders: Order[], pagination:{page, limit, total, totalPages}}` |
| GET | `/restaurants/:id/tables/:tableId/orders` | `orderApi.getTableOrderHistory` | query `{limit?, offset?, status?[], dateFrom?, dateTo?}` | `{orders: Order[], total, hasMore}` |
| GET | `/restaurants/:id/tables/:tableId/current-order` | `orderApi.getTableCurrentOrder` | — | `Order \| null`; **404 is treated specially** — caught and mapped to `null` (see §5) |
| POST | `/restaurants/:id/orders/calculate` | `orderApi.calculateOrderSummary` | `{items:[{menuItemId, quantity, customizations?}]}` | `OrderSummary` (`subtotal, serviceCharge, tax, discount, total`) |
| GET | `/restaurants/:id/wait-time` | `orderApi.getRestaurantWaitTime` | — | `{averageWaitTime, currentOrderCount, kitchenStatus, estimatedPrepTime}` |
| POST | `/restaurants/:id/tables/:tableId/service-requests` | `orderApi.requestService` | `{type, message?, priority?}` | `{id, estimatedResponseTime, queuePosition}` |
| POST | `/realtime/auth/guest-token` | `orderApi.getGuestRealtimeToken`; only real call site is `views/OrderTrackingView.vue:425` | `GuestRealtimeTokenRequest` (`restaurantId, tableId, orderId?, qrCode`) | `GuestRealtimeTokenResponse` (`token, expiresAt, wsUrl`) — **client discards `wsUrl` and builds its own** `${VITE_WS_BASE_URL}/customer/${tableId}?token=...` instead (`OrderTrackingView.vue:440`); if backend ever changes the WS host/path, this client will not follow unless it starts using the returned `wsUrl` |

### 2.3 Market checkouts (multi-vendor cart) (`src/services/orderApi.ts`)

| Method | Path | Called from | Request | Response read |
|---|---|---|---|---|
| POST | `/market-checkouts` | `orderApi.createMarketCheckout` | `CreateMarketCheckoutRequest` (`marketSlug, guestName, phoneLastDigits, notes?, vendors:[{restaurantId, items[], notes?, clientMutationId?}]`) | `MarketCheckoutResponse` (`checkout{...}, childOrders[]`) — client persists the **entire response** to `localStorage["market_guest_checkout"]`, records recent-checkout metadata, records per-vendor guest tokens, and separately caches `childOrders[0].guestToken` to `localStorage["guest_auth_token"]` |
| GET | `/market-checkouts/:id` | `orderApi.getMarketCheckout` | — | `{checkout: MarketCheckoutSummary}` — only `.checkout` is returned to caller |
| POST | `/market-checkouts/:id/guest-token` | `orderApi.recoverMarketCheckoutGuestToken` | `{orderId, phoneLastDigits}` | `{orderId, restaurantId, guestToken, tokenExpiresAt}` |
| POST | `/market-checkouts/:id/pay` | `orderApi.payMarketCheckout` | `{method, country?, currency?, customerInfo?, providerInput?}` | `{checkout, payment: MarketCheckoutPaymentSummary}` — payment summary has nested `parentPayment.nextAction` (`redirect`/`client_secret`/`sdk_confirmation`) that the checkout-tracking view branches on |
| POST | `/market-checkouts/:id/voucher` | `orderApi.applyMarketCheckoutVoucher` | `{code}` | `{checkout, voucher?, subtotalCents?, discountCents?, payableCents?}` |
| DELETE | `/market-checkouts/:id/voucher` | `orderApi.removeMarketCheckoutVoucher` | — | same envelope as above |

`MarketCheckoutPaymentSummary.status` union: `pending | partial_paid | paid |
failed | refunded | partial_refunded`. `currency`/`country` are closed unions:
`TWD|MYR|VND` / `TW|MY|VN` — **any other value the backend emits will fail
TypeScript's structural expectations at the call site**, though nothing
enforces this at runtime (axios/JSON has no schema validation client-side).

### 2.4 Menu & restaurant browsing (`src/services/menuApi.ts`)

| Method | Path | Called from | Request | Response read |
|---|---|---|---|---|
| GET | `/menu/:restaurantId` | `menuApi.getRestaurantMenu` / `.getMenu` alias; used in `MenuView.vue`, `ShopMenuView.vue` | query `{tableId?}` | `{restaurant, categories, menuItems, featuredItems}` |
| GET | `/restaurants/:id` | `menuApi.getRestaurant` (e.g. `QRScanView.vue:428` via the service layer); also directly via `apiClient.get<Restaurant>` in `ShopPhoneVerificationView.vue:310` | — | full `Restaurant` (§6) |
| GET | `/restaurants/:id/categories/:categoryId/menu` | `menuApi.getCategoryMenu` | — | `{category, menuItems}` — **no call site found**; dead |
| GET | `/restaurants/:id/menu/:menuItemId` | `menuApi.getMenuItem` | — | `MenuItem` — **no call site found**; dead |
| GET | `/restaurants/:id/menu/featured` | `menuApi.getFeaturedItems` | query `?limit=` | `MenuItem[]` — **no call site found**; dead |
| GET | `/restaurants/:id/menu/search` | `menuApi.searchMenuItems` | query `{query, categoryId?, priceMin?, priceMax?, dietary?[], limit?, offset?}` | `{menuItems, total, hasMore}` — **no call site found**; dead |
| POST | `/restaurants/:id/menu/availability` | `menuApi.checkItemAvailability` | `{menuItemIds:number[]}` | `Record<number, {isAvailable, inventoryCount}>` — **no call site found**; dead |
| GET | `/restaurants/:id/categories` | `menuApi.getCategories` | — | `Category[]` — **no call site found**; dead |
| GET | `/restaurants/:id/availability` | `menuApi.getRestaurantAvailability` | — | `{isOpen, businessHours, nextOpenTime?, specialHours?}` — **no call site found**; dead |
| GET | `/restaurants/:id/tables/:tableId/validate` | `menuApi.validateTable` | — | `{isValid, table?, restaurant?}` — **no call site found**; dead |
| GET | `/discovery/restaurants` | `menuApi.searchRestaurants` (only reads `.results`), also `discoveryApi.browseRestaurants` (used in `stores/discovery.ts:112`) | query `{q, limit}` or `SearchFilters` | `{results: [...]}` / `{results: RestaurantListItem[], total}` — two client functions hit the same path with different query shapes and response typing |

### 2.5 Discovery / search (`src/services/discoveryApi.ts`, used by `stores/discovery.ts`)

| Method | Path | Request (`SearchFilters`) | Response read |
|---|---|---|---|
| GET | `/discovery/search` | `q?, city?, district?, categoryName?, catalogType?, marketId?, marketSlug?, lat?, lng?, radiusKm?, priceMin?, priceMax?, openNow?, takeaway?, delivery?, sortBy?, page?, limit?` | `{results: DishSearchResult[], total, scope?}` |
| GET | `/discovery/restaurants` | (subset of filters) | `{results: RestaurantListItem[], total}` |
| GET | `/discovery/services` | `serviceType?` + shared filters | `{results: ServiceSearchResult[], total, scope?}` |
| GET | `/discovery/categories` | filters | `{categories: string[]}` |
| GET | `/discovery/service-types` | filters | `{serviceTypes: ServiceTypeFacet[]}` |
| GET | `/discovery/restaurants/:id/menu` | — | `any[]` — **no call site found**; dead |
| GET | `/discovery/restaurants/:id/takeaway-eligibility` | — | `{eligible:true, shopQrCode} \| {eligible:false, reason}` — **live**: called from `MarketDetailView.vue:814` and `DiscoveryView.vue:520` (takeaway start flows) |
| GET | `/discovery/restaurants/:id/markets` | — | `{memberships: RestaurantMarketMembership[]}` — used in `ShopMenuView.vue:713` |
| GET | `/discovery/popular` | — | `{keywords, dishes, restaurants}` |

### 2.6 Markets (multi-vendor venues) (`src/services/marketsApi.ts`, `stores/markets.ts`)

| Method | Path | Request | Response read |
|---|---|---|---|
| GET | `/markets` | `{q?, city?, district?, type?, page?, limit?}` | `{markets: MarketListItem[], total, page, limit}` |
| GET | `/markets/areas` | — | `{areas: MarketArea[]}` |
| GET | `/markets/:slug` | — | `{market: MarketDetail, vendorCount, explorationSummary?}` |
| GET | `/markets/:slug/vendors` | `{openNow?, takeaway?, delivery?, q?, lat?, lng?, radiusKm?, sortBy?, page?, limit?}` | `{vendors: MarketVendor[], total, page, limit}` |
| GET | `/markets/nearby` | `{lat, lng, radiusKm?, limit?}` | `{markets: Array<MarketListItem & {distanceKm}>}` |

### 2.7 Restaurant contact / service items (`src/services/restaurantContactApi.ts`)

| Method | Path | Called from | Response read |
|---|---|---|---|
| GET | `/restaurants/:id/contact-profile` | `restaurantContactApi.getContactProfile` | `{restaurantId, messagingChannels, faqs[]}` — **live**: called from `MarketDetailView.vue:1026` (`openContactProfile`, bound to `@contact-vendor`) |
| GET | `/restaurants/:id/service-items` | `restaurantContactApi.listServiceItems`; used in `ServiceBookingView.vue`, `ShopMenuView.vue` | `RestaurantServiceItem[]` |

### 2.8 Service bookings (`src/services/serviceBookingsApi.ts`, `ServiceBookingView.vue`)

| Method | Path | Request | Response read |
|---|---|---|---|
| GET | `/service-bookings/availability` | `{serviceItemId, date}` | `{slots: ServiceBookingAvailabilitySlot[]}` — client returns `.slots` |
| POST | `/service-bookings` | `CreateServiceBookingInput` | `{booking: ServiceBooking}` |
| POST | `/service-bookings/recurring` | `CreateRecurringServiceBookingInput` (`startDate, count, intervalWeeks?` instead of single `bookingDate`) | `{bookings: ServiceBooking[]}` |
| POST | `/service-bookings/waitlist` | `JoinServiceBookingWaitlistInput` | `{waitlistEntry: ServiceBookingWaitlistEntry}` |
| POST | `/service-bookings/:id/pay` | `{creditCardPublicId, pin?}` | `{booking: ServiceBooking}` |
| GET | `/service-bookings/verify/:code` | query `{customerPhone?, customerEmail?}` if contact proof supplied | `{booking: ServiceBooking}` |
| POST | `/service-bookings/verify/:code/cancel` | same optional contact proof, as body | `{booking: ServiceBooking}` |
| GET | `/service-bookings/verify/:code/ics` | — (never fetched via `apiClient`; the client only **builds this URL string** for a `<a href>`/download link, query params `requireContact`, `customerPhone`, `customerEmail`) | n/a — browser-navigated, not JSON |

`ServiceBooking.priceCentsSnapshot`, `depositRequiredCents`,
`balanceDueCents`, `amountDueCents`, `amountPaidCents`,
`voucherDiscountCents` are all integer cents; `reminderOptIn` is typed
`number` (not boolean) on the read side even though the create-input type
takes a `boolean` — worth confirming which the wire format actually is.

### 2.9 Waiting list (`src/services/waitingListApi.ts`, `views/waiting-list/*.vue`)

| Method | Path | Request | Response read |
|---|---|---|---|
| POST | `/waiting-list` | `JoinWaitingListRequest` (`restaurantId, customerId?, customerName, customerPhone, partySize, preferredTableType?, notes?`) | `WaitingListResponse` (extends `WaitingListEntry` + `queueDisplay, partiesAhead, table?, alreadyJoined?`) |
| GET | `/waiting-list/lookup` | query `{restaurantId, phone}` | `WaitingListResponse` |
| GET | `/waiting-list/history` | query `{restaurantId, phone, limit:"20"}` (limit hardcoded client-side) | `WaitingListResponse[]` |
| GET | `/waiting-list/:id` | — | `WaitingListResponse` — polled every 5s (status `called`) / 10s (otherwise) by `useWaitingTicket.ts`, paused on `document.hidden` |
| GET | `/waiting-list/queue-status/:restaurantId` | — | `QueueStatus` (`restaurantId, totalWaiting, averageWaitMinutes, availableTables, byTableType[]`) |
| GET | `/waiting-list/estimate-wait/:restaurantId` | query `{partySize}` | `WaitTimeEstimateResult` |
| DELETE | `/waiting-list/:id` | body `{customerPhone}` (DELETE **with a body**, via `apiClient.request`) | `WaitingListResponse` |
| POST | `/waiting-list/:id/confirm` | `{customerPhone}` | `WaitingListResponse` |

`WaitingStatus` is a **string enum** (`waiting|called|confirmed|seated|
cancelled|expired|no_show`), not numeric — terminal-status set used by
`useWaitingTicket.ts` to stop polling is `{seated, cancelled, expired,
no_show}`.

### 2.10 Coupons (inline in `views/CartView.vue`, not in a service file)

| Method | Path | Request | Response read |
|---|---|---|---|
| POST | `/coupons/validate` | `{code, restaurantId, orderAmount, menuItems:[{menuItemId, quantity}]}` | `{valid: boolean, coupon?, discountAmount?, error?}` — typed `any`, no shared interface |
| GET | `/coupons/available/:restaurantId` | — | `any[]` |

### 2.11 QR codes (inline in `views/ShopPhoneVerificationView.vue`)

| Method | Path | Response read |
|---|---|---|
| GET | `/qr-codes/verify/shop/:shopQrCode` | `{valid: boolean, restaurant?: Restaurant}` — typed `ShopQrVerificationResponse` locally in the view, not shared-types |

### 2.12 System / telemetry (best-effort, non-blocking)

| Method | Path | Called from | Notes |
|---|---|---|---|
| POST | `/system/errors` | `useErrorTracking.ts:105` | **Unreachable dead code**: the `useErrorTracking()` composable is never imported/invoked anywhere in the app (do not confuse with the live `utils/performance-monitor.ts`) |
| POST | `/system/performance` | `usePerformanceMonitor.ts:149` | **Unreachable dead code**: `usePerformanceMonitor()` likewise has zero importers |
| POST | `/analytics/batch-sync` | `pwa-performance-optimizer.ts:209`; also `background-sync-optimized.ts:265` | `{events: [...]}` |
| POST | `/orders/batch-sync` | `background-sync-optimized.ts:230` | `{orders: [...]}` — **offline retry queue for order submission**, separate code path from the live `/orders` POST |
| POST | `/users/preferences/batch-sync` | `background-sync-optimized.ts:241` | — |
| POST | `/feedback/batch-sync` | `background-sync-optimized.ts:254`; also dead `background-sync.ts:291` | — |
| POST | `/users/favorites/sync` | `pwa-performance-optimizer.ts:573` | — |
| POST | `/users/settings/sync` | `pwa-performance-optimizer.ts:574` | — |

**Caveat**: this whole cluster (§2.12) exists inside a PWA
background-sync/IndexedDB subsystem (`pwa-performance-optimizer.ts` →
imports `background-sync-optimized.ts` + `performance-monitor.ts` +
`offline-storage-optimized.ts`; wired up from `main.ts:13`). These endpoints
are only invoked when the client has actually queued offline actions (order
placed while offline, telemetry batching, etc.) — the `pwa-performance-optimizer.ts`-wired rows are real, reachable code paths (exception: the `/system/errors` and `/system/performance` rows above come from two composables that are never imported anywhere, so those two are dead), but low-frequency and **no corresponding route was verified to
exist on the `apps/api` side** in this pass (out of scope — only the client
was read). Flagging so the Rust rewrite doesn't silently drop them without
checking `apps/api`'s router first. Separately, `src/utils/background-sync.ts`
(the **non**-`-optimized` file, with its own `/orders` and `/feedback/batch-sync`
call sites) is not imported by any live file — confirmed dead code.

### 2.13 Legacy / orphaned auth endpoints (routable views, but see caveats)

These views **are** wired into `router/index.ts` (reachable by URL), but the
password-based auth flow they represent appears superseded by the phone-OTP
flow in `customerIdentityApi`/`stores/auth.ts` — the store's own code
comments say as much ("Legacy username/password login is intentionally no
longer used", "Legacy password registration is retired... Use phone OTP
login" — `stores/auth.ts:133-149`). `RegisterView.vue` calls
`authStore.register()`, which **never reaches the network** — it's a stub
that immediately returns a failure. The other three views below bypass the
store and call `apiClient` directly, so they **do** hit the network if
visited:

| Method | Path | Called from | Request | Response read |
|---|---|---|---|---|
| POST | `/auth/forgot-password` | `ForgotPasswordView.vue:222` | `{email}` | `{success, message?}` |
| GET | `/auth/reset-password/verify` | `ResetPasswordView.vue:447` | query `{token}` | `{valid, email?, error?}` |
| POST | `/auth/reset-password` | `ResetPasswordView.vue:476` | `{token, newPassword, confirmPassword}` | `{success, ...}` |
| GET | `/auth/verify-email` | `VerifyEmailView.vue:197` | query `{token}` | `{success?, message?}` |
| POST | `/auth/verify-email/send` | `VerifyEmailView.vue:231` | `{email}` | `{success?, message?}` |
| POST | `/auth/guest-token` | `ShopPhoneVerificationView.vue:357` | `{restaurantId, phoneLastDigits}` | `{success?, token?}` — best-effort, failure is swallowed (`console.warn`, navigation continues) |

Whether `apps/api` still implements any of these six routes is unverified in
this pass (frontend-only scope). If it does not, these are simply dead client
paths; if it does, they represent a **second, parallel, password-based auth
system** that a Rust rewrite would need an explicit decision about (port vs.
drop), since the primary/working flow is entirely OTP-based.

### 2.14 Group ordering — unreachable from any route

`useGroupOrder.ts` defines calls to `/group-orders` (POST, create),
`/group-orders/:id` (GET, join), `/group-orders/:id/cart` (POST, sync item),
`/group-orders/:id/submit` (POST), and `/realtime/auth/token` (POST, WS
token). **No view or router entry invokes `useGroupOrder()`** —
`components/group/GroupCartPanel.vue` and `SplitBillSelector.vue` only import
*types* from this composable, never the composable function itself, and
neither component is imported by any view or router route. This entire
group-order feature (both the API surface and its WS wiring, see §4) is
present in the bundle but structurally unreachable by a real user in this
version of the app. Treat as informational, not a live contract obligation —
but don't delete it from a Rust port without confirming with product/eng
whether it's mid-rollout or abandoned.

---

## 3. Auth & session

Two independent, coexisting auth mechanisms, distinguished purely by which
`localStorage`/`sessionStorage` key is populated — there is no explicit
"mode" flag:

- **Customer (role 5) auth**: phone + OTP. `sessionStorage["customer_auth_token"]`
  holds the access JWT (session-scoped — cleared on browser close, by
  design). `localStorage["customer_refresh_token"]` exists as a key name in
  the codebase but is only ever **removed**, never **set** — refresh relies
  on an httpOnly cookie instead (`refresh()` calls
  `POST /customer/auth/refresh` with `withCredentials: true` and no body).
  `localStorage["customer_user"]` caches the hydrated `CustomerUser` object
  for instant UI restore on page refresh, read before `checkAuth()` resolves.
- **Guest auth** (dine-in QR / shop QR ordering, no login): `localStorage["guest_auth_token"]`.
  Set as a side effect of `POST /guest-orders`, `POST /market-checkouts`
  (from `childOrders[0].guestToken`), `POST /market-checkouts/:id/guest-token`
  (recovery), and best-effort by `POST /auth/guest-token` (§2.13). Persists
  across tabs/sessions (it's in `localStorage`, not `sessionStorage`) —
  explicitly **not** cleared on a 401 (`api.ts:211-218`, comment: "guest
  tokens are independent from customer auth and should persist for order
  tracking... 401 errors from SSE/polling should not invalidate guest
  sessions").

**Request header logic** (`api.ts:63-91`, every request):
```
Authorization: Bearer <customer_auth_token>          // if present
             else Bearer <guest_auth_token>           // fallback
X-Request-ID: <crypto.randomUUID()>                    // always, fresh per request
X-Restaurant-ID / X-Table-ID: from JSON.parse(localStorage["makanmakan_restaurant_context"])
```
The restaurant-context header injection is wrapped in try/catch — a malformed
blob just skips the two headers with a console warning, it does not fail the
request.

**Token shape assumption**: `@makanmasak/utils`'s `getRefreshDelay`/
`isTokenExpired`/`getTimeUntilExpiry` (`packages/utils/src/token.ts`) decode
the JWT payload **client-side** (base64url → JSON, no signature check) and
require standard numeric `exp`/`iat` claims in **Unix seconds**. Proactive
refresh is scheduled at 80% of the token's `(exp - iat)` lifetime,
recalculated after every successful `verifyOtp`/`refresh`/`checkAuth`. A Rust
JWT issuer must keep `exp`/`iat` as numeric-seconds claims or this silently
breaks (the decode helper returns `null` on malformed payloads and the
proactive-refresh scheduling is just skipped, no error surfaced).

**Router guard** (`router/index.ts:337-379`): routes with `meta.requiresAuth`
redirect to `Login` unless `authStore.isAuthenticated` **and**
`authStore.checkAuth()` (a live `GET /customer/me`) both succeed. Routes
additionally marked `meta.allowGuestToken` skip all of that if
`localStorage["guest_auth_token"]` is present — no token validity is checked
client-side in that branch (an expired/invalid guest token would only be
caught by the first API call's 401).

**401 handling** (`api.ts:147-156`): any `401` response clears
`customer_auth_token`/`customer_refresh_token` (never the guest token) and
surfaces `ApiException("UNAUTHORIZED", translate("messages.sessionExpired"))`.
There is no automatic retry-after-refresh — the interceptor does not attempt
a token refresh transparently on 401; refresh only happens proactively
(scheduled timer) or explicitly in `checkAuth()`'s fallback path.

---

## 4. Realtime usage

### Live, in-use path: order status tracking (`views/OrderTrackingView.vue`)

Only exercised for **guest sessions on the shop-order tracking screen**
(`shouldUseGuestRealtime = hasGuestToken && !hasCustomerToken`). Logged-in
customer sessions viewing the same page get **no WebSocket at all** — they
rely purely on the one-shot `GET /orders/:id` query plus manual
`refetch()`/`refetchOnWindowFocus`.

1. Guest-realtime token is cached at `localStorage["makanmakan_guest_realtime_token:<restaurantId>:<tableId>:<orderId>"]`
   as `{token, expiresAt}`; reused until `new Date(expiresAt) <= Date.now()`.
2. On cache miss, reads a previously-cached signed table QR from
   `localStorage["makanmakan_table_qr:<restaurantId>:<tableId>"]` — **if that
   key is missing, the connection attempt throws synchronously** ("Missing
   signed table QR code") rather than falling back to any other auth path.
3. Calls `POST /realtime/auth/guest-token` (§2.2) with
   `{restaurantId, tableId, orderId, qrCode}` → gets back `{token, expiresAt, wsUrl}`.
4. **Ignores the returned `wsUrl`** and connects to a client-constructed URL:
   `${VITE_WS_BASE_URL}/customer/${tableId}?token=${encodeURIComponent(token)}`.
   Room addressing is therefore `customer:${tableId}` on the `apps/realtime`
   side (matches the "public WS routes" key scheme documented in
   `realtime.md` §"Keying / addressing" — `index.ts`'s `/customer/:tableId`
   route, **not** the `restaurant:`/`group_order:` keys some server-side
   broadcasters use).
5. On WS `close` with a non-clean code (`1008`, `4001`, or `1006`) **and** the
   attempted URL contained `token=`, the client treats it as an
   auth-rejection: clears the cached guest-realtime token
   (`onAuthFailure` callback) before the next reconnect attempt, so a fresh
   token gets minted. Any other close code is treated as a plain network
   drop and just reconnects with the same (still-cached) token.
6. Reconnect backoff: `useWebSocket` (`composables/useWebSocket.ts`) does
   exponential backoff, `reconnectInterval * 2^(attempt-1)`, capped at
   `reconnectAttempts` (default 5) total attempts before giving up
   (`connectionStatus = "error"`, no further retries).
7. Heartbeat: client sends the **literal text frame `"ping"`** every 30s
   (`heartbeatInterval`); server auto-responds `"pong"` at the DO/Cloudflare
   level per `realtime.md` (`setWebSocketAutoResponse`) without waking the
   DO. Client's `onmessage` special-cases `event.data === "pong"` to a no-op
   before attempting `JSON.parse`.

**Message consumption** (`handleWebSocketMessage`, `OrderTrackingView.vue:443`):
only reacts to `RealtimeEventType.ORDER_STATUS_UPDATE` (string value
`"order_status_update"`) events whose `data.orderId === props.orderId`
(string match — everything else, including other event types entirely, is
silently ignored). On match:
- Patches the TanStack Query cache entry `["order", orderId]`:
  `{...current, status: message.data.status, updatedAt: new Date(message.timestamp).toISOString()}`.
  **`message.timestamp` is read as a JS `Date`-constructible value** (used
  with `new Date(...)`) — the shared-types `BaseRealtimeEvent.timestamp` is
  typed `number` (Unix ms), so this expects epoch-milliseconds, not seconds
  or an ISO string.
- Shows a toast using `message.data.status` looked up through the client's
  own `getStatusTitle()` map (`pending/confirmed/preparing/ready/delivered/
  paid/cancelled/refunded` — must match the `Order.status` string union
  exactly, else falls back to `"unknown"` i18n text but doesn't error).

**Type-system inconsistency worth flagging for a rewrite**: the WebSocket
plumbing (`useWebSocket.ts`, `useOptimizedWebSocket.ts`) types its generic
`onMessage` callback as `WebSocketMessage` (from
`packages/shared-types/src/websocket.ts` — **UPPER_SNAKE** `type` values like
`"ORDER_STATUS_UPDATE"`, nested `data: OrderUpdateData`), but the one real
consumer (`OrderTrackingView.vue`) casts incoming messages to `RealtimeEvent`
(from `packages/shared-types/src/realtime-events.ts` — **lower_snake**
`RealtimeEventType.ORDER_STATUS_UPDATE = "order_status_update"`, flatter
`data` shape) and switches on that instead. These are two different,
non-interchangeable wire formats declared in the same shared-types package;
the actual runtime behavior follows the `realtime-events.ts` shape (lowercase
enum strings) since that's what the one live view checks against. A Rust
rewrite of the realtime service must emit `type: "order_status_update"`
(lowercase, matching `RealtimeEventType`), not `"ORDER_STATUS_UPDATE"`, or
this client's only real WS consumer silently drops every message (the
`if (message.type !== RealtimeEventType.ORDER_STATUS_UPDATE) return;` guard
fails closed with no error).

### Defined but unreachable/dead WS paths

- `useOrderTracking(orderId)` / `useRestaurantStatus(restaurantId, tableId)`
  (`composables/useWebSocket.ts:253-332`) connect to
  `${VITE_WS_BASE_URL}/orders/${orderId}/tracking` and
  `${VITE_WS_BASE_URL}/restaurants/${restaurantId}/status` respectively —
  **neither path exists in `apps/realtime`'s router** per `realtime.md`
  (`/customer/:tableId`, `/admin/:restaurantId`, `/kitchen/:restaurantId`,
  `/health` are the only routes). **No view imports either function** —
  confirmed dead code that would 404 if ever called.
- `useRealtimeNotifications.ts` connects to
  `${VITE_REALTIME_WS_URL}/customer` (no room id at all) — env var
  undefined (§1), and unreachable (not imported by any view/component).
- `useGroupOrder.ts` mints a token via `POST /realtime/auth/token` with
  `{roomType: "customer", roomId: groupOrderId, restaurantId, tableId}`, then
  connects to `${VITE_REALTIME_URL}/customer/${groupOrderId}?token=...`.
  This independently reproduces a bug already catalogued in
  `realtime.md` §"Keying / addressing": server-side group-order broadcasts
  key on DO `group_order:${groupOrderId}`, while this client would connect
  to DO `customer:${groupOrderId}` — even if reachable, the two would never
  meet. Moot today since the composable is unreachable (§2.14), but if this
  feature is ever revived server-side, the client wiring needs a matching
  fix, not just an env var.
- `useOptimizedWebSocket.ts` — a connection-pooling variant with circuit
  breaker/message-queue/visibility-pause logic — is fully implemented but
  **imported nowhere** in the app. Fully dead code. Deleted 2026-10-07.

### No SSE usage

No `EventSource` usage anywhere in `src/`. All "realtime-ish" behavior other
than the one WS path above is done via polling (waiting-list ticket: 5s/10s
adaptive interval, paused on tab-hidden — §2.9) or plain one-shot fetch +
manual refresh (market checkout tracking has no polling or WS at all —
confirmed no `refetchInterval`/`setInterval`/`WebSocket` in
`MarketCheckoutTrackingView.vue`).

---

## 5. Error handling contract

**Envelope the client expects** (`ApiResponse<T>`,
`packages/shared-types/src/common.ts`):
```ts
{ success: boolean; data?: T; error?: { code: string; message: string; details?: unknown }; pagination?: {...} }
```
This matches the unified error format mandated in this repo's `CLAUDE.md`.

**Response interceptor logic** (`api.ts:110-168`):
1. On any HTTP 2xx: if `response.data.success === false` **and**
   `response.data.error` is present, the interceptor **throws** an
   `ApiException` even though the transport-level status was success — i.e.
   the client treats `{success:false}` in a 200 body as an error regardless
   of HTTP status code.
2. On network failure (`!error.response`, e.g. DNS/timeout/CORS): throws
   `ApiException("NETWORK_ERROR", translate("messages.networkError"))`.
3. On HTTP `401`: clears customer tokens (not guest), throws
   `ApiException("UNAUTHORIZED", translate("messages.sessionExpired"))`.
4. On any other HTTP error status: `normalizeApiError()` tries, in order:
   `error.error` as a plain string → wraps as `INVALID_REQUEST`; else
   `error.error.code`/`.message` (or `.error` as a message fallback) if
   `error.error` is an object; else falls back to a **status-code-keyed i18n
   message table** (400/403/404/409/429/500/502/503/504 have translated
   defaults, anything else → generic `"unknown"` message) with code
   `INTERNAL_SERVER_ERROR`.
5. `apiClient.request()` re-throws `ApiException` as-is, but wraps any
   *other* thrown value (e.g. a plain JS error from axios internals) as
   `ApiException("INTERNAL_SERVER_ERROR", translate("errors.requestFailed"), originalError)`.

**Retry logic**: `API_CONFIG.retries = 3` / `retryDelay = 1000` are defined
as constants (`api.ts:21-26`) but **never referenced anywhere else in the
file or the codebase** — axios has no retry interceptor wired up. There is
**no automatic HTTP retry** despite the config object suggesting one exists.
(Retry-like behavior does exist, but only in the separate offline
background-sync queue — §2.12 — which is a manual re-queue on failure, not a
transport-level retry.)

**Status codes the client branches on explicitly**: only `401` (see above).
`orderApi.getTableCurrentOrder` additionally catches and special-cases `404`
specifically (returns `null` instead of throwing) — this is the **one** call
site in the entire app that inspects `error.status` for anything other than
401. All other 4xx/5xx just bubble up as a generic `ApiException` for the UI
layer to toast.

**What UI code actually reads off a caught error**: overwhelmingly just
`.message` (via `handleApiError()`, `api.ts:348-358`, or ad hoc
`err.message`/`err instanceof Error ? err.message : ...` fallbacks scattered
across views). `.code` and `.details` are typed on `ApiException` but no view
was found branching on `.code` — the error **code taxonomy exists in the
type system but is not consumed** by any customer-app UI logic found in this
pass; only the human-readable `.message` matters for what the user sees.

---

## 6. Rust rewrite compatibility notes

Concrete, verified sensitivities — preserve these exactly or the client
breaks silently (no schema validation exists anywhere on this client; a
shape drift is a runtime `undefined`/`NaN`/blank-UI bug, not a thrown error):

1. **Envelope must be `{success, data, error}` at the HTTP layer even on
   error responses**, per §5 point 1 — a `200` with `{success:false}` is
   treated as a failure; a non-2xx status with a *missing* `error` object
   falls back to a generic status-code message (still non-fatal, but loses
   the specific server-provided message).
2. **`apiClient` unwraps `response.data.data`** — every backend response
   body must be `{success, data: <payload>}`; if a route ever returns the
   payload directly at the top level (no `data` wrapper), the client's `"data"
   in response.data ? response.data.data : response.data` fallback happens
   to handle it, but any route that returns `{success, data: null}` for an
   intentionally-empty success (e.g. `204`-equivalent) will unwrap to `null`
   correctly; a route that omits `data` **and** puts payload fields directly
   alongside `success`/`error` also degrades gracefully. The one case that
   breaks: a payload whose own top-level shape happens to contain a key
   literally named `data` (e.g. `{success, dataForSomething: ..., data:
   "something-else"}`) — the client would incorrectly return
   `response.data.data` instead of the full object. Not observed in current
   routes, but worth avoiding.
3. **Timestamps**: `Order.createdAt/updatedAt/confirmedAt/preparingAt/
   readyAt/deliveredAt/paidAt/cancelledAt` are typed `number` (Unix
   **milliseconds**) per `packages/shared-types/src/order.ts:93-100` (explicit
   comment: "Unix-ms integer wire contract"). `OrderTrackingView.vue` passes
   these straight into `formatDateTime()` and into timeline objects without
   any string-to-Date parsing step — **sending ISO strings instead of epoch
   ms will not throw, but will render "Invalid Date" or NaN-based output**
   silently. `WaitingListEntry`/`WaitingListResponse` timestamps
   (`createdAt`, `calledAt`, etc.) are likewise `number` (ms). By contrast,
   `GuestRealtimeTokenResponse.expiresAt` and
   `MarketCheckoutResponse.checkout.createdAt` are typed **`string`** (parsed
   via `new Date(parsed.expiresAt)` in `OrderTrackingView.vue:399` and
   `MarketCheckoutTrackingView.vue`) — i.e. **this API mixes epoch-ms numbers
   and ISO-8601 strings for "when did this happen" fields depending on
   which entity it's attached to**, and the client has no tolerance for the
   two being swapped.
4. **JWT claims**: `exp`/`iat` must be present as numeric Unix **seconds**
   (standard JWT convention) — decoded client-side with no signature
   verification, purely to schedule proactive refresh (§3). Missing/malformed
   claims don't error, they just silently disable proactive refresh (session
   then only refreshes reactively via 401 + `checkAuth()`'s fallback).
5. **`RealtimeEvent.type` values must be the lowercase snake_case strings**
   in `RealtimeEventType` (`"order_status_update"`, etc.), **not** the
   UPPER_SNAKE `WebSocketMessage.type` variants defined in the sibling
   `websocket.ts` file — see §4's type-inconsistency callout. This is the
   single highest-impact contract detail for the realtime service: get it
   wrong and the one live WS consumer (order tracking) silently stops
   updating with no client-visible error.
6. **`RealtimeEvent.timestamp` is epoch-ms**, consumed via `new
   Date(message.timestamp)` (§4) — same epoch-ms-vs-string trap as point 3,
   applied to the WS channel specifically.
7. **String vs numeric IDs are inconsistent by table, and callers must match
   the specific field's type exactly**: `Order.id`/`restaurantId`/
   `customerId`/`waitingListId` are UUID `string`; `Order.tableId`,
   `MenuItem.id`/`categoryId`, `OrderItem.menuItemId`, `Category.id` are
   `number`. `orderApi.updateOrderItem`/`.addOrderItem`/`.removeOrderItem`
   take `orderId: number` in their TS signatures despite `Order.id` being
   `string` elsewhere in the same file (`orderApi.ts:384,402,420` vs.
   `Order.id: string`) — this is a pre-existing type inconsistency in the
   client itself (not something the backend caused), but it means at least
   one of these call sites is passing a numeric-looking string or an actual
   number where the rest of the contract expects a UUID string; flag if
   auditing `apps/api`'s matching routes, since one side of this mismatch is
   wrong and it isn't obvious which without reading the route handler.
8. **Cents vs. major units, mixed within the same feature**: order-level
   money (`Order.subtotal/taxAmount/serviceCharge/discountAmount/
   totalAmount`, `OrderItem.unitPrice/totalPrice`) is cents (`number`,
   comment "in cents"). `MenuItem.price/originalPrice` is cents too. But
   `useCurrency().formatPrice()` — used for on-screen order totals in
   `OrderTrackingView.vue` (`formatPrice(order.subtotal ?? 0)` etc.) — is
   documented in its own file as accepting **major units, not cents** ("e.g.
   320 = NT$320"). Cross-checking `formatPrice` call sites against `Order`'s
   "in cents" comment is out of scope for this pass (would require reading
   `packages/utils`'s `formatCurrency` + every call site), but it's a
   concrete unit-mismatch risk worth a dedicated audit before relying on
   either doc comment at face value. `ServiceBooking`/`MarketCheckout*`
   fields use an explicit `*Cents` naming convention throughout
   (`priceCentsSnapshot`, `depositRequiredCents`, `subtotalCents`, etc.) —
   that half of the contract is self-documenting; the plain `Order`/`
   MenuItem` fields are not (cents is only known from a code comment, not
   the field name).
9. **Two different shapes returned from the same-looking `/orders/:id/receipt`
   path** depending on which client function calls it —
   `orderApi.getOrderReceipt(orderId: number)` expects `{orderId, receiptNumber,
   items[], summary, paymentInfo?, restaurant, generatedAt}`, while
   `customerOrderApi.getOrderReceipt(orderId: string)` expects a differently
   shaped `{orderNumber, restaurantInfo, customerInfo, tableInfo?, items[],
   summary, paymentInfo, timestamps}`. Only one of these can be correct for
   a given real backend route; both exist in the client unreconciled. Verify
   against the actual `apps/api` route before porting either shape as "the"
   contract.
10. **Guest-order response wrapping is inconsistently tolerated**:
    `POST /guest-orders` is expected to return `{order, guestToken,
    tokenExpiresAt}` (flat, no extra wrapper around `order`), but
    `GET /guest-orders/:orderId` is defensively unwrapped as `"order" in
    response ? response.order : response` — i.e. the client's author wasn't
    sure whether this specific GET wraps its `Order` in `{order: ...}` or
    returns it bare, and hedged. A Rust rewrite should pick **one** shape for
    the GET and it will work either way client-side, but this is a signal
    that the existing backend's behavior here may itself be inconsistent
    release-to-release — worth checking `apps/api`'s actual handler rather
    than assuming either branch is "the" intended shape.
11. **`OrderPaymentStatus` is a numeric enum** (`PENDING=0, PAID=1,
    FAILED=2`) while **`OrderStatus` is a string union**
    (`"pending"|"confirmed"|...`) on the same `Order` object — don't
    normalize one to match the other's convention without updating both the
    type and every string/number comparison site.
12. **`WebSocket` auth-failure detection is a heuristic, not a protocol**:
    the client infers "the server rejected my token" purely from
    `attemptedUrl.includes("token=") && [1008,4001,1006].includes(closeCode)`
    (`useWebSocket.ts:167-171`). Code `1006` (abnormal closure) is bundled in
    as an auth-failure signal even though it's the generic "connection died
    without a close frame" code — any transient network blip on a
    token-bearing URL will be misclassified as an auth failure and trigger
    an unnecessary token re-mint (`onAuthFailure` → `POST
    /realtime/auth/guest-token` again) before reconnecting. A Rust
    `apps/realtime` should prefer a clean, distinct close code for actual
    auth rejections (e.g. keep using `1008`/`4001` consistently) since `1006`
    can never be reliably attributed to auth server-side or client-side.
