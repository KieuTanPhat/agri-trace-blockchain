# Kế hoạch và review triển khai HTTPS UAT nongtrace.site

Phạm vi được Phát xác nhận trong phiên làm việc ngày 08/10/2026: kiểm tra sâu
CI/CD, sửa lỗi, merge PR #63 và triển khai UAT cho `https://nongtrace.site`.
Release approval riêng của AGT-031 đã được cung cấp trong yêu cầu này.

## Kết quả rà soát trước cutover

- Ba CI của candidate trước review (`5eba882a1cc497b455b487508f03b58a204326b4`)
  đạt. Các lượt CD deploy, rollback, redeploy, upgrade và recover của runtime
  `dbeb65b83023d0631f1ae0943253139fcf94873d` đã đạt; xem
  [báo cáo CD](contabo-cd-status.md).
- Kiểm tra trực tiếp runtime trước thay đổi: năm role, 41 events/proofs qua
  Fabric, sáu QR VERIFIED; helper cài trên VPS khớp manifest của runtime.
- HTTPS readiness chỉ kiểm tên miền gốc. Đã sửa để cả apex và `www` phải trả
  HTTP 200 với TLS được xác thực trước promote, đồng thời ghi đúng phase lỗi.
- Installer cập nhật origin/helper chưa giữ khóa delivery. Đã thêm khóa Linux
  flock dùng chung với CD; từ chối cập nhật khi có deploy hoặc recovery journal.
- Đã mở rộng verifier kiểm CORS cho danh sách origin của release, từ chối origin
  ngoài danh sách, refresh/logout và các assets PWA. Không đưa token/password
  hoặc danh tính người dùng vào evidence công khai.
- Đã thêm regression tests cho readiness apex/www, khóa installer và việc quay
  lại origin/CORS HTTP của release cũ. Dùng Linux CI để chạy cả các tests cần
  flock, directory fsync và SSH transport.

## Trình tự thực hiện

1. Chạy policy/controller/installer/transport/CI gate tests; kiểm source/diff
   và chờ cả Application CI, Blockchain CI, Dependency Audit của SHA mới đạt.
2. Kiểm A/CNAME trên authoritative và resolver công khai, không tạo AAAA.
   Mở TCP 443, giữ TCP 80; dùng listener tạm để kiểm đường TCP từ ngoài trước
   khi Caddy của candidate chạy, sau đó dừng đúng listener đó.
3. Đóng gói helper từ Git bytes của candidate đã kiểm. Giữ bản helper/config
   hiện hành trong thư mục private. Cài helper và update-origin bằng installer
   khi không có CD đang chạy; kiểm manifest hashes và origin không lộ secrets.
4. Cập nhật cả repository/environment variable `UAT_PUBLIC_ORIGIN` thành
   `https://nongtrace.site`. Merge PR #63 với expected head SHA đã kiểm.
5. Chờ ba push CI của đúng merge SHA; CD chỉ publish/deploy SHA main đó.
   Giữ immutable image digests, snapshot mã hóa và kiểm migration trước rollout.
   PR này không thêm migration hoặc thay code/fingerprint chaincode.
6. Kiểm HTTPS apex/www từ ngoài, HTTP redirect của domain, API/Worker readiness,
   năm role login/me, refresh/logout, CORS, QR/timeline, direct ledger và canary.
   Xác nhận `recoveryRequired=false`, tải backup mã hóa và kiểm checksum.
7. Ghi SHA, digests, CI/CD URLs, chứng chỉ và kết quả vào báo cáo bàn giao.

## Review sau cutover

Deploy HTTPS, rollback về bản HTTP và redeploy cùng SHA `b80354e` đều đạt.
Backup mã hóa đã giải mã/kiểm checksum; PostgreSQL copy khớp 42 event/proof
fingerprints và chạy migration bằng candidate image thành công.

Kiểm giao diện phát hiện header trang QR ở 320 px cắt tên sản phẩm: ảnh giữ
125 px trong flex row, phần chữ còn 95 px nhưng cần 135 px. Sửa CSS scoped của
trang trace: xếp ảnh/nội dung dọc ở breakpoint điện thoại, cho tên/mã dài xuống
dòng. Thêm regression tests cho các declarations, chờ ba CI và CD đúng SHA,
sau đó đo lại title overflow trên browser tại 320/390 px. Đây là bổ sung vào
release HTTPS; không thay API, migration hoặc chaincode.

## Phục hồi và điều kiện hoàn tất

CD rollback khi candidate không đạt. DB, outbox và ledger được bảo toàn;
không reset/seed/restore dữ liệu để làm kiểm tra đạt. Release HTTP trước cutover
vẫn truy cập được qua IP khi rollback; các QR cũ dùng IP được kiểm riêng.

Hoàn tất khi candidate đúng SHA qua ba CI, CD/backup đạt, cả hai tên miền có TLS
hợp lệ, verifier và kiểm tra bên ngoài đạt, không có recovery journal hoặc lỗi
chưa xử lý thuộc phạm vi cutover. PWA assets/secure context có thể kiểm bằng
trình duyệt; việc camera thực tế và cài PWA trên điện thoại cần thiết bị có camera.

Các khoảng cách nghiệp vụ trong PROJECT_CONTEXT và các AGT Issue khác giữ
acceptance riêng. Báo cáo này không thay thế nghiệm thu của reviewer.
