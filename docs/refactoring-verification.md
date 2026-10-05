# Xác minh refactor

Ngày: 2026-10-03. Nhánh: `codex/project-structure-refactor`.

## Lượt kiểm tra cuối

`npm run check` tại gốc repository hoàn thành thành công. Runtime kiểm tra:
Node.js 24.19.0, npm 12.1.0, PostgreSQL 18. Database riêng cho kiểm thử ở localhost;
đã áp dụng tám migration hiện có, không sử dụng database nghiệp vụ của người dùng.
`TEST_DATABASE_URL` được thiết lập nên các kiểm tra PostgreSQL không bị bỏ qua.

| Workspace | Trước refactor | Sau refactor | Kết quả cuối |
| --- | --- | --- | --- |
| API unit | 63 | 82 | Đạt |
| API E2E | 54 | 61 | Đạt |
| Web unit | 25 | 28 | Đạt |
| Chaincode | 34 | 34 | Đạt |
| Gateway | 3 | 3 | Đạt |
| Tổng | 179 | 208 | Đạt |

Lint API/Web, typecheck bốn workspace và build bốn workspace đều đạt.
Chaincode/gateway có kiểm tra nạp module đã build; chaincode đạt 94,94% line
coverage theo cấu hình kiểm tra hiện có.

## Bảo toàn hành vi

- Ba snapshot JSON của nội bộ lô, public trace và dashboard được ghi từ service
  gốc, giữ nguyên trong lượt kiểm tra cuối.
- Luồng thu hoạch sau khi tách giữ nguyên thân hàm. Năm mapper/policy được đối
  chiếu với nguồn gốc sau khi bỏ khác biệt format và chuyển lời gọi helper.
- Test thật xác minh rollback sau khi tạo trace/outbox, thu hoạch đồng thời,
  idempotency, phiên bản cũ, quyền truy cập tổ chức, bằng chứng cũ sai hash,
  chuyển trạng thái kết thúc và chuyển vận chuyển sai thứ tự.
- Catalog được so với query gốc trên PostgreSQL cho admin, farm, tổ chức ngoài
  và tài khoản không có tổ chức. Thêm kiểm tra tạo product/farm/plot, trim DTO,
  chuyển Decimal và replay command.
- Adapter test xác minh input/receipt/lỗi được chuyển tiếp nguyên vẹn; các test
  worker hiện có vẫn kiểm tra duplicate, hash mismatch, dead-letter và lease.
- Nội dung 28 ảnh và JSON design token khớp hash/byte với nguồn ban đầu.
  Các nhãn hiển thị FE được giữ nguyên.

## Giao diện và điểm truy cập

Kiểm tra bằng Chromium/Playwright trên dev server, ở 1440px và 390px:

- Đối chiếu trước/sau 10 trang ở mỗi kích thước: login, dashboard, danh sách lô,
  chi tiết lô, vụ trồng, scan, public trace không tồn tại, IoT, admin và trang
  minh họa thành phần. Cả 20 trường hợp khớp vị trí/kích thước phần tử và các
  style tính toán được ghi nhận. Dữ liệu chức năng được cố định bằng fixture để
  tránh khác biệt từ các lần chạy test hoặc thời gian.
- Public trace có dữ liệu API thật được đối chiếu với stylesheet gốc, ở cả hai
  kích thước. Bố cục/style và pixel ảnh chụp khớp.
- Đăng nhập bằng trình duyệt và đi đến dashboard, chi tiết lô, admin với API
  thật thành công, không có lỗi JavaScript trong lượt đạt.
- Cả 28 URL ảnh trả HTTP 200 và nội dung khớp SHA-256 gốc. Manifest/icon và
  `/sw.js` truy cập được.
- API từ build cuối khởi động, `/api/health` trả `ok`. Worker từ build cuối
  khởi động, `/health/ready` trả `ok` khi `FABRIC_ENABLED=false`; xác minh wiring
  DI và truy cập database, không phải xác minh gửi sự kiện lên Fabric.
- Compose model được xác minh bằng `docker compose --env-file
  .env.docker.example config --quiet`. YAML CI được parse; cả `push` và
  `pull_request` chứa `blockchain/gateway/**`.

## Các hạn chế và việc còn riêng biệt

1. Docker daemon không hoạt động, nên chưa chạy container build/smoke hoặc smoke
   trên một mạng Fabric thật. CI từ xa chưa được chạy cho bản thay đổi này.
2. Lệnh mở preview FE production bị bộ duyệt tự động của công cụ từ chối, kể cả
   khi chỉ bind localhost; công cụ chỉ trả `blocked by policy`. Production build
   đạt; các kiểm tra trình duyệt mô tả phía trên chạy ở chế độ dev.
3. `npm audit` trước và sau đều báo 7 high, 1 moderate, 0 critical. Package và
   lockfile không thay đổi. Bước audit của Application CI có thể chặn pipeline
   dù các kiểm tra mã nguồn đạt; xử lý dependency cần một lượt riêng.
4. Công cụ tự động từ chối lệnh xóa các thư mục cũ đã trống (`blocked by policy`).
   Một số thư mục trống còn trên máy; Git không lưu thư mục trống nên chúng không
   nằm trong bản thay đổi.

Các script kiểm tra cục bộ nằm trong `.codex/`, bằng chứng trong
`.codex/refactor-baseline/` (được Git và Docker bỏ qua). PostgreSQL dùng riêng cho
kiểm tra đã dừng sau khi xác minh. Không sửa schema/migration, file môi trường hoặc
nhãn nghiệp vụ để làm các kiểm tra đạt.

Kết quả này xác nhận những luồng đã kiểm tra; không phải bảo đảm toán học rằng
toàn bộ hệ thống không còn lỗi, hoặc xác nhận tuân thủ SOLID hoàn toàn.
