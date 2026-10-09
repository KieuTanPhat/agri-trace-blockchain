# Agri Trace API

NestJS API sử dụng PostgreSQL và Prisma. API mặc định chạy tại
`http://localhost:8080/api`.

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
trạng thái. Collection đầy đủ nằm tại
`postman/Agri-Trace-v2.postman_collection.json`.

Trace event được ghi cùng transaction với proof `PENDING`. Khi
`FABRIC_ENABLED=true`, worker gửi hash RFC 8785 và metadata tối thiểu sang
Fabric, retry theo exponential backoff rồi cập nhật `txId`, `channelId` và
`CONFIRMED`/`FAILED`. Hướng dẫn chuyển dữ liệu cũ nằm trong
`docs/database-migration-runbook.md`.

Các endpoint hiện có:

- `GET /api` và `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/refresh` và `POST /api/auth/logout` dùng refresh cookie
  `HttpOnly` (`Secure` khi `NODE_ENV=production`), không nhận refresh token
  trong JSON. Các request từ web phải gửi credentials; `CORS_ORIGIN` phải
  liệt kê đúng origin của web. Access token chỉ trả về từ login/refresh.
- Access JWT chứa `sid` (mã nhóm phiên). Guard kiểm trạng thái user, tổ chức và
  nhóm phiên trong PostgreSQL ở mỗi request; logout thu hồi cả nhóm phiên nên
  JWT cũ bị 401 ngay. Khóa user hoặc tắt tổ chức thu hồi toàn bộ phiên của họ.
- Refresh rotation chỉ cho một request dùng token cũ thành công. Request đồng
  thời trong 5 giây trả 409 nhưng không hủy phiên vừa được cấp; dùng lại token
  cũ sau cửa sổ này trả 401 và thu hồi nhóm phiên vì nghi token bị lộ.
- Migration `20261009103000_refresh_session_family` phải chạy trước khi bật
  phiên bản API này. JWT cũ không có `sid` sẽ bị 401; người dùng phiên bản web
  cũ cần đăng nhập lại. Khi triển khai bản cookie mới, nên thu hồi các refresh
  session cũ từng được lưu ở `localStorage` theo kế hoạch rollout.
- `GET /api/auth/me` với header `Authorization: Bearer <token>`
- `POST /api/auth/register` đang chủ động trả `501`; tài khoản phải do quản trị viên cấp

## Kiểm tra

```bash
npm run check --workspace apps/api
```

Bộ e2e dùng JWT, bcrypt và ValidationPipe thật nhưng mock Prisma, vì vậy không ghi
vào database local.
