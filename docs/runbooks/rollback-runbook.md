# Rollback Runbook

Use this when a production deploy causes elevated errors, broken login, failed ordering, failed realtime updates, or failed smoke tests.

## Decision Criteria

Rollback immediately when any of these hold for more than 5 minutes:

- API `/info` or customer app liveness fails.
- Order creation, payment, or kitchen display updates are unavailable.
- Realtime websocket upgrades fail broadly after deploy.
- Error rate or operator-reported impact is high and no fix is ready.

## Steps

1. Freeze further deploys.
2. Identify the affected surface: API Worker, realtime Worker, Pages app, D1 migration, or configuration/secrets.
3. Capture evidence: deploy SHA, workflow URL, Cloudflare deployment ID, first bad timestamp, and failing smoke output.
4. Roll back the affected Worker. **The API Worker has a rollback floor; never
   use a bare `wrangler rollback` on it.** Pick a target from
   `wrangler versions list --env production` (in `apps/api`) and run:

```bash
pnpm rollback:api <version-id> --dry-run  # check only, rolls nothing back
pnpm rollback:api <version-id>            # refuses a version below the floor
```

   `apps/api/rollback-floor.json` names the oldest commit whose API is safe
   against current production data, plus explicitly vetted version ids. Since
   migration 0042 (staff usernames unique per restaurant) any older API finds
   staff by username alone and keys the login lockout on the username: with
   two shops sharing a username it logs in the wrong account or locks one
   shop's staff out for another's mistakes. If no version at or after the floor
   is good, roll forward with a fix instead. `pnpm run deploy:prod` in
   `apps/api` tags every version with its commit so the guard can check it.

   Other Workers:

```bash
wrangler deployments list --name <worker-name>
wrangler rollback --name <worker-name> --message "Rollback <incident-id>"
```

5. Roll back an affected Pages app from the Cloudflare Pages dashboard to a
   known-good deployment. **For the admin dashboard and the kitchen display,
   check the target first** (wrangler has no Pages rollback command, so this
   check is the only gate):

```bash
pnpm rollback:check admin <deployment-id>     # or: kitchen
```

   It refuses any deployment older than the commit in that app's
   `rollback-floor.json`. Since migration 0042 those older builds have no
   `/s/{shop}` login page, so staff whose username exists at more than one
   shop could not sign in at all. Only click "Rollback" on a deployment the
   check prints as safe.
6. If a D1 migration is involved, do not manually reverse it in production until the backup/restore runbook has been reviewed for the incident.
7. Re-run smoke checks:

```bash
curl --fail "$PRODUCTION_URL/info"
```

8. Record outcome in the incident notes and create a follow-up issue for the forward fix.

## Verification

Rollback is complete only when:

- The previous deployment is active in Cloudflare.
- Public liveness checks pass.
- The originally failing user path is confirmed fixed or mitigated.
- The incident notes include the bad SHA and rollback target.
