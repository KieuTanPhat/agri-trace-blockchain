import { readFileSync } from "node:fs";
import typescriptParser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";
import accessibilityPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import hooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

const policy = JSON.parse(
  readFileSync(new URL("./scripts/lint-policy.json", import.meta.url), "utf8"),
);

export default [
  {
    files: ["src/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      import: importPlugin,
      "jsx-a11y": accessibilityPlugin,
      react: reactPlugin,
      "react-hooks": hooksPlugin,
    },
    settings: { react: { version: "detect" } },
    // Keep the effective React/TypeScript/accessibility policy. The mandatory
    // Oxlint invocation implements the Next.js rules from the same snapshot.
    rules: Object.fromEntries(
      Object.entries(policy.rules).filter(
        ([name]) => !name.startsWith("@next/next/"),
      ),
    ),
  },
];
