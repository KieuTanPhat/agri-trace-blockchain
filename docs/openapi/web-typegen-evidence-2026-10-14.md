# Phi — AC-API-03 validation record

- Date: 14/10/2026 (Asia/Bangkok), Phase 1 / W2 / P1.
- Owner: Phi (@hphikstill); contract reviewer: Tuấn; integration/acceptance: Phát.
- Source base: `bf508d34c10ca393cdb8078b748408b5fd38093a` plus the local working-tree changes for this task. No new commit or PR has been created.
- Input artifact: `docs/openapi/openapi.json`, API version **2.1.0**.
- Input SHA-256 (LF-normalized): `9e4f1cc08c2c35c52b3124d19d89c1dae1c8be290784be6bbec03716500abc9f`.
- Generator: **openapi-typescript 7.13.0** plus the repository operation-client template in `apps/web/scripts/api-typegen.mjs`.
- Config: `apps/web/scripts/api-typegen.config.json`; its SHA is recorded in the generated manifest.
- Environment: local Windows x64, Node **24.15.0**, npm **12.1.0**, dependencies installed from the committed lockfile with `npm ci`.

## Results

| Check | Result |
| --- | --- |
| Regenerate DTO/client from JSON artifact | PASS |
| Regenerate comparison (`typegen:check`) | PASS |
| Automated generator tests (`test:typegen`, included in CI) | PASS: 12 tests; deterministic CRLF regeneration and negative cases |
| Web TypeScript check | PASS |
| Web Vitest suite | PASS: 37 files, 257 tests, including 4 transport-boundary tests and 4 real-wrapper integration regressions |
| CI selection/gate tests | PASS: 19 tests |
| Lint contract | PASS: 84 tests |
| Image optimizer | PASS: 4 tests |
| ESLint + Oxlint / production build | PASS: Next.js 15.5.27, 15 static pages generated |
| Full `npm run check --workspace apps/web` | PASS: exit code 0 |
| Backend compiled-metadata/spec drift | PASS: rebuilt Gateway/API, generated Prisma client, validated 103 operations/public projection and matched the committed JSON/SHA |
| Hosted CI / deployed environment | Not run; this is local source validation |

Existing paths equivalent to the task's verification list are
`src/lib/api-client.spec.ts` (shared HTTP/auth/public trace),
`src/lib/auth-store.spec.tsx`, and `src/app/trace/[lotId]/page.spec.tsx`.
The new client boundary is covered by `src/shared/api/contract-client.spec.ts`.

Local raw evidence lives in `artifacts/web-contract/check.log` and
`artifacts/web-contract/negative.log`; the stricter second review adds
`backend-check.log` and `ci-selection.log` in the same folder. CI is configured to upload matching
contract/config/generated artifacts, validation logs and environment per SHA.
Initial sandbox runs encountered Windows EPERM during install/cache rename;
dependency installation and the full Web validation were rerun outside that
sandbox. These infrastructure errors are not counted as passing tests.
The existing lint-policy test was updated to expect the new `typegen:check`
and `test:typegen` prefix in the `check` script.
Idempotency key parameters now explicitly accept `string`, avoiding UUID-literal
inference and preserving existing caller-supplied keys with current TypeScript.

Local bundle: `artifacts/web-contract-ac-api-03-2026-10-14.zip` contains input,
generated files, configuration, source patch/new source files, logs and environment.

## Second review: requirement coverage

| AC-API-03 concern | Evidence / limit |
| --- | --- |
| Reproducible DTO/client from artifact | Pinned generator/config/version/checksum; manifest also includes the adapter-template SHA; backend confirms the same artifact |
| DTO ownership | Auth, lot, catalog DTO aliases/client operation types are generated; admin organization/role types and command draft field types now derive from DTOs too |
| Refresh and session ownership | Existing regressions plus real-wrapper tests for concurrent catalog refresh and rejection of late results from a different session |
| Headers, envelope, idempotency | Real generated harvest wrapper tested through the actual shared transport across 401/refresh/retry; original body/key/cookies/content-type retained and envelope unwrapped |
| Public trace | Existing public/no-auth/404/projection regressions and generated path-encoding test; generator rejects an anonymous endpoint newly marked protected |
| CI | Drift check plus automated negative/determinism tests in the Web check; API checks compiled metadata; artifacts include logs and commit environment |
| Approval and environment acceptance | Local source validation only; no verified human approval or hosted CI result, so acceptance remains Not Evaluated |

## Acceptance / handoff

- PR/SHA or artifact + environment + result: input SHA and local results above; generated manifest at `apps/web/src/shared/api/generated/manifest.json`.
- Reviewer / Phát / date: **chưa đánh giá**.
- Acceptance: **Not Evaluated**. Local implementation/test results do not substitute for reviewer acceptance.
- Blocker: no verified final AGT-010 approval or Tuấn/Phát acceptance record was supplied or found in the local evidence read for this task.
- Owner / target: Tuấn confirms the final contract SHA; Phát confirms integration/policy and acceptance; target **16/10/2026** per the task window (not a newly agreed commitment).
- Next step: review the contract SHA and generated/transport diff, run hosted CI on the submitted commit, then record reviewer outcome and Phát's dated acceptance here or in the PR/issue.

The implementation follows the repository's actual `src/lib` wrappers and keeps
compatibility imports while establishing `src/shared/api/generated`. It does not
claim that a full FSD folder migration or a production release has occurred.
