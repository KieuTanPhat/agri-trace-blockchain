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

## Ảnh và tài liệu

`POST /api/media` nhận `multipart/form-data` với trường `file`, `kind`
(`PRODUCT_IMAGE`, `LOT_IMAGE`, `EVIDENCE_DOCUMENT`), một trong `productId` hoặc
`lotId`, và `visibility` (`PRIVATE` mặc định hoặc `PUBLIC`). Ảnh nhận JPEG, PNG,
WebP; tài liệu minh chứng nhận thêm PDF. Giới hạn 8 MiB/file. API kiểm tra cả
MIME khai báo lẫn định dạng từ nội dung file và lưu SHA-256 để kiểm tra toàn vẹn.

Ảnh sản phẩm chỉ quản trị hệ thống được tải lên. Ảnh lô do quản trị hoặc nhân
viên của tổ chức sở hữu lô tải lên. Tài liệu minh chứng riêng tư cho phép các
đơn vị có quyền xem lô tải lên; chỉ chủ lô/quản trị được công khai tài liệu.
Đường dẫn nội bộ `GET /api/media?productId=...` hoặc `?lotId=...`,
`GET /api/media/:id` và `GET /api/media/:id/content` yêu cầu Bearer token và
kiểm tra quyền. Tương ứng, `/api/public/media` chỉ trả nội dung `PUBLIC`.

File lưu trong thư mục `apps/api/uploads` khi chạy từ thư mục API; có thể đổi
bằng `MEDIA_STORAGE_DIR` (đường dẫn tuyệt đối). Thư mục này không đưa vào Git.
Khi triển khai nhiều máy hoặc container, cần gắn persistent volume dùng chung
hoặc thay lớp lưu trữ bằng object storage để file không mất sau khi triển khai.

## Kiểm tra

```bash
npm run check --workspace apps/api
```

Các E2E auth dùng JWT, bcrypt và ValidationPipe thật với Prisma mock. Các E2E
media và database constraints dùng PostgreSQL thật, chỉ chạy khi có
`TEST_DATABASE_URL`; không lấy `DATABASE_URL` của ứng dụng làm fallback.

Tạo một database test riêng và chạy migration trước khi kiểm tra (PowerShell):

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:YOUR_TEST_PASSWORD@localhost:5432/agri_trace_test?schema=public'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run db:migrate --workspace apps/api
npm run build --workspace blockchain/gateway
npm run check --workspace apps/api
```

Media E2E tự tạo và dọn fixture, lưu file trong thư mục tạm; không cần seed dữ
liệu demo. Vitest cấu hình JWT secret chỉ dành cho E2E và tắt Fabric/alert scanner.
Khi không đặt `TEST_DATABASE_URL`, các suite PostgreSQL được bỏ qua ở local;
CI bắt buộc có biến này, khởi động PostgreSQL 18 và áp dụng migration trước
API checks để các suite đó thực sự chạy.
