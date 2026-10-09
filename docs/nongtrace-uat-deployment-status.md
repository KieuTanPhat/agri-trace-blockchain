# Kết quả triển khai HTTPS UAT nongtrace.site — 09/10/2026

UAT đã triển khai và kiểm chứng tại [https://nongtrace.site](https://nongtrace.site).
Runtime cuối: `de3a997c875e6acb6b0c3fd1fbd4f7f483f2ba9c`.
Deploy, rollback, redeploy, TLS hai host, đăng nhập, QR/ledger và backup restore
đều đạt. Bản báo cáo chỉ thay docs; source SHA runtime giữ theo release này.

## Phạm vi và approval

Phát đã yêu cầu kiểm tra sâu CI/CD, sửa lỗi, merge PR #63, triển khai HTTPS UAT
và kiểm các chức năng chính trong phiên 08–09/10/2026. Yêu cầu này cung cấp
release approval riêng của [AGT-031](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/43).
Kế hoạch/review: [nongtrace-uat-release-plan.md](nongtrace-uat-release-plan.md).
Vận hành: [contabo-cd-runbook.md](contabo-cd-runbook.md).

## Lỗi phát hiện và xử lý

- Readiness HTTPS mới kiểm apex: thêm kiểm TLS hợp lệ và HTTP 200 cho cả apex
  và `www`, ghi đúng phase `public-https-readiness` trước promote.
- Installer update-origin/helper thiếu delivery lock: dùng chung Linux flock,
  từ chối update khi có delivery hoặc recovery journal; backup cấu hình private.
- Verifier thiếu checks CORS/session/PWA: thêm allowed/rejected origins,
  refresh/logout và manifest/service worker; giữ truy vấn ledger và QR đầy đủ.
- Header trang QR cắt tên sản phẩm ở 320 px: ảnh 125 px trong flex row khiến
  cột chữ còn 95 px nhưng cần 135 px. Xếp ảnh/nội dung dọc ở breakpoint phone,
  wrap tên và mã dài, thêm ba stylesheet regression tests.

Các thay đổi qua PR [#63](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/63)
và [#64](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/64).
Không thêm migration hoặc sửa chaincode trong đợt HTTPS này.

29 Python tests và 10 Node gate/SSH tests đạt trên Linux, gồm readiness
apex/www, installer lock, rollback origin/CORS và recovery. Web: 30 tests,
82 lint contract checks, bốn image optimizer checks, typecheck, lint và build
đạt local với Node 22.22.3/npm 12.1.0; CI web đạt Node 22.22.3/24.15.0/26.0.0.
Lượt đầu của regression test mới bị Vite biến URL CSS thành asset URL;
đã sửa cách đọc filesystem, chạy lại đạt trước merge #64. Lượt local đầu dùng
Node/npm ngoài engines gặp dependency graph lỗi; cài lại bằng runtime pin đạt.

## DNS, mạng và TLS

- Authoritative TenTen và resolver 1.1.1.1/8.8.8.8 trả A `13.140.170.166`
  cho apex; `www` CNAME `nongtrace.site`, cùng IP. Không có apex AAAA.
- TCP 443 đã mở trên UFW IPv4/IPv6; kiểm kết nối từ máy Phát trước cutover
  bằng listener tạm, sau đó dừng listener trước Caddy rollout. TCP 80 giữ mở.
- Caddy cấp TLS cho hai host, kiểm từ bên ngoài bằng xác thực chứng chỉ bình
  thường. Caddy `/data` và `/config` dùng Docker volumes để giữ chứng chỉ.
- Apex: SAN `DNS:nongtrace.site`, issuer `YE2`, TLSv1.3;
  hạn `2026-10-08 16:08:35 UTC` → `2027-01-06 16:08:34 UTC`.
- www: SAN `DNS:www.nongtrace.site`, issuer `YE2`, TLSv1.3;
  hạn `2026-10-08 16:08:55 UTC` → `2027-01-06 16:08:54 UTC`.

GitHub repository và environment `uat` cùng có `UAT_PUBLIC_ORIGIN=https://nongtrace.site`.
CORS cho apex, www và IP legacy. Signing MSP chỉ mount read-only cho Worker;
API/Web không nhận signer secrets. SSH CD dùng forced command, token GHCR
truyền ephemeral, backup recovery private key ở máy Phát. Env/secret matrix
và quy trình giữ secrets nằm trong các runbooks; không commit giá trị secret.

| Cấu hình / secret | Bên dùng | Nơi giữ / boundary |
| --- | --- | --- |
| `UAT_PUBLIC_ORIGIN` / `PUBLIC_ORIGIN` | CD, Web build, API trace URL | GitHub repo + uat variables, release origin overlay |
| `CORS_ORIGINS` → API `CORS_ORIGIN` | API | Shared env private + overlay theo release; apex/www/legacy IP |
| `POSTGRES_*` / `DATABASE_URL` | PostgreSQL, migrate, bootstrap, API, Worker | Shared env private; DB không publish host port |
| `JWT_SECRET`, `IOT_INGEST_API_KEY` | API | Shared env private; không đặt trong Web build args |
| UAT account credentials | Bootstrap/verifier | Private accounts file; không ghi vào public evidence |
| Relayer MSP và Fabric TLS CA | Worker | Read-only mounts; Worker chạy non-root, API/Web không có signer mount |
| `UAT_SSH_PRIVATE_KEY` | CD delivery job | GitHub uat secret; forced-command SSH trên VPS |
| `UAT_KNOWN_HOSTS` | CD SSH transport | GitHub variable; bật kiểm host key |
| `GITHUB_TOKEN` | GHCR publish/delivery | Job token, header stdin/temp Docker config, dọn sau dùng |
| CMS recipient certificate / recovery key | VPS encrypt / máy Phát decrypt | VPS chỉ giữ public cert; private recovery key ở máy Phát |

## Bằng chứng cutover đầu tiên

Runtime HTTPS đầu tiên `b80354e9bae8ab62250e9279dd4dc7b8aa03bd6a` giữ đủ
41 event/proof fingerprints trước cutover và thêm đúng một canary, tổng 42.
Deploy → rollback về release HTTP `dbeb65b` → redeploy HTTPS giữ đủ 42;
canary không nhân đôi. Năm roles, CORS, refresh/logout, PWA assets, sáu QR
VERIFIED, direct ledger, 21 entity histories và 16 checks bên ngoài đều đạt.

| Kiểm chứng | Run | Kết quả |
| --- | --- | --- |
| Application CI của b80354e | [37812367578](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37812367578) | Success |
| Blockchain CI của b80354e | [37812367504](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37812367504) | Success, API–Worker–Fabric integration |
| Dependency Audit của b80354e | [37812367576](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37812367576) | Success |
| HTTPS cutover | [37812367389](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37812367389) | Success |
| Rollback về HTTP | [37814867925](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37814867925) | Success, 42 events được giữ |
| Redeploy HTTPS | [37815328363](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37815328363) | Success, vẫn 42 events |

Ba encrypted artifacts trên đã tải về máy Phát, CMS decrypt và năm checksums
đạt. Backup rollback có 42 events được restore vào PostgreSQL 18 cô lập,
không publish port, không nối UAT network: tám migrations, mọi counts và 42
event/proof fingerprints khớp. Chạy migration bằng API image candidate trên
bản copy đạt. Container kiểm thử được xóa sau assert ID/label/network/ports.

## Release cuối và kiểm chứng bổ sung

- Source SHA: `de3a997c875e6acb6b0c3fd1fbd4f7f483f2ba9c` (merge #64).
- Current: `/opt/agri-trace/releases/uat-de3a997c875e6acb6b0c3fd1fbd4f7f483f2ba9c`;
  previous đã verified: `uat-b80354e9bae8ab62250e9279dd4dc7b8aa03bd6a`.
- `recoveryRequired=false`, helper cài trên VPS khớp bốn manifest hashes;
  disk trống 75.47 GiB khi kiểm cuối.
- API/Worker: `ghcr.io/kieutanphat/agri-trace-blockchain/api@sha256:1a078a0355fc7380bc0c4fd9da0dd888c37660c28aa25930461dbffe65803935`.
- Web: `ghcr.io/kieutanphat/agri-trace-blockchain/web@sha256:ab07ad628ffde568225036a58ebce996fb02ccbce9b75ff812b3626f4add96e4`.
- Fabric giữ sequence `2`, version `cd-dbeb65b83023`, fingerprint
  `215a3eb4d87f7ead24a6dc7a4e65ad2548020cb9482d6afeda487498be1920d1`.

| Kiểm chứng của source de3a997 | Run | Kết quả |
| --- | --- | --- |
| Application CI | [37817744325](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37817744325) | Success; web ba Node versions, production containers |
| Blockchain CI | [37817744219](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37817744219) | Success; các jobs source không đổi được path gate skip |
| Dependency Audit | [37817744220](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37817744220) | Success |
| Deploy bản sửa mobile | [37817744245](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37817744245) | Success; 42 → 43 events, thêm một canary |
| Rollback về b80354e HTTPS | [37819386234](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37819386234) | Success; đủ 43 events được giữ |
| Redeploy cùng de3a997 | [37871077237](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37871077237) | Success; reuse immutable digests, vẫn 43 events |

Verifier cuối kiểm năm roles và AUDITOR write forbidden; refresh/logout,
allowed/rejected CORS, PWA assets, 43 events/proofs qua Fabric trực tiếp và API,
22 entity heads/histories, sáu public QR/timelines VERIFIED. 41 fingerprints
trước cutover và toàn bộ 43 fingerprints trước redeploy được bảo toàn.
Outbox đều COMPLETED, proofs CONFIRMED, dead-letter 0, Worker enabled/running
và không có lastError. API/Worker/Web/PostgreSQL healthy, proxy running,
sáu dịch vụ Fabric running, restart count các app services 0.

Counts cuối: users5, organizations14, farms4, plots3, products4,
production_cycles7, harvests6, lots6, shipments6, events/outbox/proofs43.
Hai canary theo SHA được giữ qua rollback/redeploy; không nhân đôi khi replay.

16 checks từ máy Phát trên apex/www đạt: login/health/PWA/QR HTTP 200,
Swagger 404, HTTP domain redirect HTTPS, public trace VERIFIED. QR legacy IP
HTTP 200. Browser đăng nhập FARM_STAFF trên bản cuối thành công, dashboard
hiển thị sáu lots/0 proof pending; đã logout sau kiểm thử. Public trace/ảnh/QR
theo URL HTTPS hiển thị đúng, không có console error/warning.

Header trang trace đã đo trên browser với title `UAT: Vegetables`:

| Viewport | Title clientWidth / scrollWidth | Page clientWidth / scrollWidth |
| --- | --- | --- |
| 320 px | 232 / 232 | 305 / 305 |
| 390 px | 302 / 302 | 375 / 375 |
| 1280 px | 687 / 687 | 1265 / 1265 |

Chiều rộng page loại trừ scrollbar 15 px. Không tràn/cắt title hoặc page;
ảnh optimizer tải thành công, không có browser console error/warning.
Viewport override được reset sau kiểm tra.

Artifact rollback cuối `11568048476`, run `37819386234`, digest
`sha256:65da6e692265cbd92d0335ef01e352b63c928d43246ed971296f22daf7954c14`:
năm component checksums đạt; PostgreSQL copy khớp 43 event/proof fingerprints,
tám migrations và toàn bộ counts. Migration bằng API image de3a997 đạt trên
bản copy. Container/network kiểm thử đã dọn. Fabric archives được kiểm checksum;
không đưa ledger/DB UAT về snapshot để diễn tập application rollback.

Artifact redeploy cuối `11590702092`, run `37871077237`, digest
`sha256:7cc6774da6fce3ceebb0d90d9ea79ccfa09b1d219d01afbd5681d2d058042b69`:
đã tải, decrypt và kiểm đủ năm checksums; baseline có đủ 43 events.
Evidence private trên VPS: `/opt/agri-trace/cd/nongtrace-final-evidence.json`,
`nongtrace-before.json`, `nongtrace-before-mobile.json`,
`nongtrace-restore-check.json`, records/state/operations log và backups.

Artifacts CMS, bản decrypt private và bằng chứng local nằm dưới
`C:\Users\kieup\.agri-trace-uat\cd\nongtrace-https` với quyền private.
Recovery key nằm ngoài VPS/repo/GitHub. Actions giữ encrypted artifacts 30 ngày;
bản đã tải local phục vụ phục hồi sau retention đó.

## Giới hạn kiểm chứng

Các checks đã chạy không phát hiện lỗi còn lại trong phạm vi HTTPS/CD.
Camera thật và cài PWA trên điện thoại cần thiết bị thật; mới kiểm secure
origin, assets và browser. Chưa restore vật lý Fabric sang host thứ hai hoặc
diễn tập live crash lúc commit definition; archives/checksums và recovery unit
tests đã kiểm. Một VPS có downtime ngắn khi snapshot/rollout. QR dùng IP cũ
vẫn được kiểm; rollback về release HTTP phải truy cập qua IP.

Không thay kết quả nghiệm thu nghiệp vụ/acceptance của reviewer hoặc tự đóng
AGT Issue. Những khoảng cách nghiệp vụ trong PROJECT_CONTEXT có acceptance riêng.
