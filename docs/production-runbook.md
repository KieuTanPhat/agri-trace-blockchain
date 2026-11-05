# Vận hành production Hybrid

`main` triển khai vào `https://agritrace.dev`. Dùng source/controller revision
hiện hành và ủy quyền của tác vụ đang thực hiện; receipt hoặc kế hoạch triển khai
cũ không xác nhận runtime hay cấp quyền merge/deploy cho lần mới.

## Target và chuẩn bị

| Thành phần | Cấu hình cài mới |
| --- | --- |
| GitHub / delivery | `production` / `main`; `agri-cd-prod` forced command |
| Root config / state | `/etc/agri-trace-cd/prod/config.json`, schema 3; `/opt/agri-trace/cd/state.json` |
| App / PGDATA | `agritrace-prod` / `agritrace-prod_postgres-data` |
| Ingress / Edge | `agritrace-prod-ingress` / `agritrace-edge` |
| Fabric | Một mạng; channel `agritrace`, `AgritraceMSP` + `OrdererMSP` |
| API / Worker | API không có khóa; Worker giữ technical relayer/controller/registry admin AgritraceMSP |

Schema 2 / `agri-trace-uat` đã retire. Tài nguyên cũ trên VPS do operator kiểm kê
và xử lý riêng, không thuộc thao tác delivery của production. Controller
chỉ nhận config schema 3, manifest format 2 và release `prod-*`; config schema cũ,
project `agri-trace-uat` và release `uat-*` bị từ chối. Công cụ cutover/alias/adopt và
runbook của controller cũ đã bị gỡ khỏi source; lịch sử nằm trong Git (`git show 28d1f9c:<path>`).

Edge chuyển HTTP trên địa chỉ IP sang HTTPS `agritrace.dev` bằng 308, giữ nguyên
path/query. Không phục vụ form đăng nhập qua HTTP. Kiểm route này sau reload.

Cấu hình tách domain đã chuẩn bị: `nongtrace.site` phục vụ login/register và
khu vực quản lý; `agritrace.dev` giữ trang khách hàng/scan/trace. Khi rollout được
ủy quyền, `CORS_ORIGINS` của application phải chứa `https://nongtrace.site` cùng
các origin khách hàng hiện có; API vẫn đi qua `/api` trên từng hostname. Giữ
`PUBLIC_ORIGIN=https://agritrace.dev` và public trace base trên `agritrace.dev`.
Publisher truyền cặp build arg BUSINESS/CUSTOMER của frontend; xem frontend guide
về xử lý command chưa rõ kết quả và khóa ký theo origin trước cutover. Kiểm health
cả ba origin trong Edge helper và login/refresh/logout thực trên domain mới.
Policy `https_origins` giữ allowlist cụ thể của production gồm ba origin này;
controller đang cài phải được cập nhật bằng quy trình digest đã review trước
cutover, cùng file môi trường private. Không đổi `PUBLIC_ORIGIN` sang domain doanh nghiệp.
Thay đổi này chưa tự cấp quyền reload Edge, cập nhật DNS, publish image hay deploy.
`deploy/edge/admin.py` có ba thao tác: `prepare` (kiểm file môi trường Edge đã duyệt và hai
volume chứng chỉ có sẵn, cập nhật compose/Caddyfile, validate), `start` và `reload`. Hai volume
Caddy mang tên lịch sử `agri-trace-uat_caddy-data` và `agri-trace-uat_caddy-config` đang giữ chứng
chỉ HTTPS: không xóa hoặc đổi tên chúng.

Lệnh `fresh-install` của installer chỉ chuyển từ
schema 2 đã tắt sang schema 3, nên đã gỡ cùng phần cấp identity dành riêng cho lần
chuyển đó. Không dùng source hiện tại để adopt lại UAT hoặc tạo lại target trên VPS.
Quyết định của lần cài đầu tra qua Git; gate hiện hành ở
[cổng nghiệm thu phát hành](#cổng-nghiệm-thu-phát-hành).
Luồng first-install/recover của controller production vẫn giữ kiểm DB rỗng,
`fresh_release_ack`, archive phục hồi đã verified và migration floor; không bỏ
chúng khi đối soát một delivery production bị gián đoạn.

Config schema 3 dùng `hosted`, `smoke`, `bootstrap`; `migration_reviews` pin checksum
và `hybrid-abc/1`. `open_after_smoke=true` mở ghi sau nghiệm thu, mặc định CLOSED.
Migration tên `<timestamp>_hybrid_*` hoặc có SQL ngoài nhóm additive (thêm cột
nullable/bảng/index) chỉ được CD áp khi config đã cài có mục
`"<tên>": {"checksum": "<sha256 của migration.sql>", "protocol": "hybrid-abc/1"}`;
checksum là SHA-256 byte file LF trong release manifest. Ví dụ
`20261021000000_hybrid_acceptance_epoch` (snapshot consent ShipmentPlan, thay
`fn_hybrid_acceptance_scope`/`fn_hybrid_plan_state`) cần review và pin trước khi
giao bản chứa nó; sau khi áp, checksum vào `hybrid-floor.json` và bản cũ hơn bị
chặn. Plan DRAFT có acceptance cũ phải revise và xác nhận lại.
Bootstrap chỉ nhận cấu hình riêng tư và không đổi account hiện có. Network hosted
pin image/governance và giữ persistent CA/MSP/ledger; script Hybrid pilot chỉ dùng
cho test. Cấu trúc binding tham khảo [network](../deploy/hosted-network.example.json).

Worker dùng `HOSTED_WORKER_CONFIG_HOST` là thư mục private chỉ chứa `bindings.json`; `FABRIC_BINDINGS_CONFIG_HOST` trỏ vào file đó. Cấu hình platform target dùng chung theo Hybrid runbook, không còn inventory peer doanh nghiệp. Mount config readonly ở `/hosted-config`, identities ở `/hosted-identities`; API không nhận signing identity. Admission flag phải đồng nhất trên API/Worker.

Topology hai MSP là cấu hình source mới, chưa xác nhận VPS đã chuyển đổi. Migration `20261223000000_platform_fabric_service` yêu cầu database mới và không nhập lịch sử/proof cũ. Chỉ thực hiện reinstall trong tác vụ vận hành được ủy quyền, đúng ownership/receipt/controller revision.

GitHub đặt `CD_PROJECT=agritrace-prod`, `CD_PROFILE=fabric`, origin
`https://agritrace.dev`, known-hosts và delivery key đã pin. Giữ công tắc delivery
hiện có khi giao bản. Trước khi cập nhật helper, đối chiếu SHA/CI, journal,
delivery/host locks và ownership theo phần *Cập nhật controller*. Không prune hoặc
reset DB. Khóa giải mã backup nằm ngoài VPS/GitHub; snapshot mã hóa phải có trước
khi CD đổi bản chạy. Không khôi phục DB riêng sau khi ledger đã commit.
Luồng `forward` mở phiên smoke của đúng candidate sau migrate, đóng cờ phiên
trong `finally`; smoke lỗi vẫn giữ journal và dừng writers để đối soát.

## Cài lại có chủ đích, không giữ dữ liệu trước đó

Quyết định ngày 24/10/2026 cho lần phát hành gỡ A/c1: chủ dự án cho phép bỏ dữ
liệu AgriTrace/Fabric cũ không backup, cài mạng nền tảng trên VPS AgriTrace và gỡ
Fabric cũ tại VPS doanh nghiệp. Ngoại lệ này chỉ áp dụng lần cài lại đã xác định;
deploy, rollback và first-install thông thường vẫn cần archive theo runbook.

Chuẩn bị release trên đúng main SHA, đủ ba CI push gates và immutable images
trước khi dừng production. Root operator kiểm kê container/volume/network/bind
mount và ownership trên cả hai host, khóa delivery/host, dừng writers rồi xóa
đúng danh sách đã xác minh. Không prune toàn host, xóa lock đang giữ hoặc dùng
artifact restore giả. Tài nguyên quan sát, quản trị VPS và dịch vụ khác nằm ngoài
phạm vi này. Nếu thay cả trạng thái Edge, chuẩn bị volume/cấu hình/chứng chỉ HTTPS
mới; không xóa volume có tên lịch sử khi Edge còn sử dụng chúng.

Operator dựng network mới bằng bộ cài production, tạo DB volume trống, private
configuration và deployment state mới (`current=null`, `previous=null`). Project
vẫn là `agritrace-prod`; network instance/root và CA/MSP/ledger được tạo mới.
Deployment state ghi `installation_generation` là 32 ký tự hex của lần cài này.

Root config có `reinstall_ack` pin protocol `agritrace-destructive-reinstall/1`,
`sha`, SHA-256 của JSON manifest canonical (`manifest_sha256`), `generation` và
`receipt_sha256`. Receipt `/opt/agri-trace/cd/reinstall-receipt.json` thuộc root,
mode 0600, không là symlink; nó chứa cùng protocol/SHA/manifest/generation và
`removed_old_resources=true`, `backup=null`, `retained_previous_data=false`.
Chỉ ghi receipt sau khi kiểm kê xác nhận việc bỏ tài nguyên cũ đã hoàn tất.
`fresh_release_ack`, migration checksum review và mọi image/governance/mount/quota
gate vẫn áp dụng. Không sửa state/receipt để biến một rollout lỗi thành cài mới.

Dispatch Production CD với operation `reinstall`. Command chỉ cài trên target
rỗng đã chuẩn bị; delivery identity không được xóa tài nguyên hay cài lại release
đang hoạt động. Controller xác minh receipt trước migration, chạy bootstrap và
smoke như first-install, rồi mới mở ghi. Workflow không yêu cầu archive trước
thay thế cho operation này và ghi rõ không có khả năng khôi phục dữ liệu cũ.
Nếu gián đoạn, giữ journal và `recover` đúng candidate/generation; không xóa lại
network/DB mới hoặc chuyển candidate để vượt lỗi. Sau verified, `reinstall` lặp
lại bị từ chối vì target đã có current release.

### Nạp bộ dữ liệu 28 sản phẩm sau khi cài lại

Chỉ dùng cho bản cài lại vừa verified, khi ghi đã mở (`open_after_smoke`). Trên
máy có `.codex/fruit-assets`, checkout đúng SHA đang chạy rồi đóng gói:
`node scripts/demo/production-dataset-bundle.mjs --out <thư mục trống>`. Gói chứa
script `scripts/demo` lấy từ commit và ảnh đã chuẩn bị, không chứa ảnh gốc hay tài
liệu tham chiếu. Chép gói lên VPS, rồi chạy bằng root:
`python3 -I scripts/demo/production-dataset-run.py --bundle <gói>`.

Runner giữ delivery/host lock, ghim `installation_generation` và 5 tài khoản kỹ
thuật vào `shared/dataset/<generation>/run/target.json`. Nó chạy seed qua API
production trong container một lần từ image API của release. Khi chuỗi mới cần
binding, seed dừng với mã 75; runner gọi `bootstrap-production.mjs` thao tác
`dataset-ledger` bằng operator container của controller đã cài, thêm Worker
inventory bằng `add_worker_binding`, activate rồi chạy tiếp. Worker xác nhận quyền
trên Fabric trước mỗi bước. Sau seed, runner đăng ảnh giới thiệu, ảnh bìa tin và
chạy `verify-seed.mjs` (binding thật, mỗi event có proof). Lỗi giữa chừng thì sửa
nguyên nhân rồi chạy lại với `--resume`; checkpoint giữ khóa và body gốc. Mật khẩu
tài khoản demo nằm trong `run/accounts.json` (root-only), không gửi qua kênh chung.

App mobile (ACheck và app nhân viên) đăng nhập vào production khi private env đặt
`CONSUMER_AUTH_ENABLED=true` và `STAFF_APP_AUTH_ENABLED=true`. Đăng ký consumer
vẫn tắt trên production.

## Cổng nghiệm thu phát hành

Ghi evidence đúng candidate SHA, image/manifest/controller revision, migration
checksum, network/channel/sequence/protocol và môi trường. Mỗi gate phải có kết
quả thực; mock, compile, skipped test hoặc receipt cũ không thay acceptance.
Ma trận nghiệp vụ HYB-AC ở [CI guide](ci.md#ma-trận-nghiệm-thu-hybrid).

| Gate | Bằng chứng cần có |
| --- | --- |
| Domain | Scope trước write/replay, grant/epoch/version, atomic journal/domain/trace/outbox, quantity/custody và sensor windows |
| SQL | Fresh migrate, lịch sử migration/checksum, refusal khi có dữ liệu không tương thích, schema alignment và constraints thật |
| Web/mobile | Giữ body/key/signature khi mất response/reload/đổi account/revoke; UI cách ly và thiết bị thật cho chức năng native |
| Fabric | Registry/MSP approvals, key PoP, dual handover, tamper/scope negatives, event/proof/history VALID trên ledger thật |
| Fault/load | Hai Worker, stale lease, outage/restart/unknown outcome; 10 clients/200 Pending qua hai binding, p95 ≤2s và drain ≤15 phút trong quota |
| First install/reinstall | Đúng điều kiện empty target, checksum/floor, receipt/generation và resume sau migration/promotion gián đoạn; lỗi giữ writes CLOSED |
| Network | Images pin, enrollment/TLS CA tách riêng, admin port loopback, TLS chaincode, CA/MSP/ledger persistent và channel isolation |
| Restore | Backup nhất quán mã hóa DB/ledger/CA/MSP/config/images, bản ngoài VPS, decrypt/checksum và isolated DB+ledger restore trước replacement mặc định |
| CI/CD | Application/Blockchain/Dependency đúng final candidate, full final-main push CI, immutable publication và helper/deployment khớp |
| VPS smoke | Web/API/auth/session/CORS/role, care/harvest/Lot/consent, ký pickup/arrival/receive, outbox/direct ledger/proof/QR và runtime SHA |

Không có canary production riêng, giới hạn bảo trì hai giờ hoặc nghĩa vụ agent
quan sát liên tục. Smoke và troubleshooting có giới hạn thuộc lần delivery;
support sau bàn giao cần yêu cầu mới. Reinstall không backup là ngoại lệ cần
ủy quyền rõ đúng target, không thay quy trình backup/restore mặc định.

## Delivery và smoke trên VPS

`Production CD` kiểm ba CI push thành công đúng main SHA, HEAD hiện hành, immutable
API/Web/chaincode images, helper checksums, Compose/mounts/quotas, governance và
migration catalog. Không thay byte migration đã áp hoặc bỏ parser default-deny.

Lần đầu bắt đầu từ DB và mạng trống, ghi floor trước migrate rồi operator tạo tài khoản/catalog kiểm chứng. Worker dùng template platform đã review, tự chuẩn bị mọi chuỗi và đăng ký khóa ký; không cấp MSP doanh nghiệp hoặc thêm một dòng inventory cho mỗi chuỗi. API/Worker không nhận khóa doanh nghiệp, CA hoặc orderer. Bootstrap chỉ đọc config, kiểm khớp template rồi có thể tiếp tục sau gián đoạn. Registry admin AgritraceMSP là technical identity nhạy cảm và phải mount đúng phạm vi. Bootstrap private dùng `connections` gồm đúng `relayer`, `controller`, `admin`, cùng MSP `AgritraceMSP`; bỏ cấu hình admin doanh nghiệp. `workerConnection` phải khớp nguyên template `platform.node`. Sai template bị từ chối, controller không tự ghi thêm inventory.

API/Web/Worker khởi động CLOSED; smoke chạy API ở `HYBRID_WRITES_MODE=CANARY` với
`HYBRID_CANARY_ACTOR_IDS` là đúng các ID trong `accounts.json` (tài khoản kỹ thuật
smoke). Người dùng nghiệp vụ khác vẫn nhận 503 trên candidate chưa verified; RBAC và
scope domain vẫn kiểm từng command. Kiểm health/Web/PWA/login/roles/refresh/logout/CORS; care, harvest/Lot/
QR, ShipmentPlan consent, pickup/arrival có chữ ký Ed25519 hai bên, receive,
original-key replay, outbox, stored evidence, direct Fabric event/proof/VALID và
public QR. Private keys/command receipts nằm trong `shared/smoke/<sha>` root-only.

Sau smoke thành công đánh dấu verified/current và mở ghi theo policy. Kiểm runtime
SHA/images, OOM/restarts, Pending/dead-letter và HTTPS sau deploy. Đây là hậu kiểm
trong lần triển khai; không có giai đoạn canary hay giám sát định kỳ riêng.

## Cập nhật controller

Controller được cài thành thư mục bất biến theo digest
(`/usr/local/lib/agri-trace-cd/prod-versions/<digest>`); symlink
`/usr/local/lib/agri-trace-cd/prod` chọn bản đang dùng. Khi một PR đổi `controller.py`,
`policy.py`, `targets.py`, `verify-hosted.mjs`, `session-auth.mjs` hoặc `entry`, preflight
của Production CD từ chối giao bản mới cho tới khi operator cài đúng bản đã review.
Quy trình, từ checkout đã review ở đúng SHA:

```bash
python3 deploy/cd/install-target.py controller-digest
```

```bash
sudo python3 deploy/cd/install-target.py update-controller --environment production --expected-digest <digest>
```

Lệnh dừng trước khi đổi gì nếu digest không khớp, nếu có delivery đang chạy hoặc journal chưa
recover. Nó chỉ đổi controller: không đổi config production, quyền SSH, database, mạng hay container.
Kiểm `readlink /usr/local/lib/agri-trace-cd/prod`, trạng thái CD và health, rồi mới merge. Bản trước
được giữ lại; quay về bằng:

```bash
sudo python3 deploy/cd/install-target.py restore-controller --environment production
```

Chỉ merge PR đổi controller sau khi bước cập nhật hoàn tất; bản đang chạy vẫn tiếp tục phục vụ trong lúc cập nhật.

## Recovery, tài nguyên và bàn giao

### Xoay khóa mã hóa nền tảng

`PLATFORM_SECRET_KEY` tách khỏi JWT/Fabric keys. Compose truyền biến này cho API;
operator cấu hình riêng trước khi dùng MFA/hộp thư riêng tư. Không thay giá trị
trực tiếp khi còn ciphertext dùng khóa cũ.

Sau backup đã xác minh và dừng API/Worker, chạy từ `apps/api` bằng user operator.
Hai file khóa phải là đường dẫn tuyệt đối, file thường private (0600 trên Linux),
không nằm trong Git. Khóa không được truyền bằng nội dung trên command line.

```bash
node dist/operator/rotate-platform-secret.js --old-key-file /private/platform-old.key --new-key-file /private/platform-new.key
```

Mặc định chỉ kiểm giải mã, round trip và báo số lượng. Để áp, thêm cả ba cờ
`--apply --services-stopped --invalidate-recovery-codes`. Công cụ khóa audit,
kiểm tất cả seed MFA/nội dung riêng tư trước khi ghi, mã hóa lại cùng transaction,
giữ nguyên AAD/metadata/lịch sử và append audit chỉ chứa số lượng. HMAC mã khôi
phục không thể chuyển sang khóa khác nên bị thu hồi; người dùng cấp lại ở
`/admin/security` với TOTP hợp lệ, kể cả khi mode REQUIRED. Endpoint
`POST /auth/mfa/recovery-codes` tiêu thụ factor một lần, thay toàn bộ HMAC và trả
mã mới đúng một lần; không lưu secret vào journal/audit và không tắt MFA.
Không sửa TOTP seed/trạng thái của người dùng khi xoay khóa.

Sau commit, cấu hình API dùng khóa mới, kiểm MFA/đọc hồ sơ riêng tư trên môi
trường cách ly rồi mới khởi động dịch vụ. Giữ cả hai khóa và backup đến khi đã
đối soát. Nếu kết quả COMMIT chưa rõ, giữ dịch vụ dừng, dùng chế độ chỉ kiểm với
từng cặp khóa để xác định khóa đang giải mã được; không tự đổi lại env hoặc
restore riêng database sau khi ledger đã có ghi. Không chạy công cụ này tự động
trong CD hoặc qua route quản trị.

### Gỡ bản A, c1 và legacy nghiệp vụ

Thay đổi gỡ bản A/c1 (xem [ADR-004](adr-004-hybrid-binding-and-signatures.md#phiên-bản-hiện-hành))
thêm sáu migration `20261213000000`..`20261213000005`. Bốn migration đầu **từ chối**
database còn dữ liệu A/c1, hồ sơ doanh nghiệp không cần kích hoạt, digest cảm biến theo vụ,
đối soát mốc cảm biến hoặc consent kế hoạch thiếu snapshot; không tự xóa hay sửa lịch sử.
Migration `...04` ghi rõ family của refresh session cũ bằng chính ID của nó rồi đặt bắt buộc;
`...05` thêm vai trò chuỗi `PROCESSOR`.
Trước release, chủ dự án làm sạch hoặc dựng lại database production theo quyết định
riêng, có backup phối hợp hai host. Chaincode mới bỏ `RecordTraceEvent` và đọc A/c1 nên
cần lifecycle review trên mạng hosted. Controller đã cài phải cập nhật theo quy trình
digest trước release đầu tiên: controller mới không còn yêu cầu `FABRIC_LEGACY_WRITER`
và `docker-compose.app-fabric.yml`.

### Recovery thông thường

Lỗi giữ writers đóng/dừng, journal, DB/outbox/ledger và original command keys.
`recover` lần đầu tiếp tục đúng candidate; không reset DB, giả verified release
cũ hoặc tự resolve migration chưa hoàn tất. `hybrid-floor.json` chặn image thiếu
schema/protocol. Rollback ứng dụng chỉ tới image verified tương thích; không
restore DB riêng sau ledger commit. Hosted chaincode thay đổi cần lifecycle review,
không gọi `upgrade` để thay B/C vào channel legacy.

## SMTP của Dedicated Worker

Cấu hình gửi hợp đồng/OTP qua SMTP nằm trong private env của Worker; xem
[hướng dẫn Gmail và nghiệm thu PDF](email.md). Production Compose mặc định tắt
mail, nhận cùng `JWT_SECRET` của API để giải mã OTP/mật khẩu tạm. Bật SMTP sau khi
kiểm tra credential, recipient và hàng đợi đúng môi trường; không gửi lịch sử
từ bản dump. Mailpit không được phép trên production. Thay env phải triển khai
lại Worker theo quy trình controller hiện hành, không khởi chạy Compose local.
