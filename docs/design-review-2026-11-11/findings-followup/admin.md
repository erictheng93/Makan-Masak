# Admin findings follow-up

Scope: `PlatformMarketsView`, `MenuView`, `OptionGroupsView`, and `MyShiftsView`. Shared CSS, auth-page alignment and switch dimensions are owned by the controller. No API endpoints, authorization, money calculations or production data were changed here.

## Findings and fixes

| Finding | Verdict | Correction |
| --- | --- | --- |
| PlatformMarkets index return prompt, pending join requests, index warnings and rebuild errors are hidden by a closed disclosure | Confirmed | Replaced the outer disclosure with an ordinary always-visible section. A link beside the page's primary controls jumps directly to it and displays the current pending-application count. Existing notices, status/error content and handlers remain intact. |
| Menu option field IDs collide after deleting a row and adding another | Confirmed, with a more precise root cause | Field labels use the option's ID; the existing ID generator reused the current array length, so a retained `size-2`/equivalent could be duplicated. This generation defect already existed in baseline `8f85a3958`; the new label associations made it more visible. New size, add-on, customization-group and choice rows now choose an unused ID within their existing list. Existing stored IDs and order are preserved. |
| Customization type is labeled “group name” | Confirmed | Reused existing `optionGroups.typeLabel` (“選擇方式”), present in all six admin locales. |
| Escape can discard an OptionGroups edit or dismiss an in-flight save | Confirmed | All cancel/Escape paths share one close handler. Pristine editors close directly. Dirty editors use the existing unsaved-changes confirmation; saving editors cannot be dismissed or submitted twice. Successful saves still close normally. |
| MyShifts Escape/backdrop/cancel can lose an edit or dismiss submission | Confirmed | The shared close handler blocks during submission and asks before discarding changed reason, request type or urgency. Successful submission closes directly and reloads as before. |

The findings about unconfirmed Escape dismissal describe real behavior, but a new confirmation is only appropriate when there are actual unsaved edits. No extra confirmation was added to pristine dialogs or successful submission.

## Verification

Added behavior regression checks to the four existing view suites using their existing service fixtures:

- Add, remove and add option rows; verify all rendered field IDs remain unique, and the type field's associated label names selection behavior.
- Verify the return-to-market index notice has no closed disclosure ancestor and the operations jump link targets the visible section.
- Reject an unsaved group-editor dismissal and preserve its values; confirm a subsequent dismissal.
- Keep a choice editor open while its real save path is pending, then close on success.
- Reject a changed shift-request dismissal, keep the form during pending submission, then close on success.

Before the production correction, the focused run reported 6 failures / 100 passes; five were the new regressions, and one existing cancellation case also failed because the failed new test left its one-shot confirmation response unconsumed. After the fixes the same run passed **4 files / 106 tests**, with no test-double additions.

Application and test typechecks passed; application ESLint passed; the scoped `git diff --check` passed. No dependencies were added.

Commands:

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter makanmasak-admin-dashboard exec vitest run src/views/MenuView.test.ts src/views/PlatformMarketsView.test.ts src/views/OptionGroupsView.test.ts src/views/MyShiftsView.test.ts --maxWorkers=2
pnpm --filter makanmasak-admin-dashboard typecheck
pnpm --filter makanmasak-admin-dashboard lint
```

Graph verification used project `Users-eric-Documents-Code-Makan-Masak`, initial generation `2026-11-11T14:08:31Z`, plus direct source reads. Exact paths were checked. The two recorded partial ranges (`MenuView.test.ts:128`, `OptionGroupsView.test.ts:42`) were read directly. Supporting confirmation/options composables and the six locale files had no recorded coverage issue at generation `2026-11-11T14:38:28Z`. This is best-effort coverage, not proof of exhaustive parsing.

The controller owns built-browser checks, the full push gate, deployment, and authenticated production QA. The native disclosure regression explicitly checks its `open` ancestry because jsdom does not model closed-details visibility reliably.

## Nested confirmation keyboard correction

Independent review correctly identified an additional defect in the new dirty-close flow: the existing shared `ConfirmModal` did not acquire focus, trap Tab, name its dialog, restore focus or handle Escape. The editor's existing local focus directive therefore kept keyboard interaction in the lower dialog. Repeated calls could also replace the singleton confirmation's pending resolver.

Reused the same existing local `v-dialog-focus` directive on the teleported confirmation itself; added its title/message associations and a stopped Escape handler that cancels only the confirmation. Because the confirmation is teleported to `body`, its keyboard events do not bubble through the underlying editor. Both dirty-close handlers also retain one pending confirmation until it resolves, preventing replacement by repeated Escape events. No global modal queue, new focus abstraction or dependency was added.

Reproduced RED in a real browser: confirmation visible, but the cancel button never received focus. Also reproduced the replaced resolver in the existing group-editor unit test. Final verification:

- `check-admin-discard.cjs`: **4/4 real local-browser scenarios** passed (option-group and shift-request editors at 1100px and 390px). Initial cancel focus, reverse/forward Tab containment, Escape preserving edits, focus returning to the actual edited input, repeated Escape/keep cycles and a subsequent confirmed discard all passed. These are actual Vue components with isolated local sample responses, not production-data QA.
- `admin-discard-browser.json` records those results; `admin-discard-screenshots/` contains the four visible confirmation states.
- Four focused view suites still pass **106/106**; final application/test typecheck, ESLint and scoped whitespace checks pass.
- Unit tests additionally verify that repeated close requests do not replace the pending confirmation for either editor; submission dismissal remains protected.

```sh
node docs/design-review-2026-11-11/findings-followup/check-admin-discard.cjs
```
