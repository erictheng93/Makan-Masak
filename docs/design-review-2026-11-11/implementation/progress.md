# Implementation ledger — docs/superpowers/plans/2026-11-11-approved-ui-rollout.md

Base commit: 8f85a3958. User authorized implementation, per-page desktop/mobile review and local atomic commits. No push/deploy requested.

- Task 1 shared foundation: implemented/imported in five applications. Real Discovery touch target check RED 21px → GREEN 44px. Specificity raised after phone checks found rem-based min-h-11 could override the zero-specificity default.
- Task 2 customer: all 31 views implemented; 904 tests passed. Browser regressions corrected and verified, including manual-entry focus return and Discovery retry. See customer-report.md.
- Task 3 admin: all 60 views implemented; 1174 tests passed. Toolbar targets, long employee identifiers and Monitoring phone clipping corrected and verified. See admin-report.md.
- Task 4 kitchen/platform/onboarding: all 22 views implemented; respective suites 184/56/58 passed. Real browser dialog and language-menu checks passed. See other-apps-report.md.
- Task 5 production evidence: 226/226 desktop/phone captures and 78/78 local interaction checks passed. Independent source and visual reviews have no remaining blocker within their stated limits. Final affected gate 35/35, frontend build graph 9/9 and local real integration graph 11/11 passed. Supplemental per-page scrolling evidence is recorded separately.
- Production UI committed as 099113379; original approved preview unchanged. No production business data writes, push or deployment.

Rulings:

- Keep approved preview immutable as design history. Production checks and after-images live in this implementation directory.
- Short Chinese error states are valid rendered content; do not fail pages using an arbitrary English-sized text-length threshold. Unavailable data/API scenarios remain explicitly labelled and do not certify normal backend flows.
- Guest routes get clean isolated authentication state; an inherited signed-in session redirect is a harness issue, not a production defect.
- Existing jsdom lacks ResizeObserver needed by real Headless UI dialogs. A minimal browser-platform test setup shim is permitted; real browser focus/Escape/restore checks remain necessary. No new application service doubles or dependencies.
- Optional no-test-doubles script reports extensive pre-existing repository violations and is not part of pnpm verify. Do not rewrite it or unrelated tests to turn this UI task into a test infrastructure migration.
- Preserve existing unrelated changes in packages/queue-core/src/print/formatters/ReceiptFormatterFactory.ts and its test; never stage them.

- Supplemental review found Menu phone final Add covered by fixed cart; corrected Menu/personal/group and ShopMenu using measured bar height and safe area. Browser RED hit=false → GREEN exposed + real action in both sizes. Fix commit 256ccadb4; affected gate and five-app build rerun passed, final interactions 78/78.
