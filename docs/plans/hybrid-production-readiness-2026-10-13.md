# Hybrid A/B/C production readiness

Current execution plan approved on 2026-10-13. Preserve Claude's implementation;
complete the missing release safeguards rather than recreate the retired design.

## Baseline and ownership

- Baseline: `2f132e26dd26270b907a4a4c82070637c6a5536f`.
- Worktree: `C:\Users\kieup\.codex\worktrees\hybrid-production-readiness\agri-trace-blockchain`.
- Branch: `feature/hybrid-production-readiness`; release through PR and exact-SHA CI.
- Claude, old Codex and Desktop/main remain untouched. Existing user dirty files
  and ignored evidence remain in their original worktrees.
- Main observed at `a450ca2e031fb36917ebf0e43867d8deae40c144` before work.
- Production receipt describes `prod-8ae13542` and legacy channel `agritrace`,
  sequence 3. Runtime and migration catalog must be read again before delivery.
- Hosted A/B/C is the release scope. Independent signatures cover handover;
  care and harvest retain current authentication. Real external partner authority
  remains NotEvaluated. Provision a separate hosted production network; preserve
  the existing network, history, identities and keys.

| Owner | Files | Deliverables |
| --- | --- | --- |
| Domain | API source/schema/operator/tests; chaincode | Lease and epoch fencing, legacy readers, current authorization, expiry, compiled CLI, domain regressions |
| Web | Web source/tests except generated contract | Durable signed commands, tabs/reload/account scope, key selection, internal handover labels |
| Platform | CI/deploy/Compose/network/gateway; Fabric/browser harness | Required gates, portable isolated tests, migration floor, scoped verification, forward recovery, collector |
| Root | Manifests/locks/codegen/docs/integration | Interfaces, serial heavy jobs, review, receipts, PR and controlled release |

Execution update: the user requested a single agent on 2026-10-13. Domain,
Web and Platform are sequential work areas owned by the primary agent; the
three delegated agents have been stopped. Only one local DB/Fabric/browser
job runs at a time. Freeze source for release acceptance.

## Ordered gates

1. Takeover: verify clean Claude baseline and job ownership. Encrypt and verify
   pilot backup, then stop only the owned containers/processes. Preserve volumes,
   MSP and evidence; never prune or stop native PostgreSQL.
2. Fresh dependencies with manifest Node/npm; verify installed graph and both
   lockfiles. Fix source, fixture or harness findings without reducing assertions.
3. Complete domain/Web interfaces: authority under locks and before replay;
   positive-journal reconciliation; fenced control jobs; epoch/version/state CAS;
   stable bootstrap nonce; expiry races; signer recovery and key selection.
4. Unify historical readers using an independently pinned finite baseline
   descriptor. Preserve hashes, txIds, destination and QR trust. A new sidecar or
   chain assignment cannot upgrade legacy evidence into organization signatures.
5. Complete required Application/Blockchain/Dependency checks: all API/SQL,
   isolated real three-org Fabric, desktop/mobile browser, production images and
   compiled operators. Skipped tests are not release acceptance.
6. Review append-only SQL/checksums, fresh and legacy/production-copy migration,
   full catalog/data fingerprint restore and compatible-image recovery. Keep an
   independent Hybrid schema/application floor that blocks old8ae rollback.
7. Fault/load: two workers, stale lease, restart and outage, 10 clients and 200
   Pending over multiple aggregates/two bindings; API p95 <=2s and drain <=15min
   after recovery inside quotas. Preserve unknown attempts and destination.
8. Review PR with exact evidence and release package. After merge require fresh
   Application/Blockchain/Dependency on the exact main SHA and pinned images.
9. Capacity gate: reserve >=20% host RAM; separate hosted MSP/CA/volumes and
   endorsement service + owner. Do not purchase capacity or discard quotas.
10. Check delivery locks/journal/runtime, stop writers, capture a quiescent
    baseline, consistent encrypted PG/ledger/identity/config backup off-VPS and
    verify decryption/checksums. Apply reviewed migrations and validate mappings
    and grants in maintenance before enabling writes.
11. Start compatible API, Worker and Web canary; preserve legacy sequence/channel.
    Deploy B/C only to the new hosted channel. Verify A then B/C direct ledger,
    permissions and QR with technical tenants; expand chain by chain.
12. Observe >=24h using a server collector every minute. Record missing probes;
    max gap <=5min, no P0/P1, integrity/scope errors or unexpected OOM/restarts.
    A deliberate release/runtime change starts a new window with its reason.

## Safety and evidence

- Migration checksums of the baseline's 17 migrations are immutable inputs;
  repairs append a new migration. Main's 14 applied migrations are unchanged.
- Reviewed SQL admissions do not disable the default deny parser.
- After Hybrid schema apply, failed delivery holds writers and preserves journal,
  attempts/snapshot; use a compatible image or explicit fix-forward. Do not use
  database restore as routine application rollback or automatically resolve migrations.
- Do not rehash, rewrite evidence/journal/outbox, move legacy channel/MSP, blindly
  resubmit PROCESSING/UNKNOWN, change a command key to bypass a gate, or downgrade C.
- API gets metadata only; signer/control identities are readonly Worker/operator
  mounts. Private signing keys never enter API, commits or public artifacts.
- Receipts include exact SHA, runtime, suite passed/failed/skipped, checksums,
  governance/image digests and owned-resource cleanup. Old receipts stay historical.

## Current state

New worktree and ownership established. Node24.19/npm12.1 fresh install and
workspace audit/installed graph passed on the dirty working source; these are
provisional checks rather than exact-candidate evidence. Playwright1.62.1 is pinned.
Pilot's 11 containers are stopped, 12 volumes/MSP/ledger remain intact, its ports
are released and the AES-GCM cold backup decrypt/checksum passed. The first backup
attempt failed because BusyBox tar applies repeated -C differently; its encrypted
partial and diagnostics were preserved and the harness was corrected.

Read-only production inventory at 2026-10-13T11:27:17Z confirmed release8ae,
sequence3, 14 completed migrations, 60 events/proofs, Pending0/deadLetter0, no dev
deployment and no Hybrid floor. Host RAM is8326942720bytes; existing running caps
sum8455716864bytes and several Fabric containers are unbounded. Capacity is an
open gate: a proposed profile must pass isolated load/restore with >=20% reserve
before any production quota change or hosted provisioning.

Source fixes are in progress and have not passed release acceptance. Production
delivery has not started. The existing Claude acceptance record remains historical;
its unsupported npm11 run and skipped Fabric tests do not close the new gates.

## Execution log — single agent, 2026-10-13

Primary agent (Claude) continued from the Codex working tree in the order above.
Source is committed on `feature/hybrid-production-readiness`; nothing was pushed or
deployed. Node 24.15.0 with npm 12.1.0 (manifest engines) was used.

| Gate | Status | Evidence / remaining |
| --- | --- | --- |
| 1 Takeover | Done by Codex | Pilot cold backup verified; its 11 containers stay stopped. A new isolated instance `agri-hybrid-claude` (offset 12000) was used for validation and is owned by this agent. |
| 2 Dependencies | Provisional | Fresh install by Codex; rerun on exact candidate in CI. |
| 3 Domain/Web interfaces | Implemented, locally verified | API 174 unit, 204 E2E; Web 249 tests, typecheck and eslint clean; Python deploy tests 80 (29 skipped on this platform); `test:ci` pass. Ledger status panel now shows worker heartbeat/certificate/failed jobs/backlog age. |
| 4 Historical readers | Implemented | `legacy-ledger-descriptor` (pinned finite baseline) with unit spec; QR/legacy trust cannot be upgraded to organization signatures. |
| 5 Required gates | **Open** | Real three-org Fabric on the isolated instance: 11/11 API→Worker→Fabric scenarios and 30/30 ledger checks pass locally (WSL, Windows host). The Linux-only CI harnesses (`hybrid-fabric.mjs`, browser desktop/mobile, production images, compiled operators) have not run: no Linux Node on this machine. They run on the PR. Skipped tests are not acceptance (the harness fails on pending tests). |
| 6 Migrations/floor/restore | Partly | Policy floor, reviewed-checksum admission and capacity budget tested (Python). Legacy→all-migration rehearsal passes in E2E; production-copy rehearsal and compatible-image recovery **not run**. |
| 7 Fault/load | Done locally | Two Workers drain one backlog exactly once; a crashed Worker lease is reclaimed; 10 clients × 20 care events (200 Pending) on two bindings during a two-peer outage: API p95 741 ms (max 1.3 s), drain 126 s after recovery, 0 dead letters. This is a single-host run without the production quotas; CI repeats it under per-container quotas and records `load.json` in the receipt. |
| 8–12 PR, release, capacity, cutover, observation | **Not started** | Needs approval: push, PR, merge, capacity admission, production backup and cutover. The 24h server collector is not implemented. |

Fixes made while validating: a spec cast; an impossible org-signer expiry scenario;
Web types for the extended ledger-status and lot DTOs; `AGRI_FABRIC_BIND_ADDRESS`
(WSL2 NAT cannot reach loopback-published ports from the Windows host, so runs on that
setup opt into `0.0.0.0` on a private machine); staged chaincode files made readable by
the image's non-root user under `umask 077`; the CI Fabric suite now sets
`HYBRID_LOAD_E2E=1`, `RATE_LIMIT_REQUESTS=100000` and records the load report.

### Bổ sung kiểm tra cục bộ (2026-10-13, cùng commit `44a631a`)

Đã chạy lại bằng Node 24.15.0 + npm 12.1.0 và đều thoát với mã 0:
`npm run check --workspace apps/web` (gồm typecheck, test, `lint:contract`, build),
`check` của `blockchain/chaincode` và `blockchain/gateway`, `test:worker-contract`,
`check:chaincode:standalone`, `api-contract:check` (contract khớp metadata NestJS đã
biên dịch) và `audit:dependencies` (0 lỗ hổng, installed-tree PASS).

Lưu ý môi trường Windows: `npm run` lồng nhau chạy qua `cmd.exe`, không thấy shim bash.
Nếu `PATH` của `cmd.exe` trỏ tới npm hệ thống (khác 12.1), test
`lint:contract` "no invalid peers" báo sai các gói bị `overrides` ghim (postcss, undici,
mysql2, deepmerge-ts, tmp). Đây không phải lỗi mã: đặt npm 12.1 và Node 24.15 lên đầu
`PATH` của `cmd.exe` thì test qua; CI Linux dùng `npm ci` nên không gặp.
