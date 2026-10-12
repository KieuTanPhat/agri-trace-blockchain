# Legacy scope: inventory và manifest trước backfill

Trạng thái 12/10/2026: công cụ chỉ đọc đang được kiểm trên PostgreSQL cách ly.
Chưa có apply/backfill, migration promotion hoặc cho phép cutover dev. Không
chạy app feature trên DB dùng chung khi schema chính thức còn thiếu.

`inventoryLegacyScope` chạy trong REPEATABLE READ, READ ONLY. Snapshot root và
children gồm cycle, harvest, Lot/quantity/custody, Shipment/tracking/telemetry,
sensor, compliance, QR, trace/outbox/proof. Artifact chỉ chứa ID/count/digest;
không chứa QR token, payload riêng, email, password hoặc credentials. Private
trace hash được kiểm trước khi tạo inventory. Event không resolve được root
chặn inventory và cần đối soát riêng; không tự gán chain từ entity/org relayer.

Trên DB test mới đã áp dụng migrations và SQL draft:

```powershell
$env:HYBRID_DRAFT_TESTS = '1'
# TEST_DATABASE_URL lấy từ secret configuration của DB test riêng.
node --import tsx apps/api/scripts/hybrid-legacy-inventory.ts inventory C:\isolated-evidence\inventory.json
node --import tsx apps/api/scripts/hybrid-legacy-inventory.ts check C:\isolated-evidence\manifest.json <independent-digest> <source-sha>
node --import tsx apps/api/scripts/hybrid-legacy-inventory.ts plan C:\isolated-evidence\manifest.json <independent-digest> <source-sha> C:\isolated-evidence\assignment-plan.json
```

Lệnh inventory tạo file mới, không ghi đè artifact cũ. Không đặt URL trong
command line hoặc báo cáo. `check` luôn trả `cutoverReady: false`: manifest
đúng chưa thay cho apply/provenance/assignment/journal/rehearsal gates.

`plan` cũng chỉ đọc trong cùng snapshot, kiểm manifest pin và current preflight
authority trước khi tạo file mới. Proposal PRODUCTION gắn Cycle/producer,
TRANSPORT gắn Shipment/transporter, RETAIL gắn Lot/retailer của Shipment đó.
Lot chưa có Shipment không tự suy ra retailer. Cùng org nhiều công đoạn vẫn
có proposal riêng; tất cả giữ PROPOSED và cần xác nhận bên nhận. Khóa proposal
và digest ổn định theo manifest/subject, không phụ thuộc thứ tự query hoặc thời
gian chạy. Thiếu root/child, đổi producer/version hoặc sai quan hệ bị chặn.
Plan không ghi DB, không thay payload/hash/proof/QR, không cấp grant, không
coi proposal là consent. `applyReady` và `cutoverReady` luôn false.

Candidate ngày 12/10 được chuẩn bị trong bản sao cách ly vì phiên làm việc
không ghi được worktree/SSH. Chưa có nghiệm thu PostgreSQL của mode `plan`,
apply/resume hoặc rollout; kiểm unit không thay cho các gate này.

Manifest schema `agritrace-legacy-scope-manifest-1` yêu cầu ID, source SHA,
environment (`isolated` hoặc `dev`), inventory digest, operator/reviewer UUID
khác nhau và review evidence digest. Từng entry có cycle/producer UUID,
expectedVersion, root inventory digest, decision và chainId. Mỗi root legacy
cần đúng một entry, sort theo cycle UUID. `MAP` cần chain UUID được xác nhận
nghiệp vụ; `UNRESOLVED` có chainId null. Không suy ra mapping từ Farm hoặc các
bên Shipment; không cấp grant mọi chain từ global role.

Pin digest canonical RFC8785 của toàn manifest giữ ở kênh độc lập với DB và
artifact; tự đổi target rồi sửa digest trong artifact không vượt kiểm. Các ID
reviewer chưa là bằng chứng chữ ký doanh nghiệp của bản C. Pilot cách ly có
identity tổng hợp, không mô tả đó là nghiệm thu đối tác thật.

Check preflight chạy trong cùng snapshot: operator SYSTEM_ADMIN hiện hành,
reviewer khác user có CHAIN_MANAGER của chủ target, target PREPARING. Các org
producer/transporter/retailer cũ phải có ACTIVE membership/capability và actor
grant tường minh trong target. Không tự provision grant hoặc coi platform user
là business actor. Target đã ACTIVE bị chặn ở preflight backfill này.

Trước apply còn phải triển khai và kiểm: paused writer/Worker snapshot,
manifest pin runtime và provenance bất biến, apply idempotent/resumable,
StageAssignment đúng subject/party, active unresolved barrier, journal bridge
kiểm quyền hiện hành trước replay và không execute lại PROCESSING thiếu journal,
hash/receipt/route/QR comparison, restore và compatible rollback. Không sửa
payload/hash/proof/journal cũ để thêm scope hoặc nâng mức trust của legacy proof.
