# Thanh toán dịch vụ qua SePay

Phạm vi: backend Web, hóa đơn/gói dịch vụ và giao diện doanh nghiệp. Không đổi
đăng nhập, SMS hoặc endpoint tác nghiệp của ứng dụng mobile.

## Luồng

1. Hồ sơ được quản trị duyệt, các năng lực được xét. Chủ chuỗi chọn gói,
   nhập tên/email/địa chỉ thanh toán, xem và xác nhận snapshot hợp đồng.
2. Hóa đơn lấy số tiền VND từ phiên bản giá trên máy chủ. Trang
   `/enterprise/service/payment` đọc `GET /enterprise-service/payment/sepay`.
   Thanh toán hóa đơn cụ thể/gia hạn đọc
   `GET /enterprise-billing/invoices/:id/sepay`. Chỉ chủ hồ sơ trong đúng tổ chức
   được đọc; không đòi quyền tác nghiệp trước khi dịch vụ được kích hoạt.
3. QR chứa tài khoản nhận, số tiền và mã hóa đơn không dấu gạch:
   `AGT-2026-000001` → `AGT2026000001`. Không dùng tổng tiền do trình duyệt gửi.
4. SePay gọi `POST /payments/sepay/webhook/test` hoặc `/live` theo cấu hình.
   Chọn xác thực API Key: `Authorization: Apikey <SEPAY_WEBHOOK_KEY>`; callback
   không nhận Bearer token của người dùng và không yêu cầu Idempotency-Key giả.
5. Máy chủ kiểm tiền vào, ngân hàng, tài khoản/VA, mã hóa đơn duy nhất, số tiền
   bằng đúng hóa đơn và ngày giao dịch trong kỳ cho phép. Thiếu/thừa tiền, sai mã,
   hồ sơ chưa sẵn sàng hoặc hóa đơn đã xử lý được giữ để đối soát, không tự cộng kỳ.
6. Receipt, thanh toán, thuê bao, trạng thái hợp đồng, quyền đã được duyệt,
   audit và mail outbox commit trong một PostgreSQL transaction. Receipt
   `(mode, transactionId)` chống gửi lặp; cùng ID khác nội dung bị từ chối.
   SQL kiểm kích hoạt tự động có đúng receipt/hóa đơn tương ứng lúc commit.
7. Chỉ trả chính xác `{"success":true}` sau khi commit. Trình duyệt đọc lại
   trạng thái mỗi 3 giây khi đang chờ, dừng khi đã thanh toán. Không có nút
   “đã chuyển khoản” tự cấp quyền. Kết nối blockchain vẫn có tiến độ riêng.

Test mode ghi `SIMULATION`/`PAID_SIMULATED`, không tính là tiền thật. Live ghi
`SEPAY`/`PAID`; không đổi lịch sử thanh toán mô phỏng thành thật. Thanh toán thật
không biến hóa đơn mô phỏng hiện có thành hóa đơn điện tử đã phát hành.

## Cấu hình thử nghiệm

Giữ mặc định `SEPAY_MODE=disabled`, `ENTERPRISE_PAYMENTS_ENABLED=false` nếu chưa
thiết lập. Chạy API thử trên DB riêng đã áp migration mới; không dùng tài khoản
ngân hàng thật trong QR của môi trường test.

```dotenv
ENTERPRISE_ONBOARDING_ENABLED=true
ENTERPRISE_PAYMENTS_ENABLED=true
ENTERPRISE_PAYMENT_SIMULATION_ENABLED=false
SEPAY_MODE=test
SEPAY_BANK=Vietcombank
SEPAY_ACCOUNT_NUMBER=YOUR_TEST_ACCOUNT
SEPAY_ACCOUNT_HOLDER=AGRITRACE TEST
# Tự sinh khóa ngẫu nhiên riêng tối thiểu 32 byte; chỉ đặt ở API và SePay.
SEPAY_WEBHOOK_KEY=YOUR_PRIVATE_RANDOM_WEBHOOK_KEY
```

Trong SePay: bật **Test mode**, tạo tài khoản ngân hàng test, tạo webhook trỏ tới
URL API công khai `/api/payments/sepay/webhook/test`, chọn **API Key** và nhập cùng
khóa. Tạo mẫu mã thanh toán tiền tố **AGT**, hậu tố số dài **10–26** ký tự. Mô phỏng
giao dịch tiền vào với đúng số tiền/nội dung hiển thị trên trang. Localhost không
nhận webhook từ Internet; cần URL HTTPS thử nghiệm/tunnel cho callback thật từ
SePay. Không mở API key vào biến `NEXT_PUBLIC_*` hoặc bundle trình duyệt.

`SEPAY_BANK` cần khớp `gateway` của webhook và mã ngân hàng được công cụ QR nhận.
VA chính thức có thể đặt `SEPAY_VIRTUAL_ACCOUNT`; callback phải khớp subAccount.
VA dùng nội dung TKP và quy tắc ngân hàng riêng như SEVQR chưa được tự suy ra;
phải đối chiếu cấu hình nhà cung cấp trước khi dùng. Test mode bị từ chối khi
`NODE_ENV=production`. Khi chuyển sang Live, dùng khóa/tài khoản và callback Live
riêng, đối chiếu hợp đồng, mail, thuế và nghiệm thu thanh toán thực trước phát hành.

## Kiểm tra và giới hạn

- Unit kiểm cấu hình đóng, xác thực, số tiền/ID nguyên an toàn, ngày giờ, mã
  hóa đơn và QR. Kiểm HTTP/DB trên bản sao riêng phải bao gồm sai khóa, sai tiền,
  sai tài khoản, gửi lại đồng thời, activation trước/sau thanh toán và mail một lần.
- Web kiểm QR/trạng thái đang chờ, refresh tự động sau callback, khoản cần đối
  soát và ghi rõ thử nghiệm; kiểm desktop/mobile trước khi chốt task.
- Worker gửi mail riêng sau commit, đính kèm **đúng PDF đã xem/xác nhận**. Mailpit
  là hộp thư local tùy chọn; [Gmail SMTP](email.md) cần App Password và nghiệm thu
  gửi/nhận PDF riêng. Hợp đồng
  cũ không có PDF vẫn giữ nội dung/attachment HTML lịch sử, không tạo lại giả mạo.
- Bản sao database không bao gồm Fabric ledger/signing keys. Không chạy Worker
  Fabric trên bản dump để giả định lịch sử của network gốc đã được khôi phục.
- Callback mô phỏng bằng fixture local kiểm implementation; không chứng minh
  đã kết nối tài khoản SePay, nhận webhook sandbox chính thức hoặc thu tiền thật.

Nguồn chính thức: [Tích hợp webhook](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook),
[API Key](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc),
[Test mode](https://developer.sepay.vn/vi/sepay-webhooks/test-mode/bat-dau-nhanh),
[Mã thanh toán](https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan),
[VietQR](https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code).

## Chọn gói → PDF → popup thanh toán

Các thẻ gói là lựa chọn radio có tổng phí/hạn mức cập nhật ngay. `POST
/enterprise-service/preview` giờ là command idempotent: merge doanh nghiệp,
người đại diện, MST, thông tin thanh toán và gói vào mẫu PDF tĩnh đã có sẵn,
lưu snapshot riêng tư có hash/version và hạn xác nhận 30 phút. Refresh khôi phục
bản xem trước chưa hết hạn. Giá, thông tin và digest thay đổi thì cần xem lại.

`GET /enterprise-service/documents/{kind}/{id}` trả PDF base64 trong envelope
riêng tư, chỉ chủ hồ sơ được đọc, không có token/download URL công khai. Web tạo
Blob để xem/tải; thu hồi URL khi đổi tài khoản hoặc rời màn hình. Bản xác nhận
copy nguyên bytes/hash vào order; các bản cũ không bị ghi đè. Mẫu nằm ở
`apps/api/assets/contracts/service-test-v1.pdf`, nguồn authoring ở
`scripts/contracts/build-template.py`; đây là **mẫu kiểm thử**, cần mẫu được duyệt
trước thương mại.

Xác nhận mở dialog QR trên nền PDF có lớp mờ. Chỉ callback hợp lệ từ máy chủ mới
hiển thị thành công; đang chờ/đang kiểm tra, cần đối soát, lỗi và thử lại có trạng
thái riêng. Đóng dialog không hủy hợp đồng, mở lại hoặc refresh tiếp tục hóa đơn
cũ. Tương thích deep link payment và thanh toán mô phỏng local khi chỉ bật cơ chế cũ.

`GET /enterprise-service` có lịch sử chỉ đọc theo tổ chức/chủ hồ sơ: chọn gói,
lập PDF, chấp nhận, xác nhận thanh toán và kích hoạt (không mở quyền đọc toàn bộ
platform audit). Mail outbox giữ nguyên PDF/hash, worker gửi MIME application/pdf;
Web chỉ báo đã gửi khi outbox thực sự SENT.

Migration `20270101000010_service_contract_pdf` là additive: giữ hợp đồng cũ,
preview append-only, guard PDF/hash, snapshot order/mail bất biến. Dừng writer cũ
trước khi triển khai migration/API mới; writer cũ không thể tạo order thiếu PDF.
Chỉ áp dụng tự động trong DB test sở hữu riêng; production theo runbook backup/
release hiện có. Không thay lịch sử Fabric, binding, hash/proof hoặc mobile backend.

Email hợp đồng không có nút “Xem hợp đồng”, không nhúng hoặc đính kèm ảnh logo.
Header dùng chữ AgriTrace; hợp đồng mới chỉ đính kèm PDF đã xác nhận.
