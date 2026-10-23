import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "testing/index": "src/testing/index.ts",
  },
  format: ["esm", "cjs"],
  // shortcut: tsup 8 injects `baseUrl` into its dts build, which TS 6 rejects; drop this once on tsup 9 (fixed there)
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  splitting: false,
  sourcemap: true,
  clean: true,
  tsconfig: "./tsconfig.build.json",
  // Include all source files for proper type generation
  outDir: "dist",
  // Ensure proper handling of TypeScript composite projects
  skipNodeModulesBundle: true,
  // Enable tree-shaking for better output
  treeshake: true,
});
