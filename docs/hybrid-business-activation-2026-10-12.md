# Candidate activation và chuyển test sang local — 12/10/2026

Production-only cleanup đã push lên `main@8ae13542aee92b47d7ed64a0d83d560dbb517dc3`,
dev cleanup `6be14c2b6efb1c706454c9619609d44a5ae5f608`. Application CI
38276633302, Blockchain CI 38276633227 và Dependency Audit 38276633201 đạt đúng
SHA main. CD production đã enable/dispatch deploy lúc 16:38:06 UTC sau kiểm
checksum helper khớp source, fingerprint chaincode không đổi, sequence 3 và
delivery/runtime journals clear. Chưa ghi deployment mới là pass trước receipt.

## Activation candidate A

Create-chain transaction tạo profile PREPARING/version 0, membership owner,
grant CHAIN_MANAGER và audit cùng command journal. Owner hiện hành có grant
CHAIN_MANAGER mới activate; SYSTEM_ADMIN hoặc ORG_ADMIN không thay authority đó.
GET business profile trả metadata cho actor có chain access. POST activate dùng
version + Idempotency-Key, khóa scope/current account/session/grant trước replay,
chỉ chuyển PREPARING → ACTIVE/version+1 khi mọi gate đủ.

Activation khóa memberships/organizations và history fence, kiểm active legacy
roots của producer hoặc bất kỳ Shipment partner ACTIVE hiện tại. Root chưa đăng
ký manifest cũng bị chặn; inventory không được suy đầy đủ từ manifest registry.
Final MAP cần provenance/pin ngoài DB; UNRESOLVED, stale consent, chưa apply hoặc
supersession chưa hợp lệ vẫn fail closed. SQL gate giữ cùng điều kiện cho writers
ngoài ORM. Không dùng manual UPDATE để mở production business scope.

Regression bổ sung gồm create PREPARING/activate/replay/status, revoked manager
không replay private result dù còn ORG_ADMIN đọc metadata, active unregistered
partner root chặn và không audit/activate, distinct concurrent keys chỉ một
transition/audit. Fixture đóng historical legacy root trong nhóm inventory;
không đổi root/hash/proof thật. Web normalizer nhận activation command và giữ
đúng original payload/key cho status/recovery. UI activation và recovery queue
qua remount vẫn còn cần hoàn thiện ở commit tiếp theo.

## Test harness và giới hạn evidence

135 API unit, lint/typecheck đạt trên working tree activation trước ba HTTP
regressions mới; các regression DB mới chưa được ghi là pass. OpenAPI được sinh
từ NestJS, 96 operations. Candidate SQL chưa là official migration; không chạy
trên shared dev/production database và không execute alignment diff.

VPS không còn dev/test jobs. Kiểm DB tiếp theo chạy PostgreSQL 18 pinned image
trong Docker Engine WSL Ubuntu local, container/network có label/quota, port
loopback riêng và ephemeral data. Cluster PostgreSQL 16 main trên port 5432 có
sẵn của người dùng giữ nguyên. Không đổi Windows Docker context, production
config hoặc restore/reset user DB để phục vụ test. Windows Node 24.19/npm12
chạy source đã commit; Linux Node 22.22.3/checksum được dùng cho transport tests.
Cleanup phải kiểm ownership, port/process/container/network và giữ logs failures.

Đối chiếu actual suite với kế hoạch: checkpoint/supersession 86 DB scenarios +
3 HTTP activation scenarios, dự kiến 89 policy tests/26 HTTP groups; SQL 31
assertions, alignment zero + 6 unique guards, ORM và 112 legacy E2E. Số dự kiến
không là nghiệm thu. Chỉ gắn kết quả vào đúng SHA đã chạy; A/B/C vẫn chưa hoàn tất.
