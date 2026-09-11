import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlaywrightTestConfig } from "@playwright/test";
import { beforeAll, describe, expect, it } from "vitest";

import playwrightConfig from "../../playwright.config";

// Anchored on this file, not process.cwd(): a cwd-relative path only resolves
// when the runner happens to be invoked from the repo root.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// A config that omits `testDir` defaults to the config's own directory, which
// for an app-level config is the app root -- and walking that means walking
// node_modules. Skipping these keeps the guard from hanging on exactly the
// misconfiguration it exists to report.
const NOT_A_TEST_DIR = new Set(["node_modules", "dist", "coverage", ".git"]);

function specFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_A_TEST_DIR.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...specFilesUnder(full));
    } else if (/\.spec\.ts$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * `testMatch` / `testIgnore` accept a string, a RegExp, or an array of either.
 * Order carries no meaning, so sort before comparing.
 */
function normalizePatterns(value: unknown): string[] {
  if (value === undefined) return [];
  const patterns = Array.isArray(value) ? value : [value];
  return patterns.map((pattern) => String(pattern)).sort();
}

/**
 * Guards the failure mode that hid an empty Playwright project for 3.5 months.
 *
 * `playwright.config.ts` declared a project named `admin` pointing at
 * `tests/e2e/admin`, which b936600f deleted in 2026-05. Playwright never
 * validates that a `testDir` exists, and — this is the part that made it
 * invisible — "no tests found" only fails the run when *every* selected project
 * is empty. CI invoked `--project=chromium --project=admin`, chromium supplied
 * tests, and the run exited 0 having executed nothing from `admin`.
 *
 * Neither verification tier can see this: `pnpm verify` and `pnpm verify:push`
 * run vitest, never Playwright. So the check has to live here, as a unit test,
 * to be reached at all.
 */
describe("playwright project testDirs", () => {
  const projects = playwrightConfig.projects ?? [];

  it("declares at least one project", () => {
    expect(projects.length).toBeGreaterThan(0);
  });

  /**
   * The other half of b936600f, and the half the checks above cannot see
   * (#356).
   *
   * `firefox`, `webkit`, `Mobile Chrome`, `Mobile Safari` and `Tablet` each
   * declared the root testDir and the identical testIgnore, so once
   * tests/e2e/journeys and tests/e2e/specs were deleted, all six browser
   * projects collected exactly the same 3 tests. Nothing failed — the
   * kitchen-display specs simply ran six times, and a reader of the config
   * would reasonably conclude they had cross-browser coverage.
   *
   * Two projects with the same testDir/testMatch/testIgnore always collect the
   * same files, so a duplicate key here is a duplicate suite. A genuine
   * cross-browser matrix would trip this too — that is the point: it is a
   * decision worth making on purpose, and whoever makes it updates this test
   * and says which specs are worth running twice.
   */
  it("has no two projects that collect the same files", () => {
    const seen = new Map<string, string[]>();

    for (const project of projects) {
      const key = JSON.stringify({
        testDir: project.testDir ?? playwrightConfig.testDir ?? ".",
        testMatch: normalizePatterns(project.testMatch),
        testIgnore: normalizePatterns(project.testIgnore),
      });
      seen.set(key, [...(seen.get(key) ?? []), project.name ?? "(unnamed)"]);
    }

    const duplicates = [...seen.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([key, names]) => `${names.join(", ")} all select ${key}`);

    expect(
      duplicates,
      `these projects have identical file selection, so each extra one re-runs ` +
        `the same tests under a different name:\n  ${duplicates.join("\n  ")}`,
    ).toEqual([]);
  });

  it.each(
    projects
      .filter((project) => typeof project.testDir === "string")
      .map((project) => ({
        name: project.name ?? "(unnamed)",
        testDir: project.testDir as string,
      })),
  )("$name resolves to a directory that exists", ({ name, testDir }) => {
    const resolved = join(repoRoot, testDir);
    expect(
      existsSync(resolved),
      `project "${name}" has testDir "${testDir}", which does not exist`,
    ).toBe(true);
  });

  it.each(
    projects
      .filter((project) => typeof project.testDir === "string")
      .map((project) => ({
        name: project.name ?? "(unnamed)",
        testDir: project.testDir as string,
      })),
  )("$name contains at least one spec file", ({ name, testDir }) => {
    const resolved = join(repoRoot, testDir);
    if (!existsSync(resolved)) return; // reported by the sibling assertion

    expect(
      specFilesUnder(resolved).length,
      `project "${name}" (testDir "${testDir}") collects no *.spec.ts, so it ` +
        `contributes no signal — and passes silently whenever it is run ` +
        `alongside a non-empty project`,
    ).toBeGreaterThan(0);
  });
});

/**
 * The same failure one level down (#358).
 *
 * `apps/customer-app/playwright.config.ts` declared `testDir: "./e2e"` and
 * seven browser projects against a directory that had never existed. The suite
 * above could not see it — it reads the root config and nothing else — and no
 * workflow, root script or turbo task invoked the per-app config either, so
 * there was no run to go red. It simply sat in the tree describing a
 * cross-browser customer suite the repository did not contain.
 *
 * Discovering the configs by directory listing rather than by importing a
 * fixed list is the point: a `playwright.config.ts` added to a new app is
 * checked the day it lands, without anyone remembering to come back here.
 */
describe("app-level playwright configs", () => {
  const appsDir = join(repoRoot, "apps");
  // Matched by shape rather than by exact filename: `playwright.config.ts` is
  // the convention, but a config named anything else is just as invisible, and
  // an app-level Playwright config is what is being looked for, not a path.
  const isPlaywrightConfig = /^playwright.*\.config\.[cm]?[jt]s$/;
  const configPaths = readdirSync(appsDir)
    .flatMap((app) => {
      const appDir = join(appsDir, app);
      if (!statSync(appDir).isDirectory()) return [];
      return readdirSync(appDir)
        .filter((entry) => isPlaywrightConfig.test(entry))
        .map((entry) => join(appDir, entry));
    })
    .sort();

  const configs = new Map<string, PlaywrightTestConfig | undefined>();

  // Cold-importing these inside a timed test body would charge the whole
  // @playwright/test transform to the case that happened to run first.
  beforeAll(async () => {
    for (const configPath of configPaths) {
      const loaded = (await import(/* @vite-ignore */ configPath)) as {
        default?: PlaywrightTestConfig;
      };
      configs.set(configPath, loaded.default);
    }
  }, 30_000);

  /**
   * Playwright resolves a project's `testDir` to the project's own value, else
   * the config-level one, else the config's directory. A config with no
   * `projects` at all still collects tests — `apps/kitchen-display` is one —
   * so the config-level `testDir` has to be checked in its own right.
   */
  function effectiveTestDirs(
    config: PlaywrightTestConfig,
  ): { project: string; testDir: string }[] {
    const projects = config.projects ?? [];
    if (projects.length === 0) {
      return [{ project: "(no projects)", testDir: config.testDir ?? "." }];
    }
    return projects.map((project) => ({
      project: project.name ?? "(unnamed)",
      testDir: project.testDir ?? config.testDir ?? ".",
    }));
  }

  it("every app-level config selects a directory that exists and holds specs", () => {
    const problems: string[] = [];

    for (const configPath of configPaths) {
      const configName = relative(repoRoot, configPath);
      const config = configs.get(configPath);

      if (!config) {
        problems.push(`${configName} has no default-exported config`);
        continue;
      }

      for (const { project, testDir } of effectiveTestDirs(config)) {
        // Relative to the config, not to the repo root: an app-level config
        // reaching the shared suite writes "../../tests/e2e/<app>".
        const resolved = resolve(dirname(configPath), testDir);

        if (!existsSync(resolved)) {
          problems.push(
            `${configName} [${project}] testDir "${testDir}" does not exist`,
          );
          continue;
        }

        if (specFilesUnder(resolved).length === 0) {
          problems.push(
            `${configName} [${project}] testDir "${testDir}" contains no *.spec.ts`,
          );
        }
      }
    }

    expect(
      problems,
      `an app-level Playwright config points at nothing runnable. Either the ` +
        `specs moved and the config should follow, or the specs are gone and ` +
        `the config should go with them — leaving it in place describes ` +
        `coverage that does not exist:\n  ${problems.join("\n  ")}`,
    ).toEqual([]);
  });
});
