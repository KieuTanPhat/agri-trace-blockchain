# CI security audit

Run `npm run audit:ci` from the repository root. Production dependencies must
pass the standard npm high/critical audit with no exceptions. The full audit
also blocks high/critical findings except for the temporary exception below.
Registry failures and invalid reports fail the job.

## Temporary Next.js lint exception

- Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- Reviewed: 2026-10-05. Expires: 2026-11-05 at 00:00 UTC.
- Dependency chain: eslint-config-next → @next/eslint-plugin-next → fast-glob
  → micromatch → braces 3.0.3.
- Risk: deeply nested, attacker-controlled brace patterns can exhaust the stack.
  This chain is development-only lint tooling; its patterns come from the
  repository configuration. Do not pass untrusted patterns into this tooling.
- Upstream has no patched braces release as of the review date. The npm force
  suggestion downgrades the Next lint configuration to a different major version.
- The exception checks the exact advisory, high severity, dependency chain
  package names, and `dev: true` in the lockfile for every affected node.
  It does not accept production exposure, new advisories, or critical severity.
- This accepts limited temporary risk; it does not patch the vulnerable library.
  CI prints the exception whenever it is used and fails after expiry.

When an upstream fix is available, update the lockfile, remove this exception,
and restore the standard full `npm audit --audit-level=high` step. Do not extend
the expiry without reviewing the advisory and dependency exposure again.

Run `npm run test:audit` to verify that the exception cannot accept new findings,
production dependencies, expired exceptions, or invalid audit responses.
