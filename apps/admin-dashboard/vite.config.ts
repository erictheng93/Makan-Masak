import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    vue(),
    // Bundle analyzer for production builds
    process.env.ANALYZE === "true" &&
      visualizer({
        filename: "./dist/stats.html",
        open: true,
        gzipSize: true,
        brotliSize: true,
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@makanmasak/shared-types": resolve(
        __dirname,
        "../../packages/shared-types/src",
      ),
      "@makanmasak/shared": resolve(__dirname, "../../packages/shared"),
      "@makanmasak/database": resolve(__dirname, "../../packages/database/src"),
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
    // The shared workspace package is resolved from source here, so when
    // Rollup walks up from files like stores/moduleAccess.ts looking for
    // singletons (pinia, vue, vue-router), pnpm's strict layout means the walk
    // fails. dedupe forces resolution from this app's node_modules instead.
    dedupe: ["pinia", "vue", "vue-router"],
  },
  define: {
    __APP_VERSION__: JSON.stringify(
      process.env.APP_VERSION || `dev-${new Date().toISOString().slice(0, 10)}`,
    ),
    __VUE_PROD_DEVTOOLS__: false,
    // Vue I18n v9 otherwise compiles string messages with new Function, which
    // is blocked by the production CSP because unsafe-eval is intentionally off.
    __INTLIFY_JIT_COMPILATION__: true,
    __INTLIFY_DROP_MESSAGE_COMPILER__: false,
  },
  server: {
    host: "localhost", // SECURITY FIX: Restrict to localhost only in development
    port: 3001,
    proxy: {
      "/management-api": {
        target:
          process.env.VITE_MANAGEMENT_API_URL?.replace("/api/v1", "") ||
          "http://localhost:8789",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/management-api/, "/api"),
      },
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
    minify: "terser",
    terserOptions: {
      compress: {
        // console.error/console.warn survive production builds on purpose:
        // dropping every console call is what made #60 invisible in the field.
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
    cssMinify: true,
    chunkSizeWarningLimit: 500,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vue core ecosystem
          if (
            id.includes("node_modules/vue/") ||
            id.includes("node_modules/@vue/")
          ) {
            return "vue-core";
          }
          if (id.includes("node_modules/vue-router/")) {
            return "vue-router";
          }
          if (id.includes("node_modules/pinia/")) {
            return "pinia";
          }

          // UI libraries - split into separate chunks
          if (id.includes("node_modules/@headlessui/vue")) {
            return "headlessui";
          }
          if (id.includes("node_modules/@heroicons/vue")) {
            return "heroicons";
          }
          if (id.includes("node_modules/lucide-vue-next")) {
            return "lucide";
          }
          if (id.includes("node_modules/vue-toastification")) {
            return "toastification";
          }

          // Heavy charting libraries - lazy load
          if (id.includes("node_modules/chart.js")) {
            return "chartjs";
          }
          if (id.includes("node_modules/vue-chartjs")) {
            return "vue-chartjs";
          }

          // i18n
          if (id.includes("node_modules/vue-i18n")) {
            return "i18n";
          }
          if (id.includes("node_modules/@intlify")) {
            return "intlify";
          }

          // Utils
          if (id.includes("node_modules/axios")) {
            return "axios";
          }
          if (id.includes("node_modules/zod")) {
            return "zod";
          }
          if (id.includes("node_modules/lodash-es")) {
            return "lodash";
          }
          if (id.includes("node_modules/date-fns")) {
            return "date-fns";
          }
          if (id.includes("node_modules/@vueuse/core")) {
            return "vueuse";
          }
          if (id.includes("node_modules/xlsx")) {
            return "xlsx";
          }
          if (id.includes("node_modules/jspdf")) {
            return "jspdf";
          }
          if (id.includes("node_modules/@stripe/stripe-js")) {
            return "stripe";
          }
          if (id.includes("node_modules/qrcode")) {
            return "qrcode";
          }
          if (id.includes("node_modules/papaparse")) {
            return "papaparse";
          }

          // Other node_modules
          if (id.includes("node_modules/")) {
            return "vendor";
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      "vue",
      "vue-router",
      "pinia",
      "@vueuse/core",
      "axios",
      "date-fns",
      "lodash-es",
    ],
    exclude: ["chart.js", "vue-chartjs"],
  },
  css: {
    devSourcemap: process.env.NODE_ENV !== "production",
  },
});
