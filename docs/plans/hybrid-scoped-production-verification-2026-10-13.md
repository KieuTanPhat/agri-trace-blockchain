# Production verifier sau scoped A — 13/10/2026

Trạng thái: thiết kế sửa verifier/CD, chưa là implementation hoặc production smoke
acceptance. Root config/operator provisioning và source sửa phải được review trước
release; không sửa RBAC hoặc grant tự động để làm smoke pass. Dev đã retire, mọi
rehearsal dùng local/runner cách ly. Giữ production release `8ae13542` trước Hybrid
làm compatibility baseline, nhưng image đó không rollback được sau schema floor A.

## 1. Khoảng trống theo source hiện tại

| Source | Behavior hiện tại | Thay đổi cần thiết |
| --- | --- | --- |
| [targets](../../deploy/cd/targets.py) `validate_config` | `canary` chỉ nhận đúng keys farmId/plotId/productId | Thêm verification config riêng có schema/allowlist và reviewed scoped principal/chain/catalog; giữ object cũ để đọc old release. |
| [Controller.verify](../../deploy/cd/controller.py) | Đọc accounts từ private root config, gửi origin/accounts/canaryCatalog/legacyQrLotIds qua stdin; `canary` là release SHA | Chọn verifier mode theo verified release manifest/migration floor + reviewed policy, không cho caller/release HTTP tự chọn legacy fallback. |
| [verify.mjs](../../deploy/cd/verify.mjs) | Năm role logins, legacy Cycle body không chainId; positive HTTP verify mọi event bằng SYSTEM_ADMIN; Auditor logout trước proof loop | Scoped creation cần explicit chainId/current FARM grant; scoped Admin 404 là đúng. Reuse đúng party JWTs cho positive reads; giữ Auditor đến hết proof nếu cần token này. |
| [core policy](../../apps/api/src/modules/supply-chains/core-business-policy.ts) | CREATE_PRODUCTION_CYCLE thiếu chainId sau organization cutover bị 403; fresh scoped farm thuộc actor org | Canary không tự chuyển catalog/principal, không retry unscoped khi scoped fail. |
| [read filters](../../apps/api/src/modules/supply-chains/business-read-scope.ts), [access](../../apps/api/src/modules/auth/organization-access.service.ts) | Scoped private reads cần ACTIVE profile/member/capability/current CHAIN grant, producer/task assignment; SYSTEM_ADMIN không có scoped raw access | Không nới RBAC để Admin đọc proof. HTTP positive actor selection dùng metadata + explicit reviewed coverage, API còn kiểm current authority thật. |
| [proof query](../../apps/api/src/modules/blockchain-adapter/blockchain-proof-query.service.ts) | `localHashMatches` bao pinned event route/proof/private hash/sensor evidence; access được kiểm trước projection | Giữ toàn bộ assertion positive, thêm negatives theo scope; không coi trực tiếp query Fabric thay positive API permission coverage. |

Các endpoint/fields hiện hành: `/api/auth/me` trả `id`, `organizationId`,
`role.code`, `accountStatus`; `/api/chain-permissions` trả `accessRevision`, grants,
memberships, capabilities, `businessScopeActivated`, `productionChains`,
`businessChains`, `legacyPendingManifests`. **Không** có CREATE_CYCLE
`allowedCommands` trong context này; `allowedCommands` hiện thuộc Lot projection.

## 2. Root-owned verification policy và provisioning

Giữ `config.canary={farmId,plotId,productId}` legacy; thêm `config.verification`
(đề xuất) schema `agritrace-production-verification/2`, bounded allowlist. File
root-owned/private dưới shared config, regular file không symlink, 0600 và checksum
reviewed; chỉ Controller trusted đọc. Không nhận từ release manifest tùy ý, public
API, workflow input hoặc payload canary. Config không chứa signing keys/tokens;
credentials của năm account tiếp tục ở file accounts private/stdin riêng.

```text
verification = {
  schema: "agritrace-production-verification/2",
  reviewDigest, mode: "scoped-a",
  scopedCanary: {
    chainId, accountRole: "FARM_STAFF", userId, organizationId,
    grantId, grantRevision, membershipId, membershipVersion,
    capabilityRevision, profileVersion, routeDigest,
    catalog: {farmId, plotId, productId}
  },
  proofCoverage: [
    {chainId, accountRole, userId, organizationId,
     scopedRole, grantId, grantRevision, membershipId, membershipVersion}, ...
  ],
  deniedProof: {chainId, accountRole, userId, organizationId},
  legacyCanaryCatalog: {farmId, plotId, productId}
}
```

Đây là config đề xuất, không phải API DTO. UUID canonical lowercase, revision
integer không âm, digest 64 hex; bounded entries/unique selectors, keys dư bị chặn.
Mode/phạm vi proof coverage phải trùng review và schema của release. READ coverage
chỉ dùng các role slots đã login: FARM_STAFF/TRANSPORTER/RETAILER/AUDITOR; Admin
chỉ làm platform/negative check, không positive scoped business proof. `deniedProof`
chọn một trong bốn slots hiện có không có quyền ở chain đó, không thêm principal.

Provisioning là bước operator được review, ngoài verifier: target chain/profile
ACTIVE đúng scopeVersion 1, Farm/Plot/Product ACTIVE và farm org đúng FARM account,
CHAIN FARM_STAFF grant hiện hành, org capability FARM và membership ACTIVE. Explicit
read grants/assignments cho retained scoped event coverage được chốt trước rollout;
không tự grant tất cả chains/farms hoặc cấp manager thành business reader. Auditor
coverage chỉ được dùng khi existing auditor account có explicit CHAIN AUDITOR grant,
ACTIVE AUDITOR capability/member/profile cho đúng chains đã review; chưa có thì
operator review/provision riêng hoặc gate fail, không fallback Admin.

Existing legacy canary cycles có thể còn DRAFT/ACTIVE và Pending; chúng nằm trong
inventory/activation gate. Trước tổ chức canary cutover, review/map mọi active root
liên quan theo manifest/consent/provenance, import/pin routes và đối chiếu hash/QR/
proof/journal; không delete canary, đóng cycle giả hoặc suspend/regrant để né gate.
Giữ legacy catalog/history/creation key cho compatibility replay; sau cutover không
chạy thêm unscoped creation trên cùng tổ chức. New verifier không tự activate chain,
accept invitation, grant role, change capability hoặc tạo catalog trong smoke.

## 3. Chọn mode và backward compatibility

| Release/DB state | Verification mode | Canary mutation |
| --- | --- | --- |
| Current `8ae13542` chưa có A floor | Legacy mode giữ behavior cũ/API contract; không gọi endpoint A chưa tồn tại | Khi deployment yêu cầu canary và org chưa cutover: original legacy catalog/body/key; baseline/observation không tạo canary. |
| Hybrid candidate có A floor, metadata/import đã review, org chưa cutover | A verifier vẫn hiểu legacy + route-aware retention; scoped canary chỉ khi configured chain/current grant sẵn sàng | Không auto chọn legacy để né thiếu scoped policy. Source promotion không là approval mutation. |
| A scoped runtime/canary org đã cutover | Scoped-a policy bắt buộc, current exact principal/chain/catalog/route pins | CREATE_PRODUCTION_CYCLE explicit chainId; Admin/no-access private negatives; positive HTTP proof coverage mọi event. |
| Schema floor đã apply, candidate lỗi/unknown | Recovery-required/fix-forward theo A plan | Không start old8ae hoặc tạo canary bằng image thiếu floor; không DB restore để rollback app. |

Mode selection là trusted release/config decision. `canary` SHA chỉ nhận full 40
hex và body được dựng từ reviewed policy; không truyền chain/catalog vào CLI để
ghi resource tùy ý. Config file cũ thiếu verification extension vẫn hợp lệ cho old
release trước A; Hybrid release thiếu extension phải fail preflight trước writers.
Retention smoke/observation chỉ đọc, credentials lifecycle là existing auth test;
không thêm domain event hoặc reset observation window để làm khỏe giả.

## 4. Năm logins, readiness và canary replay

Giữ đúng năm logins SYSTEM_ADMIN/FARM_STAFF/TRANSPORTER/RETAILER/AUDITOR, mỗi slot
một lần/full run. `/api/auth/login` hiện limit 10/60s; tối đa hai full authenticated
smokes trong 60 giây, tính cả baseline/candidate/recovery/monitor. Retry HTTP 429
là gate failure/defer có receipt, không nới throttle, đổi sourceIP hoặc login lại.
Không thêm sixth read-only account. Reuse JWT/session đã có, không giả JWT hoặc
đọc secret signing token từ DB. Đây là upper bound, không buộc chạy hai lần trong
60 giây: admission còn tính per-route proof requests trên current throttle/runtime
(default API limit120/60s từ AppModule). Hai runs với >60 events có thể vượt proof
bucket dù chỉ login10; defer/pacing đến window được phép, giữ bound/receipt và không
nới RATE_LIMIT_REQUESTS. CD/monitor dùng shared smoke lock/time receipts, kiểm
active delivery/journal/runtime toggles trước auth. Không lấy missing traffic receipt
làm bằng chứng còn đủ budget hoặc coi429 là healthy.

Giữ health/HTTPS/docs404/CORS/PWA/Worker-enabled/no-deadletter checks. Sau login,
đối chiếu `/auth/me` principal IDs/org/role/accountStatus với policy. Với candidate
A, gọi `/chain-permissions` cho các principal sẽ dùng; scoped canary cần target có
trong `productionChains[].id`, `businessChains` và ACTIVE membership/capability,
exact current grant ID/revision. `/supply-chains/:chainId/business-profile` phải
ACTIVE/scopeVersion 1/version đúng review. Context chỉ là readiness projection,
không authority cache: API vẫn kiểm session/grant dưới command locks trước write/
replay. Mọi revoke/session drift không được hidden bằng repeated login.

DB read-only preflight đối chiếu catalog/route: Farm.organizationId == principal
organizationId, Plot.farmId đúng Farm, Farm/Plot/Product ACTIVE, scope cutover và
profile/grant/member/capability đúng policy. Active route digest phải pinned,
registered WRITE 3.0.0/authority compatible current Worker; route imports và legacy
provenance được verify. Không suy chain từ Farm/current channel/env, không cấp signer
vào API. Nếu principal/canary catalog không hợp lệ, fail trước POST mutation.

Body hiện hành theo
[CreateProductionCycleDto](../../apps/api/src/modules/production-cycles/dto.ts):

```json
{
  "chainId": "<reviewed-chain-uuid>",
  "farmId": "<reviewed-farm-uuid>",
  "plotId": "<reviewed-plot-uuid>",
  "productId": "<reviewed-product-uuid>",
  "cycleCode": "CD-<first-20-chars-of-release-sha>",
  "maxHarvestQuantity": 1,
  "harvestUnit": "kg"
}
```

Không thêm unsupported version/digest/actor fields vào DTO. Với legacy mode chỉ
omit chainId; optional startDate/plannedHarvest/note không cần trong canary. Origin
và principal giữ unchanged khi retry; dựng exact body một lần và lưu root-owned
0600 canary receipt gồm release SHA/request hash/original key/body/current intended
scope, fsync trước POST. `Idempotency-Key=cd-<full-release-sha>` giữ stable như source
hiện tại. Một SHA đã dùng legacy body không được reuse key với body có chainId:
kiểm prior receipt/positive journal trước migration/retry, giữ body/key cũ và bridge
nếu đủ current provenance; không đổi key/payload để né conflict/unknown.

POST `/api/production-cycles` bằng FARM slot, expected201. Với A key/payload gốc,
POST `/api/command-requests/status` expected200/body:

```typescript
{ operation: "CREATE_PRODUCTION_CYCLE", payload: originalBody }
```

[InspectCommandRequestDto](../../apps/api/src/common/idempotency/command-requests.controller.ts)
nhận operation/payload, original key ở header. COMMITTED phải responseStatus201
và result.id cùng cycle; query positive journal/event cùng result ID, không lấy
cached response làm evidence commit. Mất response: inspect trước; COMMITTED lấy
resource cũ và cùng-key HTTP replay khi current authority còn hợp lệ. NOT_FOUND
không là permission tạo key mới; PROCESSING/expired UNKNOWN/RECONCILIATION_REQUIRED
không execute lại. REJECTED ghi failure, không tự đổi grant/revision/body rồi gửi
key mới trong production verifier. Old8ae thiếu status endpoint giữ original
idempotent POST + read-only known resource/journal checks của compatibility mode,
không gọi endpoint A rồi coi404 là pass.

Sau successful canary và cùng-key replay, đọc cycle current `chainId`, `farmOrgId`,
status/version; kiểm một PRODUCTION StageAssignment ACCEPTED đúng chain/cycle/org,
một PRODUCTION_CYCLE_CREATED trace/outbox/route/context và một immutable command journal. Cycle
creation operation là CREATE_PRODUCTION_CYCLE; event type PRODUCTION_CYCLE_CREATED,
entityType PRODUCTION_CYCLE, entityId/cycleId=result.id. Ghi số event/journal thực
trước-sau; replay không tạo thêm Cycle/assignment/event/outbox. Đợi proof CONFIRMED
trong window180s như hiện tại, rồi toàn retained backlog drain; giữ timeout/failures.

Refresh/logout Auditor test dời sau toàn bộ positive proof/history/QR coverage nếu
Auditor token được dùng. Sau logout cũ refresh401 và familyJWT/auth/me401 vẫn phải
kiểm; không cắt auth lifecycle assertions. Cleanup logout đúng các five families
trong finally; không revoke sessions người dùng khác hoặc dùng SQL auth bypass.

## 5. HTTP proof actor selection và negatives

Verifier snapshot metadata read-only `trace_event` + Cycle/Lot/Harvest/Shipment/
EventChainContext/route/import/assignments/current grants. `assertTraceEventAccess`
resolve **lotId trước cycleId**: lot events chọn actor có quyền trên chính Lot, không
chỉ parent Cycle; cycle-only event chọn actor current cycle-read authority. Nếu cả
hai subject resolve khác cycle/chain thì integrity failure, không chọn scope tiện.
EventChainContext phải khớp persisted root và independent legacy manifest pin.

Selection deterministically từ explicit proofCoverage và metadata, không brute
force mọi principal HTTP đến khi có200, không chọn bằng actorRole lịch sử đơn lẻ.
Current read policy có union scoped roles trên user, nên account global role khác
business role không là bypass; exact scopedRole grant/cap/member phải đúng review.
Chỉ một positive HTTP call/event, chọn tối thiểu scope có thể đọc subject:

| Subject | Candidate principal trong năm slots |
| --- | --- |
| Scoped cycle | FARM slot cùng producer + ACCEPTED PRODUCTION assignment; hoặc configured CHAIN AUDITOR có current capability/member/grant; TRANSPORT/RETAIL chỉ khi cycle có related assigned Lot cho slot. |
| Scoped lot/shipment-related event | FARM producer có assignment gốc; TRANSPORT slot chỉ đúng Shipment/ACCEPTED TRANSPORT assignment; RETAIL chỉ đúng Lot/ACCEPTED RETAIL assignment; explicit scoped Auditor khi đã review. |
| Legacy chưa cutover | Giữ existing organization/private read policy và Admin positive compatibility khi API cho phép; không tự upgrade legacy trust. |
| Mapped legacy sau cutover | Resolve current mapped root/manifest/pin và actor như scoped; positive bridge/private access vẫn current-authority. |
| Unresolved legacy có party cutover | Private proof404 là đúng; không đủ positive retention coverage cho rollout. Giữ direct ledger evidence nhưng fail/hold gate đến reviewed mapping/authority được giải quyết. |

Nếu một event không có eligible logged principal đã review, report covered/total và
fail gate; không bỏ event, gọi service layer trực tiếp hoặc giả Admin permission.
Coverage registry cần update operator review trước onboarding thêm chains không
nằm trong current budget. Không auto provision rộng để giữ smoke pass.

GET `/api/blockchain/events/:eventId/verify` positive expected200, giữ exact fields:
`eventId`, `status=CONFIRMED`, `deliveryStatus=COMPLETED`, `localHashMatches=true`,
`dataHash=event.data_hash`, `txId=proof.tx_id`, `channelId=verifiedRoute.channelId`,
`recordedAt`, cùng proofStatus/sensor invariants hiện có. Không đổi assertion thành
"200 hoặc404" hoặc coi routing missing là expectedwarning cho newly written canary.

Negative production HTTP dùng hai selected scoped events/samples, không N×roles:
SYSTEM_ADMIN expected404 dù quản trị platform; configured logged no-access principal
expected404 theo scoped lookup. Same existing nonexistent UUID expected404, response
không private row/payload/route registry và không tồn tại-dò asymmetry. Sai grants/
capability/member/session/revoke races kiểm exhaustive trong isolated suites; không
mutate production grants/disable accounts để tạo negatives. Một extra Admin write
negative nếu test riêng phải không ảnh hưởng canary key/body và throttle budget.

## 6. Retained DB, direct ledger, history và QR không giảm coverage

Giữ outbox-drain loop180s, event budget10000, no DEAD_LETTER, mọi retained event
COMPLETED/CONFIRMED. HOLD/unresolved/unknown phải failure hoặc explicit blocked
receipt, không trừ khỏi denominator để observation xanh. Chụp REPEATABLE READ READ
ONLY event/proof/QR/catalog counts như hiện tại; scope/route metadata thêm joins,
không UPDATE trace/hash/payload/proof/journal/QR hoặc lease.

Direct Fabric query mọi event và proof vẫn chạy bằng Worker technical signer/
approved READ descriptor của đúng route. Một gateway config hiện tại chỉ hợp lệ
cho route cùng destination/authority; retained historical route khác cần reviewed
read descriptor, không redirect nó sang current env. Nếu chưa có đúng query adapter,
fail gate và report thiếu coverage. Đây không phải yêu cầu cấp enterprise signer
mới hoặc mount signing key vào API. Giữ local technical relayer trust label A.

Giữ tất cả checks hiện có, và đối chiếu đầy đủ tuple khi source implementation:
eventId/entityType/entityId/cycleId/lotId/eventType/eventTime/dataHash/predecessor/
schema/canonicalization, envelopeVersion/nonce khi V3, ledger txId/recordedAt/
network/channel với pinned route/proof. Trường legacy thiếu giữ đúng reader schema
legacy, không tự thêm chain/signature trust. `privateTraceEvidenceMatches` và sensor
window rules vẫn bắt buộc trên HTTP projection; direct ledger không thay chúng.

Fingerprint compatibility giữ `event:<id>` SHA256 của immutable row snapshot,
`proof:<id>` SHA256 `[tx_id,proof_hash,channel_id]` như baseline hiện tại. Retain
118 old fingerprints và identity/key receipts trước A; mọi old event/proof hashes
khớp, current count chỉ có thể tăng vì authorized canary. Context/import registries
có fingerprint sidecar riêng; không sửa old fingerprint để bỏ failures. Nếu sau này
schema B thêm cột TraceEvent, cần versioned fingerprint contract/cross-version
receipt riêng trước deploy, không tùy tiện hash JSON row shape mới rồi gọi old drift.

History group theo persisted stream **và route destination**, không trộn cùng UUID
ở channels khác. Giữ head.eventCount, expected IDs, predecessor leaf/hash và full
history membership. Current `QueryEntityHistory` dừng100; group vượt100 phải dùng
`QueryEntityHistoryPage` existing adapter, bounded pageSize≤500/bookmark/no-repeat/
max10000 và exact total, không bỏ tail để pass. A source vẫn một legacy channel;
B routing/multi-binding là gate sau, không mô tả verifier A như đã có router B.

Public QR đọc toàn retained qrs: lotId đúng, route/proof timeline đúng, HTML trace
200; legacyQrLotIds catalog bất biến, expected INTEGRITY_WARNING + LEGACY_UNVERIFIED,
sensor fields/null/readingCount0, quantity/state reconciled và warnings chuẩn;
QR khác VERIFIED, mọi timeline event đúng proofStatus. Không thêm QR exception để
ẩn scoped proof failure, không delete/replace tokens. Public HTTP không thêm auth
hoặc raw registry/actor/grant IDs.

Giữ health/image/releaseSHA/CA+identity-fingerprints/API no-signer/Worker-readonly
signer/resource-budget/sequence checks của production runbook ngoài verifier.
Scope-aware auth thay principal lựa chọn, không giảm directLedgerEvents,
entityHistories, retained fingerprints hoặc QR denominator. Ledger/version/mode
fields trong receipt đủ tách A scoped confirmation với chain/signature trust B/C.

## 7. Sửa source theo thứ tự và acceptance gates

1. Root-reviewed config schema extension + policy/unit negatives: exact keys,
   scopedPrincipal IDs/revisions, bounded proof coverage, denied actor và canary
   catalog/route pins. Old8ae/config-canary3keys compatibility giữ nguyên; Hybrid
   thiếu policy phải fail trước POST/writer start. Source floor không được dùng
   generic compatibility list để cho phép rollback old image.
2. Controller dựng trusted stdin payload theo verified release/config mode, giữ
   credentials không lộ stdout; không chọn chain từ workflow/SSH argument. Lưu
   canary request receipt độc lập trước mutation; check exact bytes/digest khi rerun.
3. Verifier preflight/auth-five-logins/readiness, exact scoped DTO, original key/
   journal replay; dời Auditor lifecycle khi cần. Precompute metadata selection
   và all-event positive HTTP coverage, representative Admin/no-access negatives.
4. Giữ DB/ledger/history/hash/QR loops, thêm full tuple/route/context comparisons,
   coverage totals và safe receipt names. Network/data/auth failure không là pass;
   retry bounded/429 không nới giới hạn. Không vô tình giảm legacy readers coverage.
5. Local app+DB thật tests: legacy8ae-like no-A endpoints/catalog body; A ACTIVE
   canary scoped grant201; missing chain/preparing/revoked grant403; positive party
   proof200/Admin+noaccess404; lost-response/status/replay one event; unresolved
   legacy/mismatched pin fail; scoped actor projection không lộ sibling lots.
6. Isolated Fabric technical rehearsal cùng release/Worker/pins: actual VALID/query/
   retention/canary replay, no API signer, five logins/full run, two runs≤60s không
   vượt login10, lifecycle assertions intact. Matrix negatives dùng fixture/DB
   cách ly, không grants/keys mutation production. Source hash/containers/network/
   ports/processes cleanup receipts giữ riêng.
7. Exact-SHA CI + checksum/restore/compatible app recovery, root provision review,
   production baseline/candidate canary/retention verification và observation.
   Monitor giữ samples/gaps/failures, không infer healthy trong khoảng trống;
   observation không tạo canary mới. Gate chưa đạt thì task A chưa hoàn tất.

Receipt đề xuất thêm: verificationMode/policyDigest, `authenticatedAccounts=5`,
canary operation/request digest/resourceId/replayed/noDuplicate, HTTP proof
`eligible/covered/total`, negative sample counts, direct ledger events/histories,
legacy/verified QR, fingerprints preserved, release SHA/route/import pin digests,
mock=false/Fabric validation status, throttle/cleanup flags. Không upload email,
password/JWT/cookie/full private body/QR token/admin key hoặc raw auth errors.

Không kết luận project sạch100%, A release thành công hoặc authority doanh nghiệp
thật từ thiết kế/verifier code compile. B/C và whole-project review → plan → fix
→ verify tiếp tục theo plan chính sau các dependencies; shutdown vẫn chỉ khi toàn
bộ task và handoff/cleanup hoàn thành.
