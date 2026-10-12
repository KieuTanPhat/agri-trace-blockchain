# Tiến độ Hybrid ngày 12/10/2026

Ước lượng tổng **khoảng 35%**, tính khối lượng triển khai và kiểm chứng;
không dùng tỷ lệ test đạt để tính tiến độ. Chưa nghiệm thu trọn bản A/B/C.
Mỗi cập nhật phần lớn kèm tỷ lệ ước lượng, đầu ra vừa đạt và gate còn thiếu.
Theo yêu cầu mới, chỉ thông báo khi có phần lớn hoàn tất, lỗi đáng kể hoặc cần
người dùng xử lý; không gửi cập nhật nhỏ liên tục.

| Nhóm | Trọng số tạm tính | Tiến độ ước lượng | Phần còn thiếu chính |
| --- | ---: | ---: | --- |
| Nền quản lý và Fabric dev pilot | 10% | 85% | Fresh provision sau mọi bản sửa, restore/load, cửa sổ quan sát |
| A: scope, core, backfill và Web | 40% | 60% | PG của candidate, apply/provenance/journal bridge, migration/rehearsal, browser/mobile, rollout |
| B: router/registry, hosted và tự quản | 30% | 10% | Protocol, permission sync/barrier, router, chaincode, join/rotation/restore |
| C: signer và bàn giao hai bên | 20% | 0% | Commitment/vectors, signer authority, versioned readers, state machine/UI |

Tổng có trọng số 35,5%, làm tròn theo bước khoảng 5 điểm thành 35%. Đây là
ước lượng quản lý còn bất định, sẽ hiệu chỉnh theo gate thực tế. Code/test
cách ly chưa được tính như đã phát hành; monitoring không thay cho implementation.

## Bản sửa đang chuẩn bị

Worktree chỉ định: nhánh `feature/hybrid-chain-business-scope`, HEAD
`b7a52339dbeefdd8c1555e95ab00ae13e764d8f0`. Prisma vẫn đi trước migration chính
thức: không chạy app candidate hoặc SQL draft trên DB dev/production dùng chung.
Môi trường lượt này không ghi được worktree/Git metadata hoặc truy cập SSH.
Bản sửa và kiểm thử nằm trong bản sao cách ly; checkout main có thay đổi của
người dùng giữ nguyên. Chưa commit/push/PR/deploy bản sửa.

- Guard kiểm scoped business role hiện hành trước DTO khi global role không
  khớp. Domain policy vẫn kiểm đúng resource/grant dưới khóa và trước replay.
  Admin/Auditor không có candidate role bị 403 trước validation body. Cần PG/
  HTTP hồi quy đúng candidate để kết luận hai lỗi legacy đã hết.
- Cycle projection có quyền ghi/review theo subject; compliance, IoT và
  navigation đọc quyền server. Global role không tự mở scoped self-review.
- Web giữ access epoch qua refresh token. Đổi revision hoặc không kiểm được
  quyền thì không tự gửi lại request cũ, không phát key mới để execute lại
  command chưa rõ kết quả. Ba bài test đã tái hiện lỗi trước sửa.
- Mode `plan` tạo assignment proposals từ manifest pin và preflight trong
  snapshot chỉ đọc: PRODUCTION theo Cycle, TRANSPORT theo Shipment, RETAIL theo
  Lot/bên nhận thực tế. Lot chưa có Shipment không suy ra retailer. Cùng org
  nhiều công đoạn vẫn cần proposal/confirmation riêng; không tự ACCEPTED.
  Đây chưa là apply, consent, provenance runtime hoặc journal bridge.

## Kiểm chứng và failure giữ lại

API **130/130 unit**, Web **169/169 tests**, lint/typecheck API/Web đạt.
OpenAPI check từ NestJS compile đạt **89 operations/public projection**.
Test copy dùng `preserveSymlinks` và temp riêng để tránh native realpath/temp
rename của sandbox Windows; không đổi config hoặc timeout sản phẩm trong patch.

Giữ log từng lỗi: API lượt đầu 117/118, một Nest startup hook timeout 10 giây
khi chạy nhiều checks cùng lúc. Test đó chạy riêng đạt với timeout giữ nguyên;
lượt sau toàn bộ API đạt 130/130. Hai lượt Web runner lỗi sandbox trước khi chạy
test không tính là test đạt. Ba refresh race failures trước sửa: 26/29 đạt;
sau sửa toàn bộ Web đạt 169/169. Web production build bị SWC chặn canonicalize
baseUrl bởi sandbox (Access denied), nên **build gate chưa đạt**; không đổi
source/config sản phẩm để bỏ gate này.

58 PostgreSQL scenarios của candidate, 30 SQL assertions, ORM và 112 legacy
E2E **chưa chạy lại trong lượt này**. Docker Desktop local không có daemon,
SSH bị từ chối. Hai preflight PG cases được mở rộng kiểm proposals, inventory/
assignment/journal counts không đổi và target ACTIVE bị chặn; assertions mới
chưa là evidence đạt.

Lượt remote trước ở `b7a52339`: 57 policy/DB tests đạt, legacy 110/112 do hai
lỗi expected 403, actual 400. Failure giữ tại
`/opt/agri-trace-admin/hybrid-scope-draft/fce7466263ece890-1791778321957691924`.
Lượt `c68a4ec`: partial 54 DB/30 SQL/ORM/114 unit; legacy helper timeout 300 giây
tại `...-1791776965493630720`, chưa tính 112 đạt. Helper lần sau cho riêng legacy
tối đa 1200 giây, giữ throttle, per-test 30 giây và resource quota.

## Dev và observation

Release được kiểm gần nhất vẫn
`dev-2d08e8ec003157de45a53ddd9b9df537e589acd5`, sequence 1/package c07f625.
Evidence đã có từ **11:25 ngày 12/10 (UTC+7)**: 13/13 proof, Pending 0,
production 118 fingerprints/15 non-dev containers. Đây là evidence trước lượt
hiện tại, không là kết quả kiểm live mới.

SSH khoảng **12:09 ngày 12/10** không truy cập được; health dev/production hiện
tại chưa xác minh. Root evidence chưa ghi được, failure giữ ở checkpoint cách
ly để đối soát khi truy cập lại. Giữ gap 27.612 giây và mọi failure/window cũ;
gate 24 giờ chưa đạt. Không reset window vì sửa docs/chuẩn bị patch chưa deploy.
Không deploy/restart/configure production, reset ledger/identity hoặc đổi proof/hash cũ.

## Tiếp tục theo dependency

Khi quyền thực thi phù hợp trở lại: kiểm patch/snapshot rồi áp dụng vào đúng
worktree. Đọc job remote và terminal logs trước khi chạy job khác; không start
trùng. Commit/upload source SHA mới; kiểm 58 DB/30 SQL/ORM/130 unit và 112 legacy.
Sau đó làm apply/provenance/runtime pin, assignment consent, journal bridge,
rehearsal DB mới/copy, official migration/checksum review, browser/mobile,
CI/CD đúng SHA và observation. B/C tiếp tục sau A, không dừng ở monitoring.

Chưa có đối tác thật: Fabric dev cách ly chỉ nghiệm thu kỹ thuật. Authority
peer/CA/signer của doanh nghiệp thật vẫn cần doanh nghiệp tham gia và giữ khóa.
