import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// Anchored on this file, not process.cwd(): a cwd-relative path only resolves
// when the runner happens to be invoked from the repo root.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Guards #361, and the class of failure it belongs to.
 *
 * Several workspace packages publish their entry points from `dist/`, which
 * only exists after `pnpm build`. Turbo hides that: every `test`, `typecheck`
 * and `dev` task declares `dependsOn: ["^build"]`, so under `pnpm verify` the
 * dependency is always built first. Nothing else builds it — a bare
 * `pnpm exec vitest run` in a fresh worktree, a `pnpm exec vite` dev server, or
 * an editor opening the repo for the first time all resolve the published entry
 * and get `Failed to resolve entry for package "@makanmasak/…"`.
 *
 * That is what #360 hit and what #357's admin E2E job worked around by
 * pre-building the whole admin closure. The fix in both cases is a resolve
 * alias pointing the specifier at the package's source, and the failure mode of
 * *that* fix is silence: drop an alias and the app still builds under turbo,
 * because `^build` put a `dist/` there. So the check has to be static.
 *
 * Only packages whose entry actually points into `dist/` are required to have
 * one — `@makanmasak/utils` and `@makanmasak/auth-client` already export their
 * `src/`, and aliasing those would be noise.
 */

type AliasMap = Record<string, string>;

type Scope = "unit" | "real-integration";

interface AppConfig {
  app: string;
  scope: Scope;
  configFile: string;
  alias: AliasMap;
}

/**
 * `*.real.integration.test.ts` boots miniflare and runs under its own config
 * (see each app's `vitest.config.ts`, which excludes it); that config aliases
 * `@makanmasak/database` to source where the unit one has no reason to. Pairing
 * each file with the config that actually runs it is what keeps this check from
 * demanding an alias in the wrong file.
 */
const REAL_INTEGRATION = /\.real\.integration\.test\.ts$/;

const CONFIGS: { configName: string; scope: Scope }[] = [
  { configName: "vite.config.ts", scope: "unit" },
  { configName: "vitest.config.ts", scope: "unit" },
  {
    configName: "vitest.real-integration.config.ts",
    scope: "real-integration",
  },
];

/** Vite's own rule (`matches` in its alias plugin): exact, or a path prefix. */
function aliasMatches(find: string, specifier: string): boolean {
  return specifier === find || specifier.startsWith(`${find}/`);
}

function normalizeAlias(alias: unknown): AliasMap {
  if (!alias) return {};
  // The array form is equally valid; it just is not what any app here uses.
  if (Array.isArray(alias)) {
    return Object.fromEntries(
      alias
        .filter((entry) => typeof entry?.find === "string")
        .map((entry) => [entry.find as string, String(entry.replacement)]),
    );
  }
  return Object.fromEntries(
    Object.entries(alias as Record<string, unknown>).map(([find, target]) => [
      find,
      String(target),
    ]),
  );
}

/**
 * Which file serves `specifier`, according to the package's own manifest, and
 * does that file live under `dist/`? `exports` wins over `main` when present,
 * matching Node and Vite.
 */
function entryIsBuilt(pkgDir: string, specifier: string): boolean {
  const manifest = JSON.parse(
    readFileSync(join(pkgDir, "package.json"), "utf8"),
  ) as {
    name: string;
    main?: string;
    module?: string;
    exports?: Record<string, unknown>;
  };

  const subpath = specifier.slice(manifest.name.length);
  const key = subpath === "" ? "." : `.${subpath}`;

  const targets: string[] = [];
  const exportsField = manifest.exports;
  if (exportsField) {
    const matched =
      exportsField[key] ??
      // `./locales/*`-style patterns: the only wildcard form in this repo.
      Object.entries(exportsField).find(
        ([pattern]) =>
          pattern.endsWith("/*") && key.startsWith(pattern.slice(0, -1)),
      )?.[1];
    if (matched === undefined) return false; // not exported at all; not our call
    if (typeof matched === "string") targets.push(matched);
    else targets.push(...Object.values(matched as Record<string, string>));
  } else {
    targets.push(manifest.main ?? "", manifest.module ?? "");
  }

  return targets.some((target) => /(^|\/)dist\//.test(target));
}

/**
 * Runtime `@makanmasak/*` specifiers under `dir`, restricted to the files
 * `keep` accepts.
 *
 * `import type` is excluded deliberately: the type-only form is erased before
 * resolution ever happens, which is why `@makanmasak/ai-analytics` has never
 * needed an alias in admin-dashboard despite being a `dist/` package.
 *
 * Imports are counted per file rather than followed transitively. That is
 * deliberately conservative for the unit scope — every file under `src/` counts,
 * whether or not a test reaches it — and it is what catches the #361 shape,
 * where the import sits in `src/i18n/index.ts` and the tests only reach it
 * through two more hops.
 */
function runtimeWorkspaceImports(
  dir: string,
  keep: (file: string) => boolean,
): Set<string> {
  const found = new Set<string>();
  const SOURCE = /\.(ts|tsx|vue|js|mjs)$/;
  const SKIP = new Set(["node_modules", "dist", "coverage", ".git"]);

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (SKIP.has(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!SOURCE.test(entry) || !keep(entry)) continue;

      const content = readFileSync(full, "utf8");

      // `import … from "x"` / `export … from "x"`, minus the type-only form.
      for (const match of content.matchAll(
        /\b(import|export)\s+(?:type\s+)?[^;]*?from\s*["'](@makanmasak\/[^"']+)["']/g,
      )) {
        if (/^\s*(?:import|export)\s+type\b/.test(match[0])) continue;
        found.add(match[2]);
      }
      // Side-effect and dynamic imports are always runtime.
      for (const match of content.matchAll(
        /import\s*\(?\s*["'](@makanmasak\/[^"']+)["']/g,
      )) {
        found.add(match[1]);
      }
    }
  };

  walk(dir);
  return found;
}

const appsDir = join(repoRoot, "apps");
const viteApps = readdirSync(appsDir).filter((app) => {
  const appDir = join(appsDir, app);
  return (
    statSync(appDir).isDirectory() &&
    readdirSync(appDir).includes("vite.config.ts")
  );
});

const packageDirs = new Map<string, string>();
for (const pkg of readdirSync(join(repoRoot, "packages"))) {
  const pkgDir = join(repoRoot, "packages", pkg);
  if (!statSync(pkgDir).isDirectory()) continue;
  const manifestPath = join(pkgDir, "package.json");
  try {
    const { name } = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name: string;
    };
    packageDirs.set(name, pkgDir);
  } catch {
    // not a package
  }
}
// @makanmasak/i18n is nested inside packages/shared rather than sitting at the
// top level, so the sweep above does not reach it.
packageDirs.set(
  "@makanmasak/i18n",
  join(repoRoot, "packages", "shared", "src", "i18n"),
);

describe("workspace packages imported from source are aliased", () => {
  const configs: AppConfig[] = [];

  it("finds the Vite apps", () => {
    expect(viteApps.length).toBeGreaterThan(0);
  });

  // Cold-importing five vite configs (vue plugin, PWA plugin, visualizer)
  // inside a timed test body would charge the whole transform to whichever
  // case ran first — see the testing standards in CLAUDE.md.
  beforeAll(async () => {
    for (const app of viteApps) {
      for (const { configName, scope } of CONFIGS) {
        const configPath = join(appsDir, app, configName);
        let loaded: { default?: { resolve?: { alias?: unknown } } };
        try {
          loaded = await import(/* @vite-ignore */ configPath);
        } catch {
          continue; // no such config; vite.config.ts is guaranteed by the filter
        }
        configs.push({
          app,
          scope,
          configFile: `apps/${app}/${configName}`,
          alias: normalizeAlias(loaded.default?.resolve?.alias),
        });
      }
    }
  }, 60_000);

  it("every dist-published specifier an app imports at runtime has a source alias", () => {
    const problems: string[] = [];

    for (const app of viteApps) {
      for (const scope of ["unit", "real-integration"] as Scope[]) {
        const specifiers = [
          ...runtimeWorkspaceImports(join(appsDir, app, "src"), (file) =>
            scope === "real-integration"
              ? REAL_INTEGRATION.test(file)
              : !REAL_INTEGRATION.test(file),
          ),
        ]
          .filter((specifier) => {
            const pkgDir = [...packageDirs].find(
              ([name]) =>
                specifier === name || specifier.startsWith(`${name}/`),
            )?.[1];
            return pkgDir !== undefined && entryIsBuilt(pkgDir, specifier);
          })
          .sort();

        for (const config of configs.filter(
          (entry) => entry.app === app && entry.scope === scope,
        )) {
          for (const specifier of specifiers) {
            const find = Object.keys(config.alias).find((key) =>
              aliasMatches(key, specifier),
            );
            if (find === undefined) {
              problems.push(
                `${config.configFile} has no alias for "${specifier}"`,
              );
              continue;
            }
            if (!config.alias[find].includes("/src")) {
              problems.push(
                `${config.configFile} aliases "${find}" to ` +
                  `"${config.alias[find]}", which is not a source directory`,
              );
            }
          }
        }
      }
    }

    expect(
      problems,
      `an app imports a workspace package whose published entry is dist/, ` +
        `without a resolve alias pointing at that package's source. It will ` +
        `work under turbo (every task dependsOn ^build) and fail in a fresh ` +
        `worktree with "Failed to resolve entry for package" — see #361:\n  ` +
        problems.join("\n  "),
    ).toEqual([]);
  });

  it("covers @makanmasak/i18n, the specifier #361 was filed for", () => {
    // A regression that removed every alias would otherwise leave the sweep
    // above with nothing to check and still report green.
    const unitConfigs = configs.filter((config) => config.scope === "unit");
    const withI18n = unitConfigs.filter((config) =>
      Object.keys(config.alias).some((key) => key === "@makanmasak/i18n"),
    );

    expect(unitConfigs.length).toBeGreaterThanOrEqual(viteApps.length);
    expect(withI18n.map((config) => config.configFile).sort()).toEqual(
      unitConfigs.map((config) => config.configFile).sort(),
    );
  });
});
