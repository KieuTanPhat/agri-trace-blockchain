# Legacy callable interface, patched upstream matching

ESLint 9 and its React/import plugins expect `require('minimatch')` to be a
function. Minimatch 11 exports that same callable as `.minimatch`, including
`Minimatch`, `defaults`, `filter`, `match` and brace expansion helpers.
This private adapter forwards calls/defaults to upstream and restores legacy
`makeRe(...).test(path)` through upstream `Minimatch.match`. The latter is a
predicate object for eslint-plugin-import, **not** a RegExp: regex generation was
removed by upstream 11 and must not be reintroduced here. This adapter contains no
matching implementation and no vulnerability exception. Its dependency remains
the actual, audited `minimatch@11.0.3` package in the lockfile.

The mobile and monorepo tooling roots install this directory under the legacy dependency name and
uses npm's `$minimatch` override reference for older consumers. Modern consumers
keep the normal named-export package at 11.0.3. Glob uses 14.0.3. Both require the
repository's Node 24 runtime. Docker copies this directory before `npm ci`.

Run `npm run test:compat` and the complete mobile check/export after changing
these pins. Remove this adapter when upstream lint tooling uses the modern
interface. The root also uses it for Redocly tooling, which expects the callable interface.
This is development tooling; no server matching implementation is replaced.

Advisories: https://github.com/advisories/GHSA-g3hv-75wg-m249 and
https://github.com/advisories/GHSA-3g3m-2fjr-6pw4.
