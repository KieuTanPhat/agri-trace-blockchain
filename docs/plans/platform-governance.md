# Quản trị nền tảng

Quyết định tiếp tục triển khai ngày 18/10/2026, trên checkout hiện có và không
commit. Phạm vi vận hành của lần này là stack review local 3001/8082; không phải
quyền phát hành lên production. Source và contract là nguồn đối chiếu trạng thái
hiện hành; bằng chứng từng lần chạy nằm ở artifact local/PR, không nằm trong plan.

## Quyết định đã thực hiện

- P0: kiểm toán append-only, MFA TOTP, maker-checker, kiểm soát tài khoản/tổ chức.
- P1-1/2: dashboard vận hành và hạn chứng thư do Worker quan sát; không giả lập
  hạn Ed25519/vân tay chứng thư chưa có trong schema.
- P1-3: hồ sơ sự cố gửi doanh nghiệp, không ghi thay doanh nghiệp vào lô/trace.
- P1-4: snapshot diễn tập chỉ đọc, có giới hạn số dòng/độ sâu và chỉ báo thiếu.
- P1-5: hộp thư quyền dữ liệu và sự cố riêng tư, mã hóa nội dung; deadline từ
  thời điểm phát hiện, đánh giá nghĩa vụ báo cáo và lưu tham chiếu bằng chứng.
- P2: giữ SYSTEM_ADMIN làm quản trị đầy đủ; thêm PLATFORM_OPERATOR (chỉ đọc
  vận hành/diễn tập), PLATFORM_CASE_MANAGER (hồ sơ sự cố/diễn tập),
  PLATFORM_PRIVACY_OFFICER (hộp thư riêng tư). Không đổi tài khoản hiện hữu.
- UI: tổng quan quản trị dùng bộ đếm API; kiểm định viên có ba mục; sản phẩm là
  tab chỉ xem trong hồ sơ doanh nghiệp. Giữ URL cũ cho liên kết đã lưu.
- Bổ sung audit cho thanh toán mô phỏng, tuần tự hóa lock/login/session và công
  cụ operator xoay khóa mã hóa theo runbook. Không tự chạy xoay khóa production.

Acceptance: PostgreSQL cách ly chứng minh scope/replay/version, ghi chú riêng tư
không lọt audit/journal, deadline và lịch sử không bị đổi, specialist không ghi
nghiệp vụ hoặc cấp quyền, login không vượt khóa đồng thời, rotation dry-run không
ghi và lỗi giải mã không để lại thay đổi dở. Contract sinh từ NestJS; API/Web
lint/typecheck/test/build qua; route và authenticated read trên đúng runtime
review. Không coi các kiểm này là nghiệm thu Fabric hay production.

## Đề xuất riêng: thông báo bảo trì

Thông báo nên là lớp nội dung độc lập với HYBRID_WRITES_MODE do controller quản
lý. Đề xuất bảng announcement gồm ID, tiêu đề, nội dung thuần, startsAt/endsAt,
version và trạng thái hủy; API đọc công khai chỉ trả nội dung trong cửa sổ hiệu
lực. Admin tạo/hủy bằng version/idempotency/MFA và audit cùng transaction; không
có nút mở ghi hoặc thay env từ trình duyệt. Banner phải có thời hạn, dùng giờ
Việt Nam, không nhận HTML/liên kết tùy ý và không cache dữ liệu tài khoản.

Acceptance cần trước khi bật: thông báo sống qua restart; chưa tới hạn/đã hết
hạn/đã hủy không hiện; lỗi API banner không làm mất trang tra cứu; public endpoint
không lộ người tạo hoặc ghi chú nội bộ. Banner không thay response 503, luật
canary, scope, recovery hoặc quyền operator. **Đây là đề xuất, chưa triển khai
điều khiển bảo trì qua UI.** Phạm vi người nhận và quy trình duyệt nội dung cần
được chốt trước khi thêm schema/API.

## Đề xuất loại bỏ và điều kiện thay thế

| Thành phần | Phụ thuộc hiện hành | Điều kiện trước khi gỡ |
| --- | --- | --- |
| Hợp đồng/thanh toán mô phỏng | enterprise-service/pay chỉ chuyển PAID_SIMULATED, ghi audit và xếp hàng email; SYSTEM_ADMIN kích hoạt quyền bằng command riêng | Giữ trạng thái đơn và lịch sử; maker-checker cho duyệt/kích hoạt vẫn là giới hạn đã biết |
| `/iot-simulator` | Route, panel IoT, điều hướng và bài kiểm tra frontend còn tồn tại | Chốt có chuyển thành công cụ dev riêng; kiểm thiết bị/vận hành ở môi trường đích trước khi gỡ |
| SYSTEM_ACTOR/IOT_DEVICE | `trace-evidence.ts` nhận actor hệ thống; presenter dùng SYSTEM_ACTOR; command journal có actor thiết bị | Không xóa mã khỏi kiểm tra lịch sử/proof. Tách vai đăng nhập khỏi actor evidence nếu muốn đơn giản danh mục |

Không xóa dữ liệu hay chức năng trong đợt này khi chưa có quyết định. Số liệu
review không chứng minh một tính năng không được sử dụng trên production.

## Hạn khóa chưa theo dõi

Chưa thêm hạn Ed25519 hoặc hạn cho bản ghi vân tay chứng thư. Nếu triển khai sau,
cần xác định nguồn X.509/Worker cho chứng thư và policy độc lập cho khóa Ed25519;
không backfill ngày giả, không sửa key reference/chữ ký/proof cũ. Phải quyết định
riêng cách từ chối lệnh mới khi khóa quá hạn mà vẫn đối soát được lệnh đã gửi.
