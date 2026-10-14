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

Schema 2 / `agri-trace-uat` thuộc dữ liệu test đã retire. Giữ release record,
volume và archive cũ; không nhập history/accounts/QR vào DB mới. Không trộn lệnh
adopt cũ với cài schema 3. [Runbook cũ](contabo-cd-runbook.md) phục vụ bản lưu.

Edge chuyển HTTP trên địa chỉ IP sang HTTPS `agritrace.dev` bằng 308, giữ nguyên
path/query. Không phục vụ form đăng nhập qua HTTP. Kiểm route này sau reload.

1. Tắt `CD_DEPLOY_ENABLED`; kiểm SHA/CI, journal, delivery/host locks, installed
   helpers và ownership từng resource/path. Không prune rộng hoặc reset DB chung.
2. Khóa giải mã backup nằm ngoài VPS/GitHub. Dừng writers, chụp DB và ledger/CA/
   MSP/config/controller/image nhất quán, mã hóa rồi tải khỏi VPS. Giải mã, kiểm
   checksum, khôi phục DB và ledger vào môi trường cách ly; đối chiếu counts,
   hash/txId/history/identity. Giữ evidence trước khi chuyển target.
3. Dừng toàn bộ app/Fabric/chaincode cũ theo catalog, đặt root config cũ
   `enabled=false`. File private `restore_evidence` dùng protocol
   `agritrace-backup-restore/1`, checksum archive và kết quả DB/ledger restore
   ngoài VPS. Installer từ chối thiếu bằng chứng hoặc reuse PGDATA.
4. Dựng mạng bằng `blockchain/network/production/provision.py --spec <private-json>`.
   Spec `agritrace-hosted-network/1` pin images, source fingerprint, governance,
   tools/root/instance/ports. Mẫu [network](../deploy/hosted-network.example.json).
   CA secrets ngẫu nhiên; enrollment/TLS CA riêng mỗi Org, TLS transport/chaincode,
   persistent CA/MSP/ledger, cổng admin loopback. Script Hybrid pilot chỉ phục vụ
   test; không dùng làm bộ cài production.
5. Cài `policy.CONTROLLER_FILES` từ source đã kiểm vào root-owned helper directory;
   checksum phải khớp manifest. Tạo env/accounts/bootstrap/smoke/binding/identity
   export riêng tư. DB mới tên `agri_trace_prod`, mật khẩu ngẫu nhiên >=24 ký tự.
   Bootstrap không gọi seed UAT hoặc đổi account hiện có.

   ```bash
   sudo python3 deploy/cd/install-target.py fresh-install --environment production \
     --config /root/reviewed-fresh-production.json --public-key /root/prod-delivery.pub
   sudo python3 deploy/cd/install-target.py enable --environment production
   ```

6. Config schema 3 dùng `hosted`, `smoke`, `bootstrap`; `migration_reviews` pin
   checksum + `hybrid-abc/1`. `fresh_release_ack` pin protocol
   `agritrace-fresh-install/1`, SHA và manifest digest. `open_after_smoke=true`
   mở ghi sau nghiệm thu, mặc định CLOSED. Đây là kiểm kỹ thuật trong quyền đã giao.
7. GitHub đặt `CD_PROJECT=agritrace-prod`, `CD_PROFILE=fabric`, origin
   `https://agritrace.dev`, known-hosts và delivery key đã pin. Bật CD khi sẵn sàng.
   Khi cần digest/bundle để provision lần đầu, dispatch operation `publish` sau
   full main CI trong lúc delivery còn tắt; operation này chỉ xuất image/bundle,
   không kết nối VPS. Sau cài target, bật delivery và dispatch `deploy` cùng SHA.

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
