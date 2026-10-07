# Vận hành CD UAT Contabo

Thiết kế và review: [contabo-cd-plan.md](contabo-cd-plan.md). Workflow:
[UAT CD](../.github/workflows/uat-cd.yml). Release code và evidence thực tế được
ghi trong [contabo-cd-status.md](contabo-cd-status.md).

## Luồng bình thường

Push code lên main → Application CI + Blockchain CI + Dependency Audit đúng
SHA → build/publish GHCR API/Worker và Web → immutable release bundle → SSH
controller → preflight → consistent backup → migration → API → Worker → Web
→ 5 roles + QR/direct ledger + canary proof → promote current/previous.

Push chỉ đổi docs không kích hoạt CD. Một candidate bị commit mới vượt qua
sẽ không deploy. Các push mới không hủy transaction deploy đang thực hiện.
VPS dùng flock để từ chối hai lệnh thay đổi chạy cùng lúc.

Vào GitHub → Actions → UAT CD → Run workflow, chọn branch main:

| Operation | Tham số | Hành vi |
| --- | --- | --- |
| deploy | Không cần thêm | Deploy SHA main đã có 3 CI push thành công |
| upgrade | expected_sequence hiện tại | Install/approve 2 org, commit sequence+1, rollout và verify |
| rollback | rollback_sha đủ 40 ký tự | Chuyển tới release đã verified; snapshot mới, giữ DB/outbox/ledger |
| recover | Không cần thêm | Reconcile journal và phục hồi previous verified release |

Dispatch deploy/upgrade không thay thế CI: nếu SHA chưa có push CI, workflow
sẽ đợi rồi fail. Chạy lại 3 workflow CI của commit đó khi cần. Rollback và
recover dùng release đã verify trên VPS nên không build image mới.

## Kiểm trạng thái

Khóa CD riêng chỉ gọi forced-command; user SSH cá nhân vẫn quản trị theo
quyền hiện có. Không đưa khóa SSH cá nhân vào GitHub.

```bash
ssh -i /path/to/cd_key -o IdentitiesOnly=yes agri-cd@13.140.170.166 status
```

Trả về release current/previous, chaincode sequence và recoveryRequired.
Khóa CD không cấp terminal, forwarding, SCP/SFTP hay lệnh shell tùy ý.

Admin dùng khóa quản trị hiện có để đọc `/opt/agri-trace/cd/state.json`,
`last-result.json`, `journal.json`, `operations.log` và records. Đây là file
private; không paste env, accounts, signer hoặc nội dung dump vào issue/log.
HTTP health: <http://13.140.170.166/api/health>; Web:
<http://13.140.170.166/login>. Worker readiness chỉ bên trong Docker.

Config bền vững ở `/opt/agri-trace/shared/config/.env.uat` và `accounts.json`.
Controller dùng Compose project `agri-trace-uat`, named PG/Caddy volumes và
đường dẫn signer/TLS tuyệt đối tới runtime Fabric gốc. `current` trỏ tới app
release mới; runtime Fabric gốc vẫn được sử dụng và phải được giữ lại.

Web server dùng `API_INTERNAL_BASE_URL=http://api:8080/api` để render QR qua
Docker network. Browser vẫn dùng `NEXT_PUBLIC_API_BASE_URL` đã build theo
public origin. Không dùng loopback của host làm URL API bên trong container.

## Rollback và sự cố

- Rollback tự động khi candidate health/verification thất bại. Database và
  ledger không bị restore; schema mở rộng và canary đã commit được giữ.
- Rollback app bằng operation rollback và SHA đã verified. Baseline manual
  UAT được adopt dưới SHA `c1a69edbf95daf28ed441e05337d6b50ec0e9553`; metadata
  giữ nguyên manifest overlay và immutable image IDs của snapshot đó.
- Nếu chaincode fingerprint khác, dùng package cũ với sequence mới cao hơn.
  Không giảm sequence. CLI commit timeout phải query committed trên 2 peer.
- Nếu rollback cũng thất bại hoặc process bị ngắt: đọc status, chọn recover.
  Journal giữ baseline hashes/counts để verify dữ liệu cũ sau phục hồi.
  Nếu state đã promote nhưng journal chưa xóa, recovery lấy package chaincode
  của release trước trong journal và tăng sequence khi cần; không lấy nhầm
  package mới từ state để chạy với application cũ.
- `_prisma_migrations` chưa finished là lỗi cần reconcile schema/Prisma sau
  review. Không chạy `migrate reset`, seed, xóa outbox/proof hay tự restore
  dump để làm CI xanh. CD chặn release tiếp theo khi lịch sử migration chưa rõ.
- Nếu kết quả chaincode không xác định hoặc peer khác nhau, giữ writers dừng
  và inspect definitions/package IDs; resolve/recover rồi mới nhận ghi mới.

## Migration và chaincode

Application CI chạy chính `Controller.migrate` trên PostgreSQL UAT tạm của
runner. VPS dùng image đã pull theo digest với `compose run --pull never`;
không dùng cờ `--no-build` (chỉ có ở `compose up`).

Checksum trong catalog DB của migration đã apply được giữ nguyên.
Guard nhận bản LF/CRLF của cùng một script như
[Prisma checksum validation](https://github.com/prisma/prisma-engines/blob/main/schema-engine/connectors/schema-connector/src/checksum.rs),
đồng thời kiểm bytes source với manifest. Không sửa checksum trong DB; đổi SQL,
comments hoặc thêm/bớt newline cuối vẫn bị chặn. `.gitattributes` giữ SQL LF.

Auto-CD chỉ cho CREATE TABLE,
index thường và ADD COLUMN nullable không default/constraint; SQL khác bị
chặn trước stop app. Breaking migrations cần kế hoạch expand/contract và
review riêng. Routine CD không đổi image PostgreSQL/Caddy hoặc network policy.

Chaincode chỉ update qua upgrade, với current expected_sequence. Artifact
TypeScript được compile trong GitHub runner, peer package cùng artifact và
install trên 2 peer. Không chạy bootstrap/up/down test-network khi update.
Endorsement mặc định/collections rỗng được kiểm; custom policy cần extension
được review, controller sẽ từ chối tự đổi policy.

## Backup ngoài VPS

Mỗi transition tạo PostgreSQL custom dump + ledger volumes + CA/MSP/relayer
và config khi writers/Fabric dừng. Fabric resume trong finally. Snapshot
được mã hóa CMS AES-256-GCM bằng public certificate, private key chỉ bàn giao
trên máy chủ sở hữu. Workflow upload ciphertext `.cms` làm artifact 30 ngày,
kể cả khi candidate fail sau snapshot. Backup plaintext vẫn private trên VPS.

Download/upload artifact phải đạt để workflow CD báo success. Nếu app đã verify
nhưng upload backup thất bại, state current vẫn là app đã verify; rerun delivery
của cùng SHA để kiểm app và upload lại ciphertext. Không restore DB hoặc rollback
dữ liệu chỉ để xử lý lỗi upload artifact.

Tải artifact `uat-encrypted-backup-<SHA>-<attempt>` từ Actions. Giải mã trên
máy tin cậy, ngoài repo, bằng OpenSSL với private key bàn giao riêng:

```bash
openssl cms -decrypt -binary -inform DER -in uat-backup.cms \
  -recip backup-recipient.pem -inkey backup-private.pem -out snapshot.tar
tar -xf snapshot.tar -C /private/recovery-directory
```

So từng file với `checksums.json` trước khi dùng. Thực hiện PG restore trên
database mới rỗng để verify counts/hash; không restore vào DB UAT đang ghi.
Khôi phục sau mất VPS cần bộ ledger/identity/config cùng snapshot và đúng
Fabric/PG versions. Dừng writers, phục hồi lên host/volumes riêng và đối soát
event/proof/txId trước mở ứng dụng. Routine rollback không thực hiện bước này.

Private recovery key trên máy Phát:
`C:\Users\kieup\.agri-trace-uat\cd\backup-private.pem` (ACL owner/System).
Public certificate ở cùng folder và `/etc/agri-trace-cd/backup-recipient.pem`.
Đừng xóa/mất key: ciphertext artifact không thể giải mã chỉ bằng SSH/CCP.

## Cấu hình GitHub

Environment `uat`: branch policy main. Secret `UAT_SSH_PRIVATE_KEY` là dedicated
key; vars `UAT_HOST`, `UAT_USER`, `UAT_KNOWN_HOSTS`, `UAT_PUBLIC_ORIGIN`.
Repo var `UAT_PUBLIC_ORIGIN` cấp origin build-time cho publish job.

Publish chỉ có contents:read/packages:write. Deliver có contents/actions/
packages:read, nhận SSH key từ environment. GHCR login token có hạn của job,
được xóa khỏi temporary Docker config sau pull. Source/revision/origin labels
phải khớp digest manifest; full-SHA tags đã có được reuse khi rerun.
Registry username lấy rõ từ `github.actor`; credential job được coi là chuỗi
opaque, cho tối đa 8 KiB trong header truyền tối đa 16 KiB, không ghi giá trị
vào log. Guard không phụ thuộc độ dài token ngắn của các phiên bản cũ.

Controller là code root-owned ở `/usr/local/lib/agri-trace-cd`; không tự thay
controller bằng file trong candidate. Manifest kiểm version hash 4 helper
files. Khi sửa controller/policy/verify/entry: review/tests, admin cài bằng
`deploy/cd/install.py` từ bản source đã review rồi mới chạy lại CD. Installer
idempotent giữ config/state/khóa/ledger; đây là ranh giới quyền quản trị server.

## Giới hạn hiện tại

- Single VPS có downtime ngắn khi backup/rollout, không hứa zero downtime.
- HTTP IPv4 theo quyết định UAT; domain/HTTPS thay origin cần build Web mới và
  kiểm QR URLs cũ, CORS, cookie/PWA trước đổi public endpoint.
- Verification toàn bộ lịch sử phù hợp UAT và giới hạn 10.000 events; khi dữ
  liệu lớn hơn cần mở rộng verifier/budget sau review.
- Giữ release/images/snapshots phục hồi; CD chặn khi disk còn dưới 12 GiB.
  Cleanup chỉ theo retention đã review, không prune volumes và không xóa
  runtime Fabric gốc còn có bind mounts. Portainer riêng không thuộc CD stack.
