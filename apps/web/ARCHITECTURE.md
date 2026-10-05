# Cấu trúc frontend

```text
src/
  app/                 Route Next.js, layout và khung ứng dụng
  features/
    auth/              Đăng nhập, khôi phục phiên
    dashboard/         Tổng quan
    lots/              Danh sách và chi tiết lô
    production-cycles/ Vụ trồng và thu hoạch
    shipments/         Thao tác vận chuyển, nhận hàng, báo hỏng
    trace/             Tra cứu công khai, quét QR, timeline
    iot/               Giả lập và theo dõi cảm biến
    admin/             Quản trị dữ liệu
    design-system/     Trang minh họa thành phần
  shared/
    api/               HTTP, refresh phiên, lỗi, idempotency, tổ chức dùng chung
    types/             Hợp đồng dữ liệu API dùng giữa các chức năng
    ui/                Thành phần giao diện dùng chung
    utils/             Ngày, nhãn hiển thị, QR, ánh xạ class CSS
    styles/            Tokens CSS, nền, khung, thành phần, chuyển động, responsive
    pwa/               Đăng ký service worker và kiểm tra offline
  mocks/               Dữ liệu và API giả lập hiện có
  styles.ts            Thứ tự nạp CSS thống nhất cho layout và các route
  test/                Thiết lập môi trường kiểm thử
public/
  assets/              Ảnh được nhóm theo chức năng; xem README tại đây
  manifest.webmanifest
  sw.js
```

## Quy tắc đặt mã nguồn

- Trang trong `app/` nối route với trang thuộc `features/`. Logic và endpoint của
  chức năng nằm cùng chức năng; test đặt cạnh phần được kiểm tra.
- `app/_components/app-frame.tsx` kết hợp auth, điều hướng và tìm kiếm lô ở tầng
  ứng dụng. `shared/ui` không chứa kiểm tra quyền truy cập trang.
- Chức năng sử dụng HTTP client chung; không tạo một cơ chế refresh token riêng.
  HTTP client giữ một refresh promise và kiểm tra chủ phiên trước khi trả dữ liệu.
- `shared` chứa mã dùng chung, không gọi API của một chức năng. Các kiểu dữ liệu
  dùng giữa nhiều chức năng nằm tại `shared/types`.
- CSS riêng nằm ở `features/<chức-năng>/styles/*.module.css`. Class gốc được giữ
  cùng class module để các selector chung tiếp tục hoạt động. Chỉ dùng
  `withFeatureClasses` cho phần tử có class do module sở hữu.
- Các trang lấy bản đồ CSS từ `@/styles`. File này chỉ lắp ghép stylesheet, không
  chứa logic chức năng. Thứ tự import phải giữ ổn định vì bảng lô và responsive
  đang có selector cùng độ ưu tiên; import module trực tiếp tại từng trang có
  thể làm thay đổi thứ tự CSS giữa các chunk Next.js.
- CSS variables trong `shared/styles/tokens.css` là token hiện hành. JSON trong
  `docs/design` là tài liệu lịch sử, không được nạp lúc chạy.

## Điểm truy cập giữ nguyên

`/trace/[traceToken]` nhận token của QR; URL bên ngoài vẫn là `/trace/<token>`.
`/lots/[lotId]` nhận ID nội bộ và giữ kiểm tra phiên/ quyền hiện có.
`NEXT_PUBLIC_MOCK_API=true` vẫn bật chế độ mock như trước; mặc định dùng API thật.
PWA vẫn đăng ký `/sw.js` và dùng manifest tại gốc `public/`.

## Kiểm tra

Tại gốc repository: `npm run check --workspace apps/web` chạy lint, typecheck,
unit test và build. Sau khi đổi tên route, chạy build để Next.js tạo lại kiểu
route trong `.next`; không sửa mã nguồn để phù hợp với cache route cũ.
