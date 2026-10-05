# Danh mục tài nguyên AgriTrace

Tài nguyên được nhóm theo chức năng. Toàn bộ ảnh gốc được giữ nguyên nội dung,
kể cả ảnh chưa được giao diện sử dụng. **Lưu dự phòng không có nghĩa là được phép
xóa**: cần xác nhận mục đích sử dụng trước khi loại bỏ bất kỳ file nào.

Ảnh dùng ở nhiều chức năng đặt trong `shared/`; không sao chép một ảnh vào nhiều
thư mục. URL sử dụng có dạng `/assets/<nhóm>/<tên-file>`.

| Nhóm | File | Mục đích | Tình trạng / nơi sử dụng |
| --- | --- | --- | --- |
| brand | agritrace-logo.svg | Logo chính | Đang dùng: đăng nhập, khung ứng dụng |
| brand | logo.png | Logo raster | Lưu dự phòng |
| brand | leaf-pattern.svg | Họa tiết thương hiệu | Lưu dự phòng |
| auth | auth-farm-flow.png | Minh họa xác thực | Lưu dự phòng |
| auth | business-registration.png | Minh họa đăng ký tổ chức | Lưu dự phòng |
| overview | hero-supply-chain.png | Giới thiệu chuỗi cung ứng | Lưu dự phòng |
| overview | process-5-steps.png | Minh họa quy trình | Lưu dự phòng |
| overview | technology-ecosystem.png | Giới thiệu công nghệ | Lưu dự phòng |
| trace | qr-scan-photo.png | Minh họa quét QR | Lưu dự phòng |
| trace | trace-product.png | Minh họa truy xuất sản phẩm | Lưu dự phòng |
| compliance | food-safety-sample.svg | Chứng chỉ an toàn thực phẩm mẫu | Lưu dự phòng; chỉ là minh họa |
| compliance | iso22000-sample.svg | Chứng chỉ ISO mẫu | Lưu dự phòng; chỉ là minh họa |
| compliance | vietgap-sample.svg | Chứng chỉ VietGAP mẫu | Lưu dự phòng; chỉ là minh họa |
| compliance | compliance-donut.svg | Biểu đồ tuân thủ minh họa | Lưu dự phòng |
| shipments | delivery-route-map.svg | Bản đồ vận chuyển minh họa | Lưu dự phòng |
| iot | iot-line-chart.svg | Biểu đồ cảm biến minh họa | Lưu dự phòng |
| identity | avatar-auditor.svg | Avatar kiểm tra viên | Lưu dự phòng |
| identity | avatar-farm.svg | Avatar trang trại | Lưu dự phòng |
| identity | avatar-retailer.svg | Avatar nhà bán lẻ | Lưu dự phòng |
| identity | avatar-transporter.svg | Avatar vận chuyển | Lưu dự phòng |
| identity | role-characters-6.png | Minh họa các vai trò | Lưu dự phòng |
| states | 403-forbidden.svg | Minh họa không có quyền | Lưu dự phòng |
| states | 409-conflict.svg | Minh họa xung đột dữ liệu | Lưu dự phòng |
| states | 422-validation.svg | Minh họa dữ liệu không hợp lệ | Lưu dự phòng |
| states | 503-unavailable.svg | Minh họa dịch vụ gián đoạn | Lưu dự phòng |
| shared | farm-greens.png | Ảnh nông sản dùng chung | Đang dùng: dashboard, bảng lô, public trace, CSS hero |
| shared | farm-landscape.png | Ảnh nông trại dùng chung | Đang dùng: sidebar, CSS page header |
| pwa | icon.svg | Icon ứng dụng PWA | Đang dùng: manifest.webmanifest |

Khi thêm ảnh, chọn nhóm chức năng, đặt tên mô tả mục đích và cập nhật bảng này.
Khi đổi đường dẫn, kiểm tra cả TSX, CSS và manifest. Các file `sw.js` và
`manifest.webmanifest` nằm tại gốc `public/` để giữ điểm truy cập PWA.

Token thiết kế JSON cũ được lưu tại `docs/design/design-tokens-reference.json`.
Token CSS trong mã nguồn là bảng thiết kế đang được giao diện sử dụng.
