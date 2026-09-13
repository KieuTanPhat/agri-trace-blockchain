# Agri Trace Blockchain

Monorepo cho hệ thống truy xuất nguồn gốc nông sản, tổng hợp frontend, backend và
Hyperledger Fabric trong một cấu trúc thống nhất.

## Cấu trúc

```text
apps/
  api/                 NestJS + Prisma + PostgreSQL
  web/                 Next.js PWA
blockchain/
  chaincode/           Smart contract Hyperledger Fabric
  gateway/             Adapter kết nối Fabric Gateway
  network/             Script dựng mạng Fabric local
docs/
  architecture/        ERD và schema proof
  frontend/            User flow, wireframe, QR và IoT proposal
  business-specification-v1.2.md
```

## Cài đặt

Yêu cầu Node.js 22 và npm. Từ thư mục gốc:

```bash
npm ci
```

Tạo file môi trường từ các mẫu trong `apps/api/.env.example`,
`apps/web/.env.example` và `blockchain/network/.env.example` khi chạy từng phần.

## Chạy ứng dụng

```bash
npm run dev:web
npm run dev:api
```

Frontend chạy ở `http://localhost:3000`; API chạy ở
`http://localhost:8080/api`. Frontend mặc định dùng mock API. Đặt
`NEXT_PUBLIC_MOCK_API=false` để chuyển sang backend thật.

## Kiểm tra toàn bộ

```bash
npm run check
```

Lệnh trên chạy lint, typecheck, unit/e2e test và build tương ứng cho các workspace.
Để chạy riêng một phần:

```bash
npm run check --workspace apps/web
npm run check --workspace apps/api
npm run check --workspace blockchain/chaincode
npm run check --workspace blockchain/gateway
```

Mạng Fabric local cần thêm Docker; xem script trong `blockchain/network`.
