# Mô hình truy xuất doanh nghiệp và checklist thực hiện

## Checklist theo NGHIPVUCOBAN.txt — 29/10/2026

Baseline đã nhập: `origin/main@dc21f81`, merge `7cf81b5`; thay đổi tiếp theo
được gom trên nhánh review `fix/enterprise-mobile-integration-review-20261031`. Code trước merge và phần dở dang
được giữ trong lịch sử/stash `safety-before-main-sync-2026-10-28`.
Bản đề xuất từ baseline `9c6d208` ở cuối file chỉ còn là lịch sử.

Quyết định đã chốt: hoãn thanh toán, admin duyệt năng lực rồi kích hoạt dùng tạm;
mật khẩu tạm bắt đổi lần đầu; thu hoạch nhiều đợt và đóng vụ riêng sau đợt cuối.
“Đạt test” dưới đây chỉ đúng phạm vi đã nêu, không phải nghiệm thu production.

| STT | Công việc | Trạng thái và phần còn lại |
| --- | --- | --- |
| 1 | Nhập code main | Xong; không áp lại enum/migration cũ trùng main |
| 2 | Năm loại doanh nghiệp | Có đủ FARM, TRANSPORTER, PROCESSOR, DISTRIBUTOR, RETAILER; AUDITOR độc lập |
| 3 | OTP email, mật khẩu tạm, bắt đổi | Có code và test HTTP/PostgreSQL; chưa kiểm SMTP/email thật |
| 4 | Duyệt/từ chối và bổ sung hồ sơ | Có code và test API; nghiệm thu thao tác Web còn riêng |
| 5 | Duyệt rồi kích hoạt dùng tạm | Đã sửa/test: ENTERPRISE_PAYMENTS_ENABLED=false mặc định; không tạo paid order/invoice/subscription giả |
| 6 | Thành viên, nhóm quyền, C1–C2–C3 | Đạt test API ủy quyền/thu hồi; C3 chỉ thấy và ghi vụ được giao; cần thao tác Web/app thật |
| 7 | Vùng, sản phẩm, giống, vật tư, cơ sở | Có source; catalog riêng/cross-org có test; chưa nghiệm thu toàn bộ biểu mẫu |
| 8 | Vụ, nhân viên, nhật ký, ảnh | Test API phân công C3 và form đạt; người dùng xác nhận camera/ghi nhật ký, thu hoạch mobile ổn; chưa nghiệm thu toàn bộ bài biên/ngoại tuyến |
| 9 | Nhiều đợt thu hoạch, lô/QR, đóng vụ | API thu hoạch–giao–nhận đạt; người dùng xác nhận thu hoạch/quét QR mobile và mở dữ liệu được phép; giao nhận/đóng vụ trên thiết bị còn riêng |
| 10 | Đối tác và chuỗi cung ứng | Có source; kiểm tra liên doanh nghiệp trên UI còn tiếp |
| 11 | Chế biến và nguồn thành phẩm | Đã sửa lỗi SQL context cho nguyên liệu ngoài; 7 test HTTP/DB chế biến đạt, fresh migration và hồi quy đạt; còn nghiệm thu UI |
| 12 | Giao nhận/phân phối và ký hai bên | Đã thêm chi tiết giao nhận mobile, đúng status API, từng lô/đơn vị và chữ ký đúng epoch; ký qua Web, c2/binding và thao tác thiết bị còn nghiệm thu |
| 13 | Admin tổng, ngoại lệ, hỗ trợ, thông báo, kho QR | Có module; chưa nghiệm thu toàn bộ quyền/màn hình |
| 14 | Mobile consumer đăng ký/quên mật khẩu | Đã nối Firebase native/API; 8 test logic đạt, chưa gửi SMS/APK thật |
| 15 | Session và cache mobile | Đã sửa refresh sau logout, phản hồi cũ, đổi trang/phiên và setter cũ; 5 test React đạt, lint/typecheck sạch |
| 16 | Catalog rộng | Đã tạo/test 30 tổ chức, 100 sản phẩm có owner trên DB cách ly; INACTIVE, chưa có bằng chứng/QR giả |
| 17 | 100 sản phẩm có workflow/QR công khai | Đã nạp thêm đúng DB UI local theo yêu cầu: 70 vụ/nhật ký/thu hoạch, 30 mẻ chế biến, 100 lô/QR; đọc kiểm qua API đạt, giữ nguyên dòng dữ liệu gốc; ledger mô phỏng, chưa phải Fabric thật |
| 18 | Code thừa, cache và tài liệu | Đang làm; mobile hết 8 lỗi lint/3 cảnh báo, API fetch no-store; chưa coi là rà sạch toàn repo |
| 19 | Đo/tối ưu database | Đã đo dung lượng/EXPLAIN và tối ưu truy vấn danh bạ; kiểm bộ mẫu 100 sản phẩm/1.000 lô/30 tổ chức bổ sung, còn các workload khác chưa đo |
| 20 | Thanh toán thật/đối soát | Hoãn theo yêu cầu; không tích hợp cổng hoặc bật thu tiền |

### Theo dõi sau lượt test giao diện local

- Người dùng đã xác nhận luồng Web tạo vụ → xuống giống → nhật ký → thu hoạch/
  QR công khai và chặn vượt sản lượng hoạt động. Vụ thực tế dùng Rau Salad,
  giới hạn **84 g**, không phải bộ 100 kg trong phiếu; đây không phải nghiệm thu
  mobile hay các cân bằng giao nhận/chế biến. Chi tiết lời xác nhận được giữ trong
  `docs/testing/manual-web-mobile-results.json`, không tự đánh PASS 41 case gốc.
- Chuỗi local ban đầu thiếu binding; người dùng chạy công cụ mô phỏng và nhận
  `boundChains=1`, `confirmedPermissions=3`. Không phải bằng chứng Fabric thật.
- Tiếp tục mục 18: form tự kiểm journal sau 400/409/422 bằng key/body gốc,
  không gửi lại command trong bước tự kiểm. Chỉ mở khóa khi có từ chối đã xác
  định; các kết quả chưa rõ giữ khóa và đối soát thủ công. Web typecheck/lint,
  335 unit, 164 lint-contract và 4 image-optimizer đạt. Sau chỉnh sửa cuối,
  31 test recovery/dialog liên quan đạt; build Webpack đạt (110 trang static).
  Turbopack bị sandbox chặn bind cổng nội bộ (`Operation not permitted`), chưa
  nghiệm thu lại UI của thay đổi recovery. README/frontend guide đã đồng bộ
  luồng mặc định duyệt năng lực → kích hoạt dùng tạm, không bắt thanh toán.

### Đợt tối ưu database — 30/10/2026

- Đọc thống kê DB UI local: PostgreSQL 17.10, 93 migration, khoảng 18 MB;
  bảng lớn nhất `trace_evidence` khoảng 424 KB. Đây là DB UI hiện tại; baseline
  Compose/CI vẫn PostgreSQL 18. Không xóa ảnh, lịch sử, index hoặc DB cũ, không
  chạy `VACUUM FULL` trên DB UI. Thêm công cụ `db:inspect` chỉ đọc cho DB test
  local có xác nhận target; hướng dẫn trong database runbook.
- Tối ưu danh bạ công khai: lọc giao nhận theo quan hệ lô tại DB thay vì lấy mọi
  ID lô về API; đếm lượt quét bằng quan hệ, không tạo danh sách ID trung gian;
  trang doanh nghiệp cũng lọc lô liên quan qua quan hệ. Giữ điều kiện QR, tổ chức/
  sản phẩm active và bỏ giao nhận đã hủy, không cache thông tin đã rút công khai.
- Prisma chỉ thêm quan hệ cho hai khóa ngoại đã tồn tại (`distribution_line`
  và `trace_scan_daily` → `lot`); `prisma migrate diff` giữa schema trước/sau
  không có SQL. Đã generate client và build API; không tạo migration DDL thừa.
- Dữ liệu đo được tạo trong DB PostgreSQL cách ly có marker sở hữu task, không
  đưa vào DB UI: thêm 100 sản phẩm, 1.000 lô và 30 tổ chức, có QR fixture rõ nhãn
  PERF ONLY. Không coi đây là 100 workflow nghiệp vụ hoàn tất hoặc proof Fabric.
- Sau warmup 4 lượt, đo 20 lượt đảo thứ tự trước/sau, cùng dữ liệu và thống kê:
  danh bạ DN 19,12 → 14,71 ms (5 → 3 query; 1.085 → 52 dòng trả từ SQL), chi
  tiết SP 22,18 → 20,85 ms (22 → 19 query), chi tiết DN 43,93 → 39,49 ms
  (20 → 17 query). Mã băm kết quả giống nhau. Đây là số đo local mẫu; không
  suy ra SLA production. Bản thử gom tất cả quan hệ vào một query chậm hơn đã
  được thay trước khi chốt. Artifact local `.codex/directory-profile-repeated-final.json`.
- Kiểm source cuối: lint/typecheck, 280 API unit, 10 test HTTP/PostgreSQL danh
  bạ đạt, gồm đếm lượt quét bỏ lô riêng tư cùng sản phẩm và scope của ba bên
  giao nhận/cancelled/private/inactive; build API đạt. Không sửa DB UI để chạy test.

### Bộ workflow local bổ sung — 30/10/2026

- Được người dùng chọn nạp vào Web/API local hiện tại; target đã xác minh là
  `agri_trace_ui_test`, API 8080. Backup custom dump 1.162.658 byte đã kiểm
  inventory/hash và khôi phục thử trên DB rehearsal trước khi nạp thật.
- Thêm 30 tổ chức, 90 tài khoản demo, 100 sản phẩm và 100 lô/QR; tổng DB sau nạp
  là 31 tổ chức, 93 tài khoản, 101 sản phẩm, 101 lô. Fingerprint các dòng gốc
  trong 12 bảng nghiệp vụ/lịch sử giữ nguyên; không reset, xóa DB hay dữ liệu gốc.
- Nghiệp vụ đi qua HTTP API: 70 vụ, xuống giống, nhật ký C3 được giao, thu hoạch;
  30 mẻ chế biến nguyên liệu ngoài 10 kg = thành phẩm 8 kg + hao hụt 2 kg.
  Đọc từng sản phẩm/QR qua API đạt hai lượt; chạy lại giữ nguyên 100 lô và
  1.208 command checkpoint, 30 snapshot công khai; DB khoảng 30 MB. Bootstrap
  danh tính/hồ sơ/quyền là fixture,
  không thay cho test đăng ký/OTP; 12 DN logistics chưa có chặng giao nhận.
- Hình ảnh do script tạo có nhãn DEMO, không phải chứng cứ hiện trường hoặc
  giấy tờ thật. Ledger mô phỏng/chưa neo Fabric; không tạo proof CONFIRMED giả.
  Thanh toán vẫn hoãn, không sinh subscription/paid order giả.
- Loader có advisory lock, checkpoint key/body/result, phân biệt từ chối đã biết
  với kết quả chưa rõ; scoped simulated permissions không chạm binding cũ.
  API 283 unit, lint/typecheck/build đạt; Node CI 70 + 6 test đạt.
- Cách chạy và giới hạn: `docs/testing/ui-workflow-100.md`. Tài khoản/mật khẩu,
  inventory/backup/checkpoint chỉ lưu `.codex` bị ignore, không commit bí mật.
  Không tự đánh PASS 41 bài test UI hoặc nghiệm thu Android/Fabric thật.

### Rà soát trước commit — 31/10/2026

- Nhánh review `fix/enterprise-mobile-integration-review-20261031`: trước đó chờ
  nghiệm thu UI; ngày 31/10 chủ dự án đã cho phép commit/push sau lượt mobile smoke.
- PostgreSQL 18 chạy trong container task riêng, cổng 55439; fresh-migrate 93
  migration đạt. API check đầy đủ đạt: 283 unit, 320 HTTP/PostgreSQL integration,
  15 test Fabric thật skip vì chưa bật mạng; lint/typecheck/build đạt. DB UI giữ nguyên.
- Web 335 unit, 164 lint-contract, 4 image-optimizer đạt; lint/typecheck và build
  Webpack đạt. Turbopack vẫn bị sandbox chặn tạo cổng. Hai test browser lô đất
  chưa chạy được vì Chrome bị đóng tại launch trong sandbox; không tính là pass UI.
- Mobile cập nhật các bản vá tương thích SDK 58 bằng kiểm online: Expo 58.0.21,
  React Native 0.88.1 và các module Expo tương ứng; lockfile đồng bộ. Typecheck,
  lint, oxlint và `expo install --check` đạt; 8 phone/session và 7 queue/routing đạt.
  Thay đổi native cần build lại APK trước nghiệm thu thiết bị, không chỉ reload JS.
- CI thêm kiểm phone/session và `test:ci`, chọn API/container/Hybrid khi thay script
  demo; actionlint đạt. CI helpers 71 + 6, CD Python 130 đạt. Agent setup đạt;
  40 test agent đạt, 1 skip do filesystem không phân biệt hoa/thường. CLI nhận đúng
  đường dẫn thật khi thư mục tạm macOS đi qua symlink; không nới policy đồng bộ.
- Rà cache: request API no-store; phản hồi cũ bị loại theo request/session, đổi
  scope xóa dữ liệu nhìn thấy, ghi SecureStore tuần tự; PWA chỉ cache trang offline.
  Giữ journal/key/body và hash lịch sử, không xóa code recovery vì coi là thừa.
  Bỏ cấu hình extra sinh cục bộ trùng app.config; đồng bộ tài liệu hoãn thanh toán
  với source, không đổi lại phân loại thương mại khi chưa tích hợp thanh toán.
- Dependency được xử lý tiếp ngày 31/10: minimatch 11.0.3 và mobile glob 14.0.3;
  adapter callable cũ cho ESLint/Redocly chỉ chuyển lời gọi tới engine upstream,
  không tự viết matcher hoặc sinh lại regex. Bốn test tương thích/rule ESLint thật
  đạt; mobile check, export consumer Web và clean npm ci đạt. Root clean npm ci
  cũng đạt trong thư mục tạm (ignore scripts chỉ cho kiểm install graph).
- Audit root/standalone-chaincode: 0 advisory; mobile: 36 low, 0 moderate/high/
  critical. Ngoại lệ node-forge cũ được gỡ (đã có bản vá 1.4.2 trong lockfile).
  Gate audit local không có ngoại lệ; không tính là chứng nhận bảo mật toàn hệ thống.
- Docker API/Web copy adapter trước npm ci, CI chọn đủ gate khi đổi adapter.
  Sau đổi dependency, API lint/typecheck, 283 unit, build và contract 360 operation
  đạt; integration 320 vẫn là kết quả lượt trước, không tự đổi thành vừa chạy lại.
- Người dùng báo lỗi chung khi Lưu nhật ký Bưởi 01 trên mobile. Tái hiện được
  lỗi tạo idempotency key khi thiếu Web Crypto; đổi sang expo-crypto.randomUUID
  (module đã có sẵn). Test kiểm không có global crypto và giữ nguyên key/body
  khi retry đạt; tổng Web 337 unit, lint/typecheck Web và mobile đạt. Chưa coi
  đây là nghiệm thu ghi nhật ký thành công trên Android; chờ thử lại bằng Metro.
- Log tiếp theo cho thấy đọc API 200 nhưng không có POST tải ảnh. Đã tái hiện
  chính xác lỗi object `{uri,name,type}` qua converter Expo 58: Unsupported
  FormDataPart implementation. Đổi uploadCycleImage sang File native có bytes(),
  Web giữ browser File; chặn file mất/trống/quá 5 MB/sai loại trước khi gửi.
  13 test upload/key/form chọn lọc, tổng 344 Web unit, lint/typecheck đạt;
  đây chưa phải xác nhận upload đã thành công trên thiết bị của người dùng.
- Nhật ký mobile tiếp tục nhận 422 về thời gian. Tách ý định "vừa thực hiện"
  (`SERVER_RECEIVED`) khỏi thời điểm công việc quá khứ (`DEVICE`, giờ Việt Nam).
  Mobile tự lấy giờ, không đưa lựa chọn nguồn giờ hay form ghi bù ra giao diện;
  DEVICE giữ cho consumer có thời điểm nhập tường minh như Web.
  Chỉ care cho phép device nhanh tối đa 2 phút; giữ giờ gốc, nguồn, giờ nhận và
  độ lệch có cả trễ upload trong trace mới. Không sửa giờ/hash/journal cũ.
  Hàng đợi hiển thị nguyên nhân REJECTED; chỉ NOT_FOUND được gửi lại cùng body/key,
  PROCESSING/RECONCILIATION_REQUIRED chỉ đối soát. 295 API unit, 360 Web unit,
  48 HTTP/PostgreSQL workflow trên DB cách ly, lint/typecheck API/mobile/Web,
  contract và Webpack build đạt. Android staff JS/Hermes export đạt; source
  thời điểm mới và thông báo bị từ chối có trong bundle. Các số test trên thuộc
  lượt trước khi bỏ UI chọn giờ; phần bỏ UI được kiểm lại riêng. Không cần đổi schema DB.
  Android thật với lệnh đang chờ vẫn cần người dùng đối soát rồi test form mới;
  không đánh dấu nghiệm thu thiết bị/Fabric hay ghi ảnh ngoại tuyến hoàn toàn.
- GitHub Actions trên remote chưa chạy cho nhánh này; push feature branch đơn lẻ
  không kích hoạt workflow hiện hành, cần PR vào main hoặc dispatch khi được yêu cầu.
  Chưa merge/deploy hay nghiệm thu Fabric/Android thật.

### Chốt cache và DB trước push — 31/10/2026

- Đọc lại thống kê DB UI: PostgreSQL 17.10, khoảng 34 MB; trace_evidence khoảng 9,6 MB. Chỉ đọc, không xóa chứng cứ, journal, index hoặc chạy VACUUM FULL. Số đo truy vấn ở mục 30/10 vẫn là benchmark cách ly, không phải SLA production.
- Cache: HTTP API no-store, dữ liệu mobile theo scope phiên; phản hồi/setter cũ bị chặn khi đổi account/vụ; hàng đợi giữ owner/body/key. Người dùng xác nhận nhật ký, thu hoạch, QR và dữ liệu theo quyền; không suy ra mọi bài logout/cache/ngoại tuyến đã pass.
- QR local được đồng bộ origin; base URL Docker có đuôi /trace được chuẩn hóa trước so sánh, không nới nhận mọi domain. Bí mật/tài khoản/backup/evidence local vẫn bị ignore.
- Kiểm trước push: API 295 unit + 322 HTTP/PostgreSQL đạt (15 Fabric thật skip), Web 361 unit + 164 lint-contract + 4 image optimizer và Webpack build đạt; Gateway 19, chaincode 50 + coverage/build/runtime đạt. Test incident case được giới hạn theo người tạo của lượt chạy để không đếm fixture cũ.
- SDK online đề nghị thêm Expo 58.0.22, dev-client 58.0.18, router 58.0.29; đã cập nhật manifest/lockfile bằng Expo CLI. Mobile typecheck/lint/compat/SDK check/audit không có ngoại lệ, export staff Android và consumer Web đạt. Nghiệm thu thiết bị ở trên thuộc APK trước ba bản vá native này; bản build APK tiếp theo cần smoke lại.
- Push chỉ lên nhánh review đã đặt tên, không merge main, dispatch CI hay triển khai. Required remote CI vẫn cần PR/dispatch riêng; local test không thay Fabric thật.

### Sửa ranh giới test CI Web/mobile — 31/10/2026

- PR #134 ở 29baabc báo TS2307 vì test Web import source/SDK mobile nhưng job Web và stage Next.js Docker không cài/copy mobile. Tách test mobile sang test-mobile với TypeScript/Vitest/setup riêng, giữ đầy đủ lint và chạy trong job Mobile sau hai bước npm ci.
- Web còn 323 bài, mobile harness 38 bài: tổng 361 bài giữ nguyên. Bản copy source sạch chỉ npm ci root, không có Expo/React Native, đã qua nguyên lệnh npm run check --workspace apps/web, gồm 164 lint-contract, 4 image-optimizer và build Turbopack. Type graph Web có 0 file source/dependency mobile.
- Đây là bằng chứng local về ranh giới dependency; GitHub Actions, container và rehearsal phải chạy lại trên commit sửa. Không tắt test, skip gate hoặc thêm Expo vào dependency Web production.

### Bằng chứng và giới hạn hiện tại

- API: 280 unit; 36 test HTTP/PostgreSQL về onboarding/consumer/directory.
- Kiểm tra bổ sung: 9 test chọn lọc về staff session, phân công C3 và thu hoạch/
  vận chuyển/nhận hàng (105 case ngoài bộ lọc không chạy, không tính là đạt).
- Web: 326 unit (gồm 5 test resource isolation, 4 submit và 3 giao nhận mobile), lint/typecheck đạt. Build
  Webpack đạt; lượt Turbopack mới bị sandbox chặn bind port nội bộ. Không đổi
  compiler mặc định và không coi build Webpack là bằng chứng Turbopack đạt.
- Mobile giao nhận: 3 test presentation/epoch và 1 test Web c2 recovery đạt;
  chưa nghiệm thu chữ ký native, Fabric thật hay thao tác thiết bị.
- Mobile: 4 test khóa submit/unmount/retry và 5 test resource isolation đạt;
  8 test phone/session gate từ lượt trước. Lint/typecheck đạt; kiểm phiên bản SDK
  lượt trước đạt, lần này kiểm offline chỉ dùng metadata cache;
  Android JS bundle export đạt. Đây chưa phải APK đã cài/nghiệm thu native.
- Catalog seed chạy hai lần vẫn 30/100, từ chối ghi đè fixture đã sửa; không
  tạo account, Lot/QR hay proof. DB test PostgreSQL 18 được tạo riêng và có label
  sở hữu task; không sửa DB dùng chung/production.
- Migration mới `20261222000000_external_processing_event_scope` chỉ thay hai
  hàm guard: lô có vụ gốc giữ context vụ; lô nguyên liệu ngoài giữ chain/binding
  bất biến của mẻ. Không sửa migration cũ, hash hay sự kiện. Đã apply trên DB test
  có dữ liệu và fresh-migrate 93 migrations; 64 test hồi quy đạt gồm 7 chế biến,
  46 truy xuất và 11 binding. Chế biến kiểm chứng từ, ra lò/replay, lệch khối
  lượng rollback, tranh chấp giữ chỗ, hủy trả nguyên liệu, đính chính nhật ký và
  chặn scope ngoài doanh nghiệp/chuỗi. Các binding là mô phỏng, chưa phải Fabric thật.
- File Firebase local hiện có package `dev.agritrace.consumer`; main dùng
  `vn.agritrace.consumer`. Cần file đúng package, SHA của APK và build development
  mới để nghiệm thu SMS. Không đổi định danh app hoặc gửi SMS tự động để vượt lỗi.
- Công cụ kiểm tra dùng Node 24.22.1/npm 12.1.0 trong runtime tạm ngoài repo.
  Không coi các fixture là dữ liệu doanh nghiệp/chứng nhận thật.
---

Ngày: 27/10/2026. Trạng thái: **DRAFT — chờ chủ dự án duyệt quyết định nghiệp vụ**.
Baseline khảo sát: `9c6d208`, nhánh `feature/mobile-auth-rebuild`.
Tài liệu này chưa thay thế business rules/ADR hiện hành và chưa chứng minh đã
triển khai các module bên dưới. Không chạy migration, seed hoặc thao tác production
trong giai đoạn đề xuất. Không tự commit/push/deploy cho đợt nghiệp vụ mới.

## 1. Phạm vi và khoảng cách với source

Yêu cầu: bán dịch vụ truy xuất cho HTX/nhà sản xuất và chế biến; cho vận chuyển,
phân phối, bán lẻ dùng gói tham gia cơ bản miễn phí. Quản lý chỉ phục vụ truy xuất,
không biến sản phẩm thành ERP/kế toán/nhân sự nội bộ đầy đủ.

| Vùng | Source baseline | Việc cần bổ sung |
| --- | --- | --- |
| Hoạt động tổ chức | `OrganizationType`: FARM, TRANSPORTER, RETAILER, AUDITOR | PROCESSOR, DISTRIBUTOR; giữ AUDITOR độc lập, không biến thành gói thương mại |
| Quyền | ScopedRoleGrant, ChainMembership, StageAssignment; ORG_ADMIN/CHAIN_MANAGER và quyền nghiệp vụ | C1/C2/C3 theo phạm vi và nhóm quyền; phân công đến vụ/vùng/công việc |
| Đăng ký | Tự nhập mật khẩu, tạo hồ sơ chờ duyệt; chưa có bước mua gói | Xác minh liên hệ, kích hoạt tài khoản giới hạn, sửa/nộp lại, thanh toán và entitlement |
| Sản phẩm | Product dùng chung, chưa có `organizationId` | Tách danh mục chung với sản phẩm doanh nghiệp đăng ký; không áp chủ sở hữu mới lên lịch sử tùy tiện |
| Vụ/lô | Vụ có nhiều harvest; mỗi harvest tạo Lot và QR; đóng vụ là lệnh riêng | Quy tắc kết thúc vụ cần duyệt; plot hiện optional trong schema cần kế hoạch tương thích khi bắt buộc vùng |
| Logistics | Shipment hiện gắn một Lot; các chặng PRODUCTION/TRANSPORT/RETAIL | Thêm phân phối, chế biến, nhiều lần bàn giao/tách/gộp; không chỉ đổi nhãn menu |
| Thanh toán | Chưa thấy model subscription/payment trong schema | Đơn mua dịch vụ, gói/version, xác nhận thanh toán, thời hạn/quota, audit |
| Mobile | ACheck consumer hiện có | Ứng dụng/giao diện nhân viên có xác thực và phân công riêng; không đưa quyền ghi vào chế độ consumer |
| Seed | Kịch bản nhỏ, một sản phẩm mẫu; có chặn NODE_ENV production | Catalog/workflow fixtures rộng, an toàn môi trường, idempotent, không giả proof |

Nguồn đối chiếu: `apps/api/prisma/schema.prisma`, `prisma/seed.ts`,
`src/modules/enterprise-onboarding/enterprise-onboarding.service.ts`,
`src/modules/production-cycles/production-cycles.service.ts`,
`docs/plans/enterprise-onboarding.md`, `docs/core-business-rules.md`.

## 2. Mô hình vai trò và gói dịch vụ đề xuất

Loại hoạt động tổ chức, cấp nhân viên, quyền theo tài nguyên và gói dịch vụ là
bốn khái niệm riêng. Không dùng một enum role để thay cả bốn.

| Hoạt động | Gói tối thiểu | Chức năng chính |
| --- | --- | --- |
| HTX/nhà sản xuất | Trả phí sau duyệt | Vùng, sản phẩm đăng ký, vụ, phân công, nhật ký, thu hoạch, lô/QR, chuỗi và giao nhận |
| Chế biến | Trả phí sau duyệt | Cơ sở, nguyên liệu/lô đầu vào, mẻ chế biến, đầu ra, hao hụt và truy ngược |
| Vận chuyển | Miễn phí cơ bản | Thành viên/quyền, lời mời, công việc vận chuyển, xác nhận nhận/giao, sự cố |
| Phân phối | Miễn phí cơ bản | Thành viên/quyền, nhận/giao lô, tồn theo lô phục vụ truy xuất, chuyển đối tác |
| Bán lẻ | Miễn phí cơ bản | Thành viên/quyền, nhận hàng, tra cứu, cảnh báo/thu hồi, xác nhận liên quan |

Đề xuất một doanh nghiệp có hoạt động chính và nhiều capability được duyệt.
Nếu có capability sản xuất/chế biến thì không được chọn nhãn vận chuyển để né gói
bắt buộc. Mức phí, kỳ hạn, quota, add-on và cách áp dụng đa hoạt động chưa được duyệt.
Gói thương mại không đồng nghĩa MANAGED_ORG/SELF_MANAGED_ORG hay quyền giữ khóa.
Không tự cấp peer cho mỗi doanh nghiệp hoặc thay governance Fabric từ việc mua gói.

Gói free không bỏ quyền đọc bằng chứng, xác nhận bàn giao đã được giao, cảnh báo,
thu hồi hoặc hỗ trợ đối soát cần thiết. Các giới hạn có thể áp lên dashboard nâng
cao, tích hợp, báo cáo, quota tạo mới; giá trị quota cần chủ dự án quyết định.

## 3. Đăng ký, duyệt và kích hoạt

Luồng đề xuất:

`Hồ sơ nháp → xác minh liên hệ → thiết lập tài khoản → nộp duyệt → xét duyệt`

- NEEDS_CHANGES: thông báo lý do/email; sửa đúng hồ sơ và tạo revision nộp lại.
- REJECTED: quyết định từ chối có lý do, không xóa hồ sơ/audit để đăng ký lặp vô hạn.
- APPROVED: gói bắt buộc trả phí chuyển AWAITING_PAYMENT; đối tác free kích hoạt
  quyền cơ bản sau các điều kiện xác minh được duyệt.
- Thanh toán xác nhận → chuẩn bị dịch vụ/hạ tầng khi cần → ACTIVE.
- Tài khoản chờ duyệt chỉ xem hồ sơ, phản hồi, gói/đơn mua của mình; không ghi truy xuất.

Phải tách trạng thái hồ sơ, tài khoản, thanh toán, subscription và kết nối ledger.
Admin duyệt hồ sơ không còn tự mở toàn bộ quyền trả phí trước khi thanh toán.
Doanh nghiệp đã trả tiền vẫn không được ghi khi binding/grant cần thiết chưa sẵn sàng.

**Quyết định chờ duyệt:** yêu cầu gốc là OTP → nhận mật khẩu tạm → bắt buộc đổi.
Đề xuất an toàn hơn: OTP/liên kết một lần → tự đặt mật khẩu, không gửi mật khẩu
qua email/SMS. Nếu giữ mật khẩu tạm: ngẫu nhiên, chỉ lưu hash, có hạn/số lần thử,
bắt buộc đổi trước khi mở tài khoản nghiệp vụ, thu hồi phiên liên quan; không
hiện cho admin hoặc ghi log. Kênh xác minh email/điện thoại và thời hạn cần duyệt.

## 4. Thanh toán và hết hạn

Đề xuất giai đoạn đầu dùng chuyển khoản và nhân sự có quyền đối soát; gateway/webhook
là phương án khác cần chọn nhà cung cấp, tài khoản sandbox và quy tắc hoàn/hủy.
Không tích hợp hoặc thu tiền thật trước khi được ủy quyền.

- Server tính giá từ plan/version đã chốt, lưu snapshot vào order; client không
  tự xác nhận giá hoặc trạng thái PAID.
- Transaction ID/tham chiếu thanh toán duy nhất; webhook nếu dùng phải xác minh
  chữ ký và chống phát lại, đối chiếu số tiền/tiền tệ/order trước kích hoạt.
- Trùng thông báo, sai số tiền, thanh toán muộn, xác nhận thủ công nhầm, hoàn/hủy
  phải có state transition/audit và kiểm thử; không xóa giao dịch để sửa số dư.
- Entitlement do API kiểm tra cùng quyền/tenant/scope; ẩn nút không phải bảo vệ API.
- Đề xuất hết hạn chặn tạo mới nghiệp vụ trả phí, nhưng giữ lịch sử/QR công khai,
  cảnh báo và đường hoàn tất bàn giao đang mở để không làm đứt chuỗi.
  Ma trận lệnh được phép khi hết hạn/chậm thanh toán cần duyệt riêng.

## 5. Cấp người dùng và ranh giới quản trị

| Cấp | Đề xuất quyền | Không được mặc định |
| --- | --- | --- |
| C1 — quản trị DN | Hồ sơ, thành viên, nhóm quyền, phân công, dịch vụ và ủy quyền ký | Xem/sửa dữ liệu DN khác; tự nâng gói/capability |
| C2 — quản lý được giao | Lập/điều phối công việc, theo dõi vùng/vụ/lô trong phạm vi cấp | Chủ tài khoản, billing, khóa ký, cấp quyền ngang/cao hơn mình |
| C3 — nhân viên hiện trường | Xem việc được giao, chụp/tải ảnh, ghi nhật ký và báo sự cố | Sửa lịch sử đã chốt; tự kết thúc vụ/chuyển custody nếu chưa được ủy quyền |
| Admin tổng | Xét duyệt DN/gói, cấu hình nền tảng, vận hành, hỗ trợ và audit | Giả làm DN, sửa nội dung đã ký, mặc định đọc mọi ảnh/hồ sơ nội bộ |

Nhóm quyền tùy biến chỉ là tập con quyền có thể cấp; cấm tự cấp ORG_ADMIN hoặc
quyền platform. Kiểm server cả read/list/count/export/ảnh/command/replay.
Thu hồi thành viên, phân công hoặc quyền phải có hiệu lực với phiên đang mở.
Việc ghi nhận của nhân viên và chữ ký tổ chức là hai bằng chứng khác nhau;
OTP/ảnh/vân tay đăng nhập không được gọi là chữ ký tổ chức.

## 6. Sản xuất, chế biến và chuỗi truy xuất

- HTX/NSX: vùng và sản phẩm đã đăng ký → vụ → giao nhân viên/công việc → nhật ký
  → thu hoạch → lô/QR → giao nhận. Giống/vật tư/cơ sở gắn sự kiện truy xuất;
  không mở rộng mặc định sang lương, chấm công, kế toán hay ERP.
- Đề xuất giữ **thu hoạch nhiều đợt**, nút “Thu hoạch cuối và kết thúc vụ” cho đợt
  cuối; đóng vụ độc lập có lý do khi phù hợp. Không đóng vụ ngay đợt thu đầu tiên.
  Đây là thay đổi so cách diễn đạt yêu cầu, phải duyệt trước triển khai.
- Mỗi lô có QR riêng. Sản phẩm không đồng nhất với lô/vụ. Quy tắc một harvest
  tạo một hay nhiều lô, tách lô và đóng gói cần mô hình rõ; không sinh lại QR lịch sử.
- Chế biến cần quan hệ nhiều lô đầu vào → mẻ → nhiều đầu ra, số lượng/đơn vị,
  hao hụt/phụ phẩm và điều kiện duyệt. Không đổi productId của lô gốc để giả chế biến.
- Phân biệt tách/gộp/đóng kiện với biến đổi nguyên liệu; bảo toàn lineage và kiểm
  quy đổi đơn vị, sai số, khối lượng. Mô hình nhiều chặng/mẻ cần migration và
  contract/version phù hợp; không sửa hash, receipt hay sự kiện lịch sử.
- Mời đối tác không đồng nghĩa tự gia nhập chuỗi. Lời mời có trạng thái/hạn,
  đồng thuận của từng DN và phạm vi chia sẻ. Đối tác ngoài nền tảng có luồng mời
  đăng ký; không được giả chữ ký khi chưa có tài khoản/ủy quyền.
- Giữ giao/nhận hai bên, version và idempotency; xử lý lệch số lượng, hỏng hàng,
  nhận một phần, từ chối, trả hàng/thu hồi và tranh chấp bằng sự kiện bổ sung.
- Chỉ digest/commitment lên ledger; ảnh, PII, giá và tài liệu giữ off-chain.
  “Đã ghi DB/đang chờ blockchain/đã có receipt VALID” là trạng thái khác nhau.
- AUDITOR/COMPLIANCE_REVIEWER hiện có vẫn độc lập với năm hoạt động thương mại.

## 7. Web và hai đối tượng mobile

- Web DN: dashboard theo hoạt động + gói + quyền, thành viên, nhóm quyền, phân công,
  danh mục/vùng/vụ hoặc mẻ, lô/QR, giao nhận, chuỗi, đối tác, sự cố và dịch vụ.
- Web platform: hàng đợi duyệt, đơn mua/đối soát, plan/version/quota, cấu hình,
  hỗ trợ và quan sát backlog/ledger; không nhập nhật ký thay DN.
- ACheck consumer: sản phẩm, DN, giới thiệu, QR, thông báo, lịch sử; chỉ public
  projection, không lấy API staff rồi ẩn vài field ở client.
- Mobile nhân viên: công việc được giao, ghi nhận/ảnh, quét lô, phiếu nhận/giao theo
  quyền. Đề xuất app/giao diện riêng với auth/scope riêng; không tự cho consumer
  đổi mode để có business permission. C2 chỉ có màn quản lý cơ bản được giao.
- Offline nếu duyệt: chỉ lưu bản nháp có chủ sở hữu; gửi khi có mạng bằng original
  body/key và đối soát khi mất phản hồi. Không tự cấp key mới hay báo đã lên ledger.
- Ảnh dùng object storage với giới hạn dung lượng/loại file, kiểm nội dung, checksum,
  tenant ownership và URL truy cập có hạn. Không cache URL nhạy cảm qua logout.

## 8. Cache, database và dọn mâu thuẫn

1. Lập inventory cache HTTP/API, Next.js/PWA, mobile và dữ liệu local. Giữ auth,
   quyền, command status, thanh toán và dữ liệu riêng tư `no-store` trừ thiết kế
   cô lập/invalidation đã được chứng minh; không TTL-cache quyền để trì hoãn revoke.
2. Public catalog có cache key đủ bộ lọc/phân trang/phiên bản, TTL giới hạn và
   invalidation sau publication changes. Recall/expiry/integrity không bị giấu
   bởi cache cũ. Client bỏ response cũ khi đổi account/scope.
3. Đo query hot path trên DB cách ly có seed. Chụp EXPLAIN (ANALYZE, BUFFERS),
   latency và query count trước/sau; 100 sản phẩm không phải chứng minh tải lớn.
4. Kiểm tenant/FK/unique, composite index theo query thực, keyset pagination,
   bounded select/include, tránh N+1/full-scan/count lặp; không thêm index hàng loạt.
5. Billing/quota/authorization và domain command phải transaction/lock nhất quán;
   đơn vị Decimal/quy đổi rõ. Migration append-only, kiểm fresh + dữ liệu hiện hữu.
6. Tách module auth, access, enrollment, commercial service, production, processing,
   logistics và trace; dùng Swagger sinh types cho Web/mobile, không tạo contract tay.
7. Mỗi quy tắc mới có chủ sở hữu/source, permission matrix và test. Chỉ bỏ code
   sau khi kiểm caller/export/route/test; không xóa command recovery, migration,
   receipt/hash hoặc branch hỗ trợ history vì tưởng là code thừa.
8. Tài liệu mới sau duyệt supersede rõ plan cũ; giữ ADR/history có ngày. Không
   sửa business rules thành mô tả tính năng chưa triển khai để làm tài liệu khớp giả.

## 9. Seed rộng, chỉ trên môi trường được phép

Mục tiêu catalog đề xuất: **30 doanh nghiệp thương mại và 100 sản phẩm đăng ký**.

- 12 HTX/NSX, 6 chế biến, 4 vận chuyển, 4 phân phối, 4 bán lẻ; platform/Auditor
  fixtures riêng, không tính thành một trong năm loại DN thương mại.
- 100 sản phẩm đăng ký có chủ DN rõ; 70 nông sản và 30 sản phẩm chế biến; dữ liệu
  tổng hợp, không giả chứng nhận thật hoặc dùng thông tin DN/cá nhân thật.
- Khoảng 120 thành viên C1/C2/C3, nhiều nhóm quyền và nhân viên bị thu hồi quyền.
- Workflow scenario mục tiêu: 60 vụ, 180 lô, 20 chuỗi, nhiều đợt thu hoạch,
  mẻ đầu vào/đầu ra và nhiều chặng khi model được duyệt; đủ tài khoản free/paid,
  chờ duyệt, yêu cầu bổ sung, thanh toán chờ và hết hạn.
- Fixtures cho hàng thiếu dữ liệu, ảnh thiếu, recall/expiry, lệch lượng, nhận một
  phần, mất response và quyền chéo tenant. Không gán proof VERIFIED/txId giả.
- Seed tách catalog khỏi workflow. Workflow đi qua command/invariant trên DB/mạng
  test được sở hữu với binding hợp lệ; không bypass SQL guard để đủ số lượng.
- Seed deterministic theo namespace/manifest, chạy lại không nhân bản; chỉ dọn
  dữ liệu thuộc manifest của lần seed trên DB cách ly được xác minh, không reset DB.
  `NODE_ENV !== production` một mình chưa đủ chứng minh được phép seed.
- Không tự gửi OTP/email/thanh toán thật; dùng adapter sandbox/fixture được ghi nhãn.

## 10. Thứ tự triển khai và acceptance

1. Duyệt ba quyết định ở cuối tài liệu, chốt quyền C2/C3, ma trận gói và tiêu chí test.
2. Xây tenant/access + enrollment + commercial entitlement, migration và contract;
   Web platform/DN phải có luồng đầu-cuối tương ứng, không chỉ schema/menu.
3. Hoàn chỉnh sản xuất/phân công/lô và thiết kế chế biến, phân phối/nhiều chặng;
   kiểm domain/SQL/ledger version trước bật ghi.
4. Mobile nhân viên + consumer projections và kiểm trên Android thật; không coi
   browser/unit pass là nghiệm thu camera, OTP, offline hay renderer native.
5. Seed catalog/workflow cách ly, đo DB/cache, dọn code/tài liệu từng module.
6. Integration checks, migration existing-data, security/replay/concurrency,
   payment duplicate/unknown, revoke tức thì, UI 320/390/768/1440 và mobile.
7. Review đúng SHA, backup/restore và chủ dự án duyệt release riêng. Không mặc
   nhiên merge/deploy từ yêu cầu làm chức năng.

## 11. Quyết định cần chủ dự án duyệt trước khi đổi nghiệp vụ

1. Thu hoạch: giữ nhiều đợt + “đợt cuối kết thúc vụ” (đề xuất), hay thu hoạch một lần?
2. Kích hoạt: liên kết/OTP một lần để tự đặt mật khẩu (đề xuất), hay giữ mật khẩu tạm?
3. Thanh toán ban đầu: chuyển khoản + admin đối soát, hay gateway cụ thể? Giá,
   chu kỳ và quota để cấu hình sau khi chốt, không tự bịa giá/gateway đã tích hợp.

## 12. Tham khảo thiết kế, không phải tính năng đã có hoặc chứng nhận tương thích

- [Farmforce](https://farmforce.com/): phân tách thu thập hiện trường Web/mobile,
  mạng lưới nông hộ và traceability ở first mile; dùng làm tham khảo phân vai.
- [Cropin](https://cropin.com/): phân biệt quản lý nông trại/nhân viên hiện trường
  với truy xuất QR; không mặc định đưa toàn bộ chức năng ERP/AI vào AgriTrace.
- [GS1 EPCIS](https://www.gs1.org/standards/epcis) và
  [GS1 Traceability Standard](https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard):
  tham khảo trao đổi sự kiện giữa các tổ chức, phân biệt transformation/aggregation,
  đầu vào/đầu ra và giao/nhận. Chưa tuyên bố AgriTrace tuân thủ/certified EPCIS.
