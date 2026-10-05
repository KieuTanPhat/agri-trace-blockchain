# Kết quả tái cấu trúc bốn chặng

Ngày thực hiện: 2026-10-03. Nhánh: `codex/project-structure-refactor`.

## Phạm vi thực hiện

### 1. Tài nguyên

Giữ nguyên 28 ảnh và SVG, gom về `apps/web/public/assets/` theo chức năng. Danh
mục tại `assets/README.md` ghi rõ ảnh đang dùng và ảnh dự phòng. Nội dung từng
ảnh được đối chiếu SHA-256; không đổi định dạng hay xóa ảnh dự phòng.
JSON token thiết kế cũ được lưu nguyên bản trong `docs/design`; CSS variables
vẫn là token đang chạy.

### 2. LotsService

`LotsService` là facade, giữ năm phương thức cũ và dữ liệu trả về. Các phần được
tách gồm:

- `RecordHarvestService`: luồng ghi nhận thu hoạch, một transaction Serializable;
  vẫn truyền cùng `tx` cho trace, outbox, sổ lượng và QR.
- `LotQueryService`: query nội bộ, danh sách, dashboard và truy xuất công khai.
- `lot.presenter.ts`: ánh xạ DTO nội bộ/công khai.
- `lot-action.policy.ts`, `lot-proof-status.ts`, `lot-event-summary.ts`: hàm thuần
  túy cho quyền hiển thị thao tác, bằng chứng và câu mô tả.
- `lot-read.scope.ts`: bộ lọc tổ chức dùng chung cho danh sách và dashboard.

Dashboard chỉ tải các trường cần đếm và kiểm tra hash cho mọi lô; chỉ lô nổi bật
được tải đầy đủ quan hệ. Các trường tạo hash, kể cả `businessData`, vẫn phải đọc
để giữ phát hiện sai lệch ở sự kiện cũ. Tối ưu này không loại bỏ toàn bộ chi phí
kiểm tra lịch sử. Kiểm tra quyền tại các command vẫn giữ nguyên.

Ba snapshot dữ liệu JSON được ghi từ service trước refactor và giữ nguyên sau
khi tách. Có thêm kiểm tra thu hoạch đồng thời, rollback sau khi trace/outbox đã
được tạo và dashboard khớp danh sách theo từng phạm vi tổ chức.

### 3. Frontend

Route mỏng trong `app`, mã chức năng trong `features`, mã chung trong `shared`,
mock trong `mocks`. Endpoint tách theo chức năng và dùng chung HTTP client.
Test được chuyển cùng implementation. CSS riêng thành CSS Modules; stylesheet
chung và thứ tự nạp được tách rõ. Xem `apps/web/ARCHITECTURE.md`.

Tên tham số public trace đổi thành `traceToken`; URL, cách gọi API và hành vi
mock được giữ nguyên. Các nhãn sự kiện hiện có cũng được giữ nguyên.

### 4. Catalog, blockchain và CI

- Catalog tách DTO, controller và service. Bộ `select` và kiểu response ghi rõ
  toàn bộ trường trước đây, bao gồm thời gian, mô tả, Decimal và các quan hệ.
  Guard, validation, sorting, phạm vi tổ chức và idempotency được giữ nguyên.
- Worker phụ thuộc `BlockchainAdapterFactory`/`BlockchainAdapter` và hợp đồng
  receipt của ứng dụng. Composition root gắn port với provider Fabric bằng
  `useExisting`, giữ một connection dùng chung và mở kết nối khi cần.
- `FabricTraceAdapter` chuyển tiếp nguyên input, receipt và lỗi; worker giữ các
  kiểm tra receipt, xử lý duplicate, retry, lease và dead-letter hiện có.
- Helper `state-transitions` trước đây chỉ được test gọi, không tham gia runtime,
  đã được loại bỏ sau khi kiểm tra tham chiếu. Điều kiện chuyển trạng thái tiếp
  tục nằm trong command transaction và ràng buộc PostgreSQL; có thêm kiểm tra
  API thật cho trạng thái kết thúc và chuyển vận chuyển sai thứ tự.
- Application CI thêm `blockchain/gateway/**` cho cả push và pull request.

## Giới hạn của kết quả

Đây là refactor có mục tiêu, không phải xác nhận dự án đã tuân thủ mọi nguyên lý
SOLID. Nghiệp vụ vẫn sử dụng NestJS/Prisma; SQL đặc thù PostgreSQL trong trace và
outbox chưa được chuyển thành repository tổng quát. Không thay đổi schema,
migration, trạng thái nghiệp vụ hay dependency lockfile trong đợt này.

Các kiểm tra đã chạy, số lượng và hạn chế môi trường được ghi trong
`refactoring-verification.md`.
