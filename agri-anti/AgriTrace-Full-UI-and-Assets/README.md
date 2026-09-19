# AgriTrace Full UI

Bộ giao diện này được tổ chức theo quy trình nghiệp vụ truy xuất nguồn gốc nông sản ứng dụng Blockchain.

## Role của hệ thống

1. FARMER — Nông dân
2. FARM_MANAGER — Quản lý trang trại
3. COOPERATIVE — Hợp tác xã
4. TRANSPORTER — Đơn vị vận chuyển
5. RETAILER — Nhà bán lẻ
6. ADMIN — Quản trị hệ thống
7. CONSUMER — Người tiêu dùng, không có dashboard và dùng trang truy xuất công khai

## Mockup

- 01-homepage.png — trang chủ công khai
- 02-login-register.png — đăng nhập và đăng ký doanh nghiệp
- 03-process-technology.png — trang Quy trình và Công nghệ
- 04-public-trace.png — kết quả truy xuất cho Consumer
- 05-farmer-farm-cooperative-dashboards.png — ba dashboard nhóm sản xuất
- 06-transporter-retailer-admin-dashboards.png — ba dashboard phân phối và quản trị

## Assets

Thư mục assets chứa logo, hơn 70 icon SVG, ảnh minh họa, nhân vật 6 role, chứng nhận mẫu, biểu đồ, bản đồ, avatar, trạng thái lỗi và design token.

## Đưa vào Figma

1. Tạo các Frame desktop rộng 1440 px.
2. Kéo mockup vào Frame, giảm opacity còn 30 đến 40 phần trăm rồi khóa layer.
3. Dựng lại bằng Auto Layout, component và text thật.
4. Kéo SVG trong assets vào Figma để giữ khả năng đổi màu và kích thước.
5. Các nút nghiệp vụ phải hiển thị theo allowedCommands do Backend trả về.
6. Các trạng thái và quyền trong mockup là dữ liệu mẫu; chốt lại theo matrix BE-03.

## Lưu ý

- Không có role AUDITOR trong tài liệu nghiệp vụ hiện tại.
- Cơ sở đóng gói và thủ kho đang được xếp vào phạm vi Hợp tác xã.
- Người dùng không tự chọn role khi đăng ký; Admin xác minh và cấp role.
- Mã QR nằm trong ảnh minh họa không dùng làm mã QR production.

