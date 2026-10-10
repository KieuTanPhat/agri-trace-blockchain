# Giao diện AgriTrace

Trang tên miền gốc `/` là trang thông tin tiếng Việt. Dùng phong cách và token CSS của ứng dụng; font Be Vietnam Pro được phục vụ tại `/fonts` kèm giấy phép OFL. Không tải font từ Google khi mở trang.

Người tiêu dùng mở `/scan` từ nút Quét QR, dùng camera, ảnh QR hoặc mã/đường dẫn truy xuất. Ảnh được giải mã trên thiết bị; chỉ token hợp lệ được điều hướng tới `/trace/<token>` cùng origin. URL QR cũ được lấy token, không điều hướng sang website ngoài. Không bật camera tự động. HTTPS và quyền camera cần thiết khi chạy ngoài localhost; camera tắt khi rời trang hoặc chuyển ứng dụng.

Trang giới thiệu chỉ có nội dung tổng quát, không có QR/lô mẫu và không dẫn tới đăng nhập. Nhập trực tiếp `/login` để vào hệ thống quản lý; đích mặc định sau đăng nhập là `/dashboard`. Các đường dẫn được bảo vệ vẫn yêu cầu phiên đăng nhập và phân quyền hiện có. Việc không đặt link login trên landing không thay thế kiểm soát truy cập.

## Desktop và mobile

Khung quản lý dùng sidebar trên desktop, menu dạng hộp thoại có quản lý focus trên màn hình từ 900 px trở xuống. Bảng lô, vụ trồng, danh mục quản trị và lịch sử số lượng dùng cùng dữ liệu cho bảng desktop và thẻ mobile ở 760 px trở xuống. Bộ lọc và phân trang áp dụng cho cả hai. Biểu mẫu chuyển về một cột, input 16 px, thao tác tối thiểu 44 px, hộp thoại có chiều cao theo viewport và cuộn nội dung.

Các trạng thái thu hồi/hết hạn vẫn hiển thị trước phần bằng chứng. Thao tác ghi dữ liệu theo `allowedCommands` từ API; kiểm toán viên chỉ đọc theo hợp đồng hiện hành. Service worker vẫn chỉ lưu trang giải thích offline, không lưu trang nghiệp vụ, tài khoản hoặc phản hồi API.

## Kiểm tra

Chạy `npm run check --workspace apps/web` trên Node/npm được ghi trong README. Kiểm tra trình duyệt ở 320, 390, 768 và 1440 px: landing, scan, login, dashboard, lô/chi tiết, vụ trồng/chi tiết, admin/phân công, kiểm định, giả lập IoT và các trạng thái lỗi. Kiểm thêm tên dài, mã băm, bộ lọc đổi trang, bàn phím/Escape, camera bị từ chối và ảnh QR sai.

Dữ liệu fixture khi kiểm tra local không phải bằng chứng nghiệm thu nghiệp vụ trên UAT. AGT-028 vẫn cần nghiệm thu theo issue, gồm thiết bị camera thật và người được phân công.

### Kết quả kiểm tra giao diện ngày 2026-10-11

- `npm run check --workspace apps/web` đạt: 146 tests, 84 lint-contract tests, 4 image-optimizer tests, TypeScript, ESLint/Oxlint và production build.
- Đã kiểm tra landing, login, scanner, public trace, dashboard, lô/chi tiết, vụ trồng/chi tiết, năm danh mục admin, phân công, kiểm định, IoT và thư viện giao diện với viewport 320/390/768/1440 px. Không phát hiện tràn ngang trong 76 lần đo bố cục, gồm dữ liệu tên dài và mã băm.
- Menu quản lý trên mobile mở/đóng và điều hướng đúng; bảng desktop và thẻ mobile chuyển theo breakpoint. Hộp thoại thu hoạch/vận chuyển vừa màn hình 320 px, trường nhập có nhãn truy cập.
- Tải ảnh QR thật trong fixture điều hướng tới trang truy xuất cùng origin. URL sai bị từ chối; mã không tồn tại hiển thị trạng thái 404. Đã kiểm tra các trạng thái 403/409/422/503, Auditor không có biểu mẫu ghi dữ liệu.
- Fixture chạy riêng trên localhost; không gửi thay đổi nghiệp vụ lên môi trường thật. Quyền camera bị từ chối và giải phóng camera được kiểm tra tự động; chưa xác nhận camera trên thiết bị vật lý.
