# Agri Trace Blockchain

Monorepo cho hệ thống truy xuất nguồn gốc nông sản, tổng hợp frontend, backend và
Hyperledger Fabric trong một cấu trúc thống nhất.

## Cấu trúc

```text
apps/
  api/                 NestJS API + dedicated blockchain worker entrypoint
  web/                 Next.js PWA
blockchain/
  chaincode/           Smart contract Hyperledger Fabric
  gateway/             Adapter kết nối Fabric Gateway
  network/             Script dựng mạng Fabric local
docs/
  business-specification-v1.2.md
  adr-001-modular-monolith-dedicated-worker.md
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
npm run dev:worker
```

Frontend chạy ở `http://localhost:3000`; API chạy ở
`http://localhost:8080/api`. Frontend mặc định kết nối backend thật. Worker là
process độc lập; chỉ worker được cấp Fabric signing identity.

## Chạy bằng Docker Compose

Sao chép `.env.docker.example` thành `.env.docker`, thay toàn bộ secret mẫu rồi
chạy:

```bash
docker compose --env-file .env.docker up --build
```

Compose khởi động PostgreSQL, API, Dedicated Worker và Web. API vẫn hoạt động khi
Fabric hoặc Worker tạm dừng; các sự kiện chờ được giữ trong
`blockchain_outbox`. Worker health chỉ mở trong Docker network tại
`http://worker:8081/health/ready`.

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

Mô hình dữ liệu core hiện tại tách rõ `ProductionCycle`, `HarvestEvent`, `Lot`
và `Shipment`. Tài liệu `docs/business-specification-v1.2.md` chỉ còn là baseline
lịch sử; Prisma schema được đồng bộ với database PostgreSQL `agri_traceDB` tại
`apps/api/prisma/schema.prisma`.
