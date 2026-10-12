# Controlled legacy scope — candidate triển khai 12/10/2026

Phần A/HYB-06 đã có implementation trong nhánh
`feature/hybrid-chain-business-scope`. Tài liệu này mô tả source candidate;
chưa có official migration, release hoặc nghiệm thu đầy đủ A/B/C. Hai tài liệu
dirty có sẵn khi nhận bàn giao được giữ riêng, không dùng để thay bằng chứng mới.

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
- Apply kiểm inventory trước/sau; rerun root trả checkpoint cũ. Thay lịch sử
  đã review yêu cầu manifest/review/pin mới. Missing/stale consent trả conflict
  trước mutation; DB trigger tiếp tục bảo vệ cả đường SQL trực tiếp.
- Mọi root MAP của target phải có provenance trước activation. Active unresolved
  root của participant chặn activation. Cutover marker không sửa/xóa được;
  membership revoke/profile suspend không mở lại đường legacy của root/party.
- Bridge CommandCommit protocol 1 chỉ đọc positive journal, giữ journal/record
  cũ và thêm sidecar bất biến. Requester/key/request hash/current session/grant/
  manifest đều được kiểm dưới transaction lock. Grant phải khớp snapshot lúc
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
Reconciliation qua reload/tab cho mọi command còn là gate riêng cần tiếp tục.

## Cách kiểm trong DB riêng

1. Dùng DB PostgreSQL test mới; apply 15 migration hiện có, rồi
   `docs/sql/hybrid-business-scope.draft.sql` và
   `docs/sql/hybrid-legacy-scope.draft.sql`. Không áp draft lên DB dùng chung.
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
owner có membership ACTIVE, hai cycle, ba harvest/Lot/Shipment/QR, sáu trace/
outbox và ba **synthetic** proof rows. Proof rows này chỉ kiểm preservation;
không phải Fabric commit hoặc authority của doanh nghiệp thật.

Suite `legacy-scope.hybrid-db-spec.ts` kiểm distinct consent, multi-harvest,
hash/inventory và microseconds, incomplete activation, history drift, JWT thật,
projection privacy, commit nhưng mất response, retry cùng key, concurrent apply,
resume và revoked session. Các kết quả chạy sẽ được ghi theo SHA; thêm test
không có nghĩa các test đã pass.

Các failure fixture expiry và revoke owner được sửa tiền điều kiện; constraint
expiry và owner vẫn giữ. Missing-consent HTTP mới đòi conflict có trạng thái
FAILED rõ thay vì coi mọi SQL exception là đúng; guard SQL vẫn bắt bypass.

Còn phải hoàn tất: bridge compliance/device/creation coverage và reconciliation;
Web reload/tab/browser/mobile; sanitized-copy/fresh official migration rehearsal;
restore + compatible rollback; CI/images/dev canary/observation đúng SHA. B/C,
binding router, ledger permission barrier và chữ ký doanh nghiệp vẫn theo
[kế hoạch tiếp tục](plans/hybrid-recovery-and-completion-plan-2026-10-12.md).
