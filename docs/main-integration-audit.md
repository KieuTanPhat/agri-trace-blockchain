# Main integration audit - 2026-09-29

## Scope and branch inventory

- Base: `main` at `6616f000b76ed0675dbf707f7cbba82cf5d2788c`.
- Integrate `phi2` at `62941c78be01153b5e1017059f0c9fd32286de8a`.
- Keep main's existing role policy, including SYSTEM_ADMIN business commands.
- Explicitly exclude local commit `87dd1be` and its business-policy changes.
- `dev`, `phat`, `phi`, `tuan`, `risk-hardening`, and
  `feature/modular-monolith-dedicated-worker` were already ancestors of main.
- `tuan-BE-02-traceability-api` has a historical commit with the same patch as
  main's `38ad62b`; it does not contain missing code.
- PRs #8, #10, and #11 were already integrated. Closed PR #9's head was
  incorporated through #10. No open PR existed at the inventory snapshot.

## Review by subsystem

| Subsystem | Review and verification |
| --- | --- |
| Architecture | Module boundaries, API/worker process separation, public exports, no API-held Fabric signer; architecture tests |
| Authentication | DB-authoritative roles/account status, JWT validation, refresh rotation, error replay, session-switch races |
| Master data | Admin-only writes, organization/farm types, catalog scoping, blank-name and missing-reference validation |
| Production | Cycle states, optimistic versions, plot ownership, planned quantities, concurrent harvests, off-chain sensor input |
| Lots | Atomic harvest/lot/quantity movement/QR/outbox writes; exact decimal precision; public projection |
| Shipments | Assigned organization checks, state transitions, stale versions, partial/full damage, receipt and rejection quantities |
| Compliance | Exactly one certificate subject, review-once update, approved/public-only QR disclosure, UUID query validation |
| IoT | Device scope/key handling, reading replay, explicit digests, tracking bindings, database telemetry invariants, digest chaining |
| Trace/Fabric | RFC8785 hashes, append-only data, locked chain heads, outbox ordering/leases, duplicate recovery, receipt integrity |
| Web/PWA | Session restoration, request-refresh safety, form retries, scoped search, offline response isolation |
| Operations | Reproducible workspace installation, dependency audit, migrations, runtime loading, production container smoke, Fabric smoke |

## Correctness and security fixes

1. Enforce organization authorization on internal trace history and proof
   endpoints. Unscoped business accounts no longer inherit unrestricted
   Prisma filters.
2. Resolve trace heads from hash links, not business timestamps. Backdated or
   tied timestamps cannot fork the chain. Serialize telemetry digest appends
   and resolve their heads in the same way; fail closed on existing forks.
3. Use Decimal arithmetic for shipment accounting. Already damaged stock is
   not counted again as rejected; full damage leaves exactly zero stock.
   Reject quantity precision PostgreSQL would silently round.
4. Validate missing plots, missing organizations, blank master-data names,
   certificate query UUIDs, and bcrypt's 72-byte password limit.
5. Align telemetry acceptance with main's existing PostgreSQL trigger:
   IN_TRANSIT only, and not before the device binding. Both sensor entrypoints
   reject readings for closed cycles.
6. Compare device keys by UTF-8 byte length before timing-safe comparison.
7. Require matching receipt hashes before CONFIRMED proofs. Invalid hashes,
   invalid receipt times, and permanent contract failures are dead-lettered.
   Stale lease completions cannot create proofs; worker poll listeners are
   cleaned up.
8. Map both Prisma P2034 and adapter TransactionWriteConflict errors to HTTP
   409 instead of intermittent HTTP 500.
9. Keep ambiguous idempotency outcomes blocked for reconciliation. A failure
   saving the replay response is not reported as a failed business command;
   expired PROCESSING requests are not automatically executed again.
10. Discard responses from a previous account, clear scoped search on account
    changes, keep IoT retry keys stable, and never substitute offline HTML for
    API responses. Offline fallback is the public scan page only.
11. Patch known vulnerable dependencies without migrating application framework
    majors. Pin npm 12.1.0 so workspace overrides are applied; explicitly allow
    required install scripts at reviewed package versions. Block demo seeding
    in production.
12. Database tests use TEST_DATABASE_URL only and verify connectivity before
    negative constraint tests, preventing false passes against an unavailable
    database.
13. Replace the fixed-version, 100-byte QR encoder with the established qrcode
    library. Long trace URLs round-trip through an independent jsQR decoder,
    without changing the SVG display component.
14. Include a standalone chaincode lockfile in Fabric's deployment package.
    The peer's npm 10 builder can use reproducible production `npm ci` instead
    of crashing while resolving the unpinned development dependency graph.
    Audit that lockfile separately from the workspace lockfile in CI.
15. Limit each lot's trace projection to its own events plus cycle-wide events
    with no lot ID. A shipment participant cannot see sibling harvest events
    through the lot detail page, and public QR timelines do not mix lots.
16. Compute the overall proof status across every related event, including
    production-cycle events in list views. Pending, failed, or invalid earlier
    proofs cannot be hidden by a verified latest event. Recompute each local
    event hash before displaying VERIFIED, without exposing its hash input.

## Verification and merge gates

- Install from the root with the supported Node/npm versions and `npm ci`.
- Run `npm audit --audit-level=high`; the reviewed lockfile has zero reported
  vulnerabilities at the audit snapshot, not a guarantee against future CVEs.
- Apply every committed migration to a disposable PostgreSQL database. Never
  use production data for these tests.
- Run root `npm run check` with DATABASE_URL and TEST_DATABASE_URL pointing to
  that disposable database. This builds gateway declarations before API checks.
- Require all Application CI and Blockchain CI jobs for the exact PR head,
  including real production-container HTTP checks and the Fabric smoke test.
- Use a merge commit so phi2's actual commit remains in main's ancestry. Do not
  force-push main, bypass branch rules, or integrate excluded local work.
- After merge, fetch main, confirm both expected parents are included, inspect
  the final tree, and rerun the full check and audit on the merged main state.

Local database verification uses an isolated temporary PostgreSQL 18 instance;
CI uses PostgreSQL 16. Local Docker availability is not assumed, so container
and Fabric gates run on GitHub's disposable Linux runners.

Browser verification uses Chromium on desktop (1440x900) and mobile (390x844):
invalid and successful login, cycle creation, planting, harvest, lot detail,
and public QR trace. The lots, admin, cycles, IoT, and public trace routes
render without browser runtime errors or document-level horizontal overflow.
This smoke run uses only the disposable audit database and demo identities.

## Operational constraints

- Ambiguous PROCESSING idempotency records require an operator to inspect the
  business resource and trace/outbox before reconciling the stored response.
  Do not delete these records or resend an uncertain command under a new key
  without checking whether it committed.
- Existing immutable trace/digest forks are rejected, not rewritten. Any legacy
  inconsistent production data needs a separately reviewed reconciliation.
- This is a source, automated-test, and integration audit, not a guarantee that
  every possible defect has been found or a production penetration test.
- Deployers still need unique secrets, TLS, backups, appropriate database
  privileges, Fabric identity protection, monitoring, and load testing.
