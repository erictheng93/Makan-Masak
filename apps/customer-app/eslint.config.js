import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default [
  // Ignore patterns
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "*.d.ts",
      "coverage/**",
      "test-results/**",
      "**/*.vue.js",
    ],
  },

  // Base JavaScript config
  js.configs.recommended,

  // TypeScript configs
  ...tseslint.configs.recommended,

  // Vue configs
  ...pluginVue.configs["flat/recommended"],

  // Prettier config (must be last to override other formatting rules)
  eslintConfigPrettier,

  // Main configuration for Vue/TypeScript files
  {
    files: ["**/*.{js,ts,vue}"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "no-console": process.env.NODE_ENV === "production" ? "warn" : "off",
      "no-debugger": process.env.NODE_ENV === "production" ? "warn" : "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "no-case-declarations": "off",
      "vue/multi-word-component-names": "off",
      "vue/no-unused-vars": "warn",
      // Relax Vue formatting rules to avoid conflicts with Prettier
      "vue/singleline-html-element-content-newline": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/max-attributes-per-line": "off",
      "vue/first-attribute-linebreak": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/html-closing-bracket-spacing": "off",
      "vue/html-indent": "off",
      "vue/html-self-closing": "off",
    },
  },

  // Test files configuration
  {
    files: ["**/__tests__/**/*", "**/*.test.*", "**/tests/**/*"],
    languageOptions: {
      globals: {
        vi: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
