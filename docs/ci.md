# CI của Agri Trace

CI chạy trên PR vào `main`, push sau merge vào `main`, merge queue và thao tác
`workflow_dispatch`. Push lên nhánh làm việc được kiểm tra qua PR để tránh
chạy lặp cùng thay đổi bằng cả push và PR. Runner cố định `ubuntu-24.04`;
actions được cố định bằng SHA và cập nhật qua Dependabot.

## Các điều kiện merge

| Check bắt buộc | Kiểm tra |
| --- | --- |
| `Application gate` | API/Web trên Node 22.22.3, 24.15.0, 26.0.0; migration và API E2E PostgreSQL; production API, Web và Worker. |
| `Blockchain gate` | Gateway/chaincode trên ba phiên bản Node; coverage chaincode; Worker contract; API → outbox → Worker → Fabric → proof. |
| `Dependency gate` | Audit lockfile workspace và lockfile chaincode triển khai độc lập; chặn high/critical, gồm dependency phát triển. |

Mỗi workflow tạo gate cho mọi PR, kể cả PR chỉ sửa tài liệu. Việc chọn job
diễn ra trong `scripts/ci/changes.mjs`, thay vì bỏ cả workflow bằng `paths`:
PR tài liệu không bị kẹt ở một required check chưa được tạo. Gate từ chối
job lỗi, bị hủy, kết quả thiếu và job bị skip dù thay đổi yêu cầu nó chạy.
Lỗi audit không ngăn lint/test/build trả kết quả nhưng vẫn chặn merge qua
`Dependency gate`. Strict status checks yêu cầu kiểm tra trên nhánh đã cập
nhật với `main`.

Ruleset GitHub phải bắt buộc đúng ba **tên job** ở bảng trên, nguồn check là
GitHub Actions. Tệp workflow không tự bật branch protection. Giữ các quy
tắc PR, chống xóa nhánh và chống force push đang có khi cập nhật ruleset.

## Phạm vi thay đổi và job cần chạy

| Thay đổi | Các kiểm tra được chọn |
| --- | --- |
| `apps/api/**`, gồm Worker và migration | API, production containers, tích hợp Fabric. |
| `apps/web/**` | Web, production containers. |
| `blockchain/gateway/**` | API là consumer, Gateway/chaincode, production containers, tích hợp Fabric. |
| `blockchain/chaincode/**`, `blockchain/network/**` | Gateway/chaincode, tích hợp Fabric. |
| Compose và các override Compose | Production containers, tích hợp Fabric. |
| Root manifests/lockfile, cấu hình npm/Node, Docker ignore, CI scripts/workflows, manifest chaincode dùng trong Docker build | Tất cả. |
| Chỉ tài liệu | Gate vẫn chạy; job nặng được skip có kiểm tra. Audit vẫn chạy. |

Dispatch, merge queue và push thiếu SHA nền chạy toàn bộ pipeline. Git diff
không giới hạn 300 file và xử lý cả xóa/đổi tên. Không lấy source từ PR qua
`pull_request_target`; token workflow chỉ có `contents: read`, checkout
không giữ credentials.

## Production và Fabric smoke

Application CI build và khởi động đủ PostgreSQL/API/Worker/Web. Kiểm tra
HTTP của API/Web và readiness của Worker qua `docker compose exec`, không
mở cổng health Worker ra ngoài. Ở bài kiểm tra này Fabric bị tắt; phải xác
nhận Worker cũng ở trạng thái disabled, không coi đó là bằng chứng gửi
giao dịch lên ledger.

Blockchain CI dùng Fabric 2.5.16, CA 1.5.22 và technical relayer của mạng
thử nghiệm. `docker-compose.ci.yml` nối riêng Worker vào `fabric_test`,
mount đúng thư mục `relayer/msp` ở chế độ đọc và chạy bằng UID/GID chủ khóa.
API không nhận signing identity. Script `fabric-integration.mjs` thực hiện:

1. Tạo catalog/tài khoản test riêng, đăng nhập qua production HTTP API.
2. Tạo cycle, kiểm replay `Idempotency-Key`, plant, care và harvest tạo Lot/QR.
3. Khi Worker dừng: kiểm event/outbox đã commit, chưa có proof, API/QR là
   `PENDING`.
4. Bật production Worker: đợi outbox về `COMPLETED`, proof về `CONFIRMED`;
   không có thêm/mất business event hoặc dead-letter.
5. Query Fabric trực tiếp, đối chiếu event/hash/transaction id với PostgreSQL
   và API; kiểm predecessor, entity head/history, toàn bộ QR là `VERIFIED`.
6. Kiểm health loop hoạt động, không có lỗi và backlog rỗng.

Bài kiểm tra hợp đồng nhanh dùng Worker đã compile và validator thực của
chaincode, trước khi dựng Docker/Fabric. Nó đã phát hiện Worker gửi field
`hasBusinessPayload` bị chính sách metadata của chaincode từ chối. Worker
hiện bỏ field tùy chọn đó. Bài kiểm tra nhanh dùng database/transport giả;
bài kiểm tra production/Fabric xác minh luồng bằng các dịch vụ thật.

Artifact `fabric-integration-<SHA>` giữ kết quả, các bước, event id, hash và
tx id trong 14 ngày. Password test được tạo ngẫu nhiên; JWT, private key và
payload riêng tư không được ghi vào artifact. Stack dùng database/volume
riêng và được dọn trong `always()`, kể cả khi kiểm tra lỗi.

## Audit và dependency

Audit độc lập chạy trên mọi PR, merge queue, `main`, dispatch và mỗi thứ Hai
02:23 UTC (09:23 Việt Nam). Hai artifact audit có tên gắn SHA, lưu 14 ngày.
Audit bao gồm dependency phát triển. `--no-audit` trong bước cài đặt các job
code chỉ bỏ audit lặp; không thay đổi ngưỡng của `Dependency gate`.

Các bản vá ngày 05/10/2026:

- `@grpc/grpc-js`: 1.14.4 → 1.14.5, vá
  [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j).
- `brace-expansion`: giữ nhánh 1.x/2.x bằng 1.1.21/2.1.2; nhánh 4.x chuyển
  sang 5.0.12 vì bản vá advisory nằm ở nhánh 5.x. Kiểm lint/typecheck/test
  xác nhận các consumer hiện có vẫn hoạt động.
- `fast-uri` nhánh 3.x: 3.1.8. Giữ major Next.js/NestJS và lockfile chaincode
  độc lập đang sạch; không dùng `npm audit fix --force`.

**Còn chặn merge:** [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
của `braces <=3.0.3` chưa có bản vá. Dependency đi qua
`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`
và chỉ thuộc bộ lint phát triển. npm báo 5 package high từ một advisory gốc.
Audit runtime (`--omit=dev`) và audit chaincode độc lập hiện không có advisory.
Theo quyết định của chủ dự án ngày 05/10, giữ gate đỏ cho advisory này;
không có allowlist, ngoại lệ hoặc hạ ngưỡng audit.

Theo dõi bản vá upstream hoặc đánh giá một thay đổi tooling riêng có kiểm
chứng tương đương; không hạ major framework hay bỏ rule lint chỉ để audit
chuyển xanh. Dependabot kiểm dependency và action hàng tuần, không tự merge
và không đề xuất nâng major npm trong cấu hình này.

## Chạy lại tại máy phát triển

```bash
npm ci --no-audit --no-fund
npm run test:ci
npm run test:worker-contract
npm audit --package-lock-only --audit-level=high
npm audit --package-lock-only --omit=dev --audit-level=high
```

Audit standalone dùng `npm audit --workspaces=false --package-lock-only
--audit-level=high` trong `blockchain/chaincode`.

`npm run check` cần `DATABASE_URL` và `TEST_DATABASE_URL` trỏ tới database
test riêng đã chạy migration. Không dùng database nghiệp vụ để chạy E2E.
Để chạy smoke Fabric, dựng network bằng các lệnh trong README Blockchain,
build Gateway, đặt `COMPOSE_PROJECT_NAME` riêng, khởi động `postgres api`
bằng hai file Compose rồi chạy `node scripts/ci/fabric-integration.mjs`.
Trên Linux đặt `CI_WORKER_UID`/`CI_WORKER_GID` theo chủ identity. Dọn đúng
Compose project và mạng thử nghiệm sau khi hoàn tất.

## Nghiệm thu

Đối chiếu với [AGT-002](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/14),
[AGT-003](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/15) và
[AGT-004](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/16).
Mỗi kết quả phải gắn đúng SHA và môi trường. Kiểm tra local trên Node 22
không thay bằng chứng matrix 24/26, PostgreSQL 16 trong CI, production
containers hoặc Fabric thật. Không suy ra nghiệm thu toàn bộ các issue
từ việc thêm workflow; advisory chưa vá vẫn là điều kiện chặn merge.
