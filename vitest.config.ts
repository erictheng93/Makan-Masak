import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  test: {
    // Workspace projects configuration
    // Each project uses its own vitest.config.ts or inline config
    projects: [
      // Root-level tests (generic tests)
      {
        extends: true,
        test: {
          name: "root",
          root: ".",
          include: [
            "tests/unit/**/*.test.{js,ts}",
            "tests/e2e/**/*.test.{js,ts}",
            "tests/performance/**/*.test.{js,ts}",
          ],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/legacy/**",
            "**/Backup/**",
          ],
          environment: "node",
          globals: true,
          testTimeout: 60000,
          hookTimeout: 60000,
        },
      },
      // Apps - each uses its own vitest.config.ts
      "apps/admin-dashboard",
      "apps/customer-app",
      "apps/kitchen-display",
      "apps/api",
      "apps/image-processor",
      "apps/management-api",
      "apps/management-portal",
      "apps/realtime",
      "apps/onboarding-app",
      "apps/print-agent",
      // Packages - each uses its own vitest.config.ts
      "packages/auth-client",
      "packages/ai-analytics",
      "packages/database",
      "packages/queue-core",
      "packages/queue-service",
      "packages/shared",
      "packages/utils",
    ],

    // Pool configuration (Vitest 4 flat format)
    pool: "forks",
    maxWorkers: 2,
    minWorkers: 1,
    execArgv: ["--max-old-space-size=8192"],

    // Coverage configuration (global)
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      // A CI shard (`--shard=i/n --reporter=blob`) only holds part of the
      // coverage, so it must not judge thresholds; the `--merge-reports` job
      // re-reads this config without the variable and enforces them once.
      thresholds: process.env.VITEST_COVERAGE_SHARD
        ? undefined
        : {
            // Whole-suite floor. Vitest reads it from these top-level keys
            // only; any other key is a file glob. Until 2026-11 it sat under
            // `global:` (Jest's spelling), a glob matching no file, so the
            // intended 85% never ran while the suite stood at 62.49 / 56.25 /
            // 57.46 / 63.39 (statements / branches / functions / lines). These
            // floors are those numbers rounded down: ratchet them up as
            // coverage rises, never down.
            statements: 62,
            branches: 56,
            functions: 57,
            lines: 63,
            "apps/api/src/features/**/*.ts": {
              // Current feature branch baseline is ~78.5%; keep the other API
              // feature coverage gates at 90% while branch gaps are closed.
              branches: 78,
              functions: 90,
              lines: 90,
              statements: 90,
            },
            "apps/realtime/src/**/*.ts": {
              branches: 85,
              functions: 85,
              lines: 85,
              statements: 85,
            },
          },
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.d.ts",
        "**/*.config.ts",
        "**/tests/**",
        "**/__tests__/**",
        "**/coverage/**",
        "**/legacy/**",
        "**/Backup/**",
      ],
      include: ["apps/*/src/**/*.{ts,tsx,vue}", "packages/*/src/**/*.{ts,tsx}"],
    },
  },
  resolve: {
    alias: {
      "@tests": path.resolve(__dirname, "./tests"),
      "@": path.resolve(__dirname, "./src"),
      "@makanmasak/ai-analytics": path.resolve(
        __dirname,
        "./packages/ai-analytics/src/index.ts",
      ),
      "@makanmasak/database": path.resolve(
        __dirname,
        "./packages/database/src/index.ts",
      ),
      "@makanmasak/queue-core": path.resolve(
        __dirname,
        "./packages/queue-core/src/index.ts",
      ),
      "@makanmasak/shared": path.resolve(
        __dirname,
        "./packages/shared/src/index.ts",
      ),
      "@makanmasak/shared-types": path.resolve(
        __dirname,
        "./packages/shared-types/src/index.ts",
      ),
      "@makanmasak/utils": path.resolve(
        __dirname,
        "./packages/utils/src/index.ts",
      ),
    },
  },
});
