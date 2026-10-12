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
