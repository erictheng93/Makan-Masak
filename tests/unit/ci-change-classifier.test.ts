import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Scope = {
  app: boolean;
  backend: boolean;
  frontend: boolean;
  integration: boolean;
  tooling: boolean;
  guard_tests: boolean;
  full_lint: boolean;
  full: boolean;
};

// Handed to bash, not to Node, so the separators have to be POSIX ones: bash
// reads the backslashes in a resolved Windows path as escape characters and
// collapses D:\repo\scripts\x.sh into D:reposcriptsx.sh before it ever stats
// the file. Forward slashes are accepted on both platforms, so this is a no-op
// off Windows.
const classifier = path
  .resolve(process.cwd(), "scripts/classify-ci-changes.sh")
  .replace(/\\/g, "/");

// Derive the root from the classifier rather than reading process.cwd() twice.
const repoRoot = path.dirname(path.dirname(classifier));

function guardSuites(): Array<{ script: string; suite: string }> {
  return readFileSync(path.join(repoRoot, "scripts/guard-suites.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [script, suite] = line.split(/\s+/);
      return { script, suite };
    });
}

// On Windows, a bare `bash` usually resolves to C:\Windows\system32\bash.exe --
// that is WSL, which mounts this drive under /mnt and so cannot see the repo
// path at all. Git ships a bash that shares the Win32 namespace, and it lives
// next door to the git.exe we were launched with.
function resolveBash(): string | null {
  if (process.platform !== "win32") return "bash";

  const located = spawnSync("where", ["git"], { encoding: "utf8" });
  const gitExes = (located.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // `where git` answers with whichever copy PATH puts first, and the layouts
  // sit at different depths: Git\cmd\git.exe is one level above bin\bash.exe,
  // Git\mingw64\bin\git.exe is two. Taking only the first answer and only the
  // first shape is how this suite silently skipped all 23 of its cases on a
  // machine whose PATH happened to lead with mingw64.
  const candidates = gitExes.flatMap((gitExe) => [
    path.resolve(path.dirname(gitExe), "..", "bin", "bash.exe"),
    path.resolve(path.dirname(gitExe), "..", "..", "bin", "bash.exe"),
    path.resolve(path.dirname(gitExe), "..", "..", "usr", "bin", "bash.exe"),
  ]);

  // Confirm rather than assume: a bash that cannot stat the script is useless.
  for (const candidate of candidates) {
    const gitBash = candidate.replace(/\\/g, "/");
    const probe = spawnSync(gitBash, ["-c", `test -f '${classifier}'`], {
      encoding: "utf8",
    });

    if (probe.status === 0) return gitBash;
  }

  return null;
}

const bashCommand = resolveBash();

function classify(files: string[], initialFull = false): Scope {
  const result = spawnSync(
    bashCommand as string,
    [classifier, String(initialFull)],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: `${files.join("\n")}\n`,
    },
  );

  expect(result.status, result.stderr).toBe(0);

  return Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [key, value] = line.split("=");
        return [key, value === "true"];
      }),
  ) as Scope;
}

const none: Scope = {
  app: false,
  backend: false,
  frontend: false,
  integration: false,
  tooling: false,
  guard_tests: false,
  full_lint: false,
  full: false,
};

const fullValidation: Scope = {
  app: true,
  backend: true,
  frontend: true,
  integration: true,
  tooling: true,
  guard_tests: false,
  full_lint: false,
  full: true,
};

// Skipped rather than failed where no bash can reach the script: the classifier
// is a CI concern and CI runs on Linux, so a red suite here would only ever be
// reporting on the developer's shell, not on the script under test.
describe.skipIf(bashCommand === null)("CI change classifier", () => {
  it("skips checks for unrelated documentation", () => {
    expect(classify(["docs/operations.md"])).toEqual(none);
  });

  it.each(["README.md", "docs/api/README.md", "docs/architecture/README.md"])(
    "runs the docs drift job for %s",
    (file) => {
      expect(classify([file])).toEqual({ ...none, tooling: true });
    },
  );

  it("uses full validation when a GitHub Actions workflow changes", () => {
    expect(classify([".github/workflows/test.yml"])).toEqual(fullValidation);
  });

  it("runs full lint when the root ESLint configuration changes", () => {
    expect(classify(["eslint.config.js"])).toEqual({
      ...none,
      tooling: true,
      full_lint: true,
    });
  });

  it.each([".prettierrc.json", ".prettierignore"])(
    "runs tooling checks for Prettier configuration %s",
    (file) => {
      expect(classify([file])).toEqual({
        ...none,
        tooling: true,
      });
    },
  );

  it.each([".npmrc", "codecov.yml"])(
    "uses full validation when root CI behavior changes in %s",
    (file) => {
      expect(classify([file])).toEqual(fullValidation);
    },
  );

  it("runs targeted guard tests when a tested guard script changes", () => {
    // One entry proves the wiring for all of them: the classifier reads
    // guard-suites.txt rather than a list of its own, so routing is structural.
    // What is left to check per entry is that the row names real files, and
    // that needs no classifier run -- a bash spawn costs ~5s on Windows.
    const [first] = guardSuites();

    expect(classify([first.script])).toEqual({
      ...none,
      tooling: true,
      guard_tests: true,
    });
  });

  it("runs the runner guard suite when its script changes", () => {
    expect(classify(["scripts/check-single-test-runner.cjs"])).toEqual({
      ...none,
      tooling: true,
      guard_tests: true,
    });
  });

  it("pairs every guard script in the manifest with a suite that exists", () => {
    for (const { script, suite } of guardSuites()) {
      expect(existsSync(path.join(repoRoot, script)), `${script} exists`).toBe(
        true,
      );
      expect(existsSync(path.join(repoRoot, suite)), `${suite} exists`).toBe(
        true,
      );
    }
  });

  it("runs tooling checks without guard tests for other scripts", () => {
    expect(classify(["scripts/setup-secrets.ts"])).toEqual({
      ...none,
      tooling: true,
    });
  });

  it("runs the owning real integration suite for frontend apps that have one", () => {
    expect(classify(["apps/customer-app/src/App.vue"])).toEqual({
      ...none,
      app: true,
      frontend: true,
      integration: true,
    });
  });

  it("does not run integration tests for a worker that owns no real suite", () => {
    expect(classify(["apps/backup-scheduler/src/index.ts"])).toEqual({
      ...none,
      app: true,
      backend: true,
    });
  });

  // The orphan sweep's only real-D1 test runs in the real-integration job and
  // nowhere else, so a change to the sweep has to reach that job.
  it("runs the real integration suite for an image-processor change", () => {
    expect(classify(["apps/image-processor/src/index.ts"])).toEqual({
      ...none,
      app: true,
      backend: true,
      integration: true,
    });
  });

  it("uses the widest scope for an unknown future package", () => {
    expect(classify(["packages/payments/src/index.ts"])).toEqual({
      app: true,
      backend: true,
      frontend: true,
      integration: true,
      tooling: false,
      guard_tests: false,
      full_lint: false,
      full: false,
    });
  });

  it("treats an unavailable comparison base as a full validation", () => {
    expect(classify(["docs/operations.md"], true)).toEqual(fullValidation);
  });
});
