# Công việc và nghiệm thu còn mở

Tổng hợp ngày 02/11/2026 khi dọn tài liệu tại `65b01e8e86aa252810dfbc88851ea374d36b4054`. Đây là backlog, không phải
xác nhận runtime, danh sách lỗi vừa tái hiện hay ủy quyền triển khai. Trước khi
nhận một mục, đối chiếu source/Issue/evidence mới nhất; không áp lại quyết định
đã bị business rules hoặc ADR-004 thay thế. Không tự đóng acceptance vì xóa plan.

## Nghiệm thu cần theo dõi

| Mục | Điều kiện giữ lại | Nguồn lịch sử |
| --- | --- | --- |
| Distribution c2 | Chỉ mở đường distribution mới cho DUAL_SIGNED sau integration API → Worker → Fabric thật; kiểm offer/confirm, quantity/custody, payload/epoch và recovery. Shipment c2 không thay nghiệm thu giao thức này. | DIST |
| Fabric nền tảng | Nghiệm thu mạng mới chỉ có AgritraceMSP + OrdererMSP, một channel agritrace; nhiều doanh nghiệp/chuỗi dùng chung hạ tầng, key nghiệp vụ riêng, chuẩn bị binding tự động, outage/restart/restore và migration refusal. Peer tự quản không còn là acceptance hiện hành. | ADR-004, HYBRID |
| Đăng ký/kích hoạt | HTTP duplicate/retry/scope/revoke trước replay; Web/mobile five-step, hồ sơ/năng lực, kích hoạt dùng tạm, mail thực. Kiểm registry/credential/permission confirmed trước khi báo READY; chuỗi riêng và chuỗi tạo thêm đều tự chuẩn bị, không sửa inventory từng doanh nghiệp. Approval UI không chứng minh ledger sẵn sàng. | ONBOARD, SERVICE |
| Mobile thật | Camera, QR, ảnh, journal/harvest, giao nhận, offline/network loss và session trên thiết bị; SMS cần Firebase đúng package/SHA/APK. Fixture, bundle export và browser viewport không đóng mục này. | SERVICE |
| Web nghiệp vụ | Chạy các luồng và biên quantity/scope bằng tài khoản đúng vai trên runtime cách ly: đăng ký, thành viên C1/C2/C3, đối tác/chuỗi, giao nhận, đóng vụ, receipts/chế biến và admin. Giữ original body/key khi mất phản hồi. | SERVICE, MANUAL |
| Chế biến | HTTP/DB guard trên DB cách ly: receipts chứng từ, reservation concurrency, bổ sung/hủy/complete/replay, conversion/mass balance, corrections, nguồn ngoài không có vụ và privacy lineage; UI và Fabric thật nghiệm thu riêng. | PROCESSING, ADMIN |
| Seed production | Công cụ seed local không cấp quyền ghi VPS. Nếu có yêu cầu mới: adapter xác minh target/generation, shared platform template, tách demo identities, rehearsal ledger thật, ảnh/logo/privacy và checkpoint recovery; không nhập local hash/proof/journal. Kiểm dependency advisory/CI hiện tại trước khi dùng kế hoạch phát hành cũ. | FRUIT |

## Khoảng trống cũ cần đối chiếu trước khi sửa

Các mục dưới được giữ vì plan cũ chưa có kết luận cuối. Chưa tái hiện ở HEAD
hiện tại; không coi mô tả lỗi cũ là implementation hiện hành.

| Mục | Việc cần đối chiếu | Nguồn lịch sử |
| --- | --- | --- |
| Consumer report | Tính nguyên tử của rate limit theo sourceHash; secret HMAC bắt buộc ở production; không dùng fallback yếu. | ADMIN |
| Recall graph | Cờ truncated với đồ thị chế biến hình kim cương và giới hạn traversal. | ADMIN |
| Catalog/quotation | catalogDigest của danh mục và báo giá có cùng scope khách hàng. | ADMIN |
| SQL state guards | Guard chuyển trạng thái của trace_qr_block, platform_setting, subscription, consumer_report và support_ticket. | ADMIN |
| Processing assignment | completeProduct/materials/complete kiểm site assignment cấp 2/3 và capability bị revoke giữa chừng. | ADMIN |
| Admin và dịch vụ | Khả năng bổ sung PROCESSOR sau đăng ký, tạm ngưng chuỗi phía admin, tính chênh lệch khi đổi gói đã trả và email nhắc gia hạn. Thu tiền vẫn hoãn mặc định; không dựng subscription giả để vượt kiểm. | ADMIN, SERVICE |
| Hiệu năng | Đo lại danh sách vụ, query quyền theo tập, chi tiết danh bạ và processing trên dataset đại diện; kiểm output/scope/revoke tương đương và pool/concurrency. Số đo cũ trên DB nhỏ không là SLA hoặc lý do thêm index hàng loạt. | PROFILE |
| Hạn khóa | Chốt nguồn X.509/Worker và policy Ed25519 riêng; không backfill hạn giả hoặc sửa chữ ký/proof cũ. Đối soát command đã gửi phải tiếp tục được. | GOVERNANCE |

## Metadata Ledger cần đối soát

Baseline lịch sử có 143 route; source hiện hành đã bỏ hai route kết nối peer doanh nghiệp nên inventory/matrix còn 141 mục. Vẫn còn lệch metadata có trước thay đổi topology, ví dụ trỏ tới
`apps/web/src/app/admin/approvals/[id]/page.tsx`, trong khi path đó không tồn tại
ở revision nguồn `65b01e8`. Đây là lệch metadata đã đối chiếu, khác với các lỗi
chưa tái hiện ở bảng trên. Đối soát toàn bộ route/action đã retire hoặc bổ sung
với source hiện hành trước khi chốt snapshot, provenance và assertion số lượng. Việc bỏ hai route peer không đóng các lệch cũ ở approvals/ownership; không khôi phục chúng chỉ để khớp baseline.
Không tạo lại maker–checker hoặc bỏ assertion để làm test xanh.

Nguồn: [test route/provenance](../../scripts/ledger/audit-baseline.test.mjs),
[matrix](../../apps/web/ledger-migration.matrix.json) và
[inventory](../superpowers/specs/2026-10-22-ledger-ui-migration.inventory.json).

## Đề xuất cần quyết định sản phẩm riêng

- Có chuyển `/iot-simulator` thành công cụ dev riêng; kiểm caller/test trước khi gỡ.
- Có bỏ phần hợp đồng/thanh toán mô phỏng; phải giữ lịch sử và đường activation.
- Có tách SYSTEM_ACTOR/IOT_DEVICE khỏi danh mục vai đăng nhập; actor evidence và
  kiểm proof lịch sử vẫn cần hỗ trợ. Không xóa actor type chỉ để rút gọn UI.
- Thanh toán thật, đối soát, phí/quota, qualified contract signatures, serial chống
  giả và mở rộng ngoài CROP cần phạm vi/acceptance riêng. Không khôi phục maker–checker,
  luồng sáu bước, A/c1, UAT hoặc domain đã retire từ một draft cũ.

Banner thông báo đã được mô tả trong business rules; không tiếp tục coi đề xuất
banner cũ là thiếu implementation. Banner độc lập với writer hold của controller.

## Nguồn có thể tra lại qua Git

Các liên kết pin revision trước cleanup, không phải tài liệu cần đọc mặc định.
Ma trận HYB-AC ở [CI guide](../ci.md#ma-trận-nghiệm-thu-hybrid); gate release ở
[production runbook](../production-runbook.md#cổng-nghiệm-thu-phát-hành).

- DIST: [tiến độ integration distribution](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/agritrace-business-functions-implementation.md).
- HYBRID: [HYB-AC và giới hạn pilot](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/hybrid-fabric-chain-owner-plan-2026-10-11.md).
- ONBOARD: [acceptance onboarding](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/enterprise-onboarding.md).
- SERVICE: [checklist phần đầu; draft cuối đã cũ](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/enterprise-traceability-service-model-2026-10-27.md).
- PROCESSING: [receipt/lifecycle và acceptance](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/processing-receipts-lifecycle-2026-10-27.md).
- ADMIN: [khác plan và việc để sau](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/admin-console-processor-plan-2026-10-19.md).
- FRUIT: [dataset và các gate chưa đóng](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/fruit-dataset-2026-10-26.md).
- MANUAL: [kịch bản cũ; không phải kết quả nghiệm thu](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/testing/manual-web-mobile.md).
- PROFILE: [baseline query trên working tree cũ](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/testing/query-profile-2026-10-30.md).
- GOVERNANCE: [đề xuất loại bỏ và hạn khóa](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/platform-governance.md).
- PROPOSAL: [backlog/acceptance B01–B17, không áp phụ lục UI cũ](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/agritrace-business-functions-proposal.md).
- SEED: [quyết định dataset local ban đầu](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/plans/full-current-database-seed-2026-10-20.md).
- LEDGER: [quyết định migration UI](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/65b01e8e86aa252810dfbc88851ea374d36b4054/docs/superpowers/specs/2026-10-22-ledger-ui-migration-design.md).
