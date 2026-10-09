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

Yêu cầu Node.js 22.22.3+ (hoặc 24.15+) và npm 12.1.0. npm cũ có thể bỏ qua
`overrides` của dependency trong workspace. Từ thư mục gốc:

```bash
npm install --global npm@12.1.0
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

## UAT nongtrace.site

UAT hiện dùng [https://nongtrace.site](https://nongtrace.site).
Source/image digests, CI/CD, rollback và backup evidence nằm trong
[báo cáo HTTPS UAT](docs/nongtrace-uat-deployment-status.md);
vận hành theo [CD runbook](docs/contabo-cd-runbook.md).

Rà soát code/quyền sau triển khai: [kế hoạch và kết quả audit](docs/nongtrace-uat-code-audit.md).
Admin quản trị identity/masterdata; Auditor chỉ đọc. Inspection và review chứng chỉ
đang chặn ghi cho tới khi AGT-026 phê duyệt actor, theo AGT-007.

Module lots tách `LotHarvestService` (transaction + outbox), `LotQueryService`
(query), presenter (projection), action policy (role/org/state) và proof status.

## Kiểm tra toàn bộ

```bash
npm run check
```

Lệnh trên chạy lint, typecheck, unit/e2e test và build tương ứng cho các workspace.
Test ràng buộc và nghiệp vụ PostgreSQL cần `TEST_DATABASE_URL` trỏ đến database
test riêng đã chạy migration; thiếu biến này thì các test database bị bỏ qua.
Không đặt `TEST_DATABASE_URL` thành database production.
Để chạy riêng một phần:

```bash
npm run check --workspace apps/web
npm run check --workspace apps/api
npm run check --workspace blockchain/chaincode
npm run check --workspace blockchain/gateway
```

Web chạy ESLint cho React/TypeScript/accessibility và Oxlint cho các rule Next.js.
`npm run build --workspace apps/web` chạy cả hai trước khi biên dịch; `check`
còn kiểm tra hợp đồng lint và xác nhận build bị chặn khi có lỗi.

Mạng Fabric local cần thêm Docker; xem script trong `blockchain/network`.

Mô hình dữ liệu core hiện tại tách rõ `ProductionCycle`, `HarvestEvent`, `Lot`
và `Shipment`. Tài liệu `docs/business-specification-v1.2.md` chỉ còn là baseline
lịch sử; Prisma schema được đồng bộ với database PostgreSQL `agri_traceDB` tại
`apps/api/prisma/schema.prisma`.

## Audit dependency

Kiểm tra root và package chaincode độc lập trong các môi trường cài tách riêng:

```bash
npm ci
npm run audit:dependencies
npm run check:chaincode:standalone
```

Các lệnh ghi audit đầy đủ, audit production, kiểm tra peer dependency và metadata
(ngày, SHA checkout, Node/npm, SHA-256 lockfile) vào `.codex/evidence/dependencies`.
Kiểm tra standalone sao chép nguồn/config và hai file package của chaincode vào
thư mục tạm, cài theo lockfile riêng, audit và chạy `check`, rồi dọn thư mục tạm.
Manifest/lockfile trong thư mục cài phải khớp byte với checkout nguồn. Cách này
giữ graph root ổn định khi chaincode cũng là workspace của monorepo.
High/moderate làm lệnh thất bại. CI lưu cùng bằng chứng dưới dạng artifact cho
workspace và chaincode độc lập. Xem [báo cáo AGT-002](docs/dependency-audit-2026-10-06.md).
