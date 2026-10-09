# Rà soát code và UAT nongtrace.site — 09/10/2026

## Phạm vi và baseline

Phát yêu cầu kiểm tra lại lỗi, cấu trúc code, lập kế hoạch và thực hiện sửa.
Baseline code: `5880ef11f2d55886791fefd26e5981074900b83b`.
Baseline UAT: `de3a997c875e6acb6b0c3fd1fbd4f7f483f2ba9c`, HTTPS,
43 trace events/proofs; recoveryRequired=false.

PR #66/#67/#69 đã merge vào main, UAT chạy source `1d903d0`;
lượt workspace và CI đầy đủ sau sửa/deploy đạt. Kiểm chứng runtime đạt
46 events/proofs, 6 QR VERIFIED, recoveryRequired=false; giữ đủ 45 dấu vết
của release trước. Bộ public checks độc lập cuối từ Windows đạt cả 17 checks;
các lần timeout trước đó vẫn được ghi trong đối chiếu bên dưới. Không phát hiện
lỗi chức năng mới trong lượt kiểm tra cuối. Phần policy/backlog ở cuối không
được coi là đã giao.

## Kế hoạch thực hiện

Các lỗi trong kế hoạch mô tả baseline trước khi sửa; trạng thái sau sửa
được ghi trong phần Kết quả.

1. **P1 — Quyền ghi nghiệp vụ:** AGT-007 (#19) quy định Admin không ghi
   thay actor; AGT-026 (#38) quy định Auditor chỉ đọc. Hiện controller/service
   cycle, harvest, shipment, compliance và user IoT vẫn có quyền trái quy tắc.
   Dùng chung policy role ở controller/service; kiểm đúng role + tổ chức,
   đồng bộ allowedCommands và Web. Giữ Admin quản trị identity/masterdata.
   Inspection/review certificate chưa có actor được duyệt: chặn ghi cho tới
   khi policy AGT-026 được chốt; không tự cấp role mới.
2. **P2 — Projection chứng chỉ:** public trace mới lấy chứng chỉ của Lot,
   bỏ sót chứng chỉ approved+public của cycle chung. Thêm projection allowlist
   cho cả hai subject, không lộ documentRef/reviewNote hoặc chứng chỉ draft.
3. **P2 — Phiên Web:** refresh ghi user mới vào localStorage nhưng không
   báo AuthProvider ở cùng tab; request/header/page chỉ so user ID nên có thể
   giữ dữ liệu cũ khi role/org đổi mà ID không đổi. Đồng bộ context sau rotation,
   loại response cũ theo authorization scope và remount/xóa dữ liệu theo scope.
4. **P2 — Nhập QR:** URL đang được nhận bằng substring `/trace/`, có thể điều
   hướng sai route; lời hướng dẫn nhận mã lô không khớp API token. Chuẩn hóa
   parser token/URL, giới hạn route `/trace/<token>`, sửa hướng dẫn và kiểm edge cases.
5. **Cấu trúc:** tách LotsService đang gộp harvest command, database query,
   presenter, action policy và proof status. Các boundary dùng type rõ ràng,
   giữ transaction/outbox của harvest và projection HTTP hiện có.
   Proof projection phải giữ `BLOCKCHAIN_UNAVAILABLE` khi outbox DEAD_LETTER,
   kể cả có receipt cũ, không cho event mới VERIFIED che lỗi delivery.
6. **Kiểm chứng:** full workspace lint/typecheck/test/build; PostgreSQL e2e
   trên database riêng trong CI; production containers; dependency audit;
   Fabric integration; test role/service âm và projection contract. Sau merge,
   dùng CD có backup/gate để deploy UAT, kiểm HTTPS/login/QR/ledger và quyền ghi.
7. **Bổ sung sau kiểm tra trình duyệt:** hai link simulator trên dashboard
   chưa theo quyền của route; tên event API mới chưa có nhãn tiếng Việt.
   Cache IoT giả lập dùng chung giữa các tài khoản. Đồng bộ link theo policy,
   bổ sung nhãn event hiện có và tách cache theo authorization scope.

Issue là acceptance và ownership: #19, #38, #39, #43. Việc sửa và CI đạt
không tự đóng issue hoặc thay xác nhận nghiệm thu. Các feature backlog
markForSale/markSold/OpenAPI đầy đủ được báo riêng theo #36/#22.

## Kết quả

### Code và kiểm tra

- [PR #66](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/66)
  đã merge thành `211c2c75cce668c997e735ab85f770b30d9bb561`.
  Không thêm migration hoặc thay chaincode; giữ ownership của các issue.
- Admin/Auditor bị chặn ở HTTP trước validation/idempotency và ở service
  trước truy vấn ghi. Farm/Transporter/Retailer cần đúng role và tổ chức.
  Admin vẫn quản trị identity/masterdata; Auditor vẫn đọc được dữ liệu.
- Farm nộp certificate của tổ chức mình với trạng thái PENDING.
  `POST /inspections` và `PATCH /certificates/:id/review` trả 403 cho cả
  năm role, có mô tả trong Swagger. AGT-026 chưa quyết định writer/reviewer.
  Certificate approved+public hiện có vẫn được chiếu ra public trace.
- Public trace bổ sung chứng chỉ cycle, chỉ chiếu sáu trường công khai;
  không lộ documentRef/reviewNote hoặc chứng chỉ private/pending.
  DEAD_LETTER tiếp tục báo lỗi khi đã có receipt; delivery hoàn tất mới
  cho phép lịch sử đã confirmed trở thành VERIFIED.
- Web khóa response và dữ liệu đã tải theo user ID + role + organization,
  thông báo AuthProvider khi refresh và remount trang khi scope thay đổi.
  Hai regression tests late 200/401 đã chạy thất bại trước sửa và đạt sau sửa.
- QR parser nhận token hoặc URL HTTP(S) đúng route; điều hướng nội bộ,
  chặn credential URL, encoded slash, token quá dài và đường dẫn sai.
- LotsService 542 dòng được thay bằng LotHarvestService (137 dòng),
  LotQueryService (106), presenter thuần (201), query types (90),
  action policy (54) và proof status (44). Không đổi layout module/FSD
  toàn repo. Query không ghi, presenter không inject PrismaService,
  harvest vẫn dùng Serializable transaction + trace/outbox; có test boundary.

| Kiểm tra | Kết quả |
| --- | --- |
| Local API, Node 22.22.3/npm 12.1.0 | lint/typecheck/build; 86 unit + 20 HTTP tests đạt. 37 DB tests skip vì không có TEST_DATABASE_URL |
| Local Web ở PR #66 | lint/typecheck/build; 63 unit, 82 lint contract, 4 image optimizer checks đạt |
| Local Web cuối ở PR #67 | lint/typecheck/build; 97 unit, 82 lint contract, 4 image optimizer checks đạt |
| PostgreSQL thật trên CI Node 22/24/26 | 86 API unit + 57 e2e tests đạt, gồm 23 business workflows; 3 bootstrap tests đạt |
| Web CI Node 22/24/26 | lint/typecheck/tests/production build đạt |
| PR Application CI | [37875187455](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37875187455): container production, HTTP proxy và backup/restore DB riêng đạt |
| PR Blockchain CI | [37875187386](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37875187386): API/Worker/Fabric integration đạt |
| PR Dependency Audit | [37875187390](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37875187390): đạt |
| Push Application CI của 211c2c7 | [37875699687](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37875699687): đạt |
| Push Blockchain CI của 211c2c7 | [37875699613](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37875699613): đạt |
| Push Dependency Audit của 211c2c7 | [37875699641](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37875699641): đạt |

Hai lượt CI đầu phát hiện fixture proof cũ kỳ vọng VERIFIED khi outbox còn
DEAD_LETTER và fixture COMPLETED thiếu completedAt. Đã sửa fixture/expectation
theo ràng buộc PostgreSQL và thêm assertion trước/sau delivery; không nới
ràng buộc DB hoặc bỏ test. Lượt CI cuối trên head
`e0556d57dff844a2ee45ba17891d16f7cc839415` đạt toàn bộ gate. Các job
standalone/workspace blockchain không đổi được classifier skip đúng quy định;
Fabric integration vẫn chạy thật.

### UAT

Source `211c2c75cce668c997e735ab85f770b30d9bb561` đã deploy và kiểm chứng
qua [CD 37875699471](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37875699471).
Baseline trước deploy đã kiểm lại: 43 events/proofs, 22 entity histories,
6 QR VERIFIED, 5 role login/refresh/logout, PWA assets và CORS đạt;
không có recovery journal.

- Sau rollout: giữ đủ 43 event/proof fingerprints cũ, thêm một canary,
  tổng 44 events/outbox/proofs đều CONFIRMED/COMPLETED; 6 QR VERIFIED.
- Probe trực tiếp: 42 Admin/Auditor business-write requests và 10 compliance
  requests của cả 5 roles trả 403; 17 bảng nghiệp vụ giữ nguyên count và
  row fingerprint trước/sau; allowedCommands=[] cho Admin/Auditor; đọc vẫn đạt.
- 16 checks bên ngoài, QR legacy IP và TLS hợp lệ cho apex/www đều đạt;
  certs vẫn có hạn tới 06/01/2027. HTTPS, refresh/logout, CORS, PWA assets đạt.
- Encrypted artifact đã tải về máy Phát, CMS decrypt và 5 component checksums
  đạt; baseline backup có 43 events. Không restore/rewind dữ liệu UAT đang chạy.

Kiểm tra browser sau rollout phát hiện thêm link simulator và nhãn event ở
dashboard. [PR #67](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/67)
sửa cả hai và cache IoT: namespace v3 theo user/role/org, không gán dữ liệu
v2 không có owner cho user mới; panel loại dữ liệu cũ khi scope đổi; cache
đầy không làm lần ghi API đã accepted trở thành lỗi. Giữ alias event mock cũ,
dịch 23 event hiện có của API. Bộ Web mở rộng lên 97 unit tests đạt local;
đã merge thành `086ada424160908fa041bca0dc0a5ca9ffc8f993`.
Regression chạy trên source trước sửa: 28 thất bại/6 đạt; cùng 34 cases trên
source sau sửa đều đạt. Toàn bộ 97 Web tests đạt sau khi khôi phục đúng source.

PR #67 đạt cả ba workflow trên head
`d58d9d2d01fb2af85a41a50df0eabc7c78091fa9`:

- [Application CI 37877401692](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37877401692):
  Web Node 22/24/26, production containers, UAT HTTP proxy và backup/restore đạt.
- [Blockchain CI 37877401710](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37877401710):
  classifier/policy đạt; integration không đổi được skip đúng scope Web.
- [Dependency Audit 37877401647](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37877401647): đạt.

Push CI trên source `086ada4` cũng đạt:
[Application 37877825253](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37877825253),
[Blockchain 37877825271](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37877825271),
[Dependency Audit 37877825313](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37877825313).

Source `086ada424160908fa041bca0dc0a5ca9ffc8f993` đã deploy qua
[CD 37877825220](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37877825220),
đạt cả gate, publish và delivery/verification.

- Lượt probe mới sau deploy tiếp tục đạt 52 lần từ chối ghi, 5 roles,
  17 bảng nghiệp vụ giữ nguyên count và row fingerprint; quyền đọc còn hoạt động.
  Giữ đủ 44 fingerprints của release trước, tổng 45 events/outbox/proofs.
- 16 public checks, QR legacy IP và TLS được tin cậy cho cả hai host đạt lại.
  API/Web/Worker/PostgreSQL healthy, proxy chạy; cả 5 services không restart,
  6 Fabric containers chạy, cổng 443 được publish và volume certs còn bền vững.
- Backup của CD cuối đã tải khỏi VPS, CMS decrypt và 5 checksums đạt.
  Snapshot baseline có 44 events; artifact digest
  `sha256:10819ac31c8a8934cb22430441da3c413a8bd85d471bc0dd689a2823d3e9d282`.
- Một lượt verifier độc lập sau probe đạt 45 truy vấn ledger trực tiếp,
  24 entity histories, 6 QR VERIFIED và 5 role login/refresh/logout;
  CORS/PWA đạt, giữ đủ baseline 43 events của đợt HTTPS trước đó.
  Helper khớp immutable release manifest; chaincode sequence 2/version
  `cd-dbeb65b83023` và fingerprint giữ nguyên; recoveryRequired=false.
- Browser trên release `086ada4`: Farm có hai link simulator ở dashboard cùng
  link sidebar; Admin có 0 link simulator, URL trực tiếp bị chặn trước form.
  Event labels đã dịch; URL QR sai bị chặn, Enter với QR cũ theo IP mở trang
  HTTPS đúng lô với 8 events đã xác minh. Console không có error/warn.
  QR ở 320 và 390 px không tràn ngang, tên sản phẩm đầy đủ; viewport đã reset.

Sau yêu cầu kiểm tra thêm một lần của Phát, đã dispatch cả ba workflow trên
source `086ada4` ở chế độ full check (`workflow_dispatch` bật toàn bộ classifier).
Lượt mới sau sửa và deploy đã đạt cả ba workflow:

| Kiểm tra lại đầy đủ trên `086ada4` | Kết quả |
| --- | --- |
| [Application 37880411661](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37880411661) | API/Web Node 22/24/26, production containers, HTTP proxy và backup/restore đạt; không skip API hoặc containers |
| [Blockchain 37880413930](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37880413930) | Gateway/chaincode Node 22/24/26, standalone chaincode và API/Worker/Fabric integration đạt; không skip integration |
| [Dependency Audit 37880415892](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37880415892) | Workspace và standalone lockfile audit đạt |

API của lượt kiểm tra mới có 86 unit + 57 PostgreSQL e2e tests và 3 bootstrap
tests đạt; Web có 97 unit + 82 lint contract + 4 image checks đạt. Các workflow
đã chạy lại sau khi sửa xong; kết quả không tái sử dụng lượt kiểm tra baseline.
Lượt CI trên `086ada4` đạt; lượt workspace local tiếp sau phát hiện timeout
của test dependency graph, được xử lý trong phần dưới.

### Kiểm tra workspace bổ sung và sửa độ ổn định của test

Lượt `npm run check` toàn workspace trên Windows thất bại tại lint contract:
`npm ls --all --json` bị ETIMEDOUT đúng deadline 30 giây. Đây là lỗi thời gian
chờ của kiểm tra local; không có kết quả cho thấy graph sai. Đo độc lập cùng
Node 22.22.3/npm 12.1.0: command exit 0 sau 21,45 giây, JSON không có problems.

[PR #69](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/69) tăng riêng
deadline đọc toàn graph lên 120 giây hữu hạn. Giữ nguyên npm của caller,
maxBuffer, assertion lỗi process, exit code 0, JSON parse và problems=[];
không retry hoặc bỏ kiểm peer dependencies. Không thay runtime code,
dependencies, schema hoặc chaincode. PR đã merge thành
`1d903d04b044424b656307aeb1a5a218f9b78ef5`.

Sau sửa đã chạy lại toàn bộ `npm run check` từ đầu, exit code 0:

- API: lint/typecheck/build, 86 unit + 20 HTTP đạt; 37 DB tests skip local.
- Web: typecheck/build/lint, 97 unit + 82 lint contract + 4 image checks đạt.
- Chaincode: typecheck/build/runtime load, 34 tests và coverage đạt.
- Gateway: typecheck/build/runtime load, 3 tests đạt.

PR #69 đạt [Application 37882099373](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882099373),
[Blockchain 37882099343](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882099343),
[Dependency Audit 37882099319](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882099319):
Web Node 22/24/26, production containers, UAT proxy/backup-restore và dependency
graph đạt; API/Fabric không đổi được skip trong PR.

Sau merge và sửa xong, chạy thêm cả ba workflow full check trên `1d903d0`:

| Kiểm tra cuối sau PR #69 | Kết quả |
| --- | --- |
| [Application 37882521076](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882521076) | API/Web Node 22/24/26, PostgreSQL e2e/bootstrap, production containers và backup/restore đạt |
| [Blockchain 37882523047](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882523047) | Gateway/chaincode Node 22/24/26, standalone và API/Worker/Fabric integration đạt |
| [Dependency Audit 37882524864](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882524864) | Workspace/standalone audit và dependency graph đạt |

Không skip API, Web, containers hoặc Fabric trong lượt full check cuối.
Push CI trên cùng SHA cũng đạt:
[Application 37882501846](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882501846),
[Blockchain 37882501793](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882501793),
[Dependency Audit 37882501847](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882501847).

### Kiểm chứng release cuối `1d903d0`

[CD 37882501886](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882501886)
đạt cả gate, publish và delivery/verification. Source runtime là
`1d903d04b044424b656307aeb1a5a218f9b78ef5`, UAT origin `https://nongtrace.site`.

- Probe mới sau deploy: 42 Admin/Auditor business-write và 10 compliance
  requests bị từ chối 403; cả 17 bảng nghiệp vụ giữ nguyên count và row
  fingerprint trước/sau. Năm role đăng nhập được, quyền đọc còn hoạt động;
  Admin/Auditor có allowedCommands=[]. Giữ đủ 45 event fingerprints trước
  rollout; 46 events/outbox/proofs đã xác minh.
- Verifier độc lập sau probe: 46 truy vấn ledger trực tiếp, 25 entity histories,
  6 QR VERIFIED, 5 role login/refresh/logout; CORS và PWA assets đạt. Giữ đủ
  baseline 41 và 43 events của các đợt trước. Helper khớp immutable manifest,
  không có recovery journal; recoveryRequired=false.
- API/Web/Worker/PostgreSQL healthy, proxy chạy; cả 5 services có 0 restarts,
  6 Fabric containers chạy, cổng 443 được publish và cert volume bền vững.
  Chaincode sequence 2/version `cd-dbeb65b83023` và fingerprint giữ nguyên.
- Backup CD cuối đã tải khỏi VPS, CMS decrypt và 5 component checksums đạt.
  Snapshot baseline có 45 events; artifact digest
  `sha256:93eab0deeab9729af6164111edcb7fe5b77c429c52771bbd6f76d887075add44`.
  Không restore/rewind UAT đang chạy.

| Image đã triển khai | Digest |
| --- | --- |
| API/Worker | `sha256:396b32a8b4023df0a081e8dbedc3e579b4c086ee75a5a3d37e7b71d33cf17c00` |
| Web | `sha256:767fc14c2421eb7657dcfa7c70d619b8900391fba60d3efa62338aaf0bff5a42` |

Đối chiếu HTTPS bên ngoài sau release cuối:

- DNS công khai: apex A `13.140.170.166`, www CNAME `nongtrace.site`, không có
  AAAA. Cổng 443 nhận kết nối; kiểm TLS nghiêm ngặt cho cả hai host đạt,
  TLS 1.3 và chứng chỉ được tin cậy đến 06/01/2027. Không bỏ xác minh TLS.
- Helper public-check từ Windows có lần timeout ở deadline 10/15/30 giây.
  Đã sửa cách dùng helper: đọc hết response body, dùng chung connection pool,
  connect/request deadline hữu hạn 30 giây; giữ nguyên assertion status,
  redirect và proof. Đây là thay đổi công cụ kiểm chứng riêng, không phải
  bằng chứng đã sửa được nguyên nhân kết nối chậm.
- Curl độc lập từ Windows trả `/login` HTTP 200 cho cả hai host; `/api/health`
  HTTP 200 sau 2,37 giây. `/sw.js` trả HTTP 200, 959 bytes sau 18,49 giây,
  trong khi cùng route từ VPS mất 0,52 giây. Trang SSR QR từ VPS trả HTTP 200
  sau 0,91 giây. DNS lookup Node tại Windows 2–11 ms; firewall cho phép 443,
  máy chủ không có container restart. Chưa xác định được nguyên nhân của
  biến động đường kết nối Windows; không coi các lượt timeout là pass.
- Một bộ kiểm tra độc lập bằng Windows curl sau đó đạt cả 17 checks, đọc
  đầy đủ response body, xác minh TLS mặc định của nền tảng; mỗi request có
  deadline 30 giây và không retry. Hai host đều đạt login, health, docs 404,
  PWA assets, SSR QR, HTTP 308 đến HTTPS cùng host và public API QR với toàn
  timeline VERIFIED; QR legacy IP trả 200. Thời gian của lượt này 0,59–1,75
  giây/request. Kết quả xác nhận khả năng truy cập hiện tại, không chứng minh
  nguyên nhân các lần kết nối chậm trước đó đã được loại bỏ.
- Browser mới trên release `1d903d0` tải login, vào trang scan, Enter với QR
  legacy IP mở đúng URL HTTPS; trang hiện đủ 8 events đã xác minh và
  “Đã khớp bằng chứng”, nhãn event tiếng Việt. Console không có error/warn.
  Tab cũ bị timeout đọc UI/chụp ảnh; tab mới hoạt động và đã lưu ảnh kiểm chứng.

### Phần còn lại thuộc acceptance/policy

- AGT-026 (#38): Phát cần chốt vai trò ghi inspection/duyệt chứng chỉ trước
  khi mở hai endpoint; hiện chặn ghi và giữ đường đọc.
- AGT-024 (#36): markForSale/markSold và quantity policy còn trong scope feature,
  chưa được triển khai qua đợt audit này.
- AGT-010 (#22): đầy đủ OpenAPI contract cho toàn bộ feature vẫn là backlog;
  Swagger tiếp tục sinh từ NestJS, đã mô tả endpoint compliance bị chặn.
- Không tự đóng issue hoặc coi CI pass là nghiệm thu của owner/reviewer.
  Các kết luận giới hạn trong source, workflow và scenario đã kiểm tra;
  không khẳng định hệ thống không thể có lỗi khác.
- Camera trên thiết bị thật và cài PWA trên điện thoại chưa được thử trong
  đợt audit này. Backup/restore DB đã chạy trên môi trường CI riêng; checksum
  snapshot ngoài VPS được kiểm tra, nhưng không diễn tập restore vật lý
  toàn mạng Fabric trong đợt code audit.
