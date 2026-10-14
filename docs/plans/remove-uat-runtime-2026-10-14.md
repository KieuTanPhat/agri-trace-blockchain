# Gỡ runtime UAT khỏi CI, controller và image

Lập ngày 14/10/2026. Baseline `main` `28d1f9c` (sau PR #98). Thực hiện trong
worktree mới từ `origin/main`, nhánh `refactor/remove-uat-runtime`, một PR gồm
hai bước, một lần merge và một lần triển khai cuối.

## Quyết định của chủ dự án

- UAT (schema 2, project `agri-trace-uat`, controller cũ) đã retire. Production
  schema 3 tại `https://agritrace.dev` là đích triển khai duy nhất.
- Không giữ mã UAT để rollback hay áp dụng lại release UAT cũ. `docs/contabo-cd-runbook.md`
  bị xóa hẳn; lịch sử nằm trong Git. Sửa mọi link trỏ tới file này.
- Giữ `docker-compose.app-fabric.yml` và `blockchain/network/network.ps1`.
- Bộ rehearsal production là job riêng trong Application CI. HTTPS chỉ kiểm ở mức
  validate cấu hình.
- Thu hồi quyền truy cập UAT cũ là việc riêng của operator, theo dõi bằng Issue.
- `docs/plans` tiếp tục là nguồn quyết định và acceptance. Chỉ sửa câu chữ nhắc
  UAT trong các plan khác khi câu đó không còn đúng.

## Không thay đổi

- API nghiệp vụ, phân quyền, schema, migration, hash, proof, journal/outbox.
- Checkout, worktree, thư mục được bảo vệ và tài nguyên G.
- Mọi tài nguyên trên VPS. Hai volume `agri-trace-uat_caddy-data` và
  `agri-trace-uat_caddy-config` đang giữ chứng chỉ HTTPS production.
- Migration, release record production và tài liệu lịch sử khác. Mục tiêu không
  phải xóa mọi chữ "UAT" khỏi lịch sử Git.
- Hostname giám sát và Datadog trên VPS.

## Pha 0 — Xác minh chỉ đọc trước khi viết controller

Operator chạy lệnh chỉ đọc và đưa kết quả vào Issue/PR:

- `/etc/agri-trace-cd/prod/config.json` có `schema: 3`, `project: agritrace-prod`.
- `/opt/agri-trace/cd/state.json` có `current`, `previous` đều là `prod-*` hoặc rỗng.
- Không có `journal.json` và không có delivery đang chạy.
- File `.env` của edge trỏ đúng hai volume Caddy ở trên.

Nếu có record không phải `prod-*`, dừng và quyết định lại trước khi controller
từ chối các release đó.

## Bước 1 — Bổ sung kiểm thử thay thế

Điều chỉnh sau khi rà soát CI trên `main`: Blockchain CI đã có `fabric-smoke` (Fabric
2 org, API → outbox → Worker → Fabric → proof `CONFIRMED`) và `hybrid-fabric` (3 org,
PostgreSQL 18, ledger acceptance, API/Worker e2e, tải, trình duyệt). Bộ rehearsal mới
**không dựng thêm mạng Fabric**; nó chỉ lấp phần chạy image production mà bộ UAT từng
kiểm. Việc event được ledger chấp nhận là `VALID` tiếp tục do hai job trên chứng minh.

Phần thay thế gồm ba mảnh, đều nằm trong `deploy/ci/`:

1. **Kiểm thử PostgreSQL thật cho provisioning production** (`bootstrap-production.test.mjs`,
   chạy trong job `api` trên cả ba Node). `bootstrap-production.mjs` chưa có test nào;
   phần DB của nó được tách thành `provisionBusinessCatalog` (không đổi hành vi) để test
   chính transaction production: tài khoản băm bcrypt, tổ chức và capability do trigger cấp,
   chain `ACTIVE`, grant theo scope, replay idempotent, đổi mật khẩu bị từ chối, xung đột
   muộn rollback toàn bộ, và `validateBootstrap` từ chối ngữ cảnh/giá trị không an toàn.
2. **Job `Production rehearsal`** (`rehearse.mjs`, timeout 60 phút, chạy khi `containers`
   được chọn, song song với `Production containers`, `Application gate` gom kết quả):
   - Chạy mô hình `docker-compose.app.yml` của production cộng overlay CI; PostgreSQL 18
     cách ly; image API/Web build từ commit. Fabric tắt, không bật Worker.
   - Tài nguyên theo nhãn Compose của run; từ chối tài nguyên sẵn có; chỉ chạy trên GitHub
     runner. Không đọc secret, database, identity hay volume của VPS.
   - Proxy dùng chính snippet `(application)` trích từ `deploy/edge/Caddyfile`; cả file đó và
     file sinh ra đều qua `caddy validate`. HTTPS chỉ kiểm mức cấu hình.
3. **Kiểm tra migration bất biến** (`migrations-immutable.mjs`, trong job `changes`): PR không
   được sửa, xóa hay đổi tên migration đã có.

| Assertion của bộ UAT | Thay thế |
| --- | --- |
| Migrate qua `check-migrate.py` | Migrate từ DB rỗng, chạy lại là no-op, checksum `_prisma_migrations` khớp repo; PR không đổi migration cũ |
| `bootstrap.test.mjs`: replay, xung đột, rollback | `bootstrap-production.test.mjs` trên transaction production |
| Bootstrap chạy hai lần | `provision.mjs` chạy hai lần trong rehearsal: 5 tài khoản rồi 0 |
| `provision-compliance-role` created=1 rồi created=0 | Giữ nguyên, chạy trên image production |
| `smoke.mjs` | `smoke.mjs` mới: đăng nhập/me, RBAC 403, idempotency replay, hai harvest, shipment plan đồng thuận, receive/reject, QR công khai `PENDING`, refresh rotation/logout |
| `check-uat-events.mjs` | `check-events.mjs`: mọi event được validator chaincode đã biên dịch chấp nhận (chỉ đọc; từ chối kết quả rỗng) |
| Proxy và HTTPS config | Gọi qua proxy dùng snippet production; `caddy validate` cho cả hai Caddyfile |
| Backup → restore → smoke | `pg_dump` → xóa volume → restore vào DB rỗng bằng `--exit-on-error --single-transaction`; số lượng và băm event giống hệt; migrate no-op; đăng nhập, lot, QR và event vẫn hợp lệ |
| Quota CPU/RAM, chỉ publish loopback | `composeModelErrors` kiểm mô hình Compose |

Giới hạn đã biết: rehearsal không chứng minh ledger `VALID` (đã có ở Blockchain CI) và
chưa kiểm HTTPS thật. Rehearsal chưa từng chạy trên máy phát triển (không có Docker);
bằng chứng đầu tiên là run CI của PR.

Push bước 1 riêng và chờ CI trên đúng SHA đó. Run này là bằng chứng hai bộ chạy
song song và đều xanh.

## Bước 2 — Chuyển CI và xóa phần UAT

- Bỏ phần stack UAT khỏi `Production containers`; giữ job và `Application gate`.
  Blockchain CI và Dependency Audit vẫn bắt buộc.
- Xóa: `docker-compose.uat.yml`, `docker-compose.uat-https.yml`, `docker-compose.uat-fabric.yml`,
  `.env.uat.example`, `deploy/Caddyfile.uat`, `deploy/{config,prepare,preflight,smoke,database,fixtures}.mjs`,
  `deploy/config.test.mjs`, `deploy/bootstrap.test.mjs`, `apps/api/scripts/bootstrap-uat.mjs`,
  `apps/api/scripts/check-uat-events.mjs`, `deploy/cd/check-migrate.py`, `docs/contabo-cd-runbook.md`.
- Bỏ `COPY deploy/fixtures.mjs` khỏi `apps/api/Dockerfile`; giữ `bootstrap-production.mjs`.
- Cập nhật `package.json` (`test:ci`), `scripts/ci/changes.mjs`, `scripts/ci/ci.test.mjs`.
- Trước khi xóa, gửi chủ dự án manifest gồm đường dẫn, dung lượng, caller đã xử lý
  và cách khôi phục (`git checkout 28d1f9c -- <path>`). Chỉ xóa sau khi được duyệt.

## Bước 3 — Thu gọn controller và tiện ích

Controller chỉ nhận config schema 3, manifest format 2, target production và
release `prod-*`. Đầu vào UAT/schema cũ bị từ chối với thông báo rõ ràng.

- Xóa `deploy/cd/{install,cutover,aliases}.py` cùng test; `deploy/cd/verify.mjs`.
  Chuyển tiện ích dùng chung (khóa quản trị…) sang phần production trước khi xóa.
- `controller.py`: bỏ nhánh schema `None`/2, Compose `docker-compose.uat*.yml`,
  project `agri-trace-uat`, prefix `uat-`. `install-target.py`: bỏ `install`,
  `adopt-legacy`, `legacy_production_config()` và `fresh-install` chỉ chuyển schema 2
  đã tắt sang schema 3, cùng phần cấp identity chỉ được lệnh đó gọi. Giữ
  first-install/recover của controller production và kiểm archive/floor của luồng đó.
  `targets.py`, `publish.mjs`: bỏ ngoại
  lệ `agri-trace-uat`. `policy.py`: bỏ `FIXED_FILES` và `verify.mjs` khỏi `CONTROLLER_FILES`.
  `package.py`: chỉ đóng gói format 2.
- `app-fabric` được giữ theo quyết định chủ dự án. Sau thay đổi, controller schema 3
  không ghép file này khi chạy, nhưng file vẫn nằm trong `APP_FILES` và manifest.
- Giữ kiểm checksum helper, image digest, migration, backup mã hóa, journal,
  trạng thái CLOSED và hybrid-floor.
- `deploy/edge/admin.py`: bỏ thao tác `cutover` và phần adopt container
  `agri-trace-uat-*` trong `prepare`; giữ `reload` và tham chiếu hai volume Caddy.
- `deploy/observability/*`: sửa giá trị mặc định trong repo; không nạp lại trên VPS.
- Web: giữ cơ chế same-origin/cookie; chỉ sửa chú thích và tên test mang chữ UAT.

**Hành vi với record cũ** (ghi bằng test, không nới lỏng `preflight`):

- `rollback_to` không gọi `preflight`, nên rollback về record production đã verified
  vẫn đọc nguyên manifest/hash cũ.
- Deploy lại release đang chạy và resume lần cài đầu có gọi `preflight`. Sau cập nhật,
  hai đường này chỉ nhận record đóng gói với controller mới. Record cũ liệt kê
  `verify.mjs` sẽ bị chặn; đây là hành vi chủ ý.

**Thao tác `update-controller`** trong `install-target.py`:

- Operator đối chiếu SHA checkout đã review; installer kiểm digest helper, giữ khóa delivery và host; từ chối khi có journal
  hoặc delivery đang chạy.
- Cài helper vào thư mục theo digest, đổi symlink nguyên tử, giữ bản trước để phục hồi; lỗi đổi symlink hoặc ghi marker previous phải khôi phục bản cũ.
- Không đổi config production, quyền SSH, database, mạng hay container đang chạy.

## Rà soát bổ sung trong cùng PR

Chủ dự án cho phép tự rà và xóa phần chỉ phục vụ UAT hoặc lần gỡ UAT; mỗi mục xóa
phải có lý do và cách khôi phục trong mô tả PR. Quyền này không bao gồm tài nguyên VPS.

- Bỏ `deploy/cd/rehearse-production.py` và caller trong Application CI sau khi
  chuyển kiểm stop/start PostgreSQL cùng volume vào rehearsal thật. Giữ TCP
  readiness, migrate/checksum, provisioning, backup/restore vào DB rỗng và smoke
  sau restore. Không mất assertion giữ dữ liệu qua restart.
- Giữ test provisioning PostgreSQL, helper/quota/ownership, migration bất biến và
  hồi quy smoke: chúng bảo vệ CI và delivery production lâu dài. Không xóa chỉ vì
  production runtime không trực tiếp chạy test.
- Thêm test Edge `prepare`, `start` và rollback config của `reload` trên thư mục
  tạm, mock Docker/health. Kiểm root/locks, volume từ môi trường đã duyệt, thiếu
  volume/config dừng trước thay đổi; validation dùng storage tạm.
- Commit `AGENTS.md` bằng tiếng Việt, giữ bất biến và quy tắc nhánh; chỉ dẫn vận
  hành trỏ vào runbook production hiện hành.
- Giữ hai job container độc lập vì tham số build Web khác nhau. Chia sẻ image
  hoặc cache chỉ thực hiện sau khi đo lợi ích và giữ nguyên độ phủ/gate; không
  gộp mô hình local và same-origin edge để giảm build.
- Gỡ quy trình chuyển target schema 2 khỏi runbook; giữ quyết định/acceptance trong
  `docs/plans`, hướng dẫn cập nhật controller và recovery production.

Khôi phục file/đoạn đã gỡ trên một nhánh mới bằng `git restore --source=28d1f9c -- <path>`
(hoặc SHA trước thay đổi ghi trong PR), rồi review qua PR; không chạy lại UAT trên VPS.

## Điều kiện hoàn thành PR

- `npm run check`, `api-contract:check`, build Web và toàn bộ test controller đạt.
- Application, Blockchain và Dependency CI xanh trên SHA cuối; không bỏ job bắt buộc.
- 20 migration giữ nguyên checksum so với baseline.
- Image API không chứa script hay fixture UAT.
- Luồng chạy hiện hành không còn tham chiếu UAT. Ngoại lệ: tài liệu lịch sử, quy tắc
  ignore bảo vệ dữ liệu cũ, test từ chối UAT, tên hai volume Caddy và hostname
  Datadog `agritrace-uat` được chủ dự án yêu cầu giữ nguyên.
- Có test: schema cũ, manifest cũ, project UAT bị từ chối; sai checksum vẫn chặn delivery.
- Có test: installer gặp khóa/journal dừng trước khi thay đổi; lỗi giữa cập nhật
  phục hồi controller cũ.
- Có test: deploy, rollback, recover với record production hiện tại và candidate mới;
  giữ hybrid-floor, số lượng event, hash/proof và journal.
- Bộ Hybrid Fabric/browser đầy đủ xanh, gồm kiểm hồi quy đăng nhập của PR #98.

Bằng chứng và manifest xóa nằm trong PR/artifact, không tạo báo cáo Markdown mới.

## Rollout và xử lý lỗi

Operator cập nhật controller; agent làm PR, theo dõi CD và kiểm chỉ đọc.

1. Chốt PR đã review, CI xanh, manifest xóa đã duyệt. Đóng băng revision controller.
2. Khi chủ dự án duyệt thời điểm, operator chạy `update-controller` với đúng revision đó,
   rồi kiểm checksum, trạng thái, SHA, migration, health. Ứng dụng hiện tại vẫn chạy.
3. Merge khi PR `clean` và các cổng xanh. Không owner bypass, force push hay push thẳng `main`.
4. Giữ công tắc delivery hiện có. Theo dõi full CI push trên SHA cuối của `main` và
   run Production CD tự sinh. Chỉ triển khai một lần, không dispatch thêm.
5. Xác nhận backup mã hóa trước khi đổi bản chạy. Kiểm SHA, 20 migration, `/`,
   `/api/health`, `/login` trả 200, HTTP chuyển HTTPS, worker ready, outbox/proof/binding/hold
   bằng 0 và smoke production đạt. Báo link PR, CI/CD, danh sách xóa và artifact backup (30 ngày).

- Operator chưa cập nhật controller, hoặc file controller thay đổi sau khi cập nhật: chưa merge.
- CI/CD lỗi: dừng, giữ log và journal.
- Health không đạt trong 15 phút sau CD: giữ CLOSED nếu đã đóng ghi, đối soát lỗi và chỉ
  xem xét image tương thích hybrid-floor. Không restore DB sau ledger commit.

## Việc ngoài PR

Issue cho operator: gỡ SSH key delivery UAT cũ trong `authorized_keys` trên VPS, xóa
environment `uat` và secret `UAT_SSH_PRIVATE_KEY` trên GitHub. Việc này chỉ thu hồi
quyền truy cập, không xóa dữ liệu hay volume.

Ngoài phạm vi: dấu vết môi trường `dev`/`nongtrace.site` (`agritrace-dev` trong
`targets.py`, `publish.test.mjs`, Datadog).
