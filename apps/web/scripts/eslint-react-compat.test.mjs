import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";
import reactCompat from "./eslint-react-compat.mjs";

const { fixtures } = JSON.parse(
  readFileSync(
    new URL("./react-deprecations.fixtures.json", import.meta.url),
    "utf8",
  ),
);

const nonReactCases = [
  {
    name: "plain block comments do not declare React components",
    source:
      "/* @extends React.Component */\nexport class Fine extends DomainBase { componentWillMount() {} }",
    expected: [],
  },
];

for (const fixture of [...fixtures, ...nonReactCases]) {
  test(`React deprecation compatibility: ${fixture.name}`, async () => {
    const eslint = new ESLint({
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      overrideConfigFile: true,
      overrideConfig: {
        files: ["**/*.jsx"],
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { react: reactCompat },
        settings: { react: { version: "19.3.0", ...fixture.settings } },
        rules: { "react/no-deprecated": "error" },
      },
    });
    const [result] = await eslint.lintText(fixture.source, {
      filePath: "fixture.jsx",
    });
    assert.equal(result.fatalErrorCount, 0);
    assert.deepEqual(
      result.messages.map(
        ({
          messageId,
          message,
          line,
          column,
          endLine,
          endColumn,
          severity,
        }) => ({
          messageId,
          message,
          line,
          column,
          endLine,
          endColumn,
          severity,
        }),
      ),
      fixture.expected,
    );
  });
}
