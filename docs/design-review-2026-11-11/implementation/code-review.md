# Independent production UI review

Reviewed the working-tree production changes against `8f85a39585f8777d4f2f564279a8f16942e22ee3`, the approved rollout plan, and both page audits. Review covered all changed application scripts and the template event/model/conditional changes, plus the shared foundation, app shells, dialogs, controls, cart clearance, navigation and state boundaries. No application source was edited by this reviewer. Unrelated receipt formatter changes were excluded.

## Findings

### P2 — Employee quick-info rows prevent phone wrapping

- **Location:** `apps/admin-dashboard/src/views/employees/EmployeeDetailView.vue:67` (also lines 72 and 79).
- **Trigger:** Open an employee with a long email address or long translated date text at 390px. The newly added `whitespace-nowrap` forces the quick-info content outside its card; `shrink-0` compounds the constraint. These classes are appropriate for the tab labels, but were also applied to unrelated quick-info rows.
- **Evidence:** An independent browser reproduction using the same 390px shell, 358px card and 310px content width measured a 382px row scroll width for `front-of-house-manager-for-the-night-shift@restaurant.example.com`. Restoring ordinary wrapping reduced it to 310px. This was a focused CSS reproduction, not a claim of an authenticated employee workflow test.
- **Small fix:** Keep nonshrinking/nowrap treatment on tabs only. Give quick-info containers `min-w-0`, retain nonshrinking icons, and wrap text in an element with `overflow-wrap:anywhere`.
- **Status:** Corrected during review. Quick-info containers/rows now have `min-w-0`/`max-w-full`, icons do not shrink, and text is wrapped in `overflow-wrap:anywhere` spans. Nonshrinking/nowrap treatment remains on the tab links. The matching `EmployeeProfileTab.vue` identifier/date values received the same wrapping correction. Final source rechecked; the controller owns the real employee-data 390px capture.

### P2 — Discovery retry changed a failed browse into an empty search

- **Original location:** `apps/customer-app/src/views/DiscoveryView.vue:89`.
- **Trigger:** Initial restaurant browse fails with no query or area filters. The added retry called `searchAndSync("")`; `searchDishes` selected search mode while both search eligibility conditions were false, issued no retry API request, cleared the error and displayed no result/empty content.
- **Small fix:** Retry the failed operation: popular loading, dish/service searching or restaurant browsing as appropriate.
- **Status:** Corrected during review. The controller's `retryDiscovery` dispatches by `discovery.popularFailed` and the existing search/browse mode. Source rechecked.

### P2 — Kitchen language menu was clipped on phones

- **Original location:** `apps/kitchen-display/src/components/layout/KitchenHeader.vue:65`.
- **Trigger:** Below `lg`, opening the existing absolute `top-full` language picker inside the newly horizontally scrolling action strip. `overflow-x:auto` also computes `overflow-y:auto`, clipping the picker below the roughly 48px strip; its z-index cannot escape the overflow ancestor.
- **Small fix:** Use a wrapping action row or move the picker outside the scroll region.
- **Status:** Corrected during review. The controller replaced scrolling with `flex-wrap`; source rechecked. An independent CSS reproduction confirmed the former ancestor computed vertical overflow as `auto` and the menu began below its clipping rectangle.

## Review result and limits

No additional material regression was found in the reviewed handler/model changes. Cart clearance measures the checkout footer border box and includes its safe-area padding; shop/table return navigation retains the existing destinations. Native fulfillment radios retain their values and selection model. Kitchen/platform dialogs use the installed Headless UI components; the small admin directive handles initial/endpoint keyboard focus and restoration for its existing dialogs. History now separates pending, failed and successful empty responses. Onboarding icons follow actual loading/error/application state, and application fields and legal translation references remain intact.

Follow-up review also checked the renamed `utils/dialog-focus.ts` imports and the final notification, scheduling-close and coupon-pagination names. The Home manual-entry modal now uses a named Headless UI boundary with explicit search-field initial focus. Its new watcher captures the actual focused opener when opening and restores that connected control after closing, with a reopen guard; this addresses the controller-discovered case where library click history held a nested span instead of the button. The focused mounted checks cover both initial-open and mounted-closed/later-open cases, including nested-span mouse events and Escape dismissal. No additional material finding was found in this follow-up source review.

The review used graph discovery plus direct source comparison. Exact coverage was checked for changed app files and cited supporting paths, including the follow-up changes; the recorded partial ranges in `OptionGroupsView.test.ts:42` and onboarding `main.css:58` were read directly. Coverage is best effort, not proof of exhaustive indexing. `git diff --check` for the five apps/shared stylesheet passed, as did the focused follow-up whitespace check. `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-customer-app exec vitest run src/tests/components/manual-input-modal.test.ts --maxWorkers=2` passed **1 file, 3 tests**. Full suites, final production screenshots and authenticated/backend task certification remain the controller's gate; they were not rerun here. A separate local Playwright launch was unavailable under the current process permissions, so the limited CSS reproductions used an isolated browser tab instead.

**Approval condition:** All three review P2s are resolved in final source. No review-source blocker remains. Complete the controller's affected checks and final desktop/phone evidence, including the real long employee identifier and the manual-entry nested-label focus-return interaction.

## Final floating-cart clearance follow-up

Reviewed only `git diff 099113379 -- apps/customer-app/src/views/MenuView.vue apps/customer-app/src/views/ShopMenuView.vue` and its existing CSS/composable relationship. **Pass: no material blocker found.** Both menus now reserve the observed floating bar's border-box height plus `2rem` and the bottom safe-area inset. This covers the bar's existing `1rem + safe-area` bottom offset while retaining another `1rem` of clearance. The inline padding wins over the older phone-only stylesheet rule and also protects tablet widths below desktop.

The existing `useIsDesktop` media query is `min-width:1024px`, matching the unchanged Tailwind `lg` visibility breakpoint; desktop removes the inline padding and keeps its existing layout. Both mutually exclusive table/group bars share the same element ref. Installed VueUse `useElementSize` resets its height to zero when that ref is removed (including an emptied cart), observes replacement refs, and uses `ResizeObserver` border-box measurements for wrapping/resizing. The group's `v-show` produces a zero-height observation while the invite is visible and a fresh measurement when the floating bar returns. Both table-menu bars now use the same existing safe-area class as the shop bar. Exact graph coverage was checked for both views, their breakpoint composable and customer CSS; no recorded gap was reported. This is source/dependency verification; the controller owns the final scrolled-page interaction checks, viewport resizing and recaptures.
