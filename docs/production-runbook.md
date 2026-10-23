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

Production đã được cài và chạy. Lệnh `fresh-install` của installer chỉ chuyển từ
schema 2 đã tắt sang schema 3, nên đã gỡ cùng phần cấp identity dành riêng cho lần
chuyển đó. Không dùng source hiện tại để adopt lại UAT hoặc tạo lại target trên VPS.
Quyết định/acceptance của lần cài đầu vẫn nằm trong [plan cài mới](plans/fresh-install-cleanup-2026-10-13.md).
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

Ứng viên onboarding cần `HOSTED_WORKER_CONFIG_HOST` là thư mục riêng chỉ có
`bindings.json` và `enterprise-connections.json` (inventory khởi đầu
`{"version":1,"targets":[]}`). `FABRIC_BINDINGS_CONFIG_HOST` và
`ENTERPRISE_CONNECTIONS_CONFIG_HOST` trỏ tới hai file đó. Worker mount cả thư mục
readonly ở `/hosted-config` để thấy bản mới sau atomic rename; không mount thư
mục cha chứa credentials. File không được group/world writable hoặc là symlink.
`ENTERPRISE_ONBOARDING_ENABLED=false` đóng admission; khi mở phải
đồng nhất trên API/Worker. Controller kiểm các ranh giới này trước delivery.

GitHub đặt `CD_PROJECT=agritrace-prod`, `CD_PROFILE=fabric`, origin
`https://agritrace.dev`, known-hosts và delivery key đã pin. Giữ công tắc delivery
hiện có khi giao bản. Trước khi cập nhật helper, đối chiếu SHA/CI, journal,
delivery/host locks và ownership theo phần *Cập nhật controller*. Không prune hoặc
reset DB. Khóa giải mã backup nằm ngoài VPS/GitHub; snapshot mã hóa phải có trước
khi CD đổi bản chạy. Không khôi phục DB riêng sau khi ledger đã commit.
Luồng `forward` mở phiên smoke của đúng candidate sau migrate, đóng cờ phiên
trong `finally`; smoke lỗi vẫn giữ journal và dừng writers để đối soát.

## Delivery và smoke trên VPS

`Production CD` kiểm ba CI push thành công đúng main SHA, HEAD hiện hành, immutable
API/Web/chaincode images, helper checksums, Compose/mounts/quotas, governance và
migration catalog. Không thay byte migration đã áp hoặc bỏ parser default-deny.

Lần đầu bắt đầu từ DB trống, ghi floor trước migrate rồi operator tạo account/
catalog/chain/binding/approvals. Owner MSP chỉ cấp cho operator một lần; API/Worker
thường trực không nhận owner/CA/orderer keys. Bootstrap có thể đối soát/tiếp tục.
Container bootstrap chỉ đọc Worker inventory; khi binding mới cần thêm, controller
trên host ghi `bindings.json` bằng file tạm cùng thư mục + fsync + rename dưới
delivery lock, đọc lại rồi chạy lại bootstrap để activate. Ghi lỗi giữ nguyên
inventory đã review; file `.bindings.json.next` còn sót từ lần gián đoạn được bỏ.

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

### Nâng giao thức chữ ký c1 lên c2

Bản sửa ràng buộc nội dung dùng intent protocol 2, envelope 6.0.0 / private hash
5.0.0. Review migration append-only `20261019000000_signed_content_commitment`
và checksum theo quy trình hiện hành. Giữ writers đóng khi nâng chaincode, API,
Worker và Web; kiểm HealthCheck có write version 6.0.0 trước khi mở lại. Worker
từ chối writer chỉ hỗ trợ c1. Khóa Ed25519/PoP và binding không đổi.

Trước rollout, kiểm kê intent c1 PENDING, outbox c1 và delivery attempts. Intent
chưa gửi cần chuẩn bị lại; command đã gửi/kết quả chưa rõ phải giữ original key,
đối soát proof/attempt/fence. Worker có thể xác nhận proof c1 đã commit và khớp
toàn bộ bằng chứng; c1 chưa commit sau đối soát dừng ở dead letter, cần rà soát.
Không rehash, sửa payload/chữ ký lịch sử hoặc tự gửi lại bằng event/key mới.
Kiểm bằng chứng lịch sử không còn khớp nội dung và xử lý theo quy trình reconcile.

Smoke bản mới phải gồm đổi quantity nhưng giữ chữ ký, tính lại commitment, thử
ghi c1 và ghi B không chữ ký cho handover: tất cả phải bị từ chối. Một bàn giao
offer/confirm đúng phải có proof c2 trùng payloadDigest/metadataDigest và VALID.

### Recovery thông thường

Lỗi giữ writers đóng/dừng, journal, DB/outbox/ledger và original command keys.
`recover` lần đầu tiếp tục đúng candidate; không reset DB, giả verified release
cũ hoặc tự resolve migration chưa hoàn tất. `hybrid-floor.json` chặn image thiếu
schema/protocol. Rollback ứng dụng chỉ tới image verified tương thích; không
restore DB riêng sau ledger commit. Hosted chaincode thay đổi cần lifecycle review,
không gọi `upgrade` để thay B/C vào channel legacy.

### Nghiệm thu peer doanh nghiệp trên VPS thứ hai

Chủ dự án cho phép nghiệm thu trên production sau sao lưu. Hai VPS dùng tuyến
WireGuard riêng (`10.77.0.1` phía platform, `10.77.0.2` phía doanh nghiệp). Relay
`blockchain/network/production/tcp-relay.py` chỉ chuyển byte TLS từ cổng trên VPN
tới cổng loopback hiện hữu, không kết thúc TLS hoặc giữ signing key. Security
group/firewall chỉ cho tuyến đã review; không mở peer/orderer/CA ra Internet.

Doanh nghiệp khởi tạo CA/admin/peer bằng bộ cài enterprise tại máy mình. Chỉ
chuyển public MSP/TLS sang platform. Với channel `hybrid-self` đã tạo nhưng chưa
có binding doanh nghiệp, `external-owner.py` chuẩn bị bản đổi root CA/NodeOUs
và anchor của Org3; nó không ký hoặc gửi cập nhật. Kiểm fingerprint, nội dung
config update và binding chưa được cấp cho bên khác. Admin hiện hành ký cập nhật
theo policy, giữ toàn bộ block cũ; kiểm CA cũ không còn được tin cậy cho hành
động mới. Không gán private identity Org3 cũ cho doanh nghiệp mới.

Sau khi đối soát peer doanh nghiệp, `hosted.external_owner` pin protocol
`agritrace-external-owner/1`, MSP/channel/hostname, endpoint `10.77.0.2:11051`
và public `tls_ca` trong hosted root. Bỏ stack Org3 cũ khỏi resource catalog đang
hoạt động; bản lưu và tài nguyên cũ được giữ riêng. API/Worker không nhận owner
admin/CA key. Nâng CaaS image và definition trên từng channel là thao tác lifecycle
riêng được review, tăng sequence và xác minh policy/package/HealthCheck c2.
Ghi journal và baseline trước thao tác; nếu app cũ không tương thích sau lifecycle,
giữ writers dừng và giao candidate bằng luồng `forward` hiện hành, không giả
verified release hoặc sửa receipt lịch sử.

Backup khi đã có peer ngoài phải dừng writers và phối hợp hai host: đóng băng,
đối chiếu block height/hash, lưu database/config/ledger/danh tính của từng bên,
mã hóa rồi tải khỏi VPS. Khóa giải mã ở ngoài hai VPS. Controller từ chối snapshot
nếu `external_backup_receipt` không trỏ tới receipt private protocol
`agritrace-coordinated-backup/1` đúng candidate SHA/MSP, archive doanh nghiệp,
fingerprint baseline và block hiện tại. Nó không có SSH key để tự sao lưu máy
doanh nghiệp. Đọc block của peer Org3 bằng QSCC `GetChainInfo` với channel
`hybrid-self` trong proposal, xác thực TLS bằng public CA và ký bằng operator
Org1. `peer channel getinfo` tạo proposal không có channel nên chỉ dùng với peer
cùng MSP; không chuyển khóa Org3 sang platform để vượt giới hạn đó.
Khôi phục cách ly và khôi phục peer thật phải giữ cùng khóa,
installation, genesis, txId/proof; không restore database riêng sau ledger commit.

Đo tài nguyên cả host và container cùng thời gian/tải, gồm CPU, peak RAM, đĩa,
OOM/restart, độ trễ và backlog. Kết luận cấu hình thấp nhất **đã kiểm chứng** ở
tải đã ghi; quota container hoặc kết quả một VPS không chứng minh mọi VPS nhỏ
hơn đều đạt. Kết quả mỗi lần chạy nằm trong PR/artifact, không chép vào hướng dẫn.

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
