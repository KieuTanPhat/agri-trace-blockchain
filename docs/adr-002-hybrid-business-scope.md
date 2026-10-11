# ADR-002 — Scope nghiệp vụ và kế hoạch vận chuyển, bản A

Ngày: 12/10/2026 (UTC+7). Trạng thái: candidate đang triển khai, chưa kích hoạt.
Theo [plan R1](plans/hybrid-fabric-chain-owner-plan-2026-10-11.md).

Nền quản lý hiện chưa gắn Cycle/Lot/Shipment với chain. Mở quyền core theo
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

Draft SQL tại [hybrid-business-scope.draft.sql](sql/hybrid-business-scope.draft.sql)
chỉ dùng PostgreSQL cách ly. Chưa nằm trong Prisma migrations/CD allowlist;
chưa chạy trên database dev hoặc production. Trước migration chính thức cần
Prisma/Swagger đồng bộ, database guards, mọi API liên quan, backfill/cutover
và fixtures theo ma trận nghiệm thu. Draft chưa là bằng chứng các gate đã đạt.

Kiểm chứng draft lúc 00:33 ngày 12/10/2026 (UTC+7): PostgreSQL 18 trên DB mới
cách ly đã qua 21 assertion SQL, gồm cross-chain/party, quyền người xác nhận,
revise/thu hồi grant không hồi sinh consent, lịch sử bất biến, finalize với
consent hiện hành và unique Shipment/Lot. SQL draft SHA-256:
`882a7e24250fcf36df2a18b6b587decdc3fbf63fd85327be66899ccc930e774a`;
scenario SHA-256: `7eb4f446b09f5c1a376cf36c7d7e52f37b46be588cbf1be2e56a028c1691d7d9`.
Evidence root-only: `/opt/agri-trace-admin/hybrid-scope-draft/882a7e24250fcf36-1791739971441337194`.

Đây là schema scenarios trực tiếp, chưa là core workflow hoặc API concurrency
evidence: chưa có API/Prisma integration, trace/outbox atomicity, backfill,
reviewer independence, multi-capability Farm/Shipment trigger change hoặc Web.
Không tắt trigger/constraint core để tạo fixture. SQL tests ở
[draft-test.sql](sql/hybrid-business-scope.draft-test.sql) dùng dữ liệu tổng hợp.
Chỉ chạy hai file SQL theo thứ tự trên TEST_DATABASE_URL riêng đã áp dụng
migrations hiện hành; tuyệt đối không trỏ đến DB dùng chung.
