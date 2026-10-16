# Current project context

Updated 2026-10-14 for the fresh hosted Hybrid release. This file describes source and
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
are immutable. Consent ghi snapshot grant, membership epoch và capability
revision; finalize từ chối khi bất kỳ giá trị nào đổi (kể cả rejoin hoặc
regrant capability với cùng ORG_ADMIN) và khi consent thiếu snapshot (dữ liệu
trước migration `20261021000000_hybrid_acceptance_epoch`), yêu cầu revision và
consent mới. Quantity and custody checks run under the aggregate lock; a
permission or optimistic-version rejection must not alter state or outbox.

Login creates an independent session family under shared organization/account
authority locks, so business readers do not cause an exclusive-lock queue.
Refresh/logout retain exclusive account locking for family changes; account and
organization disable still wait for those locks and revoke all affected sessions.

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
- New C writes use c2 envelope 6.0.0 / private hash 5.0.0 and intent protocol 2.
  The organization signature binds the business payload digest; ledger validation
  reconstructs the private commitment from payload, metadata and assertion
  digests. API/SQL/Worker require actual business content to equal the signed
  payload. Historical c1 (5.0.0 / 4.0.0) remains readable with stricter content
  checks and unchanged hashes; new c1 writes are disabled. This source change
  does not establish deployment acceptance on the production VPS.
  Custody on a DUAL_SIGNED shipment
  changes only after matching offer and confirmation. C does not silently fall
  back when signer, registry, peer or orderer is unavailable.
- Hosted A/B/C is the release scope. Signatures cover handover. Care/harvest keep
  current authentication, and the UI must describe that trust level accurately.
- A local three-org pilot proves technical isolation; actual external enterprise
  CA/peer/admin/signer authority remains NotEvaluated.
- The enterprise onboarding candidate adds public signup, operator review,
  MANAGED_ORG/SELF_MANAGED_ORG requests and ledger-verified connection probes.
  Admission defaults closed (`ENTERPRISE_ONBOARDING_ENABLED=false`). Signup does
  not grant business access. This v1 uses operator-provisioned networks and an
  exclusive enterprise MSP per network; it does not dynamically admit unlimited
  Fabric organizations. External-host acceptance and production rollout remain
  separate gates; see [the onboarding plan](plans/enterprise-onboarding.md).

Source completion is not production acceptance. The current worktree is
`feature/hybrid-production-readiness`. Remaining release safeguards, tests,
restore/recovery and VPS smoke are tracked in
[the current execution plan](plans/hybrid-production-readiness-2026-10-13.md).
Per-run acceptance belongs in PR/Issue evidence and local artifacts. Earlier
receipts are historical and cannot close the final candidate gates.

## Operations

Main is the sole deployment source, through PR review and exact-SHA Application,
Blockchain and Dependency CI. Dev deployment and nongtrace.site remain retired.
The previous production receipt reports cleanup release8ae, channel agritrace
sequence3. Re-read runtime and the migration catalog before rollout.

The new hosted network uses separate channel/MSP/CA/keys/volumes and a fresh DB.
Migration 20261017000000_hybrid_fresh_install appends cleanup, refuses existing
business history and removes empty historical exemptions. Never migrate legacy
history or reuse legacy authority. API receives only metadata; Fabric
signing/control identities belong to the Worker/operator with readonly mounts.

After Hybrid SQL apply, the compatibility floor prevents old app rollback.
Recovery holds writers and preserves journal/attempts, using a compatible image
or explicit fix-forward. Restore rehearsal is required; database restore is not
ordinary app rollback. Preserve hashes, keys, failed attempts and backup evidence.

Read [current business rules](core-business-rules.md), [ADR-004](adr-004-hybrid-binding-and-signatures.md),
[Hybrid runbook](hybrid-fabric-runbook.md) and [production runbook](production-runbook.md).
The owner authorized merge/deploy after validation. There is no two-hour cap,
separate production canary or continuous observation/agent on-call obligation.
The archived Batch specification and retired cutover receipts are dated history.
