# Web contract generation — AC-API-03

Owner: Phi (@hphikstill). Contract reviewer: Tuấn. Integration/policy acceptance: Phát.

## Reproduce

From the repository root, install the committed lockfile with `npm ci`, then run:

```sh
npm run typegen --workspace apps/web
npm run typegen:check --workspace apps/web
npm run test:typegen --workspace apps/web
npm run check --workspace apps/web
```

Web generation reads only `docs/openapi/openapi.json`; it does not need a running
API, database or backend build. `apps/web/scripts/api-typegen.config.json` selects
OpenAPI version 2.1.0, its checksum file, openapi-typescript 7.13.0, deterministic
generator options and the operations exposed by the client. Input checksum and
version mismatches fail before writing. SHA uses LF-normalized UTF-8, matching
the existing backend exporter and allowing Windows checkouts.
The manifest also records the client-generator source SHA and selected operation
IDs, so the custom transport adapter template is identifiable alongside its input.

For an intentional backend contract update, run `npm run api-contract:generate`
after updating NestJS metadata. It exports the spec/checksum and invokes the same
Web generator. A version change also requires an explicit config update.
Review the JSON/checksum, config and generated diff together; a checksum proves
input identity, **not** human approval of the contract.

## Layout and transport

The current repository uses `src/lib/api-client.ts`, `types.ts` and `catalog.ts`,
not the `shared/types`, `http-client.ts` or `features/*/api.ts` paths in the original
task. Canonical generated files now live under `src/shared/api/generated`, suitable
for consumption by FSD feature layers. `src/lib/generated/api.d.ts` is a compatibility
type export so existing consumers do not need a simultaneous directory migration.

`api.d.ts` contains DTOs and endpoint operation types. `client.ts` is generated
from configured operation IDs and injects the existing `request` transport.
Login, lot reads, catalog, organizations, public trace and harvest wrappers use
its operation-derived request/response types. It encodes path parameters and
serializes JSON; it does not implement fetch, refresh or envelope unwrapping.
The existing transport retains cookie credentials, retry/refresh, session and
permission ownership checks, command recovery and Idempotency-Key handling.
Refresh's envelope type also comes from the generated auth DTO.

Browser session projections and `CommandInput` form state remain separate from
wire DTOs. Command form field types are projected from generated shipment DTOs;
draft command payloads use `satisfies Partial<...>` against generated DTOs to keep
existing server-side required-field validation. This is compile-time field/type
checking, not runtime schema validation or a guarantee that an unfinished form
is a complete request. Admin organization/role data also uses generated DTOs.
Existing command orchestration and other generated DTO consumers
remain in their current locations. To expose another endpoint, add its operation
ID to the config and regenerate. The generator fails on unsupported query/cookie
parameters or ambiguous success responses rather than silently dropping them.
It also rejects mismatched path parameters, missing response envelopes and an
anonymous operation newly marked protected by the spec.

## CI and evidence

`apps/web`'s `check` begins with `typegen:check`, comparing regenerated artifacts
in memory without modifying them. Backend CI still checks spec drift against
compiled NestJS metadata. OpenAPI and generated contract changes select both
API and Web checks. Web CI uploads the input spec/checksum, config, generated
DTO/client/manifest and Node/npm/OS/commit environment under
`web-contract-node-<version>-<SHA>`. Job status/logs determine pass/fail; an uploaded
artifact alone does not mean validation passed.
`test:typegen` runs in the same Web check and uses disposable copies under
`node_modules/.cache` to exercise checksum/version/drift rejection, missing
operations, inherited query parameters, path/envelope/auth changes and
deterministic regeneration under CRLF. It never modifies the checked-in spec.

See [Phi's validation record](web-typegen-evidence-2026-10-14.md) for local results
and outstanding reviewer acceptance.
