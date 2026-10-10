# Kế hoạch cutover core UAT — 10/10/2026

Người dùng yêu cầu lập kế hoạch và thực hiện triển khai UAT trong phiên này.
Đây là review của coding assistant, không phải nghiệm thu độc lập hoặc signoff
của các owner AGT. Không triển khai production theo kế hoạch này.

## Baseline đã kiểm tra trên VPS

- Origin: `https://agritrace.dev`, alias `https://www.agritrace.dev`.
- Current: `uat-e786ef52538bff6eb49d09cb238aca0d1183102d`; API/Worker còn ở
  code `8bbf009`, Fabric sequence 2. Không có recovery journal, khóa CD rảnh.
- DB có 8 migration hoàn tất, 49 event, 49 proof, 6 Lot/QR; 49 outbox đều
  COMPLETED, không có công việc đang chờ. Còn hơn 65 GiB đĩa trống.
- Root SSH bằng khóa quản trị đã xác minh; khóa CD vẫn bị forced-command.
  Giữ nguyên workspace Desktop có thay đổi local của người dùng.

## Review và sửa điểm chặn

1. Giữ policy auto migration nguyên trạng. Sáu migration mới gồm session family,
   command journal, compliance assignment, sensor window, compliance correction
   và origin evidence. Trigger, deferred constraint và partial unique index cần
   cutover quản trị; không đưa vào allowlist additive thông thường.
2. QR của sáu Lot cũ phải hiện LEGACY_UNVERIFIED/INTEGRITY_WARNING vì thiếu
   sensor window. Ghi danh sách Lot chính xác trong metadata riêng của release
   cutover. Verifier chỉ chấp nhận legacy sensor rỗng, quantity/state đối soát
   được, từng event proof VERIFIED và toàn bộ hash/receipt/Fabric khớp.
   Release thông thường chỉ kế thừa danh sách này từ current đã xác minh.
3. Chuyển provision role sang Node + Prisma client đã build để chạy trong image
   production không có tsx. CI phải chạy lệnh thật hai lần, created=1 rồi 0.
   Không chạy seed/bootstrap trên dữ liệu UAT hiện hữu.
4. Test regression và tự review diff trước PR; chỉ merge khi toàn bộ checks của
   đúng head đạt. Chỉ dùng artifact/image digest của main sau merge có cả ba
   workflow push CI thành công. Kiểm hash helper/manifest và image revision.

SQL được tự review ở baseline `610a164`; SHA-256 dưới đây tính trên Git bytes
LF. Candidate cuối phải có đúng catalog này; checksum applied cũ được đối chiếu
với biến thể LF/CRLF đã biết, không sửa trong DB.

| Migration | SHA-256 |
| --- | --- |
| `20261009103000_refresh_session_family` | `fb2d6f9d8e1e26d0e407f3532f7d9c4cf9b5a51be346bd09d934a1fb94366059` |
| `20261010100000_command_commit_journal` | `1a0a2668cfdd3a27c462be246c58d39234f7306ca03285542de9382b174bff4a` |
| `20261010110000_scoped_compliance_assignment` | `28a4b4c1b1845145f6fa94dc13668f8bc4bdd293a271b15a18fabd4789895fd3` |
| `20261010120000_harvest_sensor_windows` | `556c18022c61066fe2dd63956698988f54817784302cfcb0042b5dd5fe0ac741` |
| `20261010130000_compliance_corrections` | `5a98c7f9c19f30386b190793da70c490962bb2c8126d6cae5cea5292e6f738a9` |
| `20261010140000_lot_origin_evidence` | `d1fe42da15c808f5ee813eef66619d06d45a452d98ab6a752f6a00863e145bc0` |

## Diễn tập và thứ tự thực hiện

1. Tạo thư mục thao tác root-private. Cài controller từ đúng Git bytes đã review,
   dùng installer có cùng delivery lock. Backup helper/config/authorized_keys
   trước; giữ nguyên origin, identity, certificate và accounts.
2. Dump DB hiện tại sang bản sao có tên riêng, restore và migrate bản sao bằng
   candidate image. Provision role hai lần. Kiểm 14 migration, counts và hash
   dữ liệu bất biến; chạy API bản sao trong Docker network, không public port,
   không Worker ký vào Fabric từ bản sao.
3. Bật maintenance tại proxy nhưng giữ HTTPS và đường probe nội bộ. Dừng mọi
   API/Worker/bootstrap/ingestion writer, kiểm backlog. Ghi journal bền vững;
   chụp backup DB + Fabric ledger + CA/MSP/config nhất quán. Mã hóa, copy offsite,
   kiểm checksum và diễn tập restore DB vào database riêng trước cutover.
4. Nâng chaincode đã build trong artifact từ sequence 2 lên 3, xác minh cả hai
   peer và capability. Apply đúng sáu migration đã review; provision role thiếu.
5. Start API, Worker, Web tương thích trong maintenance. Chạy auth năm role,
   refresh/logout/revocation, canary v3, direct ledger/API proof toàn bộ event,
   entity histories, sáu QR legacy và bảo toàn fingerprint lịch sử.
6. Chỉ promote sau mọi gate đạt: lưu evidence, metadata session family/legacy
   catalog/chaincode, chuyển current, cập nhật state và last-result bền vững.
   Mở proxy bình thường, kiểm apex/www HTTPS, health/login/public QR và outbox;
   hoàn tất journal sau xác minh. Ghi kết quả thực tế cùng SHA/digest/run IDs.

## Phục hồi

Trước khi nâng schema/chaincode, có thể chạy lại ứng dụng cũ nếu baseline còn
khớp. Sau core migration, ứng dụng cũ ghi v2 hoặc thiếu journal/window không
còn tương thích. Không restore DB/ledger live, sửa checksum migration, xóa
outbox, thay hash lịch sử hoặc mở lại app cũ để né gate. Nếu lỗi sau cutover,
giữ maintenance, dừng writers, giữ journal và fix forward từ state hiện tại.
Không đánh dấu core migrations là additive; guard rollback phải tiếp tục chặn
target trước core. Backup dùng để đối chiếu và recovery có kiểm soát, không tự
ghi đè trạng thái live sau khi ledger đã tiến lên.

## Giới hạn nghiệm thu

CI và canary triển khai không thay thế UAT nghiệp vụ đầy đủ, concurrency/fault
injection, camera/offline/install trên điện thoại hoặc owner signoff AGT.
Các mục chưa thực hiện phải được báo rõ trong kết quả, không suy diễn đạt.
