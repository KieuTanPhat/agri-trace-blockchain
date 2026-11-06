# Gửi hợp đồng qua Gmail SMTP

API lưu yêu cầu gửi thư trong outbox cùng transaction nghiệp vụ. Dedicated Worker
mới gửi thư; API và Web không nhận SMTP credential. Mail hợp đồng đính kèm đúng
PDF đã xác nhận, không tạo lại PDF và không dùng nút “Xem hợp đồng”. Hợp đồng cũ
chỉ có HTML vẫn giữ bản lịch sử. SMTP chấp nhận thư chưa chứng minh thư vào Inbox;
cần kiểm tra cả Spam và mở PDF thực tế.

## Cấu hình Gmail cá nhân

1. Bật xác minh hai bước cho tài khoản gửi. Tạo **App Password** tại
   <https://myaccount.google.com/apppasswords>. Không dùng mật khẩu đăng nhập Gmail.
2. Với chạy bằng npm, nhập vào file private `apps/api/.env` đã được Git ignore:

   ```dotenv
   MAIL_TRANSPORT=smtp
   MAIL_FROM=your-sender@gmail.com
   MAIL_FROM_NAME=AgriTrace
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-sender@gmail.com
   SMTP_PASSWORD=""
   ENTERPRISE_WEB_BASE_URL=http://localhost:3000
   ```

   Điền App Password vào giá trị rỗng, ngay trong editor. Không đưa secret vào
   chat, command line, ảnh chụp hay Git. `MAIL_FROM` phải trùng Gmail gửi; code loại
   khoảng trắng trong App Password. Cổng 587 bắt buộc STARTTLS; cổng 465 dùng
   `SMTP_SECURE=true`. Không tắt xác thực chứng thư TLS.
3. Tại root repo, build rồi kiểm tra kết nối (không gửi thư, không chạm database):

   ```bash
   npm run build --workspace apps/api
   npm run mail:verify --workspace apps/api
   ```

4. Gửi thử **về chính tài khoản SMTP_USER** với một PDF có sẵn:

   ```bash
   npm run mail:preview --workspace apps/api -- --pdf /absolute/path/contract.pdf
   ```

   Lệnh không đổi đơn hàng, trạng thái thanh toán hay outbox. Email ghi rõ TEST,
   có một tệp PDF; mở email và PDF để nghiệm thu. Không có logo gửi kèm.
5. Sau khi cấu hình hợp lệ, khởi động lại dedicated Worker với cùng database và
   `JWT_SECRET` của API. Với repo/bản dump đang phục hồi, **rà hàng đợi trước**;
   không bật gửi toàn bộ lịch sử. Đơn test dùng `example.test` không gửi ra Gmail:
   tạo đơn mới qua giao diện bằng email thật của người kiểm thử. Không sửa recipient
   hay trạng thái SENT của mail cũ để giả định đã gửi lại.

## Docker và production

Compose local đọc SMTP từ `.env.docker`; sao chép các giá trị private vào file
này nếu chạy Docker. File `apps/api/.env` không tự trở thành biến Compose.
Worker không phụ thuộc Mailpit khi dùng SMTP. API/Web không được truyền mật khẩu SMTP.

Production dùng private env của controller và `docker-compose.app.yml`, mặc định
`MAIL_TRANSPORT=disabled` đến khi cấu hình và nghiệm thu xong. Bật `smtp` rồi triển
khai lại Worker theo [runbook production](production-runbook.md); Worker đang nằm
trong profile `fabric`, cần nằm trong topology được vận hành. Không dùng Compose
local để thay controller production. Cấu hình mail không tự triển khai release.

SMTP lỗi giữ thư PENDING, giải lease và hẹn retry; chỉ đánh dấu SENT khi SMTP đã
chấp nhận đúng recipient. Thiếu cấu hình dừng mail trước khi claim, không tiêu hao
lượt thử cho cả hàng đợi. Log chỉ ghi mã lỗi đã lọc, không ghi email, OTP hoặc secret.
Ứng dụng không tự chuyển SMTP lỗi hay địa chỉ test sang Mailpit.

SMTP không có transaction chung với DB: nếu SMTP đã chấp nhận nhưng process chết
trước khi lưu SENT, retry có thể gửi trùng. Message-ID giữ ổn định theo outbox id;
không cam kết gửi đúng một lần dựa trên SMTP. Thanh toán/kích hoạt không được chạy
lại theo kết quả email. Với lưu lượng production cần xem giới hạn gửi Gmail và
chọn provider phù hợp; App Password có thể bị thu hồi khi đổi mật khẩu Google.

## Mailpit chỉ dùng khi chủ động test offline

Giữ sink này để chạy fixture và CI mà không phát tán thư ra bên ngoài. Không bắt
buộc cài/chạy Mailpit khi gửi Gmail. Đặt `MAIL_TRANSPORT=mailpit` trong env test,
với npm đặt `MAILPIT_API_URL=http://127.0.0.1:8025`; Docker dùng hostname `mail`:

```bash
MAIL_TRANSPORT=mailpit docker compose --env-file .env.docker --profile mailpit up --build
```

Hộp thư test tại <http://localhost:8025>. Code từ chối Mailpit trong production.
Không dùng dòng `.env` SMTP thật để chạy fixture có recipient thật.

Nguồn Google: [App Password và điều kiện sử dụng](https://support.google.com/accounts/answer/185833),
[cấu hình SMTP/TLS Gmail](https://developers.google.com/workspace/gmail/imap/imap-smtp).

## Email khôi phục mật khẩu nhân viên

Outbox `STAFF_PASSWORD_RESET` được tạo cùng challenge bởi API staff. Dùng cùng
Gmail SMTP đã cấu hình, không dùng Firebase SMS. Worker chỉ gửi mã còn hiệu lực
và xóa ciphertext khi SENT/CANCELLED. Không gửi lại mật khẩu hiện tại hoặc mật
khẩu mới qua email. Khi phát hành migration `20270101000011_staff_password_reset`,
triển khai Worker hiểu kind mới trước khi mở API khôi phục; Worker cũ không hiểu
OTP của kind này. Không chạy toàn bộ Worker trên bản dump để kiểm chức năng này.
