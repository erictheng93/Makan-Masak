import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { sharedTestConfig } from "../../vitest.shared";

export default defineConfig({
  plugins: [vue()],
  test: {
    ...sharedTestConfig,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.{test,spec}.{js,ts}", "tests/**/*.{test,spec}.{js,ts}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.real.integration.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "tests/setup.ts", "dist/", "**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@makanmasak/shared-types": resolve(
        __dirname,
        "../../packages/shared-types/src",
      ),
      "@makanmasak/utils": resolve(__dirname, "../../packages/utils/src"),
      // @makanmasak/i18n publishes its exports from dist/, which nothing builds
      // before `vite dev` or a bare `vitest run`. Resolving it from source is
      // what keeps a fresh worktree working without a prior workspace build
      // (#361). The subpath entries come first on purpose: a string alias also
      // matches `<find>/...`, so a leading bare entry would swallow them.
      "@makanmasak/i18n/locale-manager": resolve(
        __dirname,
        "../../packages/shared/src/i18n/src/locale-manager.ts",
      ),
      "@makanmasak/i18n/static-messages": resolve(
        __dirname,
        "../../packages/shared/src/i18n/src/static-messages.ts",
      ),
      "@makanmasak/i18n/types": resolve(
        __dirname,
        "../../packages/shared/src/i18n/src/types.ts",
      ),
      "@makanmasak/i18n": resolve(
        __dirname,
        "../../packages/shared/src/i18n/src",
      ),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify("1.0.0"),
    __VUE_PROD_DEVTOOLS__: false,
  },
});
