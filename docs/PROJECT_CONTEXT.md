# Current project context

Updated 2026-10-17 with the local enterprise and distribution extension; the
2026-10-14 hosted Hybrid release limits remain separate. Swagger generated from NestJS is the API contract;
current AGT issues and the approved Hybrid plan define acceptance and ownership.

## Domain

The model is `ProductionCycle → HarvestEvent → Lot → Shipment`. A cycle supports
multiple harvests; each harvest creates its own Lot, QR, quantity movement, sensor
window, trace event and outbox in one transaction. A Lot uses either a single
Shipment (signed handover, transport IoT and shipment plan) or the organization
holdings and multi-line distribution transfers, never both. Each distribution line keeps its original source Lot;
splitting quantities does not create mixed or transformed Lots. Both paths retain
an append-only quantity/custody history. Corrections append new evidence;
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

Processing from external receipts pins its chain/binding on the run rather than
inventing a production-cycle origin. Migration
`20261222000000_external_processing_event_scope` updates the two event scope
guards for this case; cycle-derived events keep their original context checks.
It changes no historical event/hash. An isolated PostgreSQL 18 regression covers
completion/replay, mass-balance rejection, reservation concurrency/cancellation
and correction logs; this does not establish real Fabric acceptance.

The local extension includes five-step v2 registration with conditional legal
profiles, genuine private supporting documents, service preferences, separate
policy acknowledgements, catalog-bound two-level addresses and email OTP.
Producer households/individuals may omit tax identifiers; production supports
CROP only. Collection is deferred by default as of 28/10/2026: unless
`ENTERPRISE_PAYMENTS_ENABLED=true`, admin reviews the enrollment and all
capabilities, then explicitly activates temporary use without a paid plan.
No payment/subscription records are fabricated. Paid-plan creation limits are
deferred; free-participant limits and business authority checks remain.
When collection is explicitly enabled, administrator review precedes service/peer-model selection,
contract preview and simulated settlement. Settlement marks the order
`PAID_SIMULATED` and queues its email; a separate platform-admin activation grants
new business authority before the enterprise can configure a peer. The Worker
delivers OTP/review/contract mail, using the local sink for test recipients and
TLS for configured SMTP. Tier 1/2/3 membership and custom permissions never replace
chain membership, capabilities or accepted assignments. Private screens use a
permission-filtered system manager sidebar. The local service contract and payment
are demonstration artifacts; NAPAS/QR collection and qualified contract signatures
are not implemented. Existing admitted enrollments retain their earlier policy.

New partial distribution remains disabled on DUAL_SIGNED chains pending its own
c2 integration and isolated Fabric acceptance. A local database or browser result
does not establish real Fabric or production acceptance for that new protocol.

Claude baseline `2f132e26dd26270b907a4a4c82070637c6a5536f` implements A chain
scope, B immutable Fabric binding/permission registry and C independent Ed25519
handover signatures. Baseline migrations number 17; the 14 migrations from main
are unchanged. Repairs append migrations rather than changing these inputs.

- A (envelope 3.0.0 / private hash 2.0.0) and c1 are retired: source, chaincode
  and Gateway no longer write or read them, and migration
  `20261213000000_retire_release_a_and_c1` refuses a database that still holds
  them. Every event needs an ACTIVE chain binding.
- B uses envelope 4.0.0 / private hash 3.0.0 and an immutable logical binding.
- New C writes use c2 envelope 6.0.0 / private hash 5.0.0 and intent protocol 2.
  The organization signature binds the business payload digest; ledger validation
  reconstructs the private commitment from payload, metadata and assertion
  digests. API/SQL/Worker require actual business content to equal the signed
  payload. This source change does not establish deployment acceptance on the
  production VPS.
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

Source completion is not production acceptance. Inspect the current Git branch,
worktree and SHA rather than inferring checkout state from this document.
Remaining release safeguards, tests,
restore/recovery and VPS smoke are tracked in
[the current execution plan](plans/hybrid-production-readiness-2026-10-13.md).
Per-run acceptance belongs in PR/Issue evidence and local artifacts. Earlier
receipts are historical and cannot close the final candidate gates.

For Claude Code/Codex task routing and shared workflows, follow
[AGENTS](../AGENTS.md) and [the agent guide](agent-workflow.md). Skills reference
these maintained documents; they do not carry a second business-rule catalogue.

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

## Quản trị nền tảng (P0, 2026-10-18)

Migration `20261029000000_platform_governance` thêm `platform_audit` (nối băm,
append-only), `platform_mfa`, `platform_approval` và các cột version/khóa tạm cho
`app_user`, `organization`. Mã nằm ở `apps/api/src/modules/platform-governance`;
quy tắc ở [business rules](core-business-rules.md). Biến cấu hình mới:
`PLATFORM_SECRET_KEY`, `PLATFORM_MFA_MODE`, `PLATFORM_LOGIN_MAX_ATTEMPTS`,
`PLATFORM_LOGIN_LOCK_MINUTES`. Phê duyệt hai bước đã gỡ (2026-10-25);
`platform_approval` chỉ còn là lịch sử.

P1 bổ sung vận hành chỉ đọc, hồ sơ sự cố và diễn tập thu hồi. Migration
`20261031000000_platform_privacy` thêm hộp thư quyền dữ liệu/hồ sơ vi phạm mã hóa;
`20261101000000_platform_admin_roles` thêm ba vai hẹp cho vận hành, điều phối sự
cố và dữ liệu cá nhân. API không cấp quyền ghi nghiệp vụ cho các vai này.
Xem [quy tắc](core-business-rules.md), [giao diện](frontend.md) và
[plan quản trị](plans/platform-governance.md) để phân biệt phần đã triển khai với
đề xuất bảo trì/loại bỏ còn cần quyết định. Cảnh báo hạn khóa Ed25519/vân tay
chứng thư vẫn ghi rõ dữ liệu chưa được theo dõi; không suy ra hạn từ trạng thái.
