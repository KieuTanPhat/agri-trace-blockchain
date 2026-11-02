# Bộ dữ liệu local 100 sản phẩm có luồng và QR

Chỉ dùng trên DB local `agri_trace_ui_test` đã được chủ dự án cho phép nạp thêm.
Không reset DB, không thay dữ liệu người dùng đã nhập. API phải chạy đúng DB này;
script xác nhận danh tính tài khoản qua API trước khi gửi command nghiệp vụ.

## Nội dung

- 30 tổ chức tổng hợp: 12 sản xuất, 6 chế biến, 4 vận chuyển, 4 phân phối, 4 bán lẻ.
- 90 tài khoản C1/C2/C3; mật khẩu ngẫu nhiên riêng, lưu cục bộ ngoài Git.
- 70 sản phẩm có vụ, xuống giống, nhật ký do C3 được phân công ghi, thu hoạch 50 kg.
- 30 sản phẩm chế biến có phiếu nguyên liệu ngoài 10 kg, mẻ hoàn tất 8 kg + hao hụt 2 kg.
- 100 lô/QR được tạo qua API nghiệp vụ; ảnh tổng hợp có chữ DEMO, không phải bằng chứng hiện trường.
- Danh tính, hồ sơ được duyệt và quyền mô phỏng là fixture bootstrap, không phải nghiệm thu OTP/admin.
- Các tổ chức vận chuyển/phân phối/bán lẻ có tài khoản nhưng chưa có chặng giao nhận trong bộ này.

Ledger dùng mô phỏng, sự kiện **PENDING**, không có biên nhận Fabric CONFIRMED giả.
Không tạo thanh toán hay gói trả phí giả. Bộ này khác catalog INACTIVE và bộ đo hiệu năng cách ly.

## Chạy từ thư mục gốc repo

Cần build API trước (`npm run build --workspace apps/api`), Docker container
`postgres`, API local và cấu hình `apps/api/.env` đúng target. Xem trước:

```sh
AGRI_UI_WORKFLOW_CONFIRM=agri_trace_ui_test AGRI_UI_WORKFLOW_API=http://127.0.0.1:8080/api npm run demo:ui:workflow -- --dry-run
```

Nạp/thực hiện tiếp sau gián đoạn: dùng cùng lệnh và bỏ `--dry-run`. Kiểm lại dữ
liệu mà không tạo command nghiệp vụ: thay bằng `--verify`.
Script chụp fingerprint dữ liệu gốc, tạo backup `pg_dump` và kiểm inventory/hash
trước khi ghi. Checkpoint giữ key/body/result gốc; request chưa rõ kết quả được
đối soát trước. Chỉ tạo key mới sau khi đã xác định yêu cầu cũ bị từ chối.
Không xóa checkpoint để thử lại. Advisory lock ngăn hai loader chạy đồng thời.

File riêng tư nằm trong `.codex/ui-workflow-100/agri_trace_ui_test/`:

- `accounts.json`: thông tin đăng nhập demo; không đưa vào Git hay chia sẻ công khai.
- `inventory.json`: tên sản phẩm, product/lot ID và URL QR thực tế.
- `state.json`: checkpoint, fingerprint gốc và thông tin backup.
- `before-*.dump`: backup trước khi nạp; không khôi phục đè DB đang dùng để dọn demo.

## Test giao diện

Reload Web, đăng nhập owner demo để xem dữ liệu của đúng doanh nghiệp đó.
Admin xem toàn bộ tổ chức. Tài khoản HTX người dùng đã tạo vẫn chỉ thấy tenant
của mình. Mobile consumer đọc danh mục công khai; mobile staff dùng tài khoản
C3 của cùng farm và phải kết nối đúng API local.

Đối chiếu một QR với inventory: đúng sản phẩm, chủ tổ chức, nhật ký/nguồn mẻ,
sản lượng và trạng thái ledger. Kiểm HTTP/PostgreSQL tự động không thay thế test
camera, OTP, chữ ký hay giao diện trên Android thật.
