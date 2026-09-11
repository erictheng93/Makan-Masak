import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
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
  server: {
    host: "localhost",
    port: 3011,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:8789",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production",
  },
});
