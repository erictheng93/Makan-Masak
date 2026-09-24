#!/usr/bin/env bash
# Regenerate the screenshots for the onboarding app's "how it works" tour.
#
#   scripts/onboarding-tour/capture.sh
#
# Brings up a throwaway local stack (API and realtime Workers + customer,
# kitchen and admin SPAs) on its own D1 state directory, seeds the showcase menu, drives it with
# capture.mjs, and writes the images to apps/onboarding-app/public/tour/.
# Nothing touches .wrangler/shared-state, so your local dev data is safe.
#
# Needs the default dev ports free: 8787, 8788, 3000, 3001, 3002, 3099.
# `--serve` stops after seeding and keeps the stack up (Ctrl-C to quit), for
# working on capture.mjs against it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

STATE="$(mktemp -d "${TMPDIR:-/tmp}/onboarding-tour.XXXXXX")"
LOGS="$STATE/logs"
mkdir -p "$LOGS"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]}"; do
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$STATE"
}
trap cleanup EXIT

for port in 8787 8788 3000 3001 3002 3099; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port is in use; stop your dev servers first" >&2
    exit 1
  fi
done

wait_for() {
  local elapsed=0
  until curl -sf "$1" >/dev/null 2>&1; do
    if [ "$elapsed" -ge 180 ]; then
      echo "$1 did not come up; logs in $LOGS" >&2
      tail -n 40 "$LOGS"/*.log >&2 || true
      trap - EXIT
      exit 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
}

d1() {
  pnpm exec wrangler d1 "$@" --local --persist-to "$STATE/d1" \
    --config=./apps/api/wrangler.toml >/dev/null
}

echo "seeding $STATE/d1"
d1 migrations apply makanmakan-local
d1 execute makanmakan-local --file=./scripts/seed-local.sql
d1 execute makanmakan-local --file=./scripts/onboarding-tour/seed-showcase.sql

# Dev-only secrets, passed as an env file in the throwaway directory rather
# than written to apps/api/.dev.vars.
cat >"$STATE/api.env" <<'EOF'
JWT_SECRET=onboarding-tour-capture-jwt-secret-minimum-32-chars
QR_SIGNING_KEY=onboarding-tour-capture-qr-signing-key-min-32-chars
CORS_ORIGIN=http://localhost:3000,http://localhost:3001,http://localhost:3002
EOF

echo "starting API and SPAs"
(cd apps/api && exec pnpm exec wrangler dev --local --port 8787 \
  --persist-to "$STATE/d1" --env-file "$STATE/api.env" >"$LOGS/api.log" 2>&1) &
PIDS+=($!)
wait_for http://localhost:8787/info

# Without realtime the customer's tracking page shows a connection error.
(cd apps/realtime && exec pnpm exec wrangler dev --local --port 8788 \
  --persist-to "$STATE/d1" --env-file "$STATE/api.env" >"$LOGS/realtime.log" 2>&1) &
PIDS+=($!)

for app in customer-app:3000 admin-dashboard:3001 kitchen-display:3002; do
  (cd "apps/${app%%:*}" && exec pnpm exec vite --port "${app##*:}" --strictPort \
    >"$LOGS/${app%%:*}.log" 2>&1) &
  PIDS+=($!)
done
wait_for http://localhost:8788/health
for port in 3000 3001 3002; do wait_for "http://localhost:$port"; done

if [ "${1:-}" = "--serve" ]; then
  node scripts/onboarding-tour/capture.mjs --serve-photos &
  PIDS+=($!)
  echo "stack is up (customer :3000, admin :3001, kitchen :3002); Ctrl-C to stop"
  wait
fi

node scripts/onboarding-tour/capture.mjs
