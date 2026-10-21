# Current business rules and acceptance boundaries

Updated 2026-10-16. Use current source, SQL guards and generated Swagger for the
implemented API, and current AGT issues for acceptance. The hosted Hybrid release
is still undergoing validation; the rules below are requirements to preserve.

- A current authenticated account and session, organization, capability,
  membership, grant and accepted assignment authorize business actions. Check
  under locks and before replay. Read/list/count/proof/allowedCommands use the
  same scope. Production bootstrap is a private operator action, never a business write permission for Admin.
- Immutable ShipmentPlan revisions require current consent from every relevant
  party; changing a revision or revoking/regranting permission invalidates old
  consent. Finalize and domain changes are atomic.
  Mỗi acceptance lưu snapshot grant (id/revision), chain membership
  (id/version) và capability revision của bên đó. Finalize so lại snapshot dưới
  `lockContext` và trigger `fn_hybrid_plan_state`; suspend/revoke rồi rejoin
  membership hoặc revoke/regrant capability, dù cùng ORG_ADMIN grant, đều làm
  consent cũ mất hiệu lực. Acceptance cũ không có snapshot (trước migration
  `20261021000000_hybrid_acceptance_epoch`) không bao giờ finalize được: cần
  revision mới và consent mới; không sửa acceptance lịch sử.
- Idempotency-Key identifies the original normalized command body. Keep the
  original body and key for retries and inspection. A positive immutable journal
  can prove commit; PROCESSING/UNKNOWN without that proof cannot execute again,
  switch key or be rewritten to pass a gate. Status inspection never executes.
- Each harvest creates a Lot and sealed sensor window. The first interval is
  [plantedAt, cutoff], later intervals are (previous cutoff, cutoff]. NO_DATA is
  explicit count0/hashnull; late readings remain separate. Never rehash history.
- Quantities use decimal arithmetic, at most three fractional digits. Movement
  history must agree with available quantity; mismatch blocks writes. Shipment
  and Lot optimistic versions are checked together when both are involved.
- Farmer damage is before Shipment; transporter damage is during IN_TRANSIT;
  retailer damage is after ARRIVED. Receiving requires received>0 and reconciles
  received plus new damage with available. Rejection cannot subtract twice.
- Recall/expiry preserve actual custody. FAILED does not imply goods returned to
  the farmer. A missing or contradictory custody history blocks commands.
- Compliance reviewer independence applies across correction/submission history.
  Public certification is APPROVED, public, valid and not superseded by another
  approved record. Evidence verification and quality certification are separate.
- Business calendar dates use Asia/Ho_Chi_Minh. Expiry prevents sale after the
  recorded expiry date even before an expiry event. Do not invent missing dates.
  Business timestamps require an explicit timezone, millisecond precision and
  valid ordering; reject impossible/future instants.
- B captures an immutable binding/authority/permission epoch on each event.
  Registry permission confirmation precedes writes; revoke has drain/barrier or
  immediate emergency hold. Stale leases/epochs cannot overwrite newer state.
  Unknown delivery is reconciled/fenced, never redirected to another destination.
- C verifies an independent organization key and intent binding to actor, chain,
  event/entity, payload, nonce, expiry and expected versions. Intent is single use.
  DUAL_SIGNED custody changes only after matching offer and confirmation; reject,
  cancel and expiry preserve custody. Same-org confirmation is labelled internal.
- Historical migrations and archived events keep their original bytes/hash/txId/
  channel/proof/QR trust. Fresh production imports none of this business history.
  Cleanup refuses existing business data or historical route exemptions; it never
  rewrites hashes. New streams require an ACTIVE binding at cycle creation and
  cannot fall back to a technical legacy stream when binding metadata is missing.
- Public and authenticated readers fail closed for unsupported versions or scope.
  Show recall/expiry/integrity/missing-sensor warnings alongside proof state.
- API contains no signer private key. Web signer retains a non-extractable device
  key and original signed command until outcome is known. Signer outage cannot
  downgrade a C shipment to an unsigned custody transfer.

Release tests must exercise these invariants on the exact candidate, including
concurrency, restart, restore and direct ledger verification. See
[the current release gates](plans/hybrid-production-readiness-2026-10-13.md).

## Production cycle command matrix

Giữ mô hình ProductionCycle → HarvestEvent → Lot. Matrix dưới đây ghi nhận
implementation hiện hành; chủ task xác nhận giữ hành vi care/sensor ngày
2026-10-21, còn chờ Phát nghiệm thu. BR-07 trong đặc tả Batch đã archive không
phải quy tắc chuyển trạng thái cho ProductionCycle.

| State trước | Command | State sau | Version |
| --- | --- | --- | --- |
| Chưa có | create | CREATED | 0 |
| CREATED | plant | PLANTED | Bắt buộc version hiện tại, tăng 1 |
| PLANTED/GROWING | care | GROWING | Bắt buộc version hiện tại, tăng 1 |
| PLANTED/GROWING | sensor reading | Giữ nguyên | Không nhận/tăng cycle version; khóa aggregate |
| PLANTED/GROWING | harvest | Giữ nguyên | Không nhận cycle version; tăng 1 dưới khóa aggregate, kiểm tổng sản lượng |
| PLANTED/GROWING | close | COMPLETED | Bắt buộc version hiện tại, tăng 1 |
| CREATED/PLANTED/GROWING | cancel | CANCELLED | Bắt buộc version hiện tại, tăng 1 |
| COMPLETED/CANCELLED | plant/care/sensor/harvest/close/cancel | Từ chối | Không thay đổi |

Actor ghi là tài khoản hiện hành có FARM_STAFF grant, capability, membership
và accepted production assignment đúng chuỗi/tổ chức; create kiểm farm thuộc
tổ chức và quyền tạo trong chuỗi. Admin/Auditor không ghi thay. Sensor ingestion
bằng thiết bị đi qua quyền thiết bị và cùng boundary cycle. Policy được kiểm
trong transaction và trước replay; trái quyền trả 403. Transition sai state hoặc
stale version trả 409. Sensor raw bị chặn state ở precheck trả 422, nếu state
đổi trong lúc chờ khóa trả 409. Replay đúng key/body giữ kết quả đã commit,
không thực thi lại transition. API không có endpoint patch state tùy ý và DTO
không nhận currentState.

Create/plant/care/close/cancel và harvest ghi trace/outbox cùng transaction với
domain/journal. Raw sensor chỉ ghi off-chain; digest/window mới được anchor.
FE tại `apps/web/src/app/production-cycles/page.tsx` dùng canWriteProduction từ
API cùng state để hiện command; server vẫn là nơi quyết định quyền/version.
Matrix không thay xác nhận quyền AGT-007 hoặc nghiệm thu AC-03/04/05/24/26 của
Tuấn/Phát; cần evidence đúng SHA và môi trường.
