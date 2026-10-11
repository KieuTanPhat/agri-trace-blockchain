# Triển khai nền quản lý chuỗi — 11/10/2026

## Phạm vi và trạng thái

Nền quản lý đã triển khai lên `dev` theo [plan Hybrid Fabric](plans/hybrid-fabric-chain-owner-plan-2026-10-11.md),
PR [#87](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/87),
release `c07f625dad9e91525d24651dc53da7f4c28bd668`.
Lát cắt đầu có capability, quyền theo phạm vi, bootstrap chuỗi/chủ chuỗi,
mời/accept/tạm ngừng/thu hồi/mời lại thành viên, audit, Swagger và Web tại
`/supply-chains`. Chưa nghiệm thu toàn bộ bản A/B/C.

Scoped grants hiện chỉ áp dụng API quản lý chuỗi. Cycle/Lot/Shipment/compliance/
IoT vẫn dùng core policies; chưa tạo tài nguyên nghiệp vụ thuộc chuỗi mới.
Nhiều capability chưa mở thêm quyền trên endpoint core. Không tự gán legacy
cycles hoặc sửa event/hash/QR/proof. StageAssignment, ShipmentPlan, tích hợp scope
trên mọi read/write, backfill manifest, ledger router và signer là các gói tiếp theo.

Dev đã có pilot Fabric riêng, không dùng identity Fabric production. Người dùng xác nhận
chưa có đối tác pilot; sẽ dùng mạng Fabric dev cách ly. Pilot kỹ thuật không
thay nghiệm thu authority của doanh nghiệp thật.

## Quyền và tính nhất quán

- JWT/session/global role được đọc từ DB; scope được kiểm trước replay và dưới
  khóa trong transaction ghi domain/result journal.
- Bản sửa đang kiểm chứng của HYB-03 lấy khóa `FOR SHARE` trên tổ chức đích và
  user nhận grant trước khi kiểm trạng thái. Khóa actor riêng không đủ khi
  platform admin cấp quyền cho tổ chức khác; FK chỉ lấy key-share nên không
  chặn cập nhật status. Không đổi schema, API contract hoặc quyền được cấp.
- Nền tảng cấp ORG_ADMIN/CREATE_CHAIN. Org admin chỉ cấp FARM_STAFF/TRANSPORTER/
  RETAILER của mình, trong membership ACTIVE và capability đã có; không tự cấp
  manager/auditor/reviewer/platform authority. Manager thuộc tổ chức chủ chuỗi.
- CREATE_CHAIN tạo owner membership ACTIVE và manager grant cùng transaction.
  Platform admin đọc metadata quản trị, không accept thay partner hoặc điều phối.
- Partner org admin mới accept; version chống stale writes, invitationRevision
  chặn replay vòng mời trước. Rejoin không hồi sinh grants đã thu hồi.
- Khóa org scope trước chain scope; platform revoke dùng khóa target org. Mỗi
  transaction quản lý giới hạn 15 giây, pool wait 5 giây; không có network/Fabric call.
- Composite user/org và membership/chain FK; CHECK scope kind; partial uniqueness
  riêng với chainId NULL. Audit append-only, grant đã thu hồi không sửa/xóa.
- Partner chỉ xem membership mình; manager xem danh sách điều phối. Roster chỉ
  trả id/fullName cho org admin cùng org hoặc platform admin. Cùng policy này
  bảo vệ danh sách active grants; UI cho quản trị viên thu hồi bằng version.
- Web bỏ state khi đổi account, bỏ response trễ khi đổi chain; no-store API và
  Idempotency-Key giữ nguyên khi retry cùng thao tác.

## Review migration và rollback

`20261011140000_chain_management_foundation` có LF SHA-256
`9beb5342bb4dbb7eae9f221d6fe1b6dbfd648bae7ba46cb3e580a6e69e26ac28`.

Migration có transaction, enums, năm bảng mới, unique index user/org và triggers.
Không drop/rename/chuyển kiểu cột core. Unique index chứa primary user ID nên
không siết thêm dữ liệu user hiện có. FK mới chỉ tác động khi có dữ liệu chuỗi;
lịch sử grant giữ org của user. Chuyển user sang pháp nhân khác cần tài khoản mới
hoặc migration riêng, không update org để bỏ lịch sử.

Capability phụ thuộc tổ chức và được xóa cùng tổ chức chưa có lịch sử chuỗi;
membership, grant và audit vẫn giữ các ràng buộc bảo toàn lịch sử. CI phát hiện
FK capability RESTRICT làm hỏng cleanup auth concurrency cũ; đã sửa thành CASCADE.

Trigger trên bảng core chỉ là AFTER INSERT Organization, thêm primary capability
vào bảng mới. Lock Organization trong backfill ngăn INSERT rơi giữa SELECT và
cài trigger. Giữ toàn bộ trigger Farm/Shipment và quy tắc hash/evidence cũ.

CD parser tổng quát vẫn chặn DML/trigger/unique index tùy ý. Exception chỉ nhận
đúng tên + checksum đã review; SQL khác ngoài LF/CRLF bị chặn. Helper root dev
cần cập nhật từ source đã kiểm trước delivery; không cập nhật helper production.

Rollback app giữ schema expansion và dữ liệu mới, không restore đè DB.
Controller ghi compatible_migrations khi rollout đạt; app core cũ bỏ qua bảng mới.
Trước rollout lấy snapshot; sau rollout/rollback đối chiếu mọi event/proof
fingerprint, QR, core workflow, counts, health và production preservation.

## Kiểm chứng nền quản lý đã đạt

Lint/typecheck API/Web và 91 unit tests API đã đạt. E2E đầu phát hiện fixture
schema lệch khi migration còn được bổ sung; đã dựng lại DB trống. Tiếp đó phát
hiện transaction quản lý vượt 5 giây qua SSH; dùng giới hạn riêng 15 giây,
không bỏ khóa hoặc bớt kiểm quyền. Scenario E2E nhiều request có timeout riêng
cho kết nối DB từ xa; CI Linux kiểm trên PostgreSQL gần runner.

CI Linux đầu đã qua 6/6 E2E chuỗi, 41 core workflow tests; phát hiện 14 auth
concurrency tests lỗi cleanup do FK capability mới. Bản sửa CASCADE đã chạy
lại toàn suite. E2E từ Windows qua SSH đạt 5/6; bài giữ khóa để quan sát thu hồi
vượt transaction timeout, trong khi cùng bài đạt trên Linux DB gần runner.

Candidate `649e18437da9c9a109cd19a321f6a1595d463d78` qua Application CI,
Blockchain CI và Dependency Audit. API có 91 unit tests và 108 E2E tests;
Linux gần database kiểm cả race/revoke. Migration 15 chạy từ DB trống và bản
copy dev cách ly; toàn bộ counts và bảy event fingerprints trước migration giữ
nguyên. Windows skips/lỗi nền tảng không tính là Passed.

Push CI của merge SHA và [Development CD](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38144816746)
đều đạt. Live smoke trên `nongtrace.site` kiểm bootstrap/create replay, outsider,
grant chéo org, owner không accept thay, partner accept/replay, membership
projection, grant/revoke, suspend/reinvite và không hồi sinh quyền. QR cũ còn
tra cứu được, hiển thị Pending khi Fabric tắt. Browser kiểm route guard và QR
công khai; chưa ghi nhận nghiệm thu UI quản lý đã đăng nhập.

Rollback hai chiều `c07f625 → 298758e → c07f625` đạt. Hash dữ liệu của cả năm
bảng quản lý giữ nguyên; 118 event/proof fingerprints production, container
IDs/start times/restarts, state và helper bytes production giữ nguyên. Khi kết thúc rehearsal nền quản lý trước khi dựng Fabric, dev có
tám trace/outbox Pending, không proof, containers healthy, không OOM; CD dev
đã bật lại. Evidence root-only: `/opt/agri-trace-dev/cd/hybrid-foundation-20261011.json`.

Chưa hoàn thành gate A/B/C hoặc thời gian quan sát 24 giờ sau candidate cuối.
Mạng Fabric dev riêng đã triển khai theo phần pilot bên dưới; dựng mạng không
mở scoped business commands hoặc quyền tự quản của doanh nghiệp chưa tham gia.

## Pilot Fabric dev đang kiểm chứng

Đã provision CA/peer/orderer riêng, channel `agritrace-dev`, sequence 1,
package từ release `c07f625`. Lần dựng đầu phát hiện: cổng chưa bind loopback,
helper orderer động lệch hostname/path, endpoint IP không khớp TLS DNS SAN và
image tạo volume ẩn ngoài danh mục. Đã sửa generator, giữ CA/MSP/ledger đang có,
cấp lại TLS orderer đúng hostname và quản lý explicit mounts.

Một chẩn đoán operator đã in nhầm enrollment secret của identity test; đã đổi
14 enrollment secrets bằng CA admin. Không xuất private key; credential không
được ghi vào báo cáo. Chẩn đoán tiếp theo che mọi secret trước khi xuất.

Lần bật đầu ghi 7/8 events rồi bị gate chặn: canary confirm trước một aggregate
còn Pending. Fabric-off phát hiện QR so receipt với default channel thay vì
channel dev. Đã đưa API về light bằng context đọc đúng channel, giữ bảy proof
và event cuối Pending. Bản sửa đợi backlog và sinh ledger context đã triển khai
qua PR #88 sau CI/CD. Không sửa event/hash/proof để vượt gate.

Release `e1261a0` đã qua push CI và Development CD. Bật/tắt/resume giữ dữ liệu;
command offline có Pending thật, sau bật lại đủ 10/10 proof. Rollback hai chiều
với Fabric bật giữ nguyên event/proof fingerprints, năm bảng quản lý và sequence 1.
Kiểm sâu runtime phát hiện CPU parameter bị Fabric bỏ qua; đã limit container
hiện có, sửa generator/persistent peer config và kiểm Docker HostConfig sau
peer recreate. Khóa và cả mười receipt đầy đủ so với DB snapshot giữ nguyên.

PR #90 đã qua CI/CD của merge SHA và triển khai dev release
`1e009831260254444389b49d6a58170c1b003950`;
[Development CD](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38154437965)
đạt. Lượt kiểm độc lập lúc 23:26 ngày 11/10/2026 (UTC+7) xác nhận 11/11 proof,
không Pending; mười receipt cũ, khóa, sequence 1, giới hạn CPU/RAM, 118
fingerprints production và 15 container ngoài dev giữ nguyên. Đây là candidate
mới để theo dõi 24 giờ; không cộng thời gian quan sát của release trước để
tuyên bố đạt gate.

Chưa đủ 24 giờ quan sát hoặc hoàn tất A/B/C. Chi tiết gate đang đạt/còn thiếu
tại [pilot Fabric dev](fabric-dev-pilot-2026-10-11.md). Evidence root-only:
`/opt/agri-trace-dev/cd/hybrid-fabric-dev-20261011.json` và
`/opt/agri-trace-dev/shared/fabric/repair-evidence.json`.

## HYB-03 — Cấp quyền đồng thời với khóa đối tác

Kiểm thử PostgreSQL cách ly tại commit `bc9e986` tái hiện hai lỗi: khóa user
hoặc tổ chức commit được trong lúc command cấp quyền đã kiểm ACTIVE nhưng
chưa tạo grant/journal. Hai trường hợp khóa trước command đã bị từ chối đúng.
Không sửa dữ liệu dev/production để kiểm thử tình huống này.

Candidate sửa lấy khóa hàng của tổ chức đích rồi user nhận quyền, trước khóa
scope và kiểm tra ACTIVE trong service. Khi grant đang chạy, status update
phải đợi grant cùng journal commit; khi disable commit trước, grant bị từ chối
và không có grant, audit hoặc command commit. JWT của đối tác đã bị khóa vẫn
bị từ chối. Bài test quan sát lock wait thực trong `pg_stat_activity`, không
dùng thời gian sleep làm bằng chứng khóa.

Bốn scenario mới và regression API đang được kiểm chứng; chưa ghi Passed hoặc
coi candidate đã triển khai dev. Source/log từng lần chạy được giữ riêng trên
VPS. Phần này chỉ xử lý recipient status race của nền quản lý, không hoàn tất
scope core, StageAssignment, ShipmentPlan hoặc toàn bộ HYB-03.

## HYB-AC-24 — Custody khi cùng doanh nghiệp làm nhiều công đoạn

Candidate tiếp theo sửa `resolveLotCustodian` ở trạng thái FAILED: organization
ID không đủ phân biệt FARM_STAFF, TRANSPORTER và RETAILER nếu cùng doanh nghiệp
đảm nhiệm các bên. So sánh cả role lẫn organization giữa bằng chứng thời điểm
và công đoạn trước lỗi; organization-only chỉ suy ra role nếu bên đó có đúng
một công đoạn. Metadata chỉ đến tổ chức ngoài các bên hoặc mâu thuẫn công đoạn
trả custody chưa xác định, không mở command ghi.

Kiểm thử trước sửa tái hiện ba lỗi; các bài mới giữ cả legacy organization-only
khi một bên có một role, suy ra theo pickup/arrival khi đủ bằng chứng, cùng org
ở các trạng thái bình thường và sau full damage. Không thay payload/hash/proof
lịch sử hoặc tự chuyển custody trong database. Candidate này chưa triển khai
dev và không đồng nghĩa HYB-AC-24 đã đạt đầy đủ: multi-capability core flow và
reviewer independence vẫn còn ở các gói sau.

## HYB-02/03/04 — Scope nghiệp vụ đang chuẩn bị

[ADR-002](adr-002-hybrid-business-scope.md) và SQL draft riêng đã chuẩn bị
ProductionCycle scope gốc, StageAssignment, ShipmentPlan/revisions/acceptance
và EventChainContext. Profile bắt đầu PREPARING; chưa bật scoped business
writes. Không thêm vào Prisma migrations hoặc CD checksum allowlist ở bước này.

DB PostgreSQL 18 mới, cách ly đã qua 21 assertion SQL ngày 12/10/2026, giữ
trigger core. Source baseline để migrate là `5a71e8b`; digest và evidence tại
ADR. Chưa nghiệm thu API, concurrency, trace/outbox transaction, capability
core, legacy backfill, privacy/read filters, Web hoặc các gate A còn lại.
