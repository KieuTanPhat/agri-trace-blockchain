# Rà soát code và UAT nongtrace.site — 09/10/2026

## Phạm vi và baseline

Phát yêu cầu kiểm tra lại lỗi, cấu trúc code, lập kế hoạch và thực hiện sửa.
Baseline code: `5880ef11f2d55886791fefd26e5981074900b83b`.
Baseline UAT: `de3a997c875e6acb6b0c3fd1fbd4f7f483f2ba9c`, HTTPS,
43 trace events/proofs; recoveryRequired=false.

Kết quả cuối: PR #66/#67 đã merge vào main, UAT chạy source `086ada4`;
lượt CI đầy đủ sau sửa/deploy và kiểm tra UAT trực tiếp đều đạt.
45 events/proofs, 6 QR VERIFIED, recoveryRequired=false. Không phát hiện
lỗi mới trong các kịch bản của lượt kiểm tra cuối; phần policy/backlog ở cuối.

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
- Browser trên release cuối: Farm có hai link simulator ở dashboard cùng
  link sidebar; Admin có 0 link simulator, URL trực tiếp bị chặn trước form.
  Event labels đã dịch; URL QR sai bị chặn, Enter với QR cũ theo IP mở trang
  HTTPS đúng lô với 8 events đã xác minh. Console không có error/warn.
  QR ở 320 và 390 px không tràn ngang, tên sản phẩm đầy đủ; viewport đã reset.

Sau yêu cầu kiểm tra thêm một lần của Phát, đã dispatch cả ba workflow trên
source cuối ở chế độ full check (`workflow_dispatch` bật toàn bộ classifier).
Lượt mới sau sửa và deploy đã đạt cả ba workflow:

| Kiểm tra lại đầy đủ trên `086ada4` | Kết quả |
| --- | --- |
| [Application 37880411661](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37880411661) | API/Web Node 22/24/26, production containers, HTTP proxy và backup/restore đạt; không skip API hoặc containers |
| [Blockchain 37880413930](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37880413930) | Gateway/chaincode Node 22/24/26, standalone chaincode và API/Worker/Fabric integration đạt; không skip integration |
| [Dependency Audit 37880415892](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37880415892) | Workspace và standalone lockfile audit đạt |

API của lượt kiểm tra mới có 86 unit + 57 PostgreSQL e2e tests và 3 bootstrap
tests đạt; Web có 97 unit + 82 lint contract + 4 image checks đạt. Các workflow
đã chạy lại sau khi sửa xong; kết quả không tái sử dụng lượt kiểm tra baseline.
Không phát hiện lỗi mới trong những kịch bản của lượt cuối. Phần báo cáo chỉ
thay docs; runtime vẫn là release `086ada4` đã kiểm chứng.

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
