# Agri Trace Blockchain

Monorepo cho hệ thống truy xuất nguồn gốc nông sản, tổng hợp frontend, backend và
Hyperledger Fabric trong một cấu trúc thống nhất.

Tiến độ triển khai core và các cổng chưa đạt:
[core implementation](docs/core-implementation-2026-10-10.md).
Receipt core ngày 10/10 ghi release `53bec18`, Fabric sequence 3 và 14 migration;
[báo cáo cutover](docs/uat-core-deployment-2026-10-10.md) được giữ làm lịch sử.
Production hiện dùng cleanup release `8ae13542`, theo
[receipt production-only](docs/production-only-deployment-2026-10-13.md).

## Cấu trúc

Hybrid Fabric (chuỗi cung ứng có chủ chuỗi/đối tác) đã triển khai đủ ba bản
trong nhánh `feature/hybrid-fabric-delivery`: **A** phân quyền theo chuỗi, **B**
binding Fabric riêng theo chuỗi với quyền ghi đồng bộ ledger, **C** chữ ký độc lập
của tổ chức và bàn giao hai bên. Đọc theo thứ tự:
[kế hoạch thực hiện và tiến độ](docs/plans/hybrid-delivery-plan-2026-10-14.md),
[ADR-004](docs/adr-004-hybrid-binding-and-signatures.md),
[runbook vận hành B/C](docs/hybrid-fabric-runbook.md) và
[bằng chứng nghiệm thu](docs/hybrid-acceptance-2026-10-14.md). Mạng Fabric pilot
chạy 3 Org cách ly trên một máy; quyền của doanh nghiệp đối tác thật là
**NotEvaluated**. Các tài liệu `hybrid-*-2026-10-12`, cutover/legacy-scope và
`fabric-dev-pilot` mô tả cơ chế đã bỏ hoặc pilot đã retire, chỉ còn là lịch sử.

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
`http://localhost:8080/api`. Trang `/` giới thiệu AgriTrace bằng tiếng Việt và cung cấp tra cứu QR công khai.
Truy cập trực tiếp `/login` để đăng nhập; sau đăng nhập mở `/dashboard`.
Trang giới thiệu không có liên kết đăng nhập hoặc lô/QR mẫu.
Xem [frontend và bố cục mobile](docs/frontend.md) để kiểm tra giao diện.

Frontend mặc định kết nối backend thật. Worker là
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

## Triển khai production

`main` là nguồn triển khai duy nhất vào `agritrace.dev`. Không còn target dev,
dev CD, profile light hoặc route `nongtrace.site`. CI kiểm PR vào main và mọi
push lên main; database/Fabric thử nghiệm dùng local hoặc runner cách ly.

Vận hành theo [runbook production](docs/production-runbook.md). Target adopt
database/Fabric hiện có và giữ migration/checksum, backup, proof/history cùng
rollback gates. [Kế hoạch chuyển](docs/plans/production-only-transition-2026-10-12.md)
ghi phạm vi, snapshot/retirement evidence và các gate Hybrid còn thiếu.

## Hệ thống hiện có tại agritrace.dev

Production dùng [https://agritrace.dev](https://agritrace.dev); release và hậu kiểm
hiện hành nằm trong [receipt production-only](docs/production-only-deployment-2026-10-13.md)
và [runbook production](docs/production-runbook.md). Tên Compose/PGDATA `uat`
được giữ để bảo toàn dữ liệu, không biểu thị deployment UAT/dev riêng.
[Báo cáo chuyển miền và Datadog](docs/agritrace-cutover-status.md) cùng
[receipt HTTPS cũ](docs/nongtrace-uat-deployment-status.md) là lịch sử triển khai.

Rà soát code/quyền sau triển khai: [kế hoạch và kết quả audit](docs/nongtrace-uat-code-audit.md).
Admin quản trị identity/masterdata; Auditor chỉ đọc. Core thêm
COMPLIANCE_REVIEWER trong tổ chức AUDITOR, chỉ ghi inspection/review chứng nhận
cho Farm được Admin phân công. SQL và provision role đã hoàn tất trên hệ thống hiện có;
Admin/owner còn cần phân công Reviewer và nghiệm thu nghiệp vụ đầy đủ. Xem
báo cáo cutover và implementation record ở đầu tài liệu.

Module lots tách `LotHarvestService` (transaction + outbox), `LotQueryService`
(query), presenter (projection), action policy (role/org/state) và proof status.

Hybrid A/B/C nằm trong ba migration: `20261014000000_hybrid_chain_scope` (A, gồm
backfill một chuỗi legacy cho mỗi org sản xuất, hash/proof/QR không đổi),
`20261015000000_hybrid_fabric_binding` (B) và `20261016000000_hybrid_signed_handover`
(C). Các migration tạo kiểu, hàm và trigger nên cổng CD tự động chặn; production phải
theo quy trình review/cutover thủ công và **chưa được phép chạy** trước khi được duyệt.
Lệnh nhanh: `ledger-operator.ts` (binding, khóa ký, chế độ bàn giao),
`org-signer.ts` (bên ký ngoài) và `verify-evidence.ts` (kiểm bằng chứng sau khôi phục) trong
`apps/api/scripts`; mạng pilot bằng `blockchain/network/hybrid/hybrid-network.sh`.

## Kiểm tra toàn bộ

Swagger sinh từ NestJS là contract. Sau `npm ci`, sinh Prisma client và build
Gateway trước khi xuất OpenAPI/kiểu TypeScript cho Web:

```bash
npm run prisma:generate --workspace apps/api
npm run build --workspace blockchain/gateway
npm run api-contract:generate
npm run api-contract:check
```

Exporter dùng metadata đã compile và cấu hình riêng, không mở listener hoặc
kết nối database/Fabric. Kết quả nằm trong `docs/openapi/openapi.json`, checksum
`docs/openapi/openapi.sha256` và `apps/web/src/lib/generated/api.d.ts`; sửa DTO/decorator NestJS rồi sinh lại,
không sửa trực tiếp file sinh. CI API chặn contract lệch và schema public lộ
các field nội bộ đã liệt kê trong generator.

```bash
npm run check
```

Lệnh trên chạy test logic CI/CD, rồi lint, typecheck, unit/e2e test và build
tương ứng cho các workspace. Lint API/Web chặn cả warning; build Web chạy lint.
Test ràng buộc và nghiệp vụ PostgreSQL cần `TEST_DATABASE_URL` trỏ đến database
test riêng đã chạy migration; thiếu hoặc để rỗng biến này thì E2E từ chối chạy.
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
còn kiểm tra hợp đồng lint và xác nhận build bị chặn khi có warning hoặc lỗi.

PR chọn job theo phạm vi thay đổi; mọi push lên `main` chạy đầy đủ để CD dùng
bằng chứng của đúng SHA. Xem [chính sách CI](docs/ci.md) và
[báo cáo kiểm tra CI/clean code](docs/ci-clean-code-audit-2026-10-09.md).

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
