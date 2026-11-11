# Customer production rollout — 2026-11-11

Implemented in the existing Vue templates and components for all 31 customer source views. The blue/white treatment uses the existing customer accent, palette, copy, translations and business handlers. No product sample records, dependencies, routes, credentials or money calculations were added. The controller owns the shared stylesheet import in `main.ts`.

## View and audit mapping

Issue references below use the original source line numbers in `customer-audit.json`.

| Source view | Original issue lines | Implemented result |
| --- | --- | --- |
| AboutView | 8 | 24px white card, light shadow and preserved section content. |
| CartView | 43, 207 | Footer measured with the existing VueUse ResizeObserver utility using its border box; content reserves its current height plus spacing. Footer includes bottom safe area. Coupon input has a real label and the list trigger exposes its disclosure state. **Corrected audit finding:** available coupons already defaulted to collapsed (`ref(false)`); retained that state rather than introducing another switch. |
| DiscoveryView | 83, 195 | Retry reuses the current query and filters; empty results have an action that clears both query and all filters before browsing again. Service actions wrap and have 44px targets. |
| ErrorView | 27 | Recovery description uses readable ink at 70%. |
| ForgotPasswordView | 62 | Identifier and OTP errors linked to their fields; invalid state, alert errors and status result retain account-enumeration-safe responses. |
| GroupOrderJoinView | 139 | Missing-invitation state includes a home recovery action, while network failures retain retry. |
| GroupOrderView | 359, 436 | Invitation content is a native disclosure. Host automatic submission setting and its existing on/off description are immediately before submission. Switch has a 44px target. |
| HomeView | 315, 105 | Spacious blue/white entry panel; scanning is the blue primary action and the other three entries use white surfaces. PWA title, purpose and install action have dedicated labels in all six supported locales. Existing actions and recent restaurant records retained. |
| LoginView | 29, 61 | Shared 44px controls; individual error IDs, invalid/described states, alert server failures and focus to the first validation error. |
| MarketCheckoutTrackingView | 170, 330 | Voucher field has a label; errors announce as alerts, success/payment updates as status. Vendor orders use restrained white panels with their existing restaurant/status/amount content. |
| MarketDetailView | 301, 228 | Same-page vendor/product/map navigation preserves mounted components and all events; maps follow browsable content. Basket becomes a native disclosure with a sticky navigation entry. Unavailable checkout disables the phone field and links it to the existing explanation. |
| MarketsView | 38, 131 | All four filters have accessible names. Favorites, recent visits and recent orders are native disclosures. Primary result heading shows its actual loaded count. |
| MenuView | 64, 164 | Named back/cart controls including actual cart count, labeled search and selected category states. Removed nested horizontal padding; matched featured/category gutters to the remaining 16px page gutter to eliminate the measured phone overflow. |
| NotFoundView | 7 | Smaller secondary 404 identifier/icon keeps the existing explanation and recovery actions closer to the start. |
| OrderHistoryView | 138, 129 | Order number and detail action are RouterLinks; the card remains an ordinary container with independent review/cancel interactions. Blue entry actions and dark amounts replace the orange gradient treatment. |
| OrderTrackingView | 9, 118 | Header return and continue-ordering share one computed shop/table destination. Header return is named. Current status is polite live content; progress exposes label, minimum, maximum and current value. |
| OrderTypeLandingView | 103 | Native mutually exclusive radios inside whole-card labels, with a named group and visible focus. Existing enabled methods and continuation logic retained. |
| PrivacyView | 13 | Existing translated section headings form anchor navigation. Policy text uses a 70ch measure, 1.65 line height and consistent section spacing. |
| ProfileView | 52, 136 | White profile summary, blue identity/actions and lighter shadows. Details stack on phones and values use min-width zero plus anywhere wrapping for long identifiers. |
| QRScanView | 11 | Named back, flashlight and dismiss actions; flashlight exposes pressed state. Touch areas are 44px while the camera/manual-entry flow remains intact. |
| RegisterView | 133 | Each field describes its own error, with invalid state and alerts. Password describes the existing rule when there is no error; email-sent result uses status. |
| ReservationView | 66, 270 | All fields and lookup code have labels/IDs; available slots expose their selected state. Feedback is local to availability/create/lookup actions with alert/status semantics. Confirmation scrolls into view and receives focus. Lookup uses a native disclosure. |
| ResetPasswordView | 19 | Missing-token alert includes recovery to the existing forgot-password screen, preserving login recovery. |
| ServiceBookingView | 150, 302 | All date/contact/voucher/notes/payment/lookup fields are associated with labels. Creation errors are described by the inputs. Feedback belongs to its active availability/create/payment/lookup task. Creation is an initially open native disclosure that closes on success, can be reopened for another booking, and leaves focus at the confirmation/payment result. Lookup is a separate disclosure. |
| ShopMenuView | 437, 631 | Empty-services explanation is compact disclosure content in the services section. Actual dishes remain primary. Floating cart includes safe-area offset and main content reserves clearance. Back/cart controls are named. |
| SignedOrderEntryView | 26 | Failed signed QR entry retains retry and adds return to the existing scanner. |
| TermsView | 8 | All original translated terms retained, with section anchor navigation, readable measure and line height. |
| VerifyEmailView | 18 | Polite status boundary announces pending/success, failed result is an alert and the existing conditional login action remains. |
| waiting-list/JoinWaitingListView | 133 | Existing queue totals/time appear above the form. Notification unavailability remains next to joining; lookup/history retain secondary white actions. |
| waiting-list/MyWaitingTicketView | 28, 118 | Visible translated h1, polite ticket-state and parties-ahead updates. Arrival uses contrast-safe green-700. |
| waiting-list/WaitingListHistoryView | 94 | Named 44px back control and padded 44px open-ticket action; terminal tickets remain without that action. |

Shared customer styling also strengthens semantic text contrast using existing deep tokens and keeps headings/long text wrapping. Real `MenuItemCard` price/action rows and `CartItemCard` amounts/quantity controls wrap when space is tight. Cart item and desktop cart remove/quantity controls now include the real dish name in their accessible labels.

## Verification evidence

- Focused regressions were demonstrated failing before implementation for missing fulfillment selection semantics, reservation label associations, and empty-result clearing. Existing mounted component tests were extended, with no new test doubles.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app test --maxWorkers=2`: **101 files, 899 tests passed** after the main rollout and cart child-control changes. Initial plain invocation hit the pre-existing Node runtime `localStorage` exposure problem; the environment flag uses the repository's jsdom storage as intended.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/views/service-booking-view.test.ts src/tests/components/localized-menu-name-rendering.test.ts --maxWorkers=2`: **2 files, 23 tests passed** after keeping the successful booking form available through a disclosure.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/views/order-type-landing-view.test.ts --maxWorkers=2`: **10 tests passed** after converting fulfillment selection to native radios; the radio-specific assertion was first confirmed failing.
- `pnpm --filter makanmasak-customer-app typecheck`: passed.
- `pnpm --filter makanmasak-customer-app lint`: passed with zero warnings after the attribute-order fixes.
- `pnpm --filter makanmasak-customer-app build`: passed, including CSP-safe bundle validation. Existing upstream Zod annotation warnings were emitted by Rollup.
- `git diff --check -- apps/customer-app`: passed.
- Design detector run once across changed views/components/styles: 14 notices. Five rounded-border detections are spinner arcs; four side-border detections are scanner frame corners. Remaining notices concern the pre-existing scanner animation and scrollbar radius/gray literals. No newly added literal colors were reported.
- Actual local Vue Home was visually inspected at **390×844 and 1100×820**, with no horizontal page overflow. This inspection found that `min-h-11` was 38.5px under the existing 14px phone root, overriding the shared zero-specificity minimum. The controller corrected shared selector specificity; it also owns the comprehensive 62-view/device screenshot rerun and API-unavailable records in the customer-app entries of `production-checks.json`.

Graph coverage was checked for all 31 views and additionally relied-on cart components, tests and API/store files. Initial view coverage had no recorded gaps; changed files were read directly after edits. This is best-effort source/index evidence, not a completeness claim about the graph.

No commits, push or deploy were performed by this worker. The controller owns final review, application-wide screenshots and atomic commits.

## Independent review follow-up

The new discovery retry originally called `searchDishes("")` after an initial browse failure. That method intentionally avoids both search requests without a query or search scope, so retry silently switched to an empty search screen. Mounted regression checks first failed for both initial browse retry and popular-load retry. The recovery action now repeats the popular operation for its distinct error, or preserves the current search/browse mode and original query/filters otherwise. Existing search submission and store/API contracts are unchanged.

`NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/views/discovery-view.test.ts src/tests/stores/discovery.test.ts --maxWorkers=2`: **35 tests passed**, including the three retry cases. Customer lint passed. The first follow-up typecheck found an inferred test fixture property issue; the assertion now checks the object shape directly, and the final customer typecheck passed.

Removed the erroneous “back” accessible-name override from the Profile order-history quick action, allowing its existing visible label to supply the name. The separate icon-only header back link keeps its proper label. Other added back labels were inspected against their real navigation handlers.

## Manual-entry dialog follow-up

The Home and camera manual-entry flow now uses the installed Headless UI `Dialog`, `DialogPanel` and `DialogTitle`. Its existing search field receives initial focus; the dialog supplies its named boundary, keyboard containment, Escape dismissal and focus restoration. Close and clear-selection icons are named. Existing copy, fields, debounced search, validation, loading behavior, selection events and close/reset handlers remain intact.

A real mounted regression first failed on the missing dialog role, then passed with the real teleported dialog: accessible title, initial search focus, named close, Escape close event and focus restoration to the trigger. The existing search regression continues to prevent onboarding placeholders and now also confirms the selected restaurant's exact event payload. Only a jsdom `ResizeObserver` platform shim was added; no new business-service doubles were introduced.

`NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/components/manual-input-modal.test.ts src/tests/views/home-view.test.ts src/tests/utils/qr-parser.test.ts --maxWorkers=2`: **3 files, 11 tests passed**. Customer typecheck passed. Final lint and formatting passed after correcting attribute order. The targeted dialog design detector reported only existing spinner arc notices.

## Real-browser focus-restoration correction

The first dialog unit test opened a component while a bare trigger button was already focused. Real Home clicks hit a nested span or SVG inside the button. The installed Headless UI restoration history records those click targets and can choose a connected child that cannot receive focus; Escape then left focus on `BODY`. A second mounted regression opens the already-mounted closed component after clicking the trigger's nested span. It reproduced that exact failure before the fix.

The component now captures the actual focused control before opening and restores it after the close update and portal cleanup. It restores only a still-connected control while the dialog remains closed. Headless UI continues to own the dialog boundary, initial focus, Tab containment and outside-click/Escape close behavior.

Actual isolated Chromium checks reused `installReviewData` and the existing production Home, at widths **1100** and **390**, with the sequence manual trigger click → last dialog control focus → Tab → Escape → detached dialog. Both initially failed with focus on `BODY`; both now pass with focus on the original `BUTTON[data-testid="manual-input-btn"]`. The captured focus sequence after the fix is trigger → restaurant input → cancel → focus guard → original trigger.

`NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/components/manual-input-modal.test.ts src/tests/views/home-view.test.ts --maxWorkers=2`: **2 files, 4 tests passed**. Customer typecheck, lint, formatting and whitespace checks passed after the correction. The controller will refresh the canonical cross-app interaction artifact.

## Scrolled menu clearance correction

The phone viewport inspection found the final table-menu dish price and add action behind its fixed cart bar. The general phone `main` rule overrode the view's `pb-20`, and the table menu's personal/group bars also lacked the shared safe-area offset class. The controller reproduced the last add button's center being covered at 390px before this patch.

Both `MenuView` and `ShopMenuView` now use the same existing `useElementSize` border-box measurement as `CartView`. Each actual floating bar is referenced directly; below the existing 1024px desktop breakpoint, its view reserves measured bar height plus top/bottom spacing and the bottom safe area. The two mutually exclusive table/group bars share that measurement and both have the safe-area bottom offset. Desktop retains its existing styles. The fix does not depend on sibling order; existing Cart checkout clearance and Home installation-prompt behavior remain unchanged.

Affected routes: `/restaurant/:restaurantId/table/:tableId` (personal and group ordering) and `/restaurant/:restaurantId/shop/menu`.

`NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/views/menu-view-table-validation.test.ts src/tests/views/shop-menu-services.test.ts src/tests/views/shop-menu-ordering-gate.test.ts --maxWorkers=2`: **3 files, 41 tests passed**. Customer typecheck, lint, formatting and whitespace checks passed. No CSS-string tests were introduced. The controller owns the existing real-browser geometry/click regression and refreshed desktop/phone top/bottom screenshots.
