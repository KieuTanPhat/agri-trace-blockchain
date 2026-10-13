# Controlled legacy scope — candidate triển khai 12/10/2026

Phần A/HYB-06 đã có implementation trong nhánh
`feature/hybrid-chain-business-scope`. Cập nhật ngày 13/10: source đã promote
vào migrations `20261013010000_hybrid_business_scope` và
`20261013011000_immutable_ledger_routes`; rehearsal của catalog chính thức, CD
checksum approval, release và nghiệm thu đầy đủ A/B/C vẫn còn. Hai tài liệu
dirty có sẵn khi nhận bàn giao được giữ riêng, không dùng để thay bằng chứng mới.
[Review migration](hybrid-migration-review-2026-10-13.md) ghi checksum/gates hiện hành.

## Hành vi hiện có

- Inventory/check/assignment plan vẫn là read-only. Manifest canonical gắn
  inventory digest, source SHA, environment, operator và owner reviewer riêng.
- Pin runtime ở file tuyệt đối `HYBRID_LEGACY_MANIFEST_PINS_FILE`, schema
  `agritrace-legacy-scope-pins-1`, chứa `pins: [{manifest, digest, plan}]`.
  File không symlink, tối đa 8 MiB, không group/world writable trên Linux.
  Digest manifest/plan được tính lại mỗi lần dùng, không TTL cache quyền.
  File chỉ chứa ID/count/digest/proposal metadata; không private key/token/body.
- Operator SYSTEM_ADMIN đúng ID đã pin mới register/apply, và còn cần server
  flag `HYBRID_LEGACY_APPLY_ENABLED=1`; mặc định đóng. Flag không là consent.
- ORG_ADMIN hiện hành của đúng org nhận xác nhận từng proposal/công đoạn.
  CHAIN_MANAGER đúng owner reviewer xác nhận riêng từng chain. Consent lưu
  grant ID/revision bất biến; revoke/regrant không hồi sinh consent cũ.
- Target phải PREPARING khi apply mới. Root/mapping/assignments/event sidecars
  và org cutover marker commit nguyên tử. Checkpoint giữ actor grants và digest.
  Update một lần nullable chainId giữ nguyên mọi field/version/timestamp khác;
  PostgreSQL microsecond timestamp được giữ bằng INSERT SELECT và trigger.
- Checkpoint `(manifestId, cycleId)` giữ quyết định và digest bất biến; chỉ MAP
  có final mapping duy nhất/non-null chainId, tham chiếu đúng checkpoint. Apply
  UNRESOLVED giữ checkpoint/cutover marker, không khóa vĩnh viễn final mapping.
- Apply kiểm inventory trước/sau; rerun root trả checkpoint cũ. Thay lịch sử
  đã review yêu cầu manifest/review/pin mới. Missing/stale consent trả conflict
  trước mutation; DB trigger tiếp tục bảo vệ cả đường SQL trực tiếp.
- Manifest v1 vẫn đọc được. V2 thêm `supersedes: [{manifestId, manifestDigest,
  cycleId}]` canonical/sorted; pin ngoài DB bao toàn bộ artifact. Register kiểm
  pin trước, root còn unmapped, current review và unknown old apply. Replacement
  MAP giữ nguyên chain đã review; root đã MAP không remap. Supersession append-only
  theo từng root, serialize với apply; checkpoint/consent/journal cũ giữ nguyên.
  Fresh apply/proposal đã superseded bị chặn; positive journal với key/payload
  gốc vẫn reconcile bằng quyền hiện hành. Unknown thiếu journal không được né
  bằng manifest/key mới, kể cả record hết hạn.
- Mọi root MAP của target phải có provenance trước activation. Active unresolved
  root của participant chặn activation. Cutover marker không sửa/xóa được;
  membership revoke/profile suspend không mở lại đường legacy của root/party.
- Bridge CommandCommit protocol 1 giữ tương thích actor nghiệp vụ/creation replay;
  protocol 2 thêm reviewer/device authority. Chỉ đọc positive journal, giữ journal/
  record cũ và thêm sidecar bất biến. Requester/key/request hash/current session/
  grant/manifest đều được kiểm dưới transaction lock. Grant phải khớp snapshot lúc
  cutover. PROCESSING không có journal không execute lại, kể cả đã hết hạn.
- SQL list/count/direct resource policy chỉ chấp nhận legacy mapping khớp pin
  ngoài DB. Withdraw/malformed pin chặn đọc/ghi/replay trong phạm vi bị ảnh hưởng.

## API và Web

Contract lấy từ NestJS Swagger/generated OpenAPI, không chỉnh generated types
bằng tay. Các endpoint candidate dưới `/api/legacy-scope/manifests/:manifestId`:

| Endpoint                     | Quyền và kết quả                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| POST `/register`             | Pinned operator + apply flag; lưu artifact đã kiểm và journal                                                |
| GET `/proposals`             | Chỉ proposal đúng party hoặc owner reviewer; nhãn chain/subject, digest và PENDING/CONFIRMED/REVIEW_REQUIRED |
| POST `/confirm`              | `proposalKey`, đúng party/current grant; Idempotency-Key bắt buộc                                            |
| POST `/roots/:cycleId/apply` | Pinned operator + apply flag; Idempotency-Key, immutable checkpoint                                          |

Permission context chỉ đưa link manifest mà actor hiện hành có quyền xác nhận.
Web có trang `/supply-chains/legacy/:manifestId`, yêu cầu từng công đoạn riêng,
hiển thị consent đã ghi nhận và consent cần review lại. Đổi auth scope/manifest
bỏ response cũ. Manual refresh giữ identity của request đang chưa rõ kết quả.
Web candidate đã có recovery ledger theo user/org cho các command được allowlist:
original body/key được lưu trước write, named Web Lock serialize các tab, inspect
quyền hiện hành trước retry/replay. UNKNOWN không renew key; known rejection cho
restart chủ động. Terminal metadata bỏ body/result, không replay private cache.
DataForm/ActionPanel có thao tác recovery, nút nằm trong modal khi cần. Endpoint
auth/password/signing key/device ingestion không vào ledger này. Bảy nhóm browser
trên app + DB thật đã đạt tại `5bc74773`; đây là regression
đại diện, không thay toàn bộ UI/Fabric/release acceptance. Mobile dùng Chromium
iPhone 13 viewport/touch emulation; Safari/iOS thật vẫn chưa được kiểm.

API candidate có `POST /api/command-requests/status`: header Idempotency-Key
là key gốc, body gồm operation và payload gốc đã chuẩn hóa. Endpoint kiểm JWT,
record lock rồi current scope/grant/session dưới cùng transaction. Trả
NOT_FOUND/PROCESSING/COMMITTED/REJECTED/RECONCILIATION_REQUIRED; không execute
command, renew expiry hoặc tạo key mới. Positive journal thắng response cache;
expired PROCESSING thiếu journal vẫn cần đối soát. Legacy positive journal khác
scope còn phải qua versioned bridge và độc lập pin. Consent đã commit có thể
reconcile sau activation chỉ với key/payload gốc và grant hiện hành; fresh hoặc
regranted consent không dùng đường này.

## Cách kiểm trong DB riêng

1. Dùng DB PostgreSQL test mới local/runner cách ly, theo
   [migration/release plan](plans/hybrid-migration-and-release-2026-10-13.md).
   Fresh DB dùng toàn bộ catalog chính thức. Rehearsal legacy chuẩn bị qua
   migration business/legacy scope, ghi fixture writer cũ rồi áp route migration
   để seal đúng tập preexisting events. Không apply các draft đã gỡ hoặc dùng DB chung.
2. Với `HYBRID_DRAFT_TESTS=1` và `TEST_DATABASE_URL` là DB đó, chạy
   `npm run db:check:alignment --workspace apps/api`. Đây là kiểm chỉ đọc;
   tuyệt đối không execute SQL do migrate diff sinh.
3. CLI read-only dùng `node --import tsx apps/api/scripts/hybrid-legacy-inventory.ts`
   với mode `inventory`, `check` hoặc `plan`. Path artifact tuyệt đối; mode
   check/plan còn cần independent manifest digest và source SHA, plan cần output
   path mới. CLI không tự cấp quyền, xác nhận hoặc apply.
4. Provision đúng owner/member/capability/grant trên DB cách ly; tạo/review/pin
   artifact ngoài DB. Register bằng operator; owner và mỗi bên xác nhận qua API.
   Apply từng root, kiểm provenance/hash/QR/outbox/proof/journal trước activation.
5. Chạy `npm run test:hybrid:db --workspace apps/api`, rồi toàn bộ legacy E2E.
   Gắn kết quả với exact SHA/archive/SQL checksum và kiểm cleanup resources.

Table SHARE ROW EXCLUSIVE giữ snapshot lúc register/apply chặn writer/worker
đổi các bảng history; operational pause, backup và rehearsal vẫn là cổng riêng.
120 giây là giới hạn transaction apply hiện có, không dùng để nới suite timeout.

## Review test và giới hạn evidence

Fixture mới ở `test/support/legacy-scope-fixture.ts` tạo ba party chưa cutover,
owner có membership ACTIVE, hai cycle đã PLANTED trước harvest, ba harvest/Lot/Shipment/QR, sáu trace/
outbox và ba **synthetic** proof rows. Proof rows này chỉ kiểm preservation;
không phải Fabric commit hoặc authority của doanh nghiệp thật.

Suite `legacy-scope.hybrid-db-spec.ts` kiểm distinct consent, multi-harvest,
hash/inventory và microseconds, incomplete activation, history drift, JWT thật,
projection privacy, commit nhưng mất response, retry cùng key, concurrent apply,
resume và revoked session. Commit `0ac761a8` đã đạt PostgreSQL 18 cách ly: 130
API unit, 30 SQL assertions, full schema diff zero + 6 unique guards, ORM,
80 policy/HTTP/DB (23 nhóm HTTP) và 112 legacy E2E; cleanup container/network/
process đã kiểm. Evidence và audit tiếp theo nằm trong
[targeted audit](plans/hybrid-targeted-audit-2026-10-12.md). Kết quả này không áp
dụng cho schema/cleanup mới chưa chạy lại.

Các failure fixture expiry và revoke owner được sửa tiền điều kiện; constraint
expiry và owner vẫn giữ. Missing-consent HTTP mới đòi conflict có trạng thái
FAILED rõ thay vì coi mọi SQL exception là đúng; guard SQL vẫn bắt bypass.

Candidate `cab1cf5b5da8e0373646e64a5a0640f06ab9f1ac` đạt 147 API unit, 31 SQL,
zero full Prisma diff + sáu unique guards, ORM, 132 policy/DB (26 HTTP groups),
112 legacy E2E và cleanup đầy đủ. Bao gồm bridge reviewer/device/creation,
controlled route import và snapshot preservation; synthetic proof/mock adapter
không là Fabric acceptance. Browser `5bc74773cbadc845ea53485e6f8977a123844baf`
đạt bảy nhóm lost-response/reload/tab/consent/regrant/unknown/account isolation;
cleanup đầy đủ. Các receipts cụ thể nằm trong
[review migration](hybrid-migration-review-2026-10-13.md).

Còn phải hoàn tất: fresh/legacy-copy rehearsal bằng catalog chính thức; backup/
restore + compatible scope/route-aware image rollback; independent deployment
pins; exact-SHA CI/images/production canary/observation. Không còn dev target. B/C,
binding router, ledger permission barrier và chữ ký doanh nghiệp vẫn theo
[kế hoạch tiếp tục](plans/hybrid-recovery-and-completion-plan-2026-10-12.md).
