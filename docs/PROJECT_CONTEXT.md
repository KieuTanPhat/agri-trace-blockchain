# Current project context

Updated 2026-10-13 for the hosted Hybrid release. This file describes source and
release limits separately. Swagger generated from NestJS is the API contract;
current AGT issues and the approved Hybrid plan define acceptance and ownership.

## Domain

The model is `ProductionCycle → HarvestEvent → Lot → Shipment`. A cycle supports
multiple harvests; each harvest creates its own Lot, QR, quantity movement, sensor
window, trace event and outbox in one transaction. A Lot has one Shipment and
retains an append-only quantity/custody history. Corrections append new evidence;
existing hashed or signed data must not be edited.

Business actions use current account/session/organization, active capability,
membership, grant and accepted assignment. ShipmentPlan revisions and consent
are immutable. Quantity and custody checks run under the aggregate lock; a
permission or optimistic-version rejection must not alter state or outbox.

Compliance reviewers belong to AUDITOR organizations, are assigned to the Farm,
and cannot review their own submission. Public QR hides private data and exposes
integrity, recall, expiry and missing-sensor warnings independently of proof.
`VERIFIED` describes evidence, not product quality or independent certification.

## Hybrid source and release

Claude baseline `2f132e26dd26270b907a4a4c82070637c6a5536f` implements A chain
scope, B immutable Fabric binding/permission registry and C independent Ed25519
handover signatures. Baseline migrations number 17; the 14 migrations from main
are unchanged. Repairs append migrations rather than changing these inputs.

- A uses envelope 3.0.0 / private hash 2.0.0.
- B uses envelope 4.0.0 / private hash 3.0.0 and an immutable logical binding.
- C uses envelope 5.0.0 / private hash 4.0.0; custody on a DUAL_SIGNED shipment
  changes only after matching offer and confirmation. C does not silently fall
  back when signer, registry, peer or orderer is unavailable.
- Hosted A/B/C is the release scope. Signatures cover handover. Care/harvest keep
  current authentication, and the UI must describe that trust level accurately.
- A local three-org pilot proves technical isolation; actual external enterprise
  CA/peer/admin/signer authority remains NotEvaluated.

Source completion is not production acceptance. The current worktree is
`feature/hybrid-production-readiness`. Remaining release safeguards, tests,
restore/fix-forward and observation are tracked in
[the current execution plan](plans/hybrid-production-readiness-2026-10-13.md).
The [Claude acceptance](hybrid-acceptance-2026-10-14.md) is a historical local
receipt, including unsupported npm11 and skipped checks; it is not the final gate.

## Operations

Main is the sole deployment source, through PR review and exact-SHA Application,
Blockchain and Dependency CI. Dev deployment and nongtrace.site remain retired.
The previous production receipt reports cleanup release8ae, channel agritrace
sequence3. Re-read runtime and the migration catalog before rollout.

The new hosted network uses separate channel/MSP/CA/keys/volumes. Never migrate
legacy history or reuse legacy authority. API receives only metadata; Fabric
signing/control identities belong to the Worker/operator with readonly mounts.

After Hybrid SQL apply, the compatibility floor prevents old app rollback.
Recovery holds writers and preserves journal/attempts, using a compatible image
or explicit fix-forward. Restore rehearsal is required; database restore is not
ordinary app rollback. Preserve hashes, keys, failed attempts and backup evidence.

Read [current business rules](core-business-rules.md), [ADR-004](adr-004-hybrid-binding-and-signatures.md),
[Hybrid runbook](hybrid-fabric-runbook.md) and [production runbook](production-runbook.md).
Older business-specification-v1.2/main-integration-audit and retired dev/cutover
documents are dated history, not evidence of the current release.
