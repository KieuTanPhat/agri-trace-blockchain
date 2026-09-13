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
