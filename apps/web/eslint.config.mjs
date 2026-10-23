import { readFileSync } from "node:fs";
import typescriptParser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import hooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import reactCompat from "./scripts/eslint-react-compat.mjs";

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
      "react-hooks": hooksPlugin,
      react: reactCompat,
    },
    settings: { react: { version: "detect" } },
    // Next/typescript also applied these rules to JS. Preserve that baseline;
    // the four TypeScript-only core rules are enabled by the override below.
    // The mandatory Oxlint invocation implements Next, React, accessibility
    // and import rules. The TypeScript parser tracks JSX-only references.
    rules: Object.fromEntries(
      Object.entries(policy.rules).filter(
        ([name]) =>
          (name === "react/no-deprecated" ||
            !["@next/next/", "react/", "jsx-a11y/", "import/"].some((prefix) =>
              name.startsWith(prefix),
            )) &&
          !policy.typescriptOnlyRules.includes(name),
      ),
    ),
  },
  {
    files: ["src/**/*.{ts,tsx,mts,cts}"],
    rules: Object.fromEntries(
      policy.typescriptOnlyRules.map((name) => [name, policy.rules[name]]),
    ),
  },
];
