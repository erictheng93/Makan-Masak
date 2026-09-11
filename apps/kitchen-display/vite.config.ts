import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@makanmasak/shared": resolve(__dirname, "../../packages/shared"),
      "@makanmasak/shared-types": resolve(
        __dirname,
        "../../packages/shared-types/src",
      ),
      "@makanmasak/utils/chunk-recovery": resolve(
        __dirname,
        "../../packages/utils/src/chunk-recovery",
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
    __APP_VERSION__: JSON.stringify(
      process.env.APP_VERSION || `dev-${new Date().toISOString().slice(0, 10)}`,
    ),
    __VUE_PROD_DEVTOOLS__: false,
  },
  server: {
    host: "localhost", // SECURITY FIX: Restrict to localhost only in development
    port: 3002, // 不同於 admin-dashboard 的 3001
    proxy: {
      "/api": {
        target:
          process.env.VITE_API_BASE_URL?.replace("/api/v1", "") ||
          "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production", // SECURITY FIX: Disable sourcemaps in production
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // NOTE: Custom manualChunks was removed because its substring matching
        // (`id.includes("vue")`) was too loose — it pulled @vueuse, vue-router,
        // and vue-toastification's transitive deps into the "vue-core" chunk,
        // creating a `vue-core -> notifications -> vue-core` circular chunk
        // that blew up at runtime with "Cannot access 'k' before initialization".
        // Rollup's default chunk splitting handles this correctly.
        chunkFileNames: () => {
          return `assets/[name]-[hash].js`;
        },
        assetFileNames: (assetInfo) => {
          if (/\.(mp3|wav|ogg|m4a)$/i.test(assetInfo.name!)) {
            return `assets/audio/[name]-[hash][extname]`;
          }
          if (/\.(png|jpe?g|gif|svg)$/i.test(assetInfo.name!)) {
            return `assets/images/[name]-[hash][extname]`;
          }
          if (/\.css$/i.test(assetInfo.name!)) {
            return `assets/css/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
      },
      treeshake: {
        preset: "recommended",
      },
    },
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ["console.log", "console.info", "console.debug"],
        passes: 2,
      },
      mangle: {
        safari10: true,
      },
      format: {
        comments: false,
      },
    },
  },
});
