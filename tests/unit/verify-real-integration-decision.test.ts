import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Exercises the real real_integration_needed() from scripts/verify.sh, run the
// way verify.sh runs it (`set -euo pipefail`), against a throwaway repo whose
// origin/main is a fixture commit. It used to pipe the classifier straight
// into `grep -q`: grep exited at integration=true, the classifier took SIGPIPE
// on its next line, and pipefail turned that into "skip" -- so the suites were
// skipped on every change that needed them (24ad6c15e went red in CI that way).

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function extractDecisionFunction(): string {
  const source = readFileSync(path.join(repoRoot, "scripts/verify.sh"), "utf8");
  const match = source.match(/^real_integration_needed\(\) \{\n[\s\S]*?^\}$/m);
  if (!match) {
    throw new Error("real_integration_needed() not found in scripts/verify.sh");
  }
  return match[0];
}

let workdir: string | undefined;

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = undefined;
});

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

function writeFile(root: string, file: string, content = "x\n") {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

/** Repo at origin/main, plus `committed` on HEAD and `untracked` in the tree. */
function fixtureRepo(changes: { committed?: string[]; untracked?: string[] }) {
  const root = mkdtempSync(path.join(tmpdir(), "verify-ri-"));
  workdir = root;
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  git(root, "config", "commit.gpgsign", "false");
  for (const file of [
    "scripts/classify-ci-changes.sh",
    "scripts/guard-suites.txt",
  ]) {
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    copyFileSync(path.join(repoRoot, file), path.join(root, file));
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");

  if (changes.committed?.length) {
    for (const file of changes.committed) writeFile(root, file);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "change");
  }
  for (const file of changes.untracked ?? []) writeFile(root, file);
  return root;
}

function decide(root: string, env: Record<string, string> = {}): string {
  const script = [
    "set -euo pipefail",
    extractDecisionFunction(),
    "if real_integration_needed; then echo run; else echo skip; fi",
  ].join("\n");
  const result = spawnSync("bash", ["-c", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, VERIFY_REAL_INTEGRATION: "", ...env },
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

// shortcut: skipped on Windows, where bare `bash` is usually WSL and cannot see
// the temp repo; port ci-change-classifier.test.ts's resolveBash() if Windows
// developers need this suite locally. CI runs it on Linux.
describe.skipIf(process.platform === "win32")(
  "verify.sh real-integration decision",
  () => {
    it("runs for a committed apps/api change (the SIGPIPE regression)", () => {
      const root = fixtureRepo({
        committed: ["apps/api/src/feature.ts"],
      });
      // Deterministic in the old code, but repeat so a timing-dependent
      // variant of the same race cannot slip through on one lucky run.
      for (let i = 0; i < 5; i++) expect(decide(root)).toBe("run");
    });

    it("runs for an untracked apps/admin-dashboard file", () => {
      const root = fixtureRepo({
        untracked: ["apps/admin-dashboard/src/new.vue"],
      });
      expect(decide(root)).toBe("run");
    });

    it("skips when only docs and unguarded scripts changed", () => {
      const root = fixtureRepo({
        committed: ["docs/notes.md", "scripts/some-helper.sh"],
      });
      expect(decide(root)).toBe("skip");
    });

    it("runs when VERIFY_REAL_INTEGRATION=1 forces it", () => {
      const root = fixtureRepo({ committed: ["docs/notes.md"] });
      expect(decide(root, { VERIFY_REAL_INTEGRATION: "1" })).toBe("run");
    });
  },
);
