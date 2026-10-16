# Hybrid A/B/C production readiness

Updated 2026-10-14. Follow the owner's
[fresh-install decisions](fresh-install-cleanup-2026-10-13.md), superseding the
previous legacy cutover procedure. One agent, one PR (#95), separate CI/domain/
platform/documentation commits. Merge and deployment are authorized after checks.

## Scope and required gates

Retire the old test application/network into a recoverable encrypted archive.
Provision a fresh database and one hosted three-organization network with
`hybrid-b` (Org1/2) and `hybrid-self` (Org1/3). Do not backfill old users, histories,
proofs or QR. Historical migration bytes stay unchanged; append-only cleanup
refuses an existing business history. API has no signer; Worker receives only
technical Org1 identities. Owner approval keys belong to the operator.

Independent signatures cover cross-organization handover; care/harvest retain
current authentication. Technical Fabric organizations are currently hosted by
the project operator: external partner authority is **NotEvaluated** and one VPS
with one orderer does not provide HA. See the [business acceptance catalogue](hybrid-fabric-chain-owner-plan-2026-10-11.md).

| Area | Required evidence |
| --- | --- |
| Domain | Current scope before write/replay, grants/epochs/versions, atomic journal/domain/trace/outbox, quantity/custody and sealed sensor windows |
| SQL | Fresh migrate, historical migration regression, cleanup refusal on existing data, schema alignment and real DB constraints |
| Web | Original body/key/signature survives response loss, reload, tabs, account change and revocation; real desktop/mobile browser |
| Fabric | Registry/admin approvals, key PoP, dual handover, tamper/scope negatives and real VALID event/proof/history |
| Fault/load | Two workers, stale lease, outage/restart/unknown outcome; 10 clients/200 Pending across two bindings, p95 <=2s and drain <=15min within caps |
| First install | Empty DB, nonempty DB refusal, migration checksum/floor, interrupted migration/promotion recovery, writers closed on failure |
| Network | Immutable images, separate enrollment/TLS CAs, loopback admin ports, TLS chaincode service, persistent CA/MSP/ledger, channel isolation |
| Restore | Consistent encrypted DB/ledger/CA/MSP/config/image archive off-VPS; decrypt/checksums and isolated DB plus ledger restore before replacement |
| CI/CD | Final PR Application/Blockchain/Dependency success; full final-main push CI; immutable publication and matching helper/deployment success |
| VPS smoke | Public Web/API/auth/roles/session/CORS, care/harvest/Lot/consent, signed pickup/arrival/receive, outbox/direct ledger/proof/QR and runtime SHA |

One local heavy DB/Fabric/browser job at a time. Use isolated migrated resources
with ownership and quotas. Compilation, mocks and skipped tests do not replace
real acceptance. Per-run results stay in PR/Issue evidence or local artifacts.

## Delivery and recovery

Disable CD while preparing the server. Verify installed controller generation,
locks, resources and capacity. Back up and rehearse restore, then stop and keep
old resources. Schema-3 installation initializes controller metadata only;
first CD still proves the new DB empty before migration/bootstrap.

Start CLOSED, run VPS smoke within delivery, then open ordinary writes according
to the installed policy. Keep private smoke keys/receipts; an unknown result uses
its original body/key. First-delivery recovery resumes the exact candidate: there
is no previous application to roll back to. Later rollback requires a compatible
verified image. Never restore only DB after ledger commits or erase the journal.

No separate production canary, maintenance time cap, continuous observation
window, minute collector or systemd timer. Keep bounded troubleshooting and smoke
for this delivery. Work ends after final verification/handoff; later support
requires a new request.
