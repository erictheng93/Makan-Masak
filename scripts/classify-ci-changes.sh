#!/usr/bin/env bash

set -euo pipefail

full="${1:-false}"

# Which scripts have a regression suite is declared once, in guard-suites.txt,
# and read here and by scripts/run-guard-tests.cjs. Keeping a second copy in
# this case statement is what let four guards go unrun on the very PRs that
# changed them. Resolve against this script's own directory: CI invokes it from
# the repo root, its test suite by absolute path.
guard_suites_file="$(dirname "$0")/guard-suites.txt"
guarded_scripts="$(awk '!/^#/ && NF { print $1 }' "$guard_suites_file")"

is_guarded_script() {
  while IFS= read -r guarded; do
    [ "$1" = "$guarded" ] && return 0
  done <<EOF
$guarded_scripts
EOF
  return 1
}

app=false
backend=false
frontend=false
integration=false
tooling=false
guard_tests=false
full_lint=false

if [ "$full" = "true" ]; then
  app=true
  backend=true
  frontend=true
  integration=true
  tooling=true
else
  while IFS= read -r file; do
    [ -z "$file" ] && continue

    case "$file" in
      pnpm-lock.yaml | package.json | pnpm-workspace.yaml | turbo.json | \
        tsconfig*.json | vitest*.config.* | playwright*.config.* | .npmrc | \
        codecov.yml)
        full=true
        app=true
        backend=true
        frontend=true
        integration=true
        tooling=true
        ;;
      eslint.config.*)
        tooling=true
        full_lint=true
        ;;
      .prettierignore | .prettierrc*)
        tooling=true
        ;;
      scripts/*)
        tooling=true
        if is_guarded_script "$file"; then
          guard_tests=true
        fi
        ;;
      .github/workflows/*)
        full=true
        app=true
        backend=true
        frontend=true
        integration=true
        tooling=true
        ;;
      apps/customer-app/* | apps/admin-dashboard/* | apps/kitchen-display/*)
        app=true
        frontend=true
        integration=true
        ;;
      apps/management-portal/* | apps/onboarding-app/*)
        app=true
        frontend=true
        ;;
      apps/api/* | apps/management-api/*)
        app=true
        backend=true
        integration=true
        ;;
      # image-processor owns a real-D1 suite (orphan-sweep.real.integration),
      # which only the real-integration job runs. Without `integration` a change
      # to the sweep itself never exercises it.
      apps/image-processor/*)
        app=true
        backend=true
        integration=true
        ;;
      apps/realtime/* | apps/backup-scheduler/* | apps/print-agent/*)
        app=true
        backend=true
        ;;
      packages/database/* | packages/queue-core/* | packages/queue-service/* | \
        packages/shared/* | packages/shared-types/* | packages/utils/* | \
        packages/auth-client/* | packages/ai-analytics/*)
        app=true
        backend=true
        frontend=true
        integration=true
        ;;
      tests/unit/* | tests/security/*)
        app=true
        backend=true
        ;;
      tests/integration/*)
        app=true
        backend=true
        integration=true
        ;;
      tests/e2e/* | tests/visual/* | tests/performance/*)
        app=true
        frontend=true
        ;;
      README.md | docs/api/README.md | docs/architecture/README.md)
        tooling=true
        ;;
      apps/* | packages/*)
        # Unknown workspaces get the widest scope. Missing a new suite is more
        # expensive than temporarily over-running CI.
        app=true
        backend=true
        frontend=true
        integration=true
        ;;
      docs/* | .github/* | *.md | *.png | *.jpg | *.jpeg)
        ;;
      *)
        # Only explicit documentation and workflow paths may skip validation.
        full=true
        app=true
        backend=true
        frontend=true
        integration=true
        tooling=true
        ;;
    esac
  done
fi

printf 'app=%s\n' "$app"
printf 'backend=%s\n' "$backend"
printf 'frontend=%s\n' "$frontend"
printf 'integration=%s\n' "$integration"
printf 'tooling=%s\n' "$tooling"
printf 'guard_tests=%s\n' "$guard_tests"
printf 'full_lint=%s\n' "$full_lint"
printf 'full=%s\n' "$full"
