# Customer findings follow-up

All assigned customer findings were checked against the actual Vue templates and handlers. The listed regressions are genuine. Primary operations are now visible without opening a disclosure, and the existing routes, API calls, feature gates and monetary calculations are preserved.

## Verdicts and changes

| Finding | Verdict and evidence | Correction |
| --- | --- | --- |
| MarketDetail basket hides phone and checkout | True. The basket was a closed native `details`; its phone input and checkout action were descendants. The new mounted assertion failed before the fix. | Restored the basket as a visible section. |
| Market basket shortcut does not open its target | True. The shortcut was only an anchor to the closed disclosure and had no opening behavior. | Its target is now always-visible basket content, so ordinary anchor navigation exposes the actual controls without another click. |
| Reservation cancellation hidden after success | True. Creation sets `verifiedReservation`, but the cancel action belonged to the closed lookup disclosure. | Restored the lookup/result section as visible content; creation exposes its existing cancellation action immediately. |
| Group host invite code/link hidden | True. The active group's real `InvitePanel` was inside a closed disclosure despite already having appropriate active/locked/completed guards. | Removed the extra disclosure. Existing invitation title, code, link, QR, copy/share handlers and group-state guards remain. |
| Markets favorites/recent visits hidden | True. Both record lists were under closed disclosures. Existing text-only tests found their content but did not check disclosure visibility. | Restored both lists as visible sections. |
| Markets recent order tracking hidden | True. The tracking rows were under a third closed disclosure. | Restored the visible recent-orders section and retained the existing tracking route and availability guard. |
| OrderHistory lost whole-card navigation | True. Clicking the card's blank surface did not navigate in actual desktop or phone Chromium; the new browser regression failed on both sizes before the fix. | The original native order-number link now stretches over the card surface. Detail/cancel actions and reviews remain above that surface and retain independent interaction. No click handler or button role was added to the card container. |
| Service booking availability feedback squeezes the date row | True. The feedback block was a third child of the date/query horizontal row. A mounted failed-availability case reproduced that structure. | Moved feedback below the controls so it cannot consume their row width. |
| Reservation and service booking jump back to creation confirmation after cancellation | True. Each confirmation watcher ran whenever its record changed, including replacement with the cancelled version. Real mounted DOM tests demonstrated the wrong focus destination. | Creation handlers now move focus to the creation confirmation only after successful creation. Cancellation moves focus to the updated local lookup result, which exposes its status. Payment and lookup no longer trigger the creation focus effect. |
| Related service booking task disclosures | True. Lookup/cancellation was closed by default and creation closed after a booking existed. | Restored these primary task sections as visible content while retaining all existing fields and handlers. |

Market checkout availability is intentionally unchanged: disabled checkout/phone controls still show their existing unavailable reason, and recent checkout tracking remains guarded when that feature is disabled. This patch fixes visibility without bypassing a backend feature gate.

## Verification

Failing checks were added first. Eight cases across the existing market, group, reservation and service mounted tests failed on the original closed disclosures, date feedback placement and cancellation focus. The real-browser order-card check separately failed on blank-card navigation at both widths.

- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/views/market-detail-view.test.ts src/tests/views/group-order-views.test.ts src/tests/views/markets-view.test.ts src/tests/views/reservation-view.test.ts src/tests/views/service-booking-view.test.ts src/tests/views/order-history-view.test.ts --maxWorkers=2`: **6 files, 118 tests passed**.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app test --maxWorkers=2`: **101 files, 907 tests passed**.
- `node apps/customer-app/src/tests/browser/order-history-card.mjs`: **1100px and 390px passed** for blank-card surface navigation, independent nested cancellation and Enter activation of the native order link. This saved check reuses the isolated local review-data harness and makes no production writes.
- `pnpm --filter makanmasak-customer-app typecheck`: passed.
- `pnpm --filter makanmasak-customer-app lint`: passed with zero warnings.
- Formatting and diff whitespace checks passed for the owned changes.
- The scoped design detector returned no findings for the six changed views.

No CSS-string tests or business-logic replacements were added. Source and test index coverage was checked; the graph's recorded partial ranges in the existing group test were read directly. Browser evidence uses actual production Vue components with isolated local records; it is not a claim of live backend or production deployment validation.

No commit, push or deployment was performed by this worker. Shared CSS, entrypoint imports, other applications and the receipt formatter changes belong to other work and were preserved. The controller owns final review, deployment and production QA.

## Additional findings from actual production QA (2026-11-12)

| Finding | Verdict and root cause | Correction |
| --- | --- | --- |
| Cart confirmation is visible but has no accessible dialog or keyboard focus management | Confirmed by the controller's live desktop/phone QA and by three failing mounted regressions before this fix. This was the pre-existing `ConfirmationModal.vue`, unchanged by the rollout. Scoped graph plus source reads found exactly two callers: CartView and OrderTrackingView. | Reused installed Headless UI Dialog/Panel/Title/Description. Initial focus goes to Cancel (or the panel while loading); Tab stays inside; Escape/outside click emit Cancel unless loading. Closing restores the actual focused opener, including when its clicked child is a span. Existing confirm/cancel events, caller business handlers, disabled states, copy and button animations remain. |
| Discovery cannot recover both popular and browse/search failures | Confirmed: one shared last-error key lost which of two independent entry requests had failed. Five new store/view regressions failed before the fix, covering both completion orders and both browse/search modes. | Retain independent failure flags alongside the existing error key. Retry snapshots both flags before issuing requests and reruns only the failed operations, retaining current query, filters and mode. Normal entry request counts and API shapes are unchanged. |
| Market page section links add extra Back steps | Confirmed in real Chromium: the first native section link increased history length from 3 to 4. | Kept native hrefs and modified-click behavior. Ordinary clicks/Enter use existing router.replace and existing hash scroll behavior; query filters survive. Basket scroll margin matches the other sections. |

Validation after these changes:

- RED before implementation: ConfirmationModal **3 failures / 27 existing passes**; Discovery **5 new failures / 35 existing passes**; market browser check failed at the first history-length assertion.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/views/discovery-view.test.ts src/tests/stores/discovery.test.ts src/tests/views/market-detail-view.test.ts src/tests/components/ConfirmationModal.test.ts --maxWorkers=2`: **4 files, 103 tests passed**.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run --maxWorkers=2`: **101 files, 916 tests passed**.
- `pnpm --filter makanmasak-customer-app typecheck` and `pnpm --filter makanmasak-customer-app lint`: **passed, zero lint warnings**. Initial local checks caught a component-ref type and browser-helper lint errors; these were corrected before the passing run.
- `node apps/customer-app/src/tests/browser/confirmation-modal.mjs`: **Cart and OrderTracking both passed at 1100×844 and 390×844**: visible named/described dialog, safe Cancel initial focus, forward/reverse Tab containment, Escape dismissal, Cancel button, actual opener focus restoration. No confirmation or order mutation was performed. Uses existing isolated local review data against the release worktree server on 4420. Phone screenshot was visually inspected; evidence images are `production-qa/demo-customer-confirmation-local-390.png` and `demo-customer-confirmation-local-1100.png` under the allowed visualization folder.
- `node apps/customer-app/src/tests/browser/market-section-navigation.mjs`: **both widths passed** for Enter-activated native links, correct targets scrolled into view, unchanged history length, one Back returning to Markets.
- Node 26's experimental global storage must be disabled for the existing jsdom storage-dependent suite. The unsupported `--minWorkers` option was removed from the first attempted command; neither runner setup error was attributed to product code.

Independent actual production Owner QA also finished: **39 passed, 0 failed, 0 page errors, 0 business writes** at desktop 1440×900 and phone 390×844. Real menu has 8 dishes; 牛肉 search yields exactly 1. Orders empty/filter feedback, 2 seating tables/QR close, mobile sidebar, unsaved OptionGroups keyboard/discard/focus return, and unsaved AddItem unique live option IDs/select labels passed. Existing OptionGroups edit/delete was not applicable because the real list was empty. Evidence: `production-qa/demo-owner-results.json` and `demo-owner-*.png`. Original mobile menu and desktop unsaved-form screenshots were inspected. No Owner source change was necessary. Harness-only first-pass false positives are disclosed in the results JSON.

These customer changes are left uncommitted for the controller. No production writes, deployment, payment or order confirmation was performed by this worker. The controller owns final production recheck after redeploy.
