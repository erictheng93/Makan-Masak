# Findings follow-up, release and real QA

User explicitly authorized: verify the submitted findings, repair confirmed defects, push the intended commits, deploy production frontends, then log in using the supplied test accounts and exercise real desktop/mobile flows. Passwords must remain outside files and reports. Preserve the two unrelated queue-core receipt formatter edits; do not stage or deploy them.

## Assessment

- Shared CSS findings 1–3 reproduced using the existing built admin CSS in Chromium at 390 and 1100px: both pagination rows visible, switches 44×44, heading display flex. `built-css-before.json` preserves the RED measurements.
- Root correction: import the shared CSS through each app's main stylesheet so Tailwind can place `.ui-*` in its components layer before utilities; remove separate main.ts import. Native heading elements use block layout. Exclude semantic switches from global visual minimum dimensions and extend their transparent hit area to 44px. Added switch semantics to the two integrations toggles; existing alert-rule switch then inherits the correction. Normal action controls retain the 44px floor.
- Confirmed customer visibility/focus/card findings and fixes: [customer report](customer.md).
- Confirmed admin operations/discard/label findings and fixes: [admin report](admin.md). Menu ID generation bug predates the UI rollout; new labels exposed the existing duplicate IDs.
- Portal dismissal, kitchen animation and onboarding assertion findings: [other apps report](other-apps.md).
- Independent source review found a new nested-confirmation keyboard trap during the repair. It was reproduced, corrected using the existing local dialog-focus behavior, and independently cleared. See [independent review](independent-review.md).

## Local evidence

- Five frontend builds completed (9/9 build graph tasks).
- Existing actual-component interaction regression suite: 78/78 checks, zero scenario errors, in `local-interaction-checks.json`.
- Built CSS checks: 10/10 app/viewport cases. The admin includes the actual pagination utilities and tests all three reported CSS regressions; the other apps record which utility classes exist, because Tailwind removes classes unused by that app. Heading and normal-action dimensions are checked across all five. Compact switch checks apply to customer/admin/kitchen, with an actual pointer hit outside the visible track to verify the enlarged hit area.
- Kitchen animations, reduced motion, Escape dismissal and post-leave focus restoration: 10/10 browser scenarios. Customer order cards: real card-surface navigation, nested cancellation controls and Enter activation at both sizes.
- Focused and whole-app test results are in the three scoped reports. A full clean-checkout release gate and real production QA follow these local checks; the local fixtures do not certify production services.

## Release checklist

- Finish focused checks and independent source review; run five production builds, built-CSS browser checks and targeted real-component browser regression checks.
- Commit intended UI changes only. Use a clean isolated release checkout for full `pnpm verify:push`, builds and deployment so unrelated working-tree edits cannot ship.
- Push to origin main only after the full gate passes. Follow repository deployment configuration; deploy the five changed Pages frontends, keeping backend/data/schema outside this UI release.
- Confirm deployment identities/assets on production hosts, then use actual test-account login UI at admin/kitchen for desktop and mobile. Record actual API errors, absent data and unavailable scenarios rather than replacing them with local fixtures.
- Persist a production QA result with screenshots, successful operations and explicit untested/blocked paths. No secret/session-token storage in committed evidence.

This directory supplements the previous local-layout evidence. Existing `implementation/production-checks.json` and screenshots describe the earlier source revision and must not be presented as validation of this follow-up release.

## Live QA and additional findings, November 12

The first follow-up release was pushed as `a1d8fdbbe` and deployed to all five Pages apps after the full release gate passed. Production UI checks then found additional defects, now corrected in the follow-up patch:

- Platform-admin order statistics omitted the selected restaurant. Alert routes allowed roles 0/1 but only read the session restaurant. Explicit, validated administrator context now reaches statistics and all alert actions; owners remain pinned to their session restaurant, and tenant/status mutation predicates and 404 nondisclosure remain unchanged. Tests also cover late responses from a previously selected restaurant. No migrations are required.
- Kitchen phone Grid pills were compressed by flex layout; the existing scrolling row now keeps its buttons from shrinking.
- Customer order confirmation was visible but lacked a dialog role and focus containment. It now uses the installed dialog primitives, a safe Cancel focus, loading dismissal protection and actual-opener focus return.

The six additional user findings were assessed individually:

| Finding | Verdict and correction |
| --- | --- |
| License Escape loses input | Partly confirmed: the old form retained values when reopened, but lacked dirty/busy dismissal protection. Added that protection, including one prompt per backdrop click. |
| Kitchen shift dialog immediately focuses textarea | Confirmed; initial focus now goes to the noneditable heading. |
| Kitchen History three-column phone dividers | Confirmed; local three-column separator rules replace the inherited two-column pattern. |
| Discovery simultaneous failures retry only one request | Confirmed; independent failure flags retain both retry targets and preserve the active search/filter mode. |
| Market section links grow browser history | Confirmed; links preserve native href/keyboard/modifier behavior and replace the current hash while scrolling. |
| Dialog container Shift+Tab can escape | Confirmed; container focus now wraps to the last focusable descendant. |

See [independent follow-up review](live-fixes-review.md) and the scoped reports for RED/GREEN evidence. The review found and independently cleared the redundant license-backdrop discard prompt. Production reproduction, final rechecks and screenshots are kept separately from local fixtures in the task's `production-qa` artifact folder.

The supplied accounts belong to an `isDemo` restaurant. Public Discovery deliberately excludes it; direct table/shop browsing and local cart operations are supported, but real order creation is prohibited. The user explicitly limited this round to Demo-permitted flows. See [live search diagnostic](live-search-diagnostic.md). No restaurant flags were changed, and no real order or payment is needed for this QA scope.
