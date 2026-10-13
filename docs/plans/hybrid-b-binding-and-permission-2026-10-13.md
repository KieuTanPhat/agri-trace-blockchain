# B: binding, router và quyền ledger — 13/10/2026

Trạng thái: thiết kế triển khai tiếp theo của HYB-08–11, chưa có migration/code/
Fabric acceptance B. Kế hoạch này cụ thể hóa phần B của
[plan chính](hybrid-fabric-chain-owner-plan-2026-10-11.md), không thay toàn bộ A/C.
A đang rehearsal catalog mới; không sửa API/SQL/Gateway/chaincode khi job A có
source fence. Production-only giữ nguyên; không dựng lại dev hoặc chạy test trên VPS.
Authority CA/admin/peer/signer của đối tác thật: **NotEvaluated**. Pilot tổng hợp
chỉ được ghi là nghiệm thu kỹ thuật.

## 1. Khoảng trống đã đối chiếu source

| Source hiện tại | Phần đã có của A | Khoảng trống cần B |
| --- | --- | --- |
| [route](../../apps/api/src/modules/trace/ledger-route.ts), [TraceService](../../apps/api/src/modules/trace/trace.service.ts) | Immutable definition/sidecar, independent pins, predecessor cùng destination, atomic event/outbox | `activeWriteRoute` chọn một digest từ env; không chọn binding theo chain/cycle, không có ledger epoch trong commitment. |
| [provider](../../apps/api/src/modules/blockchain-adapter/fabric-adapter.provider.ts) | Cached connection chụp đúng config/authority, tránh env redirect | Một adapter/config/identity; chưa có READ/WRITE registry, credential revision, pool/rotation/close theo binding. |
| [Worker](../../apps/api/src/modules/blockchain-adapter/blockchain-worker.service.ts) | Preclaim route/import guards, lease/SKIP LOCKED, predecessor, full tuple/VALID submit checks | Một writer/global health gate; attempt count không lưu credential/txId trước broadcast; chưa có fairness, permission barrier hoặc emergency hold. |
| [proof query](../../apps/api/src/modules/blockchain-adapter/blockchain-proof-query.service.ts) | Private access + pinned PG route/hash/proof projection | Không có live query router cho historical binding hoặc permission/attempt evidence. Không được mô tả PG read này là live Fabric query. |
| [Gateway](../../blockchain/gateway/src/adapter.ts), [config](../../blockchain/gateway/src/config.ts), [connect](../../blockchain/gateway/src/connect.ts) | Envelope 3.0.0 public allowlist, private schema 2.0.0, exact key directory | Env config, `submitTransaction` gộp endorse/submit/status, chưa persist txId trước network. Evaluate cũng dùng Fabric identity; API không thể nhận read signing key. |
| [contract](../../blockchain/chaincode/src/traceability-contract.ts), [validation](../../blockchain/chaincode/src/validation.ts), [ledger](../../blockchain/chaincode/src/ledger.ts) | Event/proof/head/history immutable append; duplicate/full tuple/hash-chain; readers 2/3 | Writer chỉ kiểm `app.role=relayer`; không chain/binding/permission registry, protected bootstrap/genesis namespace, SBE hoặc delivery fence. |

Các khoảng trống trên là work packages chưa giao, không phải lý do viết lại core.
Giữ domain/quantity/custody, journal/outbox, route import provenance và mọi hash cũ.
Hai migration A là required schema floor; B chỉ thêm migration append-only sau A.
Source migrations A chưa là production approval; B không được bỏ qua gates của
[migration/release A](hybrid-migration-and-release-2026-10-13.md).

## 2. Quyết định giao thức và ranh giới compatibility

Logical binding bất biến gồm `protocol=agritrace-fabric-binding/1`, network,
channelId, chaincodeName, contractName, opaque chainRef, envelopeVersion,
writerAuthority, writerMspId, writerRole và governanceDigest. Digest là SHA-256
RFC8785 của đúng allowlist này. Không bao endpoint, host mode, cert revision,
private key hoặc file path. Một binding chỉ thuộc một chain; các chain có thể
chia sẻ channel khi mọi thành viên chấp thuận toàn bộ public history/metadata.

READ/WRITE revisions là transport/credential configuration của cùng logical
binding, có canonical digest/pin/reviewer và current pointer riêng. Đổi endpoint,
TLS roots hoặc credential cùng authority tạo revision mới. Đổi network/channel/
contract/MSP/logical writer tạo binding mới, chỉ dành cho stream mới; không sửa
route cũ hoặc chuyển backlog. Di chuyển peer/hosting cùng MSP/channel/authority
không tạo ledger mới. Profile SERVICE/MANAGED_ORG/SELF_MANAGED_ORG mô tả authority/
ủy quyền của từng participant; đổi nơi host không được tự nâng trust profile.

Chọn version riêng cho B: public envelope `4.0.0`, trace hash schema `3.0.0`,
route protocol `agritrace-ledger-route/2`. V2/private và V3/envelope của A giữ
nguyên validators/hash/readers; B không nhét fields mới vào envelope V3. Route V2
thêm chainRef/bindingDigest, bắt buộc WRITE 4.0.0 và full logical authority.
Migration B mở CHECK/FK theo version, giữ toàn bộ old rows; không đổi bytes A SQL.

B genesis chọn binding dưới current chain/profile/permission locks. Cycle mới lưu
origin delivery profile + binding bất biến; mọi Harvest/Lot/Shipment/CARE/SENSOR
con resolve qua cycle đó. Existing A cycles/streams tiếp tục route/protocol A từ
origin/provenance đã pin, không tự lên B khi active config đổi. Client không được
chọn legacy mode. B activation chỉ ảnh hưởng genesis được server cho phép; muốn
chuyển stream A đang chạy phải có checkpoint/history-segment task riêng. UI cho
biết rõ dữ liệu nào còn trust A, không ghi mọi history đã được B xác nhận.

### Commitment B trước chữ ký C

Private body digest dùng đúng canonical shape V2 của
[trace-hash](../../apps/api/src/modules/trace/trace-hash.ts), kể cả actor/businessData
và predecessor hash. Chỉ với event B mới, digest này là `privateBodyDigest`;
`TraceEvent.dataHash` là commitment B dưới đây. API/Worker tính lại từ private
row và immutable context; chaincode tính lại từ public tuple. Không rehash legacy.

```text
unsignedB = {
  envelopeVersion: "4.0.0", schemaVersion: "3.0.0",
  canonicalizationVersion: "RFC8785", eventId, nonce: eventId,
  entityType, entityId, cycleId, lotId, eventType, eventTime,
  previousEventHash, privateBodyDigest, bindingDigest, chainRef,
  permissions: [{ permissionRef, epoch, ordinal }, ...]
}
dataHash = SHA256(UTF8("agritrace:binding-event:b1") || 0x00 || JCS(unsignedB))
```

Mọi key phải hiện diện; nullable fields dùng JSON null, không omit. UUID lowercase,
hash lowercase 64 hex; eventTime UTC millisecond ISO. Permissions 1–16 entries,
sort theo permissionRef, không trùng; epoch/ordinal là canonical positive decimal
strings, tối đa int64, không đi qua JS floating-point. Chuỗi/array/JSON đều giới
hạn bytes trước parse; không nhận metadata lạ. `privateBodyDigest` không là chữ ký
actor. B vẫn tin technical relayer xác nhận private body và authority ứng dụng;
C cần unsigned intent/assertion/effect-root version riêng, không nhận fingerprint
V2 là chữ ký độc lập. Các fields binding/chain/permission đã được commitment B
ràng buộc, nên đổi sidecar không thể giữ nguyên dataHash rồi báo B verified.

Transport submission có `deliveryContext={generation}` riêng, không nằm trong
unsignedB/dataHash hoặc actor assertion. Credential rotation/fencing đổi transport
generation mà giữ eventId/hash/nonce/route. Contract nhận hai JSON arguments cho
`RecordBindingEvent`, allowlist riêng cho event và delivery context.

### Vector khởi đầu để khóa encoders

Dùng `u(n)=00000000-0000-4000-8000-` cộng n đủ 12 chữ số. Binding mẫu:
`network=isolated-hybrid-b`, `channelId=hybrid-b`, chaincode `agritrace`, contract
`AgriTraceContract`, chainRef u(3), envelope 4.0.0, authority
`technical-relayer:agritrace-b`, MSP `AgriTraceMSP`, role `relayer`, governanceDigest
là `22` lặp 32 lần, cùng protocol binding đã nêu.

Private body V2: eventId u(1), entity PRODUCTION_CYCLE/u(2), cycleId u(2), lotId
null, eventType PRODUCTION_CYCLE_CREATED, eventTime `2026-10-13T00:00:00.000Z`,
previousEventHash null; actorUserId u(5), organizationId u(6), role FARM_STAFF,
authProofType TOKEN_FINGERPRINT, actorAuthProof `ab` lặp 32 lần; businessData
`{farmId:u(7),productId:u(8)}`; schemaVersion 2.0.0 và RFC8785. Public unsignedB
lấy tuple đó, nonce u(1), binding/chain đã nêu, permissions
`[{permissionRef:u(4),epoch:"1",ordinal:"1"}]`.

| Vector | Expected SHA-256 |
| --- | --- |
| Canonical binding | `f34a78fd87c5dd0ef133144774c919732c8c81095903d4e2f352a3b0756a4ce0` |
| Private body V2 | `82ecc32d8bb61593552050a1a7225bf296e5a08b1a5b8188155ff5ec6d18c8e0` |
| Commitment B | `0418324c37f1d1d33116d61478920bc157b17e877d3aedf2fc166e7586df2c88` |
| Chỉ chainRef đổi thành u(9) | `e733f023c83d5a5cdca7287c867fa0cbc75b75ae6eb34c7049e9c5f0cf3cce1a` |
| Chỉ permission epoch đổi thành "2" | `a4254cc2a430ccba18ef2336a2f3ba4f1d5ce66f6378119ee5b30bd3096e7dcc` |

Năm phép tính trên khớp Node `json-canonicalize` và Python sort-key JSON cho bộ
input chỉ dùng strings/null. Đây là vector thiết kế, chưa là validator/registry/
Fabric acceptance. governanceDigest ví dụ là synthetic, không phải approval.
HYB-08 còn phải chốt fixtures Unicode/decimal/null/unknown-key/order/overflow và
cross-encoder byte equality trước migration B; không dùng Python sort-key chung
cho mọi số thực như một triển khai RFC8785 hoàn chỉnh.

## 3. Schema tối thiểu và guards

Tên dưới là module/table đề xuất, chưa được tạo. Ưu tiên typed normalized rows;
không thêm signer/key/intent C trước khi chốt protocol C.

| Nhóm | Bảng/keys tối thiểu | Guard và quan hệ bắt buộc |
| --- | --- | --- |
| Logical/transport | `fabric_network_binding(digest PK, chain_id, chain_ref, logical_tuple, governance_digest)`; `fabric_binding_revision(digest PK,binding_digest,mode,revision,credential_id,descriptor)`; `fabric_binding_state(binding_digest,mode PK,current_revision,status,version)` | Binding/revisions immutable; chain FK RESTRICT, stable chainRef composite FK tới chain profile; revision unique(binding,mode,revision); state current revision composite FK cùng binding/mode; active chỉ sau pins/probe/governance receipts. |
| Credentials | `fabric_credential_revision(id PK,logical_authority,msp,role,cert_fingerprint,not_before,not_after,secret_ref,approval_digest)` | Không lưu private key/token; secret ref chỉ resolver Worker/query service đọc được. Revision immutable, binding revision FK + trigger kiểm cùng authority/MSP/role; cert/reviewer/descriptor pin độc lập DB. |
| Genesis/profile | `chain_ledger_profile(chain_id PK,chain_ref UNIQUE,active_binding,profile,version)`; `cycle_ledger_context(cycle_id PK,binding_digest,origin_profile)` | ChainRef của chain immutable; current profile cho future genesis; cycle context immutable/composite FK cycle.chainId–binding.chainId, không backfill A thành B. Profile transition có command journal/audit/current approvals. |
| Event context | `event_binding_context(event_id PK,definition_digest,binding_digest,private_body_digest,commitment_version)`; `event_permission_epoch(event_id,permission_ref PK,epoch_digest,enqueue_ordinal)` | Event FK RESTRICT; composite event+definition FK cùng EventLedgerRoute; cycle/chain/route/binding phải khớp. B event bắt buộc context + 1–16 permission rows trước commit, các rows immutable. unique(permission_ref,enqueue_ordinal). |
| Permissions | `ledger_permission_epoch(digest PK,permission_ref,epoch,binding_digest,subject_snapshot,allowlist)`; `ledger_permission_sync(permission_ref PK,requested_epoch,confirmed_epoch,state,next_ordinal,barrier_ordinal,version,last_receipt)` | Epoch unique(ref,epoch), immutable canonical snapshot. Subject là explicit scoped grant hoặc device authority revision, đúng một loại, FK/check; opaque public ref không lộ user/grant ID. Sync mutable chỉ state machine, receipt FK và CAS/version; không tự ACTIVE từ DB alone. |
| Control jobs | `ledger_control_job(request_digest PK,binding_digest,expected_revision,operation,proposal_digest,lease_state)`; `ledger_control_receipt(request_digest PK,tx_id,validation_code,ledger_revision,result_digest,recorded_at)` | Job stable canonical/idempotent, dedicated outbox vì business outbox cần event FK. Receipt append-only, unique(network,channel,tx_id), VALID + tuple/revision match; status của job không thay business proof. |
| Delivery audit | `delivery_attempt(id PK,outbox_id?,control_request?,lease_token,binding_revision,credential_revision,tx_id,generation,envelope_digest,prepared_ref)`; `delivery_attempt_outcome(attempt_id,sequence PK,state,receipt_digest,reason)` | Exactly one subject; FK RESTRICT; unique(binding,channel,tx_id); attempt PREPARED được lưu trước network. Outcomes append-only monotonic, VALID terminal không rewrite. prepared bytes chỉ public protocol, restricted encrypted storage + digest, không private key/businessData. |
| Holds | `delivery_hold(id PK,scope,binding,authority?,permission_ref?,event_id?,reason,opened_at)`; `delivery_hold_resolution(hold_id PK,review_digest,decision,receipt_ref)` | Scope enum + CHECK đúng selector; explicit append-only resolution, không DELETE/clear bằng reset outbox. Index active holds bằng anti-join resolution. Quyền resolve/review tách requester. |

Scoped grants ứng dụng vẫn kiểm hiện hành ở mọi API. Ledger permission là bản
đồng bộ explicit cho subject/epoch đã review; tạo grant/membership ở DB không tự
cấp quyền ledger. Khi một command phụ thuộc nhiều grants/party consents/device
epochs, event chụp toàn bộ permission refs cần thiết, không chỉ một user role.
ORG_ADMIN/CHAIN_MANAGER không tự đăng ký MSP/relayer hoặc tự approve registry.

Giữ outbox/proof hiện có để không đổi domain journal. B thêm indexes theo binding,
permission/state/due time; không clone domain rows. DB triggers chặn direct SQL
thiếu context, mismatched epochs/ordinals/definitions và update/delete provenance.
Prisma diff chỉ đọc; migration floor B nối A và checksum approval riêng.

## 4. Transaction, API và read routing

Lock order chuẩn: authority organization/user/session theo A → sorted chain/
permission refs → binding/profile → aggregate/stream → outbox. Enqueue/revoke cùng
permission lock nên có một ranh giới xác định; không gọi network khi giữ DB locks.
Business command vẫn current-authority-before-replay. Positive journal replay
không enqueue event/control job mới; mất response dùng body/key/version gốc.

Enqueue B trong transaction domain/journal: resolve immutable cycle binding; kiểm
chain/binding ACTIVE và pinned descriptors, confirmed permission epochs, không
active hold; khóa mỗi sync row, cấp ordinal và lưu immutable event permission set;
tính private/body commitment; ghi event, route/context/outbox/journal nguyên tử.
Permission chưa confirmed hoặc đang revoke/hold trả conflict/service unavailable
có code ổn định trước domain mutation. Network outage sau permission ACTIVE vẫn
cho authorized command tạo Pending theo policy; outage không giả là grant ACTIVE.

Các API quản trị đề xuất, chỉ thêm sau HYB-08 vectors/guards:

| Contract | Quyền/behavior |
| --- | --- |
| GET `/supply-chains/:id/ledger-status` | Current chain access; projection profile/activation/Pending/revoke/hold, không endpoint/key/admin descriptors. |
| POST `/supply-chains/:id/ledger-profile/activate` | Current owner manager + pinned operator/governance approval; expected version, key/journal; chỉ future genesis, không remap existing cycles. |
| GET `/ledger-bindings/:digest/status` | Operator hoặc auditor được giao; sanitized health/revision/governance/permission counts. |
| POST `/ledger-bindings/:digest/revisions/:revision/activate` | Pinned operator + approvals/health/TLS/MSP checks; registry command, không nhận arbitrary URL/key path từ HTTP. |
| POST `/ledger-permissions/:ref/grant`, `/revoke`, `/emergency-hold` | Phân quyền platform/chain/org rõ, current scope + expected epoch/version; enqueue control intent, không trả ACTIVE trước VALID receipt. Emergency chỉ đúng scope. |
| GET `/delivery-attempts/:id/status`, POST `/delivery-holds/:id/resolve` | Operator/reviewer riêng; original request reconcile, bounded reason/evidence digest, không sửa event hoặc tạo proof tùy ý. |

Không mở HTTP endpoint chứa private credential/artifact bytes hoặc channel admin
signer. Administrative CLI nhập artifact reviewed/pinned bằng exclusive regular
file paths; Network/Fabric admin approval đi control-plane riêng. Swagger từ Nest
và generated Web types tiếp tục source of truth; API không ký Fabric.

Historical/live query đi internal read service của Worker tier, resolve đúng event
route/binding + READ revision hiện hành được approve cho chính destination đó.
API kiểm private scope trước/sau await và trả projection; never mount read signing
key vào API. Read-only Fabric identity/ACL ở query tier có quyền evaluate/QSCC phù
hợp, không Record/registry writes. Old A routes dùng explicit READ descriptor pin,
không fallback active B binding; unknown route giữ unresolved. Paged history chọn
stream route + scoped bookmark ràng binding/channel/entity/filter, không trộn các
channel hoặc đọc unrelated ledger để tìm event. TLS/peer/genesis identity pin phải
khớp logical network; channel name giống nhau không chứng minh cùng network.

## 5. Worker pool, attempts và credential rotation

Pool key `(bindingDigest,mode,bindingRevisionDigest,credentialRevisionId)`; config
snapshot immutable, single-flight connect theo key, bounded LRU/refcount + idle
close. READ/WRITE khác credentials/capabilities. Reload approved cursor atomically,
new claims dùng revision mới; in-flight attempt giữ revision cũ đến terminal hoặc
unknown reconciliation. Không đổi label của cached adapter khi env/descriptor đổi.

Scheduler chia quota nhỏ round-robin theo eligible binding, circuit breaker/backoff
và health theo binding. Một binding lỗi không chặn claim/health của binding khác.
Preclaim kiểm pins/permission/hold/predecessor/protocol/cert; thiếu health/authority
không tiêu attempt/lease. Sau claim kiểm lại dưới current hold/permission fence,
lease token giữ chống stale completion. Gateway outage/endorsement thiếu giữ
Pending/retry có reason; không đổi channel hoặc hạ endorsement policy.

Thay `submitTransaction` shortcut bằng flow SDK có sẵn trong installed declarations:
`contract.newProposal` → `proposal.getTransactionId()` → persist PREPARED attempt →
`proposal.endorse()` → persist endorsed/public bytes digest → `transaction.submit()`
→ `submitted.getStatus()` → full `GetProof` tuple/commitment/destination checks.
Persist txId trước lần network đầu; không log serialized proposal/identity hoặc
private artifact. VALID proof + attempt outcome + outbox completion commit cùng
transaction dưới original lease token. Lease mất chỉ bỏ completion của worker cũ;
không xóa ledger receipt, attempt hoặc unknown status.

Một transport exception sau possible broadcast thành UNKNOWN, không coi là absent
hoặc tự dead-letter rồi resend bằng cert khác. Reconcile txId trên đúng binding
bằng approved READ identity, committed event/proof và VALID transaction evidence.
`GetProof` tuple lệch, fork/lag/unavailable hoặc tx status chưa rõ giữ hold; single
peer NOT_FOUND không chứng minh old tx không commit muộn. Retire credential cũ chỉ
sau mọi attempts đã terminal hoặc fenced; key quarantine/revocation không xóa audit.

### Fencing unknown B attempts khi credential hết hạn

B `RecordBindingEvent` luôn point-read ledger key
`deliveryFence(chainRef,eventId)`; key absent nghĩa generation 0. Nó kiểm generation
và pinned expected event commitment nếu có fence. Không đưa generation vào dataHash.

Control operation `FenceDeliveryAttempt` ràng eventId/binding/dataHash/old txId,
được governance/control authority cho phép. Cùng transaction nó đọc event key:

- Event đã có: trả existing committed tuple để reconcile, không tạo event khác.
- Event absent: CAS fence generation +1, pin expected dataHash/binding, ghi receipt.
  Chỉ sau fence tx VALID và matching state receipt mới được tạo attempt mới bằng
  approved credential cùng authority và business tuple/hash/nonce cũ.

Old proposal đã simulate generation trước fence sẽ bị MVCC invalid nếu được order
sau fence; nếu đã VALID trước fence thì event-read phát hiện và reconcile. Test cả
hai thứ tự và fence response loss. Unknown fence cũng phải reconcile trước bước
tiếp, không tăng generation/key mù. A/V3 chưa đọc fence nên không áp đường này cho
unknown legacy; giữ reconciliation hold/manual gates của A. C intent expiry/revoke
sau này vẫn có thể cấm retry dù B transport fence đã an toàn.

## 6. LedgerPermissionSync: grant, normal revoke, emergency

State machine tối thiểu: REQUESTED → PENDING_LEDGER → ACTIVE;
REVOKE_REQUESTED → DRAINING → PENDING_REVOKE_LEDGER → REVOKED;
EMERGENCY_HOLD → PENDING_EMERGENCY_REVOKE → REVOKED_REVIEW_REQUIRED.
Retry giữ request/epoch/proposal identity; unknown control commit giữ pending và
query current ledger revision/txId, không tự cấp epoch mới. ACTIVE chỉ khi VALID
control receipt, public key/state digest và requested epoch match, ghi CAS dưới
sync lock. DB/ledger không được mô tả như một atomic transaction.

Normal revoke:

1. Khóa đúng permission refs cùng order enqueue; chặn command mới ngay ở DB,
   ghi `barrierOrdinal=nextOrdinal-1` và REVOKE_REQUESTED/control intent/journal.
   DB scoped-grant revoke và barrier cùng transaction khi liên quan; regrant không
   hồi sinh old epoch hoặc consent. Không chờ network trong transaction này.
2. Drain đúng tập event permission rows ordinal ≤ barrier thuộc old epoch; giữ
   old ledger permission ACTIVE để authorized queued events đi tiếp. Không cho
   ordinal mới, không đánh dấu revoked-on-ledger khi chỉ DB đã revoke.
3. Mọi captured event cần matching VALID proof, hoặc explicit governance disposition
   có receipt; DEAD_LETTER/expired lease/unknown/timeout không là drained. Reconcile
   in-flight attempts/fences trước revoke. Nếu Fabric outage, API vẫn chặn và ledger
   revoke giữ pending; UI nói rõ pending, không bỏ barrier để queue xanh.
4. Sau closure receipt của tập drain, enqueue/commit ledger revoke expected revision.
   Chaincode reads epoch state ở mỗi event simulation; revoke tx cập nhật cùng key,
   nên proposal stale bị MVCC invalid khi revoke được validate trước nó. Xác nhận
   receipt rồi REVOKED; eventTime backdated không phục hồi quyền đã revoke.

Emergency compromise:

- Transaction DB mở hold theo event/permission/logical authority **trong binding**,
  chặn new enqueue/claim ngay, không drain mù. Chặn credential resolver cho authority
  bị nghi ngờ; giữ existing event/outbox/attempt/hash/journal.
- Control-plane ưu tiên revoke epoch/authority trên ledger ngay khi reachable.
  Revoking một chain không revoke toàn MSP hoặc mọi channel của partner. CA/MSP
  certificate revocation rộng chỉ dùng nếu đúng certificate/key bị compromise,
  theo admin authority riêng và impact inventory đã review.
- In-flight transaction có thể đã VALID trước ledger revoke; không thể undo.
  Reconcile tx/block order và original tuple; giữ authorization review hold đến
  reviewer resolution, không tự ký thay hoặc báo mọi Pending là VERIFIED.
- Tách technical ledger confirmation khỏi authorization-review state. QR/proof
  aggregation phải kiểm active hold; ledger VALID nhưng chưa review vẫn có warning/
  PENDING_REVIEW. Không sửa proof/hash lịch sử để che incident hoặc tự clear hold
  bằng restart/retry. Recovery cần current approvals, fresh epoch nếu được cấp lại.

Không dùng actor/business timestamp làm nguồn quyền. Chaincode đọc actual current
registry epoch/status bằng ledger keys và MVCC; revocation/state order mới là gate.

## 7. Chaincode registry, bootstrap và namespace

B channel mới dùng protected namespaces: `b1.binding`, `b1.permission`,
`b1.governanceProposal`, `b1.governanceApproval`, `b1.writerCredential`,
`b1.deliveryFence`, cùng
`b1.event/proof/head/history` keyed chainRef/binding/entity. Old V2/V3 namespaces
và read dispatch giữ nguyên; B duplicate comparison bao full public context +
commitment. Proof không trộn legacy head hoặc khẳng định chain từ sidecar A.

Governance descriptor pin bootstrap trust/MSPs/channel/profile, expected namespace/
contract, endorsement policy và approval thresholds. Chọn pilot với descriptor
readonly/hash-bound trong reviewed chaincode package, bound tới channel/network
bootstrap artifact và approved definition. Không lấy required-admin MSP list từ
HTTP/DB/env chưa pin. Production dynamic governance chỉ được bật sau review riêng
về việc anchor descriptor vào channel/config authority; không giả contract có thể
tra PostgreSQL hoặc tự biết MSP đáng tin.

Registry writes cần proposal canonical ID/nonce/expected revision + admin approval
transactions riêng cho từng MSP được descriptor yêu cầu. `ApproveRegistryChange`
kiểm invoker MSP/admin attributes/current governance epoch, ghi immutable approval;
execute đọc đủ approval keys và revision, consume proposal đúng một lần. Business
relayer `app.role=relayer` không tự tạo grant/binding/authority. Peer endorsement
không được mô tả như chữ ký đồng ý của người quản trị doanh nghiệp.

Bootstrap pending không mở business write. Chaincode-level endorsement policy của
B channel bảo vệ ngay lần create key, ít nhất peer AgriTrace + owner MSP theo pilot;
sau đó đặt SBE cho mutable binding/permission/fence/head keys phù hợp governance.
Event/proof/history chỉ append từ `RecordBindingEvent`, không generic put/update.
Mọi path tạo event/proof/head/index đều kiểm cùng registry và policy; không chỉ SBE
ở head rồi để create event namespace khác vượt gate.

Logical authority của invoker lấy từ trusted-CA attribute `app.authority` cùng
MSP và `app.role`; không nhận value do envelope/client tự khai rồi so với chính nó.
Registry `b1.writerCredential(bindingDigest,authority,certFingerprint)` lưu approved
credential status/revision. Chaincode tính fingerprint DER cert thực của invoker,
đọc credential key vào RW set và kiểm allowlist/validity/current authority. Rotate
cert cần governance confirmation của credential mới trước cursor Worker activate;
revoke credential không đổi event route/logical authority. Proposal đã endorse
trước credential revoke chịu MVCC nếu registry key đổi trước validation. Không coi
mọi identity cùng MSP có attribute relayer là cùng authority được phép mọi chain.

`RecordBindingEvent` kiểm channelID, pinned binding/network descriptor, chainRef,
writer logical authority/MSP/role, permission epochs/allowlists, delivery fence,
nonce/event tuple, commitment và predecessor before any putState. Read permission
keys vào RW set; registry update/revoke race dùng MVCC, không dựa cache/time claims.
Thiếu endorsement/approval hoặc wrong MSP/role/genesis/binding không commit VALID.

B strict channel phải chặn entrypoint `RecordTraceEvent` V3 để không downgrade bỏ
binding checks. Channel bootstrap policy explicit `allowLegacyV3Writes`; thiếu
bootstrap fail closed. Legacy channel chỉ enable V3 bằng descriptor/pause/approval
đã review; readers vẫn đọc V2/V3. Upgrade legacy chaincode cần writer pause/bootstrap/
compatible rollback rehearsal; pilot B không tự thay policy production legacy.
Health báo supportedRead/writeVersions, registry protocol/bootstrap digest và modes;
Worker kiểm capability đúng binding, không chỉ chuỗi `status=OK`.

## 8. Hosted/self-managed join, rotation và restore kỹ thuật

Pilot cách ly gồm AgriTrace MSP, owner MSP riêng và partner SERVICE; channel mới
không chứa unrelated legacy history. Quyền đọc public ledger được các bên review
trước join; raw sensor/PII/prices/business body ở off-chain. PDC chỉ thêm khi cần
chaincode private data, với dissemination/hash-leakage/availability tests riêng.
Offboard không tuyên bố xóa ledger bên peer đã tải.

1. Inventory/channel-genesis/TLS/MSP/config/lifecycle descriptors được pin; admin
   approval receipts tách platform/channel/chain manager. Tạo authority/kho key
   riêng, UID/volume/network/quota/backup ownership, không copy key vào API. Hosted
   signer có explicit delegated authority; tự host không tự thành enterprise-owned.
2. Enroll/register technical identities trong CA cách ly đúng role/MSP, admin và
   relayer tách; verify TLS SAN/roots/fingerprints, channel join/sync height, chaincode
   package/definition/sequence/endorsement. Registry pending trước explicit bootstrap.
3. Peer owner query/endorse thực, missing peer/endorsement giữ Pending. SELF_MANAGED
   technical peer giữ CA/admin/signing material ngoài app/Worker; nếu Worker cần
   enterprise transaction signer phải remote signing/ủy quyền rõ, không chép key
   rồi gọi independent. B relayer có thể vẫn SERVICE; chữ ký actor của C là gate khác.
4. Rotate TLS/relayer cert với Pending + UNKNOWN; tạo approved revision cùng logical
   authority, current cursor CAS, drain/close old connections và fence/reconcile.
   Peer relocation cùng Org/channel giữ ledger/storage bootstrap; không re-anchor.
5. Backup encrypted riêng CA/MSP/config/peer ledger/stateDB + DB route/attempt/pins,
   restore vào fresh isolation, compare fingerprints/height/hash/history/QR và registry
   revisions. Test private-data missing nếu dùng PDC; no key reset/channel genesis reset.
6. Restore compatible app/Worker image hiểu A+B floors/protocols. Technical same-host
   containers kiểm logical isolation; host-failure/second-machine và partner-held
   authority chỉ Passed khi có đúng topology/receipt thật. Nếu chưa có máy/partner
   phù hợp, ghi NotEvaluated, không đổi tên fixture thành self-managed production.

## 9. Sequencing, ownership boundaries và gates

| Bước | Thay đổi cụ thể sau source fence A | Điều kiện chấp nhận trước bước tiếp |
| --- | --- | --- |
| B0 / HYB-08 | Chốt B unsigned body/route2/binding/permission/control/fence descriptors + vectors; inventory version consumers và threat/governance review. | Independent encoders khớp bytes; privacy allowlist; C không bị ép vào fingerprint V2; A catalog/rehearsal receipt giữ riêng. |
| B1 / HYB-09 | Append B schema/guards + pure canonical validators/versioned readers; chain profile/cycle origin selection; no public runtime enable. | Fresh/legacy A copy, zero Prisma diff/constraints, direct SQL negatives, immutable rows và old journal/proof/hash giữ nguyên. |
| B2 / HYB-09 | READ/WRITE registry/resolver/pool, transport attempt persistence, fairness và historical query router. | Two-binding outage isolation, cached-env/endpoint mismatch, credential fingerprints, stale lease/restart/lost-response và exact tuple tests. |
| B3 / HYB-10 | Chaincode protected bootstrap/namespace/registry/fence + Gateway staged flow, health version dispatch. | Real Fabric VALID/invalid validation codes, wrong MSP/role/create-key/head/downgrade/approval negatives; A V2/V3 mixed-reader regressions. |
| B4 / HYB-09/10 | PermissionSync/control jobs, enqueue ordinal snapshots, normal barriers/drain và emergency hold/proof projection. | Grant pending blocks all writes; revoke/enqueue and MVCC races; deadletter/unknown not drained; compromise/outage pending truthful; fence reorder/response-loss. |
| B5 / HYB-11 | Hosted/self-managed technical join, TLS/cert/admin governance, relocation/backup/restore runbook. | Query/endorse from correct peer, independent storage/key ownership receipt; host/real-partner limits explicit. |
| B6 / release | Exact-SHA full A+B CI, checksum floors, fresh/copy/restore/compatible image rollback, scoped production canary/observation. | No untested draft/runtime; production approval and real-partner authority remain distinct. Khi chờ topology/governance, làm C design độc lập được phép. |

Code boundaries khi parallel sau A: một owner schema/canonical+versioned readers;
một owner Gateway/provider/router/attempt; một owner chaincode/registry/technical
network. Permission integration chỉ merge sau interfaces B0; không chạy hai heavy
DB/Fabric/browser jobs tranh tài nguyên, không sửa cùng shared protocol/schema.
Root điều phối commits/source fence/CI/release; documentation có thể làm độc lập.

| Acceptance | Tests bắt buộc B |
| --- | --- |
| AC-09 | Valid hash wrong network/channel/contract/MSP/binding/chain rejected; active env/config change không redirect old backlog/proof. |
| AC-10 | Binding X outage không làm Y dừng; bounded fair batches; API Pending; restart/stale lease/unknown/duplicate không mất/trùng event. |
| AC-11 | Owner/self-managed technical peer join/sync/query/endorse; wrong signer/role, missing endorsement, create-key/head bypass và V3 downgrade không VALID. |
| AC-12 | Channel onboarding public-history disclosure reviewed; forbidden public fields/raw payload không lên ledger/artifacts; PDC negatives nếu dùng; offboarding không claim erase. |
| AC-13 | Multi-admin registry approval/rotation/revoke/relocation/restore, caller separation và key-copy/mount negative; no real-enterprise authority claim from fixtures. |
| AC-19 | Expiry/rotation cùng Pending/UNKNOWN, audit old/new credential; query first, positive delivery fence then retry; old proposal ordered before/after fence; no fake proof/changed event tuple. |
| AC-20 | Requested/unconfirmed grant blocks enqueue; normal barrier captures concurrent last event; drain includes all required permission refs; emergency hold/MVCC/outage/regrant tests. |
| AC-22 | Bad A mapping/import pin remains fail closed; legacy proof trust unchanged; B commitment context swap fails; backdated eventTime cannot bypass current revoke. |
| AC-16 + A regression | Backup/restore and compatible A+B image rollback, old hashes/journals/QR/routes intact, browser permissions/recovery and pending warnings; no skips counted as pass. |

Evidence phải có exact SHA, versions/lockfile/migration/checksum/pin descriptors,
actual counts, mock/synthetic flags, Fabric tx/block/VALID status và sanitized logs,
quota/ownership/cleanup receipts. Không gọi thiết kế, compile, mock DB hoặc một
checkpoint là hoàn tất B. Sau A → B → C vẫn phải whole-project review → plan → fix
→ verify, rồi mới đủ điều kiện shutdown theo yêu cầu người dùng.
