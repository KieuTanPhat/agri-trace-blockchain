# Vận hành production Hybrid

Cập nhật 14/10/2026 theo [kế hoạch cài mới](plans/fresh-install-cleanup-2026-10-13.md).
`main` triển khai vào `https://agritrace.dev`. Chủ dự án đã cho phép merge/deploy
sau kiểm thử; không yêu cầu duyệt lại, giới hạn 2 giờ hay canary riêng.

## Target và chuẩn bị

| Thành phần | Cấu hình cài mới |
| --- | --- |
| GitHub / delivery | `production` / `main`; `agri-cd-prod` forced command |
| Root config / state | `/etc/agri-trace-cd/prod/config.json`, schema 3; `/opt/agri-trace/cd/state.json` |
| App / PGDATA | `agritrace-prod` / `agritrace-prod_postgres-data` |
| Ingress / Edge | `agritrace-prod-ingress` / `agritrace-edge` |
| Fabric | Một mạng hosted; `hybrid-b` Org1/2, `hybrid-self` Org1/3 |
| API / Worker | API không có khóa; Worker chỉ giữ technical identity Org1 |

Schema 2 / `agri-trace-uat` đã retire. Tài nguyên cũ trên VPS do operator kiểm kê
và xử lý riêng, không thuộc thao tác delivery của production. Controller
chỉ nhận config schema 3, manifest format 2 và release `prod-*`; config schema cũ,
project `agri-trace-uat` và release `uat-*` bị từ chối. Công cụ cutover/alias/adopt và
runbook của controller cũ đã bị gỡ khỏi source; lịch sử nằm trong Git (`git show 28d1f9c:<path>`).

Edge chuyển HTTP trên địa chỉ IP sang HTTPS `agritrace.dev` bằng 308, giữ nguyên
path/query. Không phục vụ form đăng nhập qua HTTP. Kiểm route này sau reload.
`deploy/edge/admin.py` có ba thao tác: `prepare` (kiểm file môi trường Edge đã duyệt và hai
volume chứng chỉ có sẵn, cập nhật compose/Caddyfile, validate), `start` và `reload`. Hai volume
Caddy mang tên lịch sử `agri-trace-uat_caddy-data` và `agri-trace-uat_caddy-config` đang giữ chứng
chỉ HTTPS: không xóa hoặc đổi tên chúng.

Production đã được cài và chạy. Lệnh `fresh-install` của installer chỉ chuyển từ
schema 2 đã tắt sang schema 3, nên đã gỡ cùng phần cấp identity dành riêng cho lần
chuyển đó. Không dùng source hiện tại để adopt lại UAT hoặc tạo lại target trên VPS.
Quyết định/acceptance của lần cài đầu vẫn nằm trong [plan cài mới](plans/fresh-install-cleanup-2026-10-13.md).
Luồng first-install/recover của controller production vẫn giữ kiểm DB rỗng,
`fresh_release_ack`, archive phục hồi đã verified và migration floor; không bỏ
chúng khi đối soát một delivery production bị gián đoạn.

Config schema 3 dùng `hosted`, `smoke`, `bootstrap`; `migration_reviews` pin checksum
và `hybrid-abc/1`. `open_after_smoke=true` mở ghi sau nghiệm thu, mặc định CLOSED.
Bootstrap chỉ nhận cấu hình riêng tư và không đổi account hiện có. Network hosted
pin image/governance và giữ persistent CA/MSP/ledger; script Hybrid pilot chỉ dùng
cho test. Cấu trúc binding tham khảo [network](../deploy/hosted-network.example.json).

GitHub đặt `CD_PROJECT=agritrace-prod`, `CD_PROFILE=fabric`, origin
`https://agritrace.dev`, known-hosts và delivery key đã pin. Giữ công tắc delivery
hiện có khi giao bản. Trước khi cập nhật helper, đối chiếu SHA/CI, journal,
delivery/host locks và ownership theo phần *Cập nhật controller*. Không prune hoặc
reset DB. Khóa giải mã backup nằm ngoài VPS/GitHub; snapshot mã hóa phải có trước
khi CD đổi bản chạy. Không khôi phục DB riêng sau khi ledger đã commit.

## Delivery và smoke trên VPS

`Production CD` kiểm ba CI push thành công đúng main SHA, HEAD hiện hành, immutable
API/Web/chaincode images, helper checksums, Compose/mounts/quotas, governance và
migration catalog. Không thay byte migration đã áp hoặc bỏ parser default-deny.

Lần đầu bắt đầu từ DB trống, ghi floor trước migrate rồi operator tạo account/
catalog/chain/binding/approvals. Owner MSP chỉ cấp cho operator một lần; API/Worker
thường trực không nhận owner/CA/orderer keys. Bootstrap có thể đối soát/tiếp tục.

API/Web/Worker khởi động CLOSED; smoke mở ghi trong delivery cho actor kỹ thuật
scope đúng. Kiểm health/Web/PWA/login/roles/refresh/logout/CORS; care, harvest/Lot/
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

Lỗi giữ writers đóng/dừng, journal, DB/outbox/ledger và original command keys.
`recover` lần đầu tiếp tục đúng candidate; không reset DB, giả verified release
cũ hoặc tự resolve migration chưa hoàn tất. `hybrid-floor.json` chặn image thiếu
schema/protocol. Rollback ứng dụng chỉ tới image verified tương thích; không
restore DB riêng sau ledger commit. Hosted chaincode thay đổi cần lifecycle review,
không gọi `upgrade` để thay B/C vào channel legacy.

Mọi container có CPU/RAM quota, chừa >=20% RAM host. Mẫu
[capacity](../deploy/hosted-capacity.example.json) cần kiểm tải/OOM/restarts thực.
Compose JSON có thể trả `mem_limit` thành chuỗi số byte; controller chuẩn hóa
chuỗi thập phân dương trước khi cộng quota. Giá trị thiếu, zero, âm hoặc định
dạng không hợp lệ vẫn bị chặn; không bỏ cổng capacity khi preflight thất bại.
Chỉ một mạng Fabric hoạt động; retired resources không tự resume. Không bỏ quota
để vượt preflight. Giữ secret/CA/MSP/archive riêng tư.

Chủ dự án quản lý VPS và sự cố sau bàn giao. Agent kết thúc khi production mới
qua smoke, CI/CD thành công và bàn giao SHA/digests, backup/restore, resource
catalog, credentials riêng tư và lệnh vận hành. Không cài collector mỗi phút,
systemd timer, quan sát liên tục 24 giờ hoặc trực sự cố sau hoàn thành.

Chữ ký độc lập bắt buộc ở bàn giao khác tổ chức; care/harvest là ghi nhận có xác
thực nền tảng. Khóa Ed25519 thật nên do tổ chức giữ (Web không trích xuất hoặc
thiết bị/dịch vụ ký riêng); API chỉ giữ public key/PoP. Kích hoạt ledger cần đủ
writer/owner MSP. Khóa smoke chứng minh giao thức kỹ thuật; quyền CA/admin/peer/
signer của đối tác ngoài là **NotEvaluated**. Single VPS/orderer không có HA/SLA.
