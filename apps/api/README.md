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
- `GET /api/auth/me` với header `Authorization: Bearer <token>`
- `POST /api/auth/register` đang chủ động trả `501`; tài khoản phải do quản trị viên cấp

## Kiểm tra

```bash
npm run check --workspace apps/api
```

Bộ e2e dùng JWT, bcrypt và ValidationPipe thật nhưng mock Prisma, vì vậy không ghi
vào database local.
