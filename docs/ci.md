# CI của Agri Trace

CI chạy trên PR vào `main`, push lên `main`, merge queue và thao tác
`workflow_dispatch`. Push lên nhánh làm việc được kiểm tra qua PR để tránh
chạy lặp cùng thay đổi bằng cả push và PR. Runner cố định `ubuntu-24.04`;
actions được cố định bằng SHA và cập nhật qua Dependabot.

## Các điều kiện merge

| Check bắt buộc | Kiểm tra |
| --- | --- |
| `Application gate` | API/Web trên Node 22.22.3, 24.15.0, 26.0.0; ứng dụng di động (`apps/mobile`) trên Node 22.22.3, 24.15.0; migration/API E2E PostgreSQL (gồm guard SQL, bàn giao Hybrid và provisioning production); production API, Web và Worker; `Production rehearsal`; PR không được sửa migration đã có. |
| `Blockchain gate` | Gateway/chaincode trên ba phiên bản Node; coverage chaincode; cài/audit/check chaincode độc lập; Worker contract; API → outbox → Worker → Fabric → proof. |
| `Dependency gate` | Audit ba lockfile (workspace, chaincode độc lập, `apps/mobile`) và dependency đã cài; kiểm peer graph workspace; chặn moderate/high/critical, gồm dependency phát triển. Lockfile mobile chỉ được miễn những GHSA ghi trong `apps/mobile/audit-exceptions.json`, mỗi mục có lý do và hạn rà soát. |

Mỗi workflow tạo gate cho mọi PR, kể cả PR chỉ sửa tài liệu. Việc chọn job
diễn ra trong `scripts/ci/changes.mjs`, thay vì bỏ cả workflow bằng `paths`:
PR tài liệu không bị kẹt ở một required check chưa được tạo. Gate từ chối
job lỗi, bị hủy, kết quả thiếu và job bị skip dù thay đổi yêu cầu nó chạy.
Lỗi audit không ngăn lint/test/build trả kết quả nhưng vẫn chặn merge qua
`Dependency gate`. Strict status checks yêu cầu kiểm tra trên nhánh đã cập
nhật với `main`.

Mọi push lên `main` chạy đầy đủ các job trên đúng SHA, kể cả commit tài liệu.
CD dùng ba workflow push thành công của SHA đó: nếu chọn job theo diff của
push, một commit tài liệu sau commit code chưa đạt có thể tạo gate xanh khi
API/Web/Fabric bị bỏ qua. Chỉ PR được tối ưu bằng chọn đường dẫn. Test logic
chọn job và gate chạy trong job `changes` của Application CI, trước các job
có điều kiện; không phụ thuộc việc API có được chọn hay không.

CD yêu cầu bằng chứng push của đúng branch, SHA và lần chạy mới nhất của cả
ba workflow. Kết quả PR hoặc CI của `dev` không cho phép triển khai, kể cả
khi hai nhánh cùng SHA. Application CI diễn tập PostgreSQL trong container có
label, network/volume riêng và quota trên runner: cold TCP readiness,
backup/restore và dữ liệu giữ qua restart; cleanup kiểm ownership. Đây là gate
database. Fabric thật tiếp tục được kiểm bởi Blockchain CI và release verifier.

Vận hành domain, khóa triển khai và các công tắc CD theo
[runbook production](production-runbook.md). Production là target duy nhất;
công tắc GitHub/server chỉ bật sau khi cài helper đã review và đủ release gates.

Ruleset GitHub phải bắt buộc đúng ba **tên job** ở bảng trên, nguồn check là
GitHub Actions. Tệp workflow không tự bật branch protection. Giữ các quy
tắc PR, chống xóa nhánh và chống force push đang có khi cập nhật ruleset.

## Phạm vi thay đổi PR và job cần chạy

| Thay đổi | Các kiểm tra được chọn |
| --- | --- |
| `apps/api/**`, gồm Worker và migration | API, production containers, production rehearsal, tích hợp Fabric. |
| `apps/web/**` | Web, production containers, production rehearsal. |
| `apps/mobile/**` | Mobile (typecheck, lint, Jest, bundle Android/iOS bằng `expo export`). Project độc lập với lockfile riêng, bị loại khỏi Docker context nên không chọn production containers. Workflow riêng `Mobile APK` build APK cài thử (ký khóa debug) và lưu artifact 14 ngày; đây không phải required check và không phải đầu vào của CD. |
| `blockchain/gateway/**` | API là consumer, Gateway/chaincode, production containers, tích hợp Fabric. |
| `blockchain/chaincode/**`, `blockchain/network/**` | Gateway/chaincode, tích hợp Fabric. |
| Compose và các override Compose | Production containers, production rehearsal, tích hợp Fabric. |
| Root manifests/lockfile, cấu hình npm/Node, Docker ignore, CI scripts/workflows, manifest chaincode dùng trong Docker build | Tất cả. |
| `docs/sql/**` | API, production containers, tích hợp Fabric; SQL fixtures không coi là tài liệu thuần. |
| Chỉ tài liệu khác | Gate vẫn chạy; job nặng được skip có kiểm tra. Audit vẫn chạy. |

Mọi push `main`, dispatch và merge queue chạy toàn bộ pipeline. Git diff PR
không giới hạn 300 file. Đổi tên được xét như xóa và thêm để kiểm tra cả
đường dẫn nguồn và đích, kể cả khi chuyển giữa workspace hoặc sang tài liệu.
Test hồi quy dùng Git repository thật để xác nhận các trường hợp này.
Không lấy source từ PR qua
`pull_request_target`; token workflow chỉ có `contents: read`, checkout
không giữ credentials.

## Production rehearsal

Môi trường UAT cũ đã retire và không còn stack nào của nó trong CI. Job `Production rehearsal`
(`deploy/ci/rehearse.mjs`, timeout 60 phút, chạy khi `containers` được chọn) kiểm bằng
chính mô hình ứng dụng production (`docker-compose.app.yml` cộng overlay CI) trên PostgreSQL 18
cách ly và image API/Web build từ commit:

1. Cả `deploy/edge/Caddyfile` và Caddyfile CI đều qua `caddy validate`. Proxy CI dùng chính
   snippet `(application)` trích từ file production, nên đổi routing production là đổi bài test.
   HTTPS chỉ kiểm ở mức cấu hình.
2. Mô hình Compose còn quota CPU/RAM cho mọi service, chỉ proxy được publish và chỉ ở loopback.
3. Migration chạy từ DB rỗng, chạy lại là no-op và checksum trong `_prisma_migrations` khớp repo.
4. `db:provision-compliance-role` tạo một lần rồi replay; provisioning production (cùng
   transaction với `bootstrap-production.mjs`) tạo năm tài khoản rồi replay không đổi gì.
5. Luồng nghiệp vụ và phiên qua proxy: đăng nhập, RBAC từ chối, replay idempotency, hai harvest,
   ShipmentPlan đồng thuận, receive/reject, QR công khai `PENDING`, xoay refresh và logout.
6. Mọi trace event đã lưu được validator chaincode đã biên dịch chấp nhận (chỉ đọc).
7. Backup bằng `pg_dump`, xóa volume, restore vào DB rỗng; số lượng bảng và băm event giống hệt,
   migration vẫn là no-op, tài khoản/lot/QR vẫn dùng được.
8. Image API không mang script hoặc fixture UAT.

Trước backup, rehearsal dừng writers rồi stop/start PostgreSQL trên cùng volume;
số lượng dữ liệu ứng dụng, băm trace event và checksum migration phải giữ nguyên.
Kiểm này thay bài `retained_marker` riêng, nên chỉ còn một bộ backup/restore và
retention dùng dữ liệu ứng dụng thật.

Hai job container vẫn độc lập: `Production containers` kiểm Web cấu hình local,
còn rehearsal build Web với same-origin và origin của edge CI. Không dùng chung
image Web giữa hai cấu hình. Tối ưu cache/build API cần đo thời gian truyền image
và giữ các gate hiện tại trước khi đưa vào một thay đổi riêng.

Tài nguyên mang nhãn Compose của đúng lần chạy, job từ chối tài nguyên sẵn có, chỉ chạy trên
GitHub runner và không đọc secret, database, identity hay volume của VPS. Kết quả nằm ở artifact
`production-rehearsal-<SHA>` (14 ngày). Fabric thật không nằm ở đây mà ở `fabric-smoke` và
`hybrid-fabric`. Bài kiểm tra PostgreSQL cho provisioning production
(`deploy/ci/bootstrap-production.test.mjs`) chạy trong job `API` trên ba phiên bản Node.
Job `changes` còn chạy `deploy/ci/migrations-immutable.mjs`: PR sửa, xóa hoặc đổi tên migration
đã có sẽ lỗi, chỉ được thêm migration mới.

## Hybrid trong CI

Application CI chạy SQL/binding/dual handover, migration lịch sử và cleanup cài
mới trên PostgreSQL 18. Blockchain CI có job `Hybrid A B C real Fabric and browser`:
mạng 3 Org cách ly, API → Worker → ledger, fault/load và Chromium desktop/mobile.
Job đặt `HYBRID_FABRIC_E2E=1` và từ chối required tests bị skip. Fixture/harness
không cấp quyền Admin/Auditor ghi nghiệp vụ để vượt test. CI xanh đúng SHA là cổng
source; smoke thực trên VPS vẫn bắt buộc theo [kế hoạch phát hành](plans/hybrid-production-readiness-2026-10-13.md).

## Production và Fabric smoke

Application CI build và khởi động đủ PostgreSQL/API/Worker/Web. Kiểm tra
HTTP của API/Web và readiness của Worker qua `docker compose exec`, không
mở cổng health Worker ra ngoài. Ở bài kiểm tra này Fabric bị tắt; phải xác
nhận Worker cũng ở trạng thái disabled, không coi đó là bằng chứng gửi
giao dịch lên ledger.

Web check gọi optimizer thực của Next.js để chuyển PNG sang PNG/JPEG/WebP/AVIF
với `sharp` đã vá. Production smoke còn gọi `/_next/image` và kiểm WebP trả
về để xác nhận native binary có thể dùng trong image Alpine và standalone.

Blockchain CI dùng Fabric 2.5.16, CA 1.5.22 và technical relayer của mạng
thử nghiệm. Installer cố định tại commit
`f871cf92a026aba7b12e6f06d71ded3e6e659d71` của Fabric v2.5.16; samples tại
`5789681b4f4d24e58fa40f19a69f5496892374b6`. Bootstrap không fallback sang
nhánh upstream đang thay đổi; chỉ nhận override bằng SHA đầy đủ.
`docker-compose.ci.yml` nối riêng Worker vào `fabric_test`,
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

Gateway chạy trên host runner dùng `localhost:7051`; Worker trong container
dùng `peer0.org1.example.com:7051` trên mạng Docker. Test Web dùng Web Storage
của cửa sổ JSDOM, kể cả trên Node 26 có global storage riêng.

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
02:23 UTC (09:23 Việt Nam). Hai artifact lockfile có tên gắn SHA, lưu 14 ngày.
Job `Audit / mobile` (`npm run audit:mobile`) audit lockfile của `apps/mobile`
với cùng ngưỡng moderate; advisory chưa có bản vá trong toolchain Expo chỉ được
miễn khi có mục trong `apps/mobile/audit-exceptions.json`. Mục quá `reviewBy`
hoặc không còn xuất hiện làm job thất bại, nên danh sách phải được rà lại định kỳ.
Job `Workspace dependency graph` cài sạch, audit đầy đủ/production và kiểm
`npm ls --all`; artifact kèm head/checkout SHA, Node/npm và checksum được
lưu 90 ngày. Job `Standalone chaincode` giữ quy trình cài/audit/check độc
lập và evidence 90 ngày đã có trên `main`, được yêu cầu bởi `Blockchain gate`.
Ngưỡng moderate của AGT-002 được giữ khi tích hợp ngày 06/10/2026.
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

Audit mới ngày 06/10/2026 phát hiện
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
ở `sharp` 0.35.4. Override cố định 0.35.5 cùng các native package/libvips
trong lockfile; giữ Next.js/NestJS hiện có. Kiểm optimizer và production HTTP
ở trên xác nhận khả năng tương thích của bản vá.

Advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
của `braces <=3.0.3` được xử lý bằng cách loại chuỗi
`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`.
Giữ Next.js 15.5.25 và các plugin ESLint đã dùng; thay `next lint` bằng
ESLint flat config cùng plugin Next.js native của Oxlint. Oxlint đã có trong
workspace API. Lockfile không còn các package trong chuỗi trên. Audit toàn
bộ workspace, runtime và chaincode độc lập đều trả về 0 advisory tại thời
điểm kiểm tra ngày 05/10/2026. Bản tích hợp giữ ngưỡng moderate/high/critical
đã có trên `main`; không có allowlist hoặc ngoại lệ.

Một lỗi peer dependency có sẵn cũng được sửa: SWC của API yêu cầu
`@swc/helpers >=0.5.17`, trong khi Next.js cần đúng 0.5.15. API khai báo
helper 0.5.17 riêng ở devDependencies để đáp ứng cả hai consumer, giữ nguyên
helper của Next.js. `npm ls --all` phải thành công sau khi cài sạch.

Dependabot kiểm dependency và action hàng tuần, không tự merge và không
đề xuất nâng major npm trong cấu hình này.

## Hợp đồng lint Web

`apps/web/scripts/lint-policy.json` ghi lại 71 rule TypeScript và 67 rule
JavaScript của cấu hình `next/core-web-vitals` và `next/typescript` theo baseline
`1156c04`, gồm mức warning/error
và tùy chọn. Tùy chọn mặc định của hai rule ESLint được ghi rõ để giữ hành vi:

- ESLint chạy 50 rule cho TypeScript, 46 cho JavaScript, gồm React, TypeScript,
  hooks, accessibility và import bằng
  cùng các plugin; giữ việc đánh dấu import/component được dùng trong JSX.
- Oxlint chạy 21 rule Next.js bằng plugin native; tắt nhóm correctness mặc
  định vì các rule ESLint đã kiểm riêng. Không bỏ rule Next.js hoặc hạ mức lỗi.
- `npm run lint --workspace apps/web` bắt buộc cả hai engine thành công.
  API và Web dùng `--max-warnings 0` trong lint: warning cũng chặn lint/check,
  giữ nguyên rule và severity để diagnostic vẫn rõ. Build Web chạy lint;
  hợp đồng kiểm build bị chặn bởi cả warning và error của từng engine.
  `npm run build --workspace apps/web` chạy lint trước Next.js. Cấu hình
  `ignoreDuringBuilds` chỉ tránh lần lint nội bộ lặp của Next.js; dùng lệnh
  build trong package.json để đảm bảo điều kiện này.
- `npm run lint:contract --workspace apps/web` kiểm cấu hình đủ 71 rule,
  kiểm `npm ls --all`, cố tình vi phạm từng rule có diagnostic, kiểm mẫu hợp lệ
  và thực sự gọi build với lỗi từ từng engine để xác nhận compiler chưa được chạy. File canary
  có tên ngẫu nhiên và được xóa sau test; fixture nằm trong thư mục tạm riêng.
  Hợp đồng chạy trong `npm run check`, trên cả ba phiên bản Node trong CI.

Liên kết tra cứu `/scan` trên trang đăng nhập đã chuyển sang `next/link` sau
khi rule `no-html-link-for-pages` phát hiện điều hướng nội bộ bằng thẻ `a`.

## Chạy lại tại máy phát triển

```bash
npm ci --no-audit --no-fund
npm run test:ci
npm run test:worker-contract
npm run lint:contract --workspace apps/web
npm audit --package-lock-only --audit-level=moderate
npm audit --package-lock-only --omit=dev --audit-level=moderate
npm run audit:dependencies -- workspace dependency-evidence
npm run check:chaincode:standalone -- dependency-evidence
```

Audit standalone dùng `npm audit --workspaces=false --package-lock-only
--audit-level=moderate` trong `blockchain/chaincode`.

`npm run check` cần `DATABASE_URL` và `TEST_DATABASE_URL` trỏ tới database
test riêng đã chạy migration. Không dùng database nghiệp vụ để chạy E2E.
Lệnh này chạy `test:ci` trước các workspace. `test:ci` gồm test chọn job,
CI gate và CD gate/SSH transport; các test transport chỉ chạy trên Linux.
E2E từ chối chạy nếu thiếu `TEST_DATABASE_URL`, tránh kết quả xanh khi các
bài PostgreSQL bị skip. Test controller/policy Python chạy riêng trong CI:
`python -m unittest discover -s deploy/cd -p 'test_*.py' -v`; controller cần
Linux để kiểm durable directory fsync.
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
không thay bằng chứng matrix 24/26, PostgreSQL 18 trong CI, production
containers hoặc Fabric thật. Không suy ra nghiệm thu toàn bộ các issue
từ việc thêm workflow; advisory high/critical mới vẫn là điều kiện chặn merge.
