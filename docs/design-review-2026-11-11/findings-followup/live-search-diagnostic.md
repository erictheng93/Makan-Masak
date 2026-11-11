# Live manual restaurant search diagnostic

**Verdict: expected demo-store exclusion, not a frontend parsing defect.** No code, visibility flags or production records were changed.

## Anonymous production evidence

Read-only checks on 2026-11-11:

- `GET https://api.makanmasak.com/api/v1/discovery/restaurants?q=Demo&limit=10` returned HTTP 200 and `{"success":true,"data":{"results":[],"total":0,"page":1,"limit":10}}`.
- The public restaurant endpoint for `01a0d2b6-61ba-744e-89f9-75f5296a8e11` returned `name: "Demo 小館"`, `isActive: true`, `isAvailable: true`, `isDemo: true`, `deletedAt: null`, `status: 1`, and `enableShopMode: true`.

Being active and having menu records does not make a demo restaurant eligible for anonymous discovery. The separate `isDemo: true` flag explains why this shop is absent from the search response. Its public showcase/read route can remain available while public discovery excludes it.

## Contract and visibility check

- `apps/customer-app/src/services/menuApi.ts:222`: manual search requests `/discovery/restaurants?q=...&limit=...` and returns `response.results`.
- `apps/customer-app/src/services/api.ts:315`: the API client unwraps the outer `data` envelope, so that `results` access matches the actual discovery contract.
- `apps/customer-app/src/components/ManualInputModal.vue:320`: the modal stores that returned array. An empty successful array produces the existing “No matching restaurants” message.
- `apps/api/src/features/discovery/routes/index.ts:77`: the public route returns `{ success: true, data: results }` from `browseRestaurants`.
- `apps/api/src/features/discovery/services/DiscoveryService.ts:605`: browse requires `isAvailable = true`, `isActive = true`, **`isDemo = false`**, and no deletion marker. The Demo query uses this direct filter path, not the district cache path.
- `packages/database/src/schema/restaurants.ts:85` and `packages/database/migrations_fresh/0033_restaurant_is_demo.sql` explicitly describe demo stores as excluded from discovery/search/popular results and protected from real ordering/booking actions.
- The existing `apps/api/src/__tests__/integration/demo-restaurant.real.integration.test.ts` case “keeps the demo shop out of discovery browse” checks that only the non-demo shop appears. This test was inspected, not rerun against production.

## Scope and action

The release workspace and original workspace both resolve to commit `a1d8fdbbebdcc8439599ceeded070a39626b26e0`; the relevant release-workspace source was read directly after graph lookup/coverage checks. The original workspace was not edited.

No fix or new test is warranted for this observed result. The existing exclusion must remain intact; changing or bypassing it would expose a deliberately excluded showcase restaurant. A positive manual-search production test needs an explicitly authorized non-demo public restaurant, or should use the demo store's intended direct showcase entry.

No authenticated data, credentials, database writes, commit or deployment were used for this diagnosis. Verification consisted of the two anonymous HTTP reads and source/contract inspection.

## Demo-store ordering QA boundary

Direct table/shop entry is useful for read-only UI QA: generated QR routing, menu content, dish details, local cart edits and displayed totals. It is intentionally not a successful production-order sandbox.

- **Shop flow:** `ShopMenuView` displays the existing demo banner and passes `isDemo` to `ShopCartModal`. `ShopCartModal.handleCheckout` checks this flag before constructing or submitting an order; it opens `demo-order-notice` and returns. Expected result: the existing demo explanation/application link/continue-browsing action, with no create-order request from that checkout branch.
- **Table flow:** `CartView` allows the normal confirmation UI and has no equivalent frontend demo short-circuit. Its final confirmation invokes the ordinary guest/member order API. The shared `packages/database/src/services/order.ts:656` creation guard rejects an `isDemo` restaurant with HTTP 403 / `DEMO_RESTAURANT` before creating the order. `OrdersService` delegates ordinary creation to this shared service. Expected result if final submission is exercised by the QA operator: demo refusal, not a successful new order.
- The existing demo integration test “refuses a guest order at the demo shop and writes nothing” checks HTTP 403, the demo error code and zero inserted order rows. Public restaurant reads and menu records remain available independently of this guard.
- Restaurant reservation and waiting-list creation also have explicit demo refusal guards. This diagnostic did not exercise their mutation endpoints.

Consequently these demo accounts can verify menu/cart/QR presentation and the demo stop condition, but cannot prove a successful new-order → kitchen → tracking → payment lifecycle. That needs a separately authorized non-demo test restaurant or the documented non-demo staging seed. Do not change the discovery policy or clear the demo flag just to make the test pass.

The no-order/no-payment statement above is limited to the checked new-order path and the shop frontend's early return. It is not a blanket claim that every admin mutation, service-booking endpoint, historical-order payment API or other module is a no-op whenever the account's restaurant is a demo. No payment action or backend mutation was performed for this diagnosis.
