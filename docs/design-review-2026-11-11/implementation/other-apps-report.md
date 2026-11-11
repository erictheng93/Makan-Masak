# Kitchen, platform and onboarding implementation

Task 4 applies the approved production UI direction to all 22 source views. Existing routes, authentication, role checks, requests, deployment/policy actions, application fields, legal copy and translations remain in place. No dependency, sample business record, remote write, branch or commit was added by this worker. The controller owns the shared CSS imports and final all-page capture/review.

## Audit dispositions

All 26 recommendations for these 22 views were confirmed against the source and addressed. No false positive was identified.

| App / source view | Disposition and production changes |
| --- | --- |
| kitchen / EnhancedKitchenDashboard | Token-based named loading state; removed spinner hex values. Sticky header sizes naturally with wrapped controls; real ticket grid uses one/two/three columns, full item names, readable semantic pills, stable cards and 56px ticket actions. Existing grid/kanban, item/batch handlers and SSE flow retained. |
| kitchen / HistoryView | Loading, failed API envelope/exception and successful empty response are distinct. Failure offers retry. Statistics appear only after success; date filters expose pressed state and wrap/scroll locally. Added translated load failure text in all six locales. |
| kitchen / LoginView | Password visibility control has an explicit 44px target. Existing named show/hide state and authentication handlers retained. Primary fill uses a readable blue step. |
| kitchen / MyShiftsView | Existing swap form is a named Headless UI dialog with initial reason focus, focus containment, Escape and focus return; scrollable phone panel. Exact request payload and submit/cancel behavior retained. |
| kitchen / NotFoundView | Existing login destination now uses the existing re-login label, with safe horizontal padding and readable message width. |
| kitchen / SettingsView | Three switches expose role/state, retain the 44×26px visual track inside 44px targets, and keep the thumb inside the track. Volume has a name. Disclosure rows are native buttons and their existing picker content uses named focus-managed dialogs. |
| kitchen / UnauthorizedView | 24px horizontal padding, readable message width and existing single login exit retained. |
| portal / DashboardView | Recent tenants table has an Actions header and tenant-specific detail link names. Statistics are one restrained strip; existing health, tenant and priority work remains. |
| portal / DeploymentsView | Target version has associated label/id; selected count and entered version are visible beside the action. Version controls wrap on phones; batch deployment handler unchanged. |
| portal / HealthView | Heading and refresh action wrap; last update is beside refresh. Readable statistic strip and wrapping attention rows preserve the existing priority information and refresh handler. |
| portal / LicensesView | License generator uses named Headless UI dialog; tenant/tier/date have associated labels. Keyboard focus/escape/return supplied by existing dependency. Footer is clipped to the rounded panel boundary. License actions unchanged. |
| portal / LoginView | Existing alert has id; token field references it and exposes invalid state. Token exchange/session storage/redirect behavior is unchanged and covered by its existing harness. |
| portal / MarketsView | Every metadata input/select/textarea has a persistent visible associated label, with basic/location, media/classification and opening-hour grouping. Original values, validators, membership, CSV preview/import and publishing behavior retained. |
| portal / NotFoundView | Home recovery retained; previous-page action appears only for a valid local history entry. Added all six translations for its label and a real-router/native-history regression test. |
| portal / PoliciesView | Existing wrapping policy labels provide at least 44px targets and clear selected controls. Country/market scope, inherit/save/clear operations retained. |
| portal / TenantDetailView | Named horizontal navigation has non-shrinking tabs and current-page state. Only the tab/table regions scroll horizontally. Existing resource/deploy/health/license content and actions retained. |
| portal / TenantsView | Search and status have associated visible labels. Controls stack on phones; real table stays in its own scroll region. Existing filtering, empty results and tenant creation retained. Tenant creation itself now uses a named focus-managed dialog and a named close action. |
| onboarding / ApplicationStatusView | Loading/error/pending/provisioning/approved/completed/rejected get truthful icons; only approved/completed use success. Status summary is announced and long values wrap; rejection text remains complete. Secret-link and service-error behavior unchanged. |
| onboarding / ApplyView | The exact original form fields and two actual steps remain. Both steps are named, current step exposed. Address/country/city precede the coordinate group, with existing geolocation/manual coordinates and validation. Contact fields share a desktop grid and stack on phones. |
| onboarding / FindApplicationView | Home is a 44px secondary action. Privacy-preserving, non-enumerating email result and existing status announcement unchanged. |
| onboarding / HomeView | Primary buttons and highlighted headline use primary-700. Hero leads with the existing actual dashboard tour image; the complete four-screen real product tour, claims, demo-shop gating and application/recovery links remain. Features are a quiet supporting row. |
| onboarding / SuccessView | Summary wraps long IDs/email. Copy ID has an accurate translated action name, 44px target and copied announcement. Existing next-step copy is ordered platform review then login information in a numbered list. Status secret handling retained. |

## Verification

Commands ran with `PATH=/opt/homebrew/opt/node@24/bin:$PATH` because the default Node 26 environment lacks usable test localStorage. The installed Node 24 runtime resolves that environment issue without changing repository configuration.

| Command | Result |
| --- | --- |
| `pnpm --dir apps/kitchen-display test` | PASS: 32 files, 184 tests |
| `pnpm --dir apps/management-portal test` | PASS: 15 files, 56 tests |
| `pnpm --dir apps/onboarding-app test` | PASS: 11 files, 58 tests |
| `pnpm --dir apps/kitchen-display exec vitest run src/views/MyShiftsView.test.ts src/components/orders/OrderDetailsModal.test.ts src/stores/orderManagement.test.ts src/stores/settings.test.ts src/services/kitchenApi.test.ts` | PASS: 5 files, 42 focused tests |
| `pnpm --dir apps/kitchen-display typecheck` | PASS |
| `pnpm --dir apps/management-portal typecheck` | PASS |
| `pnpm --dir apps/onboarding-app typecheck` | PASS |
| `pnpm --dir apps/kitchen-display lint:fix` and subsequent `lint` | PASS |
| `pnpm --dir apps/management-portal lint:fix` and subsequent `lint` | PASS |
| `pnpm --dir apps/onboarding-app lint:fix` and subsequent `lint` | PASS |
| `pnpm --dir apps/kitchen-display build` | PASS |
| `pnpm --dir apps/management-portal build` | PASS |
| `pnpm --dir apps/onboarding-app build` | PASS |
| `pnpm run check:design-palette` | PASS: no off-palette app colors |
| `git diff --check -- apps/kitchen-display apps/management-portal apps/onboarding-app` | PASS |

Focused RED→GREEN checks cover history loading/error/retry/empty, swap naming/focus/Escape/return, Settings switch state and keyboard sheet behavior, order-detail naming/Escape, cancellation of a named batch confirmation without execution, token error association, persistent market labels, safe previous-page recovery, real application step/field order, truthful status icons including approved/loading, and accurately named copy confirmation. Existing tenant modal tests now exercise its real portal instead of a Teleport stub. No new business-service doubles were introduced.

Ruling from the controller: add a minimal ResizeObserver compatibility shim to existing kitchen/portal test setup. It provides observe/unobserve/disconnect because jsdom has no layout observer; no service behavior is faked by it. Real browser dialog behavior was separately checked below.

## Real phone interaction evidence

Read-only isolated Chromium checks used the controller's `local-review-data.cjs`, 390×844, blocked all remote requests, and never submitted business forms.

- Kitchen language menu: wraps outside any scrolling action strip; English option x57/y201/158×44, center hit-test reaches the button, document width390. Selecting English changes the real kitchen UI. Screenshot: `/tmp/task4-header-language-mobile.png`; runnable check `/tmp/task4-header-check.cjs`, output `/tmp/task4-header-check.log`.
- Kitchen urgent-time sheet, portal license generator, portal tenant creation: each has a name, initial focus inside, Tab containment, Escape dismissal and focus return; each document width390. Screenshots: `/tmp/task4-settings-dialog-mobile.png`, `/tmp/task4-license-dialog-mobile.png`, `/tmp/task4-tenant-dialog-mobile.png`; runnable check `/tmp/task4-dialog-check.cjs`, output `/tmp/task4-dialog-check.log`.
- One combined visual inspection found a switch thumb positioning defect and the license footer escaping rounded corners; both were corrected in the final CSS/template batch. The bounded confirmation passed all three real phone dialog checks again, and visual confirmation shows the switch thumb within its track.

The controller's 1100×820 and 390×844 all-source captures and unavailable-service inventory are the comprehensive Task 5 evidence. Browser fixtures demonstrate real component layout/local interactions, not deployed backend certification.

## Limits and blockers

No remaining Task 4 implementation blocker. Remote authentication, ordering, deployment and policy writes were intentionally not exercised. The graph coverage batches had no recorded source issues; the known EnhancedKitchenDashboard test parse gap at line35 was read directly. The default-runtime storage failure and the first local Chromium launch restriction were environmental; Node24 and the approved isolated browser invocation resolved them.
