import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { decideRollback } = require("../../scripts/api-rollback.cjs") as {
  decideRollback: (input: {
    floor: { commit: string; versions?: string[] };
    versionId: string;
    tag: string | undefined;
    isAncestor: (floor: string, commit: string) => boolean;
  }) => { allowed: boolean; reason: string };
};

const floor = {
  commit: "b85b1855572125b671dde0b490d9b19841179641",
  versions: ["8905d372-9f39-4e56-9af6-8aa3e31e61b2"],
};

describe("API rollback floor", () => {
  it("allows a version listed in the floor file without looking at git", () => {
    const isAncestor = vi.fn();
    expect(
      decideRollback({
        floor,
        versionId: "8905d372-9f39-4e56-9af6-8aa3e31e61b2",
        tag: undefined,
        isAncestor,
      }).allowed,
    ).toBe(true);
    expect(isAncestor).not.toHaveBeenCalled();
  });

  // Every version deployed before the tagging script is untagged, and every one
  // of those predates per-shop usernames: the case the guard exists for.
  it("refuses an untagged version", () => {
    const result = decideRollback({
      floor,
      versionId: "328cb61c-b7aa-41af-a2ea-7002d93bef3b",
      tag: undefined,
      isAncestor: () => true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no commit tag");
  });

  it("refuses a commit older than the floor", () => {
    const isAncestor = vi.fn(() => false);
    const result = decideRollback({
      floor,
      versionId: "v-old",
      tag: "83114cbcf123",
      isAncestor,
    });
    expect(result.allowed).toBe(false);
    expect(isAncestor).toHaveBeenCalledWith(floor.commit, "83114cbcf123");
  });

  it("refuses a dirty deploy", () => {
    expect(
      decideRollback({
        floor,
        versionId: "v-dirty",
        tag: "4d5ee2215abc-dirty",
        isAncestor: () => true,
      }).allowed,
    ).toBe(false);
  });

  it("allows a clean commit at or after the floor", () => {
    expect(
      decideRollback({
        floor,
        versionId: "v-new",
        tag: "4d5ee2215abc",
        isAncestor: () => true,
      }).allowed,
    ).toBe(true);
  });

  it("keeps the shipped floor file well-formed", () => {
    const file = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../../apps/api/rollback-floor.json", import.meta.url),
        ),
        "utf8",
      ),
    );
    expect(file.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Array.isArray(file.versions)).toBe(true);
    expect(typeof file.reason).toBe("string");
  });
});

describe("Pages rollback floors", () => {
  for (const app of ["admin-dashboard", "kitchen-display"]) {
    it(`keeps the ${app} floor file well-formed`, () => {
      const file = JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(`../../apps/${app}/rollback-floor.json`, import.meta.url),
          ),
          "utf8",
        ),
      );
      expect(file.project).toMatch(/^makanmasak-/);
      expect(file.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(Array.isArray(file.deployments)).toBe(true);
      expect(typeof file.reason).toBe("string");
    });
  }

  // Pages reports a 7-char source commit; the shared decision must accept it.
  it("judges a Pages source commit with the same rule as the API", () => {
    expect(
      decideRollback({
        floor: { commit: floor.commit, versions: [] },
        versionId: "4512ec32",
        tag: "83114cb",
        isAncestor: () => false,
      }).allowed,
    ).toBe(false);
    expect(
      decideRollback({
        floor: { commit: floor.commit, versions: [] },
        versionId: "c9e3d24c",
        tag: "4d5ee22",
        isAncestor: () => true,
      }).allowed,
    ).toBe(true);
  });
});

describe("API deploy refuses a dirty build", () => {
  const { dirtyBuildInputs, BUILD_INPUTS } =
    require("../../scripts/api-deploy.cjs") as {
      dirtyBuildInputs: (porcelain: string) => string[];
      BUILD_INPUTS: string[];
    };

  // Another tool editing the main checkout must not have its uncommitted work
  // shipped by our deploy.
  it("reports modified, untracked and renamed build inputs", () => {
    expect(
      dirtyBuildInputs(
        [
          " M apps/api/src/index.ts",
          "?? packages/database/src/services/new.ts",
          "R  apps/api/a.ts -> apps/api/b.ts",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "apps/api/src/index.ts",
      "packages/database/src/services/new.ts",
      "apps/api/b.ts",
    ]);
  });

  it("treats a clean status as deployable", () => {
    expect(dirtyBuildInputs("")).toEqual([]);
  });

  it("covers everything the API bundle is built from", () => {
    expect(BUILD_INPUTS).toEqual(
      expect.arrayContaining(["apps/api", "packages", "pnpm-lock.yaml"]),
    );
  });
});
