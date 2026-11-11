# Independent findings follow-up review

Reviewed the current working-tree frontend/shared-style changes and the four follow-up reports. Excluded the two unrelated queue-core receipt formatter files. This review made no production-source edits and did not run the full release gate, deploy, or access production accounts.

## Material finding

### P2 — Dirty-editor confirmation is inaccessible from the trapped editor

**Locations:** `apps/admin-dashboard/src/views/OptionGroupsView.vue:490` (`closeEditor`), `apps/admin-dashboard/src/views/MyShiftsView.vue:451` (`closeForm`), and the reused `apps/admin-dashboard/src/components/common/ConfirmModal.vue:4`.

**Concrete trigger:** Change an option group/choice or shift-request field, then press Escape. The new close handlers open the existing global confirmation, which has no initial-focus, keyboard containment or focus-return behavior. Focus remains in the underlying editor, whose `v-dialog-focus` directive keeps Tab within that editor. Keyboard users therefore cannot reach the new discard/keep buttons. Repeated Escape can also replace the singleton confirmation state while the original close handler is awaiting its promise.

**Small fix:** Give the confirmation its own named keyboard-focus boundary using the existing dialog pattern; focus a confirmation control on opening, contain Tab in that boundary, support Escape as cancellation, and return focus to the editor control when keeping changes. Verify the actual nested keyboard interaction, rather than mocking only the confirmation's Boolean response.

**Status:** Resolved after controller correction and independent source readback. The admin confirmation now uses the existing `v-dialog-focus` directive, names its title/message, and treats stopped/prevented Escape as cancellation. The directive moves focus to its first control, contains Tab/Shift+Tab, and restores the connected editor control when the confirmation unmounts. Because the confirmation is teleported beside the editor, its keyboard events do not pass through the lower editor's focus trap. Both dirty-close handlers also hold an `isConfirmingClose` flag across the awaited confirmation and clear it in `finally`, preventing duplicate requests. The controller reports the real desktop/phone option-editor keyboard checks green; its equivalent final shift-request check remains part of the controller-owned browser gate.

## Other reviewed corrections

- Shared styles are imported once through each of the five application stylesheets, before Tailwind expansion; the separate five `main.ts` imports are removed. Common layout classes now belong to the components layer, so responsive utility visibility/alignment can override them. Native heading elements use block layout. Ordinary action controls retain a 44px minimum; semantic switch tracks retain their explicit compact dimensions and gain a transparent 44px pseudo-element hit area. The two integration switches and five legacy kitchen switches expose their actual checked state without changing toggle handlers.
- Primary market checkout, invitation, recent-market/order and reservation/booking lookup actions are visible sections again, with their existing feature/state gates intact. The market-operations section is visible and its new jump link points to the real section. Existing API calls and money calculations are unchanged.
- Menu option creation now selects an unused ID in the current list. Choice input IDs also include their group identifier, retaining uniqueness across groups. The selection-type label reuses the existing translated selection label.
- In-flight editor saves and tenant creation cannot be dismissed; successful operations retain their original completion path. Tenant setup/result content remains until explicit Done. Dirty-editor guards compare current forms/defaults; the confirmation-focus blocker found in the first review is resolved above.
- Order-history cards use the native order link's stretched surface, with action/review regions placed above it for independent interaction. Reservation/service-booking focus now follows the completed operation: creation confirmation after creation, local verified result after cancellation, with no record-wide watcher moving payment/cancellation focus back to creation.
- Kitchen sheets/details/confirmation use the installed Headless UI transition lifecycle. Confirmation content is retained during leave. The small return-focus helper captures the real opener and waits until after leave/nextTick, checks connection and refuses to restore while reopened.
- Onboarding's inbox-only test now checks actual copy-button absence; its positive check asserts the copied ID and result announcement.

## Evidence and limits

The review compared all changed production scripts and meaningful template event/model/conditional attributes, and read the shared CSS, five stylesheet entrypoints, PostCSS configurations, dialog helper, underlying admin confirmation/directive and changed regression assertions. No unrelated runtime, endpoint, authorization or monetary change was found in this bounded diff. `git diff --check -- apps packages/shared/styles/app-ui.css` passed.

Tier 2 graph discovery/trace plus direct source readbacks used project `Users-eric-Documents-Code-Makan-Masak`, observed generations `2026-11-11T14:43:39Z`–`14:44:51Z`. Exact-path coverage was checked for all 44 changed app/shared evidence paths and eight supporting confirmation/config paths. Recorded partial ranges were read directly: `MenuView.test.ts:128`, `OptionGroupsView.test.ts:43`, group-order tests at lines 50/82 and onboarding CSS at line 60. The graph reported no other recorded gap; this is best effort, not an exhaustive completeness guarantee.

The final confirmation readback checked its component, both callers and the existing focus directive at graph generation `2026-11-11T14:49:44Z`; all four exact source paths had no recorded gap and were also read directly. No further material source blocker was found.

**Approval condition:** Source review approves the corrected follow-up, with no unresolved material finding. Complete the controller-owned five builds, built-CSS hit/visibility checks, real-component regressions (including shift-request confirmation keyboard behavior) and full push gate. Existing reports describe isolated local checks; production login, deployment identity and actual service-flow QA remain separate release evidence.
