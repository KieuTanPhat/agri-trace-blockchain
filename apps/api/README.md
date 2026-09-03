# Agri Trace API

## Chạy local với PostgreSQL + Prisma

```bash
npm install
cp .env.example .env
# sửa DATABASE_URL và JWT_SECRET trong .env
npx prisma db push
npx prisma generate
npm run start:dev
```

API mặc định chạy tại `http://localhost:3000`.

## Luồng JWT local

- `POST /auth/register`: tạo tài khoản, hash mật khẩu bằng bcrypt và trả access token.
- `POST /auth/login`: kiểm tra email/mật khẩu trong PostgreSQL và trả access token.
- `GET /auth/me`: yêu cầu header `Authorization: Bearer <token>`.

Import `postman/Agri-Trace-Auth.postman_collection.json` vào Postman và chạy lần lượt ba request. Request đăng nhập tự lưu token vào collection variable để request `/auth/me` sử dụng.

`organizationId` là UUID tùy chọn khi đăng ký. Nếu truyền, organization tương ứng phải tồn tại.

Endpoint health check: `GET /health`.
