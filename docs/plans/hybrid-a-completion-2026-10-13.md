# Hoàn tất các gate A còn lại — 13/10/2026

Chỉ đạo production-only ngày 12/10 thay mọi bước dev deployment/observation
trong các kế hoạch cũ. Dev đã retirement; production cleanup release 8ae đã
pass hậu kiểm, receipt riêng. Hybrid vẫn là candidate, không deploy draft.

## Thứ tự thực hiện

1. Giữ checkpoint 0158efd: 135 API unit, 31 SQL, diff zero + sáu guards,
   ORM, 89 policy/DB và 112 legacy E2E. Web 73777ac đạt 206 tests, 84 lint
   contract, bốn optimizer, type/lint/build. Không suy browser hoặc rollout pass.
2. Bridge: chụp reviewer grant + farm assignment hiện hành khi apply; replay
   phải giữ đúng grant/revision/assignment và kiểm independence hiện hành.
   Chụp registered devices + tracking binding, thêm authority revision chỉ tăng
   khi device identity/status/scope đổi; lastSeenAt không đổi authority. Replay
   gateway giữ đúng requester/device/binding/revision và positive journal.
   Creation root chỉ lấy từ journal khớp original key/body; device không có root
   hoặc command chưa được hỗ trợ giữ fail closed. Giữ journal/digest cũ.
3. Logical route: pin destination/protocol/writer authority cho event mới trong
   transaction; legacy backfill có inventory/proof/descriptor đối chiếu. Proof
   không fallback destination từ env mới. Worker từ chối route/config mismatch
   trước claim, không tiêu retry budget khi binding thiếu hoặc incompatible.
4. Browser desktop/mobile với app + PostgreSQL cách ly: lost response sau
   commit, remount/reload, hai tab cùng original key, account/revoke/stale result,
   activation và consent. Có receipt/cleanup; DOM tests không thay browser gate.
5. Promote candidate thành migration append-only sau review dependencies;
   checksum allowlist chỉ thêm migration mới. Fresh DB và sanitized legacy copy,
   inventory/hash/history/QR/journal trước/sau, restore và compatible app rollback.
   Rollback dùng image hiểu scope/pin, không mở lại quyền legacy.
6. Exact SHA CI, production backup/canary/rollback/observation; push trực tiếp
   main theo ủy quyền. B/C triển khai tiếp theo dependencies đã review, không
   dùng technical relayer hoặc peer cách ly để tuyên bố authority doanh nghiệp.

## Nguyên tắc kiểm chứng

Test DB local/runner có label/quota/port riêng; giữ WSL PostgreSQL 16 của người
dùng. Mọi failure gắn SHA và phân loại source/fixture/harness/resources trước
sửa. Không giảm assertion hoặc đổi hash/key để xanh. Candidate SQL chỉ chạy
DB cách ly; alignment diff chỉ đọc. Giữ nguyên applied migrations và hai docs
dirty có sẵn của người dùng. Bỏ file/function thừa khi đã xác nhận không có caller
và không phục vụ history/rehearsal/compatibility.

Bridge candidate đã bổ sung protocol 2 cho reviewer/device, giữ protocol 1 của
business actor. Snapshot chỉ ghi identifiers/revisions; journal và hash cũ giữ
nguyên. Chặn dùng journal scoped mới như legacy khi profile đổi revision. Sáu
DB regressions mới còn phải chạy: reviewer regrant/assignment, sensor/telemetry
epoch/binding, cycle-bound device creation/unknown outcome và scoped journal.
Local typed check gồm mọi hybrid spec, lint và Swagger generate 96 operations
đạt; chưa gọi các regression mới là pass. Manifest mới chỉ production/isolated;
runtime production từ chối isolated pins, môi trường dev đã bỏ.

Lượt local `1b6b3d9`: 135 unit/31 SQL/diff zero + sáu guards/ORM đạt;
94/95 policy cases đạt. Case còn lại tạo transition ACTIVE → ACTIVE/version+1
không hợp lệ theo DB guard, trước assertion bridge. Sửa fixture sang suspend rồi
reactivate đúng state machine, giữ yêu cầu scoped journal không bridge thành
legacy. Container không OOM/restart, cleanup hoàn tất; chưa chạy legacy E2E ở
lượt thất bại này. Bổ sung negative direct SQL không cho giả authority revision.

## Evidence tiếp theo — fd01aca

Local PostgreSQL 18 hoàn tất UTC 18:29:54 ngày 12/10 (01:29:54 ngày 13/10 VN):
135 API unit, 31 SQL scenarios, full Prisma diff zero + sáu unique guards,
ORM, 95 policy/HTTP/DB (26 HTTP groups), 112 legacy E2E. Database 384 MiB/1 CPU;
không dùng tài nguyên production hoặc PostgreSQL 16 của người dùng. Container,
network, port và WSL keeper đều cleanup verified. Test profile đã sửa fixture
transition, không nới assertion hoặc trigger. Các lỗi trước không có bằng chứng OOM.

Receipt local: `.codex/evidence/hybrid-local/agritrace-hybrid-local-fd01aca4-1791829634964587300`.
Suite bridge mới đã đạt trên SHA đầy đủ
`fd01aca4a36c3b3cc4afe7101262085682603599`; chưa suy ra route/migration/Fabric B/C.

Browser dùng Chromium thật + Next production build + Nest API + PostgreSQL 18
cách ly, không mock API. Hai lượt đầu lỗi harness: nhãn bắt buộc có `*` và accessible
name của select có text options; sửa locator theo nhãn/role. Lượt tiếp theo đã qua
real commit/lost response/reload/hai tab/one journal, đang đối chiếu activation
refresh với DB; chưa ghi toàn bộ browser suite là pass. Giữ failures và cleanup.

Production cleanup release vẫn `prod-8ae13542aee92b47d7ed64a0d83d560dbb517dc3`.
Observation UTC 18:38:35: 60 ledger events, Pending 0, QR 2 verified + 6 legacy,
118 fingerprints cũ giữ nguyên (120 hiện tại), 209 identity files giữ nguyên,
không dev containers. Window elapsed 0,913 giờ, gap 3.286,744 giây; chưa nghiệm thu
24h, không suy healthy trong gap. API/Web 768 MiB/1 CPU, Worker 512 MiB/0,5 CPU
là budgets production thực tế; không áp nhầm quota chaincode pilot đã retire.

Browser tiếp theo xác nhận activation HTTP 201 và DB ACTIVE. Access revision mới
đúng là làm remount private workspace và bỏ selection cũ; harness cần tải quyền rồi
chọn lại chain. Sau đó phát hiện lỗi source thật: BusinessProfilePanel và
ShipmentPlansPanel dùng trùng React key, tạo ba panel profile qua refresh. Regression
DOM tái hiện trước sửa (expected 1/actual 3); thêm prefix riêng cho mỗi panel và
cleanup fixture. Web 207 unit/DOM, 84 lint contract, bốn optimizer, lint/type/build
đạt sau sửa. Browser đầy đủ còn phải chạy lại trên checkpoint mới; không giảm
strict locator để che nhiều panel và không thay permission remount semantics.
