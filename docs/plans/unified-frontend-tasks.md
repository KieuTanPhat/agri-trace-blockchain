# Giao diện quản trị, dịch vụ và ứng dụng nhân viên

Yêu cầu ngày 04/11/2026, nhánh `feature/unified-agritrace-tasks`.

## Phạm vi và cách làm

- Người dùng làm rõ ngày 05/11/2026: được sửa backend phục vụ Web/SePay;
  không sửa backend mobile. Người dùng xác nhận DB nhánh này dùng được và cho
  tiếp tục. Kiểm SePay trên database riêng phục hồi từ ZIP commit `21707c94`,
  không ghi đè database đang dùng hoặc chạy Worker Fabric trên lịch sử sao chép.
- Làm từng task, kiểm tra giao diện task đó trước khi chuyển tiếp. Ưu tiên
  kiểm tra trực tiếp và bộ kiểm tra UI hiện có; hạn chế thêm integration test.
- Khi kiểm UI tự động, dùng API fixture ở trình duyệt, chặn request ra API thật.
  Không dùng thao tác tạo/sửa/xóa trên database hiện tại để kiểm thử.
- Không báo đã thanh toán chỉ vì quét QR hoặc quay về trang. Không báo đã gửi
  mail nếu chưa nhận trạng thái từ hệ thống. Giữ quyền, version và recovery.

## Danh sách công việc

| ID | Yêu cầu và đầu ra | Hiện trạng đối chiếu source | Tiến độ |
| --- | --- | --- | --- |
| UI-01 | Admin quản lý tài khoản người dùng: tìm tên/email, lọc vai/tổ chức/trạng thái, xem chi tiết và dùng thao tác được API cho phép. | Có tìm tên không dấu/email, bộ lọc theo dữ liệu thực, số lượng kết quả, chi tiết tài khoản và trạng thái đổi mật khẩu (không có mật khẩu/hash). Menu chỉ hiện cho SYSTEM_ADMIN/AUDITOR theo API; doanh nghiệp/nhân viên/consumer chỉ tra cứu. Lỗi tải quyền ẩn thao tác, kể cả dữ liệu cũ còn trong cache. Form tạo không có mật khẩu; reset nhập che ký tự. Chỉ chọn tổ chức AUDITOR hoạt động; không gửi tổ chức cũ khi đổi sang SYSTEM_ADMIN. | Đã sửa frontend, 7 kiểm React cho màn tài khoản và tổng 331 test Web đạt, typecheck/lint/image và build Webpack đạt. API local trả 201 login/200 users, không có trường mật khẩu/hash. Đã chuẩn bị tài khoản quản trị và hai tài khoản kiểm định trên DB test riêng. Chờ người dùng kiểm bố cục 1440/390px; Chrome tự động bị host chặn. Chưa commit/push |
| UI-02 | Quản lý gói dịch vụ: một bảng chung, thêm gói, ngừng cung cấp/mở lại, bản nháp/công bố và lịch sử giá. | Đã chuyển `/admin/billing` sang DataTable chung, mỗi gói một dòng; tìm tên/mã không dấu, lọc đang cung cấp/chưa công bố/ngừng cung cấp, chi tiết lịch sử phiên bản. Thêm gói tạo bản nháp v1; trạng thái có xác nhận/lý do và chống quyết định cũ. Hai API Web mới kiểm SYSTEM_ADMIN/idempotency và ghi audit; không đổi schema, không sửa backend mobile. Ngừng cung cấp chặn chọn/gia hạn mới, giữ snapshot, thuê bao và hóa đơn cũ. | 363 unit API, 337 test Web, typecheck/lint/contract/image và build Webpack đạt; 15 kiểm HTTP/DB trên DB test riêng đạt, gồm sai quyền/replay/trạng thái cũ và bảo toàn dữ liệu có trước. Turbopack bị sandbox chặn cổng; Chrome không khởi động được. Web/API test đã khởi động lại; chờ người dùng kiểm giao diện 1440/390px. Chưa commit/push |
| UI-03 | Audit theo loại hành động/người dùng/doanh nghiệp, trình bày ai làm gì/lúc nào/đối tượng nào. Audit dành cho doanh nghiệp chỉ đọc đúng phạm vi được cấp. | Có `/enterprise/audit-log` và API `/enterprise-workspace/audit`. Chỉ chủ doanh nghiệp có quyền quản lý thành viên được đọc; nhân viên hiện thuộc cùng tổ chức và snapshot tổ chức của nhật ký cùng quyết định phạm vi. Gộp thao tác đã commit với sự kiện tài khoản đã ghi, không trả payload/chi tiết nhạy cảm. Tìm nhân viên, lọc thời gian/thao tác/kết quả và phân trang ký theo người xem/tổ chức/bộ lọc. | Đã qua 15 kiểm HTTP/DB test chỉ đọc, 6 unit kiểm scope/phân trang và 4 kiểm UI. Không migrate/seed hoặc sửa lịch sử. Chờ người dùng kiểm giao diện bằng tài khoản chủ doanh nghiệp; chưa commit/push |
| UI-04 | Kiểm tra admin đăng thông báo và khả năng nhìn thấy ở nhà sản xuất/HTX, đúng đối tượng và thời gian hiệu lực. | Có `/admin/notices`, `/enterprise/notices`, banner và `GET /system-notices/active`; API chọn theo audience/capability. | Chưa kiểm giao diện |
| UI-05 | Rà lại đăng ký SMS của ACheck đã có: tìm chỗ ẩn/tắt hoặc không gọi Firebase, kiểm nút đăng ký, lỗi/cooldown/OTP. Không đổi OTP email Web doanh nghiệp. | Người dùng xác nhận phạm vi ACheck. Source có link đăng ký từ đăng nhập, form và Firebase native; plugin chỉ bật khi `EXPO_PUBLIC_CONSUMER_PHONE_AUTH_ENABLED=true`. Profile `development` trong `apps/mobile/eas.json` hiện build `staff` với SMS false; chưa có profile ACheck riêng trong file này. Cần đối chiếu APK thực, không tự bật gửi SMS. | Đã rà source bước đầu; chưa kiểm APK |
| UI-06 | Luồng hợp đồng theo gói: nhập thông tin, xem bản hợp nhất, xác nhận và tải/in PDF. | Đã có thẻ chọn gói/tổng tiền, PDF merge từ mẫu tĩnh, xem/tải trước xác nhận, snapshot hash bất biến, lịch sử các bước, dialog QR trên PDF và mail đính kèm đúng bản. | API 341 unit và 21 kiểm HTTP/DB/PDF/Mailpit đạt; Web typecheck/unit/lint/image và build Webpack đạt; lần build Turbopack cuối bị sandbox chặn mở cổng. Cần người dùng kiểm giao diện desktop/mobile; chưa có mẫu pháp lý chính thức |
| UI-07 | SePay: QR thanh toán và theo dõi kết quả; xác thực webhook, khớp tiền/tài khoản/mã hóa đơn, chống trùng rồi tự kích hoạt dịch vụ theo năng lực đã duyệt; gửi hợp đồng qua mail riêng sau thanh toán. | Đã thêm receipt append-only, callback test/live, checkout theo owner, tự activation và SQL guard; mặc định tắt. Kiểm HTTP/DB thực trên bản sao riêng đã đạt, frontend có QR/polling/cảnh báo đối soát. Mail PDF mới dùng snapshot theo UI-06; hợp đồng cũ giữ nguyên. Xem [hướng dẫn SePay](../sepay.md). | API unit/build, Web check/build và HTTP/DB callback local đạt; đã chuẩn bị tài khoản/hóa đơn chờ thanh toán. Chờ kiểm giao diện trực tiếp vì Chrome tự động bị chặn. Chưa kết nối tài khoản SePay hoặc nghiệm thu nhà cung cấp/production |
| UI-08 | Rà UI app nhân viên theo vai/quyền: công việc, nhật ký, thu hoạch, QR và trạng thái lỗi/hàng đợi. | App staff đã có các màn tác nghiệp. Đăng nhập staff dùng email/API, không dùng OTP Firebase. Kiểm thiết bị thật riêng với kiểm layout trình duyệt. | Chưa làm |

## Nghiệm thu từng task

- Ghi riêng: đã sửa source, đã kiểm trình duyệt với fixture, đã kiểm API thật,
  đã kiểm điện thoại. Không dùng một kết quả để thay cho các bước còn lại.
- Web kiểm desktop và màn hình hẹp, trạng thái tải/rỗng/lỗi, tìm/lọc và thao tác
  liên quan; kiểm quyền theo API hiện có.
- Với payment, phân biệt chưa thanh toán, đang xác nhận, đã xác nhận và lỗi;
  trạng thái gửi PDF/email là một kết quả riêng.
- Evidence từng lần kiểm để ở artifact local được ignore, không đưa tài khoản,
  token, ảnh chứa dữ liệu riêng hoặc cấu hình môi trường vào commit.

### Gmail SMTP cho hợp đồng

SMTP đã có trong Worker; đã cấu hình Gmail local, tách Mailpit thành profile test
tùy chọn và bỏ chuyển tự động thư SMTP sang Mailpit. Có lệnh kiểm TLS/auth không
gửi mail và gửi thử PDF về chính tài khoản gửi; không sửa đơn hàng/lịch sử.
Build/typecheck/lint, 356 unit API và 28 kiểm CI đạt. Gmail SMTP đã xác thực và
chấp nhận một thư TEST có PDF; người dùng đã xác nhận nhận được email. Còn kiểm
mở PDF và test một thanh toán mới trên UI với email nhận thật. Không suy ra production đã nghiệm thu
từ kết quả local này. Cấu hình private và [hướng dẫn gửi mail](../email.md).

### Thứ tự tiếp theo đã thống nhất

Ngày 05/11/2026, người dùng muốn để nghiệm thu SePay cuối cùng và hoàn thiện các
chức năng còn lại trước. Ưu tiên quản lý gói dịch vụ, audit, thông báo theo đối
tượng, rà SMS ACheck và UI nhân viên; quản lý tài khoản đã sửa còn nghiệm thu UI.
Vẫn hoàn tất và kiểm giao diện từng task, không gộp mọi task rồi mới kiểm.

### Bổ sung theo yêu cầu: Quên mật khẩu cho app nhân viên

Người dùng yêu cầu hỗ trợ riêng nhân viên và thêm nút ở login; phạm vi bổ sung
cho phép hai API recovery phục vụ nút này, giữ nguyên ACheck. Đã thêm public
screen, mã email OTP một lần, cooldown, mật khẩu mới/xác nhận và quay lại đăng
nhập. Migration mới đã backup và áp vào DB test sở hữu riêng; kiểm HTTP/DB/SMTP
thực 13 mục đạt, gồm concurrency, code replay, phiên cũ, generic email và chặn
owner. Sau khi tách bước xác minh OTP (6 ô) và mật khẩu mới, API 390 unit và 49 kiểm mobile đạt; 15 kiểm HTTP/DB của luồng hai bước đạt. Người dùng xác nhận đổi mật khẩu nhân viên trên giao diện đã chạy được. Token xác minh chỉ giữ trong bộ nhớ; không lưu OTP/mật khẩu. Hướng dẫn/private account không đưa vào Git.
