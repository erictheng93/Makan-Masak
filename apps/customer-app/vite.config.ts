import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { visualizer } from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Bundle analyzer for production builds
    ...(process.env.ANALYZE === "true"
      ? [
          visualizer({
            filename: "./dist/stats.html",
            open: true,
            gzipSize: true,
            brotliSize: true,
          }) as PluginOption,
        ]
      : []),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        importScripts: ["/sw-push.js"],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.makanmasak\.com\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
            },
          },
          {
            urlPattern: /^https:\/\/images\.makanmasak\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
      },
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "masked-icon.svg"],
      manifest: {
        name: "MakanMasak - 點餐系統",
        short_name: "MakanMasak",
        description: "便捷的餐廳點餐系統，掃描 QR Code 即可開始點餐",
        theme_color: "#3b82f6",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
        categories: ["food", "business", "utilities"],
        shortcuts: [
          {
            name: "掃描 QR Code",
            short_name: "掃描",
            description: "掃描桌上的 QR Code 開始點餐",
            url: "/scan",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "手動輸入",
            short_name: "輸入",
            description: "手動輸入餐廳和桌號",
            url: "/manual",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@makanmasak/shared": fileURLToPath(
        new URL("../../packages/shared", import.meta.url),
      ),
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
  build: {
    target: "esnext",
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production", // SECURITY FIX: Disable sourcemaps in production
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Core vendor chunks
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

          // Utils - keep commonly used together
          if (id.includes("node_modules/axios/")) {
            return "axios";
          }
          if (id.includes("node_modules/dayjs/")) {
            return "dayjs";
          }

          // QR code libraries - lazy load these large libraries
          if (id.includes("node_modules/@zxing/library")) {
            return "zxing-qr";
          }
          if (id.includes("node_modules/qrcode-reader")) {
            return "qrcode-reader";
          }

          // PWA-specific chunks
          if (id.includes("node_modules/workbox-")) {
            return "workbox";
          }
          if (id.includes("node_modules/idb")) {
            return "idb";
          }

          // VueUse composables
          if (id.includes("node_modules/@vueuse/core")) {
            return "vueuse";
          }

          // TanStack Query
          if (id.includes("node_modules/@tanstack/vue-query")) {
            return "tanstack-query";
          }

          // Other node_modules
          if (id.includes("node_modules/")) {
            if (id.includes("node_modules/maplibre-gl/")) {
              return "maplibre";
            }
            if (id.includes("node_modules/pmtiles/")) {
              return "pmtiles";
            }
            if (id.includes("node_modules/lodash-es/")) {
              return "lodash";
            }
            if (id.includes("node_modules/vue-i18n/")) {
              return "vue-i18n";
            }
            if (id.includes("node_modules/@intlify/")) {
              return "intlify";
            }
            if (id.includes("node_modules/@vueuse/")) {
              return "vueuse";
            }
            if (id.includes("node_modules/zod/")) {
              return "zod";
            }
            return "vendor";
          }
        },
      },
    },
    // Terser becomes pathologically slow when the CSP-safe Vue I18n JIT
    // compiler is retained. esbuild preserves the existing production stripping
    // behavior without making the build impractical.
    minify: "esbuild",
    cssMinify: true,
    // MapLibre is isolated behind MarketLocationMap's async component. The
    // higher limit keeps the production build warning focused on unexpected
    // initial-bundle regressions instead of the known lazy map vendor chunk.
    chunkSizeWarningLimit: 1100,
    reportCompressedSize: true,
  },
  server: {
    host: "localhost", // SECURITY FIX: Restrict to localhost only in development
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        secure: false,
      },
      "/ws": {
        target: process.env.VITE_WS_BASE_URL || "ws://localhost:8787",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "localhost", // SECURITY FIX: Restrict preview to localhost
    port: 3000,
  },
  optimizeDeps: {
    include: [
      "vue",
      "vue-router",
      "pinia",
      "@vueuse/core",
      "axios",
      "dayjs",
      "@tanstack/vue-query",
    ],
    exclude: ["@zxing/library"],
  },
  css: {
    devSourcemap: process.env.NODE_ENV !== "production", // SECURITY FIX: Disable CSS sourcemaps in production
  },
  esbuild: {
    // console.error/console.warn survive production builds on purpose. Dropping
    // every console call is what let #60 present as a blank page with a clean
    // console for four days: router.onError's only diagnostic was minified away.
    drop: process.env.NODE_ENV === "production" ? ["debugger"] : [],
    pure:
      process.env.NODE_ENV === "production"
        ? ["console.log", "console.info", "console.debug"]
        : [],
    legalComments: "none",
  },
  // 環境變量配置
  envPrefix: "VITE_",
});
