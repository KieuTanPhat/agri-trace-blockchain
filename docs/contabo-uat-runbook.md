# Runbook UAT Contabo

Ubuntu 24.04, 4 vCPU/8 GB/100 GB, IPv4 `13.140.170.166`. Các bước VPS chỉ chạy
sau khi Phát review [bản chuẩn bị](contabo-uat-review.md) và cho phép chuyển
sang VPS. Người thực hiện xử lý các lệnh; không ghi mật khẩu SSH/credentials
vào báo cáo, shell history hoặc lệnh mẫu.

## 1. Candidate và host

Chọn source/image candidate đã review; ghi SHA, diff/config checksum và image
digests. Không deploy checkout lẫn thay đổi chưa được review. Giữ backup Git
và diff local; không reset/clean hay commit thêm tài liệu ngoài phạm vi. CI
của SHA nền không chứng minh thay đổi UAT chưa commit đã đạt.

Sau review, kiểm OS, CPU/RAM/disk, giờ hệ thống, dịch vụ/listening ports, Docker
hiện có, UID/GID và sudo của `deploy` trước cài đặt. Cài Docker Engine/Compose
qua [apt repo chính thức](https://docs.docker.com/engine/install/ubuntu/) nếu
thiếu. Dùng Node 22.22.3/npm 12.1.0 đúng engines cho scripts/Fabric tooling.
Kiểm SSH key ở phiên thứ hai trước khi đổi đường SSH/firewall. Giai đoạn này
chỉ mở SSH và HTTP; kiểm cả IPv4/IPv6 và Docker host bindings.

Chạy từ thư mục release của `deploy`, với `umask 077`. `.uat/` mode700,
env/accounts/dump/manifest mode600. Sinh cấu hình trên VPS để UID/GID và
đường credentials khớp host:

```bash
npm ci --workspaces --include-workspace-root --no-audit --no-fund
node deploy/prepare.mjs --directory .uat --origin http://13.140.170.166 --release uat-REVIEWED_CANDIDATE
node deploy/preflight.mjs --env .uat/.env.uat
```

Thay tên candidate đã review. Prepare từ chối ghi đè credentials. Đọc/truyền
tài khoản qua kênh riêng có kiểm soát quyền. Không `cat` env/accounts vào
output hỗ trợ. Không in `docker compose config` vì chứa secret; dùng preflight
hoặc `config --quiet`.

## 2. Copy dữ liệu và giai đoạn A

Tại máy nguồn, dùng pg_dump18 (đặt `PG_DUMP_BIN` nếu ngoài PATH):

```bash
node deploy/database.mjs backup-source --source-env apps/api/.env --file .uat/source-YYYYMMDD.dump
```

Lệnh chỉ đọc DB nguồn, giữ read-only snapshot đến khi dump xong. Gửi archive
và `.manifest.json` cùng tên qua SSH vào `.uat/` trên VPS, kiểm quyền600.
Không chuyển nguyên `.env` local hoặc Fabric private keys vào image.

```bash
dc=(docker compose --env-file .uat/.env.uat -f docker-compose.uat.yml)
"${dc[@]}" build api web
"${dc[@]}" up -d --wait --wait-timeout 120 postgres
node deploy/database.mjs restore-empty --env .uat/.env.uat --file .uat/source-YYYYMMDD.dump
"${dc[@]}" --profile tools run --rm migrate
"${dc[@]}" --profile tools run --rm bootstrap
"${dc[@]}" --profile tools run --rm bootstrap
"${dc[@]}" up -d --wait --wait-timeout 240 api worker web proxy
node deploy/smoke.mjs --env .uat/.env.uat --expect-proof PENDING
```

Import **trước migration**, vào DB rỗng. Restore từ chối nếu có public tables
hoặc writers đang chạy. Nếu DB không rỗng, dừng để chọn DB/restore candidate
khác đã review; không xóa schema/volume để vượt guard. Migration phải thành
công trước API/Worker. Bootstrap lần hai cần báo 0 created/5 existing.
Smoke tạo cycle/lot/shipment mới; chạy lại sẽ bổ sung dataset.

Flow restore-full ở trên chỉ dùng với lịch sử đã đạt event preflight. UAT
07/10/2026 đã chọn catalog-only từ full backup: organization10/product3/farm3/
plot2, import sau migration và trước bootstrap. Bốn COPY blocks được whitelist,
target catalog phải rỗng, transaction nguyên tử, counts/ID checksums khớp và
replay bị từ chối. Không nhập users/password/sessions hoặc hai events cũ sai
hash/fingerprint. Xem [trạng thái thực tế](contabo-vps-deployment-status.md).

Kiểm ngoài VPS: `/login`, `/api/health`, public QR, JS/image assets và Swagger
404. DB5432/API8080/Web3000/Worker8081 không public. Đối chiếu compose ps,
docker stats, disk và bindings. Login có giới hạn10/phút; khi chạy lại cần
chờ cửa sổ hết hoặc restart API test có chủ đích, không tắt rate limit.

## 3. Fabric giai đoạn B

Tiếp tục sau A đạt, đã kiểm payload/hash của outbox copy và đủ RAM/disk.
Samples/installer/versions đã pin trong `blockchain/network/network.sh`.
Không chạy up trước bước giới hạn cổng:

Sau khi build chaincode trên host, chạy check read-only trước khi bật Worker:

```bash
"${dc[@]}" run --rm --no-deps -e APP_ENV=uat -e UAT_VALIDATOR_PATH=/validator/validation.js -v "$PWD/blockchain/chaincode/dist:/validator:ro" --entrypoint node api apps/api/scripts/check-uat-events.mjs
```

Check hash và schema bằng validator đã compile, không gửi giao dịch hoặc tạo
proof. Nếu failed, giữ Worker Fabric tắt và xử lý quyết định dữ liệu trước.
Snapshot local có 2 sự kiện cũ sai hash/fingerprint. UAT đã chọn danh mục cũ +
lịch sử mới qua API; không tự sửa hash hoặc đưa lịch sử lỗi lên ledger.

```bash
bash blockchain/network/network.sh bootstrap
node deploy/fabric-ports.mjs --prepare
bash blockchain/network/network.sh up
node deploy/fabric-ports.mjs
```

Kiểm runtime bindings của cả 6 containers CA/orderer/peer: host IP phải là
127.0.0.1. Kiểm ngoài VPS rằng 7050/7051/7053/7054/8054/9051/9054, 9443–9445
và 17054/18054/19054 không truy cập được. Không lấy UFW thay bằng chứng Docker
bindings. Prepare từ chối network đang chạy, revision khác hoặc Compose có
sửa đổi ngoài phạm vi.

Enroll dưới owner `deploy`, `umask 077`; dùng credentials kỹ thuật riêng,
giữ output ở file mode600. CA credentials trong script mẫu dành cho test-
network, cần giữ cổng chỉ nội bộ. Deploy chaincode một lần rồi kiểm Gateway
submit/query. Network smoke có deploy chaincode, chỉ dùng khi thiết lập:

```bash
bash blockchain/network/network.sh enroll-relayer > .uat/fabric-enroll.log 2>&1
bash blockchain/network/network.sh smoke > .uat/fabric-setup-smoke.log 2>&1
npm ci --workspaces --include-workspace-root --no-audit --no-fund
```

Gateway smoke chạy npm ci trong workspace gateway; npm12 có thể thu gọn
dependencies host theo workspace đó. Cài lại graph từ root trước khi gọi
deploy/preflight/smoke. Bước này không sửa lockfile hay images đang chạy.

Bổ sung `.uat/.env.uat`: `WORKER_UID`, `WORKER_GID`, `RELAYER_MSP_DIR_HOST`
(kết thúc `relayer/msp`), `FABRIC_TLS_CERT_HOST` (peer0.org1 TLS CA certificate).
Dùng owner/path thực tế theo `.env.uat.example`; không copy key vào env hoặc
mở quyền private key cho tất cả user để sửa permission.

```bash
node deploy/preflight.mjs --env .uat/.env.uat --fabric
dfc=(docker compose --env-file .uat/.env.uat -f docker-compose.uat.yml -f docker-compose.uat-fabric.yml)
"${dfc[@]}" up -d --wait --wait-timeout 240 worker
node deploy/smoke.mjs --env .uat/.env.uat --expect-proof VERIFIED
```

Smoke VERIFIED kiểm API/public projection. Nghiệm thu ledger cần Gateway
query trực tiếp và đối chiếu event/dataHash/previousEventHash/txId/receipt với
DB. Dùng kịch bản trong `scripts/ci/fabric-integration.mjs` làm acceptance,
nhưng không chạy script đó nguyên xi trên VPS vì có Compose/fixture CI riêng.
Kiểm Worker enabled/running, lastError và backlog. Outage/recovery phải có
evidence; không sửa outbox/proof để làm trạng thái xanh.

## 4. Backup, upgrade và rollback

Backup hiện cần maintenance ngắn để counts/hash khớp archive. Dừng writers
(Worker grace120s), chờ jobs kết thúc, rồi backup:

```bash
"${dc[@]}" stop api worker
node deploy/database.mjs backup-uat --env .uat/.env.uat --file .uat/backup-YYYYMMDD-HHMM.dump
```

Giữ dump + manifest ở storage riêng có quyền hạn/mã hóa. Đề xuất giữ7 bản
ngày và backup trước release; không tự xóa bản đang dùng. Backup riêng Fabric
volumes, CA/MSP, signer và version manifest. Rehearse restore vào **Compose
project/DB rỗng khác**, env riêng cùng PG18, verify counts/hash trước start.
Không dùng down -v/network.sh down/db reset/down migration trên UAT cần giữ
dữ liệu. Cleanup volume chỉ nằm trong job CI với DB disposable.

Khi chụp Fabric volumes, dừng writers và sáu dịch vụ CA/orderer/peer trước tar;
giữ DB dump, ba ledger volumes, organizations/identities, cấu hình riêng và
checksums cùng snapshot. Khi khôi phục chạy, start sáu dịch vụ Fabric rồi
API/Worker. Peer tự xóa/tạo lại container chaincode; không start theo ID/name
chaincode đã lưu trước shutdown. Đối chiếu ledger sau khi resume.

Upgrade: ghi candidate cũ/mới → maintenance/stop → backup → build/tag →
migration job → API health → Web → Worker A/B → smoke/evidence. Dùng dfc khi
cần Worker bật Fabric; dc base tắt Worker Fabric. Giữ cấu hình nhất quán.

Rollback image trước nếu tương thích schema, sửa RELEASE_TAG về candidate
đó rồi start đúng Compose A/B. Không tự rollback schema. Nếu restore DB cũ,
giữ maintenance/Worker dừng, reconcile event/hash/txId với ledger trước retry.
Không đổi idempotency key khi submit chưa rõ hoặc xóa lịch sử/outbox/proof.

## 5. Domain sau UAT

Sau Web/API/DB/Fabric ổn: mua domain, DNS A về IPv4; chỉ thêmAAAA sau kiểm
IPv6. Tạo candidate origin mới, build lại Web (NEXT_PUBLIC là build-time),
đổi CORS/trace base/Caddy HTTPS; mở443 sau kiểm certificate/routing. QR cũ
giữ URL trong bản ghi, cần kiểm link cũ/chính sách chuyển tiếp trước đổi
origin. Kiểm lại camera/PWA và phiên trên HTTPS.
