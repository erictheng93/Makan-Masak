# Repository Guidelines

## Project Structure & Module Organization

This repository is a `pnpm` workspace monorepo (Node >=22.18 and pnpm 12). Application code lives in `apps/`: the Vue front-ends `customer-app`, `admin-dashboard`, `kitchen-display`, `management-portal`, and `onboarding-app`; the Cloudflare Workers `api`, `management-api`, `realtime`, `image-processor`, and `backup-scheduler`; and the local Node daemon `print-agent`. Shared code lives in `packages/` (`shared`, `shared-types`, `database`, `utils`, `auth-client`, `ai-analytics`, `queue-core`, `queue-service`); `packages/shared/src/i18n` is also a workspace package. Cross-project tests and fixtures live in `tests/` with `unit`, `integration`, `e2e`, `visual`, `performance`, and `security` subfolders. Longer design and operational docs belong in `docs/`.

## Codebase Memory MCP Notes

Two `get_architecture` fields lie: `packages[].fan_in` / `fan_out` are always zero regardless of the real dependencies, and `packages[]` is a truncated summary rather than the package inventory. Use `boundaries` or an `IMPORTS` graph query for cross-package questions. `CLAUDE.md` ("codebase-memory MCP: `get_architecture` gotchas") is the single source for this, including the working Cypher and the literal-only restriction on its `WHERE` clause.

## Build, Test, and Development Commands

Use `pnpm` only. Key commands:

- `pnpm dev`: run the full Turbo dev graph.
- `pnpm dev:customer` / `pnpm dev:api`: run one app locally.
- `pnpm build`: build all workspaces.
- `pnpm test`, `pnpm test:coverage`, `pnpm test:e2e`: Vitest workspace, coverage, and Playwright suites. `pnpm test:real-integration` runs the real-service integration set.
- `pnpm verify`: run the affected-package inner-loop gate; `pnpm verify:push`: run the complete local pre-push gate (lint, typecheck, formatting, guard scripts, package/root tests, and real integration tests).
- `pnpm db:migrate:local`: apply local D1 migrations.

## Coding Style & Naming Conventions

The codebase is TypeScript-first with Vue 3 and Cloudflare Workers. Prettier enforces 2-space indentation, semicolons, double quotes, trailing commas, and 80-column wrapping. Run `pnpm lint:fix` before submitting. Use `PascalCase` for Vue components and types, `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for constants, and `kebab-case` for filenames such as `order-service.ts`.

For user-facing work, follow `DESIGN.md` and use the shared palette tokens in `design-tokens.js`; `pnpm run check:design-palette` enforces this across the Vue apps.

## Testing Guidelines

Vitest is the primary test runner; Playwright covers end-to-end and visual flows. Name tests `*.test.ts` and keep them near the owning app/package or under `tests/`. Global coverage thresholds are 85%; `apps/api/src/features/**/*.ts` requires 90% functions, lines, and statements, with an interim 78% branch threshold. Add or update tests with every behavior change, especially for API routes, realtime flows, and database logic.

## Database Schema & Migration Guidelines

Drizzle schema files in `packages/database/src/schema/` are the source of truth for tables and columns, but triggers, partial indexes, and CHECK constraints can exist only in migration SQL. Two migration directories are applied by wrangler, against two different databases: `packages/database/migrations_fresh/` (platform) and `apps/management-api/migrations/` (control plane). Two more, `packages/database/migrations/` and `packages/database/migrations_v2/`, are applied by nothing.

**Read `CLAUDE.md`, "Database (Cloudflare D1)", before writing any migration.** It is the single source for which binding reaches which track and which command ships it, why `pnpm db:generate` is not the workflow, the STRICT-table rule, the `timestamp_ms` and partial-unique-index requirements, the secret-storage rule, and the procedure for touching production D1 by hand. Keep it there: the last time this file restated those rules, the two copies drifted apart, and CLAUDE.md went on describing a single migration track long after that stopped being true.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits, for example `feat(tests): ...`, `fix(kitchen): ...`, and `docs(testing): ...`. Use `<type>(<scope>): <subject>` with clear scopes like `api`, `customer`, `kitchen`, `database`, or `tests`. PRs should include a short problem/solution summary, linked issues, screenshots for UI changes, and the exact verification commands you ran.

Unless the user explicitly asks to create a new branch or open a pull request, make atomic commits for completed work but do not push to the remote. Wait for the user to audit the committed result, and push only when the user explicitly asks. Each commit should contain only the intended related changes.

## Multi-Role Access System

Roles are the integers 0-5, defined in `apps/api/src/shared/constants/index.ts` and listed with their scopes in `CLAUDE.md`, "Multi-Role Access System".
