import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const readJson = (filename) => JSON.parse(readFileSync(filename, "utf8"));
const policy = readJson(path.join(webRoot, "scripts/lint-policy.json"));
const oxlintConfig = path.join(webRoot, ".oxlintrc.json");
const oxlintBin = path.join(
  path.dirname(require.resolve("oxlint/package.json")),
  "bin/oxlint",
);
const eslint = new ESLint({ cwd: webRoot });
const levels = { off: 0, warn: 1, warning: 1, error: 2 };
const normalize = (rule) => {
  const [level, ...options] = Array.isArray(rule) ? rule : [rule];
  return [levels[level] ?? level, ...options];
};
const eslintRules = Object.fromEntries(
  Object.entries(policy.rules).filter(
    ([name]) => !name.startsWith("@next/next/"),
  ),
);
const nextRules = Object.fromEntries(
  Object.entries(policy.rules)
    .filter(([name]) => name.startsWith("@next/next/"))
    .map(([name, config]) => [name.replace("@next/next/", "nextjs/"), config]),
);

test("original TypeScript (71) and JavaScript (67) policies retain severity and options", async () => {
  assert.equal(Object.keys(policy.rules).length, 71);
  assert.equal(Object.keys(eslintRules).length, 50);
  assert.equal(Object.keys(nextRules).length, 21);
  assert.deepEqual(policy.typescriptOnlyRules, [
    "no-var",
    "prefer-const",
    "prefer-rest-params",
    "prefer-spread",
  ]);
  for (const file of [
    "src/app/page.tsx",
    "src/lib/api-client.ts",
    "src/lib/auth-store.spec.tsx",
    "src/__lint_contract__.mts",
    "src/__lint_contract__.cts",
    "src/__lint_contract__.js",
    "src/__lint_contract__.jsx",
    "src/__lint_contract__.mjs",
    "src/__lint_contract__.cjs",
  ]) {
    const isTypescript = /\.(?:ts|tsx|mts|cts)$/.test(file);
    const expected = Object.fromEntries(
      Object.entries(eslintRules).filter(
        ([name]) => isTypescript || !policy.typescriptOnlyRules.includes(name),
      ),
    );
    const config = await eslint.calculateConfigForFile(
      path.join(webRoot, file),
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(config.rules).map(([name, rule]) => [
          name,
          normalize(rule),
        ]),
      ),
      Object.fromEntries(
        Object.entries(expected).map(([name, rule]) => [name, normalize(rule)]),
      ),
      file,
    );
    assert.equal(Object.keys(config.rules).length, isTypescript ? 50 : 46);
    assert.equal(config.settings.react.version, "detect");
  }
  const config = readJson(oxlintConfig);
  assert.deepEqual(config.plugins, ["nextjs"]);
  assert.deepEqual(config.categories, { correctness: "off" });
  assert.deepEqual(config.rules, nextRules);
});

test("TypeScript-only core rules do not silently change the JavaScript policy", async () => {
  for (const extension of ["js", "jsx", "mjs", "cjs"]) {
    const [result] = await eslint.lintText("export var value = 1;", {
      filePath: path.join(webRoot, `src/__lint_contract__.${extension}`),
    });
    assert.deepEqual(result.messages, []);
  }
  const [result] = await eslint.lintText("export var value = 1;", {
    filePath: path.join(webRoot, "src/__lint_contract__.ts"),
  });
  assert.ok(
    result.messages.some(
      ({ ruleId, severity }) => ruleId === "no-var" && severity === 2,
    ),
  );
});

test("lint and build enforce both engines; check includes this contract", () => {
  const { scripts } = readJson(path.join(webRoot, "package.json"));
  assert.equal(
    scripts.lint,
    "eslint --max-warnings 0 src/ && oxlint --max-warnings 0 --config .oxlintrc.json src/",
  );
  assert.equal(
    scripts.build,
    "npm run lint && node scripts/run-next.mjs build",
  );
  assert.equal(
    scripts.check,
    "npm run typecheck && npm test && npm run lint:contract && npm run test:image-optimizer && npm run build",
  );
});

test("installed workspace dependency graph has no invalid peers", () => {
  assert.ok(
    process.env.npm_execpath,
    "Run this contract through npm run lint:contract",
  );
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, "ls", "--all", "--json"],
    {
      cwd: path.resolve(webRoot, "../.."),
      encoding: "utf8",
      // Walking the complete installed graph can exceed 30s on Windows under
      // load. Keep a finite budget without relaxing exit-code or peer checks.
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const tree = JSON.parse(result.stdout);
  assert.deepEqual(tree.problems ?? [], []);
});

test("root lockfile excludes the vulnerable Next lint dependency chain", () => {
  const { packages } = readJson(
    path.resolve(webRoot, "../../package-lock.json"),
  );
  for (const name of [
    "eslint-config-next",
    "@next/eslint-plugin-next",
    "fast-glob",
    "micromatch",
    "braces",
  ]) {
    const suffix = `node_modules/${name}`;
    assert.equal(
      Object.keys(packages).some(
        (entry) => entry === suffix || entry.endsWith(`/${suffix}`),
      ),
      false,
      `${name} must not reintroduce the unpatched advisory`,
    );
  }
});

// Two React rules mark JSX references and do not emit diagnostics. Their
// behavior is covered by the valid React fixture below. Every reporting rule
// has a deliberate violation, including warnings and framework-specific paths.
const eslintCases = [
  ["@typescript-eslint/no-unused-vars", "const unused = 1;"],
  ["@typescript-eslint/no-unused-expressions", "true;"],
  [
    "@typescript-eslint/ban-ts-comment",
    "// @ts-ignore\nexport const value = 1;",
  ],
  [
    "@typescript-eslint/no-array-constructor",
    "export const items = new Array(1, 2);",
  ],
  [
    "@typescript-eslint/no-duplicate-enum-values",
    "export enum Bad { A = 1, B = 1 }",
  ],
  ["@typescript-eslint/no-empty-object-type", "export type Bad = {};"],
  ["@typescript-eslint/no-explicit-any", "export const value: any = 0;"],
  [
    "@typescript-eslint/no-extra-non-null-assertion",
    "declare const value: string | undefined; export const result = value!!;",
  ],
  ["@typescript-eslint/no-misused-new", "export interface Bad { new(): Bad; }"],
  [
    "@typescript-eslint/no-namespace",
    "export namespace Bad { export const value = 1; }",
  ],
  [
    "@typescript-eslint/no-non-null-asserted-optional-chain",
    "declare const object: { value: string } | undefined; export const value = object?.value!;",
  ],
  [
    "@typescript-eslint/no-require-imports",
    "export const fs = require('node:fs');",
  ],
  [
    "@typescript-eslint/no-this-alias",
    "export function bad() { const self = this; return self; }",
  ],
  [
    "@typescript-eslint/no-unnecessary-type-constraint",
    "export function bad<T extends any>(value: T) { return value; }",
  ],
  [
    "@typescript-eslint/no-unsafe-declaration-merging",
    "export class Bad {} export interface Bad { value: string; }",
  ],
  ["@typescript-eslint/no-unsafe-function-type", "export type Bad = Function;"],
  [
    "@typescript-eslint/no-wrapper-object-types",
    "export const value: Number = new Number(1);",
  ],
  [
    "@typescript-eslint/prefer-as-const",
    "export const value: 'hello' = 'hello';",
  ],
  [
    "@typescript-eslint/prefer-namespace-keyword",
    "export module Bad { export const value = 1; }",
  ],
  [
    "@typescript-eslint/triple-slash-reference",
    "/// <reference path='./other.ts' />\nexport const value = 1;",
  ],
  ["no-var", "var value = 1; console.log(value);"],
  ["prefer-const", "let value = 1; console.log(value);"],
  ["prefer-rest-params", "export function bad() { return arguments; }"],
  [
    "prefer-spread",
    "declare const fn: (...args: number[]) => void; const args = [1, 2]; fn.apply(null, args);",
  ],
  ["import/no-anonymous-default-export", "export default {};"],
  [
    "jsx-a11y/alt-text",
    "import Image from 'next/image'; export default function Bad() { return <Image src='/x.png' width={1} height={1} />; }",
  ],
  [
    "jsx-a11y/aria-props",
    "export default function Bad() { return <div aria-invented='x' />; }",
  ],
  [
    "jsx-a11y/aria-proptypes",
    "export default function Bad() { return <div aria-hidden='sometimes' />; }",
  ],
  [
    "jsx-a11y/aria-unsupported-elements",
    "export default function Bad() { return <meta aria-label='x' />; }",
  ],
  [
    "jsx-a11y/role-has-required-aria-props",
    "export default function Bad() { return <div role='checkbox' />; }",
  ],
  [
    "jsx-a11y/role-supports-aria-props",
    "export default function Bad() { return <div role='button' aria-checked='true' />; }",
  ],
  [
    "react-hooks/rules-of-hooks",
    "import { useState } from 'react'; export default function Bad({ enabled }: { enabled: boolean }) { if (enabled) useState(0); return null; }",
  ],
  [
    "react-hooks/exhaustive-deps",
    "import { useEffect } from 'react'; export default function Bad({ value }: { value: number }) { useEffect(() => console.log(value), []); return null; }",
  ],
  [
    "react/display-name",
    "import { memo } from 'react'; export const Bad = memo(() => <div />);",
  ],
  [
    "react/jsx-key",
    "export default function Bad() { return <div>{[1, 2].map(value => <span>{value}</span>)}</div>; }",
  ],
  [
    "react/jsx-no-comment-textnodes",
    "export default function Bad() { return <div>// wrong comment</div>; }",
  ],
  [
    "react/jsx-no-duplicate-props",
    "export default function Bad() { return <div id='a' id='b' />; }",
  ],
  [
    "react/jsx-no-undef",
    "export default function Bad() { return <Missing />; }",
  ],
  [
    "react/no-children-prop",
    "export default function Bad() { return <div children='wrong' />; }",
  ],
  [
    "react/no-danger-with-children",
    "export default function Bad() { return <div dangerouslySetInnerHTML={{ __html: 'x' }}>wrong</div>; }",
  ],
  [
    "react/no-deprecated",
    "import React from 'react'; export class Bad extends React.Component { componentWillMount() {} render() { return null; } }",
  ],
  [
    "react/no-direct-mutation-state",
    "import React from 'react'; export class Bad extends React.Component { change() { this.state.value = 1; } render() { return null; } }",
  ],
  [
    "react/no-find-dom-node",
    "import ReactDOM from 'react-dom'; export const bad = ReactDOM.findDOMNode(null);",
  ],
  [
    "react/no-is-mounted",
    "import React from 'react'; export class Bad extends React.Component { check() { return this.isMounted(); } render() { return null; } }",
  ],
  [
    "react/no-render-return-value",
    "import ReactDOM from 'react-dom'; export const bad = ReactDOM.render(<div />, document.body);",
  ],
  [
    "react/no-string-refs",
    "export default function Bad() { return <div ref='bad' />; }",
  ],
  [
    "react/no-unescaped-entities",
    "export default function Bad() { return <div>don't</div>; }",
  ],
  [
    "react/require-render-return",
    "import React from 'react'; export class Bad extends React.Component { render() { console.log('missing return'); } }",
  ],
];

test("ESLint fixtures cover every reporting rule", () => {
  assert.deepEqual(
    eslintCases.map(([name]) => name).sort(),
    Object.keys(eslintRules)
      .filter(
        (name) =>
          !["react/jsx-uses-react", "react/jsx-uses-vars"].includes(name),
      )
      .sort(),
  );
});

for (const [name, source] of eslintCases) {
  test(`ESLint rejects ${name} at its original level`, async () => {
    const [result] = await eslint.lintText(source, {
      filePath: path.join(webRoot, "src/__lint_contract__.tsx"),
    });
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    const diagnostic = result.messages.find((entry) => entry.ruleId === name);
    assert.ok(diagnostic, JSON.stringify(result.messages));
    assert.equal(diagnostic.severity, normalize(eslintRules[name])[0]);
  });
}

test("valid React JSX references, hooks, TypeScript and accessibility pass ESLint", async () => {
  const [result] = await eslint.lintText(
    `
    import React, { useEffect } from 'react';
    import Image from 'next/image';
    const Child = () => <span>Child</span>;
    export default function Good({ value }: { value: number }) {
      useEffect(() => console.log(value), [value]);
      return <div><Child /><Image src='/x.png' alt='x' width={1} height={1} /></div>;
    }
  `,
    { filePath: path.join(webRoot, "src/__lint_contract__.tsx") },
  );
  assert.deepEqual(result.messages, []);
});

const nextCases = [
  [
    "google-font-display",
    "src/pages/example.tsx",
    "<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Roboto' />",
  ],
  [
    "google-font-preconnect",
    "src/pages/example.tsx",
    "<link href='https://fonts.gstatic.com' />",
  ],
  [
    "next-script-for-ga",
    "src/pages/example.tsx",
    "<script src='https://www.google-analytics.com/analytics.js' />",
  ],
  [
    "no-async-client-component",
    "src/app/example.tsx",
    "'use client'; export default async function Bad() { return <div />; }",
    true,
  ],
  [
    "no-before-interactive-script-outside-document",
    "src/pages/example.tsx",
    "import Script from 'next/script'; export default function Bad() { return <Script src='/x.js' strategy='beforeInteractive' />; }",
    true,
  ],
  [
    "no-css-tags",
    "src/pages/example.tsx",
    "<link rel='stylesheet' href='/x.css' />",
  ],
  ["no-head-element", "src/pages/example.tsx", "<head />"],
  ["no-img-element", "src/pages/example.tsx", "<img src='/x.png' alt='x' />"],
  [
    "no-page-custom-font",
    "src/pages/example.tsx",
    "<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Roboto&display=swap' />",
  ],
  [
    "no-styled-jsx-in-document",
    "src/pages/_document.tsx",
    "<style jsx>{'p{}'}</style>",
  ],
  [
    "no-title-in-document-head",
    "src/pages/_document.tsx",
    "import { Head } from 'next/document'; export default function Bad() { return <Head><title>Bad</title></Head>; }",
    true,
  ],
  [
    "no-typos",
    "src/pages/example.tsx",
    "export const getStaticprops = () => ({}); export default function Bad() { return null; }",
    true,
  ],
  [
    "no-unwanted-polyfillio",
    "src/pages/example.tsx",
    "<script src='https://polyfill.io/v3/polyfill.min.js?features=Array.prototype.flat' />",
  ],
  [
    "inline-script-id",
    "src/pages/example.tsx",
    "import Script from 'next/script'; export default function Bad() { return <Script>{'console.log(1)'}</Script>; }",
    true,
  ],
  [
    "no-assign-module-variable",
    "src/pages/example.tsx",
    "const module = {}; export default function Bad() { return module; }",
    true,
  ],
  [
    "no-document-import-in-page",
    "src/pages/example.tsx",
    "import Document from 'next/document'; export default function Bad() { return <Document />; }",
    true,
  ],
  [
    "no-duplicate-head",
    "src/pages/_document.tsx",
    "import Document, { Head } from 'next/document'; export default class Bad extends Document { render() { return <html><Head /><Head /><body /></html>; } }",
    true,
  ],
  [
    "no-head-import-in-document",
    "src/pages/_document.tsx",
    "import Head from 'next/head'; export default function Bad() { return <Head />; }",
    true,
  ],
  ["no-html-link-for-pages", "src/pages/example.tsx", "<a href='/'>Home</a>"],
  [
    "no-script-component-in-head",
    "src/pages/example.tsx",
    "import Head from 'next/head'; import Script from 'next/script'; export default function Bad() { return <Head><Script src='/x.js' /></Head>; }",
    true,
  ],
  ["no-sync-scripts", "src/pages/example.tsx", "<script src='/x.js' />"],
];

test("Next fixtures cover all 21 rules", () => {
  assert.deepEqual(
    nextCases.map(([name]) => `nextjs/${name}`).sort(),
    Object.keys(nextRules).sort(),
  );
});

const fixture = mkdtempSync(path.join(tmpdir(), "agri-trace-web-lint-"));
test.after(() => {
  const resolved = realpathSync(fixture);
  assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
  assert.ok(path.basename(resolved).startsWith("agri-trace-web-lint-"));
  rmSync(resolved, { recursive: true });
});
mkdirSync(path.join(fixture, "src/pages"), { recursive: true });
writeFileSync(
  path.join(fixture, "src/pages/index.tsx"),
  "export default function Home() { return null; }",
);

function lintNext(filename, source) {
  const target = path.join(fixture, filename);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
  const result = spawnSync(
    process.execPath,
    [oxlintBin, "--config", oxlintConfig, "--format", "json", target],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.ifError(result.error);
  assert.ok(
    result.status === 0 || result.status === 1,
    `${result.stdout}\n${result.stderr}`,
  );
  const report = JSON.parse(result.stdout);
  assert.equal(report.number_of_rules, 21);
  assert.equal(report.number_of_files, 1);
  const hasErrors = report.diagnostics.some(
    ({ severity }) => severity === "error",
  );
  assert.equal(result.status, hasErrors ? 1 : 0);
  return report.diagnostics;
}

for (const [name, filename, source, complete] of nextCases) {
  test(`Next rejects ${name} at its original level`, () => {
    const diagnostics = lintNext(
      filename,
      complete ? source : `export default function Bad() { return ${source}; }`,
    );
    const diagnostic = diagnostics.find(({ code }) => code === `next(${name})`);
    assert.ok(diagnostic, JSON.stringify(diagnostics));
    assert.equal(
      levels[diagnostic.severity],
      normalize(nextRules[`nextjs/${name}`])[0],
    );
  });
}

test("valid Next Link, Image, async script and inline script id pass", () => {
  assert.deepEqual(
    lintNext(
      "src/pages/example.tsx",
      `
    import Link from 'next/link';
    import Image from 'next/image';
    import Script from 'next/script';
    export default function Good() {
      return <div><Link href='/'>Home</Link><Image src='/x.png' alt='x' width={1} height={1} />
        <script async src='/x.js' /><Script id='inline'>{'console.log(1)'}</Script></div>;
    }
  `,
    ),
    [],
  );
});

test("App Router internal links are checked as well as Pages Router links", () => {
  lintNext(
    "src/app/scan/page.tsx",
    "export default function Scan() { return null; }",
  );
  const diagnostics = lintNext(
    "src/app/login/page.tsx",
    "export default function Bad() { return <a href='/scan'>Scan</a>; }",
  );
  assert.ok(
    diagnostics.some(
      ({ code, severity }) =>
        code === "next(no-html-link-for-pages)" && severity === "error",
    ),
  );
  assert.deepEqual(
    lintNext(
      "src/app/login/page.tsx",
      "import Link from 'next/link'; export default function Good() { return <Link href='/scan'>Scan</Link>; }",
    ),
    [],
  );
});

test("beforeInteractive is allowed in the App Router root layout", () => {
  assert.deepEqual(
    lintNext(
      "src/app/layout.tsx",
      `
    import Script from 'next/script';
    export default function RootLayout() {
      return <html><body><Script strategy='beforeInteractive' src='/x.js' /></body></html>;
    }
  `,
    ),
    [],
  );
});

for (const [engine, source, diagnostic] of [
  ["ESLint", "export const value: any = 1;", /no-explicit-any/],
  ["ESLint warning", "const unusedLintCanary = 1;", /no-unused-vars/],
  [
    "Oxlint Next",
    "export function LintBuildCanary() { return <script src='/blocked.js' />; }",
    /no-sync-scripts/,
  ],
  [
    "Oxlint Next warning",
    "export function LintBuildCanary() { return <img src='/blocked.png' alt='canary' />; }",
    /no-img-element/,
  ],
]) {
  test(
    `a real build stops on ${engine} diagnostics before invoking the compiler`,
    { timeout: 90_000 },
    () => {
      assert.ok(
        process.env.npm_execpath,
        "Run this contract through npm run lint:contract",
      );
      const sourceRoot = realpathSync(path.join(webRoot, "src"));
      const canary = path.join(
        sourceRoot,
        `__lint_build_canary_${randomUUID()}.tsx`,
      );
      writeFileSync(canary, source, { flag: "wx" });
      try {
        const result = spawnSync(
          process.execPath,
          [process.env.npm_execpath, "run", "build"],
          {
            cwd: webRoot,
            encoding: "utf8",
            timeout: 80_000,
          },
        );
        assert.ifError(result.error);
        const output = `${result.stdout}\n${result.stderr}`;
        assert.equal(result.status, 1, output);
        assert.match(output, diagnostic);
        assert.doesNotMatch(
          output,
          /Creating an optimized production build|▲ Next\.js/,
        );
      } finally {
        assert.equal(path.dirname(canary), sourceRoot);
        assert.ok(path.basename(canary).startsWith("__lint_build_canary_"));
        unlinkSync(canary);
      }
    },
  );
}
