# Bối cảnh dự án hiện hành

Cập nhật tài liệu ngày 02/11/2026. Source, Prisma/SQL guard và Swagger sinh từ
NestJS xác định implementation. Issue/acceptance đã duyệt xác định mục tiêu;
evidence đúng SHA, môi trường và controller revision xác định nghiệm thu.
Tài liệu này không xác nhận phiên bản đang chạy trên VPS.

## Đọc theo tác vụ

Đọc README gốc và tài liệu này khi bắt đầu thay đổi hành vi, sau đó chỉ mở phần
liên quan. Tìm code bằng CodeGraph khi checkout có index. Không đọc toàn bộ docs,
OpenAPI JSON hoặc inventory Ledger để lấy bối cảnh chung.

| Công việc | Tài liệu cần tra |
| --- | --- |
| Quyền, quantity/custody, trạng thái nghiệp vụ | [Business rules](core-business-rules.md) |
| API/DTO và consumer | README phần API contract; source NestJS và `docs/openapi/` |
| UI, auth/recovery, QR/camera/PWA, mobile | [Frontend](frontend.md), [harvest recovery](harvest-recovery.md) khi liên quan |
| Transaction/outbox/Worker | [ADR-001](adr-001-modular-monolith-dedicated-worker.md) |
| Tư cách tham gia, chủ chuỗi, đầu vào liên chuỗi | [ADR-005](adr-005-chain-owner-service-model.md) |
| Cảm biến thửa, GPS xe, niêm phong hành trình, thiết bị ảo | [ADR-006](adr-006-iot-plot-vehicle-tracking.md) |
| Binding, ledger permission, chữ ký c2 | [ADR-004](adr-004-hybrid-binding-and-signatures.md), phần cần dùng của [Hybrid runbook](hybrid-fabric-runbook.md) |
| Migration và restore | [Database runbook](database-migration-runbook.md) |
| CI, ma trận HYB-AC và kiểm chứng | [CI guide](ci.md) |
| Release/controller/rollback | [Production runbook](production-runbook.md) |
| Công việc hoặc acceptance còn mở | [Backlog](plans/backlog.md), rồi Issue liên quan |
| Skill/reviewer hoặc nhánh Git | [Agent workflow](agent-workflow.md), [branch naming](branch-naming.md) |

## Cấu trúc và runtime

- `apps/web`: Next.js PWA cho công khai, doanh nghiệp và quản trị.
- `apps/mobile`: Expo/React Native; consumer xem danh mục/QR, nhân viên làm việc
  theo quyền và vụ được giao. Bundle export không chứng minh APK/SMS/camera thật.
- `apps/api`: NestJS API và entrypoint Worker riêng, dùng chung PostgreSQL/Prisma.
- `blockchain/gateway`, `blockchain/chaincode`: Fabric Gateway và smart contract.
- `blockchain/network/hybrid`: mạng pilot và harness Fabric cách ly.
- `deploy/ci`, `deploy/cd`, `deploy/edge`: rehearsal, controller/CD và ingress.

Node/npm theo `.node-version` và `package.json`; local Compose/CI dùng PostgreSQL
18 đã pin. Không suy ra runtime của DB đang có từ cấu hình mới; nâng major phải
theo database runbook. Docker local dùng ledger mô phỏng qua binding cùng đường
nghiệp vụ, không phải bằng chứng commit Fabric.

## Mô hình nghiệp vụ

Luồng sản xuất là `ProductionCycle → HarvestEvent → Lot → Shipment`. Một vụ có
nhiều đợt thu hoạch; mỗi đợt tạo Lot/QR, quantity movement, sensor window,
trace/outbox trong cùng transaction. Lô chọn đường Shipment hoặc holdings và
distribution nhiều dòng/nhiều chặng; không dùng đồng thời hai đường.

Distribution giữ nguyên Lot nguồn khi chia lượng. Chế biến là nghiệp vụ khác:
`ProcessingRun` liên kết nguyên liệu và lô thành phẩm, giữ lịch sử lineage/cân
bằng. Phiếu nguyên liệu `AGRITRACE` theo lượng giao nhận thực tế; phiếu `EXTERNAL`
là nguồn tự khai có chứng từ. Mẻ chỉ dùng nguồn ngoài giữ chain/binding lúc lập,
không dựng vụ sản xuất giả. Chi tiết vòng đời, giữ chỗ và corrections ở business rules.

Tài khoản/session, tổ chức, capability, membership, grant và accepted assignment
cùng quyết định quyền. Kiểm quyền dưới khóa và trước replay; Admin/Auditor không
ghi nghiệp vụ thay doanh nghiệp. Read/list/count/proof dùng cùng scope.

Domain write, command journal, trace/outbox, quyền, optimistic version và
idempotency commit cùng transaction. Unknown outcome giữ body/key/signature gốc
để đối soát, không dùng key mới. Không sửa hash, sự kiện hay proof để làm khớp.

ShipmentPlan giữ revision/consent bất biến. Consent chụp grant, membership epoch
và capability revision; revoke/rejoin/regrant làm consent cũ mất hiệu lực.
Finalize kiểm lại snapshot; hai plan tranh một Lot chỉ tạo được một Shipment.

Quantity dùng decimal và movement/custody append-only. Recall/expiry/FAILED không
tự đưa hàng về chủ cũ. Mỗi thu hoạch chốt sensor window; dữ liệu đến muộn không
được dùng để tính lại hash. Các mốc thời gian nghiệp vụ theo Asia/Ho_Chi_Minh.

Vai Kiểm định (`AUDITOR`, gộp vai reviewer cũ từ 04/11/2026) thuộc tổ chức AUDITOR,
chỉ ghi kiểm định trên Farm được phân công và không tự review submission. Grant
`COMPLIANCE_REVIEWER` trên chuỗi (`ScopedRole`, Fabric) giữ nguyên mã cũ.
QR công khai che dữ liệu riêng tư, hiện độc lập cảnh báo thu hồi, hết hạn, cảm
biến và integrity. `VERIFIED` mô tả bằng chứng, không chứng nhận chất lượng.

## Doanh nghiệp và quản trị

Đăng ký hiện có năm bước, hồ sơ pháp lý theo loại, tài liệu riêng tư, địa chỉ
theo catalog và OTP email; mật khẩu tạm buộc đổi. Admission mặc định đóng bằng
`ENTERPRISE_ONBOARDING_ENABLED=false`; đăng ký không cấp quyền ghi truy xuất.

Mặc định hoãn thu tiền (`ENTERPRISE_PAYMENTS_ENABLED=false`): admin duyệt hồ sơ
và từng capability, rồi kích hoạt dùng tạm bằng command riêng. Không tạo invoice,
paid order hoặc subscription giả. Khi chủ động bật thu tiền, [SePay](sepay.md)
xác thực callback theo hóa đơn, giữ receipt chống trùng và tự kích hoạt sau khi
hồ sơ/năng lực đã được duyệt. Test mode ghi `SIMULATION`/`PAID_SIMULATED`, Live
ghi `SEPAY`/`PAID`; provider acceptance là cổng riêng. Worker nhận mail outbox
sau commit; hợp đồng mới merge từ mẫu PDF tĩnh, lưu đúng bytes/hash từ xem trước đến xác nhận và mail đính kèm. Có popup QR trên bản PDF và lịch sử giao dịch riêng tư theo chủ hồ sơ. Hợp đồng cũ giữ nguyên. Mẫu hiện dùng kiểm thử, chưa có chữ ký hợp đồng có chứng thư.

Thành viên hai cấp (chủ doanh nghiệp cấp 1, nhân viên cấp 3 trực thuộc chủ; không còn cấp quản lý 2), nhóm quyền riêng, đối tác, danh mục và cơ sở không thay
chain membership/capability/assignment. Chủ doanh nghiệp giữ vai nghiệp vụ theo
loại tổ chức và là người duy nhất quản trị thành viên/nhóm quyền; nhân viên cấp 3 mang vai Nhân viên doanh nghiệp
(`ENTERPRISE_STAFF`), hành động theo vai nghiệp vụ suy từ `organization.type`, với
quyền chi tiết lấy từ nhóm quyền doanh nghiệp. Giao nhận có bốn transport mode; thời
điểm ký/chuyển custody phụ thuộc mode. Đối chiếu business rules trước khi sửa.
Đường distribution mới chưa mở trên DUAL_SIGNED nếu chưa có integration c2 và
nghiệm thu Fabric riêng; không suy ra từ Shipment đã ký hiện hành.

Worker gửi OTP/review/contract mail. Mailpit và provider fixture chỉ chứng minh
local delivery; SMTP hoặc SMS thật cần nghiệm thu riêng theo cấu hình thực.

Quản trị có audit nối hash append-only, MFA TOTP, kiểm soát tài khoản/tổ chức,
vận hành chỉ đọc, hồ sơ sự cố, diễn tập thu hồi và hộp thư quyền dữ liệu mã hóa.
Maker–checker đã gỡ; `platform_approval` chỉ giữ lịch sử. Nền tảng chỉ còn một
vai Admin (`SYSTEM_ADMIN`, gộp các vai hẹp cũ từ 04/11/2026), không ghi nghiệp vụ.

Banner thông báo độc lập với khóa ghi của controller. UI không có quyền mở ghi,
phát lại outbox, đổi binding hay chạy restore. Hạn Ed25519/vân tay chứng thư chưa
được theo dõi không được suy ra từ trạng thái ACTIVE.

## Fabric và chữ ký

Chỉ hỗ trợ B (envelope 4.0.0 / private hash 3.0.0) và C c2 (6.0.0 / 5.0.0,
`agritrace-intent/2`). A/c1 đã gỡ cả reader/writer; migration retirement từ chối
DB còn dữ liệu đó. Giữ byte migration lịch sử, không thêm fallback A.

Mỗi event chụp binding logic bất biến và permission epoch. Registry ledger
xác nhận quyền trước khi mở ghi; revoke có drain/barrier hoặc emergency hold.
Connection config không đổi đích của backlog. Worker ghi attempt/txId trước
traffic, đối soát hoặc fence kết quả chưa rõ, giữ circuit breaker theo binding.

c2 ràng chữ ký với actor/chain/event/entity, payload, nonce, expiry và versions.
API/SQL/Worker kiểm nội dung nghiệp vụ thật khớp payload đã ký; chaincode kiểm
commitment và chữ ký độc lập. DUAL_SIGNED chỉ đổi custody sau offer/confirm khớp.
Lỗi signer/registry/peer/orderer không cho phép tự hạ xuống unsigned.

API không nhận signing key. Worker chỉ có technical identity; owner/admin key
thuộc operator, khóa tổ chức thuộc bên ký. Source dùng `AgritraceMSP` và `OrdererMSP`, một channel `agritrace`. Không cấp MSP hoặc peer riêng cho doanh nghiệp. Worker tự chuẩn bị binding `SERVICE` cho cả chuỗi riêng và chuỗi tạo thêm, chỉ mở quyền ghi sau xác nhận ledger. Một VPS/orderer không chứng minh HA; care/harvest giữ xác thực hiện hành. Nghiệm thu topology mới trên VPS chưa được thực hiện.

## Vận hành và nghiệm thu

`main` là nguồn production duy nhất. Dev deployment, `nongtrace.site` và UAT
schema 2 đã retire. Controller hiện hành dùng config schema 3, manifest format 2,
release `prod-*`, ghép Compose app + hybrid. Trước rollout phải xác minh revision
controller đã cài, digest, image, migration catalog và state thực tế.

Fresh install dùng DB/network riêng, không nhập account/history/proof/QR cũ.
Backup nhất quán DB/ledger/CA/MSP/config/images, kiểm checksum và restore cách ly
là quy trình mặc định. Reinstall bỏ dữ liệu chỉ áp dụng khi có ủy quyền rõ cho
đúng target/generation và receipt theo runbook; quyết định cũ không cấp quyền mới.

Sau SQL Hybrid, compatibility floor chặn image cũ. Khi lỗi, giữ writers đóng,
journal/attempts và original command; resume cùng candidate hoặc fix-forward.
Không restore riêng DB sau ledger commit. App rollback và data restore khác nhau.

CI/source completion, local DB/browser, real Fabric, isolated restore và VPS
smoke là các kết luận riêng. Ghi evidence đúng SHA/migration/network/controller;
không biến mock, fixture, skipped test hoặc receipt cũ thành acceptance hiện tại.
Xem ma trận HYB-AC trong CI và gate phát hành trong production runbook.

## Tài liệu và phối hợp

Skill nguồn ở `.agents/skills`; `.claude/skills` là bản sinh. Đổi nguồn thì chạy
`npm run agents:sync`, `npm run agents:check`, `npm run test:agents`. Mỗi checkout
một writer; không tự mở rộng task thành merge/publish/deploy hay sửa dữ liệu.

Plan đã hoàn tất, đặc tả Batch và báo cáo từng phiên được tra qua Git. Backlog chỉ
giữ việc còn mở và nguồn lịch sử; không cần đọc các bản cũ nếu task không liên quan.
Kết quả từng lần chạy ở PR/Issue hoặc artifact local, không thêm báo cáo docs.
Giữ secrets, credentials, evidence, memory và worktree ngoài commit.
