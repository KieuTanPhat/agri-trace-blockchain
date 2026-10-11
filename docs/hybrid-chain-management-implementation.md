# Triển khai nền quản lý chuỗi — 11/10/2026

## Phạm vi và trạng thái

Đang triển khai lên `dev` theo [plan Hybrid Fabric](plans/hybrid-fabric-chain-owner-plan-2026-10-11.md).
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
  trả id/fullName cho org admin cùng org hoặc platform admin.
- Web bỏ state khi đổi account, bỏ response trễ khi đổi chain; no-store API và
  Idempotency-Key giữ nguyên khi retry cùng thao tác.

## Review migration và rollback

`20261011140000_chain_management_foundation` có LF SHA-256
`d7383e26ff34ab693dec260d9546d43a0bdd509a3d700048c16b58a15898e60a`.

Migration có transaction, enums, sáu bảng mới, unique index user/org và triggers.
Không drop/rename/chuyển kiểu cột core. Unique index chứa primary user ID nên
không siết thêm dữ liệu user hiện có. FK mới chỉ tác động khi có dữ liệu chuỗi;
lịch sử grant giữ org của user. Chuyển user sang pháp nhân khác cần tài khoản mới
hoặc migration riêng, không update org để bỏ lịch sử.

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

## Kiểm chứng đang theo dõi

Lint/typecheck API/Web và 91 unit tests API đã đạt. E2E đầu phát hiện fixture
schema lệch khi migration còn được bổ sung; đã dựng lại DB trống. Tiếp đó phát
hiện transaction quản lý vượt 5 giây qua SSH; dùng giới hạn riêng 15 giây,
không bỏ khóa hoặc bớt kiểm quyền. Scenario E2E nhiều request có timeout riêng
cho kết nối DB từ xa; CI Linux kiểm trên PostgreSQL gần runner.

E2E cuối, CI Linux, migration từ DB trống/copy, rollout, browser và rollback sẽ
được ghi sau khi chạy. Windows skips/lỗi nền tảng không tính là Passed.
