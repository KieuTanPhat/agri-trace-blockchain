# Chạy giao diện gốc với chức năng từ KhoaLuan

Trong thư mục `agri-anti`, chạy `npm start`, rồi mở http://localhost:3100.
Không mở HTML bằng `file://` nếu muốn dùng API và lưu dữ liệu IoT.

## Phần đã nối

- Danh sách lô, tìm kiếm, lọc sản phẩm/trạng thái/xác thực và mở đúng lô.
- Lịch sử sự kiện, bằng chứng blockchain và các thao tác theo `allowedCommands`.
- Tra mã lô hoặc đường dẫn QR, thông báo mã không tồn tại, tạo và tải QR SVG.
- Gửi cảm biến giả lập, gửi lại lần gần nhất và lưu lịch sử trên trình duyệt.
- Dữ liệu tổng quan, thao tác chăm sóc/thu hoạch và xem dữ liệu IoT trên dashboard.
- Phiên đăng nhập mô phỏng, hiện/ẩn mật khẩu và ghi nhớ tên đăng nhập.

Mã nghiệp vụ được sao chép từ `KhoaLuan/apps/web/src/lib` vào
`functionality/source`, bản JavaScript chạy nằm trong `functionality/lib`.
Server dùng Node.js, không cần cài dependency để chạy.

## Giữ giao diện

21 file gốc trong `wireframes` được đối chiếu SHA-256 bằng `npm run build`.
Server chỉ gắn module hành vi lúc trả HTML và dùng bản Tailwind CDN đã tải về
để tránh mất bố cục khi CDN không truy cập được. Không ghi lại HTML/CSS gốc.
`?reference` mở bản không gắn hành vi để đối chiếu.
Dữ liệu được cập nhật trong cấu trúc sẵn có; hộp nhập IoT và QR chỉ mở khi thao tác.

## Giới hạn kế thừa từ nguồn

Mặc định API, đăng nhập và blockchain đều là demo. Gửi thao tác trả xác nhận,
chưa thay đổi trạng thái lô lâu dài và chưa xác thực tài khoản thật.
Các trang tin tức, danh mục, kiểm định, quản lý vụ và biểu đồ mẫu không có API
tương ứng trong nguồn KhoaLuan, nên vẫn là giao diện mẫu; không phải CRUD hoàn chỉnh.
Những ảnh, chứng nhận và phần thông tin phụ của mẫu không đại diện dữ liệu thực.

Để dùng API thật, thiết lập `NEXT_PUBLIC_MOCK_API=false` và
`NEXT_PUBLIC_API_BASE_URL` trước khi chạy. API phải tương thích hợp đồng trong
`functionality/source/api-client.ts`. Phiên đăng nhập demo cần được thay bằng
cơ chế xác thực backend trước khi triển khai thực tế.

## Kiểm tra

- `npm run build`: kiểm tra cú pháp JavaScript và toàn vẹn file giao diện gốc.
- `functionality/verify.cjs`: kiểm thử luồng bằng Playwright; đường dẫn Playwright
  hiện dùng runtime có sẵn trên máy này. Cần server chạy ở cổng 3100.
- Kết quả kiểm thử: `functionality/verification/report.json`.

QR dùng địa chỉ máy chủ hiện tại. QR localhost dùng cho trình duyệt trên máy;
để quét từ điện thoại cần cấu hình địa chỉ máy chủ truy cập được từ điện thoại.
