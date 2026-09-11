import { defineConfig } from "vitest/config";
import { resolve } from "path";
import vue from "@vitejs/plugin-vue";
import { sharedTestConfig } from "../../vitest.shared";

export default defineConfig({
  plugins: [vue()],
  test: {
    ...sharedTestConfig,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/__tests__/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/dist/",
        "**/coverage/",
      ],
    },
    testTimeout: 10000,
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
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
    "import.meta.env.MODE": '"test"',
    "import.meta.env.VITE_MANAGEMENT_API_URL": '"http://localhost:8790"',
    __APP_VERSION__: '"1.0.0"',
    __VUE_PROD_DEVTOOLS__: false,
  },
  esbuild: {
    target: "node14",
  },
});
