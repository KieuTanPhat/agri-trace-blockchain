# CD Demo/UAT Contabo: kế hoạch và review

Ngày: 07/10/2026. Phạm vi: một VPS Ubuntu 24.04, Web/API/Worker/PostgreSQL 18,
Fabric 2.5.16, origin HTTP IPv4 hiện tại. Người yêu cầu đã cho phép triển khai
CD và push GitHub sau kiểm chứng. Tham chiếu: AGT-031 (#43), AGT-005 (#17).
Đây là CD cho UAT; domain/HTTPS và nghiệm thu nghiệp vụ core có lịch riêng.

## Hiện trạng đã kiểm tra

- `main` và `origin/main` cùng base `c1a69ed`; release UAT có overlay đã test
  nhưng chưa commit. Không có workflow CD, environment hay Actions secret.
- Repo public, tài khoản có quyền admin/push. Ba workflow CI hiện có chạy trên
  push/PR main. CD giữ chúng và đợi kết quả đúng SHA, event push, branch main.
- VPS có Docker/Compose, khóa quản trị và user deploy. App/worker/DB healthy,
  Fabric chạy; PostgreSQL/ledger/identities đã có dữ liệu cần bảo toàn khi CD.
- Fabric runtime và signing identity đang ở release đầu tiên. Không di chuyển
  bind mount đang chạy; config dùng đường dẫn tuyệt đối ổn định tới runtime đó.
- Local có thay đổi tài liệu/công cụ riêng ngoài deployment. Commit chọn đúng
  file phục vụ UAT/CD, giữ những thay đổi khác và các backup Git đã có.

## Quyết định triển khai

1. GitHub-hosted runner: không đặt Actions runner có quyền Docker trên VPS.
2. Push main chọn đường dẫn runtime/CD sẽ kích hoạt UAT CD. Dispatch có deploy,
   rollback, recover và nâng chaincode với expected sequence rõ ràng.
3. CI gate đọc GitHub API, yêu cầu Application CI, Blockchain CI, Dependency
   Audit đều success của đúng commit main/push. Không dùng CI của commit khác,
   PR hay rerun chưa kết thúc. Kiểm main HEAD trước khi publish và trước SSH;
   candidate đã cũ được bỏ qua. GitHub concurrency không hủy deploy đang chạy.
4. Build API/Worker và Web trên runner, publish GHCR bằng GITHUB_TOKEN, tag SHA
   và deploy digest. Worker dùng cùng image API. Bundle chứa source từ Git,
   chaincode đã biên dịch, manifest SHA/hash/migrations/origin và không secrets.
5. Environment `uat` chỉ chấp nhận main. Secrets chỉ là khóa SSH CD riêng;
   host/user/origin/known_hosts là variables. Chỉ job deploy nhận khóa.
   Registry token truyền qua SSH vào memory/temp Docker config rồi xóa.
6. User SSH CD riêng, key forced-command/restrict; controller root-owned và
   chỉ chấp nhận deploy/upgrade/rollback/recover/status/backup đã kiểm tham số.
   Không đưa khóa SSH cá nhân hiện có lên GitHub; không tắt hay đổi khóa người dùng.
7. Controller có flock trên VPS, immutable release directory, journal bền vững
   và state current/previous. Config/accounts giữ ngoài release code, private.
   Compose project và named volumes giữ tên; không gọi network down, down -v,
   seed, bootstrap hay restore vào DB hiện có trong đường deploy.

## Trình tự release

1. Nhận bundle có giới hạn kích thước; kiểm SHA-256, đường dẫn tar, chỉ regular
   files/directories, danh sách file/hash, SHA 40 ký tự, digest GHCR và origin.
2. Resolve Compose model trong memory; kiểm port/mount/UID/secret boundary,
   project name, DB/Caddy image không thay so với baseline. Pull image trước
   khi dừng app; kiểm image revision/source/origin label và immutable digest.
3. Kiểm migration catalog và checksum của DB. Không sửa/xóa migration đã áp
   dụng. Auto-CD chỉ cho SQL mở rộng có kiểm tra: bảng mới, index thường và
   column nullable. Migration khác bị chặn trước stop/backup để review riêng.
4. Kiểm worker/outbox/direct ledger trước release; dừng API và drain/stop worker.
   Chụp PG custom dump khi writers dừng, dừng 6 dịch vụ Fabric persistent để
   chụp ledger volumes và identities/config. Không restart chaincode container
   bằng tên cũ: peer quản lý và tạo lại khi cần. Resume Fabric trong finally.
5. Mã hóa snapshot bằng public recipient certificate/OpenSSL CMS AES-256-GCM.
   Private decrypt key nằm ngoài repo và ngoài VPS. Lưu checksum/evidence;
   job Actions lấy bản mã hóa qua forced-command và upload artifact 30 ngày.
6. Apply migration bằng candidate image, lần lượt API → Worker → Web/proxy;
   đợi health có timeout. Không rebuild trên VPS, không dùng tag latest.
7. Smoke: 5 role login/me/logout, HTTP routing, Swagger private, QR đã có,
   worker ready/dead-letter, so sánh event/proof cũ và direct query Fabric.
   Một ProductionCycle canary dùng Idempotency-Key cố định theo release SHA;
   đợi proof thực sự CONFIRMED/hash khớp, giữ sự kiện làm evidence release.
8. Thành công mới cập nhật symlink current/state previous và evidence. Fail
   sẽ khởi động release cũ, giữ schema mở rộng và dữ liệu/outbox đã ghi. Không
   tự restore database hay ledger. Nếu rollback không healthy, ghi failed và
   journal để recover; không báo thành công khi trạng thái còn không rõ.

## Chaincode và rollback

- Routine deploy so fingerprint chaincode với active state; thay đổi chaincode
  cần dispatch upgrade. Không tự tạo mạng/channel/identity hay reset ledger.
- Upgrade yêu cầu sequence hiện tại khớp expected sequence. Dùng package đã
  build trong CI, install cùng package trên 2 peer, approve 2 org, check readiness,
  commit sequence+1 và query lại cả 2 peer. Giữ package/definition cũ để phục hồi.
- Rollback code chaincode bằng definition mới ở sequence cao hơn, không giảm
  sequence hay restore ledger. Nếu submit commit có kết quả chưa rõ, query
  committed để reconcile trước quyết định. Dừng writers khi reconcile thất bại.
- Rollback app chỉ tới release đã deploy/verify và schema tương thích. Migration
  mới sau release cũ phải qua cùng guard mở rộng. Mỗi rollback có snapshot mới.
- Recover xử lý journal của deploy bị ngắt, dùng previous verified release và
  trạng thái committed thực tế. Không suy đoán thành công từ lệnh timeout.

Fabric giữ state qua nâng definition và sequence phải tăng theo
[tài liệu lifecycle](https://hyperledger-fabric.readthedocs.io/en/release-2.5/chaincode_lifecycle.html).
Environment/secrets giới hạn main theo
[tài liệu GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
GHCR publish/pull dùng token job và package liên kết repo theo
[tài liệu registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Review kế hoạch và xử lý rủi ro

| Vấn đề | Kiểm soát bắt buộc |
| --- | --- |
| CI success sai commit/PR | API gate kiểm SHA/branch/event/workflow path/latest attempt |
| Hai release ghi đè nhau/candidate cũ | GitHub concurrency + flock + latest main SHA trước SSH |
| Push secrets/đổi file riêng | Allowlist commit, scan candidate, backup working tree |
| Mất PG/ledger khi rollout | Named volumes/project cố định; không down/reset; backup coherent |
| DB rollback lệch ledger | Chỉ rollback image/definition; không auto restore data |
| Migration phá code cũ | Guard fail-closed cho SQL mới, checksum lịch sử, verify rollback |
| Chaincode mismatch/commit chưa rõ | Expected sequence, cả 2 org/peer, reconcile query committed |
| Image đổi dù tag giống | Digest + revision/source/origin labels |
| Web gọi sai API | Origin build-time phải khớp stable VPS config |
| Mất private signer sau đổi release | Giữ absolute runtime paths/owner và mounts readonly |
| Mất SSH do key setup | Dedicated key; kiểm session mới; giữ user SSH hiện có |
| Tar traversal/symlink/bomb | Giới hạn bytes, path allowlist, hash, không symlink/hardlink |
| API healthy nhưng worker/Fabric hỏng | Direct ledger + worker ready + real canary proof |
| Job bị hủy/SSH mất | Journal/controller state, bounded timeout, recover không xóa dữ liệu |
| VPS mất cả backup | Artifact mã hóa ngoài VPS; decrypt key bàn giao ngoài repo |
| Gián đoạn UAT khi bảo trì | Single-VPS có downtime ngắn; status/evidence ghi từng phase |

Review: các điểm trên có phương án triển khai cụ thể; không còn blocker thiết
kế. Quyền GitHub admin/push, key SSH và dữ liệu baseline đã xác nhận. Chỉ đánh
dấu hoàn thành sau tests controller/gate, deployment/rollback/chaincode thật,
artifact backup giải mã kiểm checksum và CI/CD GitHub đúng SHA đạt.

## Kiểm chứng và bàn giao

1. Unit tests cho archive/migration/command guards, state/failure recovery,
   wrong-SHA/missing/failed/pending CI và latest-main selection.
2. Rehearsal controller trên VPS: preflight/adopt, khóa SSH restricted và
   negative commands, giữ account/image/volume hiện tại; encrypt/decrypt backup.
3. Local focused CI checks và candidate secret scan rồi scoped commit/push main.
4. Theo dõi 3 CI và CD run thật; fix failure và chạy lại đúng SHA tới khi đạt.
5. Diễn tập rollback/redeploy qua dispatch và nâng chaincode cùng mã đã kiểm
   bằng expected sequence. Sau mỗi bước kiểm data/proof/QR cũ và backlog.
6. Báo cáo URLs Actions/SHA/digests/backup/restore/recovery và runbook. Không
   tự đóng AGT Issue hay ghi nhận nghiệm thu nghiệp vụ thay reviewer/Phát.
