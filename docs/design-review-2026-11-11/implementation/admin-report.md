# Admin production interface implementation

Task 3 covers all 60 audited source views, including employee and seating children. Existing production templates, data, routes, role/module checks, translations, APIs and money handlers were retained. No preview/sample records or dependencies were added. Shell/header/sidebar spacing, typography, readable semantic text, orange management actions, restrained panels and white summary strips now follow the approved operations direction.

## Verification

- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-admin-dashboard test --maxWorkers=2`: **154 files, 1172 tests passed** (81.25s). The plain Node invocation exposed the environment's experimental global localStorage; the explicit Node flag lets the existing jsdom storage work. No production/test storage workaround was added.
- New mounted checks were observed failing before implementation and then passing for dialog naming/focus/Tab/Escape/return, cancellation error association/reason retention, and feedback filter reset. The translated scheduling navigation expectation was updated. Focused run: **6 files, 41 tests passed**. Final auth status/recipient checks also failed before their change and then passed: **2 files, 10 tests passed**.
- `pnpm --filter makanmasak-admin-dashboard typecheck`: passed application and test configurations.
- `pnpm --filter makanmasak-admin-dashboard lint:fix`: passed; final subsequent `lint` passed, and `lint:fix` passed after the named auth status additions.
- `pnpm --filter makanmasak-admin-dashboard build`: passed; Vite 30.35s, CSP bundle guard passed (132 files). Controller owns the final build of the frozen combined checkout; final subsequent edits were presentation/accessible labels only.
- `pnpm run check:design-palette`: passed.
- `git diff --check -- apps/admin-dashboard`: passed.
- Impeccable detector run once over the app: 661 warnings, no errors. Broad typography/color/radius findings describe incumbent Tailwind/custom code; Inter and the retained palette are pinned by DESIGN.md. The placeholder image finding is a test stub, not shipped content. One low-contrast monitoring action was corrected. No unrelated service-layout animation was changed.
- Actual desktop/390px route captures and measurements are owned by the controller's final evidence pass. Its detected toolbar button width regression was corrected by limiting the app min-width override to div/label/section, preserving shared 44px button minimums.

## Per-page audit dispositions

Each row below also received an actual production page/panel/toolbar/heading/scroll treatment where applicable; this is not a replacement preview renderer. All recorded admin recommendations were verified against their current source and implemented; no admin row was discarded as a false positive.

| Source view | Disposition |
| --- | --- |
| `AccountManagementView.vue` | Unique label/control IDs and required/error descriptions for owner/admin forms; existing creation and reset flows retained. |
| `AnalyticsView.vue` | Named analysis-period field beside export; white summary strip, wrapping header and readable tables. |
| `BillingView.vue` | Deep semantic active/inactive badge text; restrained plan, usage and module panels; existing support actions retained. |
| `BroadcastsView.vue` | Existing no-restaurant message now includes translated context-selector recovery guidance; composer and send flow retained. |
| `CashierView.vue` | Refund entry uses soft orange/deep ink; primary collection actions use admin accent. Money, discount, shift and refund handlers unchanged. |
| `CouponsView.vue` | Wrapping title/actions and orange primary creation button; existing coupon conditions and modal handlers retained. |
| `DashboardView.vue` | Revenue/order period selectors have visible translated names; operational metrics share one white summary strip. |
| `FeedbackView.vue` | Visible search/status/category/priority labels, current conditions and reset action; reset cancels pending debounce and reloads page one. |
| `ForgotPasswordView.vue` | Translated task h1 replaces brand heading; named success status shows the actual requested email, with existing login recovery retained. |
| `GroupOrdersView.vue` | Page canvas uses ios-bg; share code, member and recovery sections retain their real data and actions in restrained white panels. |
| `KitchenView.vue` | Translated kitchen heading/status, existing dedicated kitchen URL and billing support route exposed through the existing module gate. |
| `LoginView.vue` | Task h1, compact brand and existing shop identity/switch before credentials; authentication handlers unchanged. |
| `MarketOpenReportView.vue` | Single membership now identifies its actual market; multi-membership selector and report submission scope unchanged. |
| `MembersView.vue` | 44px arrow/page controls and aria-current for active page; existing phone previous/next controls retained. |
| `MenuView.vue` | Visible associated field names for item and repeated size/add-on/customization values; per-record IDs preserve unique associations. |
| `MonitoringView.vue` | Universal transition narrowed to interactive controls and status elements; shared reduced-motion rules remain effective. |
| `MyAttendanceView.vue` | Missing-restaurant state now explains existing context-selection recovery, retaining the real clock panel for valid sessions. |
| `MyLeavesView.vue` | Visible per-request cancellation-reason label and linked inline failure; failed cancellation retains typed reason and existing toast. |
| `MyShiftsView.vue` | Named modal, initial focus, Tab/Shift+Tab containment, Escape dismissal and return focus using one small shared directive. |
| `NotFoundView.vue` | Task h1 and quiet 404 identifier; existing home/back actions now precede secondary quick navigation. |
| `OptionGroupsView.vue` | Both existing group and choice dialogs are named, keyboard-contained, Escape-dismissible and restore trigger focus; existing wrapped labels retained. |
| `OrdersView.vue` | Named status/type/source filters, wrapping toolbar and existing result count/search/order handlers retained. |
| `OwnerView.vue` | Visible revenue-period field with shared touch sizing; white operational summary strip and readable heading hierarchy. |
| `POSManagementView.vue` | Associated quick-payment, checkout, cash movement and register/shift fields; real payment confirmation handlers unchanged. |
| `POSView.vue` | ios-bg canvas and horizontally scrollable pill mode switch; actual nested views and clock retained. |
| `PlatformCustomersView.vue` | 44px pagination targets with existing previous/next names and aria-current. |
| `PlatformMarketCheckoutsView.vue` | Visible market identifier, payment status and anomaly labels; existing date names and filters retained. |
| `PlatformMarketsView.vue` | Public-quality list and gaps precede indexing/applications/import controls, now grouped in a native secondary disclosure; all existing handlers retained. |
| `PlatformOnboardingApplicationsView.vue` | Existing real applications table now sits in a named, keyboard-focusable horizontal scroll region inside its white panel. |
| `PlatformOverview.vue` | Actual restaurant names allow two lines and expose full title; address wraps and existing card actions remain available. |
| `PrintAgentsView.vue` | Visible issuing labels associated with real fields; shared focus-visible outline remains visible despite incumbent outline-none. |
| `ResetPasswordView.vue` | Translated task h1 and compact brand; verification, invalid-link and success states now have named status/alert regions, with password rules retained. |
| `ReviewsView.vue` | Each real review draft has a unique ID and associated reply label; shared focus-visible rule preserves visible keyboard focus. |
| `ServiceBookingsView.vue` | Date/status and existing form labels associated with native fields; booking status and actions remain in existing rows. |
| `ServiceView.vue` | Named table/priority fields with shared 44px targets in wrapping operational toolbar. |
| `SettingsView.vue` | Original native switch input retained, 44px label height with centered track and explicit focus-visible track outline. |
| `SubscriptionsView.vue` | Plan selector and activation control name the actual restaurant identifier; per-row updating state and existing confirmations retained. |
| `TableDetailView.vue` | Existing back action shares the table header and shared 44px target; QR secondary actions and data unchanged. |
| `UnauthorizedView.vue` | Task h1, account/features h2 hierarchy and existing recovery actions moved ahead of diagnostics. |
| `ai-analytics/AIInsightsDashboard.vue` | Moving shimmer replaced by static ios-bg skeleton; existing generation/loading text and report data retained. |
| `ai-analytics/AIProviderConfig.vue` | Unique associated key/model/endpoint fields; existing test results are announced and described by all connection fields. |
| `ai-analytics/ProductAnalyticsView.vue` | Visible analysis-period field, separate existing categories and readable panel/table hierarchy. |
| `employees/AttendanceOverviewTab.vue` | Summary labels raised to readable 70% ink with existing values/statuses; white summary strip. |
| `employees/EmployeeDetailView.vue` | Scrollable non-shrinking tab names with existing router active state and reduced phone shell spacing. |
| `employees/EmployeeLeaveTab.vue` | Readable balance/date/reason text; reasons wrap instead of truncating, retaining quota and textual status. |
| `employees/EmployeeListTab.vue` | Named role/account-status/search controls; existing upper employment-state switch retained. |
| `employees/EmployeeManagementView.vue` | Readable inactive tabs and existing router-link aria-current/underline state in scrollable navigation. |
| `employees/EmployeeProfileTab.vue` | Readable summary/activity labels with values kept adjacent in a white summary strip. |
| `employees/EmployeeScheduleTab.vue` | Readable summary/actual hours; overtime retains text in a deep orange warning badge. |
| `employees/LeavesTab.vue` | Associated existing leave-type configuration labels/fields, preserving code restrictions and saving state. |
| `employees/SchedulingTab.vue` | 44px date arrows preserve existing navigation handlers; date range and today remain grouped. |
| `forecast/ForecastView.vue` | Wrapping task header and refresh/generation controls, preserving existing disabled and generation state. |
| `ingredients/IngredientsView.vue` | Add ingredient is first and orange primary; recipes/import remain secondary wrapping actions; real inventory flow retained. |
| `scheduling/SchedulingAnalyticsView.vue` | Noninteractive stat hover displacement removed; standard radius and soft shadow with real detail actions retained. |
| `scheduling/SchedulingView.vue` | Translated scheduling navigation label, aria-pressed current mode and existing panel switching; wrapping actions retained. |
| `seating/QueueDashboardTab.vue` | Visible queue-status filter label in wrapping queue header; call-next remains primary and existing queue behavior retained. |
| `seating/ReservationTab.vue` | Unique associations for existing filter and creation fields; existing conditions/result count preserved. |
| `seating/SeatingManagementView.vue` | Readable non-shrinking scrollable tab labels and restrained white real-data summary strip. |
| `seating/TableSetupTab.vue` | QR preparation/batch actions made secondary, warning actions use soft orange/deep text; table creation remains primary. |
| `seating/WaitingListTab.vue` | Call-next uses soft orange/deep ink and shared 44px sizing; existing batch-calling state retained. |

## Final review corrections

- Employee detail quick-info rows now allow email and translated date text to wrap; only tab links remain non-shrinking and nowrap. Matching employee profile values also wrap. The controller is checking a real 390px route with the long-email ApiUser response, because the default audit fixture rendered an API-error header and could not expose this regression.
- Existing translated accessible names now cover ServiceLayout notifications, scheduling previous/next, and coupon pagination arrows. Header notifications already had its translated name; a focused assertion now locks it in.
- Existing mounted tests were extended without new test doubles: Scheduling/Coupons checks failed before the labels and passed afterward. Final focused command `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-admin-dashboard test src/components/layout/Header.test.ts src/views/employees/SchedulingTab.test.ts src/views/CouponsView.test.ts src/views/MyShiftsView.test.ts src/views/OptionGroupsView.test.ts --maxWorkers=2`: **5 files / 38 tests passed**.
- Final follow-up validation: `pnpm --filter makanmasak-admin-dashboard typecheck` passed for application and tests; `pnpm --filter makanmasak-admin-dashboard lint` passed; `git diff --check -- apps/admin-dashboard` passed.
- The shared focus directive is now `src/utils/dialog-focus.ts`; both actual view imports were updated.

## Monitoring phone health card review correction

The final screenshot showed the desktop icon/summary row clipping its status badge, update time and gauge inside the health panel. Only this MonitoringView block was adjusted: phone icon/summary stack, minimum-width-zero summary, wrapping title/status and metric fields, and a centered gauge on its own phone row. Existing desktop row composition, health calculations and handlers are retained. No CSS-string tests were added. Existing `MonitoringView.test.ts` passes **15 tests**; app/test typecheck and targeted ESLint pass. The controller owns the desktop/phone screenshot confirmation.
