# Quyết định phục hồi và tiếp tục A → B → C

Ngày: 12/10/2026, giờ Việt Nam. Đây là quyết định triển khai trong chat hiện tại,
theo quyền quyết định người dùng vừa giao. Các tiêu chí của
[kế hoạch đã review](hybrid-fabric-chain-owner-plan-2026-10-11.md) vẫn áp dụng.
Không tạo agent/chat khác. Không sửa checkout main của người dùng.

## 1. Quyết định và cơ sở

Chọn **sửa có cấu trúc các ranh giới quyền, legacy và công cụ kiểm thử**, sau đó
hoàn thành lần lượt A, B, C. Giữ mô hình ProductionCycle → HarvestEvent → Lot →
Shipment, transactional outbox, journal, hash và proof đã tồn tại.

Lý do: lỗi hiện có đã phân loại được và có phạm vi cụ thể. Migration metadata
không khớp DB; writer mới thiếu version lưu trên row; đường legacy chưa xét
cutover của đối tác; hai fixture vi phạm constraint thật. Viết lại toàn bộ vẫn
phải giải quyết những ràng buộc này, đồng thời tạo thêm rủi ro chuyển lịch sử và
khác biệt API. Chưa có bằng chứng cho thấy nền NestJS/Prisma/Next.js/outbox cần
thay toàn bộ.

| Phương án               | Cách làm                                                                                    | Chi phí và rủi ro                                                                 | Quyết định                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Sửa từng lỗi riêng      | Vá service hoặc test ngay nơi thất bại                                                      | Nhanh cho lỗi cục bộ; dễ bỏ sót đường đọc/ghi/replay khác                         | Chỉ dùng cho lỗi xác định nhỏ, kèm kiểm tra invariant liên quan                                |
| Refactor có cấu trúc    | Policy chung; pin/provenance/bridge riêng; fixture theo vai trò; runner gắn SHA và evidence | Phải rà mọi entry point; bảo toàn lịch sử thuận lợi, kiểm được từng bước          | **Chọn làm phương án chính**                                                                   |
| Phân hệ vNext song hành | Bản API/schema mới, adapter đọc lịch sử cũ, cutover từng aggregate                          | Hai protocol/readers và đồng bộ quyền phải cùng được vận hành; tăng rehearsal     | Dùng cho B/C khi protocol mới thực sự cần, mở rộng theo version                                |
| Xây lại toàn bộ         | Schema/app mới, import lịch sử, chuyển client/worker/ledger                                 | Chi phí lớn nhất; vẫn cần reader/proof/journal cũ, restore và compatible rollback | Chỉ xét lại nếu bằng chứng cho thấy nền hiện tại không đáp ứng invariant hoặc tải sau refactor |

Không ước lượng tiến độ bằng số test pass. Các khoảng ngày công trong kế hoạch
gốc là sizing của thiết kế ba người, chưa phải thời hạn cam kết cho chat này.
Trong lượt triển khai này dùng thứ tự phụ thuộc và bằng chứng để quyết định bước
tiếp theo. Nếu phải đổi nền, viết ADR mới chỉ rõ lỗi không thể khắc phục, phép
đo, chi phí adapter/di chuyển và phương án quay lại trước khi thay.

## 2. Kiểm tra lại chính các bài test

| Failure đã thấy                                                        | Phân loại                         | Hành động và bằng chứng cần giữ                                                                               |
| ---------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Prisma diff định drop sensor unique guards và đổi FK/default/predicate | Lỗi metadata thật                 | Khớp schema với applied DB; diff chỉ đọc; catalog xác nhận đủ sáu unique guards                               |
| Trace hash v2 nhưng row nhận default legacy                            | Lỗi writer thật                   | Ghi schema/canonicalization version rõ khi tạo event mới; kiểm hash từ dữ liệu thực lưu; giữ nguyên event cũ  |
| Partner cutover nhưng legacy cycle vẫn đọc/ghi được                    | Khoảng trống policy/DB thật       | Xét toàn bộ party của root và actor hiện hành; revoke/suspend không mở lại legacy; negative direct SQL và API |
| PROCESSING test đặt expiresAt trước createdAt                          | Fixture sai                       | Đặt createdAt trong quá khứ, expiresAt sau createdAt nhưng trước hiện tại; giữ chk_idempotency_expiry         |
| Test thu hồi membership của chính owner                                | Fixture sai                       | Owner riêng có membership ACTIVE; revoke partner; thêm tình huống owner riêng thay vì nới owner guard         |
| SQL test chỉ xét thông điệp exception                                  | Assertion có thể nhạy với câu chữ | Giữ contract cũ hiện hành; bước tiếp theo kiểm SQLSTATE, trạng thái DB và không có mutation sau rejection     |
| Lệnh dùng sai đường dẫn Nest/Vitest hoặc generate trước build kết thúc | Runner sai                        | Dùng runtime/path đúng, chờ exit code trước dependency; failure không được tính là product pass               |
| Job legacy cũ đạt 110/112, nhận 400 thay vì 403                        | Failure lịch sử                   | Giữ logs; đối chiếu current contract và rerun toàn bộ cùng SHA, không sửa expectation để đủ con số            |

Quy tắc review test: căn cứ approved invariant và source/schema/Swagger hiện
hành; kiểm fixture có đạt tiền điều kiện; quan sát DB/journal/outbox thực; thêm
assertion có thể bắt lỗi đã thấy. Không xóa test, bỏ assertion, nới throttle,
timeout, coverage hoặc sửa hash/proof để tạo kết quả xanh. Không thêm test chỉ
sao chép implementation. Full suite chạy sau thay đổi behavior; chỉ lặp lại khi
có sửa code, failure hoặc nghi vấn còn mở.

Runner giữ SHA, checksum SQL, số test thực, log thất bại và xác nhận cleanup.
Phải đọc status và terminal trước khi start. Database/container/network riêng,
resource quota, không nối candidate hoặc draft vào DB dev/production dùng chung.

## 3. Các khối công việc và cổng chuyển bước

| Khối                       | Công việc cụ thể                                                                                                            | Phụ thuộc                     | Điều kiện ra                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 — Alignment và policy   | Schema metadata; current grant/session dưới khóa; root/partner cutover; SQL filters; capability/reviewer/custody/quantity   | Baseline và applied migration | Zero full diff; unique/FK/check giữ nguyên; unit/SQL/DB/HTTP và legacy regression cùng SHA                                                        |
| R2 — Controlled legacy     | Inventory/manifest; pin ngoài DB; participant + owner review; apply root; immutable checkpoint; replay bridge versioned     | R1, PREPARING                 | Multi-harvest/shipment/event/QR/outbox/proof giữ nguyên; interruption/resume/concurrent apply không duplicate; uncertain PROCESSING không execute |
| R3 — Web A                 | Context/work queue; consent từng stage; current status; revoke/account/tab/cache; retry cùng key và payload                 | R1–R2, generated Swagger      | Browser desktop/mobile thực; stale response không hiển thị, không mất reconciliation; private API ngoài SW cache                                  |
| R4 — Migration/rehearsal A | Promote SQL đã kiểm; reviewed checksum; DB mới + sanitized copy; backup/restore; compatible app rollback                    | R1–R3                         | Hai rehearsal có receipt; mapping/hash/QR/journal đúng; image hiểu scope/pin đọc được; rollback không khôi phục quyền legacy                      |
| R5 — Release A             | PR/CI exact SHA; build images; dev canary; pause/cutover/resume; observation và proof                                       | R4, release policy hiện hành  | Cổng A trong plan đạt; đúng image/SHA; không dead-letter/leak/custody sai; window đủ quan sát và giữ mọi failure                                  |
| R6 — Protocol B/C          | Binding identity, namespace, create-key, rotation/revocation, commitments, version readers, governance, test vectors        | A và ADR HYB-08               | Protocol/vectors được tính và kiểm trên implementation; không dùng PostgreSQL như authority giả trên chaincode                                    |
| R7 — Hybrid Fabric B       | Binding registry/router; route lịch sử/attempt; permission sync và hold/barrier; hosted + self-managed join                 | R6                            | Real Fabric cách ly commit/query/duplicate/rotation/offboarding/restore; đúng destination và logical writer authority                             |
| R8 — Chữ ký và bàn giao C  | Signing key/assertion/intent; verify commitment; offer/confirm/reject/expire/cancel; custody đổi đúng thời điểm; UI/readers | R6–R7                         | Signature-event binding, hai party, same-org label, replay/race/timeout/outage/mixed version đạt                                                  |
| R9 — Nghiệm thu cuối       | Chạy lại ma trận AC theo bản; load/privacy/restore/canary; runbook và handoff                                               | Từng release                  | Evidence cùng SHA và đúng môi trường; phần authority doanh nghiệp thật ghi rõ chưa nghiệm thu nếu chưa có đối tác                                 |

Thực hiện một khối đến khi đạt hoặc chỉ còn gate bên ngoài; khi một gate phải
chờ, tiếp tục phần độc lập có thể kiểm trong môi trường cách ly. Không dừng sau
compile/test/monitor checkpoint. Không coi số giờ chưa quan sát là healthy.

## 4. Bước đang triển khai ngay

1. Hoàn tất fixture revoke partner, DB guard của unresolved legacy cycle và UI
   trạng thái/đường vào consent. Build Nest rồi sinh contract; commit đúng file
   đã sửa, giữ hai tài liệu dirty có sẵn và AGENTS.md untracked của người dùng.
2. Upload archive đúng SHA vào vùng source cách ly; chạy 67 policy/HTTP/DB test,
   30 SQL assertions, 130 API unit và 112 legacy E2E. Đây là số suite hiện tại,
   không phải chỉ tiêu nghiệm thu hoặc lý do thay expectation.
3. Nếu có failure: kiểm fixture/tiền điều kiện rồi source/DB contract; giữ log,
   sửa đúng nguyên nhân và chạy lại nhóm bị ảnh hưởng trước full gate SHA mới.
4. Bổ sung bằng chứng legacy apply có lịch sử thật, consent nhiều bên/cùng org,
   resume/concurrency và HTTP JWT thật. Rà bridge cho compliance/device và
   command creation; trường hợp chưa giải được giữ fail closed có reconciliation.
5. Kiểm Web reconciliation và browser/mobile trên app + DB riêng. Sau đó mới
   promote official migration/checksum và rehearsal. Tiếp tục B/C theo R6–R9.

## 5. Giới hạn vận hành và đánh giá tiến độ

Dev hiện vẫn chạy `dev-2d08e8ec003157de45a53ddd9b9df537e589acd5`, Fabric
`agritrace-dev`, sequence 1. Candidate ở worktree chưa là release. Production
agritrace.dev chỉ đọc. API không có signer; worker technical signer không chứng
minh authority độc lập của doanh nghiệp.

Không reset ledger/identity, sửa dữ liệu cũ hoặc applied migration. Không deploy
candidate khi schema/checksum/compatibility gate chưa đủ. Pin chỉ chứa manifest
metadata, không private key/token. Log/receipt không chứa env secrets hoặc CA
arguments. Tối đa hai full auth smoke trong 60 giây; delivery đang chạy thì defer
stable-health assessment sau khi kiểm CD/journal/locks.

Checkpoint ban đầu khoảng 35% tổng, nền 85%, A 60%, B 10%, C 0%. Chưa nâng mức
nghiệm thu ở tài liệu này: các commit apply/bridge/consent mới vẫn cần full DB
regression, rehearsal, browser và release. Mỗi mốc lớn ghi đầu ra đã đạt, SHA,
evidence và gate thiếu. Lịch heartbeat hiện có tiếp tục trong chat này; chỉ báo
mốc lớn/lỗi/hoàn thành/cần người dùng xử lý, không tạo lịch trùng.
