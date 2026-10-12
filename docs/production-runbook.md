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
