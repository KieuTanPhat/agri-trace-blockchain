# Controlled import route legacy — 13/10/2026

Gate tiếp theo của [ADR-003](../adr-003-hybrid-historical-ledger-route.md).
Đây là quyết định triển khai, chưa là receipt import hoặc migration production.

## Invariant và schema tối thiểu A

Giữ LedgerRouteDefinition và EventLedgerRoute của candidate. Thêm registry
LedgerRouteImport immutable chứa artifact và digest, tham chiếu importDigest từ
sidecar. Khi migration cài route guard, chụp danh sách event legacy chưa route
vào LedgerRouteLegacyRequirement immutable (event ID/hash). Không dựa timestamp
để đoán event nào là legacy và không sửa event/hash/proof/outbox.

Route insert cho legacy phải có artifact entry khớp event/hash/definition và
requirement. Event mới phải dùng WRITE definition và không mượn artifact legacy.
Definition/import/route/requirement không update/delete. DB guard kiểm quan hệ;
API/Worker/reader còn phải kiểm canonical digest và pin độc lập ngoài DB.

HISTORICAL definition không tự nhận signer/MSP cũ: authority/protocol chưa chứng
minh để null, chỉ đọc. Confirmed proof cung cấp network/channel/hash; chaincode,
contract và protocol cần reviewed descriptor/direct query evidence, không suy
từ chainId hoặc env active hiện tại. Pending chưa rõ protocol giữ unresolved.

## Artifact và apply

Artifact protocol 1 có ID, environment production/isolated, source SHA,
inventory digest và review evidence digest. Mỗi entry ràng event ID, dataHash,
event snapshot digest, definition digest và proof digest hoặc trusted paused
writer descriptor digest. Metadata không chứa credential/private key.

Inventory đọc snapshot RepeatableRead, timezone UTC; hash phía PostgreSQL toàn
row event/proof/outbox để giữ microseconds và không xuất private payload. Digest
inventory không chứa route sidecar, nên append route không làm mất rerun. Bounded
inventory/entries; batch artifact tách rõ khi cần, không scan không giới hạn.

Apply chỉ qua trusted operator CLI/release job, gate mặc định đóng. Kiểm runtime
environment/source SHA, artifact digest trong independent import pins và mọi
definition pin trước write. Giữ pins cũ sau import. Reader/Worker kiểm import
artifact digest và entry event/hash/route, không chỉ tin FK/database digest.

Giữ advisory import lock và table history locks theo thứ tự cố định, chặn concurrent
writer/claimer trước snapshot kiểm lại. Active PROCESSING lease chặn apply; không
gia hạn/xóa lease, đổi event/key, sửa journal hoặc execute domain command để vượt
gate. Pending cần descriptor đã pin chứng minh paused release/destination/protocol;
không tự gán active definition. Confirmed proof phải khớp route và giữ bytes cũ.

Apply theo thứ tự predecessor. Predecessor unresolved/ambiguous/khác destination
chặn; không đổi stream. Same artifact rerun là no-op. Mapping/provenance khác reject;
muốn xử lý phần chưa map dùng artifact mới cho phần đó, giữ old applied provenance.
Một transaction thất bại rollback registry/sidecars cùng nhau. Crash giữa các batch
không cần execute lại domain writes; batch đã commit được đối soát bằng pin cũ.

## Rehearsal và promotion

Seed legacy fixture trước khi cài route SQL; không disable trigger để giả legacy.
Fixture có confirmed histories, ordered backlog và Pending chưa xác định route.
Kiểm wrong artifact/source/environment/pin/descriptor, changed inventory, conflict,
atomic rollback, rerun/resume, proof/hash/history/journal preservation và holds.
Adapter mock chỉ nghiệm thu DB/relay contract, không gọi là Fabric VALID acceptance.

Sau import gate mới promote append-only migration/checksum: fresh DB, synthetic
sanitized legacy copy được tạo bằng writer cũ, backup/restore và app rollback hiểu
scope/route. Nếu dùng production snapshot để rehearsal thì private trace phải giữ
nguyên trong encrypted/restricted disposable copy; không redact rồi giữ hash cũ,
không log payload hoặc gọi bản copy đó là đã loại mọi PII. Có receipt và cleanup.

CI chạy exact SHA và harness trong repo; local helper chỉ là evidence bổ sung.
Production writer pause/backup/import/canary/rollback/observation theo runbook.
Không chạy draft trên DB dùng chung; không tái tạo deployment dev/nongtrace.site.

## Quyết định chi tiết cho implementation

- Batch tối đa 1.000 event, definitions tối đa 256; inventory dùng selection ID
  rõ ràng và sort ổn định. Không dùng timestamp để nhận diện legacy. Requirement
  được seal sau snapshot migration: reject cả insert mới, update và delete.
- `LEDGER_ROUTE_IMPORT_PINS` giữ digest/environment/source SHA của từng artifact;
  reader giữ pins của release cũ sau nâng cấp. `LEDGER_ROUTE_IMPORT_ENABLED=true`
  chỉ bật cho operator apply, không là quyền API. Môi trường production từ chối
  artifact isolated; không có giá trị default ngầm.
- Pending dùng descriptor `agritrace-ledger-writer-snapshot/1`, release SHA,
  environment, definition digest và trạng thái paused, được pin riêng qua
  `LEDGER_PAUSED_WRITER_PINS`. Descriptor trong DB/artifact tự nó không là pin.
  Route WRITE phải có protocol 3.0.0 và authority đầy đủ đã review.
- Khóa theo thứ tự trace event → outbox → proof → route registries. Chặn mọi
  PROCESSING chưa đối soát, kể cả lease hết hạn; không tự xóa lease để import.
- Batch atomic: artifact đã commit phải có đủ mọi sidecar cùng provenance.
  Rerun artifact đó kiểm immutable event/hash/mapping, trả no-op dù Worker đã
  tiếp tục cập nhật proof/outbox hợp lệ. Snapshot full row chỉ dùng trước apply
  lần đầu; artifact mới đụng mapping cũ bị reject. Không đổi provenance cũ.
- Worker lọc artifact đã pin trước claim và kiểm entry event/hash/definition;
  predecessor phải có provenance hợp lệ. Reader kiểm canonical artifact và
  entry tương tự. Withdraw pin giữ backlog nguyên attempt/lease và proof reader
  trả trạng thái chưa xác minh.

## Candidate đã triển khai, chưa có DB receipt

Schema/SQL candidate thêm sealed requirements, immutable import registry và FK
sidecar. API/reader xác minh canonical artifact + independent pins + entry;
Worker thêm filter import trước claim, giữ predecessor/proof destination checks.
Operator dùng `apps/api/scripts/ledger-route-operator.mjs` trong image đã build:

```text
node apps/api/scripts/ledger-route-operator.mjs inventory <absolute-event-id-list.json> <absolute-new-inventory.json>
node apps/api/scripts/ledger-route-operator.mjs register <absolute-pinned-definition.json>
node apps/api/scripts/ledger-route-operator.mjs apply <absolute-pinned-import-artifact.json>
```

Release job cung cấp `APP_RELEASE_SHA`, `LEDGER_ROUTE_OPERATOR_ENVIRONMENT`,
DB connection và pin metadata ngoài artifact. Register/apply yêu cầu gate riêng
`LEDGER_ROUTE_IMPORT_ENABLED=true`; không thêm API endpoint hoặc signer mount.
Inventory chỉ đọc, output tạo exclusive 0600. Register không nhận extra payload
vào row. Pending còn phải có private evidence/schema tương thích và descriptor
được pin riêng; không tự nâng protocol của backlog chưa rõ nguồn.

Thêm bảy unit cases và 18 DB cases: proof/history exact bytes, topo order,
snapshot microsecond, wrong pin/source/env/proof, revoked pin trước claim,
unknown/expired PROCESSING holds, immutable/sealed guards, atomic rollback,
concurrent apply, batch resume và relay progress/rerun. Seed 28 synthetic events
bằng writer schema cũ trước khi cài route guards, không disable trigger. Local
typed check/lint và 147 unit đạt trước DB; chưa ghi 132 policy/DB là pass. Draft
không chạy trên DB dùng chung hoặc production; official migration còn gate.

Lượt `546be97` đạt 147 unit/type/lint, dừng trước route SQL vì seed tạo outbox
COMPLETED thiếu completedAt; existing completed-state guard chặn đúng. Sửa fixture
ghi completedAt/nextAttemptAt theo lifecycle, không đổi guard. OOM false/restart0,
cleanup container/network/port/keeper verified. Chưa có DB import acceptance.
