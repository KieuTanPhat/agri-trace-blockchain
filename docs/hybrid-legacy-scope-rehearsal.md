# Legacy scope: inventory và manifest trước backfill

Cập nhật 13/10/2026: source business/legacy scope và route đã promote vào hai
migration append-only trong catalog Prisma. Candidate DB `cab1cf5b` và browser
`5bc74773` đã đạt các suite ghi tại
[review migration](hybrid-migration-review-2026-10-13.md); chưa có rehearsal cho
bytes/catalog chính thức, CD checksum approval hoặc Hybrid production rollout.
Dev đã retire; mọi rehearsal chạy local/runner cách ly. Không áp schema feature
lên DB dùng chung từ trạng thái này.

`inventoryLegacyScope` chạy trong REPEATABLE READ, READ ONLY. Snapshot root và
children gồm cycle, harvest, Lot/quantity/custody, Shipment/tracking/telemetry,
sensor, compliance, QR, trace/outbox/proof. Artifact chỉ chứa ID/count/digest;
không chứa QR token, payload riêng, email, password hoặc credentials. Private
trace hash được kiểm trước khi tạo inventory. Event không resolve được root
chặn inventory và cần đối soát riêng; không tự gán chain từ entity/org relayer.

Các lệnh read-only dưới dùng DB test riêng đã chuẩn bị catalog migrations và
fixtures. Chúng không register/apply manifest hoặc tự mở cutover:

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

Mode `plan` đã được kiểm ở 58 cloud DB scenarios của candidate `41bbb6a`.
Apply/resume và rollout là gate riêng; kiểm unit không thay cho các gate này.

Manifest schema `agritrace-legacy-scope-manifest-1` yêu cầu ID, source SHA,
environment (`isolated` hoặc `production`), inventory digest, operator/reviewer UUID
khác nhau và review evidence digest. Từng entry có cycle/producer UUID,
expectedVersion, root inventory digest, decision và chainId. Mỗi root legacy
cần đúng một entry, sort theo cycle UUID. `MAP` cần chain UUID được xác nhận
nghiệp vụ; `UNRESOLVED` có chainId null. Không suy ra mapping từ Farm hoặc các
bên Shipment; không cấp grant mọi chain từ global role. Manifest v2 giữ các
fields này và thêm supersession theo từng root/digest đã pin. UNRESOLVED có
checkpoint riêng; final MAP không sửa/xóa được và không remap sang target khác.

Pin digest canonical RFC8785 của toàn manifest giữ ở kênh độc lập với DB và
artifact; tự đổi target rồi sửa digest trong artifact không vượt kiểm. Các ID
reviewer chưa là bằng chứng chữ ký doanh nghiệp của bản C. Pilot cách ly có
identity tổng hợp, không mô tả đó là nghiệm thu đối tác thật.

Check preflight chạy trong cùng snapshot: operator SYSTEM_ADMIN hiện hành,
reviewer khác user có CHAIN_MANAGER của chủ target, target PREPARING. Các org
producer/transporter/retailer cũ phải có ACTIVE membership/capability và actor
grant tường minh trong target. Không tự provision grant hoặc coi platform user
là business actor. Target đã ACTIVE bị chặn ở preflight backfill này.

## Controlled apply source

[migration business/legacy scope](../apps/api/prisma/migrations/20261013010000_hybrid_business_scope/migration.sql)
gom hai draft trước đây trong một transaction. Sáu bảng manifest, consent,
checkpoint, mapping, supersession và bridge giữ provenance append-only; journal
cũ không sửa. Source đã ở Prisma catalog; CD checksum allowlist vẫn chưa nhận
hai migrations mới. Dùng
[migration route](../apps/api/prisma/migrations/20261013011000_immutable_ledger_routes/migration.sql)
để seal inventory event lịch sử trước controlled route import. Không resume
Worker khi legacy routes hoặc independent pins chưa được xác minh.

Operator giữ file `HYBRID_LEGACY_MANIFEST_PINS_FILE` độc lập với DB, absolute
path, không symlink, không group/world writable trên Linux. File schema
`agritrace-legacy-scope-pins-1`, `pins` gồm `{manifest, digest, plan}`. Manifest
digest và plan digest phải khớp artifact đã review; không nhận digest/mapping
do HTTP client cung cấp. File không chứa token hoặc private payload. File mất,
sai hoặc bị withdraw làm mapped legacy private read/write/replay fail closed.

Swagger candidate có:

- `POST /legacy-scope/manifests/:id/register`: đúng SYSTEM_ADMIN/operator
  đã review, inventory/plan khớp pin, target PREPARING. Gate server
  `HYBRID_LEGACY_APPLY_ENABLED=1` mặc định đóng.
- `GET .../proposals`: chỉ proposal của org admin tương ứng và review của
  owner manager được chỉ định; không trả grant/user IDs.
- `POST .../confirm`: current session/party/role/grant/capability/membership,
  digest/revision pin; owner review riêng theo từng target chain. Cùng org
  nhiều công đoạn vẫn cần từng proposal confirmation riêng.
- `POST .../roots/:cycleId/apply`: từng root dưới maintenance table locks;
  immutable checkpoint, assignment ACCEPTED chỉ sau consent hiện hành,
  EventChainContext riêng; giữ version/timestamp/hash/QR/proof/outbox/journal.
  Rerun cùng provenance trả checkpoint cũ, không tạo lại resource. Root lỗi
  không để mapping/assignment/context commit một phần.

Cutover marker được ghi khi apply để chặn đường legacy trong giai đoạn
PREPARING; suspend/revoke không xóa marker. Active unresolved trong org bị ảnh
hưởng chặn activation. Resolution/supersession của một quyết định UNRESOLVED
đã apply cần workflow review mới, không update/delete provenance đã lưu.

Bridge protocol 1 giữ tương thích actor nghiệp vụ và creation replay; protocol
2 thêm reviewer/device authority. Các đường này đã được kiểm trong candidate DB.
Bridge chỉ lấy response từ journal khớp request hash/requester/operation,
actor role/org, root/pin và grant snapshot tại cutover. Current permission và
session được kiểm dưới transaction lock; regrant không hồi sinh journal. Old
creation replay lấy root từ journal, không mở đường fresh unscoped creation
hoặc direct Shipment. PROCESSING thiếu positive journal giữ gate reconciliation.

## Lịch sử kiểm chứng ngày 12/10

Các lượt dưới là evidence tại SHA cũ, không thay receipt hiện hành hoặc gate
rehearsal của source promotion. Failures và cleanup được giữ nguyên.

Candidate đã qua local API 130 unit/typecheck/lint/build, Swagger sinh 93 ops.
PostgreSQL apply/consent/bridge/privacy scenarios còn phải chạy trước kết luận.
Lượt alignment/replay trước `4a40fac` đạt 130 unit/30 SQL/zero-drift và 6 unique
guards, nhưng 57/59 DB do TraceService chưa ghi version vào row. Đã thêm explicit
version vào row và assertion unit; giữ failure, chưa tính candidate mới Passed.

`4cb87df` tiếp tục đạt 130 API unit và zero-drift/sáu unique guards khi có cả
legacy draft, nhưng SQL scenarios dừng vì guard trả thông điệp lỗi khác baseline
(`omitting-chain-cannot-bypass-cutover`). Đã giữ nguyên thông điệp INSERT/UPDATE
của guard gốc; không sửa assertion hoặc nới invariant. Job terminal và
container/network đã dọn. Evidence lỗi:
`/opt/agri-trace-admin/hybrid-scope-draft/fce7466263ece890-1791802941417938654`.

Web candidate thêm `/supply-chains/legacy/:manifestId` để từng tổ chức xác nhận
công đoạn và owner review. Response chỉ có tên chuỗi/subject và digest đã review,
không có grant/user IDs. Account/access revision/manifest đổi sẽ bỏ response cũ;
refresh cùng scope giữ retry key chưa rõ kết quả. Pin withdrawal đổi UI access
revision, không đổi business command fingerprint. Local Web đạt 173 tests và
lint/typecheck; browser/mobile còn phải kiểm với API thật trên DB cách ly.

`483840c` đạt 130 API unit, 30 SQL, zero-drift/sáu guards, ORM và 65/66
policy/DB/HTTP scenarios. Các đường apply/consent/pin withdrawal đã chạy trên
PostgreSQL thật. Scenario bridge đã replay positive journal và giữ journal cũ,
nhưng fixture PROCESSING expired bị `chk_idempotency_expiry` chặn trước hai
assertion cuối. Đã đặt createdAt trước expiresAt trong fixture; giữ invariant,
không sửa constraint. 112 legacy chưa chạy tới. Job terminal/cleanup đã kiểm;
failure evidence:
`/opt/agri-trace-admin/hybrid-scope-draft/fce7466263ece890-1791803930687297149`.

Candidate tiếp theo đóng legacy khi producer **hoặc** một bên Shipment đã
cutover, kể cả partner revoke/suspend sau đó. SQL read predicates, private
direct-ID/proof và core/device writes dùng cùng barrier; DB chặn tạo Shipment
legacy với bên đã cutover. JWT guard lấy marker tổ chức từ DB, không từ claim.
Legacy command lấy org scope lock để serialize với cutover. Bổ sung PostgreSQL
scenario producer chưa cutover/partner đã cutover. Local API 130 unit đạt lại
sau cập nhật fixture relation; Web production build/173 tests đã đạt.

Gate tiếp theo: full PostgreSQL/HTTP/legacy regressions, participant/concurrency
coverage, paused writer/Worker snapshot và independent pin deployment, DB mới/
copy rehearsal, restore, migration/checksum/compatible rollback, browser/mobile
và CI/CD đúng SHA. Không sửa payload/hash/proof/journal cũ hoặc nâng trust legacy.
