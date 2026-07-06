import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// eslint-plugin-react is omitted: its 7.x line is incompatible with
// ESLint 10 (it calls a removed context API). TypeScript already covers
// the JSX correctness rules it provided; react-hooks carries the rules
// that the type-checker cannot.
export default [
  {
    ignores: ["dist/**", "eslint.config.js", "vite.config.ts"],
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "vitest.setup.ts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
