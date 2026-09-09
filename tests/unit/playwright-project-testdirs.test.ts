import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import playwrightConfig from "../../playwright.config";

// Anchored on this file, not process.cwd(): a cwd-relative path only resolves
// when the runner happens to be invoked from the repo root.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function specFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
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
