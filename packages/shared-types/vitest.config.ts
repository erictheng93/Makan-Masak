import { defineConfig } from "vitest/config";
import path from "path";
import { sharedTestConfig } from "../../vitest.shared";

export default defineConfig({
  test: {
    ...sharedTestConfig,
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules/", "dist/"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
