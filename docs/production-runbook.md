# Vận hành production — quyết định 12/10/2026

`main` triển khai vào `https://agritrace.dev`. Dev deployment và domain
`nongtrace.site` được retire theo chỉ đạo người dùng. Giữ nhánh `dev` như lịch
sử Git; nhánh đó không có quyền delivery hoặc bằng chứng CI được chấp nhận.
Kế hoạch và receipt chuyển ở
[production-only transition](plans/production-only-transition-2026-10-12.md).

## Binding hiện hành

| Thành phần | Production |
| --- | --- |
| GitHub environment / branch | `production` / `main` |
| SSH delivery identity | `agri-cd-prod`, forced command, không shell/root key |
| Root config | `/etc/agri-trace-cd/prod/config.json`, schema 2 |
| Base / state | `/opt/agri-trace`, `cd/state.json` |
| App project / PGDATA đã adopt | `agri-trace-uat` / `agri-trace-uat_postgres-data` |
| App ingress / Edge | `agritrace-prod-ingress` / `agritrace-edge` |
| Fabric đã giữ | `fabric_test`, channel `agritrace`, sequence đọc từ ledger |
| Profile bắt buộc | `fabric`; API không signer, Worker giữ identity riêng |

Tên UAT của project/release/volume cũ là compatibility để giữ dữ liệu đang
chạy. Không đổi tên PGDATA, seed lại hoặc reset ledger khi nâng cấp. Topology
Fabric hiện có vẫn cần nghiệm thu doanh nghiệp theo kế hoạch Hybrid B/C.

## Cài helper và bật delivery

1. Kiểm Git SHA, GitHub runs, delivery/host locks, `journal.json` và
   `runtime-toggle.json`; xử lý recovery đang mở trước thay đổi. Kiểm backup,
   dung lượng và identity mounts. Không đọc/ghi secrets vào log công khai.
2. Cài các file trong `policy.CONTROLLER_FILES` từ source đã commit/review bằng
   quản trị viên. Release bundle ghi checksum helper; delivery key không tự
   thay helper root. Giữ file config/secrets/accounts root-only và khóa giải mã
   backup ngoài VPS/GitHub. Giữ đúng recipient certificate hiện hành.
3. Nếu đã adopt, giữ binding hiện tại. Cài lại bằng config đã review và public
   delivery key hiện hành; không chạy `adopt-legacy` để thay tài nguyên đã adopt.

   ```bash
   sudo python3 deploy/cd/install-target.py install --environment production \
     --config /etc/agri-trace-cd/prod/config.json --public-key /root/reviewed-prod-delivery.pub
   sudo python3 deploy/cd/install-target.py enable --environment production
   ```

4. GitHub environment giữ `CD_PUBLIC_ORIGIN=https://agritrace.dev`,
   `CD_PROJECT=agri-trace-uat`, `CD_PROFILE=fabric`, pinned `CD_KNOWN_HOSTS` và
   `CD_SSH_PRIVATE_KEY` riêng. Chỉ bật `CD_DEPLOY_ENABLED=true` sau gates.
   Revoke legacy/dev delivery authority để chỉ một controller quản lý production.

## Release, rollback và recovery

`Production CD` nhận push main hoặc dispatch trên main. `deploy` chờ ba CI
push thành công cho đúng SHA/branch/lần chạy mới nhất, kiểm main HEAD vẫn là
candidate, build image có revision/origin/environment labels và dùng digest
bất biến. Server kiểm lại CI, helper checksums, Compose/signing mounts và
migration catalog trước thao tác. Unknown/destructive migration bị chặn;
official expansion cần compatibility review và checksum được pin riêng.

Controller chụp baseline, dừng writers, snapshot PostgreSQL + ledger + identity
nhất quán, mã hóa archive, migrate, khởi động rồi xác minh health, roles,
session refresh/logout, canary thật, outbox/dead-letter, direct ledger/history,
proof/hash và QR. Download archive off-VPS phải hoàn chỉnh và có checksum;
failure receipts phải được giữ. Tối đa hai full auth smoke trong 60 giây.

`upgrade` cần expected Fabric sequence và package đã kiểm; không đổi channel
hoặc khóa để vượt kiểm chứng. `rollback` chỉ tới release đã verified và giữ
compatible migrations/core rollback floor. Rollback application không tự
restore dữ liệu/ledger. Khi journal đang mở, dùng `recover`; không xóa journal
hoặc tạo deployment key mới để bỏ qua trạng thái chưa biết.

Restore là một thao tác quản trị riêng: giải mã backup ngoài VPS, kiểm mọi
checksum, rehearsal trên database trống/copy đã sanitize và đối chiếu counts,
hash/proof, identities rồi mới lập cutover. Không restore đè database production
đang nhận writes. Local test và runner không dùng production credentials.

## Tài nguyên và quan sát

VPS chỉ chạy production cùng Edge/giám sát cần thiết. Dev app, Fabric, chaincode
và test job thường trực không được resume. Không dùng `docker system prune`
để dọn dev; chỉ gỡ tài nguyên có ownership xác minh và snapshot khôi phục.
Resource caps vẫn được đặt theo ngân sách RAM/CPU, chừa hệ điều hành/Edge và
worker; việc bỏ dev giải phóng tải thực tế, không có nghĩa container được nhận
toàn bộ RAM host không giới hạn.

Sau mỗi release kiểm image/release SHA, OOM/restarts, health, outbox/dead-letter,
ledger/channel/history/QR, identity fingerprints và độ trễ. Ghi downtime/gaps,
không suy healthy trong khoảng thiếu quan sát. Chỉ bắt đầu window mới khi
release/runtime đổi có chủ ý và ghi nguyên nhân. Legacy dev observation giữ
nguyên gaps/failures và kết thúc do retire, không được ghi thành nghiệm thu 24h.

## Hybrid A/B/C (chuỗi, binding Fabric, chữ ký tổ chức)

Phạm vi là hosted A/B/C. Chữ ký độc lập chỉ bao phủ bàn giao hai bên; ghi nhận
chăm sóc/thu hoạch giữ cơ chế xác thực hiện tại. Quyền của đối tác ngoài thật là
**NotEvaluated**. Channel legacy `agritrace` (sequence 3), lịch sử, identity và
khóa hiện có được giữ nguyên; B/C chỉ chạy trên một network/channel hosted tách
biệt (container, volume, MSP/CA riêng). Chi tiết giao thức và vận hành ledger nằm
ở [runbook Hybrid](hybrid-fabric-runbook.md) và
[ADR-004](adr-004-hybrid-binding-and-signatures.md).

**Chế độ ghi.** API đọc `HYBRID_WRITES_MODE`: `CLOSED` (mặc định khi
`NODE_ENV=production` và biến chưa đặt), `CANARY` (chỉ các UUID trong
`HYBRID_CANARY_ACTOR_IDS`, tối đa 32; vẫn qua đủ kiểm tra phiên/phạm vi) hoặc `OPEN`.
Đăng nhập, refresh, logout và đọc trạng thái command vẫn hoạt động khi đóng. Lần
cutover đầu mở ở `CLOSED`/`CANARY`; chỉ `OPEN` sau xác nhận cài đặt riêng
(`hybrid_open_ack` theo đúng SHA và checksum manifest).

**Điều kiện cài đặt (cấu hình root-owned, bundle release không tự cấp được).**
Danh mục `migration_reviews` (checksum chính xác + `protocol: hybrid-abc/1`) cho ba
migration non-additive; `hybrid_release_ack` (SHA, manifest, vân tay legacy, digest
mapping); cấu hình `hosted` (network/channel khác legacy, container và volume
độc lập, image pin theo digest, đường dẫn backup identity/config, digest governance
khớp descriptor đóng gói); mô tả lịch sử legacy do API/Worker đọc (`LEGACY_LEDGER_DESCRIPTOR_*`,
chỉ-đọc, pin SHA-256 của byte gốc); `FABRIC_BINDINGS_CONFIG_HOST`,
`HOSTED_WORKER_IDENTITIES_HOST` (chỉ danh tính kỹ thuật của hosted, gắn chỉ-đọc cho
Worker), `HOSTED_FABRIC_DOCKER_NETWORK`, `LEDGER_WRITER_AUTHORITY`. API không nhận
signer hay khóa điều khiển. Ví dụ biến ở `.env.deploy.example`; compose bổ sung ở
`docker-compose.app-hybrid.yml`.

**Dung lượng.** Trước khi dựng hosted, preflight cộng hạn mức bộ nhớ của mọi
container legacy và hosted, yêu cầu quota CPU/RAM tường minh và chừa tối thiểu 20%
RAM host. `deploy/hosted-capacity.example.json` chỉ là đề xuất cần diễn tập tải và
bảo toàn chứng cứ; thiếu bằng chứng thì giữ nguyên, không bỏ quota hay mua thêm.

**Sàn schema và phục hồi.** Sau khi áp migration Hybrid, `hybrid-floor.json` ghi
checksum đã bảo vệ; image cũ (như `8ae`) không còn chạy được dù danh sách tương
thích chung có tên migration. Triển khai lỗi giữ writer đóng và journal; dùng image
tương thích đã xác minh hoặc `forward` (fix-forward có manifest được duyệt, không
restore PostgreSQL/ledger, không đổi channel/package legacy). Không dùng restore DB
làm rollback ứng dụng.

**Bằng chứng đã có trước release** (cục bộ, chưa phải acceptance trên runner/prod):
30/30 kiểm tra ledger, 13 kịch bản API→Worker→Fabric thật (gồm hai Worker chia một
backlog đúng một lần, lease Worker treo được nhận lại, và tải 10 client/200 sự
kiện Pending trên hai binding: p95 741 ms, drain 126 s). Cần chạy lại trên CI đúng
SHA (job `Hybrid A B C real Fabric and browser`) trước khi merge.

**Quan sát sau release.** Panel Ledger và `GET /supply-chains/:id/ledger-status` hiện
heartbeat Worker, chứng thư sắp/đã hết hạn, tác vụ điều khiển lỗi và tuổi backlog.
Cửa sổ quan sát ≥24h dùng collector phía server mỗi phút (khoảng trống tối đa 5
phút): `deploy/cd/observe.py`, chỉ dùng thư viện chuẩn Python. Collector **chưa được cài
trên VPS**; phải cài và có mẫu đầu tiên trước khi bắt đầu window.

- `observe.py collect --config <file> --ledger <file>` ghi một dòng JSON vào ledger
  append-only (mode `0600`, từ chối symlink) rồi `fsync`. Probe gồm: SHA release
  (`release.file`), HTTP (`api/health`, `health/ready` của Worker), container
  (`docker inspect`: trạng thái, health, OOM, `RestartCount`, `StartedAt`, image id) và
  lệnh tùy chọn in ra một JSON object (ví dụ đếm outbox/dead-letter bằng role chỉ-đọc,
  ngưỡng `max`). Chỉ giá trị vô hướng được ghi; không có shell, không đọc secret. Mẫu cấu
  hình: `deploy/observability/collector.example.json` (tên container/đường dẫn phải đổi
  theo VPS). Lập lịch bằng `systemd` timer hoặc cron của root, mỗi phút.
- `observe.py report --ledger <file>` đánh giá cửa sổ đang chạy, tính từ lần đổi
  release/image gần nhất (đổi có chủ ý = window mới, ghi nguyên nhân ở `previousChanges`).
  Đạt khi: ≥24h, khoảng trống lớn nhất ≤300s (tính cả khoảng từ mẫu cuối đến lúc báo cáo,
  nên collector dừng sẽ lộ ra), không mẫu nào có probe lỗi, không restart/OOM ngoài ý
  muốn trong cùng release, ledger không có dòng hỏng hay lùi thời gian. Thoát mã 0 khi đạt,
  1 khi chưa đạt (kèm `reasons`), 2 khi lỗi cấu hình/đọc ledger.
- Các điều kiện P0/P1, lỗi toàn vẹn hoặc phạm vi (scope) cần probe `commands` tương ứng;
  collector không tự suy ra chúng. Mẫu thiếu được ghi nhận là khoảng trống, không suy
  diễn là healthy.
