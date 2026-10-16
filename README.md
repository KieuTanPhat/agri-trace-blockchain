# Agri Trace Blockchain

Monorepo cho hệ thống truy xuất nguồn gốc nông sản, tổng hợp frontend, backend và
Hyperledger Fabric trong một cấu trúc thống nhất.

Bản Hybrid A/B/C thực hiện theo [kế hoạch cài mới production](docs/plans/fresh-install-cleanup-2026-10-13.md).
Đọc [PROJECT_CONTEXT](docs/PROJECT_CONTEXT.md), [quy tắc nghiệp vụ](docs/core-business-rules.md),
[ADR-004](docs/adr-004-hybrid-binding-and-signatures.md) và [runbook production](docs/production-runbook.md).
CI/source completion và nghiệm thu runtime là các cổng riêng; kiểm SHA/receipt trong PR và controller state.

## Cấu trúc

Hybrid A phân quyền theo chuỗi; B pin binding/authority/permission epoch và ledger
registry; C dùng khóa Ed25519 tổ chức và bàn giao hai bên. Chữ ký độc lập bắt buộc
ở bàn giao khác tổ chức; care/harvest giữ xác thực hiện hành. Một mạng có channel
theo nhóm hợp tác. Hosted technical identities không chứng minh quyền của đối tác
bên ngoài; external partner authority vẫn NotEvaluated, không tuyên bố HA.

```text
apps/
  api/                 NestJS API + dedicated blockchain worker entrypoint
  web/                 Next.js PWA
  mobile/              Ứng dụng Android/iOS (Expo + React Native), project npm độc lập
blockchain/
  chaincode/           Smart contract Hyperledger Fabric
  gateway/             Adapter kết nối Fabric Gateway
  network/             Script dựng mạng Fabric local
docs/
  archive/business-specification-v1.2.md
  adr-001-modular-monolith-dedicated-worker.md
```

Các file cấu hình ở gốc được chia theo nơi sử dụng:

| Nhóm file | Mục đích |
| --- | --- |
| `docker-compose.yml`, `.env.docker.example` | Chạy ứng dụng local |
| `docker-compose.ci.yml` | Nối Worker với Fabric cách ly trong CI |
| `docker-compose.app.yml`, `.env.deploy.example` | Ứng dụng production dùng image đã pin qua CD |
| `docker-compose.app-hybrid.yml` | Overlay kết nối mạng hosted của production (config schema 3) |
| `docker-compose.app-fabric.yml` | Overlay signer/network cũ; controller không còn ghép nó, nhưng vẫn là file bắt buộc trong manifest app delivery |
| `deploy/ci/`, `deploy/cd/`, `deploy/edge/` | Rehearsal production trong CI; controller, installer và đóng gói CD; Edge (Caddy) dùng chung |
| `package.json`, `package-lock.json`, các file `.git*` và `.dockerignore` | Lệnh, dependency lock và cấu hình công cụ |

Controller chỉ nhận config schema 3, manifest format 2 và release `prod-*`; nó ghép
`docker-compose.app.yml` và `docker-compose.app-hybrid.yml`, không ghép
`docker-compose.app-fabric.yml`. Giữ `docker-compose.app-fabric.yml` theo quyết định của chủ dự án:
`deploy/cd/targets.py` và `policy.validate_manifest` vẫn yêu cầu file trong bundle.
`hybrid-floor.json` chỉ cho rollback tới image verified tương thích migration; việc giữ overlay
không cho phép rollback DB mới về app cũ hoặc tái dùng mạng test cũ.

Môi trường UAT cũ (schema 2, project `agri-trace-uat`) đã retire: stack, bootstrap và
mẫu môi trường của nó không còn trong repo. Application CI kiểm ứng dụng bằng
`docker-compose.app.yml` trong job `Production rehearsal` (`deploy/ci/`). Xem
[runbook production](docs/production-runbook.md).

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
Doanh nghiệp vào `/register`, theo dõi hồ sơ và yêu cầu peer ở `/enterprise`;
quản trị xét duyệt tại `/admin/enterprises`. API và Worker mặc định đóng admission
(`ENTERPRISE_ONBOARDING_ENABLED=false`). Demo cách ly bật `true` ở cả hai process;
xem [kế hoạch v1](docs/plans/enterprise-onboarding.md) và
[hướng dẫn kết nối](docs/hybrid-fabric-runbook.md#12-đăng-ký-và-kết-nối-doanh-nghiệp-v1).
Xem [frontend và bố cục mobile](docs/frontend.md) để kiểm tra giao diện.

Frontend mặc định kết nối backend thật. Worker là
process độc lập; chỉ worker được cấp Fabric signing identity.

## Chạy bằng Docker Compose

Sao chép `.env.docker.example` thành `.env.docker`, thay toàn bộ secret mẫu rồi
chạy:

```bash
docker compose --env-file .env.docker up --build
```

Compose khởi động PostgreSQL, API, Dedicated Worker và Web. Stack local mở ghi
nghiệp vụ qua `HYBRID_WRITES_MODE=OPEN` (mặc định trong `docker-compose.yml`);
đặt `CLOSED` trong `.env.docker` để thử chế độ bảo trì. Production không dùng
file này: controller giữ ghi đóng đến khi bản phát hành được xác minh. API vẫn hoạt động khi
Fabric hoặc Worker tạm dừng; các sự kiện chờ được giữ trong
`blockchain_outbox`. Worker health chỉ mở trong Docker network tại
`http://worker:8081/health/ready`.

## Triển khai production

`main` là nguồn triển khai duy nhất vào `agritrace.dev`. Không còn target dev,
dev CD, profile light hoặc route `nongtrace.site`. CI kiểm PR vào main và mọi
push lên main; database/Fabric thử nghiệm dùng local hoặc runner cách ly.

Vận hành theo [runbook production](docs/production-runbook.md). Cài mới dùng
schema-3 controller, project `agritrace-prod`, PostgreSQL `agri_trace_prod` và mạng
hosted mới sau encrypted backup + isolated restore. Dữ liệu trước đó đều là test,
được giữ trong bản lưu; không backfill account/history/proof/QR vào production mới.

Migration A/B/C giữ byte nguyên vẹn; `20261017000000_hybrid_fresh_install` chỉ
cleanup khi chưa có business history và từ chối trường hợp đã có dữ liệu. New
cycle cần ACTIVE binding; không tạo legacy fallback. Domain/journal/trace/outbox
và quyền/version/idempotency vẫn cùng transaction. Admin/Auditor không ghi thay
business actors.

API không có signing key. Worker nhận technical identity read-only; owner MSP
chỉ dùng trong one-off operator. Production bootstrap chỉ dùng cấu hình riêng tư. Sau
build, operator chạy `node dist/operator/ledger-operator.js`, signer độc lập chạy
`node dist/operator/org-signer.js`, và restore checker chạy
`node dist/operator/verify-evidence.js` từ `apps/api`.

Thay đổi đi qua PR; chủ dự án quyết định merge và thời điểm triển khai. Push vào
`main` có đường dẫn thuộc bộ lọc trong `.github/workflows/production-cd.yml` tự
kích hoạt Production CD. PR chỉ sửa README gốc, `docs/` (ngoài `docs/openapi/`) và
`.gitignore` không kích hoạt CD; README dưới `apps/` hoặc `blockchain/` vẫn thuộc
bộ lọc CD. Không coi CI xanh là quyền tự merge hoặc deploy.

Khi triển khai được duyệt, giữ smoke thực trên VPS theo runbook. Không đặt
maintenance deadline 2 giờ, canary riêng, collector/systemd timer hoặc quan sát
liên tục 24 giờ; sự cố sau bàn giao do chủ dự án vận hành.

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
`docs/openapi/openapi.sha256`, `apps/web/src/lib/generated/api.d.ts` và `apps/mobile/src/api/generated/api.d.ts`; sửa DTO/decorator NestJS rồi sinh lại,
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

Ứng dụng di động không thuộc npm workspace gốc (lockfile riêng, ngoài Docker
image). Kiểm tra trong thư mục của nó:

```bash
cd apps/mobile
npm ci
npm run check
```

Xem [README của ứng dụng](apps/mobile/README.md) để chạy trên máy ảo hoặc điện thoại.

Web chạy ESLint cho React/TypeScript/accessibility và Oxlint cho các rule Next.js.
`npm run build --workspace apps/web` chạy cả hai trước khi biên dịch; `check`
còn kiểm tra hợp đồng lint và xác nhận build bị chặn khi có warning hoặc lỗi.

PR chọn job theo phạm vi thay đổi; mọi push lên `main` chạy đầy đủ để CD dùng
bằng chứng của đúng SHA. Xem [chính sách CI](docs/ci.md) và
[báo cáo kiểm tra CI/clean code](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/4d92f02122cbb0b4342372474f466c9146522365/docs/ci-clean-code-audit-2026-10-09.md).

Mạng Fabric local cần thêm Docker; xem script trong `blockchain/network`.

Mô hình dữ liệu core hiện tại tách rõ `ProductionCycle`, `HarvestEvent`, `Lot`
và `Shipment`. Tài liệu `docs/archive/business-specification-v1.2.md` chỉ còn là baseline
lịch sử; Prisma schema được đồng bộ với database PostgreSQL `agri_traceDB` tại
`apps/api/prisma/schema.prisma`.

## Audit dependency

Kiểm tra root và package chaincode độc lập trong các môi trường cài tách riêng:

```bash
npm ci
npm run audit:dependencies
npm run check:chaincode:standalone
npm run audit:mobile
```

Các lệnh ghi audit đầy đủ, audit production, kiểm tra peer dependency và metadata
(ngày, SHA checkout, Node/npm, SHA-256 lockfile) vào `.codex/evidence/dependencies`.
Kiểm tra standalone sao chép nguồn/config và hai file package của chaincode vào
thư mục tạm, cài theo lockfile riêng, audit và chạy `check`, rồi dọn thư mục tạm.
Manifest/lockfile trong thư mục cài phải khớp byte với checkout nguồn. Cách này
giữ graph root ổn định khi chaincode cũng là workspace của monorepo.
High/moderate làm lệnh thất bại. CI lưu cùng bằng chứng dưới dạng artifact cho
workspace và chaincode độc lập. Xem [báo cáo AGT-002](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/4d92f02122cbb0b4342372474f466c9146522365/docs/dependency-audit-2026-10-06.md).
