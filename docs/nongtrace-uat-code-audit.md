# Rà soát code và UAT nongtrace.site — 09/10/2026

## Phạm vi và baseline

Phát yêu cầu kiểm tra lại lỗi, cấu trúc code, lập kế hoạch và thực hiện sửa.
Baseline code: `5880ef11f2d55886791fefd26e5981074900b83b`.
Baseline UAT: `de3a997c875e6acb6b0c3fd1fbd4f7f483f2ba9c`, HTTPS,
43 trace events/proofs; recoveryRequired=false.

## Kế hoạch thực hiện

1. **P1 — Quyền ghi nghiệp vụ:** AGT-007 (#19) quy định Admin không ghi
   thay actor; AGT-026 (#38) quy định Auditor chỉ đọc. Hiện controller/service
   cycle, harvest, shipment, compliance và user IoT vẫn có quyền trái quy tắc.
   Dùng chung policy role ở controller/service; kiểm đúng role + tổ chức,
   đồng bộ allowedCommands và Web. Giữ Admin quản trị identity/masterdata.
   Inspection/review certificate chưa có actor được duyệt: chặn ghi cho tới
   khi policy AGT-026 được chốt; không tự cấp role mới.
2. **P2 — Projection chứng chỉ:** public trace mới lấy chứng chỉ của Lot,
   bỏ sót chứng chỉ approved+public của cycle chung. Thêm projection allowlist
   cho cả hai subject, không lộ documentRef/reviewNote hoặc chứng chỉ draft.
3. **P2 — Phiên Web:** refresh ghi user mới vào localStorage nhưng không
   báo AuthProvider ở cùng tab; request/header/page chỉ so user ID nên có thể
   giữ dữ liệu cũ khi role/org đổi mà ID không đổi. Đồng bộ context sau rotation,
   loại response cũ theo authorization scope và remount/xóa dữ liệu theo scope.
4. **P2 — Nhập QR:** URL đang được nhận bằng substring `/trace/`, có thể điều
   hướng sai route; lời hướng dẫn nhận mã lô không khớp API token. Chuẩn hóa
   parser token/URL, giới hạn route `/trace/<token>`, sửa hướng dẫn và kiểm edge cases.
5. **Cấu trúc:** tách LotsService đang gộp harvest command, database query,
   presenter, action policy và proof status. Các boundary dùng type rõ ràng,
   giữ transaction/outbox của harvest và projection HTTP hiện có.
   Proof projection phải giữ `BLOCKCHAIN_UNAVAILABLE` khi outbox DEAD_LETTER,
   kể cả có receipt cũ, không cho event mới VERIFIED che lỗi delivery.
6. **Kiểm chứng:** full workspace lint/typecheck/test/build; PostgreSQL e2e
   trên database riêng trong CI; production containers; dependency audit;
   Fabric integration; test role/service âm và projection contract. Sau merge,
   dùng CD có backup/gate để deploy UAT, kiểm HTTPS/login/QR/ledger và quyền ghi.

Issue là acceptance và ownership: #19, #38, #39, #43. Việc sửa và CI đạt
không tự đóng issue hoặc thay xác nhận nghiệm thu. Các feature backlog
markForSale/markSold/OpenAPI đầy đủ được báo riêng theo #36/#22.

## Kết quả

Đang thực hiện; bổ sung SHA, CI/CD và bằng chứng thực tế sau kiểm chứng.
