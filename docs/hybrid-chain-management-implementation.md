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

Dev vẫn light mode, chưa dùng identity Fabric production. Người dùng xác nhận
chưa có đối tác pilot; sẽ dùng mạng Fabric dev cách ly. Pilot kỹ thuật không
thay nghiệm thu authority của doanh nghiệp thật.

## Quyền và tính nhất quán

- JWT/session/global role được đọc từ DB; scope được kiểm trước replay và dưới
  khóa trong transaction ghi domain/result journal.
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
IDs/start times/restarts, state và helper bytes production giữ nguyên. Dev có
tám trace/outbox Pending, không proof, containers healthy, không OOM; CD dev
đã bật lại. Evidence root-only: `/opt/agri-trace-dev/cd/hybrid-foundation-20261011.json`.

Chưa hoàn thành gate A/B/C hoặc thời gian quan sát 24 giờ sau candidate cuối.
Mạng Fabric dev riêng là bước tiếp theo; dựng mạng không mở scoped business
commands hoặc quyền tự quản của một doanh nghiệp chưa tham gia.

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
và event cuối Pending. Bản sửa đợi backlog và sinh ledger context đang được
kiểm CI trước delivery. Không sửa event/hash/proof để vượt gate.

Chưa ghi nhận switch/drain/retention cuối hoặc đủ 24 giờ quan sát. Evidence
root-only: `/opt/agri-trace-dev/cd/hybrid-fabric-dev-20261011.json` và
`/opt/agri-trace-dev/shared/fabric/repair-evidence.json`.
