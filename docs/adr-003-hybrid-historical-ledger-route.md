# ADR-003 — Route lịch sử và ranh giới phát hành A/B

Ngày 13/10/2026. Candidate triển khai; chưa là bằng chứng runtime/migration.
Mở rộng ADR-001 và kế hoạch Hybrid đã review. Production-only là policy hiện hành.

## Vấn đề

Worker/provider hiện dùng một cấu hình env; TraceService trả destination từ env
khi chưa có proof. Đổi channel sau khi tạo event có thể gửi backlog hoặc hiển thị
proof sai ledger. EventChainContext chỉ bổ sung scope ứng dụng, không chứng minh
Fabric đã xác nhận chain. A cần route bất biến trước migration; B mới thêm pool,
ledger permissions và governance doanh nghiệp.

## Quyết định cho A

Đăng ký definition bất biến gồm network, channel, chaincode, contract, envelope
protocol và logical writer authority/MSP/role. Definition không chứa endpoint,
certificate path, credential revision hoặc private key. Digest canonical của
definition được pin độc lập với database trong cấu hình deployment đã review.
Giữ danh sách pins lịch sử và một active legacy definition; đổi active không sửa
route của event cũ. Pin thiếu/sai đóng quyền sử dụng definition, không fallback.

EventLedgerRoute tham chiếu definition cùng transaction domain/trace/outbox.
Predecessor của cùng stream phải có cùng ledger destination; đổi stream/channel
cần checkpoint/history-segment riêng. Event/hash/private body cũ không cập nhật.
Legacy backfill dùng inventory đã review, đối chiếu network/channel của proof
đã confirmed và trusted descriptor cho Pending; root/chain không suy ra ledger.
Thiếu bằng chứng giữ unresolved, không tự nhận route hiện tại.

Proof lookup theo event route. Proof row đã tồn tại phải khớp route/hash; không
lấy destination từ env của chain hiện tại. Worker A chỉ relay definitions khớp
logical destination và writer authority của adapter đã đăng ký. Mismatch/thiếu
pin/incompatible health giữ Pending trước claim, không tiêu lease/retry budget
và không chuyển ledger. Giữ predecessor ordering, duplicate recovery, VALID
receipt và tuple/hash/channel checks. A tiếp tục technical relayer, không nâng
trust scope sidecar thành ledger authorization của B.

API giữ không có signer. Pins/definition metadata không phải credential; Worker
chọn credential hiện hành cho cùng logical authority. Khi đưa vào production,
import/backfill/pin phải có rehearsal, writer pause và receipt riêng trước resume.

## B và C tiếp theo

B bổ sung versioned binding registry/pool và DeliveryAttempt, credential rotation,
permission sync/normal drain barrier/emergency holds theo kế hoạch mục 4.3. Ledger
registry là authority cho chaincode; PostgreSQL không thay endorsement/governance.
Channel pilot mới chỉ join các bên có cùng phạm vi chia sẻ, không join vào public
history legacy không liên quan. Hosted/self-managed fixtures chỉ là nghiệm thu kỹ
thuật đến khi có doanh nghiệp thật nắm CA/admin/peer/signer.

C chốt commitment và vector trước schema signer/intent: unsigned intent phải ràng
chain/event/operation/version/private payload digest/destination/permission epoch;
signature và event commitment dùng domain separation, không ký vòng quanh chữ ký.
Multi-event command cần effect-root/path rõ ràng. Reader dispatch theo version giữ
hash/trust của legacy. Pickup/arrival chỉ đổi custody khi đúng hai bên xác nhận;
A/B endpoint không bypass stream profile C. Đây là gate thiết kế/implementation
còn lại, chưa được ghi là signature/handover đã giao.

## Kiểm chứng bắt buộc

Route được chụp trước outbox; direct SQL không sửa/xóa route/definition; rollback
không tạo orphan route. Đổi env/active binding không đổi proof destination cũ.
Mismatched pin/config/receipt và predecessor khác destination phải reject/hold,
không gửi nhầm hoặc tăng attempt. Fresh/copy/restore giữ route/hash/journal/QR.
Fabric thật cách ly kiểm commit/query/duplicate/rotation trước B runtime rollout.

## Chi tiết triển khai được chọn

Registry dùng digest SHA-256 RFC8785 làm khóa; payload có protocol
`agritrace-ledger-route/1`, network, channelId, chaincodeName, contractName,
envelopeVersion, mode, writerAuthority, writerMspId và writerRole. WRITE mode
chỉ hỗ trợ envelope 3.0.0 và authority đầy đủ ở A. HISTORICAL mode chỉ đọc;
protocol/authority chưa chứng minh để null, không tự nhận MSP của relayer hiện tại
là signer của history cũ. Pending chưa xác định protocol không được tự nâng version.
Pins metadata nằm
trong env deployment `LEDGER_ROUTE_PINS`; `LEDGER_ACTIVE_ROUTE_DIGEST` phải nằm
trong tập pin, không có giá trị mặc định. API chỉ đọc metadata này, không thêm
mount signer. `LEDGER_WRITER_AUTHORITY` xác định logical technical relayer;
MSP/role thực dùng phải khớp cấu hình adapter và chaincode kiểm `app.role`.
Rotation credential không đổi registry definition.

Trace insert mới phải có EventLedgerRoute trước khi transaction commit, dùng
constraint trigger deferred để vẫn tạo event rồi sidecar trong cùng transaction.
Các event legacy có sẵn được phép chưa route cho đến khi import đã review; Worker
không claim chúng. Trước claim Worker lọc definitions theo pin, canonical digest
và adapter destination/authority; sau claim kiểm lại trước gọi network. Proof
reader dùng cùng validation, trả destination nullable/integrity warning khi route
chưa được xác minh. Public QR chỉ xuất projection đã allowlist, không xuất registry
hoặc writer metadata.

Import legacy không dùng default active route. Artifact pin độc lập phải ràng
inventory digest, từng event ID/hash, definition digest và evidence proof/descriptor
trước writer pause. Apply dưới khóa history, rerun cùng mapping là no-op; khác route
reject. Confirmed proof phải giữ nguyên network/channel/hash/tx/time. Pending không
có proof cần trusted descriptor evidence riêng. Sau import kiểm orphan, predecessor,
hash/history/QR/journal trước khi resume. Chưa có receipt thì chưa nghiệm thu backfill.

## Candidate và evidence hiện tại

Candidate đã thêm registry/sidecar immutable, deferred guard cho event mới,
predecessor destination và proof destination/hash guards; chưa là official migration.
TraceService chụp route cùng event/outbox; proof/QR đọc route đã pin, không fallback
network/channel từ env. Worker lọc route/pin/authority trước claim và health gate;
cached gateway giữ destination lúc tạo connection. API không thêm signer hoặc mount.

Local API type/lint/build, 140 unit (năm regression route mới), Swagger 96 operations
và Worker → chaincode validator contract check đạt. DB suite thêm 19 route cases
(dự kiến tổng 114 policy/DB + 112 legacy E2E): immutable/deferred/proof/direct SQL,
null-authority checks, env change, incompatible writer/health, concurrent leases,
predecessor ordering, simulated response loss/duplicate và wrong channel receipt.
Chưa ghi các DB cases mới là pass trước terminal job. Adapter trong DB suite được
mock, không là Fabric VALID commit acceptance. Import legacy, official migration,
copy/restore/compatible rollback và exact SHA CI/production rollout còn là gate.

Lượt DB `9b19e57` đạt 140 unit, SQL 31, full diff zero + sáu guards và ORM;
111/114 policy cases đạt. Ba failure cùng fixture dùng null actor với role
`SYSTEM`, trong khi evidence contract chỉ nhận `SYSTEM_ACTOR` cho assertion này.
Worker đúng là từ chối trước submit; latch concurrency chờ network nên timeout.
Sửa fixture role, thêm precondition private evidence hợp lệ và fail-fast nếu Worker
thoát trước relay gate; giữ assertions và timeout nghiệp vụ. Container 384 MiB/1 CPU
không OOM/restart; cleanup container/network/port/keeper verified. Chưa chạy legacy
E2E ở lượt fail, chưa gọi toàn suite hoặc Fabric gate là pass.

Lượt `5639ed3` đạt cả 19 route cases nhưng làm 24 legacy cases thất bại và 10
cases không chạy: fixture route đã commit event không có cycle/lot, nên legacy
inventory chặn đúng event không rõ root. Đây là lỗi cô lập fixture, không phải
RAM (OOM false, restart zero). Đổi fixture sang cycle có thật trong chuỗi ACTIVE
riêng, không nới inventory hoặc xóa immutable history. Cleanup lượt fail verified.
