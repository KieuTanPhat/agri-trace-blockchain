# Vận hành dev và production

## Target và giới hạn của đợt chuyển cấu hình

| Thuộc tính | Development | Production |
| --- | --- | --- |
| Branch / origin | `dev` / `https://nongtrace.site` | `main` / `https://agritrace.dev` |
| GitHub environment | `development` | `production` |
| SSH identity | `agri-cd-dev` | `agri-cd-prod` |
| Root config | `/etc/agri-trace-cd/dev/config.json` | `/etc/agri-trace-cd/prod/config.json` |
| Base / state | `/opt/agri-trace-dev` | `/opt/agri-trace` |
| App project | `agritrace-dev` | Adopt `agri-trace-uat`, giữ volume đang chạy |
| Ingress | `agritrace-dev-ingress` | `agritrace-prod-ingress` |
| Runtime mặc định | PostgreSQL + API + Web | Existing PostgreSQL + API + Web + Worker/Fabric |

Mốc A tách môi trường và giữ hệ thống hiện có hoạt động. Mốc B mở production
thật cần nghiệm thu release/data, Fabric topology/identity, load và recovery
theo AGT-005/029/030/031. Không tự gọi test-network hiện tại là thiết kế Fabric
production đã được nghiệm thu. Production delivery giữ disabled tới Mốc B;
việc này không dừng website/Fabric hiện có.

Edge project `agritrace-edge` là chủ duy nhất của 80/443 và certificate volumes.
Dev delivery key không có quyền sửa routes, config hoặc chọn tài nguyên prod.
Mỗi lần delivery lấy khóa môi trường rồi khóa host, fail fast nếu một thao tác
khác đang chạy. Dev delivery cần ít nhất 1.5 GiB MemAvailable; bật Fabric cần
thêm 2 GiB. Đây là admission guard, không thay thế phép đo tải thực tế.
Dev có giới hạn PostgreSQL 384 MiB, API 384 MiB, Web 512 MiB; Worker khi bật
512 MiB. Kiểm OOM/restarts và độ trễ prod khi tăng tải.

## Cài đặt một lần bởi quản trị viên

Đọc inventory live, giữ snapshot và restore evidence trước cutover. Dùng source
đã commit và review; các helper trong bundle không tự cập nhật helper root.
Không chạy installer từ một archive chưa kiểm source/checksum. Tạo hai SSH
deploy keys riêng, không đưa khóa root/admin lên GitHub. Khóa backup giải mã
giữ ngoài VPS/GitHub, chỉ public recipient certificate được cài lên server.

1. Tạo `/opt/agri-trace-dev/shared/config` root-only. Sinh `.env` từ
   `.env.deploy.example` với secrets mới cho dev, không copy secrets prod.
   `accounts.json` có năm role test riêng theo `deploy/fixtures.mjs`; file 0600.
   Giữ `APP_ENV=uat` chỉ trong bootstrap một lần của database dev mới.
2. Cài certificate nhận backup vào config shared của dev. Controller không
   seed, migrate hoặc reset production trong quá trình adoption.
3. Cài hai identity/config bằng root; config dev bắt đầu disabled:

```bash
python3 deploy/cd/install-target.py install --environment development \
  --config deploy/environments/development.json --public-key /root/dev-cd.pub
python3 deploy/cd/install-target.py adopt-legacy --environment production \
  --public-key /root/prod-cd.pub
```

Installer giữ state/history/core rollback floor/PGDATA/Fabric legacy.
Nó chỉ chấp nhận đúng binding branch/domain/project/paths; dev không thể chọn
production config hoặc mạng `fabric_test`. SSH keys dùng forced command,
password bị khóa, không shell/port forwarding; sudo chỉ gọi wrapper của target.

4. Tạo GitHub environments với custom branch policy: development chỉ `dev`,
   production chỉ `main`. Cài environment secrets `CD_SSH_PRIVATE_KEY` và vars
   `CD_HOST`, `CD_USER`, `CD_KNOWN_HOSTS`, `CD_PROJECT`, `CD_PROFILE`,
   `CD_DEPLOY_ENABLED`. Dev profile `light`; prod profile `fabric` và project
   `agri-trace-uat` cho adoption. Host key pins phải được đối chiếu bằng admin.
5. Đặt repo var `UAT_DEPLOY_ENABLED=false` và legacy server config `enabled=false`
   trước chuyển proxy. Giữ controller cũ để phục hồi trong maintenance, nhưng
   không cho hai CD paths cùng điều khiển app project. Recover journal cũ trước
   cài đặt/chuyển đổi; không hủy một mutation đang chạy.
6. Chuẩn bị và chuyển Edge. Installer không tự cấp quyền Edge cho CD:

```bash
python3 deploy/edge/admin.py prepare
python3 deploy/edge/admin.py cutover
```

Prepare xác minh exact certificate volumes và nối prod ingress vào API/Web hiện
có. Caddy validate dùng storage dùng thử. Cutover dừng proxy cũ trước mở Edge;
health HTTPS prod apex/www lỗi thì dừng Edge và bật lại proxy cũ. Nếu tiến trình
bị ngắt, kiểm hai proxy/ports rồi chạy lại cutover; không cho cả hai proxy chạy
cùng certificate volumes. Rollback Edge: dừng Edge, bật legacy proxy, xác minh
health trước bật lại legacy delivery.

7. DNS dev A `@ → 13.140.170.166`, CNAME `www → nongtrace.site`; giữ DNS prod.
   Bật route dev bằng `python3 deploy/edge/admin.py enable-dev`, rồi bật server
   development và GitHub development `CD_DEPLOY_ENABLED=true`.
8. Dispatch Dev CD trên ref `dev` hoặc push dev. Ba push CI của đúng branch/SHA
   phải đạt. Lần đầu controller chỉ tạo volume chưa tồn tại, migrate schema,
   bootstrap dev, kiểm auth/cookies/RBAC/Pending, lưu snapshot CMS đã mã hóa.
   Volume có sẵn mà chưa có state được chặn để quản trị viên đối chiếu.

```bash
python3 deploy/cd/install-target.py enable --environment development
```

## Delivery, rollback và recovery

`dev-cd.yml` / `production-cd.yml` gọi cùng workflow nhưng dùng environment,
credentials, origin, image tags và branch evidence riêng. Images dùng digest;
tags `dev-SHA` và `prod-SHA` có labels environment/branch/origin. Cùng source SHA
không làm Web image của hai domain dùng chung. Publisher từ chối overwrite/reuse
tag có labels hoặc non-root runtime không đúng.

Dispatch operation `deploy`, `upgrade`, `rollback` hoặc `recover` trên đúng ref.
Upgrade cần expected sequence; production không có light bypass. Server kiểm
lại SHA mới nhất, ba workflow CI, controller checksums, metadata và Compose
trước pull/migrate/restart. Thay helper tin cậy cần administrator install trước
delivery, không cho SSH key tự sửa controller.

Delivery snapshot dừng đúng writers của target, dump PostgreSQL, ghi hashes,
mã hóa config/identity/ledger tương ứng. Light dev không stop/read Fabric prod.
Artifact backup tách theo env; mất transport không để artifact dở. App rollback
không restore DB/ledger và không vượt core rollback floor. Failed readiness hoặc
interruption giữ journal, dừng writers và yêu cầu recover. Initial dev recovery
kiểm schema/checksums và volume ownership, không xóa dữ liệu để thử lại.

CD tạo canary trong catalog được config root cho phép. Dev catalog nằm trong
database dev; prod đang dùng catalog UAT đã kiểm kê cho adoption, cần một catalog
canary approved riêng trước Mốc B. Không chạy bootstrap hoặc canary vào catalog
người dùng thật ngoài scope nghiệm thu.

## Bật Fabric dev khi cần

Chưa provision thêm một mạng Fabric ở bước dựng dev nhẹ. Khi cần, quản trị viên
provision network riêng và giữ nó qua các lần bật/tắt. Không chạy nguyên
`network.sh up/down` mặc định lần thứ hai trên VPS hoặc reset ledger rồi giữ DB
proof cũ. Yêu cầu descriptor `fabric` root-owned trong config dev:

- Network `agritrace-dev-fabric`; tất cả container/ledger-volume names bắt đầu
  `agritrace-dev-`; không dùng tên/cổng/network/identity prod.
- Root, admin MSP, TLS, peer binary/config và backup paths nằm trong
  `/opt/agri-trace-dev/shared/fabric`; không symlink sang prod.
- Hai peer bindings và orderer với addresses, hostnames, MSP/TLS được đối chiếu;
  riêng worker có mounts read-only và network đúng binding.
- Chaincode đã cài từ exact current dev release, label `agritrace-SHA`, packages
  hai org khớp package ID tính từ source; retain channel/ledger/CA/identity.
- Thêm Worker env theo `.env.deploy.example`, cài lại config bằng installer
  với dedicated public key hiện có. Giữ `profile=light`, `fabric_enabled=false`;
  runtime switch không làm đổi identity của release manifest cùng SHA.

```bash
python3 deploy/cd/install-target.py fabric-on --environment development
python3 deploy/cd/install-target.py fabric-off --environment development
```

Fabric-on kiểm container network/mount ownership trước mutation, đối chiếu
committed/approved packages, bật Worker và kiểm canary/ledger proof. Fabric-off
dừng Worker trước mạng riêng, giữ DB/ledger/identity và trở về light. Lỗi switch
giữ `runtime-toggle.json`, dừng writers; admin sửa nguyên nhân và chạy lại switch.
CD không deploy đè transition chưa rõ. Fabric-on/off chưa được chứng minh trên
VPS nếu chưa có network dev; Blockchain CI dùng Fabric riêng trên runner.

## Suspend, retire và dựng lại dev

Đặt development GitHub `CD_DEPLOY_ENABLED=false`, rồi suspend để trả RAM:

```bash
python3 deploy/cd/install-target.py suspend --environment development
```

Muốn gỡ website test, gỡ route rồi retire app runtime:

```bash
python3 deploy/edge/admin.py disable-dev
python3 deploy/cd/install-target.py retire --environment development
```

Suspend/retire chỉ tắt dev và giữ volumes/config/backups. Không có `down -v`,
`docker system prune` hoặc xóa wildcard trên VPS. Edge/prod/branch dev/CI vẫn
giữ. DNS có thể gỡ sau; xóa DNS riêng không trả RAM. Xóa volumes/identities là
một retention action explicit khác sau backup đã verify.

Dựng lại từ retained storage: server `enable`, Edge `enable-dev`, GitHub flag
true; dispatch Dev CD đúng ref/SHA có đủ CI. Nếu current SHA chưa đổi, controller
khởi động lại app và verify, không bootstrap/reset data. Kiểm marker/canary,
counts/hash và prod IDs/StartedAt/health trước–sau. Khi chuyển VPS, restore DB
và Fabric tương ứng theo một kế hoạch riêng, không trộn DB với ledger trống.

## Verification và evidence

`npm run test:ci`, Linux Python controller/SSH tests, `npm run check`,
Worker contract/OpenAPI/dependency audit và Blockchain CI phải đạt. Windows skip
Linux SSH tests không được tính Passed; CI runner chạy lại chúng. Rehearsal
`deploy/cd/rehearse-environments.py` chỉ nhận disposable GitHub runner và reset
exact projects của run, không dùng trên VPS.

Lưu evidence source SHA/digests, profile, DB mounts/counts/hash, Fabric sequence,
prod identities trước–sau dev delivery/retire, DNS/TLS/auth/Pending, decrypted
snapshot restore vào tài nguyên riêng, capacity và trạng thái Mốc A/Mốc B.
Không đưa password, tokens, private keys hoặc private payloads vào báo cáo.
