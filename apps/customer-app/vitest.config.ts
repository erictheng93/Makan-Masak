import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { sharedTestConfig } from "../../vitest.shared";

export default defineConfig({
  plugins: [vue()],
  test: {
    ...sharedTestConfig,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Phase 2 real-integration tests boot miniflare; they run under
      // the dedicated `vitest.real-integration.config.ts`, not the
      // default unit-test run. Mirrors kitchen-display's vitest.config.
      "**/*.real.integration.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@makanmasak/shared-types": fileURLToPath(
        new URL("../../packages/shared-types/src", import.meta.url),
      ),
      // @makanmasak/i18n publishes its exports from dist/, which nothing builds
      // before `vite dev` or a bare `vitest run`. Resolving it from source is
      // what keeps a fresh worktree working without a prior workspace build
      // (#361). The subpath entries come first on purpose: a string alias also
      // matches `<find>/...`, so a leading bare entry would swallow them.
      "@makanmasak/i18n/locale-manager": fileURLToPath(
        new URL(
          "../../packages/shared/src/i18n/src/locale-manager.ts",
          import.meta.url,
        ),
      ),
      "@makanmasak/i18n/static-messages": fileURLToPath(
        new URL(
          "../../packages/shared/src/i18n/src/static-messages.ts",
          import.meta.url,
        ),
      ),
      "@makanmasak/i18n/types": fileURLToPath(
        new URL("../../packages/shared/src/i18n/src/types.ts", import.meta.url),
      ),
      "@makanmasak/i18n": fileURLToPath(
        new URL("../../packages/shared/src/i18n/src", import.meta.url),
      ),
    },
  },
});
