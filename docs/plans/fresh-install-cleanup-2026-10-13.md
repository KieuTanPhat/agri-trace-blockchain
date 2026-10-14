# Cài mới production và dọn mã tương thích dữ liệu cũ

Kế hoạch thực hiện được chủ dự án giao ngày 13/10/2026. Phạm vi là PR #95,
CI/CD thành công và production tại `agritrace.dev` chạy bản Hybrid mới.
Chủ dự án đã cho phép Agent commit/push, merge, triển khai VPS và hoàn tất
các thao tác trong kế hoạch; không yêu cầu một vòng phê duyệt mới cho mỗi pha.

## Quyết định và phạm vi

- Dữ liệu DB/Fabric hiện có đều là test. Tạo DB và một mạng Hybrid mới,
  không backfill lịch sử, tài khoản, proof hoặc QR cũ vào nghiệp vụ mới.
- Một mạng có các channel cách ly theo nhóm hợp tác. Bàn giao khác tổ chức
  dùng chữ ký Ed25519 hai bên; care/harvest giữ xác thực hiện hành.
- Giữ một PR, một Agent thực hiện; commit tách CI, domain/migration,
  controller/bộ cài và tài liệu. Giữ thay đổi ở checkout khác nguyên trạng.
- Giữ migration đã phát hành/áp dụng bất biến; thêm migration cleanup mới.
  Không squash, không thay `family_id` hoặc bỏ sensor reconciliation để làm đẹp.
- Khôi phục phải được kiểm chứng trước thay đổi dữ liệu production. Chỉ thao tác
  resource có ownership/target rõ, không prune rộng hoặc reset DB dùng chung.
- Không giới hạn thời gian cài VPS trong 2 giờ; ưu tiên correctness và kiểm thử.
- Không có giai đoạn canary riêng trên production. Sau deploy chạy smoke thực
  API/Web/auth/role/domain → outbox → Fabric commit → proof/QR; lỗi giữ ghi đóng.
- Không có cổng quan sát 24 giờ, collector mỗi phút hoặc systemd timer.
  Agent kết thúc sau xác minh production mới và bàn giao, không trực vận hành,
  theo dõi website hoặc phản ứng sự cố thường trực sau khi hoàn thành.

## Bất biến và giới hạn trust

Giữ ProductionCycle → HarvestEvent → Lot → Shipment, nhiều harvest/cycle,
một Lot/QR cho mỗi harvest và tối đa một Shipment/Lot. Domain writes, quyền hiện
tại, optimistic version, idempotency/journal, trace và outbox cùng transaction.
Không nâng Admin/Auditor thành business actor; không rehash, đổi route, quantity,
window, proof hoặc command key để che lỗi. Khi binding hợp lệ và Fabric tạm dừng,
Pending là trạng thái trung thực; thiếu binding không được tạo stream fallback.

Mạng hosted được quản lý bởi chủ dự án. Tổ chức giữ Ed25519 của mình; API không
nhận private key. Nghiệm thu bằng tổ chức kỹ thuật không tự chứng minh quyền của
đối tác bên ngoài; mô hình CA/MSP/governance và người ký thật phải được ghi đúng
trong runbook. Không tuyên bố HA hoặc partner authority nếu chưa kiểm chứng.

## Các pha và điều kiện hoàn tất

| Pha | Công việc | Điều kiện qua pha |
| --- | --- | --- |
| 0 | Bảo toàn patch/staged/untracked, xác minh job và runtime/VPS chỉ đọc | Snapshot mã hóa phục hồi được; target/ownership rõ |
| 1 | Sửa CI UAT/browser/fixture; chờ đồng bộ thu hồi quyền trước restore grant | Harness giữ assertion và CI candidate thành công |
| 2 | Migration append-only, guard binding dưới transaction và cleanup API | DB rỗng migrate được; existing-data/checksum mismatch bị chặn; không orphan/fallback |
| 3 | Controller schema 3 hosted-only, first-install/bootstrap, chế độ CLOSED/OPEN và recovery | First install từ state rỗng, crash/resume/rollback floor, manifest/helper checksums được kiểm trên Linux |
| 4 | Bộ cài Fabric production, TLS/CA/identity/channel/caps và backup/restore | Image pin digest; isolated real Fabric/load/restore thành công, không dùng script pilot như bộ cài production |
| 5 | Tài liệu kế nhiệm/AC, contract sinh và cleanup references | Không mất quyết định/AC; không link/file/env mồ côi; generated contract đúng |
| 6 | Full candidate checks và merge #95 | Application/Blockchain/Dependency cùng revision và không required skip/cancel; khóa CD khi chuẩn bị server |
| 7 | Full push CI main, images/bundle, backup nhất quán và cài mới production | Final main SHA/image/helper/migration/governance khớp; DB/mạng mới đúng target |
| 8 | Smoke trên VPS, rà quy trình/lỗi tồn đọng/mã chết và bàn giao | Auth/role/domain/outbox/direct ledger/proof/QR đạt; runtime đúng final SHA; CI/CD success; chỉ xóa mã/file đã chứng minh không còn sử dụng |

API/Web/chaincode/gateway check, SQL/domain E2E trên DB test đã migrate,
API contract, worker-contract, dependency/standalone audit, Python controller
và real Fabric/browser/Linux deployment rehearsal chạy theo vùng ảnh hưởng,
rồi đầy đủ trên candidate cuối. Test bị skip không là bằng chứng acceptance.
PR evidence ghi head/base/checkout SHA; delivery dùng full CI push đúng main SHA.

## Kết thúc và xử lý lỗi

Hoàn tất khi production mới đã qua smoke, CI/CD cuối thành công và có bàn giao
SHA/image digest, migrations/checksums, backup/restore evidence, config/resource
catalog, commands vận hành và limitations. Không cần chờ một cửa sổ quan sát.
Kết quả từng lần chạy ở PR/Issue hoặc artifact cục bộ, không lập báo cáo mới
trong docs. Khi deploy lỗi giữ journal/DB/outbox/ledger và ghi đóng, đối soát
txId/attempt; không restore DB độc lập sau ledger commit. Sự cố sau bàn giao
thuộc vận hành của chủ dự án; Agent chỉ tiếp tục khi có yêu cầu mới.

Theo yêu cầu bổ sung ngày 14/10/2026, sau khi hoàn tất toàn bộ kiểm tra và lưu
bàn giao của lần thực hiện này, tắt máy Windows cục bộ. Đây là bước kết thúc
một lần, không phải lịch bảo trì hoặc yêu cầu cho các lần phát hành sau.
