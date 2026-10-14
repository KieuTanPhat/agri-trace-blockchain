# ADR-002 — Scope nghiệp vụ và kế hoạch vận chuyển, bản A

Ngày quyết định: 12/10/2026 (UTC+7). Cập nhật trạng thái ngày 14/10/2026: business
scope và controlled legacy scope trong lịch sử dùng chung
[migration append-only](../apps/api/prisma/migrations/20261014000000_hybrid_chain_scope/migration.sql).
Production hosted Hybrid đã được cài mới và bàn giao ngày 14/10/2026 theo
[kế hoạch cài mới](plans/fresh-install-cleanup-2026-10-13.md),
[PR #95](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/95) và bằng chứng
CI/CD của revision bàn giao. Trạng thái source promote nhưng chưa đủ gate để
kích hoạt production thuộc candidate ngày 13/10, được giữ tại
[review migration lịch sử](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/4d92f02122cbb0b4342372474f466c9146522365/docs/hybrid-migration-review-2026-10-13.md).
Các quyết định A bên dưới giữ nguyên; phạm vi cài mới ở cuối ADR và
[ADR-004](adr-004-hybrid-binding-and-signatures.md) quy định cách áp dụng hiện hành.

Bối cảnh lúc lập ADR: nền quản lý chưa gắn Cycle/Lot/Shipment với chain. Mở quyền core theo
capability trước khi mọi read/write đều biết chain sẽ làm lộ dữ liệu giữa các
chuỗi dùng chung một đối tác. Bản A vì vậy cần một gate server mặc định đóng;
schema expansion và kiểm DB riêng không tự kích hoạt scoped business writes.

Các quyết định triển khai:

- Cycle là scope gốc; Harvest/Lot/Shipment resolve từ quan hệ hiện có. Chỉ
  thêm chainId ở Cycle, không tạo các bản chainId con có thể mâu thuẫn nhau.
  Farm/Organization dùng chung không là ranh giới chain.
- ChainBusinessProfile bắt đầu PREPARING. Chỉ ACTIVE sau khi role/read/write/
  replay/assignment/DB/Web gates của A đạt. Core vẫn phải kiểm quyền server;
  frontend flag không là nguồn quyền. Rollback sau khi có scoped data phải
  hiểu scope, không quay về image chỉ có global role.
- OrganizationBusinessScope ghi mốc cutover bất biến khi profile được bật hoặc
  khi tổ chức nhận membership ACTIVE trong profile đang bật. Thu hồi membership
  và tạm ngừng profile không xóa mốc này. Tạo Cycle sau cutover bắt buộc chainId;
  Cycle legacy chưa resolve scope bị chặn ghi đến khi backfill được review.
- Production assignment được tạo ACCEPTED cùng cycle bởi user FARM_STAFF
  được cấp quyền trong chain, đúng tổ chức sở hữu Farm. Không tạo quyền canh
  tác trên Farm của pháp nhân khác hoặc cấp role chỉ vì có capability.
- Transport assignment trỏ Shipment, retail assignment trỏ Lot. Các quan hệ
  phải resolve cùng chain; bên thực hiện khớp farm/transporter/retailer thực.
  Finalize ShipmentPlan tạo hai assignment này cùng Shipment/trace/outbox.
- ShipmentPlan là nháp điều phối. Owner manager đề xuất; ORG_ADMIN của từng
  tổ chức producer/transporter/retailer xác nhận vai trò của tổ chức mình.
  Cùng một doanh nghiệp có nhiều vai trò vẫn có ba xác nhận phân biệt vai trò,
  gắn nhãn nội bộ; manager không xác nhận thay đối tác.
- Payload mỗi revision bất biến, lưu ở ShipmentPlanRevision. Acceptance FK
  đến đúng revision và role; revise đổi currentRevision nên acceptance cũ
  không đủ finalize. Không xóa acceptance/revision để sửa nháp.
- Finalize khóa quyền các bên rồi chain, plan và Lot theo thứ tự thống nhất;
  kiểm ACTIVE, capability, grant hiện hành của người xác nhận, revision,
  version và quantity. Grant/người xác nhận đã mất quyền thì phải có revision
  mới và xác nhận lại; không hồi sinh ý định cũ khi cấp grant khác.
- Nháp không giữ lượng hàng. Do core chưa split Lot, planned quantity phải là
  toàn bộ availableQuantity hiện tại, không vượt và không khác khi finalize.
  Hai plan cùng Lot có thể tồn tại; chỉ một được finalize thành Shipment.
  Unique Shipment.lotId và trigger bất biến hiện có tiếp tục bảo vệ.
- Shipment đã CREATED không đổi bên/route/quantity hoặc được tạo lại bằng
  cách hủy nháp. StageAssignment đã ACCEPTED không đổi người thực hiện để
  vượt invariant này; recovery sai assignment cần quy trình riêng.
- Legacy cycle chưa tự gán chain. Gói backfill riêng cần manifest được review,
  digest đối chiếu ngoài DB, unresolved register và rehearsal bảo toàn hash.
  EventChainContext bổ sung scope, không sửa payload/hash/proof hoặc nâng
  legacy proof thành bằng chứng Fabric đã xác nhận chainId.

Source SQL hiện hành nằm trong
[migration business/legacy scope](../apps/api/prisma/migrations/20261014000000_hybrid_chain_scope/migration.sql);
binding/route dùng
[migration Fabric binding kế tiếp](../apps/api/prisma/migrations/20261015000000_hybrid_fabric_binding/migration.sql).
Các file draft trùng source đã được gỡ; migration lịch sử giữ nguyên byte.
Nhận định chưa có checksum approval/chưa áp production thuộc candidate 13/10;
release cài mới 14/10 đi qua migration reviews và exact-SHA CI/CD theo
[runbook production](production-runbook.md). Việc promote source vẫn không thay
nghiệm thu runtime, backup/restore, independent pins hoặc rollback floor.


## Phạm vi cài mới 14/10/2026

Migration A giữ byte lịch sử; cleanup append-only từ chối history đã có. Production
không backfill dữ liệu test cũ. New stream cần ACTIVE binding lúc cycle creation.
Quyết định triển khai ở [kế hoạch cài mới](plans/fresh-install-cleanup-2026-10-13.md)
và [ADR-004](adr-004-hybrid-binding-and-signatures.md). Kết quả từng lần chạy ở PR/Issue
hoặc artifact; [lịch sử candidate](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/4d92f02122cbb0b4342372474f466c9146522365/docs/adr-002-hybrid-business-scope.md) không thay nghiệm thu cuối.
