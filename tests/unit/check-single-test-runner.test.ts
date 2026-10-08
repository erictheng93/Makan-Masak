import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const source = path.resolve("scripts/check-single-test-runner.cjs");
let root: string;

function link(pkg: string, instance: string, workspace?: string) {
  const dir = workspace
    ? path.join(root, "apps", workspace, "node_modules")
    : path.join(root, "node_modules");
  const target = path.join(
    root,
    "node_modules",
    ".pnpm",
    `${pkg}@${instance}`,
    "node_modules",
    pkg,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(target, { recursive: true });
  symlinkSync(target, path.join(dir, pkg), "junction");
}

function check() {
  return spawnSync(
    process.execPath,
    [path.join(root, "scripts", "check-single-test-runner.cjs")],
    {
      encoding: "utf8",
    },
  );
}

describe("single test runner guard", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "single-test-runner-"));
    mkdirSync(path.join(root, "scripts"));
    copyFileSync(
      source,
      path.join(root, "scripts", "check-single-test-runner.cjs"),
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("skips an uninstalled workspace", () => {
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SKIP: workspace is not installed");
  });

  it("accepts one instance shared by root and an app", () => {
    for (const pkg of ["vitest", "vite"]) {
      link(pkg, "1.0_peerA");
      link(pkg, "1.0_peerA", "customer-app");
    }

    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("vitest: 1 instance");
    expect(result.stdout).toContain("vite: 1 instance");
    expect(result.stdout).toContain("OK: one runner instance each");
  });

  it("rejects split instances in the workspace", () => {
    for (const pkg of ["vitest", "vite"]) {
      link(pkg, "1.0_peerA");
      link(pkg, "1.0_peerB", "customer-app");
    }

    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("vitest: 2 instances linked");
    expect(result.stderr).toContain("vite: 2 instances linked");
  });
});
