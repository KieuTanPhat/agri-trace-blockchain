# Kế hoạch hoàn thành core Agri Trace — 10/10/2026

Trạng thái tài liệu: bản v3, đã khóa sau 5 vòng rà soát và chỉnh sửa. Kiểm tính nhất quán đạt 34/34 task, 40/40 nhóm AC; không phát hiện task thiếu/trùng, link issue sai hoặc chu trình phụ thuộc. Đây là kế hoạch triển khai; các bước và kiểm thử ứng dụng bên dưới chưa được thực hiện trong lượt lập kế hoạch này.

## 1. Đích bàn giao và căn cứ

**Đích đã chốt:** nghiệm thu toàn bộ core trên UAT nongtrace.site và bàn giao release candidate (RC). Production có cổng phê duyệt triển khai riêng. Mốc mục tiêu: 30/10/2026, múi giờ Asia/Ho_Chi_Minh.

- Baseline source đã xác minh: origin/main tại 9e228b7c236d9527727b496849d07ca2d160d04f. Checkout hiện tại: 8bbf009c0cd43514ba07a5daa6407d697d537f9a, chậm một commit và có thay đổi của người dùng.
- PR [#71](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/71) đã merge: refresh cookie HttpOnly, session family, revoke đồng thời, đổi tài khoản/nhiều tab và Swagger auth. AGT-006 cần đối soát evidence và regression trên baseline mới.
- Đã đọc lại 34 issue AGT-001–034, source liên quan, schema/migrations, CI và CD runbook. Issue đóng không tự đồng nghĩa Accepted; 5 issue đóng vẫn phải đối soát tiêu chí và signoff.
- Nguồn hành vi: source, Prisma và Swagger sinh từ NestJS. Nguồn nghiệm thu/owner: từng AGT issue. README và PROJECT_CONTEXT có mục đang cũ, phải cập nhật theo phần đã nghiệm thu.
- Giữ ProductionCycle → HarvestEvent → Lot → Shipment; một cycle nhiều harvest, mỗi harvest đúng một Lot/QR; mỗi Lot tối đa một Shipment.
- GPS realtime, split/merge, marketplace, thanh toán, bán từng phần, return logistics và scheduler hết hạn tiếp tục Deferred.
- Các ngày dưới đây là lịch mục tiêu theo phụ thuộc, chưa phải cam kết năng lực của từng người. Không bỏ cổng nghiệm thu để giữ ngày.

## 2. Quyết định đã khóa và mặc định kỹ thuật

### 2.1. Sáu lựa chọn đã được người dùng xác nhận

| Nội dung | Quy tắc triển khai |
| --- | --- |
| Mức bàn giao | UAT + RC; production được phê duyệt riêng. |
| Compliance | Thêm COMPLIANCE_REVIEWER, chỉ ghi compliance cho Farm được phân công. FARM_STAFF nộp chứng nhận; Admin quản trị, Auditor chỉ đọc. |
| Không có sensor | Cho phép harvest, ghi NO_DATA, không tạo digest giả hoặc claim có sensor proof. |
| Chuyển GROWING | Lần chăm sóc đầu tiên chuyển PLANTED → GROWING; readings không chuyển state. |
| markSold | Bán toàn bộ availableQuantity một lần, tồn về 0 rồi SOLD. |
| recall | Theo bên giữ hàng: Farm trước start, Transporter khi IN_TRANSIT, Retailer từ ARRIVED; Retailer cuối được recall sau SOLD. |

Ở P0, ghi lại các lựa chọn này vào issue liên quan cùng nguồn quyết định trong chat để reviewer và người triển khai dùng chung một policy.

### 2.2. Quyền và compliance

- COMPLIANCE_REVIEWER thuộc organization loại AUDITOR đang active; đây là role riêng. Không nâng quyền của AUDITOR hoặc SYSTEM_ADMIN.
- Thêm bảng ComplianceAssignment: reviewer user, Farm, người/ngày cấp và thu hồi; chỉ một assignment active cho cùng reviewer/Farm. SYSTEM_ADMIN quản lý assignment, không duyệt chứng nhận.
- Reviewer được đọc cycle/Lot/history/proof và compliance của Farm đang được phân công. Áp dụng scope đồng nhất cho list, detail, trace/proof và mọi write; không mở quyền đọc toàn hệ thống.
- Thu hồi assignment có hiệu lực ở request tiếp theo và được kiểm lại trong transaction ghi. Role/org/account lấy từ DB và session guard hiện tại; giữ thứ tự khóa organization → user của PR #71.
- Certificate có đúng một subject cycle hoặc Lot. Inspection giữ subject Lot theo DTO/schema hiện tại. Không mở thêm inspection cấp cycle.
- Farm chỉ nộp chứng nhận cho subject thuộc Farm của mình. Reviewer được phân công ghi inspection và duyệt PENDING → APPROVED/REJECTED đúng một lần.
- Sửa nội dung đã phát hành bằng bản ghi mới có quan hệ supersedes và lý do; không ghi đè evidence cũ. Chứng nhận thay thế bắt đầu PENDING; bản cũ còn hiệu lực đến khi bản thay thế APPROVED. Bản thay thế bị REJECTED không xóa bản cũ.
- Bản sửa giữ cùng subject, không tạo vòng supersedes hoặc hai nhánh thay thế đang hiệu lực; khóa chuỗi correction khi duyệt. Reviewer không duyệt chứng nhận do chính user đó từng nộp, kể cả sau khi đổi role; đối chiếu actor trong event nộp gốc.
- Public chỉ lấy chứng nhận hiệu lực, APPROVED và isPublic; documentRef/file, auth evidence và review note nội bộ không đi ra public.

### 2.3. Sensor theo từng harvest

- Dùng bảng HarvestSensorWindow riêng, một bản ghi cho mỗi harvest: cycle/harvest, periodStart/end, finalizedAt, status, readingCount và digestHash nullable. NO_DATA có count=0, hash=null.
- Bảng membership liên kết window với reading; readingId chỉ được thuộc một window harvest đã finalize. Giữ nguyên SensorDigest và unique final-per-cycle cũ cho dữ liệu/endpoint legacy; không sửa migration đã apply hoặc xóa index đó để đáp ứng multi-harvest.
- Window đầu bắt đầu từ plantedAt trong businessData của CYCLE_PLANTED; bao gồm reading đúng thời điểm bắt đầu. Window tiếp theo là (cutoff trước, harvestTime]. Cutoff phải tăng, không vượt thời gian server; lưu mốc dưới dạng UTC.
- Với cycle legacy, đối soát mốc trồng và cutoff/digest từng được dùng trước khi cho thu hoạch tiếp. Mốc thiếu hoặc không rõ được ghi LEGACY_UNVERIFIED và giao Phát xử lý bằng record đối soát bổ sung; không sửa TraceEvent/digest cũ.
- Chỉ đọc readings hợp lệ của cycle/device có trong snapshot transaction, sắp theo recordedAt rồi id. Hash chứa phiên bản harvest-sensor-1, cycle/window, danh sách reading và giá trị Decimal dạng chuỗi.
- Ingest, finalize, care/close/cancel và harvest dùng cùng khóa cycle khi kiểm trạng thái/mốc. Reading đến sau finalize nhưng recordedAt nằm trong window đã đóng được giữ và đánh dấu LATE, không đưa sang window kế tiếp và không rehash.
- Hai đường ghi sensor của cycle và IoT dùng cùng quy tắc validation/finalize. Giữ Idempotency-Key và xác thực device hiện tại; dữ liệu raw không sinh TraceEvent cho từng reading.
- Window/digest, HarvestEvent, Lot, QR, movement, TraceEvent và outbox cùng transaction. Finalize lỗi rollback toàn bộ; NO_DATA là kết quả hợp lệ theo quyết định đã chốt.
- Giới hạn sản lượng dùng tổng HarvestEvent.quantity của cycle, không dùng tồn Lot sau damage/sale. Bản ghi NO_DATA vẫn đóng cutoff để reading đến muộn không bị gom sang harvest sau.
- finalSensorDigestId cũ vẫn được nhận để tương thích; chỉ dùng khi chưa gắn harvest, đúng cycle và nội dung/window đối soát chính xác. Không cho client tự chọn digest bất kỳ để bỏ qua finalize.
- Event sensor mới mang cycleId và lotId của harvest tương ứng; QR của Lot khác không nhận sensor event của harvest này.

### 2.4. Số lượng, custody và terminal

- Tất cả phép tính ở backend dùng Prisma.Decimal, tối đa 3 số lẻ cho lượng hàng. Không tự làm tròn input sai precision, không tự đổi unit.
- Mỗi thay đổi tồn có movement cùng transaction: before + delta = after; after không âm; tổng movement khớp availableQuantity.
- Nếu tổng ledger không khớp tồn, chặn command đổi lượng, hiển thị quantityReconciled=false/cảnh báo theo scope và giao đối soát; không tự thêm adjustment để làm cân bằng.
- Tạo Shipment lấy toàn bộ lượng hiện có từ server; destination/transporter/retailer và shippedQuantity giữ bất biến. Lot vẫn HARVESTED cho tới start.
- Damage tại Farm chỉ khi chưa có Shipment. Khi Shipment CREATED, chặn Farm damage để tránh làm sai shippedQuantity bất biến. Recall/expire vẫn theo custodian.
- Partial damage giữ lifecycle; full damage đưa tồn về 0/DAMAGED, Shipment đang mở chuyển FAILED. Từ IN_TRANSIT damage do Transporter; từ ARRIVED do Retailer.
- Receive yêu cầu receivedQuantity >0 và receivedQuantity + damagedQuantity mới = availableQuantity ngay trước receive. Prior damage đã giảm tồn không tính lại. Full damage dùng command damage.
- Reject giữ quantity vật lý còn lại như hành vi hiện tại, ghi rejectedQuantity và state REJECTED; không tự tạo DAMAGE_OUT hoặc trừ lượng lần hai. Không mở quy trình hàng trả về.
- markForSale: RETAIL_RECEIVED → FOR_SALE, tồn >0, Retailer đúng tổ chức, chưa quá hạn. markSold: FOR_SALE → SOLD, xuất toàn bộ tồn bằng SALE_OUT.
- expiryDate là ngày theo Asia/Ho_Chi_Minh, hết hạn từ 00:00 ngày kế tiếp. Thiếu expiryDate thì không tự suy diễn ngày hết hạn. Chặn bán khi đã quá ngày dù command expire chưa được ghi.
- Ghi mới ưu tiên expiryDate dạng YYYY-MM-DD; datetime legacy vẫn được nhận và chuẩn hóa về ngày theo múi giờ đã chốt. Không thay đổi field ngày lịch sử; date boundary được kiểm lại trong transaction phía server.
- Expire là command thủ công của custodian, chỉ cho state còn hoạt động và đã quá hạn; xuất toàn bộ tồn bằng EXPIRE_OUT, state EXPIRED. Không expire SOLD/RECALLED/REJECTED/DAMAGED.
- Recall có reason/thời gian server; xuất lượng còn lại bằng RECALL_OUT nếu >0, rồi RECALLED. Sau SOLD vẫn được ghi recall, không tạo movement lượng 0. Command policy phải cho phép nhánh này dù tồn bằng 0.
- Recall/expire ở Lot có Shipment CREATED/IN_TRANSIT/ARRIVED phải chuyển Shipment đó sang FAILED trong cùng transaction. Shipment DELIVERED giữ lịch sử bàn giao.
- Khi shipment FAILED vì full damage/recall/expire, custodian cuối lấy từ bước bàn giao thực tế và terminal event, không suy ra rằng FAILED trả custody về Farm. Recall lại trên RECALLED bị 409, cùng key được replay.
- Terminal chặn các command bán/vận chuyển/nhận tiếp. Recall vẫn được ghi để cảnh báo trên lịch sử đã bán; không viết lại các event cũ.

### 2.5. Hash, nonce và envelope

- Giữ thuật toán private trace hash schema 2.0.0/RFC8785 để không rehash dữ liệu cũ. Actor/org/role, server authentication evidence và businessData tiếp tục ở private hash input.
- actorAuthProof hiện có là fingerprint do server tạo, không phải chữ ký của Farmer. Token/password/private key và toàn bộ auth secret không được lưu vào payload.
- Thêm envelopeVersion=3.0.0, tách khỏi schemaVersion của private hash. Envelope ghi mới chỉ có eventId/nonce, entityType/id, cycleId/lotId cần thiết, eventType/time, dataHash/previousEventHash và metadata phiên bản.
- Nonce do server sở hữu: nonce = UUID eventId đã persist trong TraceEvent. Uniqueness theo channel, dùng eventId toàn channel; không reset theo ngày/worker/lần retry. eventId đã có trong private hash nên nonce ràng buộc với cùng sự kiện.
- Retry giữ nguyên event/nonce/hash. Cùng event/nonce khác payload/hash phải bị từ chối; cùng event/hash được query receipt để phục hồi, không tạo bản ghi thứ hai.
- Duplicate recovery so sánh toàn bộ tuple allowlist (entity/cycle/lot/type/time/hash/predecessor/schema), không chỉ dataHash. Với event v2 cũ, so tuple chung và query receipt gốc; không ghi lại event đó bằng v3.
- Không gửi actorContext, actorAuthProof, businessData hoặc metadata tự do trong transaction args mới. Validation dùng allowlist ở Worker, Gateway và chaincode.
- Chaincode mới đọc được event/proof/history v2 và v3; chỉ nhận ghi envelope v3 sau cutover. Pending event v2 được Worker mới bọc v3 với nguyên dataHash/previousEventHash.
- Dữ liệu actor từng ghi vào ledger cũ không thể xóa bằng nâng cấp này. Bảo toàn ledger; hạn chế quyền truy cập mạng và không chiếu dữ liệu đó ra QR.
- Worker kiểm private evidence/version và tính lại local hash trước submit. VERIFIED cần commit VALID, receipt đúng event/channel/txId/hash và local private evidence còn đầy đủ.
- Giữ signer ở Worker; chỉ identity có quyền technical relayer được submit. Giữ truy vấn proof cũ, event vocabulary cũ và backward compatibility của history index.

## 3. Thứ tự thực hiện và cổng chuyển bước

P0–P9 dưới đây là mã giai đoạn của tài liệu, khác nhãn mức ưu tiên P0/P1 trong GitHub.

| Bước | Lịch mục tiêu | Làm theo thứ tự | Cổng qua bước |
| --- | --- | --- | --- |
| P0 — Chốt baseline | 10/10 | AGT-001, 002, 003, 006: bảo toàn dirty tree; lấy baseline mới ở checkout sạch; đối soát PR #71, CI và acceptance. | Có SHA baseline, snapshot danh sách thay đổi người dùng và evidence cần bổ sung; không làm lại auth/refactor đã có. |
| P1 — Quyền và môi trường | 10–11/10 | AGT-005, 007, 008: signer/env; role/org/scope; masterdata; scaffolding reviewer/assignment. | Không có đường Admin/Auditor ghi nghiệp vụ; scope reviewer không mở rộng actor khác. |
| P2 — Nền giao dịch và proof | 11–14/10 | AGT-009 → 012; AGT-016 → 017: private/public fields, nonce/envelope, Decimal, khóa aggregate và reconcile. | Khóa contract/hash vectors; migration và rollback thiết kế tương thích; API vẫn commit khi Fabric down. |
| P3 — Contract và sản xuất | 12–16/10 | Nhánh Phát: AGT-004 → 018. Nhánh Phi: AGT-010 → 011, rồi 013. Nhánh Tuấn: AGT-015 → 014 sau nền P2. | Core types sinh lại được; multi-harvest/window không trùng; Fabric thật xác nhận v2/v3 và retry. |
| P4 — Vận chuyển/nhận | 17–23/10 | AGT-019 → 020 → 021 → 023; AGT-022 tích hợp FE sau từng API contract. | Hai version/custody/quantity đúng; receive/reject chỉ một kết quả; full damage không tiếp tục lifecycle. |
| P5 — Compliance | 21–24/10 | AGT-026: mở write path cho reviewer đã được phân công; correction và public certificate filtering. | Quyền âm/dương, review một lần và evidence bất biến đạt; không coi issue đóng là đã triển khai. |
| P6 — Bán/recall/expire | 24–27/10 | AGT-024 và 025 dùng nền lượng/transaction và receive đã đạt. Tuấn review quantity của phần Phi làm. | SALE_OUT/EXPIRE_OUT/RECALL_OUT cân bằng; recall sau SOLD hoạt động; terminal chặn command. |
| P7 — Public và điện thoại | 25–28/10 | AGT-027 → 028; cập nhật contract/types mỗi khi P5/P6 bổ sung API. | QR đúng Lot; proof toàn lịch sử; cảnh báo và sensor status riêng; camera/PWA thật, không lộ phiên. |
| P8 — RC và recovery | 27–29/10 | AGT-030 diễn tập → AGT-029 kiểm đủ core trên cùng SHA → AGT-031 chốt RC/rollback. | CI/container/Fabric/recovery và migration rehearsal đủ evidence; gate đỏ chặn RC. |
| P9 — Bàn giao | Soạn 24–29, chốt 29–30/10 | AGT-032 → 033 → 034: tài liệu, Sheet, đối soát toàn bộ và signoff. | Accepted có SHA/reviewer/ngày; P0 blocker=0; production chưa publish trước approval riêng. |

**Quy tắc phụ thuộc:**

- Có thể chuẩn bị test/spec/UI trước, chỉ merge phần phụ thuộc sau khi contract nền được khóa.
- Trong từng nhánh cùng một owner, thực hiện lần lượt; không hiểu các ngày chồng nhau là cùng người làm nhiều task đồng thời. Reviewer nhận phần việc sau khi owner có PR và evidence cụ thể.
- AGT-016/017 có nền ở P2 nhưng chỉ chốt acceptance sau khi sale/expire/recall đã được kiểm ở P6/P8.
- AGT-010/011 làm nền sớm, cập nhật theo từng feature PR; không đợi toàn bộ feature xong mới có type và không freeze spec sớm rồi bỏ qua endpoint mới.
- Lịch ưu tiên gate và phụ thuộc. Nếu P2/P3 trễ, cập nhật mốc phụ thuộc cùng owner/blocker, không bỏ test hoặc chuyển Accepted để giữ ngày.

### Danh mục đầy đủ 34 task

Owner lấy từ assignee GitHub đã đọc ngày 10/10. Reviewer: task của Phát do Tuấn + Phi review; task của Tuấn do Phát + Phi (FE) review; task của Phi do Tuấn (Backend/contract) + Phát review. Phát xác nhận acceptance cuối.

Phụ thuộc ở bảng là điều kiện nền đã có khả năng sử dụng; một số task nền còn phải tái kiểm sau khi toàn workflow hoàn tất. Không đòi Accepted của task nền trước khi bắt đầu chuẩn bị feature.

| Task | Owner | Giai đoạn chính | Cần nền từ | Việc cần hoàn thành | Nhóm AC phải đối chiếu |
| --- | --- | --- | --- | --- | --- |
| [AGT-001](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/13) | Phát | P0 | — | Đối soát 34 task, nguồn, người làm, reviewer và các quyết định trong mục 2. | AC-MGMT-01 |
| [AGT-002](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/14) | Tuấn | P0 | — | Giữ bản vá dependency đã có; audit lại root/chaincode và chốt evidence/review. | AC-MGMT-01 |
| [AGT-003](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/15) | Phát | P0 | AGT-002 | Đối soát refactor với cấu trúc thực tế; CI/container cùng SHA, không tổ chức lại Web. | AC-MGMT-01 |
| [AGT-004](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/16) | Phát | P3 | AGT-005, AGT-009, AGT-012, AGT-017 | Fabric thật: submit/query, sai predecessor, sai relayer, duplicate và coverage. | AC-19, AC-20, AC-22, AC-KM-01 |
| [AGT-005](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/17) | Phát | P1 | — | Kiểm env, signer chỉ ở Worker, health nội bộ, least privilege và key incident. | AC-KM-01, AC-KM-02 |
| [AGT-006](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/18) | Tuấn | P0 | AGT-002 | Giữ PR #71; kiểm regression cookie/family, revoke, nhiều tab và đổi tài khoản. | AC-04, AC-KM-03 |
| [AGT-007](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/19) | Tuấn | P1 | AGT-006 | Khóa quyền tại controller/service, scope DB và trước idempotent replay; bổ sung reviewer hẹp. | AC-04, AC-PERM-01 |
| [AGT-008](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/20) | Phi | P1 | AGT-007 | Masterdata active/reference/unique/trim/scope; provision reviewer và assignment có kiểm soát. | AC-04 |
| [AGT-009](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/21) | Tuấn | P2 | AGT-007 | Chốt private actor evidence, public/Fabric allowlist và integrity validation. | AC-18, AC-20, AC-21, AC-DP-01, AC-DP-02, AC-DP-03, AC-KM-03 |
| [AGT-010](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/22) | Phi | P3 | AGT-006, AGT-009, AGT-012 | Swagger đầy đủ, export JSON tái lập, operationId, lỗi/security và SHA artifact. | AC-API-01, AC-API-02, AC-24 |
| [AGT-011](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/23) | Phi | P3 | AGT-010 | Sinh types từ OpenAPI; chuyển consumers từng bước, giữ shared HTTP/session/idempotency. | AC-API-03 |
| [AGT-012](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/24) | Phát | P2 | AGT-005, AGT-009 | Envelope v3, nonce=eventId, hash v2 bất biến và tương thích lịch sử. | AC-19, AC-20, AC-23, AC-DP-01, AC-DP-02, AC-DP-04, AC-KM-01 |
| [AGT-013](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/25) | Phi | P3 | AGT-007, AGT-008 | Plant/care/sensor/close/cancel theo state, role, org và version đã chốt. | AC-03, AC-04, AC-05, AC-24, AC-26 |
| [AGT-014](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/26) | Tuấn | P3 | AGT-013, AGT-015, AGT-016, AGT-017 | Multi-harvest atomic, giới hạn tổng, Lot/QR riêng và rollback không orphan. | AC-02, AC-06, AC-07, AC-08, AC-23, AC-26 |
| [AGT-015](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/27) | Tuấn | P3 | AGT-012, AGT-013, AGT-016, AGT-017 | Window theo harvest, membership readings, late data, NO_DATA và digest bất biến. | AC-03, AC-06, AC-07, AC-20, AC-SEN-01 |
| [AGT-016](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/28) | Tuấn | P2 | AGT-007 | Decimal3, movement/balance, không âm, không trừ damage/rejection hai lần. | AC-08, AC-09, AC-13, AC-14 |
| [AGT-017](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/29) | Tuấn | P2 | AGT-007, AGT-009 | Domain/trace/outbox cùng transaction, command journal và reconcile kết quả chưa rõ. | AC-19, AC-23, AC-26, AC-REL-01 |
| [AGT-018](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/30) | Phát | P3 | AGT-004, AGT-012, AGT-017 | Receipt/commit/hash đúng; lease, duplicate recovery, retry, dead-letter và backlog. | AC-19, AC-20, AC-21, AC-22, AC-23 |
| [AGT-019](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/31) | Tuấn | P4 | AGT-014, AGT-016, AGT-017 | Farm tạo một Shipment toàn lượng, active parties; Lot giữ HARVESTED tới start. | AC-04, AC-09, AC-10, AC-23 |
| [AGT-020](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/32) | Tuấn | P4 | AGT-019, AGT-016, AGT-017 | Start/arrival đúng cặp state, custody và hai version; không cập nhật một nửa. | AC-04, AC-05, AC-11, AC-24, AC-26 |
| [AGT-021](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/33) | Tuấn | P4 | AGT-014, AGT-016, AGT-020 | Farm damage trước Shipment; partial/full damage theo custody, quantity và reason. | AC-08, AC-13, AC-14, AC-16 |
| [AGT-022](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/34) | Phi | P4 | AGT-011, AGT-019, AGT-020, AGT-021, AGT-023 | FE actions theo backend, version mới, lỗi rõ và giữ key khi retry. | AC-04, AC-11, AC-12, AC-23, AC-26 |
| [AGT-023](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/35) | Tuấn | P4 | AGT-020, AGT-021, AGT-016, AGT-017 | Receive hoặc reject đúng Retailer một lần; cân bằng lượng sau prior damage. | AC-04, AC-12, AC-13, AC-14, AC-26 |
| [AGT-024](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/36) | Phi | P6 | AGT-011, AGT-023, AGT-016, AGT-017 | FOR_SALE rồi SOLD toàn bộ tồn; movement/event/outbox và UI đúng. | AC-01, AC-15, AC-16 |
| [AGT-025](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/37) | Tuấn | P6 | AGT-011, AGT-023, AGT-016, AGT-017 | Recall/expire theo custodian, ngày hết hạn, quantity disposition và cảnh báo. | AC-15, AC-16, AC-17 |
| [AGT-026](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/38) | Phi | P5 | AGT-007, AGT-009, AGT-010, AGT-011, AGT-017 | Reviewer được phân công; submit/review/inspection, correction append-only, public approved. | AC-04, AC-18, AC-25, AC-PERM-01 |
| [AGT-027](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/39) | Phi | P7 | AGT-012, AGT-014, AGT-015, AGT-018, AGT-021, AGT-023, AGT-024, AGT-025, AGT-026 | QR đúng Lot, cycle chung không sibling; tổng hợp proof toàn lịch sử và privacy. | AC-17, AC-18, AC-19, AC-21, AC-22, AC-DP-03 |
| [AGT-028](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/40) | Phi | P7 | AGT-011, AGT-027 | Scan/trace không login, Auditor readonly, điện thoại thật và offline không lộ tài khoản. | AC-17, AC-18, AC-22, AC-PERM-01 |
| [AGT-029](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/41) | Phát | P8 | AGT-002, AGT-003, AGT-004, AGT-005, AGT-006, AGT-007, AGT-008, AGT-009, AGT-010, AGT-011, AGT-012, AGT-013, AGT-014, AGT-015, AGT-016, AGT-017, AGT-018, AGT-019, AGT-020, AGT-021, AGT-022, AGT-023, AGT-024, AGT-025, AGT-026, AGT-027, AGT-028, AGT-030 | Nghiệm thu core/P0 cùng RC SHA trên CI, PostgreSQL/container và Fabric thật. | AC-01, AC-02, AC-04, AC-06, AC-15, AC-16, AC-19, AC-20, AC-21, AC-22, AC-23, AC-26 |
| [AGT-030](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/42) | Phát | P8 | AGT-017, AGT-018, AGT-024, AGT-025, AGT-026 | Diễn tập Pending/outage/dead-letter/stale lease/unknown/hash mismatch; giữ lịch sử. | AC-19, AC-21, AC-22, AC-23, AC-REL-01 |
| [AGT-031](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/43) | Phát | P8 | AGT-002, AGT-003, AGT-005, AGT-029, AGT-030 | RC/images/migration/backup/rollback, rehearsal và release approval riêng. | AC-KM-02, AC-REL-01, AC-MGMT-01 |
| [AGT-032](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/44) | Phát | P9 | AGT-009, AGT-010, AGT-012, AGT-015, AGT-024, AGT-025, AGT-026, AGT-031 | Ba DOCX PRD/Architecture/Runbook cập nhật, render kiểm layout và links. | AC-MGMT-01 |
| [AGT-033](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/45) | Phát | P9 | AGT-001, AGT-032 | Sheet đủ 34 ID: 3 tab hiện, 2 tab ẩn; workflow tách acceptance. | AC-MGMT-01 |
| [AGT-034](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/46) | Phát | P9 | Toàn bộ AGT-001–033 | Đối soát cuối, signoff theo SHA/ngày, bàn giao vận hành và việc deferred. | AC-MGMT-01 |

## 4. Nguyên tắc hạn chế ảnh hưởng code hiện có

1. **Bảo toàn checkout của người dùng.** Không reset/clean/stash tự động, không pull đè lên dirty main. Khi triển khai dùng checkout/worktree sạch trên baseline đã xác minh, branch codex/agt-xxx; thay đổi người dùng cần tích hợp bằng diff riêng.
2. **Mỗi PR một hành vi có thể review.** Ghi issue, phần thay đổi, callers bị ảnh hưởng, API/DB/event/UI/doc thay đổi và đường rollback. Không gom refactor thư mục, nâng major, đổi lint hoặc sửa unrelated code.
3. **Dùng module hiện có.** Giữ LotHarvestService, LotQueryService, presenter/action/proof policy; Web giữ src/lib, src/app, components. Các đường dẫn FSD/record-harvest trong issue cũ phải map sang file thật; catalog hiện nằm trong catalog.module.ts.
4. **Quyền được kiểm nhiều lớp.** Controller + service + org/assignment trong transaction. Kiểm authorization trước cả start và replay của idempotency để request 403 không tạo record; kiểm lại trước khi trả cached response. Tách kiểm scope khỏi điều kiện state để replay hợp lệ không bị từ chối chỉ vì command đã đổi state.
5. **Giữ contract tương thích.** Additive trước; không đổi tên/xóa field/operationId, kiểu quantity, enum proof hay envelope HTTP đang dùng ngoài thay đổi đã mô tả. Giữ deviceSequence dạng integer-string/null của PR #73.
6. **DB expand trước.** Thêm bảng hoặc column nullable; giữ checksum/SQL migration đã apply, seed không thay migration. Kiểm policy CD trước merge; role provision dùng script riêng sau migrate, không mở quyền chạy DML tùy ý trong auto-CD.
7. **Giao dịch là đơn vị ghi.** Với command nghiệp vụ có truy xuất: domain + movement khi đổi lượng + trace + outbox + command commit journal cùng transaction. Masterdata giữ hành vi hiện có, không tự thêm trace/outbox. Không gọi Fabric trong transaction API, không nâng Pending lên Verified theo suy đoán.
8. **Khóa có thứ tự.** Với command nhiều aggregate: cycle nếu cần → Lot → Shipment → assignment/certificate nếu cần; đọc lại state/custody/version sau khóa. Giữ khóa head trace theo entity; không thêm đường lấy khóa ngược trong caller khác. Auth giữ order riêng organization → user.
9. **Idempotency giữ ý định người dùng.** Key bền theo một lần submit, requestHash gồm resource/command/payload. Timeout/PROCESSING không tự tạo key khác; đổi payload dùng ý định mới sau khi kết quả cũ đã rõ.
10. **Lịch sử append-only.** Không sửa/xóa TraceEvent, proof đã xác nhận, finalized digest/window/membership hoặc movements đã ghi. Correction nối bản ghi mới và giữ căn cứ cũ.
11. **Shared HTTP/PWA được bảo vệ.** Giữ cookie/family/refresh 409, credentials, scope invalidation và cache clearing của PR #71. Không cache authenticated API hoặc form command offline; trang offline không giả lập thành công.
12. **Merge và evidence theo đúng SHA.** Sau rebase/merge hoặc đổi contract/schema/lockfile, chạy lại các gate bị ảnh hưởng; RC chạy full gate. Không dùng số test/ảnh/CI của commit cũ để chứng minh candidate mới.
13. **Privacy khi đọc lại.** Public trace/QR data và authenticated responses dùng no-store; PWA chỉ cache app shell. Không để cached VERIFIED che cảnh báo recall/expiry mới, không cache idempotent response hoặc journal vào vùng public.

### Ranh giới PR đề xuất

| Thứ tự | Nội dung PR | Reviewer bắt buộc |
| --- | --- | --- |
| 1 | Baseline/evidence và quyền/môi trường; scaffolding reviewer chưa mở write path | Tuấn + Phi hoặc Phát theo owner |
| 2 | Private/public contract + envelope v3 + Gateway/chaincode/Worker + compatibility rollout | Tuấn + Phát; Phi kiểm consumer |
| 3 | Decimal/transaction/idempotency authorization + command journal | Tuấn + Phát; Phi kiểm error/retry |
| 4 | OpenAPI exporter + generated types, giữ transport hiện tại | Tuấn + Phi; Phát kiểm CI |
| 5 | Cycle + harvest sensor window + multi-harvest | Tuấn + Phi; Phát kiểm raw/hash/cutoff |
| 6 | Shipment/start/arrival/damage/receive/reject, FE theo từng contract | Tuấn + Phi; Phát kiểm quyền/quantity |
| 7 | Compliance write/correction được phân công | Tuấn + Phi; Phát kiểm policy |
| 8 | Sale rồi recall/expiry, tách PR nếu cùng chạm lots/action policy | Tuấn + Phi; Phát kiểm terminal/quantity |
| 9 | Public projection/QR/PWA + tài liệu/evidence | Tuấn + Phi; Phát signoff |

Mỗi mục có thể tách thêm khi diff vượt khả năng review. Không có hai nhánh tự sửa cùng shared contract/policy rồi merge mà không tái sinh DTO và kiểm lại consumers.

## 5. Interfaces và dữ liệu cần bổ sung

### 5.1. API

Giữ prefix /api và success/error envelope hiện tại. Swagger phản ánh status thực tế: DTO validation hiện trả 400, sai quyền 403, stale/conflict 409 và lỗi business semantics 422; không ép mọi lỗi thành một status mới.

| Interface | Hành vi |
| --- | --- |
| POST /api/lots/:lotId/damage | Farm đúng scope, HARVESTED chưa Shipment; quantity/reason/version, movement + trace + outbox. |
| POST /api/lots/:lotId/mark-for-sale | Retailer đã nhận, version đúng, tồn >0 và chưa hết hạn; không giảm lượng. |
| POST /api/lots/:lotId/mark-sold | Retailer, FOR_SALE, version; server lấy toàn tồn và tạo SALE_OUT. |
| POST /api/lots/:lotId/recall | Custodian, reason, version; recall sau SOLD được phép, không movement 0. |
| POST /api/lots/:lotId/expire | Custodian, version và reason; date boundary lấy từ expiryDate, server xác nhận thời gian. |
| GET/POST /api/compliance/assignments | Admin xem/cấp assignment reviewer–Farm; GET của reviewer chỉ trả assignments của chính mình. |
| POST /api/compliance/assignments/:id/revoke | Admin thu hồi có audit; không xóa lịch sử. |
| POST /api/inspections, POST /api/certificates, PATCH /api/certificates/:id/review | Dùng endpoint hiện có; bật đúng reviewer; thêm supersedes/correctionReason optional cho bản sửa mới. |

- Mọi write mới dùng Idempotency-Key, actor lấy từ server và DTO validation. API lot command mới nhận version của Lot; khi tác động Shipment, server khóa/kiểm state và increment shipmentVersion cùng transaction.
- allowedCommands thêm reportDamage tại Farm, markForSale, markSold, recall, expire; chỉ backend quyết định quyền thực tế. Tách kiểm quantity>0 khỏi nhánh recall sau SOLD.
- DTO đọc Lot/public thêm sensorEvidenceStatus (FINALIZED/NO_DATA/LEGACY_UNVERIFIED), sensor window summary và cảnh báo recall/expiry/quantity mismatch phù hợp phạm vi. Không đưa raw readings hoặc internal auth ra public.
- Damage nhận evidenceRef optional giữ off-chain; reason sau trim phải không rỗng. Certificate mới kiểm documentHash SHA-256 64 ký tự hex; giữ record/hash legacy, không tự tải URL hoặc thêm upload workflow.
- proofStatus giữ VERIFIED/PENDING/INTEGRITY_WARNING/BLOCKCHAIN_UNAVAILABLE. Sensor NO_DATA và recall/expiry là cảnh báo nghiệp vụ riêng; VERIFIED chỉ nói về tính toàn vẹn.
- Schema/error/null/date/Decimal/security/idempotency/operationId phải được cập nhật cùng PR; metadata auth đã có trong PR #71 được tái sử dụng.

### 5.2. OpenAPI và FE types

- Tạo exporter JSON từ đúng cấu hình Swagger của NestJS, không mở port hoặc yêu cầu Fabric signer; output có thể sinh lại từ cùng SHA.
- Dùng openapi-typescript để sinh type-only từ JSON local; phiên bản được khóa trong manifest/lockfile và kiểm trên Node matrix hiện tại. Không sinh transport thay api-client.
- Lưu generated API types riêng trong src/lib/generated; form/view models và formatter ở lớp hiện có. Chuyển auth/lots/catalog trước, rồi cycle/shipment/compliance/public.
- CI validate spec không rỗng/unresolved, operationId duy nhất, request/response đúng runtime; sinh lại và fail nếu generated drift. Ghi SHA-256 JSON artifact.
- Cơ sở chọn generator: [tài liệu chính thức openapi-typescript](https://openapi-ts.dev/introduction), hỗ trợ type-only từ OpenAPI local.

### 5.3. Schema và command reconciliation

- Bổ sung HarvestSensorWindow, membership readings, late-reading marker, ComplianceAssignment và quan hệ correction bằng bảng mới. Đặt FK/unique/check phù hợp trong CREATE TABLE khi policy cho phép; FK inline dùng mặc định NO ACTION, tránh clause ON DELETE/UPDATE bị guard từ chối.
- Bổ sung CommandCommit journal: idempotency record, actor authorization scope, resource IDs, response snapshot và thời gian commit. Ghi journal trong transaction nghiệp vụ, không chờ bước complete bên ngoài.
- Journal chỉ áp dụng command nghiệp vụ/masterdata cần reconcile, không lưu response login/refresh, token hoặc cookie. Record có journal không được xóa bởi cleanup TTL khi còn cần audit/replay; lưu response theo serializer/envelope và status thực tế.
- Nếu domain đã commit nhưng hoàn tất idempotency record lỗi, operator đối chiếu journal → resource → trace/outbox → Fabric receipt để khôi phục đúng kết quả. Không xóa PROCESSING theo TTL hoặc thực thi lại command chỉ vì timeout.
- Với record legacy chưa có journal, đối soát tài nguyên/lịch sử trước và giữ unresolved nếu chưa đủ bằng chứng. Không đoán rằng không thấy proof nghĩa là command chưa commit.
- Bảng window, membership, correction và journal là dữ liệu audit bất biến; thu hồi assignment là trạng thái quản trị có audit riêng. Bảo vệ ở service/DB theo migration được review, không thay đổi lịch sử đã có.
- CREATE UNIQUE INDEX, index có WHERE cho assignment active, ALTER ADD FK/constraint, CREATE TRIGGER/GRANT và SQL khác ngoài allowlist phải đi đợt migration có kiểm soát, được Phát review trên SQL cụ thể rồi rehearsal/backup trước thực hiện. Auto-CD phải dừng rõ ở gate này; không nới policy chung hoặc mô tả là tự động được phép.

## 6. Kiểm thử và tiêu chí nghiệm thu khi triển khai

Các kiểm thử dưới đây là công việc phải thực hiện sau khi code được triển khai. Lượt lập kế hoạch này chỉ đọc source/issue và kiểm tính nhất quán của tài liệu, không chạy suite ứng dụng.

| Nhóm | Scenario bắt buộc | Bằng chứng/cổng đạt |
| --- | --- | --- |
| Auth + quyền | Refresh đồng thời với logout/lock/disable; response A muộn khi login B; nhiều tab; reviewer sai Farm/assignment bị revoke; Admin/Auditor writes; replay sau đổi scope | 401/403 đúng; dữ liệu không lộ; DB/domain/event/outbox/quantity không đổi khi bị từ chối |
| Contract | Export hai lần cùng SHA, schema đầy đủ, null/date/Decimal/bigint, cookie security, status/error thực tế, generated drift | JSON validate, hash/input rõ, FE consumers typecheck/build |
| Cycle + harvest | Plant sai state, care chuyển GROWING, sensor không đổi state; harvest vs close/cancel; hai harvest đồng thời vượt cap; replay/rollback/QR | Đúng state/version; một harvest–Lot–QR; không orphan, không vượt cap |
| Sensor | Reading tại hai biên, cutoff tăng, late ingest đồng thời finalize, hai harvest, NO_DATA, provided legacy digest sai/đã dùng, digest/window bị sửa | Membership không trùng; count/hash đúng; NO_DATA không dummy; finalize lỗi rollback; legacy không bị rehash |
| Quantity | 0/âm/>3 số lẻ/vượt tồn/đơn vị sai; partial/full damage; receive sau damage; reject; sale/recall/expire; zero-quantity recall sau SOLD | Decimal chính xác; before+delta=after; tổng khớp tồn; không movement 0 hoặc trừ hai lần |
| Shipment/custody | Tạo hai shipment, active refs, wrong farm, Farm damage sau CREATED, start/arrival sai thứ tự, receive vs reject/recall/damage đồng thời | Một kết quả hợp lệ; không partial state; conflict 409; terminal chặn tiếp |
| Compliance | Exactly-one-subject, reviewer sai scope, self-review sau đổi role, hai reviewer duyệt đồng thời, correction khác subject/vòng/nhánh, bản thay thế rejected/approved, public filtering | Chỉ reviewer được phân công; review một lần; lịch sử cũ còn; public chỉ effective approved+public |
| Fabric/Worker | v2 query + v3 write, legacy Pending bọc v3, duplicate cùng hash/khác hash, nonce khác eventId, sai relayer/predecessor, receipt thiếu/sai, local evidence thiếu, stale lease | Commit/query đúng, không proof giả/trùng; hash/receipt sai vào dead-letter; coverage chaincode ≥90% lines/functions/statements và ≥85% branches |
| Outage/uncertain | Dừng Fabric, API vẫn commit Pending; phục hồi/drain; crash sau business commit trước complete; reconcile journal; retry | Không mất/trùng domain/event/outbox/proof; cùng ý định không tự đổi key |
| Public/QR/PWA | Hai sibling Lots, cycle chung, event cũ pending/mismatch và event mới verified, token sai, recall/expiry + VERIFIED, NO_DATA, camera/PWA điện thoại thật, đổi account/offline | Không sibling/private fields; aggregate đúng toàn lịch sử; cảnh báo ưu tiên; không login/wallet hoặc dữ liệu phiên trước |
| Release/recovery | Migration từ DB mới và bản sao, rollback app với schema mở rộng, chaincode sequence mới, snapshot PG+Fabric+identity, restore môi trường cách ly | Giữ checksum/history/outbox; baseline counts/hashes còn; app/worker/Fabric readiness phân biệt rõ |

**Bộ gate dùng lại:**

- npm run check: CI/CD logic, Gateway build, checks các workspace; API chạy trên TEST_DATABASE_URL riêng đã migrate.
- npm run test:worker-contract; các job production containers và real Fabric integration hiện có.
- npm run audit:dependencies và npm run check:chaincode:standalone; thêm generator không làm lệch root/standalone lockfile. Giữ Next/Nest major.
- Node matrix 22.22.3 / 24.15.0 / 26.0.0, npm 12.1.0 theo CI; không đổi toolchain để bỏ qua lỗi.
- Mỗi report ghi SHA, image digest, OS/runtime, DB/Fabric version, command, số passed/failed/skipped thực tế và links artifact. Skip bắt buộc không được coi là pass.
- E2E cơ sở dữ liệu dùng DB test/copy cách ly; không chạy fixture destructive trên UAT/prod. Camera/PWA và physical Fabric restore chưa có evidence hiện hành phải được bổ sung.
- Thiếu gate/evidence/reviewer giữ Not Evaluated hoặc Needs Rework; không tự sửa Issue/Project/Sheet thành Accepted.

## 7. Rollout, rollback và bàn giao

### 7.1. Chuẩn bị triển khai

1. Chọn exact SHA và immutable image digests đã qua full CI; lưu manifest migration, spec hash, contract/envelope versions và chaincode package/sequence.
2. Chạy rehearsal trên DB mới và bản sao đã làm sạch thông tin nhạy cảm, giữ migration checksums; kiểm các câu SQL với policy CD trước merge.
3. Provision COMPLIANCE_REVIEWER bằng script có phiên bản, chỉ thêm role nếu thiếu, không đổi existing role/users. Chạy sau schema migration, trước khi cấp reviewer account/assignment; log chỉ metadata an toàn.
4. Cập nhật CD để gate và chạy bước provision hẹp này; giữ SQL policy hiện tại, không cho phép DML/SQL tùy ý.
5. Bổ sung capability check envelope v3 trong preflight và allowlist rollback image/chaincode tương thích; ứng dụng/người vận hành thấy rõ trạng thái paused/Pending.
6. Bổ sung reviewer account/assignment trong bộ fixture và smoke UAT/CI riêng; kiểm đủ 6 role đăng nhập cùng Consumer public, cả scope hợp lệ và sai scope. Cấu hình tài khoản thật giữ private.

### 7.2. Cutover envelope v3 lần đầu

1. Chụp snapshot nhất quán PG + Fabric/CA/MSP/identity + config, mã hóa và kiểm checksum/artifact.
2. Dừng Worker cũ. API có thể tiếp tục queue Pending khi không lấy snapshot; không để Worker cũ gửi actorContext sau cutover.
3. Upgrade chaincode bằng expected_sequence → sequence+1; kiểm committed definition trên cả hai peer. Giữ queries/history/proof v2, bật write v3.
4. Chạy migrations/provision; triển khai API → Worker tương thích v3 → Web. Xác minh Pending v2 drain với nonce=eventId, nguyên hash; canary/QR/role/assignment/proof đúng.
5. Chỉ promote release khi verification và encrypted backup upload đạt. Nếu peer/commit/version không rõ, giữ Worker paused và đối soát; không restart writer theo phỏng đoán.

Các release tiếp theo theo migration → API → Worker → Web của CD hiện tại; chỉ dùng rollback candidate hỗ trợ envelope v3 và schema/window/reviewer/command mới.

Manifest mỗi release ghi minimum compatible API/Worker/Web và khả năng đọc/ghi từng tính năng. Lần đầu bật một invariant chưa có bản rollback tương thích phải chuẩn bị bridge image hoặc dừng write liên quan và sửa tiến tới; không chạy API cũ tạo harvest thiếu window/journal, không chạy Web cũ che cảnh báo recall.

### 7.3. Rollback và vận hành

- Rollback app giữ DB/outbox/ledger; không restore dump như một bước rollback thông thường, không chạy migrate reset/seed hoặc xóa lịch sử.
- Sau cutover v3, không rollback về Worker chỉ biết actorContext v2. Nếu chưa có image cũ tương thích, pause Worker, giữ Pending và sửa tiến tới; phục hồi chaincode dùng sequence tăng, vẫn đọc v2/v3.
- Với hash mismatch/dead-letter/unknown PROCESSING: đọc journal/resource/local hash/ledger trước; thao tác operator có người thực hiện, reviewer, timestamp và audit. Correction nối mới, không sửa proof cũ để làm xanh.
- Rehearsal restore đầy đủ sang môi trường cách ly; giữ private keys/config trong kênh bàn giao bảo mật. Phát phụ trách release/key incident; Tuấn đối soát DB/API/outbox, Phi kiểm Web/QR.
- Theo dõi UAT sau deploy ít nhất 24 giờ với bộ core command/role/QR/canary và backlog: không có lỗi P0/P1 chưa xử lý, không dead-letter chưa giải thích, không backlog quá hạn chưa đối soát. Nếu có, dừng promote và sửa rồi chạy lại gate liên quan.
- Chốt mã RC trước cửa sổ theo dõi 24 giờ. Thay đổi code/contract/schema sau đó tạo candidate mới và bắt đầu lại gate/cửa sổ bị ảnh hưởng; mốc 30/10 dịch nếu không đủ thời gian.
- Bàn giao ba DOCX PRD/Architecture/Runbook đã render/kiểm bố cục, links và phiên bản. Không sao chép Swagger thành một API contract viết tay.
- Sheet giữ TIEN_DO, CONG_VIEC, VUONG_MAC hiện; SOURCES, ACCEPTANCE ẩn; đủ 34 TaskID duy nhất, workflow và acceptance tách biệt. Không thêm tự động gửi mail/đồng bộ định kỳ.
- AGT-034 chốt từng task với result/evidence/SHA/reviewer/ngày; P0 blockers=0, core AC đạt, docs/Sheet/Issue thống nhất. Production chỉ được publish sau release approval riêng.

## 8. Nhật ký review kế hoạch và điều kiện khóa bản cuối

| Vòng | Đối chiếu | Sai sót/rủi ro đã phát hiện và sửa trong thiết kế |
| --- | --- | --- |
| R1 — Sự thật hiện tại | Source/PR/issue/dirty tree | Đưa PR #71 đã merge vào baseline; không làm lại auth. Phân biệt issue Closed với Accepted. Dùng module/Web path thật thay đường dẫn FSD cũ. |
| R2 — Đủ việc/phụ thuộc | 34 issue, owner, AC và đồ thị | Có 34/34 task, 40 nhóm AC; đồ thị nền không có chu trình. AGT-016/017/010/011 cần tái kiểm sau feature; lịch theo owner, không giả định owner làm song song mọi task. |
| R3 — Tính đúng và tương thích | Transaction, privacy, sensor, quantity, terminal, rollout | Tách window harvest khỏi unique final-cycle legacy; không rehash lịch sử. Tách envelope v3/private hash v2. Thêm scope check trước replay, command journal, recall sau SOLD không movement 0, custody/Shipment terminal và rollback tương thích. |
| R4 — Rà tài liệu cuối | Kiểm register/AC/link/order, đọc lại các cổng | Đã sửa nhánh correction/self-review, authorization trước start/replay, gross harvest cap, NO_DATA đóng cutoff, quantity mismatch, custody sau FAILED, tuple duplicate đầy đủ, no-store public, SQL ngoài allowlist và minimum rollback capabilities. |
| R5 — Đối chiếu sau sửa | Đồ thị, register/AC và guard SQL thực tế | Xác nhận 34 task/40 nhóm AC, không phụ thuộc không tồn tại hoặc đảo giai đoạn. Sửa quy tắc không thêm trace cho masterdata; ghi rõ UNIQUE/partial index/ALTER FK và clause DELETE/UPDATE bị guard CD chặn. |

**Điều kiện khóa plan:**

- Mỗi AGT ID xuất hiện đúng một lần trong register; đủ owner, nền phụ thuộc, giai đoạn, việc cần làm và nhóm AC.
- 40 nhóm AC trong issue được truy vết; mọi core write có actor/scope/state/version/idempotency/transaction/proof/FE contract được xem xét.
- Không còn lựa chọn nghiệp vụ mở trong sáu quyết định đã chốt; các điều kiện dữ liệu legacy/môi trường/approval được ghi thành gate với owner.
- Không còn mâu thuẫn được phát hiện về nguồn source, DAG, số lượng, privacy, migration/CD hoặc rollback.
- Lưu rõ giới hạn bằng chứng: review plan không chứng minh xác suất ổn định phần mềm >99%. Thước đo báo cáo là độ bao phủ yêu cầu và lỗi/mâu thuẫn đã xử lý; độ ổn định vận hành chỉ xác nhận sau triển khai/kiểm thử.

Tài liệu này không tự cấp acceptance, thay đổi Issue/Sheet/Drive, triển khai production hoặc xác nhận rằng các gate ứng dụng đã pass.
