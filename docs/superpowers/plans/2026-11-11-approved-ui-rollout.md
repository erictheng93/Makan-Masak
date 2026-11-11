# Approved interface rollout implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task by task.

**Goal:** Apply the approved five-app design direction to the real Vue interfaces, then inspect every routed source view at desktop and phone sizes.

**Architecture:** Preserve the existing routes, components, data and event handlers. Add a small common CSS foundation, apply task-specific layout classes to the existing templates, and correct the concrete accessibility/state defects recorded in the approved audit. The HTML preview supplies visual direction, never replacement business logic or sample data for production.

**Tech Stack:** Existing Vue 3, TypeScript, Tailwind 3, pnpm, Vitest and Playwright. No dependencies added.

**Spec:** `docs/design-review-2026-11-11/README.md`, `customer-audit.json`, `operations-audit.json`, and the approved `preview.html` in the same directory. User explicitly approved implementation and final desktop/phone checks on 2026-11-11.

## Global constraints

- Preserve DESIGN.md and design-tokens.js, translations, legal text, routes, role checks, APIs and money calculations.
- Implement the audit's 133 specific recommendations after verifying each against current code; record any corrected false positive.
- Production contains no preview/sample records, new external services, or test credentials.
- Work in the current authorized checkout, preserve the two pre-existing receipt formatter changes, commit only intended UI work, do not push or deploy.
- Shared CSS is owned by the controller. Workers own disjoint application directories, excluding main.ts imports owned by the controller.
- Use existing tests for behavior regression; add focused failing checks for state, navigation or accessibility behavior changes. Do not add test doubles or tests that only mirror CSS strings.

## Review focus

- At 390px, long translated headings and identifiers must wrap; only table/tab/map regions may scroll horizontally.
- Fixed cart controls must not cover the final fields, errors or safe-area space.
- Dialogs must support named boundaries, keyboard dismissal, focus containment and return focus.
- Error/loading states must remain distinguishable from a successful empty response.
- Authentication, ordering, payment, staff changes and other actions must continue calling the existing handlers; visual checks must never write production business data.

## Task 1 — Shared foundation (controller)

Files: create `packages/shared/styles/app-ui.css`; import it in each of the five `apps/*/src/main.ts` files. Reuse tokens with Tailwind theme references. Provide readable neutral text, 44px control targets, visible focus, restrained panels, consistent page headers, horizontally scrollable tables/tabs, reduced motion and safe-area helpers. Preserve native input behavior. Verify the existing first-screen touch/overflow measurements before and after, and build all five apps.

## Task 2 — Customer (worker, 31 views)

Own `apps/customer-app` except main.ts. Read all customer rows of the audit and actual components. Apply the approved customer blue/white layout, regroup the existing Home/menu/cart/tracking/profile flows, preserve each reservation/market/group-order function, and address all 31 views' recorded issues. Test cart/layout-associated behavior, shop/table return navigation, form associations, selected states and announcements with existing checks and the real browser.

## Task 3 — Restaurant operations (worker, 60 views)

Own `apps/admin-dashboard` except main.ts. Implement each operations-audit row for this app, including nested employee/seating views. Improve shell/header, typography, restrained summary panels, wrapping filters and real tables; preserve POS, cash, subscriptions and employee workflows. Test any changed dialog/navigation semantics and run relevant app tests, typecheck, lint and palette checks.

## Task 4 — Kitchen/platform/onboarding (worker, 22 views)

Own `apps/kitchen-display`, `apps/management-portal`, `apps/onboarding-app`, except main.ts. Implement all corresponding audit recommendations and the approved domain-specific layouts. Kitchen gets legible stable tickets and touch controls; history separates loading/error/empty. Platform retains token authentication, tenant/deployment/policy functions. Onboarding retains the exact application fields and uses truthful status icons. Run focused state/accessibility tests and app checks.

## Task 5 — Real-component verification and review (controller)

Reuse the existing route inventory and isolated local screenshot data setup, recording every unavailable API and redirect honestly. Inspect all 113 source views with screenshots at 1100×820 and 390×844, including parent-container evidence and extra Settings variants. Check overflow, control names, relevant touch targets, errors and broken content; inspect representative screenshots for all five apps. Exercise existing handlers locally, run frontend suites and the repository affected gate, and obtain an independent final diff review. Fix material findings and repeat the affected checks. Commit the production changes and a per-page evidence report without pushing or deploying.

## Progress and rulings

- Planning complete; implementation authorized by the user's explicit approval. No additional approval gate.
- Ruling: use the current checkout and repository-default atomic commits; preserve unrelated receipt edits and avoid introducing a new branch or moving the user's workspace.
- Ruling: screenshot data scenarios are evidence for real Vue layout, not proof of end-to-end backend behavior. Keep read-only deployed evidence and local interaction tests separate from unavailable real-service flows.
- Implementation complete in local commit `099113379`. All five frontend suites, the 35-task affected gate, the 9-task frontend build graph and the 11-task local real-integration graph passed. Final evidence and review limits are recorded in `docs/design-review-2026-11-11/implementation/README.md`; the original approved proposal remains immutable.
