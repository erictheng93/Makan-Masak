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
