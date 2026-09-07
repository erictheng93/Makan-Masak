# TODOS

Organized by skill/component. Priority is stated per item, not by position — the
sections are grouped by area, so a P1 can sit below a P4.

**Last full verification: 2026-09-05.** Every item below was re-checked against
the working tree, the GitHub API, and `contract:check` on that date; each carries
its own verification note. Two entries were materially wrong and have been
corrected in place (money-schema migration paths, API-contract seats delta).

**Triaged the same day.** Eleven items were open; each is now in one of three
places, and this file says which:

| Disposition | Items |
| --- | --- |
| **Done** — shipped 2026-09-05 | safeTransaction removal (`1dd7a164`), coupons return type (`719e54f7`), contract-script header (`ac7043de`) |
| **Moved to issues** — needs design, touches billing, or is multi-week | [#333](https://github.com/erictheng93/Makan-Masak/issues/333) usage meter, [#334](https://github.com/erictheng93/Makan-Masak/issues/334) money cutover, [#335](https://github.com/erictheng93/Makan-Masak/issues/335) marketplace Phase 4, ~~[#336](https://github.com/erictheng93/Makan-Masak/issues/336) contract types~~ (closed 2026-09-06) |
| **Stays here** — no actionable next step | RealtimeSession (blocked on Cloudflare), payment acquirer (product decision), marketplace Phase 5 (post-MVP), GroupOrders harness (cost exceeds benefit), production deploy (needs credentials only) |

Deliberately not filed as issues: the four "stays here" items have no action
anyone could pick up today. Adding them to a thirty-issue backlog dilutes it
rather than tracking anything.

## API contracts

### Record field types in the API contract snapshot

**Priority:** P2 **Status:** Completed 2026-09-06,
[#336](https://github.com/erictheng93/Makan-Masak/issues/336).
**Files:** `scripts/check-api-contracts.cjs`, `.api-contracts-snapshot.json`,
`tests/unit/check-api-contracts.test.ts`

**Root cause:** the extractor never evaluated the schemas — it read the source
text with a regex and harvested identifiers sitting before a `:` at brace-depth
one. Types were the reported symptom; whole fields were the actual hole.
`...TimestampFields` produced nothing (so `createdAt` was not in the snapshot at
all, in any schema), `successEnvelope(X)` was matched against a hard-coded table
that returned the literal `["success", "data"]`, and a helper call wrapping an
inline `z.object({...})` recorded the *inner* object's keys as if they were the
response's top level. 46 schemas — `orders.OrderStatusEnum` among them — were
invisible entirely.

**Fix:** the schemas are now imported for real (`require("tsx/cjs")`, then
`require()` of the `.ts` file) and `schema._zod.def` is walked, which is both
shorter than the scanner it replaced and complete by construction. The snapshot
is format v2: one entry per field path, carrying a type label
(`union(date|number|string)`, `string|null?`, `enum(cancelled|…|refunded)`,
`object+catchall`). A changed label diffs as breaking. 192 schemas / ~1,000
names became 238 schemas / 2,855 field paths, with nothing lost — `--update`
printed a name-level v1→v2 delta so the regeneration was reviewable, and its
only 12 "losses" were three group-orders schemas whose fields moved to their
true depth under `data.`.

`pnpm contract:check` also ran from **no gate at all** — not CI, not
`verify:push`, not the pre-commit hook. It is now a step in both, and
`tests/unit/check-api-contracts.test.ts` is registered in
`scripts/guard-suites.txt`.

**Still not detected** (recorded in the script header and TESTING_GUIDE §2.5,
not filed): refinements (`.int()`, `.min()`, `.regex()`) are not part of the
label; a rename is still one removal plus one addition.

## shared-types wire drift

### LeaveRequest and LeaveBalance declared fields no column has

**Priority:** P2 **Status:** Completed 2026-09-05, alongside
[#330](https://github.com/erictheng93/Makan-Masak/issues/330)

**Files:** `packages/shared-types/src/leaves.ts`,
`packages/database/src/services/LeaveService.ts`,
`apps/api/src/features/leaves/types/index.ts`,
`apps/admin-dashboard/src/services/leavesService.ts` and eight leaves
components.

**What was wrong:** the same defect #330 fixed in `LeaveType`, in its two
siblings. `LeaveRequest` declared 11 fields with no column and omitted 10
that exist; `LeaveBalance` declared 3 and omitted 3.

**Reachable through `LeavesTab.vue` at `/dashboard/employees/leaves`, so
these were on a real screen:**

- `LeaveHistoryList.vue` and `LeaveDecisionCard.vue` rendered
  `request.days`, `request.leaveTypeName` and `request.employeeName` —
  three spellings, none of them columns, all blank.
- `LeaveBalanceOverview.vue` rendered `balance.leaveTypeName` and
  `balance.color`; both live under the joined `leaveType` projection.
- `LeavesTab.vue` posted `period` to an endpoint whose schema takes
  `startPeriod`/`endPeriod`. Zod stripped it, so every half-day request was
  filed as a full day.

**In `LeaveView.vue`'s components, which no route reached
([#344](https://github.com/erictheng93/Makan-Masak/issues/344)), so nobody
ever saw them.** They were fixed anyway — the types are shared, and leaving
them wrong would have kept the pin from compiling. All four have since been
deleted with #344; the entries below are kept because #330 references them:

- `LeaveRequestList.vue` and `LeaveApprovalList.vue` rendered
  `request.daysCount`; the column is `total_days`.
- `LeaveApprovalList.vue` read an `attachments` array through a cast. The
  column is a single `attachment_url`.
- `LeaveRequestList.vue` validated approval-chain steps against
  `{approverId, approverName, status}`. `buildApprovalChain` writes
  `{level, approverRole, required}`, so every step was filtered out.

**Neither reachable nor not:** `LEAVE_STATUSES` carried a `draft` value and
`HALF_DAY_TYPES` a morning/afternoon enum; no column has ever accepted
either.

**How it was fixed:** all three entities are now the wire shape of their row,
pinned by `LeavesWireConformance` in LeaveService.ts — twelve assertions
covering leave_types, employee_leave_balances, leave_requests and the three
join projections. Renaming a column fails the build and the error names the
field. `apps/api/src/features/leaves/types/index.ts` and
`apps/admin-dashboard/src/services/leavesService.ts` re-export instead of
re-declaring, so there is one definition of each.

**Left alone, deliberately:** `LeaveConflictCheckResult`,
`LeaveStatistics`, `EmployeeLeaveSummary` and `TeamLeaveCalendar` in
shared-types have no consumers anywhere and no endpoint returns them;
`LeaveApprovalRule` and `LeaveCalendarEvent` in the API feature are dead in
the same way. `apps/api/src/openapi/schemas/leaves.ts` is fiction end to end
(uuid ids, a `leaveType` string enum, `reviewerId`) but is imported only by
`apps/api/src/openapi/integration.ts`, which nothing imports — the served
OpenAPI document does not come from it. Deleting dead declarations is a
separate decision from fixing live ones.

## leaves

### Attachment upload was a shell, and four leave components were unrouted

**Priority:** P2 **Status:** → **[#343](https://github.com/erictheng93/Makan-Masak/issues/343)**,
**[#344](https://github.com/erictheng93/Makan-Masak/issues/344)** (filed
2026-09-05, found while closing
[#330](https://github.com/erictheng93/Makan-Masak/issues/330))

Both needed a product decision. Both are now done.

- **#343 — done 2026-09-06.** `LeaveRequestDialog` gated its submit button on
  `attachments.length > 0` when the leave type requires documentation,
  collected `File` objects, and neither caller sent them. The column is a
  single `attachment_url` and no upload endpoint is wired, so a request that
  was *required* to carry proof was always stored with none. Of the issue's
  three options, **option 2** was taken: the dialog asks for the link, because
  that is the only thing the whole chain can already carry end to end — the
  column is one URL, `createLeaveRequestSchema.attachmentUrl` is `httpUrlSchema`,
  and `LeaveService.createLeaveRequest` spreads it straight into the insert.
  The submit gate now tests for a real http(s) URL rather than a picked file,
  and a blank field emits `undefined` rather than `""`, which would fail the
  endpoint's `z.url()`.

  The issue recorded five broken boundaries; there was a sixth. It blamed
  `LeaveApprovalList` for never showing the attachment row, but that component
  was only reachable from the dead `LeaveView` (#344, deleted). The **live**
  approval UI, `LeaveDecisionCard`, had no attachment markup at all — so a
  stored document would still have been invisible to every approver. It now
  renders the link, through `safeExternalHref` because the URL is
  employee-supplied and lands in an `href`.
- **#344 — done 2026-09-06.** `LeaveView.vue` had no route and no importer,
  which made `LeaveApprovalList`, `LeaveBalanceCard`, `LeaveCalendar` and
  `LeaveRequestList` unreachable. All five are deleted. Neither option in the
  issue was taken as written, because the dead code was hiding a live gap:
  `LeavesTab.vue` sits under `/dashboard/employees`, which is `[ADMIN, OWNER]`,
  so roles 2-4 had **no** leave UI — no balance, no request, no cancel — while
  the API had been built for them all along (`GET /:restaurantId/requests`,
  `GET /requests/:id` and `POST /requests/:id/cancel` each carry an
  unreachable "not a manager, so only your own" branch). `MyLeavesView.vue` at
  `/dashboard/my-leaves` is that surface, shaped like `MyShiftsView` (#320) and
  needing no new endpoint. One API change went with it: `GET
  /:restaurantId/types` was `requireRole([ADMIN, OWNER])` while the write it
  feeds, `POST /:restaurantId/requests`, has no role gate at all — an employee
  could file a request but not list the types needed to pick one. The read is
  now open to every role in the restaurant; the type mutations are not.
  No `/dashboard/leaves/:id` detail page: a request row already carries
  everything it would have shown.

**Fixed in place the same day** (small, no decision needed): the reject box in
`LeaveDecisionCard` said 拒絕原因（可選） while `rejectLeaveRequestSchema`
requires a non-empty reason, so rejecting with it blank returned 400; the
request dialog was handed the whole restaurant's balances and
`getTypeBalance()` takes the first row per leave type, so it quoted an
arbitrary colleague's remaining days; and `leavesService.cancelRequest()`
posted no body to an endpoint that requires `reason` — it had no callers and
was removed. (It came back with #344, taking `reason` as a required argument;
`MyLeavesView` is the caller.)

### Upload leave documents instead of pasting a link

**Priority:** P3 **Status:** deferred 2026-09-06 (decided in #343)

#343 shipped the paste-a-link form of the attachment because it needed no new
storage and no new endpoint. The cost is real: an employee photographing a
doctor's note on a phone has to host it somewhere first, so the documentation
requirement is satisfiable but awkward, and adoption will show that.

**What a real upload would take, and why it was not lazy.** `apps/api` has no
user-content R2 bucket — only `BACKUP_STORAGE` — so the plumbing would come
from `apps/image-processor`, which already does `File` → R2 → URL with auth,
rate limiting, size checks, a security scan, a metadata table and an orphan
sweep. It cannot be reused as-is on three counts:

- `POST /images/upload` is `requireRole([0, 1, 2])`, but
  `POST /:restaurantId/requests` has no role gate, so roles 3-4 file leave and
  could not upload. Widening the shared endpoint would also let a cashier add
  arbitrary images to the restaurant's library.
- `ALLOWED_MIME_TYPES` is images only. Adding `application/pdf` to that var
  widens every upload, including menu photos.
- `useImageUpload` downsamples client-side to a 600px webp for its `medium`
  variant. That is the URL callers store, and it would make a photographed
  certificate illegible. Only the always-stored `original` variant is usable
  here.

So it wants its own route with its own gates rather than a flag on the existing
one. **Decide the delivery side first:** `GET /images/:imageId/:variant` is
unauthenticated and `Cache-Control: public, max-age=31536000, immutable`. That
is correct for a menu photo and a deliberate choice for a medical certificate —
the id is a uuidv7, so the URL is unguessable but permanently public once
leaked. An authenticated delivery route is not a drop-in either: the admin
dashboard authenticates with bearer tokens, so a plain `<a href>` to a guarded
endpoint does not work, and the approval card would need a fetch-and-blob or a
short-lived signed URL.

### Orphaned leave i18n keys left behind by #344

**Priority:** P4 **Status:** done 2026-09-07

Deleting `LeaveView.vue` orphaned the keys only it read. 51 of them, gone from
all six `apps/admin-dashboard/src/i18n/locales/*.ts`: the whole `leaves.tabs`,
`leaves.form` and `leaves.approval` blocks, `leaves.title`, `leaves.subtitle`,
`leaves.apply`, `leaves.teamLeaves`, `leaves.leaveBalance`,
`leaves.leaveCalendar`, five `leaves.balance.*`, three `leaves.list.*`, two
`leaves.request.*`, `leaves.manage.cancel`, five `leaves.messages.*`, and every
`leaveActions.*` key except `cancelReasonPrompt` — which emptied zh-TW's
`leaveActions` block in `zhTWCore` entirely, since its one live key lives in the
separate `zhTWRuntimeKeys` object. 4531 → 4481 leaf keys per locale, identical
in all six.

**The trap, for whoever does the next one of these.** A grep for the literal
key string is not a safe test. `MyLeavesView` reads status labels as
``t(`leaves.status.${request.status}`)``, so `leaves.status.pending` and its
three siblings appear nowhere in the source and a literal sweep calls them
orphans. Deleting them would have blanked the status pills on the page shipped
the day before. `LeavesTab` does the same with ``leaves.manage.accrual${...}``.
Resolve every ``t(`prefix.${...}`)`` site to its static prefix first and treat
everything under it as live. Two more traps: `grep "leaves.apply"` matches
`data-testid="leaves-apply"` because `.` is a regex wildcard (use `grep -F`),
and `leaves`/`leaveActions` each appear in *two* merged objects per file, so a
first-match edit silently misses the second copy.

**How it was verified:** flatten every locale to a leaf-key list before and
after, diff the sets, and assert each locale lost exactly the 51 intended keys
and gained nothing. `pnpm check:i18n-locales` then still reports all five target
locales complete, and the admin-dashboard suite is green at 113 files / 703
tests.

**Two adjacent bugs the audit turned up, fixed in the same change:**

- `leaves.status` carried four keys while `LEAVE_STATUSES` has five. A
  `withdrawn` request would have rendered the raw string
  `leaves.status.withdrawn` in `MyLeavesView`. Nothing writes that status
  today, but the column's CHECK constraint and the query filter schema both
  accept it. Added in all six locales, reusing the existing
  `employees.leave.withdrawn` translations.
- `leaveActions.cancelReasonPrompt` had been machine-translated from the *key
  name* rather than the zh-TW string in en-US, ja-JP, vi-VN and id-ID
  ("Cancel Reason Prompt", 「キャンセル理由のプロンプト」, "Hủy lý do nhắc nhở",
  "Batalkan Alasan Prompt"). It is the cancel-reason placeholder on
  `MyLeavesView`, so four locales were showing a label instead of an
  instruction. Retranslated.

### No check catches an unreferenced i18n key

**Priority:** P3 **Status:** open, measured 2026-09-07

**Root cause of the entry above, and it is systemic.** `pnpm
check:i18n-locales` compares each target locale against the zh-TW source — it
answers "is every key translated?" and never "is every key used?". So a key
outlives its only consumer silently, forever; parity stays green because the
key is orphaned in all six locales at once.

Measured across the four Vue apps with locale files, counting a key as live if
it appears literally in source **or** falls under a ``t(`prefix.${...}`)``
prefix:

| app | leaf keys | unreferenced | |
| --- | --- | --- | --- |
| admin-dashboard | 4481 | 535 | 12% |
| kitchen-display | 839 | 111 | 13% |
| onboarding-app | 89 | 19 | 21% |
| management-portal | 216 | 6 | 3% |

671 keys, ~12% of the total. The 51 removed for #344 were about a tenth of
admin-dashboard's share.

**Scope when someone takes this on:** the detector is the easy half — the
prefix-resolution rule above is the whole algorithm. The hard half is that a
gate needs a baseline of 671 accepted orphans to start green, and each one has
to be looked at before it can be deleted or accepted: some are genuinely dead
like these were, some are half-built features, and some are reachable through a
dynamic prefix the heuristic cannot see. Do not bulk-delete on the count.

### admin-dashboard's target locales were never in the translation approval scope

**Priority:** P3 **Status:** open, found 2026-09-07

`docs/i18n/locale-approval-manifest.json` records the maintainer acceptance of
machine translation, and its `apps` list is `["kitchen-display",
"onboarding-app", "management-portal"]` — **admin-dashboard is not in it**, nor
are `en-US` or `ja-JP` in its `locales`. So the largest locale set in the repo
(4481 keys x 5 target locales) has never been through that review.

Found via `leaveActions.cancelReasonPrompt`, which was
`"Cancel Reason Prompt"` in en-US against `"請輸入取消原因"` in zh-TW — English
derived from the *key name* rather than the source string, and it was the
visible placeholder on `MyLeavesView`. That one is fixed; the class is not.
Detecting the rest automatically does not work: a heuristic for "the value is
just the key name" flags 28 strings in the `leaves` namespace alone and all but
one are correct, because short UI labels legitimately match their key
(`retry` → "Retry", `save` → "Save"). Separating them needs a human reading
source and target side by side.

**Do not regenerate the handoff CSV to "fix" this.**
`docs/i18n/locale-translator-handoff.csv` is a 2026-05-26 snapshot and the
manifest pins its sha256 as the thing the maintainer approved. Re-exporting it
changes that hash and invalidates the signed approval, in exchange for nothing:
`pnpm check:i18n-locales` — the only i18n check in CI and in `verify:push` —
never reads it. It is expected to be stale with respect to the 51 keys #344
removed.

## database / money schema

### Retire legacy REAL money columns with D1 drop-column cutover

**Priority:** P3 → raised to P2 **Status:** → **[#334](https://github.com/erictheng93/Makan-Masak/issues/334)** (filed 2026-09-05). Detail below kept because the issue references it. **Corrected 2026-09-05 — the previous 2026-07-05 note, replaced here, was materially wrong:** The Drizzle schema end state is real: `packages/database/src/schema/` has **zero remaining legacy `REAL` money columns** — every `real()` column left is non-monetary (lat/lng, stock levels, ratings, `quantityPerServing`). But the executable cutover is no longer where the previous note said it was.

**What the 2026-07-05 note claimed, and what is actually true:**

| Claim | Reality on 2026-09-05 |
| --- | --- |
| `migrations_fresh/0070_money_cents_cutover.sql` and `0071_...` exist | **Deleted.** The fresh track was squashed into a single `0000_baseline_strict.sql`; neither file is on that track any more |
| The two are "paired" in `migration-dual-track.json` | **No.** That file's `pairs` array is `[]`, and `reviewedThrough.fresh` is just `0000_baseline_strict.sql` |
| The legacy track carries `0087`/`0088` | True — `packages/database/migrations/0087_money_cents_cutover.sql` and `0088_...` are still on disk |

**Why that matters more than a stale path.** Per root `CLAUDE.md`, every
`migrations_dir` in `apps/api`, `apps/management-api` and `apps/realtime` points
at `migrations_fresh` — verified again on 2026-09-05. The legacy
`packages/database/migrations/` track is referenced by **no** `wrangler.toml`,
so the only surviving copies of this cutover sit on a track nothing applies.
The guard logic (`CHECK (violation_count = 0)`, `PRAGMA defer_foreign_keys = ON`,
before/after row counts) still exists in those two files, but it is not
reachable by any `pnpm db:migrate:*` path.

**Still not verifiable from the repo:** whether the cutover was ever run against
production D1. That is an operational fact — and note that production was built
from the legacy lineage, so it is the one database where `0087`/`0088` could
plausibly have been applied by hand.

**Doc drift: resolved.** `docs/migration/MONEY_CENTS_FIELD_RETIREMENT.md` is now
"Last reviewed: 2026-08-21" and its Current State section already documents the
squash and its two consequences. No action needed there.

**Original scope — kept for reference.** The ✅ marks below mean "written in
`migrations/0087`/`0088`", which after the squash means *present on a track no
`wrangler.toml` reads*. Do not read them as "applied".

- Confirm production `money_cents_retirement` and `money_cents_retirement_rollout` audit rows have `violation_count = 0` — enforced automatically via the self-guarding assertion table in the migration itself
- Rehearse the destructive migration on a restored D1 drill database with backup/restore evidence captured — ⚠️ unverified, see above
- Use the dedicated D1/SQLite drop-column cutover migration that omits only the legacy `REAL` money columns listed in `docs/migration/MONEY_CENTS_FIELD_RETIREMENT.md` — ✅ written, as `migrations/0087_money_cents_cutover.sql` / `0088_market_checkout_child_order_cents_cutover.sql` (the `migrations_fresh/0070`/`0071` this line used to name were deleted by the squash)
- Preserve primary keys, FKs, unique constraints, defaults, generated columns, indexes, non-legacy triggers, timestamp columns, and soft-delete columns
- Start the cutover with `PRAGMA defer_foreign_keys = ON`, run `PRAGMA foreign_key_check`, and include row-count assertions — ✅ present in the migration files
- Remove obsolete cents sync triggers and legacy fallback reads only after the cutover migration is verified

## database / transaction integrity

### Migrate remaining safeTransaction callers to D1 batch

**Priority:** P4 **Status: ✅ DONE 2026-09-05** (`1dd7a164`). The stub is gone; a comment at the same spot records why there is deliberately no transaction helper, so reaching for one is now a compile error rather than a runtime throw. Kept here for one release as traceability. **Earlier note (verified 2026-07-05):** Caller migration is COMPLETE. Repo-wide search (`grep -rln "safeTransaction" --include="*.ts" .`) finds `safeTransaction` used ONLY in its own definition (`packages/database/src/services/base.ts:154`, now `:228`) and its dedicated test (`base.test.ts`) — zero remaining callers anywhere in `apps/` or `packages/`. `FeedbackService.ts`, `LeaveService.ts`, and `SchedulingService.ts` (the three listed below) are all fully on `db.batch()` now (verified via git log: `5c2be3be`, `1f16fe22`, `b2f40b7b` and others).

**Remaining scope (the only thing left):**

- Delete `safeTransaction` from `BaseService` (`packages/database/src/services/base.ts`) so interactive transaction usage cannot be reintroduced — nothing calls it anymore, this is now dead code, not a migration
- Remove/update `base.test.ts`'s coverage of `safeTransaction` accordingly

**Re-verified 2026-09-05 — still open, and still exactly this small.**
`safeTransaction` is at `packages/database/src/services/base.ts:228` (the
2026-07-05 note's `:154` has drifted) and `base.test.ts` still exercises it via
a local subclass. The only other hits are build output (`packages/database/dist`,
`packages/ai-analytics/dist`), which regenerate. Zero production callers.

## billing / metering cost

### Stop writing one D1 row per API request for the `api.requests` meter

**Priority:** P2 **Status:** → **[#333](https://github.com/erictheng93/Makan-Masak/issues/333)** (filed 2026-09-05, carrying the full design and the rejected alternatives below). **Files:** `apps/api/src/middleware/usageTracker.ts`, `apps/api/src/shared/utils/meter.ts`, `apps/api/src/workers/usage-aggregator.ts`

**Context:** `usageTracker` is mounted on `apiV1.use("*")` and emits `api.requests` through `meterEmit`, which does one `INSERT INTO usage_events` per request. `usage_events` carries two indexes that a fresh insert touches (`usage_events_restaurant_meter_time_idx`, and `usage_events_pending_idx`, which is partial on `aggregated_at_ms IS NULL` — exactly the state a new row is in), so each request costs roughly 3 D1 rows written, and the hourly aggregator's `UPDATE` of `aggregated_at_ms` adds more. D1 bills rows written at $1.00/M over 50M/month included. At the `pro` tier's own hard cap of 1,000,000 `api.requests` per cycle, 50 pro tenants is ~150M rows written/month.

**Do not move this meter to Analytics Engine.** It is not telemetry: `plan-quotas.ts` gives it soft/hard limits per plan tier, and `BillingCycleService.ts:66-75` computes billable overage as `total_quantity - hardLimit`. Analytics Engine samples at volume, so it cannot be the store of record for an invoiced quantity. (This corrects the first-pass recommendation from the 2026-08-21 cost review.)

**The real cost is index amplification, not the row itself.** One request's `usage_events` row is written three times over its life, and each write is amplified by the indexes covering it:

| Stage | Rows written |
| --- | --- |
| `INSERT` — table, `restaurant_meter_time_idx`, and `pending_idx` (partial on `IS NULL`, which a fresh row matches) | 3 |
| Hourly aggregator `UPDATE aggregated_at_ms` — table, row leaves `pending_idx`, row enters `ttl_idx` | 3 |
| TTL `DELETE` at 90 days — table plus both covering indexes | 3 |
| **Total per API request** | **~9** |

**Scope — collapse the per-request row into an hourly bucket, in D1:**

```sql
INSERT INTO usage_meter_buckets (restaurant_id, meter_key, bucket_start_ms, quantity)
VALUES (?, ?, ?, 1)
ON CONFLICT (restaurant_id, meter_key, bucket_start_ms)
DO UPDATE SET quantity = quantity + 1
```

The `UPDATE` touches only `quantity`, never a column in the conflict-target index, so it costs **one row written and zero index writes** — down from ~9. It stays exact: D1 serializes writes, so `quantity = quantity + 1` cannot lose an increment. The bucket row _is_ the aggregate, so the aggregator's `UPDATE` pass disappears, and the TTL sweep drops from tens of millions of rows to one per restaurant per hour.

Rejected alternatives, so they do not get re-proposed:

- **In-isolate coalescing.** An isolate evicted with a non-empty buffer loses those counts. Undercounting only ever bills the customer less, but the number stops being reproducible, which fails the accuracy-first requirement.
- **Per-restaurant counter Durable Object.** To stay exact it must persist every increment, because a DO hibernates after 10 seconds idle and discards in-memory state — so it pays the same $1.00/M row write _plus_ $0.15/M in DO requests, making it strictly more expensive than the D1 bucket. Its compute duration is genuinely negligible (a counter DO meets every hibernation condition, so it is billed only for JS execution — roughly 125 GB-s per million requests against 400,000 GB-s included), but that is not enough to close the gap. Revisit it only if D1 _write throughput_ becomes the constraint rather than cost: D1 serializes every write onto one primary, and a counter DO gives each restaurant its own serialization point.

**Note what is lost:** the per-request `metadata` (method, path, status) goes away. Nothing in billing reads it, but it is useful for debugging. That payload is genuine telemetry — sampling is fine — so Analytics Engine is the right home for it, kept separate from the billed count.

**Re-verified 2026-09-05 — unchanged.** No `usage_meter_buckets` table exists in
the schema or on either migration track, and `apps/api/src/shared/utils/meter.ts:36`
still issues a raw `INSERT INTO usage_events` per call, mounted on every
`apiV1` request via `usageTracker.ts:49`. (Side note for whoever picks this up:
that raw string SQL is a Layer 3 query, which root `CLAUDE.md` bans in new code —
the rewrite should land on Drizzle, not another template string.)

**Also worth deciding separately:** `USAGE_EVENTS_TTL_DAYS` is 90. Rows are aggregated into `usage_meters` within the hour and then exist only as dispute evidence. Dropping to ~35 days (one cycle plus a buffer) cuts the table's D1 storage by roughly 60% and is a business call, not a technical one. Bucketing largely subsumes this.

### RealtimeSession is stuck on the key-value Durable Object backend

**Priority:** P3 **Status:** Blocked on Cloudflare (identified 2026-08-23) **Files:** `apps/realtime/wrangler.toml`, `apps/realtime/src/durableObjects/RealtimeSession.ts`

**Context:** `RealtimeSession` was provisioned key-value backed by the 2026-07-22 production deploy, when the migration still read `new_classes`. The key-value backend bills storage in 4 KB request units — reads $0.20/M over 1M/month included, writes $1.00/M over 1M/month included — while the SQLite backend bills whole rows regardless of size, reads $0.001/M over 25B included and writes $1.00/M over **50M** included. `addToEventHistory` rewrites the entire ~100-event array through `storage.put` on every broadcast, which is roughly 5 write units per broadcast on key-value against exactly 1 row on SQLite.

**Do not flip the migration to `new_sqlite_classes`.** A deployed class's storage backend cannot be changed in place; Cloudflare rejects `new_sqlite_classes` on an existing key-value class and the `exports` reconciler reports `storage_type_mismatch`. Because `makanmasak-realtime-prod` is already past `tag = "v1"`, wrangler sends no migration for that entry at all, so editing it does not move the backend — it only makes the file disagree with production. Commit `af729cd3` did exactly that on the false premise that nothing had been deployed; reverted 2026-08-23.

**Two ways out, neither free:**

- Wait for Cloudflare's promised key-value → SQLite migration path (announced as future work in the 2026-07-09 changelog). Zero effort, unknown date.
- Delete and re-provision the namespace under a new class name. That discards every object's stored state. `RealtimeSession` keeps only an event-history ring buffer and hibernating WebSocket attachments, so the loss is bounded — but every live socket drops. Only worth doing inside a planned maintenance window.

**Done 2026-08-23 — the reachable half.** `addToEventHistory` used to rewrite the whole ~100-event array through one `storage.put` on every broadcast, costing `ceil(arrayBytes / 4 KB)` write request units. It now writes one key per event (`evt:` plus a zero-padded sequence, so `storage.list()`'s lexicographic order is insertion order) and deletes only what the caps evict: **1 write request unit + 1 delete request per broadcast, independent of history size**. Legacy `eventHistory` arrays are migrated to per-event keys on first load, so a client reconnecting across the deploy still gets its delta. Only the storage layout changed — retention rules, ordering and the `/history` cursor behave exactly as before.

**Re-verified 2026-09-05 — unchanged and still externally blocked.**
`apps/realtime/wrangler.toml:39-41` still declares `tag = "v1"` /
`new_classes = ["RealtimeSession"]`, and the per-event `evt:` key layout
(`RealtimeSession.ts:40`) is in place as described.

**Still blocked:** the remaining gap is the backend itself. Reads are unchanged (one `list()` per object lifetime, same bytes as the old single `get`), and the delete request is inherent — every event written must eventually be removed. On SQLite that same delete is a row written against a free tier 50x larger.

## payments / provider integrations

### Defer real payment acquirer integration

**Priority:** P2 **Status:** Deferred 2026-06-06 — product decision **Context:** This project is not connecting a live payment acquirer for the current scope. Stored-value 代幣, admin/cash top-up, pay-at-venue, and vouchers are the supported MVP money loop. The market-checkout provider split and online credit top-up code paths intentionally remain provider-agnostic and fail closed when no provider endpoint is configured.

**Deferred scope:**

- Select and contract a live acquirer such as ECPay, Stripe, LINE Pay, TapPay, or NewebPay
- Provide production credentials and endpoints for `MARKET_CHECKOUT_PROVIDER_SPLIT_URL`, `MARKET_CHECKOUT_PROVIDER_STATUS_URL`, `MARKET_CHECKOUT_PROVIDER_REFUND_URL`, and `CREDIT_TOPUP_PROVIDER_URL`
- Enable real card / wallet payment confirmation and provider-split market payments
- Enable customer-facing online self-serve 代幣 top-up backed by the selected acquirer

**Current supported behavior:** The provider contracts, webhook/reconciliation plumbing, admin readiness checks, and online top-up intent flow are implemented for future use. When no provider is configured, online top-up returns `CREDIT_TOPUP_NOT_CONFIGURED` and market checkout provider status reports missing provider configuration.

## i18n

### Consolidate 3 duplicate i18n runtimes into @makanmasak/i18n shared package

**Priority:** P2 **Status:** Completed 2026-05-25 **Noticed on branch:** `feat/i18n-coverage-all-apps` **Context:** v2.1.0 adds i18n to kitchen-display, onboarding-app, and management-portal. Each app had its own ~200-line copy of `src/i18n/index.ts` (identical except for a doc-comment line). The shared package `@makanmasak/i18n` at `packages/shared/src/i18n/` already exists and is used by customer-app. The completed work migrated all 4 apps (admin-dashboard, kitchen-display, onboarding-app, management-portal) to the shared package, resolving the API difference (custom composable vs vue-i18n).

**Resolution:** Added a shared `createI18n()` runtime factory, migrated duplicate app runtimes to wrappers around `@makanmasak/i18n`, standardized locale storage on `makanmakan_locale` with legacy `locale` migration, hardened message merging, and derived app `Messages` types from each app's `zh-TW.ts`.

**Scope:**

- Extract runtime (ref state, `t()`, `deepMerge`, `setLocale`, `loadLocaleMessages`, `initI18n`, `useI18n`) into `packages/shared/src/i18n` as a `createI18n(appMessages)` factory
- Each app owns only its `Messages` type and locale files
- Standardize on `makanmakan_locale` localStorage key (currently `locale` in 3 apps, `makanmakan_locale` in shared package)
- Standardize type safety: derive `Messages` type from zh-TW.ts instead of open recursive map

### Fill stub locale translations (zh-CN, vi-VN, ms-MY, id-ID)

**Priority:** P3 **Status:** Completed 2026-05-26 — AI-assisted localization accepted **Context:** 4 out of 6 locales per app were empty-object stubs that fell back to zh-TW. External translator approval was waived because of resource constraints; target copy is completed as maintainer-accepted machine localization.

**Approval model:** `docs/i18n/locale-approval-manifest.json` records the accepted handoff hash and documents that target copy was generated from the existing zh-TW/en-US sources with machine translation under maintainer acceptance.

**Scope:**

- Extract all unique keys from kitchen-display/zh-TW.ts, onboarding-app/zh-TW.ts, management-portal/zh-TW.ts — done in `scripts/i18n-locale-coverage.ts`
- Deliver locale copy in a structured review/import format — done in `docs/i18n/locale-translator-handoff.csv`; export preserves already-filled target cells on rerun
- Validate approved handoff and approval manifest before import — automated via `pnpm run i18n:check-handoff -- docs/i18n/locale-translator-handoff.csv`
- Import approved translations back into app locale files — automated via `pnpm run i18n:import-handoff -- docs/i18n/locale-translator-handoff.csv`
- Add CI check that warns when a non-zh-TW locale has fewer leaf keys than zh-TW — done via `pnpm run check:i18n-locales`; strict completion gate available via `pnpm run check:i18n-locales:strict`

### i18n performance: convert HistoryView status/type helpers to computed maps

**Priority:** P3 **Status:** Completed 2026-05-25 **File:** `apps/kitchen-display/src/views/HistoryView.vue` **Context:** `statusLabel()` and `typeLabel()` are plain functions called per row in a v-for. Each call rebuilds a Record of 8+ `t()` calls, so rendering N orders triggers ~10N `t()` invocations per render. Not a visible regression yet (history page is not a hot path) but worth cleaning up.

**Fix:** Convert to computed maps keyed on locale so Vue only rebuilds the map when the locale changes.

### i18n edge cases in displayTableName regex

**Priority:** P4 **Status:** ⚠️ Partially completed 2026-05-25 **File:** `apps/kitchen-display/src/components/orders/OrderCard.vue:314`. The regex was tightened to `^(Table|桌)[\s-]+/i` as planned, so the `桌子` case is fixed. The prefix list was never extended, and the condition for extending it has since been met: `vi-VN` and `ms-MY` locales were filled 2026-05-26, so `Bàn 4` and `Meja 4` now reach this code and are not stripped. **Context:** `displayTableName` stripped `^(Table|桌)[\s-]*` to prevent prefix duplication. Edge cases were not currently in production data:

- Vietnamese `Bàn 4` → would not be stripped (expected Vietnamese locale also translates `orders.table` → `Bàn`)
- Malay `Meja 4` → same
- Edge: table name starting with `桌子` (Chinese "table" noun) would lose `桌` — requires word boundary

**Fix:** Require a trailing separator in the regex: `^(Table|桌)[\s-]+`, with regression coverage for `Table 4`, `Table-4`, `桌 4`, `桌-4`, `桌子 4`, and `Tabletop 4`. Extend prefix list when Vietnamese/Malay translations land.

### Harden deepMerge against prototype pollution

**Priority:** P4 **Status:** Completed 2026-05-25 **File:** `apps/kitchen-display/src/i18n/index.ts` (+ onboarding-app, management-portal) **Context:** `setLocaleMessages` uses `deepMerge` which uses `instanceof Object` and `key in target`. Today only static imports flow through this path so it's safe. If future work loads locales from a remote source (A/B tests, CMS-driven translations), a malicious JSON payload with `__proto__` / `constructor.prototype` keys could pollute `Object.prototype`.

**Fix:** Replace `instanceof Object` with `Object.prototype.toString.call(v) === '[object Object]'`. Use `Object.prototype.hasOwnProperty.call(target, key)`. Explicitly skip `__proto__`, `constructor`, `prototype`. Or just drop `deepMerge` entirely since locale files are static — a straight assignment works.

### Standardize toLocaleTimeString/DateString to use active locale

**Priority:** P4 **Status:** ⚠️ Completed 2026-05-25 **for the 10 files listed below, but not fully** — a 2026-07-05 check found an eleventh that was never on the list, and it is still there today: `apps/kitchen-display/src/components/performance/PerformanceDashboard.vue:707` hardcodes `.toLocaleString("zh-TW")`. **Context:** 10 kitchen-display files still pass hardcoded `"zh-TW"` to `toLocaleTimeString`/`toLocaleDateString`. Most use 24-hour format which renders identically across locales, so the bug is invisible today. Should be cleaned up so future changes (e.g. adding seconds or switching to 12-hour) stay locale-aware.

**Files:** OrderCard.vue, OrderDetailsModal.vue, ConnectionStatus.vue, HistoryView.vue, SystemHealthDashboard.vue, ErrorReportsDashboard.vue, EnhancedShortcutsPanel.vue, InteractiveAudioPanel.vue, InteractiveStatsPanel.vue, kitchenStatisticsService.ts

## waiting-list (customer-side queue)

### Wire push notification end-to-end on call/about-to-expire

**Priority:** P2 **Status:** Completed 2026-05-25 for `waiting_called`; `waiting_about_to_expire` remains a future scheduler/alarm enhancement. **Spec:** `docs/specs/queue-and-waiting-list.md` **Context:** Phase 1 (commits `0ad8522f`, `309c3db6`, 2026-05-04) shipped the customer join/ticket/cancel/confirm UI. VAPID + Service Worker subscription already exist in `apps/customer-app/src/utils/push-notifications.ts`. Server-side `WaitingListService.callWaiting()` now dispatches customer web push for canonical customer-linked tickets and records `notified_at`.

**Resolution:** Customer-app requests push permission and subscribes after a successful join. The public waiting-list join route links tickets to the authenticated canonical customer when a valid customer JWT is present. The API dispatches `waiting_called` through `customer_push_subscriptions`, updates push delivery health, and the customer service worker deep-links notification clicks back to `/r/:restaurantId/wait-list/:ticketId`.

**Scope:**

- Customer-app: call `customerPushService.requestPermission()` + `subscribe()` on join success in `JoinWaitingListView.vue`; persist returned subscription against the ticket
- API: confirm or add an endpoint that accepts `{ subscription, ticketId }` (audit `apiClient.post("/push/subscribe", ...)` — route may already exist for orders)
- WaitingListService: dispatch web-push when ticket flips to `called`; consider also firing on `waiting_about_to_expire` (5-min timeout window — `NotificationType` enum already has the slot)
- Service Worker: handle `waiting_called` action click → deep-link back to `/r/:restaurantId/wait-list/:ticketId`

### Customer waiting-list history page

**Priority:** P3 **Status:** Completed 2026-05-25 **Context:** Phase 1 has no history view in customer-app. Useful for users to see prior visits without re-entering phone every time.

**Scope:** New API (`GET /waiting-list/history?phone=` or `?customerId=`) + view at `/wait-list/history`. Phone-based lookup must be rate-limited to avoid enumeration.

### Pre-order from menu while in waiting-list

**Priority:** P3 **Status:** Completed 2026-05-25 **Spec:** `docs/superpowers/specs/2026-05-25-waiting-list-preorder-design.md` **Context:** Customer is queued and could be browsing menu. Cross-system integration with existing menu/order flows so the order is bound to the ticket and fires to kitchen on `seated`.

**Resolution:** Orders now support `waiting_list_id` binding. Waiting-list pre-orders are held as `pending` until staff seats the ticket, then `markSeated()` assigns the table and promotes them to `confirmed` so kitchen active-order queries receive them.

### Phase 1 small debt

**Priority:** P4 **Status:** Completed 2026-05-25 **File:** `apps/customer-app/src/views/waiting-list/JoinWaitingListView.vue`, `apps/customer-app/src/locales/`

- `JoinWaitingListView.vue:292-298`: `watch(partySize)` calls `estimateWait().then()` with no `.catch` — silent stale value on failure
- `JoinWaitingListView.vue:300-303`: `restoreLastTicket()` and `loadQueueSnapshot()` race in parallel; if restore triggers `router.replace`, snapshot still completes (wasted request, no crash)
- i18n keys live in a parallel `src/locales/` dir alongside `src/i18n/` — should consolidate into the existing customer-messages source

## customer-identity

### Resolve customer/user identity fork (FK migration + 5 satellite tables)

**Priority:** P2 (done — kept here for traceability, see Status) **Spec:** `docs/superpowers/specs/2026-05-25-customer-identity-and-profile-design.md` **Context:** the FK migration and satellite tables described below have landed — `packages/database/src/schema/orders.ts:54`, `reservations.ts:36`, and `waiting-list.ts:36` all define `customerId` as `TEXT` FK to `customers.id`, and `customers.ts` defines the satellite tables (`customerPreferences`, `customerFavorites`, `customerPushSubscriptions`, `customerPhoneVerificationTokens`). The original claim that these were `INTEGER` FKs to `users.id` with `customers` "functionally orphaned" was stale and has been corrected.

**Status (verified 2026-07-05 — Phase 1 COMPLETE):** Full re-verification against the spec confirms every Phase 1 scope item has landed and is live in production code, not just planned:

- `customers` table rebuilt exactly per spec §5.1: `displayName`, `primaryPhone`, `primaryEmail`, `avatarUrl`, `locale`, `status`, `lastSeenAt`, `uuidv7()` ID generator (`packages/database/src/schema/customers.ts`).
- Dedicated `canonicalCustomerAuthMiddleware` (`apps/api/src/middleware/auth.ts:298`) validates `{ sub: customers.id, type: "customer" }` JWTs — separate from the legacy `customerAuthMiddleware = createAuthMiddleware(5)`, which is intentionally kept for legacy routes (matches the spec's locked decision to preserve `users.role = 5` rows, not an oversight).
- All 17 spec'd endpoints (`auth/request-otp`, `verify-otp`, `refresh`, `logout`, `me` GET/PATCH/DELETE, `preferences` GET/PATCH, `favorites` GET/POST/DELETE, `push-subscriptions` GET/POST/DELETE, `consents` GET/POST) are implemented in `apps/api/src/features/customer/routes/index.ts` and mounted live at `apiV1.route("/customer", customerRouter)` (`apps/api/src/app-factory.ts:674`). Access/refresh tokens are 15 min / 30 day exactly per spec §6.2; OTP hashed with bcrypt, rate-limited per phone+IP.
- Real-D1 integration coverage in `apps/api/src/__tests__/integration/customer-identity.real.integration.test.ts` (13 cases): OTP auth issuance, phone E.164 normalization, phone-number reclaim from deleted customers, refresh-token revocation on logout, staff-JWT rejection on canonical customer endpoints, push-subscription upsert + daily stale-pruning cron, idempotent favorites (incl. market favorites + recent-market-visit tracking), consent grant/revoke with shared-catalog version validation.
- customer-app: `LoginView.vue` (phone-OTP flow), `ProfileView.vue` (preferences, consent toggles, push enrollment via `customerPushService`), favorites wired into `MarketsView.vue`/`MarketDetailView.vue` via `marketEngagement.ts` + `customerIdentityApi.ts` (not a standalone "favorites" view — easy to miss on a filename-only search).
- Open, low-priority: `USER_ROLES.CUSTOMER = 5` has not been removed from `apps/api/src/shared/constants/index.ts` (intentional — legacy rows are preserved per the spec's locked decision) and no `customer_preferences` backfill script from legacy `users.preferences` JSON was found (unclear if any legacy rows actually needed it).

**Unblocks:** Marketplace Phase 4 (customer follow + broadcast push) below — its hard prerequisite (`customer_favorites`, `customer_push_subscriptions`, `customer_consents`) is satisfied.

**Scope (Phase 1, ~30 dev-days estimated in spec §15) — all items below are ✅ done, verified 2026-07-05:**

- Create 5 new tables: `customer_preferences`, `customer_favorites` (polymorphic), `customer_push_subscriptions`, `customer_consents` (append-only), `customer_phone_verification_tokens`
- Rebuild `customers` table: rename `full_name → display_name`, `phone → primary_phone`, `email → primary_email`; add `avatarUrl`, `locale`, `status`, `lastSeenAt_ms`; switch ID generator from `crypto.randomUUID().replace(/-/g, "")` to `uuidv7()`
- Table-rebuild FK migration on `orders` / `waiting_list` / `reservations` (`customer_id INTEGER → TEXT`, FK → `customers.id`)
- Customer auth service: phone-OTP flow + JWT (15 min access / 30 day refresh) with `type: "customer"` discriminator
- New `canonicalCustomerAuthMiddleware` in `apps/api/src/middleware/auth.ts`
- New feature folder `apps/api/src/features/customer/` with 17 endpoints (auth, me, preferences, favorites, push, consents)
- customer-app: login screen, favorites UI, push enrollment flow, settings/consent UI
- Not done (low-priority, see Status): backfill `customer_preferences` from legacy `users.preferences` JSON; full removal of `USER_ROLES.CUSTOMER = 5` (deferred by design)

**Hard prerequisite for:** marketplace Phase 4 (follow & broadcast) and waiting-list Phase 2 push (reuses `customer_push_subscriptions`).

## marketplace (night market / 商圈)

### Phase 1 — Markets entity + GPS discovery + takeaway bridge

**Priority:** P2 **Spec:** `docs/superpowers/specs/2026-05-25-night-market-discovery-design.md` **Context:** Today's Discovery system treats every shop as an island; `restaurants.district` is a free-text label and `latitude / longitude` columns are reserved-but-unused. To serve night markets and commercial districts, "market" needs to become a first-class entity, GPS search needs to be activated, and Discovery needs to bridge into checkout without a QR scan.

**Status:** Completed 2026-05-25. Backend core landed in commit `89147020`; customer-app market browse/detail routes and the Discovery → takeaway button bridge landed in commit `8ae7ce3a`; admin market CRUD and vendor membership management landed in commit `c5f814c9`; onboarding now captures mandatory restaurant GPS coordinates for future market discovery; admin-dashboard has read-only market memberships plus join-request submission; public market reads now use versioned KV cache keys invalidated by admin market/vendor mutations. Six locked decisions are captured in §11 (platform-owned in Phase 1, free pricing, no native DM, deep-link contact MVP, list-only without map, and DB-level partial unique active memberships).

**Scope (Phase 1, ~27 dev-days estimated in spec §14):**

- New tables: `markets`, `restaurant_market_memberships`
- Modify `dish_search_index`: add `primaryMarketId`, `marketIds` (JSON), `latitude`, `longitude`
- New `apps/api/src/features/markets/` with public + admin endpoints (`/markets`, `/markets/:slug`, `/markets/:slug/vendors`, `/markets/nearby`, admin CRUD in `apps/management-api`)
- Extend `DiscoveryService`: `marketId` and `lat/lng/radiusKm` filters; bounding-box + Haversine `findNearby`
- New `takeaway-eligibility` endpoint that returns existing `shopQrCode` as the entry token (bridges Discovery → existing shop-mode order flow)
- Extend `SearchIndexSyncService` to subscribe to membership and market changes
- KV cache: versioned `markets:v{version}:detail:{slug}`, `markets:v{version}:list:...`, `markets:v{version}:vendors:...`, and `markets:v{version}:nearby:...` keys with `markets:version` invalidation on admin market/vendor mutations
- customer-app: `/markets`, `/markets/:slug` routes; `MarketCard`, `MarketDetailHero`, `VendorListInMarket`; "立即外帶" button on `DishResultCard` / `RestaurantCard`
- management-portal: `MarketsView.vue` (admin CRUD, attach vendors)
- onboarding-app: mandatory "Pick location on map" step capturing `latitude / longitude`
- admin-dashboard: read-only "Markets I belong to" section + "request to join" form

### Phase 3 — Vendor contact via deep links + FAQ (no native DM)

**Priority:** P3 **Status:** Completed 2026-05-25. **Spec:** `docs/superpowers/specs/2026-05-25-night-market-discovery-design.md` §10 Phase 3 **Context:** Native customer↔vendor DM was rejected (decided 2026-05-25): small vendors won't staff a real-time inbox, and forcing them onto a platform DM creates ignored-message friction. Customer contact in MVP routes to wherever vendors already work (LINE / IG / WhatsApp / Telegram) and offers a per-restaurant FAQ auto-suggest for the common questions.

**Resolution:** Restaurants now have public `messagingChannels` deep links plus `restaurant_faqs`. Owners can manage contact channels and FAQs from admin-dashboard settings; customer-app market vendor cards expose "聯絡店家", searchable FAQ accordions, and native third-party deep-link buttons. Re-evaluate native DM only after ≥50 vendors actively use the deep-link path and survey data justifies the build.

**Scope:**

- Add `messagingChannels` JSON column to `restaurants`: `{ line?, whatsapp?, instagram?, telegram? }` (each entry a public deep-link URL)
- New table `restaurant_faqs`: `restaurantId`, `question`, `answer`, `keywords` (JSON), `displayOrder`, `isActive`
- Admin-dashboard: "Contact channels" + "FAQs" tabs on restaurant settings
- customer-app: "聯絡店家" button on vendor detail page → opens platform native app via `line.me` / `wa.me` / `ig.me`
- customer-app: "常見問題" accordion above the contact buttons; keyword search across FAQs

### Phase 4 — Customer follow + broadcast push (depends on customer-identity)

**Priority:** P3 **Spec:** `docs/superpowers/specs/2026-05-25-night-market-discovery-design.md` §10 Phase 4 **Context:** Customer can follow markets and vendors; vendors and market operators can broadcast push notifications to followers, gated by `customer_consents WHERE consentType='marketing'`. Reuses VAPID infra from waiting-list Phase 2.

**Why deferred:** Hard prerequisite — customer-identity work above must land first because "follow" rows live in `customer_favorites` and "broadcast targets" live in `customer_push_subscriptions`. Without those tables, this feature has nowhere to attach.

**Status:** → **[#335](https://github.com/erictheng93/Makan-Masak/issues/335)** (filed 2026-09-05, `needs-planning`). **Re-verified 2026-09-05 — still unblocked, still unbuilt:** No
market- or restaurant-scoped broadcast endpoint and no "Following" UI exist.
Note for future searches: `RealtimeBroadcastService` **does** exist and matches a
naive grep for "Broadcast", but it is the group-order/realtime fan-out in
`@makanmasak/database`, unrelated to marketing broadcast. This phase is the
largest genuinely-unbuilt item in this file.

**Scope:**

- "Follow" UI on `MarketDetailHero` / `RestaurantCard` → writes `customer_favorites(targetType='market' | 'restaurant')`
- New `BroadcastService` in `apps/api`: fans out push via `customer_push_subscriptions` filtered by `customer_consents`
- New admin endpoints: `POST /api/v1/markets/:id/broadcasts`, `POST /api/v1/restaurants/:id/broadcasts` (rate-limited, per-restaurant audit)
- customer-app: "Following" tab in profile view; opt-in / opt-out granular controls (overall marketing, favorites-only, quiet hours)

### Phase 5 — Operator role + portal

**Priority:** P4 **Spec:** `docs/superpowers/specs/2026-05-25-night-market-discovery-design.md` §10 Phase 2 **Context:** Promote `market_operator` to a first-class role (separate from existing 0–4 restaurant roles) with self-service market editing, vendor approval queue, and per-market analytics.

**Why deferred:** Phase 1 markets are platform-admin-owned, which is sufficient for MVP. Operator self-service is a scaling tool, not a launch requirement.

**Re-verified 2026-09-05 — unbuilt.** Zero occurrences of `market_operator` /
`MARKET_OPERATOR` anywhere in `apps/` or `packages/` source.

**Scope:**

- New role: `market_operator` in `USER_ROLES`
- New table or column linking operators to markets (operator can manage 1+ markets)
- Self-service market metadata editing (subset of admin endpoints)
- Vendor membership approval queue (vendor requests → operator approves/rejects)
- Per-market analytics dashboard in management-portal

## security / rate limiting

### Per-endpoint rate limits are advertised but not enforced in production

**Priority:** P3 **Status:** → **[#341](https://github.com/erictheng93/Makan-Masak/issues/341)** (filed 2026-09-05). The half needing no design shipped separately: the native path no longer advertises counters nothing enforces, and `Retry-After` reports the binding's own window instead of a `blockDuration` it does not implement. What moved to the issue is the part that needs a decision — whether orders/payments/webhooks should get real per-endpoint enforcement via the existing route-level `rateLimitMiddleware`, paying a KV read+write (~210ms/~420ms from APAC) against a P99 < 300ms target on the hottest write paths. **Files:** `apps/api/src/app-factory.ts`, `apps/api/src/middleware/geo-rate-limiting.ts`, `apps/api/wrangler.toml`

**Context:** `API_CUSTOM_RATE_LIMITS` reads as ten per-endpoint limits, but the middleware only enforces them on its KV path. `shouldUseKvRateLimiter` takes that path only for `SENSITIVE_KV_RATE_LIMIT_PATHS` — the six credential endpoints — and everything else goes to the `GLOBAL_RATE_LIMITER` binding, which enforces its own `wrangler.toml` value (100 req/60s, `[env.production.ratelimits.simple]`) no matter what the entry says. For a non-sensitive path the configured numbers only fill `X-RateLimit-Limit` and `Retry-After`, so `/api/v1/payments` advertises a limit of 10 while 100 is what actually holds. #339 fixed which entries *match* a request; it did not change which ones *enforce*.

**Scope:**

- Decide per entry whether it needs real enforcement. If it does, either add its path to `SENSITIVE_KV_RATE_LIMIT_PATHS` (durable counter, costs one extra KV read per request) or provision a second native binding at the tighter limit.
- Stop advertising a limit the caller is not held to. `X-RateLimit-Remaining` is misleading on the native path too: it is computed as `requests - 1` on every allowed request, so it never decrements.

## authentication

### Account security and auth statistics are stubs that report zeros

**Priority:** P2 **Status:** Open (absorbed 2026-09-05 from the deleted 2026-05-02 debt scan, which had it corrected-to-open on 2026-07-05; re-verified against the tree today) **File:** `apps/api/src/features/authentication/services/AuthService.ts`

**Context:** The 2026-04-21 auth work landed password reset, email verification,
profile read/update and session termination on real database paths. Two
surfaces were reported as done in the same breath and are not:

- `getSecurityEvents()` unconditionally `return []` after logging
  `"getSecurityEvents not fully implemented"` (`:1019`).
- `checkAccountSecurity()` hardcodes `failedLoginAttempts: 0` (`:1036`) and
  `twoFactorAdoptionRate: 0` (`:1085`).

**Why it matters more than a normal stub:** these are not empty screens, they
are *reassuring* ones. An account-security panel that always reports zero
failed logins reads as "nothing suspicious has happened", which is the opposite
of unknown. 2FA is intentionally unsupported today, so a zero adoption rate is
technically true but says nothing.

**Scope:**

- Decide whether the surface should report real data or be removed until it
  can. Removing it is a legitimate answer and cheaper than half-filling it.
- If kept: source failed-login counts from a real store (there is no
  login-attempt table today — that is the actual work), and drop the 2FA metric
  entirely until 2FA exists rather than reporting 0.

## qr codes

### Requesting a PDF or JPEG QR silently returns an SVG

**Priority:** P3 **Status:** Open (absorbed 2026-09-05 from the deleted 2026-05-02 debt scan; verified today) **File:** `apps/api/src/features/qr-codes/services/QrCodesService.ts:487`

**Context:** The 2026-04-22 fix replaced placeholder buffers with real QR
artifacts, which was the P1. What it left behind is narrower but is still a
response that does not match its request:

```ts
if (format === "svg" || format === "pdf" || format === "jpeg") {
  const svg = await QRCode.toString(content, { ...options, type: "svg" });
  return { data: ..., contentType: "image/svg+xml", extension: "svg" };
}
```

A caller asking for `pdf` gets an SVG, labelled `image/svg+xml`, named `.svg`.
No error, no warning. The old debt note framed this as "add true PDF/JPEG
renderers"; the cheaper half is that until they exist, an unsupported format
should 400 rather than substitute.

**Scope:** Either render the requested format, or reject unsupported formats
explicitly. Do not keep silently substituting. Separately, QR downloads set no
cache headers — worth adding once product download-caching rules exist.

## repository cleanup

### Twelve stale `.disabled` / `.old` / scratch files are still tracked

**Priority:** P3 **Status:** Open (absorbed 2026-09-05; count re-verified today — the original list of 18 is down to 12, and `WaitingListView.vue.old` has gone since the 2026-07-05 pass)

**Files:**

- `apps/api/src/examples/StripeIntegrationExample.ts.disabled`, `PaymentSystemUsage.ts.disabled`
- `packages/database/migrations/` — `0010_index_optimization.sql.disabled`, `0039_9_cleanup_new_tables.sql.disabled`, `0040_comprehensive_restaurant_id_migration.sql.disabled`, `0041_remaining_tables_structure.sql.disabled`, `0042_migrate_data_part1.sql.disabled`, `0043_migrate_data_part2.sql.disabled`, `0044_cleanup_and_rename.sql.old`
- `apps/admin-dashboard/src/views/ReservationView.vue.old`
- `apps/kitchen-display/priority3-final-status.txt`, `order-workflow-errors.txt`

**Note before deleting the migration ones:** they sit on
`packages/database/migrations/`, the legacy track that no `wrangler.toml`
reads — so they are inert twice over. That also means deleting them is safe in
a way it would not be on the fresh track.

**Scope:** decide keep/delete per file (git history preserves them either way),
then add a pre-commit or CI check that blocks new `.old` / `.disabled` /
scratch `.txt` outside approved directories, since this list regrew after the
last cleanup.

### The route-migration helper emits skeletons that pass silently

**Priority:** P3 **Status:** Open (rescued 2026-09-05 from the deleted debt scan) **File:** `scripts/migration/migrate-routes.js` (still present)

Generated route files carry TODO comments and no failure, so a half-migrated
route can ship looking finished. Make the generated skeleton throw until the
logic is filled in, and put a checklist in the generated file.

## admin-dashboard

### Seven unimplemented TODOs across scheduling, POS, queue and backup

**Priority:** P3 **Status:** Open (absorbed 2026-09-05; per-file counts verified today)

**Files and counts:** `components/scheduling/SchedulingConflicts.vue` (2),
`views/POSManagementView.vue` (2), `views/scheduling/SchedulingView.vue` (1),
`services/queueService.ts` (1), `components/backup/CreateBackupModal.vue` (1).
`components/backup/BackupListItem.vue` is now clean.

**Scope:** scheduling conflict ignore/details behaviour; schedule date
filtering / create modal; promotion edit dialog; shift report dialog; backup
component local types replaced with shared types; queue capacity forecast once
an API exists.

**Related:** several of these overlap issues already filed from the admin QA
runs (#307, #308, #320). Check those before starting — the panel may be dead
for a bigger reason than a missing handler.

## known stubs returning fixed values

### Four fields exist in responses but are hardcoded or never populated

**Priority:** P3 **Status:** Open (absorbed 2026-09-05; all four re-verified today)

Grouped because they share a failure mode: the field is in the response
contract, so a consumer can read it and believe it.

| Field | Location | Current value |
| --- | --- | --- |
| `repeatCustomerRate` | `packages/ai-analytics/src/services/AIInsightsService.ts:278` | `0`, with its own `// TODO: Calculate from user order history` |
| `served_by_name` | `packages/queue-service/src/services/QueueService.ts:546-548` | `undefined`; needs a cross-package user lookup |
| `PAYMENT_AUDIT_EVENT_TYPES.FAILURE` | payments / billing | defined but emitted nowhere — no failure path writes an audit row |
| device uptime / busy hours | `packages/queue-core/src/print/services/PrinterService.ts` | not tracked |

**Scope:** for each, either populate it or remove it from the response.
`FAILURE` is the one with real consequence: the payment audit log records
attempts and successes, so a reader cannot distinguish "no failures" from
"failures are not recorded".

## multi-branch (多分店)

### Deferred by product decision, not missing by oversight

**Priority:** — **Status:** Removed 2026-07-27, deliberately. Rescued 2026-09-05 from the deleted debt scan, because this was the only written record of the decision.

**Context:** `multi_branch` was removed from `MODULES` and the Enterprise plan
on 2026-07-27. It had never been enforceable — no route checked it, and the
data model has no multi-branch concept at all. Advertising it on Enterprise
promised a capability the platform cannot deliver.

**Re-introducing it is a product feature, not a gate.** The minimum before the
module key comes back:

- Organization / branch-group data model — `restaurants` has no parent or
  grouping relationship today.
- One owner spanning several restaurants — `users.restaurantId` is a single
  column (`packages/database/src/schema/users.ts`).
- Branch creation and invitation owned by the shop, not the platform —
  `POST /api/v1/restaurants` is `requireRole([ADMIN])`, platform-admin only.
- Cross-branch switching, aggregated reporting, and permission isolation
  between branches.
- Only then re-add `multi_branch` to `MODULES` and gate that whole group of
  capabilities with it.

Stale `multi_branch` keys left in existing `shop_subscriptions.module_overrides`
JSON are inert — the gate resolves against `ModuleKey` — and can be ignored or
swept later. They are not a reason to keep the TypeScript module.

## analytics

### Exports are inline `data:` URLs, with no lifecycle tests

**Priority:** P3 **Status:** Open (rescued 2026-09-05 from the deleted debt scan) **File:** `apps/api/src/features/analytics/services/AnalyticsService.ts`

**Context:** `generateExport()` stopped being a placeholder on 2026-05-01 — it
builds real JSON/CSV payloads for dashboard, revenue, products, customers and
performance, and returns filename, content type, size, period, expiry metadata
and a `data:` download URL. Two things were left open and still are.

**Scope:**

- Decide whether exports stay inline `data:` URLs or move to R2-backed file
  storage. Inline means the whole export crosses the response body, so the
  ceiling is whatever a Worker response can hold — that is the question to
  answer, not a style preference.
- Add tests for export lifecycle, permission boundaries, and large-payload
  behaviour. There are none today.

## backup

### Restore has no rollback coverage, and storage quota is unavailable

**Priority:** P2 (rollback) / P3 (quota) **Status:** Open (rescued 2026-09-05 from the deleted debt scan) **File:** `apps/api/src/features/backup/services/BackupService.ts`

**Context:** Restore became a real recovery path on 2026-04-21 — it fetches the
backup, verifies the checksum, restores table rows and records operation
status, and a pre-restore backup is taken before a destructive overwrite. The
compression-metric concern is resolved too: `:296` computes a real gzip ratio
with a comment explaining that the storage service still receives the raw
payload.

**Scope:**

- **P2:** multi-table restore has no transaction/rollback coverage. D1 has no
  interactive transactions, so this has to be built out of `db.batch()` or an
  explicit compensating path — a half-applied restore is worse than a failed
  one.
- **P3:** provider storage quota/usage is still unreported, pending quota data
  from the provider.

## integrations

### Foodpanda needs contract tests before the adapter is ever enabled

**Priority:** P2 **Status:** Open (rescued 2026-09-05 from the deleted debt scan) **File:** `apps/api/src/features/integrations/adapters/FoodpandaAdapter.ts`

**Context:** Foodpanda is explicitly "coming soon": admin connect/config/
menu-sync routes return 501 before persisting credentials or reaching the
unimplemented adapter, so nothing can currently fail at runtime. The adapter
and its test file both exist.

**Scope:** add contract tests matching real Foodpanda webhook payloads and auth
behaviour **before** the 501s come off. Enabling first and testing after is how
this became a P1 the first time.

## testing / fixture harnesses

### E2E skips and mock-heavy API tests

**Priority:** P2 **Status:** Open (absorbed 2026-09-05 from the deleted 2026-05-02 debt scan; both counts re-measured today)

**E2E: 11 unconditional skips, unchanged since 2026-07-05.** Across
`tests/e2e/smoke/` (owner-overview, smoke, admin-realtime-websocket,
kitchen-display, owner-pos-usage-state, owner-order-management,
owner-menu-management, owner-backoffice-pages) and
`tests/e2e/integration/real-workflows.spec.ts`. A skipped journey is
indistinguishable from a passing one in the run summary.

**Mocks: 159 of 288 API test files call `vi.mock`** — up from the 132 of 213
recorded 2026-07-05. The ratio held at 55% while the suite grew, so the
mock-first habit is being reproduced, not worked off. 54 files are
`*.real.integration.test.ts`. This is the same shape as the tenancy-guard
finding: a hand-written auth mock silently swallows the middleware, so a test
can pass against a route that has no guard at all.

**Scope:**

- Replace unconditional skips with feature flags or fixtures, or delete the
  test if the journey does not exist. Each remaining skip needs a stated
  unblock condition.
- Add a CI check that fails when a new unconditional skip appears — without it
  this count only goes up.
- Pick the ten highest-risk mocked feature tests (start with anything
  tenant-scoped) and convert them to real-D1 suites. Keep unit mocks for pure
  business rules; require at least one real route test per exposed feature.

### Unify GroupOrdersService's file-local select harness with `createSelectFixtureDb`

**Priority:** P4 **Status:** Open (identified 2026-08-20, deferred from #213) **Files:** `apps/api/src/features/group-orders/services/GroupOrdersService.test.ts`, `packages/database/src/testing/select-fixtures.ts`

**Context:** #213 moved this file's write fixtures onto the shared `createMutationFixtureDb`. Its reads still use a file-local harness that already routes by table and throws on missing/exhausted fixtures — the same rules the shared one enforces — so this is de-duplication, not a bug.

**Why deferred:** The local harness has a `rawSqlSubquery` catch-all bucket for `.from()` arguments that are raw SQL subqueries rather than registered tables. `createSelectFixtureDb` has no catch-all: an unregistered `from()` argument throws there. Migrating means adding a routing escape hatch to a module 24 other test files depend on, for one caller.

**Scope:** Either give `createSelectFixtureDb` a declared fallback bucket, or rework the two subquery-backed reads in `GroupOrdersService` so every `from()` target is a real table.

**Re-verified 2026-09-05 — unchanged.** The `rawSqlSubquery` symbol and its
routing fallback are still in `GroupOrdersService.test.ts` (declared at :92,
routed at :139, one fixture at :3784); writes are already on the shared
`createMutationFixtureDb` (:211), exactly as #213 left it.

### Narrow `CouponsService.createCouponWithValidation`'s return type

**Priority:** P4 **Status: ✅ DONE 2026-09-05** (`719e54f7`). Narrowing it surfaced two wrong assumptions the `unknown` had been hiding: the test declared `id: string` against an `integer` column, and asserted `isActive === false || isActive === 0` — a hedge whose second branch can never run, since `is_active` is `integer({ mode: "boolean" })` read back through Drizzle `.returning()`. **Files:** `apps/api/src/features/coupons/services/CouponsService.ts`, `apps/api/src/__tests__/integration/coupons.real.integration.test.ts`

**Context:** `createCouponWithValidation` is declared `Promise<unknown>`, and `PaginatedCouponsResponse.coupons` inherits that looseness. Because of it the coupons integration suite has to state the coupon shape locally (`CouponResponse`) rather than derive it from the service the way the other suites do.

**Why deferred:** #207's scope was `no-explicit-any` in test code. Narrowing the return type is a production-signature change with its own callers to check, and the issue explicitly says such findings should be filed rather than forced through a cast in the test.

**Scope:** Give the method a concrete return type (the formatted coupon row), let `PaginatedCouponsResponse` follow, then replace the test's local `CouponResponse` with `ServiceData<CouponsService["createCouponWithValidation"]>`.

**Re-verified 2026-09-05 — unchanged.** Still
`async createCouponWithValidation(data: CreateCouponData): Promise<unknown>` at
`CouponsService.ts:214`, and the integration suite still carries its local
`CouponResponse` interface.

## deployment

### The production deploy workflow has never successfully run

**Priority:** P1 **Status:** Open (identified 2026-08-23) **Files:** `.github/workflows/deploy-production.yml`

**Context:** `deploy-production.yml` has been dispatched exactly once, on 2026-07-24 (run `30110053816`). It failed in the first package `pnpm -r run deploy:prod` reached, `apps/backup-scheduler`, with:

```
✘ [ERROR] In a non-interactive environment, it's necessary to set a
CLOUDFLARE_API_TOKEN environment variable for wrangler to work.
```

The step does pass `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}`, so the repository (or `production` environment) secret is unset or empty. `pnpm -r` aborts on the first failure, so **nothing reached Cloudflare in that run** — no worker was uploaded, and no partial deploy needs unwinding. Every other run of this workflow was `workflow_run`-triggered and skipped by the confirmation gate.

**Consequence:** every production deploy to date has been run by hand from a workstation. There is no deployment record in the repository, no post-deploy smoke test, and no way to tell from here which commit any given worker is serving.

**Nothing is set.** `gh secret list` returns only `CLAUDE_CODE_OAUTH_TOKEN` and `CLOUDFLARE_ANALYTICS_READ_TOKEN` at the repository level, and `gh secret list --env production` is empty — while the workflow references five secrets. GitHub expands a missing secret to an empty string rather than failing, which is why the error surfaced inside wrangler instead of at the workflow level.

**Scope — set all five on the `production` environment**, not at repository level: the deploy job declares `environment: production`, so environment secrets resolve for it and for nothing else, whereas a repository secret is readable by every job in every workflow.

| Secret | Value | Actually secret? |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | account-owned token, see permissions below | yes |
| `SLACK_WEBHOOK_URL` | deploy notification webhook | yes |
| `CLOUDFLARE_ACCOUNT_ID` | `bdddc08c066a9abc285d75fe5947a468` | no — already committed in `apps/api/wrangler.toml` |
| `PRODUCTION_URL` | `https://api.makanmasak.com` — the **API** origin | no |
| `PRODUCTION_CUSTOMER_URL` | `https://makanmasak.com` | no |
| `PRODUCTION_KITCHEN_URL` | `https://kitchen.makanmasak.com` | no |

**The auto-deploy chain is a second, separate blocker** (absorbed 2026-09-05
from the deleted 2026-05-02 debt scan). Even with the secrets set, the workflow only
ever runs by hand: the `workflow_run:` trigger at
`.github/workflows/deploy-production.yml:16` is still commented out, with a
note at line 12 saying it stays disabled until the repository has an
environment approval gate. So there are two things to finish, and setting the
secrets only clears the first:

1. Secrets, so a dispatch can actually reach Cloudflare — the wizard below.
2. Required reviewers plus a main-only branch restriction on the `production`
   environment, then uncomment the `workflow_run` trigger, then delete the
   stale comments that still cite fixed smoke-test and missing
   `tests/e2e/smoke/` blockers (both resolved).

**There is now a wizard for this: `scripts/setup-production-deploy.sh`.** It
checks the `production` environment exists, walks the Cloudflare token form
permission by permission, **verifies the token against the account before
storing it** (the check that would have caught the 2026-07-24 failure), and sets
all six values as environment secrets. It never writes the token to disk. The
one thing it cannot do for you is create the token — that needs the dashboard.

**Re-verified 2026-09-05 — nothing has changed, and this is the highest-priority
open item in the file.** `gh run list --workflow=deploy-production.yml` still
shows exactly one `workflow_dispatch` (run `30110053816`, 2026-07-24, failure)
with every other run `workflow_run`-triggered and skipped.
`gh secret list --env production` is still empty; repository level still holds
only `CLAUDE_CODE_OAUTH_TOKEN` and `CLOUDFLARE_ANALYTICS_READ_TOKEN`, neither of
which this workflow uses.

The account is `bdddc08c066a9abc285d75fe5947a468`, which is not the one a local `wrangler login` resolves to by default — see the account-split note.

**Token permissions**, derived from the bindings actually declared across the ten `wrangler.toml` files. Account: Workers Scripts Edit, Workers KV Storage Edit, Workers R2 Storage Edit, D1 Edit, Queues Edit, Vectorize Edit, Workers AI Edit, **Cloudflare Pages Edit**, Account Settings Read. Zone (`makanmasak.com`): Workers Routes Edit, DNS Edit for the four `custom_domain` entries. Pages Edit is the one most easily missed — the five frontends deploy with `wrangler pages deploy`, which Workers Scripts Edit does not cover, and `pnpm -r run deploy:prod` reaches them. Do not add a client-IP restriction: GitHub-hosted runner addresses are not stable.

### ~~`coupons` is migrated in the repo but not in production~~

**Priority:** P1 **Status:** **Completed 2026-09-06.** `0019` (and `0018`, which
was pending alongside it) are applied to `makanmasak-prod`, and `apps/api` was
redeployed onto the new schema. `wrangler d1 migrations list` reports "No
migrations to apply". **Files:**
`packages/database/migrations_fresh/0019_coupon_valid_period_ms.sql`

**What was wrong:** `a9743a7d` (#271) changed `coupons.valid_from` / `valid_to`
from TEXT to `valid_from_ms` / `valid_to_ms` INTEGER and landed on `main`, but
the migration had not been applied to production, so `main` and the live schema
disagreed.

**Pre-flight, per CLAUDE.md — the surplus-column risk was real and came back
clean.** `d1 export` fails on this database (fts5), so the schema copy was built
from `sqlite_master` (583 objects; only the four fts5 shadow tables failed to
recreate, because the virtual table makes them itself) and `0018` + `0019` were
replayed against it. Production's `coupons` column set turned out to match
`__new_coupons` one-for-one — 23 columns each, differing only in the two being
renamed — so nothing would be silently dropped. The replay's schema diff showed
exactly four changed objects, all intended: the `coupons` table,
`idx_coupons_valid_period` re-pointed at the `_ms` columns, `store_id` added to
`platform_integrations`, and the new
`platform_integrations_platform_store_idx`.

**Verified against production after applying:** `pragma_table_info('coupons')`
shows `valid_from_ms` / `valid_to_ms` as `INTEGER NOT NULL`; all seven indexes
and both triggers are present; no `__new_coupons` or `__coupon_cascade_guard`
left behind (check this with `LIKE '\_\_%' ESCAPE '\'` — an unescaped `__`
matches every name, since `_` is a wildcard). `coupons` is production's 5th
STRICT table, so CLAUDE.md's STRICT bullet moved 4 → 5.

**The deploy is not optional, and the ordering note understated it.** This entry
previously framed the risk as "a deploy that skips the migration breaks coupon
reads". Applying the migration first inverts the same mismatch and breaks them
just as thoroughly: the live Worker predated `a9743a7d` by about ninety minutes,
so between the migration and the redeploy the public
`GET /api/v1/coupons/available/:restaurantId` answered 500 with
`Failed query: select "id", "restaurant_id", ...` — Drizzle enumerating a column
the table no longer had. Only `apps/api` reads `coupons`, so only it needed
redeploying; it now answers 200 with `{"success":true,"data":[]}`, the correct
answer for an empty table. **A schema/code split of this shape has no safe
order — it has a short window either way, and the two steps belong together.**

## health probes

### `/health/ready` still hand-rolls its D1 half instead of using `probeDatabase`

**Priority:** P3 **Status:** Open (identified 2026-09-05, deliberately left out
of the #332 fix) **Files:** `apps/api/src/features/system/routes/index.ts`,
`apps/api/src/core/health/probe.ts` **Context:** #332 replaced the KV half of
`/health/ready` with the shared `probeCache`. The D1 half was left as it was: a
dynamic `import("@makanmasak/database")` plus a Drizzle
`SELECT 1 FROM users LIMIT 1`, rather than `probeDatabase`'s raw
`SELECT 1 AS ok` on the binding. Neither cost is material on its own — the
module graph is cached per isolate after the first call — but the asymmetry is
the same shape as the bug #332 fixed: a probe reimplemented per endpoint drifts
from the shared one, and nobody notices because both return a boolean.
`UPTIME_MONITOR_TARGETS` polls this path every 60s as `critical: true`, so
whatever semantics `probeDatabase` grows later (session constraints,
`served_by_primary` reporting) should reach it too. **Why it was deferred:** the
route test harness mocks D1 as `withSession(...).prepare(...).all()` for
`runBasicHealthCheck` but feeds `/health/ready` through the Drizzle select
fixture queue; switching probes means reworking fixtures across the whole
`system routes` suite, which is a bigger change than the one-line bug #332 was
filed for.

## health probes

### `/health/ready` still hand-rolls its D1 half instead of using `probeDatabase`

**Priority:** P3 **Status:** Open (identified 2026-09-05, deliberately left out
of the #332 fix) **Files:** `apps/api/src/features/system/routes/index.ts`,
`apps/api/src/core/health/probe.ts` **Context:** #332 replaced the KV half of
`/health/ready` with the shared `probeCache`. The D1 half was left as it was: a
dynamic `import("@makanmasak/database")` plus a Drizzle
`SELECT 1 FROM users LIMIT 1`, rather than `probeDatabase`'s raw
`SELECT 1 AS ok` on the binding. Neither cost is material on its own — the
module graph is cached per isolate after the first call — but the asymmetry is
the same shape as the bug #332 fixed: a probe reimplemented per endpoint drifts
from the shared one, and nobody notices because both return a boolean.
`UPTIME_MONITOR_TARGETS` polls this path every 60s as `critical: true`, so
whatever semantics `probeDatabase` grows later (session constraints,
`served_by_primary` reporting) should reach it too. **Why it was deferred:** the
route test harness mocks D1 as `withSession(...).prepare(...).all()` for
`runBasicHealthCheck` but feeds `/health/ready` through the Drizzle select
fixture queue; switching probes means reworking fixtures across the whole
`system routes` suite, which is a bigger change than the one-line bug #332 was
filed for.

## Completed

Completed work is **not** collected here — it stays inline under its own section
with a `Status: Completed <date>` marker, so the surrounding context and scope
stay attached to it. As of 2026-09-05 that covers thirteen items: the six
i18n entries, the four waiting-list entries, customer-identity Phase 1 (which
uses a `Status (verified ...)` marker rather than `Status: Completed`, so a
grep for the latter finds only twelve), and marketplace Phases 1 and 3.

One of the thirteen is only **partially** complete and should not be read as
shipped-in-full: "Wire push notification end-to-end" covers `waiting_called`
only — `waiting_about_to_expire` still needs a scheduler/alarm and has never
been built.

This heading is kept only so that the "_None yet._" placeholder that used to sit
here stops reading as "nothing in this file has shipped".
