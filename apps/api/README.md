# Agri Trace API

NestJS API sử dụng PostgreSQL và Prisma. API mặc định chạy tại
`http://localhost:8080/api`.

Các thay đổi command journal, reviewer scope, harvest sensor window và cutover
Fabric v3 được ghi trong [implementation record](../../docs/core-implementation-2026-10-10.md).
Các migration mới cần review SQL/rehearsal có kiểm soát trước triển khai. Sau
migrate, dùng `npm run db:provision-compliance-role --workspace apps/api` để thêm
role reviewer còn thiếu; không dùng demo seed trên dữ liệu dùng chung.

## Chạy local

Từ thư mục gốc repository:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
npm run dev:api
```

Khởi tạo schema khi dùng PostgreSQL local:

```bash
npm exec --workspace apps/api -- prisma generate
npm exec --workspace apps/api -- prisma migrate deploy
```

Schema hiện dùng mô hình `ProductionCycle -> HarvestEvent -> Lot -> Shipment`,
không còn bảng `Batch`. Prisma schema map trực tiếp database PostgreSQL
`agri_traceDB`; source of truth trong repository là `apps/api/prisma/schema.prisma`.
Migration baseline cũng bao gồm telemetry vận chuyển, check constraint, trigger,
view truy xuất và năm role mặc định của hệ thống.

Chạy migration và seed:

```bash
npm run db:migrate --workspace apps/api
npm run db:seed --workspace apps/api
```

Swagger chạy tại `http://localhost:8080/api/docs`. Mọi command thay đổi nghiệp
vụ yêu cầu `Idempotency-Key`; frontend không có endpoint cập nhật trực tiếp
trạng thái. Collection tham khảo nằm tại
`postman/Agri-Trace-v2.postman_collection.json`; Swagger và OpenAPI sinh từ code
là contract hiện tại, bao gồm các endpoint mới.

Trace event được ghi cùng transaction với outbox `PENDING` và command journal.
Proof chỉ được xác nhận sau khi Worker đối chiếu receipt đã commit trên ledger. Khi
`FABRIC_ENABLED=true`, worker gửi hash RFC 8785 và metadata tối thiểu sang
Fabric, retry theo exponential backoff rồi ghi proof `CONFIRMED` với `txId` và
`channelId`, hoặc giữ trạng thái `RETRY`/`DEAD_LETTER` trong outbox. Hướng dẫn chuyển dữ liệu cũ nằm trong
`docs/database-migration-runbook.md`.

OpenAPI và kiểu Web sinh từ metadata NestJS đã compile bằng
`npm run api-contract:generate` ở root (cần Prisma client và Gateway build).
`npm run api-contract:check` chặn file sinh bị lệch; exporter không khởi động
server, Worker hoặc kết nối DB/Fabric. Các API mới và thứ tự cutover có kiểm soát
nằm trong [implementation record](../../docs/core-implementation-2026-10-10.md).

Các endpoint hiện có:

- `GET /api` và `GET /api/health`
- `POST /api/auth/login` trả access JWT, `sessionId`, `tokenType` và user;
  refresh secret không có trong JSON. Đăng nhập thành công cũng thu hồi nhóm
  phiên đang được trình duyệt chọn trước đó.
- `POST /api/auth/refresh` và `POST /api/auth/logout` dùng refresh cookie
  `HttpOnly` (`Secure` khi `NODE_ENV=production`), không nhận refresh token
  trong JSON. Login đặt cookie chọn phiên `agritrace_session` và cookie bí mật
  `agritrace_refresh_<sessionId>`, cùng path `/api/auth`, `SameSite=Lax`.
  Client phải giữ cả hai cookie. Chỉ login đổi cookie chọn phiên; refresh/logout
  chỉ sửa cookie của nhóm phiên đang xử lý. Response cũ của A không thể thay
  hoặc xóa cookie của B. Các request web phải gửi credentials; `CORS_ORIGIN`
  phải liệt kê đúng origin của web. Không hỗ trợ web/API ở hai site khác nhau.
- Access JWT chứa `sid` (mã nhóm phiên). Guard kiểm trạng thái user, tổ chức và
  nhóm phiên trong PostgreSQL ở mỗi request; logout thu hồi cả nhóm phiên nên
  JWT cũ bị 401 ngay. Khóa user hoặc tắt tổ chức thu hồi toàn bộ phiên của họ.
  Login/refresh/logout khóa organization rồi user trong transaction và đọc lại
  trạng thái trước khi tạo phiên. Update status khóa cùng hàng trước khi thu
  hồi, nên không bỏ sót phiên mới khi chạy đồng thời. Thời hạn nhóm phiên tính
  từ login (`JWT_REFRESH_EXPIRES_DAYS`, mặc định 30 ngày); rotation không gia hạn.
- Refresh rotation chỉ cho một request dùng token cũ thành công. Request đồng
  thời trong 5 giây trả 409 nhưng không hủy phiên vừa được cấp; dùng lại token
  cũ sau cửa sổ này trả 401 và thu hồi nhóm phiên vì nghi token bị lộ.
- Migration `20261009103000_refresh_session_family` phải chạy trước khi bật
  phiên bản API này. Migration chỉ thêm `family_id` nullable và index, phù hợp
  policy auto-CD; không backfill hoặc đổi constraint. API mới dùng ID của hàng
  làm family khi field này NULL. API cũ vẫn có thể insert/rotate session mà
  không truyền field này sau rollback. JWT cũ không có `sid` bị 401; người dùng
  web cũ cần đăng nhập lại. Khi triển khai bản cookie mới, thu hồi các refresh
  session cũ từng lưu trong `localStorage` theo kế hoạch rollout.
- Web giữ access JWT trong bộ nhớ. Login/logout/refresh dùng chung Web Lock
  giữa các tab trên HTTPS và hàng đợi trong mỗi tab. Storage event, focus,
  pageshow và visibility change đồng bộ đổi tài khoản; metadata đồng bộ không
  chứa token. Tab cũ bỏ request/data, xóa cache IoT theo authorization scope và
  khôi phục phiên mới qua cookie. Refresh 409 được retry có backoff; phục hồi
  lúc mở trang giữ trạng thái loading khi phiên đang được xoay vòng.
- `GET /api/auth/me` với header `Authorization: Bearer <token>`
- `POST /api/auth/register` đang chủ động trả `501`; tài khoản phải do quản trị viên cấp

## Kiểm tra

```bash
npm run check --workspace apps/api
```

Đặt `TEST_DATABASE_URL` trỏ tới PostgreSQL test riêng đã chạy migration trước
khi chạy `check`/`test:e2e`. Suite auth-security dùng HTTP, JWT, bcrypt và
ValidationPipe thật với persistence giả; suite auth-session-concurrency, database
constraints và workflow ghi vào database test thật. Không dùng database production.
Chi tiết regression và bằng chứng: [auth session review](../../docs/auth-session-review-2026-10-10.md).
