# Review chuẩn bị UAT Contabo

Ngày 07/10/2026. Phạm vi: chuẩn bị repo trước review; chưa kết nối/cài đặt/
deploy VPS. Prompt: [deployment-execution-prompt.md](deployment-execution-prompt.md).
Thiết kế: [kế hoạch](contabo-deployment-plan.md). Lệnh: [runbook](contabo-uat-runbook.md).

## Git và phạm vi thay đổi

Đang ở `main`, nền `c1a69edbf95daf28ed441e05337d6b50ec0e9553`. Nhánh cũ đã
đổi từ `codex/ci-plan-b` sang `ci/plan-b`; nội dung đã nằm trong origin/main.
Main trước tích hợp có backup branch; local work có snapshot/stash giữ lại
trong `.git/safety/20261007-main-integration`. Không force push hoặc xóa stash.

Thay đổi UAT hiện chưa commit/push. Các tài liệu/thay đổi local có sẵn vẫn
được giữ; không đưa toàn bộ working tree vào một commit. README chỉ được thêm
hai dòng map tài liệu UAT vào nội dung local hiện có.

| Nhóm | File review |
| --- | --- |
| Compose HTTP/Fabric | `docker-compose.uat.yml`, `docker-compose.uat-fabric.yml` |
| Proxy và secrets template | `deploy/Caddyfile.uat`, `.env.uat.example`, `.gitignore`, `.dockerignore` |
| Khởi tạo tài khoản/catalog | `deploy/fixtures.mjs`, `apps/api/scripts/bootstrap-uat.mjs`, `deploy/bootstrap.test.mjs` |
| Preflight/config/credentials | `deploy/config.mjs`, `deploy/prepare.mjs`, `deploy/preflight.mjs` |
| Backup/restore/smoke | `deploy/database.mjs`, `deploy/smoke.mjs` |
| Kiểm dữ liệu cũ và cổng Fabric | `apps/api/scripts/check-uat-events.mjs`, `deploy/fabric-ports.mjs` |
| API runtime | `apps/api/src/main.ts` thêm trust proxy tùy chọn 0/1; `apps/api/Dockerfile` đóng gói CLI |
| CI | hai workflows, `scripts/ci/changes.mjs`, `scripts/ci/ci.test.mjs` |
| Tài liệu | kế hoạch/prompt/runbook/review và hai dòng README |

Giữ API contract, RBAC, state machine và schema/migrations hiện tại. Các gap
nghiệp vụ trong PROJECT_CONTEXT tiếp tục theo AGT; source tồn tại không đồng
nghĩa đã Accepted.

## Quyết định triển khai

Ubuntu 24.04 LTS mới, `deploy`, IPv4 `13.140.170.166`, Europe, 4 vCPU/8 GB/
100 GB. HTTP IPv4 cho UAT; domain/HTTPS sau. Compose độc lập, chỉ proxy publish
HTTP; API không có signer mount. Migration/bootstrap là jobs riêng. 5 tài
khoản UAT mật khẩu riêng sinh ngẫu nhiên; Consumer public không login.

PostgreSQL 18 khớp DB nguồn18.6, tránh downgrade dump18 sang PG16. PostgreSQL
và Caddy images có digest; Node/npm/lockfiles giữ theo repo. Worker A tắt
Fabric, B chỉ bật sau gates. Relayer MSP/TLS certificate read-only, kiểm key
ownership và non-root UID. Fabric host ports bị giới hạn loopback trước up.

## Kiểm chứng đã thực hiện

Runtime riêng: Node24.19.0, npm12.1.0, đúng engines. Không thay Node/npm hệ
thống. PostgreSQL test riêng18.6 tại loopback:15447, độc lập service DB nguồn.

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| Toàn repo `npm run check` | Lint/typecheck/build đạt; API unit63 + E2E54, Web unit25 + lint contract82 + image4, chaincode34, Gateway3; không skip các E2E DB |
| CI regression | 17/17, gồm điều kiện deploy paths phải chạy integration gates |
| Bootstrap trên DB test thật | 3/3: guard production/malformed, rollback khi collision cuối transaction, đủ vai trò/replay/hash password và giữ user cũ |
| Migration copy | 8 migrations; dump hiện tại không có migration pending |
| Source backup/restore | Archive SHA-256, counts và digest hash lịch sử khớp; DB nguồn không bị ghi |
| Bootstrap copy | Thêm5 users; lần hai 0 created/5 existing; giữ cycles/events cũ |
| API/Web production build + Caddy/PG18 native | Login5 roles, me, negative RBAC, idempotency, cycle→2 harvests→shipments receive/reject, QR, refresh/logout đạt; proof PENDING |
| Web/proxy | JS assets200 và bundle đúng public API URL; Swagger404; giả X-Forwarded-For không vượt login limit (429 ở lần vượt hạn mức) |
| Compose/Caddy offline | UAT A config pass; Caddy2.11.7 validate pass; binary test kiểm checksum SHA-512 từ official release |
| Fabric files/workflow syntax | 13 published bindings loopback trong model đúng files upstream có checksum; YAML/bash steps hợp lệ; chưa start Fabric |
| Audit dependency | Workspace full/production và installed tree đạt, 0 advisory |
| Chaincode standalone | Install/audit/typecheck/coverage34 tests/build/runtime load đạt; 0 advisory |
| Dữ liệu UAT mới | 13 sự kiện có local hash và input hợp lệ với compiled chaincode validator; kiểm read-only, chưa query ledger |

Source snapshot có5 users,10 organizations,3 farms/products/cycles/harvests/
lots,0 shipments,2 trace/outbox và0 proofs. Copy và dữ liệu thử được giữ riêng
trong `.uat/`, bị loại khỏi Git và Docker build context. Không đưa credentials,
DB URL có password, private key hoặc payload nghiệp vụ vào báo cáo này.

## Hai vấn đề phải chốt trước khi đi tiếp

**Lịch sử cũ chưa tương thích:** cả2 HARVEST_RECORDED cũ có local hash không
khớp nội dung và actorAuthProof không phải SHA-256 fingerprint. Actual validator
báo `INVALID_INPUT: actorContext.actorAuthProof must be a SHA-256 fingerprint`.
Check trên copy gồm15 events phát hiện đúng2 cũ;13 events tạo qua API mới đạt.
Kiểm này không ghi DB, không gửi Fabric và không tạo receipt/proof giả.

Không sửa hash/event/proof để làm xanh. Đang chờ Phát chọn: nhập danh mục cũ
(org/farm/product) và tạo lịch sử UAT mới, giữ full backup cũ; hoặc giữ toàn bộ
lịch sử cũ và xử lý tương thích trước khi bật Fabric. Runbook full restore là
phương án copy nguyên DB; chỉ dùng sau khi quyết định dữ liệu/gate đã đạt.

**Docker local chưa chạy:** Docker Desktop backend dừng do
`sailor-ingest.sock.stale` không truy cập được. Đã thử khởi động và kiểm socket;
thao tác di chuyển file tạm bị hệ thống từ chối. Không reset Docker/WSL hoặc
volume của máy để vượt lỗi môi trường này.

Do đó **chưa đạt nghiệm thu container UAT/Fabric với thay đổi mới**. Native
smoke không thay cho container smoke. CI đã thêm UAT PG18/Caddy/bootstrap/
smoke/backup-restore, và Fabric private-port setup, nhưng chưa chạy CI cho
working tree chưa commit. CI xanh của main nền chỉ là bằng chứng cho code nền.

## Còn lại và review cần thiết

- Chốt cách kết hợp dữ liệu sau phát hiện lịch sử cũ.
- Chọn candidate/commit riêng phần được review; chạy container/Fabric CI trên
  Linux đúng candidate, hoặc xử lý Docker local trong phạm vi được chốt.
- Review secret/port/identity, import/migration/rollback và giới hạn HTTP UAT.
- Phát cho phép chuyển sang VPS theo yêu cầu chuẩn bị/review trước. Sau đó
  mới kiểm OS/sudo/services/ports, cấu hình SSH/Docker và deploy thực tế.
- Trên VPS: A thật, B ledger commit/query/hash/receipt, outage/recovery,
  restart, backup/restore, tài nguyên và thử bên ngoài. Domain/HTTPS sau UAT.

AGT-005/#17, AGT-029/#41, AGT-030/#42 và AGT-031/#43 vẫn cần evidence/acceptance
đúng candidate. Báo cáo này không đóng Issue hoặc tự xác nhận release.
