import { defineConfig, devices } from "@playwright/test";

/**
 * MakanMakan E2E 測試配置
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI workers: 2 — a memory ceiling inside the Playwright Docker container,
  // where a GitHub Actions runner has ~7 GB RAM and each worker is a browser.
  //
  // It is no longer a runtime tuning knob for the root `testDir`: `chromium`
  // collects 3 tests (ci-smoke/preview.spec.ts plus the two kitchen-display
  // specs) and finishes in seconds. The projects this value actually bounds
  // are `smoke` (111 tests) and `admin-real` (41). The figure it used to cite
  // — 158 tests, ~8 min per browser, 4 simultaneous Firefox processes going
  // OOM — described the tests/e2e/journeys and tests/e2e/specs suites deleted
  // by b936600f in 2026-05, and the five extra browser projects that ran them.
  //
  // `admin-real` (workers: 1) and `integration` (fullyParallel: false, plus
  // --workers=1 from .github/workflows/nightly-integration.yml) override this
  // themselves: both mutate one restaurant's rows in a real D1.
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["json", { outputFile: "playwright-report/results.json" }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    // Everything under tests/e2e that is not claimed by a directory-scoped
    // project below: today that is ci-smoke/preview.spec.ts and the two
    // kitchen-display specs.
    //
    // One browser, deliberately. This used to be six — firefox, webkit,
    // Mobile Chrome, Mobile Safari and Tablet sat alongside it with the same
    // testDir and the same testIgnore, so after b936600f deleted
    // tests/e2e/journeys and tests/e2e/specs all six collected the identical
    // 3 tests and cross-browser coverage of the customer flows they were
    // written for no longer existed to run (#356). Six copies of the same
    // signal read like a browser matrix without being one, so the other five
    // are gone.
    //
    // If cross-browser coverage is wanted again, it needs specs that are
    // worth running twice first; tests/unit/playwright-project-testdirs.test.ts
    // fails on any two projects that would collect the same files, so
    // re-adding a browser is a decision someone has to make explicitly.
    {
      name: "chromium",
      testIgnore: ["**/admin/**", "**/integration/**", "**/smoke/**"],
      use: { ...devices["Desktop Chrome"] },
    },

    // Admin dashboard tests — real API, real D1, no request mocking.
    //
    // Named `admin-real`, not `admin`. The old `admin` project pointed at this
    // same directory after b936600f deleted its 19 mock-based specs, and stayed
    // in the config for 3.5 months collecting zero tests. That was not inert:
    // `--project=admin` alone exits 1 with "No tests found", but combined with a
    // non-empty sibling — which is exactly how .github/workflows/test.yml
    // invoked it — the empty project is absorbed and the run reports green.
    // Renaming means any stale `--project=admin` now fails loudly instead.
    //
    // workers:1 as well as fullyParallel:false — the latter only serialises
    // within one file, and these specs share one restaurant's rows in D1.
    {
      name: "admin-real",
      testDir: "./tests/e2e/admin",
      fullyParallel: false,
      workers: 1,
      // A cold wrangler-dev isolate answers its first calls in seconds, and the
      // specs assert against the server after every write.
      timeout: 180_000,
      // Deliberately not the root's CI value of 2: a retry against a real
      // mutating backend re-runs over dirty state, so retries hide ordering
      // bugs here rather than absorbing flake.
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.E2E_ADMIN_URL || "http://localhost:3001",
        viewport: { width: 1280, height: 800 },
        actionTimeout: 20_000,
        navigationTimeout: 45_000,
      },
    },

    // Integration tests (real API, no mocking) — serial to avoid active-order dedup
    {
      name: "integration",
      testDir: "./tests/e2e/integration",
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.WORKFLOW_CUSTOMER_URL || "http://localhost:3000",
      },
    },

    // Smoke tests — minimal canary against any deployed env (local /
    // production). Reads SMOKE_* env vars; falls back to localhost so the
    // suite is runnable against `pnpm dev` with no extra setup.
    {
      name: "smoke",
      testDir: "./tests/e2e/smoke",
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.SMOKE_CUSTOMER_URL ?? "http://localhost:3000",
      },
    },
  ],

  // webServer: {
  //   command: 'pnpm run dev',
  //   url: 'http://localhost:5173',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120000
  // },

  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
});
