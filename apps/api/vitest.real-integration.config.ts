import { defineConfig } from "vitest/config";
import { resolve } from "path";

process.env.MAKANMAKAN_REAL_D1_REUSE_DB ??= "1";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    root: resolve(__dirname),
    include: ["src/**/*.real.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // The database test helper builds one migrated D1 baseline per migration
    // hash, then copies it into an isolated Miniflare workdir for each file.
    // Keeping files serial avoids concurrent Miniflare boot flakiness while
    // avoiding per-file migrations.
    //
    // 5 minutes has been stabilized as a safe upper bound for hook + test wall
    // time across real integration suites, so this is set globally instead of
    // file-by-file overrides.
    testTimeout: 300000,
    // The hook budget must stay ABOVE the helper's own baseline budget
    // (REAL_D1_SETUP_TIMEOUT_MS, 660s). When vitest is the tighter of the two
    // it kills the hook first: you lose the helper's specific diagnostic, and
    // — worse — a cold baseline build is aborted before it writes `.ready`, so
    // the next run starts cold again. Only the very first file after a
    // migration change ever approaches this; every later file copies the
    // cached baseline in about a second.
    hookTimeout: 720000,
    teardownTimeout: 15000,
    reporters: ["verbose"],
    passWithNoTests: true,
    // Miniflare's workerd IPC fails with `fetch failed` at migration 0006
    // when multiple instances boot in parallel (observed at 4 files × 1
    // vitest worker each). Serialise files to keep each smoke's miniflare
    // boot isolated. Tests inside the same file still share one miniflare.
    fileParallelism: false,
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@makanmasak/queue-core/print": resolve(
        __dirname,
        "../../packages/queue-core/src/print",
      ),
      "@makanmasak/shared-types": resolve(
        __dirname,
        "../../packages/shared-types/src",
      ),
      "@makanmasak/database": resolve(__dirname, "../../packages/database/src"),
      "@makanmasak/database/testing": resolve(
        __dirname,
        "../../packages/database/src/testing",
      ),
    },
  },
  define: {
    "process.env.NODE_ENV": '"test"',
  },
});
