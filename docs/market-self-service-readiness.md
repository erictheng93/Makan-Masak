# Market publication and shop ordering readiness

## Decision and scope

Keep incomplete markets hidden from public discovery, including the existing
`MARKET_NOT_FOUND` response. Administrators use the existing public-readiness
endpoint/workbench to see missing description, location, hours, vendors and
searchable catalog (products or public services). Images and maps are recommended.
Draft markets may omit hours; provided hours must be a weekday-keyed object with
valid clock times. Accept short and full English weekday names already used by
clients, closed days, and overnight hours as stored schedules. The existing
restaurant `isOpenNow` calculation does not support overnight fulfillment; this
change does not claim to add that separate runtime capability. Invalid stored hours must not satisfy
publication readiness.

The current code already exposes `PUT /api/v1/restaurants/:id/shop-mode` and the
owner Settings QR panel. Do not add a second activation API. It is protected by
owner/admin authorization, restaurant ownership and the `table_management` module
gate. Verify this path with local real-D1 integration tests. A missing deployed
endpoint must be investigated as a version/routing issue, not patched in D1.

Restaurant `supportsTakeaway` and `supportsDelivery` columns are authoritative
when loading settings; legacy JSON is a fallback only if a column is absent.
Saving keeps both representations aligned through the existing update API.

## Implementation and acceptance

1. Add regression tests for contradictory fulfillment columns/settings, then fix
   SettingsView loading. Saving unrelated settings must preserve the columns.
2. Validate market opening hours on create/update/bulk create, using the same
   contract in publication readiness. Reject arrays, unknown days and invalid or
   incomplete times; accept empty/null draft schedules and closed/overnight days.
3. Normalize short weekdays to full restaurant weekday names during vendor
   import; full names win when legacy data contains both aliases. Closed days
   receive zero-time placeholders and remain disabled.
4. Verify owner API activation creates a QR code and changes discovery eligibility;
   disabling takes it out of service and another owner cannot change it.
5. Record the operational procedure and local verification results.

Use existing TypeScript/Zod/Vitest conventions, two-space indentation and double
quotes. Source lives in `apps/api/src/features/markets` and the existing admin
SettingsView; tests stay alongside source or in the API real-integration suite.
No new dependencies, migrations or production data mutations are needed.

## Verification commands

- `pnpm --filter @makanmasak/api exec vitest run src/features/markets`
- `pnpm --filter makanmasak-admin-dashboard exec vitest run src/views/SettingsView.test.ts`
- `pnpm --filter @makanmasak/api test:real-integration src/__tests__/integration/markets.real.integration.test.ts -t 'activate and deactivate|takeaway eligibility|hides empty|computes public readiness'`
- `pnpm verify`

## Operator procedure

1. Create a draft market, then inspect
   `GET /api/v1/admin/markets/:id/public-readiness` (admin only). Complete required
   profile fields and attach a vendor with searchable products/public services.
   Hours example: `{"mon":{"open":"10:00","close":"22:00"}}`; provide the
   actual schedule for every operating day. A closed day can be `{"closed":true}`.
2. As the owner, save fulfillment settings in Settings, then enable shop mode in
   the QR panel. The underlying API accepts `{"enabled":true}`. At least one
   fulfillment method must already be saved. Module denial requires checking the
   restaurant entitlement; do not bypass it by updating D1.
3. Check `GET /api/v1/discovery/restaurants/:id/takeaway-eligibility` during opening
   hours. Takeaway also requires an active restaurant, `supportsTakeaway`, enabled
   shop mode and a generated QR code. A JSON setting alone is insufficient.
4. Prefer isolated local integration fixtures for rehearsals. If an authorized
   production rehearsal is necessary, capture its exact row IDs and baseline
   values first, restore only those rows/counters, and compare all affected tables
   with the baseline afterward. The previously reported 54-table comparison is
   historical evidence, not a check rerun by this change.

## Verification evidence

The new regression cases failed before the fix: six malformed-hours cases and
both contradictory-settings cases. After the fix, the market feature suite
passed 58 tests and SettingsView passed 17. The focused real-D1 run passed all
three selected scenarios (37 unrelated scenarios were skipped). Independent code
review found no blocking issues and independently passed the 11 hours-contract
tests. No production database comparison was performed.

A further regression test reproduced the short-weekday import bug: market `mon`
was persisted as restaurant `mon` although eligibility reads `monday`. The import
now normalizes aliases and tests opening status at a fixed Monday timestamp.
