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

Lượt bổ sung lúc 00:47 ngày 12/10 đã qua 30 assertion, thêm late membership,
marker bất biến, bỏ chainId/thu hồi/tạm ngừng không khôi phục đường ghi legacy,
và chặn ghi root legacy chưa mapping. Draft digest hiện tại:
`49e53ed42c56d69ddc1d26a7cc2f4e78ae28e92aa6a6f79f011cf971254b99e6`;
scenario digest: `26e6223806b173c7fa5ad11d38fda7e7f0104d9b14335de846af92e0a99239c3`.
Evidence: `/opt/agri-trace-admin/hybrid-scope-draft/49e53ed42c56d69d-1791740828300966564`.
Lượt trước phát hiện trigger dùng chung đọc trường `state` của membership;
đã tách nhánh theo bảng rồi chạy hồi quy. Thư mục lỗi và các evidence trước
được giữ. Không sửa database ứng dụng để làm bài kiểm tra đạt.

Prisma candidate đã có các models/relations tương ứng; generate 7.10.0 và
typecheck API đạt. Chưa chạy app bằng models mới trên database dùng chung:
migrations hiện hành chưa chứa expansion, nên chỉ dùng DB cách ly đã áp dụng
draft. API/read/write/replay/concurrency, Swagger/Web và
rehearsal toàn bộ còn là gate trước promotion/rollout.

Candidate `be9d6e850faa631a73dfd512d111d5aa80dee046` đã qua 30 SQL assertions,
ORM/SQL alignment (deferred revision create và consent relations), typecheck
và 112 E2E legacy trên PostgreSQL 18 cách ly. Kết quả terminal hoàn tất
`2026-10-11T17:59:28Z` tại
`/opt/agri-trace-admin/hybrid-scope-draft/49e53ed42c56d69d-1791741265281260392`.
SSH điều khiển timeout 600 giây; đã phục hồi kết quả từ result.json và log,
xác nhận không còn container/network test. Không tính timeout riêng là Passed
hoặc xóa evidence các lần lỗi trước. Đây chưa là scoped API workflow acceptance.

Candidate policy dùng scope fingerprint riêng `chain-business-v1`, chỉ gồm
grant/capability/membership/profile và assignment thực sự của command. Role
khác được cấp không làm thay scope hợp lệ; revoke và grant mới không hồi sinh
scope cũ. Role dùng ghi trace sẽ được server suy ra, giữ nguyên actor đã xác
thực để kiểm JWT/session. Policy riêng chưa nối vào core; không dùng nó thay
SQL read filters, lifecycle/quantity/custody hoặc correction-chain self-review.

Chạy policy tests riêng sau migrations hiện hành, SQL draft và SQL fixtures:
`HYBRID_DRAFT_TESTS=1 npm run test:hybrid:db --workspace apps/api`, với
`TEST_DATABASE_URL` trỏ DB mới dùng riêng. Không dùng lệnh này trên dev/prod.
Suite chuẩn không tự apply draft hoặc chạy các tests này. Config riêng chặn
thiếu opt-in/database URL; fixtures cũng phải khớp trước mutation đầu tiên.

Policy candidate `b1c8fd7` đã qua 19 PostgreSQL tests, 30 SQL assertions và ORM
alignment; gồm quan sát lock wait thực khi revoke chờ command, rồi quyền cũ
bị chặn. Evidence:
`/opt/agri-trace-admin/hybrid-scope-draft/49e53ed42c56d69d-1791769553219122076`.
Read-scope candidate bổ sung SQL predicates cho Cycle/Lot/Shipment: cùng Farm
không đủ quyền trên chain khác; Cycle cha không tự mở sibling Lots; owner chỉ
có projection riêng. Kiểm list/direct ID/count/nested relation đang chuẩn bị,
chưa nối bộ lọc vào endpoint hoặc tính HYB-AC-03 Passed.

Commands nháp ShipmentPlan đang chuẩn bị trong transaction: create/revise,
accept theo party/revision/digest và cancel, có audit cùng commit. Khóa toàn
bộ tổ chức liên quan theo thứ tự trước chain/plan/Lot. Draft không giữ stock;
quantity/unit phải khớp toàn bộ lượng khả dụng; không tạo Shipment, trace hoặc
outbox vật lý. Finalize cùng Shipment/assignments/trace/outbox, command replay
integration, API/Swagger/Web và capability core guards còn phải triển khai.
Các tests rollback chủ động cũng ép deferred constraints kiểm trước rollback;
không lấy transaction rollback làm bằng chứng deferred FK đã hợp lệ khi commit.
