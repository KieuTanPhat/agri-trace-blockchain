# Giao diện AgriTrace

Nhận diện: logo chữ A có ngôi sao (xanh lục + cam/vàng), khẩu hiệu "Truy xuất nguồn gốc nông sản Việt". Liên hệ công khai: contact@agritrace.dev và Zalo +84 377 599 221; hai giá trị này chỉ khai báo trong `apps/web/src/lib/site-contact.ts`.

Trang tên miền gốc `/` là trang thông tin tiếng Việt: hero, dải công nghệ, bốn giá trị, ba hàng tính năng, hành trình sáu bước, vai trò trong chuỗi, toàn vẹn dữ liệu, FAQ và dải liên hệ (email, Zalo). Font Be Vietnam Pro được phục vụ tại `/fonts` kèm giấy phép OFL. Không tải font, script hoặc ảnh từ domain ngoài khi mở trang.

Người tiêu dùng mở `/scan` từ nút Quét QR, dùng camera, ảnh QR hoặc mã/đường dẫn truy xuất. Ảnh được giải mã trên thiết bị; chỉ token hợp lệ được điều hướng tới `/trace/<token>` cùng origin. URL QR cũ được lấy token, không điều hướng sang website ngoài. Không bật camera tự động. HTTPS và quyền camera cần thiết khi chạy ngoài localhost; camera tắt khi rời trang hoặc chuyển ứng dụng.

Trang giới thiệu chỉ có nội dung tổng quát, không có QR/lô mẫu và không dẫn tới đăng nhập. Mockup điện thoại ở hero là hình minh họa trừu tượng, không có mã lô hay QR thật. Nhập trực tiếp `/login` để vào hệ thống quản lý; đích mặc định sau đăng nhập là `/dashboard`. Các đường dẫn được bảo vệ vẫn yêu cầu phiên đăng nhập và phân quyền hiện có. Việc không đặt link login trên landing không thay thế kiểm soát truy cập.

## Hệ thống thiết kế

Mã nằm ở `apps/web/src/styles`, nạp theo thứ tự trong `app/layout.tsx`:

| File | Nội dung |
| --- | --- |
| `tokens.css` | Nguồn token duy nhất: màu (xanh lục, amber, trung tính, trạng thái), chữ, khoảng cách theo thang 4 px, bo góc, bóng, easing/thời lượng, kích thước khung |
| `base.css` | Reset, kiểu chữ, focus, `.sr-only`, `.skip-link`, eyebrow, cụm nhấn trong tiêu đề |
| `motion.css` | Keyframes và lớp chuyển động; tắt toàn bộ khi `prefers-reduced-motion: reduce` |
| `app.css` | Thành phần dùng chung: panel, nút, form, notice, badge, bảng/thẻ dữ liệu, timeline, hộp thoại, khung quản lý, dashboard, trace, scanner |
| `site.css` | Header/footer công khai, landing (`lp-*`), đăng nhập |

Cam/vàng chỉ làm điểm nhấn (CTA, vệt gạch chân, số bước, trạng thái đang chọn). Trạng thái lỗi/cảnh báo/thành công dùng màu trạng thái riêng, không dùng màu thương hiệu. Icon chỉ dùng `lucide-react`. Logo và biểu tượng PWA nằm ở `public/agritrace/brand` và `public/icons`; favicon/apple icon ở `src/app/icon.png`, `src/app/apple-icon.png`.

Breakpoint dùng thống nhất: 600 px (điện thoại), 900 px (máy tính bảng, sidebar chuyển thành ngăn kéo và thanh điều hướng dưới), 1200 px (rộng). Khi thêm style, dùng token thay vì mã màu hoặc cỡ chữ viết cứng.

## Chuyển động

Chuyển động nhẹ, chỉ dùng `transform` và `opacity`, 200–600 ms, easing `cubic-bezier(0.22, 1, 0.36, 1)`. Gồm: hero vào trang theo lớp `.enter`, mockup nổi nhẹ, `Reveal` (`components/ui/reveal.tsx`) làm nội dung dưới màn hình hiện dần khi cuộn, vẽ cung và bật số trong hành trình sáu bước, marquee công nghệ (dừng khi hover), nâng thẻ khi hover, accordion FAQ, header thu nhỏ khi cuộn, fade nhẹ khi chuyển trang quản lý và skeleton khi đang tải.

`Reveal` chỉ ẩn nội dung nằm dưới màn hình sau khi JavaScript chạy; không có JavaScript hoặc không có `IntersectionObserver` thì nội dung luôn hiển thị. Không đặt chuyển động lên cảnh báo thu hồi/hết hạn/toàn vẹn và không gắn vào biểu mẫu đang nhập liệu hoặc ký lệnh.

## Desktop và mobile

Form đăng nhập giữ input và nút submit ở trạng thái disabled trong HTML ban đầu,
cho đến khi React đã gắn handler và hoàn tất khôi phục phiên. Bài trình duyệt chờ
nút sẵn sàng, kiểm POST login trả 201 rồi mới kiểm điều hướng; lỗi giữ response
status/timing, console, ảnh đã che input và trace đã loại credential trong artifact.

Khung quản lý dùng sidebar nhóm theo công việc (Vận hành, Tuân thủ, Hệ thống; chỉ hiện mục vai trò được truy cập) trên desktop. Từ 900 px trở xuống là thanh điều hướng dưới với bốn mục đầu và nút "Thêm" mở ngăn kéo dạng hộp thoại có quản lý focus và Escape. Bảng lô, vụ trồng, danh mục quản trị và lịch sử số lượng dùng cùng dữ liệu cho bảng desktop và thẻ mobile ở 600 px trở xuống. Bộ lọc và phân trang áp dụng cho cả hai. Biểu mẫu chuyển về một cột, input 16 px, thao tác tối thiểu 44 px, hộp thoại có chiều cao theo viewport và cuộn nội dung.

Dashboard mở bằng số liệu và "Việc cần làm" (cảnh báo và thao tác khả dụng của lô nổi bật), không có banner giới thiệu.

Trang truy xuất công khai ưu tiên điện thoại: cảnh báo thu hồi/hết hạn/toàn vẹn ở trên cùng, rồi tên lô và trạng thái, thông tin lô, chứng nhận, lịch sử và bằng chứng chuỗi khối. Tên dài và mã băm tự xuống dòng.

Các trạng thái thu hồi/hết hạn vẫn hiển thị trước phần bằng chứng. Thao tác ghi dữ liệu theo `allowedCommands` từ API; kiểm toán viên chỉ đọc theo hợp đồng hiện hành. Service worker vẫn chỉ lưu trang giải thích offline, không lưu trang nghiệp vụ, tài khoản hoặc phản hồi API.

## Kiểm tra

Chạy `npm run check --workspace apps/web` trên Node/npm được ghi trong README. Kiểm tra trình duyệt ở 320, 390, 768 và 1440 px: landing, scan, login, dashboard, lô/chi tiết, vụ trồng/chi tiết, chuỗi và đối tác, admin/phân công, kiểm định, giả lập IoT và các trạng thái lỗi. Kiểm thêm tên dài, mã băm, bộ lọc đổi trang, bàn phím/Escape, camera bị từ chối, ảnh QR sai và `prefers-reduced-motion`.

Dữ liệu fixture khi kiểm tra local không phải bằng chứng nghiệm thu nghiệp vụ trên production. AGT-028 vẫn cần nghiệm thu theo issue, gồm thiết bị camera thật và người được phân công.

### Giới hạn nghiệm thu

Kiểm camera thật, cài PWA và permission/offline trên thiết bị HTTPS theo AGT-028;
fixtures không thay cho camera phần cứng hoặc UAT nghiệp vụ. Scanner camera,
upload và nhập mã dùng cùng route trace local đã validation; không điều hướng
ra URL ngoài hoặc bật camera tự động. Giữ warning priority, auditor read-only,
server allowedCommands và service worker network-only cho dữ liệu nghiệp vụ.
Thay đổi chỉ về giao diện phải giữ API/schema/business policy.
