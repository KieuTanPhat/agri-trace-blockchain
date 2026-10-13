# C: commitments, actor signatures và handover — 13/10/2026

Trạng thái: thiết kế HYB-12 sau dependencies A/B, chưa triển khai hoặc nghiệm thu
C. C chỉ mở trên stream mới có profile được pin; không thay old A envelope 3/hash2,
không mô tả fingerprint hiện tại là chữ ký thật. Theo
[plan A→B→C](hybrid-fabric-chain-owner-plan-2026-10-11.md) và
[B binding/permissions](hybrid-b-binding-and-permission-2026-10-13.md). Production
only, không dựng dev; real enterprise CA/admin/peer/key authority **NotEvaluated**.

## 1. Source gaps và compatibility

| Source | Behavior hiện tại | C phải bổ sung |
| --- | --- | --- |
| [TraceService](../../apps/api/src/modules/trace/trace.service.ts), [hash](../../apps/api/src/modules/trace/trace-hash.ts) | random eventId, schema2/RFC8785, actor fingerprint; route/event/outbox atomic | Preallocate stable effects trước signer; signed effect root + assertions ngoài hash private, schema dispatcher. |
| [private evidence](../../apps/api/src/modules/trace/trace-evidence.ts) | Chỉ schema2/RFC8785 + actorAuthProof64hex | Không nhét signatures vào field cũ hoặc đổi regex chung; validator C riêng recompute body/leaf/root/assertion/event commitment. |
| [command transaction](../../apps/api/src/common/idempotency/command-transaction.ts), [reconciliation](../../apps/api/src/common/idempotency/idempotency.service.ts) | Current authority dưới locks trước mutation/replay; immutable positive journal; không network trong DB transaction | Intent consume/nonce/assertions/versions cùng domain+trace+outbox+journal; giữ original request body/key khi response lost. |
| [Shipment transitions](../../apps/api/src/modules/shipments/shipments.service.ts), [custody](../../apps/api/src/modules/lots/lot-custody.ts) | Một TRANSPORT command start/arrive đổi Shipment+Lot, custody theo state/timing; FAILED không tự returnFarm | C cần from/to dual confirmation trước đúng transition; A/B direct endpoints phải bị chặn trên C stream. |
| [plan finalize](../../apps/api/src/modules/supply-chains/shipment-plan.commands.ts) | Ba consent current grant/revision, atomic Shipment/assignments/event; INTERNAL labels | Consent của A không tự là actor signature C; cùng org vẫn hai stage confirmations có nhãn, không ký hộ partner. |
| [Web recovery](../../apps/web/src/lib/command-recovery.ts), [forms](../../apps/web/src/components/data-form.tsx), [actions](../../apps/web/src/components/action-panel.tsx) | Original JSON/key saved trước write, named locks/account scope; terminal bỏ body/private cached result | Prepare/view/sign/submit tách riêng; signatures/public key refs có bounded private package; không lưu private key, không auto-resign UNKNOWN. |
| [Gateway](../../blockchain/gateway/src/adapter.ts), [contract](../../blockchain/chaincode/src/traceability-contract.ts), [validator](../../blockchain/chaincode/src/validation.ts) | V3 public tuple và technical relayer; C fields chưa có | New envelope/commitment/path/key/permission registry dispatch; B protected namespaces/MVCC/attempt fence giữ nguyên semantics. |

Dependencies: A official schema/restore/compatible rollout, B0 protocol review và
B binding/router/permission/governance/control receipts. C schema chỉ append sau
review vectors; không sửa A/B applied migrations hoặc rehash legacy. B đề xuất
4.0.0/hash3; C dùng envelope **5.0.0**, private hash schema **4.0.0**, route protocol
version mới hỗ trợ C. Readers 2/3/4/5 được dispatch explicit; unknown version fail
closed. Global env/profile change không nâng old stream, không đổi giữa handover.

## 2. Key authority và lifecycle

Chọn C1 algorithm Ed25519, public key SPKI DER canonical + raw signature64bytes
base64url không padding. Key fingerprint SHA256(SPKI DER); keyRef opaqueUUID,
keyEpoch positive decimal string. Validate strict algorithm/OID/length/canonical
encoding, không nhận arbitrary cert chain/algorithm hoặc RSA/EC qua regex chung.
Public key không là authority nếu chỉ được client gửi lên cùng chữ ký.

Key register bắt buộc proof-of-possession challenge gắn keyRef/orgRef/chainRef/
binding/role/policy/nonce, admin owner authorization và B governance approvals.
Org-owned key hoặc device key thuộc legal authority đã review; mapping actorRef→
user/org/device/grant là private off-chain, public ledger chỉ opaque key/org/
permission refs và approved public key/policy digest. Grant ứng dụng không tự cấp
key authority; Org Admin không được đăng ký key doanh nghiệp khác hoặc platform
admin tự issue key rồi gọi independent.

Key runtime states: REQUESTED → PENDING_LEDGER → ACTIVE; ROTATING → ACTIVE mới,
old READ_VALID/DRAINING; NORMAL_REVOKE_REQUESTED → REVOKED; EMERGENCY_HOLD →
REVOKED_REVIEW_REQUIRED. Key revision immutable, ledger key registry ACTIVE phải
VALID+matching epoch/approval receipt trước signing intent execution. Actor user/
org/grant/device epoch hiện hành vẫn kiểm riêng; key ACTIVE không hồi sinh revoked
session/grant hoặc consent. Current same-key regrant cần fresh intent/epoch scope,
không dùng chữ ký cũ cho payload mới.

API chỉ verify public assertions; **không giữ hoặc gọi signer tự động thay client**.
Signer là hardware/client vault hoặc remote enterprise service được người dùng/bên
chịu trách nhiệm yêu cầu ký rõ. Network signer calls không trong DB locks. C1 ưu
tiên remote signing hoặc vault có Ed25519, không giả WebAuthn/P256 là Ed25519.
Không persist raw private key trong localStorage/repo/API/Worker. Worker transaction
credential là technical relayer của B, tách actor signing key của C.

MANAGED/DELEGATED signer chỉ khi explicit acceptance/contract/authority/scope/expiry
reviewed, báo nhãn DELEGATED_PLATFORM/DELEGATED_ORGANIZATION; không quảng bá khóa
AgriTrace tự tạo là independent enterprise. SERVICE/same-org là nhãn rõ, không đổi
trust vì đã có chữ ký mathematically valid. Device/self-managed fixtures chỉ là
technical acceptance đến khi đúng bên thật kiểm soát key authority.

Historical key/epoch/public material và revocation receipts giữ append-only để
verify old confirmations. Current revoked key không cho fresh execute; private replay vẫn cần current
session/grant/scope và incident policy, không coi old retired key là current grant; old ledger signature có thể cryptographically valid và authorized
ở confirmed epoch/block order. Tách cryptoValid, authorityAtCommit, currentAccess,
incidentReview và business state. Revoked-now không rewrite old hash/proof thành
invalid; compromise incident vẫn warning/hold, không che authorization review.

## 3. Intent, reservation và exact command body

C preparation là authenticated non-domain workflow: normalize original business
body bằng typed command DTO/canonical decimals/UTC, resolve current scope/binding/
profile/required parties, capture expected versions/heads, preallocate resource+
event IDs và bounded deterministic effect plan. Không giữ DB lock khi signer chờ.
Prepare phải là idempotent command có journal riêng; không tạo business writes,
physical trace/outbox hoặc reserve stock. Người ký nhận cả human-readable summary
và canonical bytes/digests/effects để tự xác minh, không ký một opaque digest mù.

Unsigned intent `agritrace-signing-intent/1` gồm intentId, commandId, nonce==intentId,
operation, requestKeyDigest, chainRef, bindingDigest, actorRef, organizationRef,
actorRole, handoverRole (`FROM`/`TO`/null), keyRef/keyEpoch, command payloadDigest,
effectRoot/effectCount, expectedVersions, sorted permission refs/epochs/ordinals,
issuedAt/expiresAt, policyVersion. UUID/hash lowercase, all nullable keys explicit,
epoch/version/quantity decimal strings chuẩn, noJSfloat; private summary chứa body,
public package không raw payload/PII/token. Exec idempotency key được chọn trước
prepare, hashed với domain request-key:c1; raw key ở private receipt/header.

B ordinal snapshot phải biết trước khi ký. `intent_permission_reservation` cấp
ordinals dưới B sync locks lúc prepare, immutable FK intent/permission/epoch. B
barrier drain kể cả outstanding reservations: CONSUMED→exact event rows, hoặc
explicit CANCELLED/EXPIRED/STALE audit khi chắc chắn không domain journal/event.
UNKNOWN/PROCESSING không được dùng expiry để free reservation hoặc mint intent/key
mới. Reservation không stock hold; revoke chặn execution và chuyển outstanding
intent qua reviewed terminal disposition, không giả mọi allocated ordinal đã
CONFIRMED. Chỉ expiry của chưa-execute/positive-known-terminal intent được đóng.

C execute wrapper đề xuất `{intentId, assertions:[...], originalBody}`. Assertion
set sorted theo intentId/party/keyRef, originalBody JSON byte/canonical normalized
được lưu trước POST; idempotency requestHash của execute bao **toàn wrapper** như
existing service. Signed command payloadDigest bao business body, không bao chữ
ký hoặc dataHash để tránh vòng. Không ký requestHash đã chứa chính assertion.
Body/key/sig bytes original giữ khi retry; reorder/different algorithm/assertion
hoặc body với same key bị conflict, không canonicalize thành payload khác âm thầm.

API verify signature ngoài DB transaction, rồi current auth/session/org/grants/
assignments/key epochs/permissions/intent expiry và scope được kiểm lại dưới locks;
consume nonce+intent, assert versions/heads/effect plan, domain/event/route/outbox/
assertion sidecars/journal commit nguyên tử. Signer outage/expired/stale/revoked
không tạo domain event/outbox. Nếu ledger unavailable sau registry ACTIVE, valid
execute có thể tạo Pending theo B policy; không gọi Fabric khi giữ DB locks.

Expiry kiểm server nhận/commit với thời gian server được vận hành, không lấy actor
backdated eventTime. Chaincode kiểm key/permission registry current epoch + ledger
MVCC/block order; không Date.now/API query hoặc self-declared signedAt. Delayed
relay sau API acceptance vẫn cần registry/binding/permission và B drain/hold policy
cho epoch đó. Receipt acceptedAt của AgriTrace là platform attestation, không chứng
minh độc lập actor đã ký trước một giờ UTC; independent time-stamping nếu cần là
protocol/task riêng. Emergency revoke không được né bằng eventTime/signing timestamp.

## 4. Commitment không vòng và multi-effect proof

Định nghĩa `H(domain,bytes)=SHA256(UTF8(domain)||0x00||bytes)`; `HJ(domain,obj)`
đổi obj thành UTF8 RFC8785 rồi gọi H. Domains khác nhau cho command body, leaf,
node, root, unsigned intent, signature message, assertion/set và signed event.
Không ký event.dataHash chứa chính signature, không reuse B domain/hash version.

```text
commandPayloadDigest = HJ("agritrace:command-body:c1", normalizedOriginalBody)
leaf[i] = {
  effectIndex, eventId, entityType, entityId, cycleId, lotId,
  eventType, eventTime, chainRef, bindingDigest,
  payloadDigest, expectedVersions, predecessorRef, permissions
}
leafDigest[i] = HJ("agritrace:effect-leaf:c1", leaf[i])
parent(left,right) = H("agritrace:effect-node:c1", raw32(left)||raw32(right))
effectRoot = H("agritrace:effect-root:c1", U32BE(effectCount)||raw32(treeRoot))
unsignedIntentDigest = HJ("agritrace:unsigned-intent:c1", unsignedIntent)
signature = Ed25519.Sign(key, UTF8("agritrace:actor-assertion:c1")||0x00||raw32(unsignedIntentDigest))
assertionDigest = HJ("agritrace:assertion:c1", canonicalAssertion)
assertionSetDigest = HJ("agritrace:assertion-set:c1", sortedAssertionReferences)
dataHash = HJ("agritrace:signed-event:c1", signedEventCommitment)
```

Effect count1–64, index0-based canonical decimal strings. Tree preserves effect
order; recursive split tại power-of-two lớn nhất **nhỏ hơn** subtree count, không
sort hashes/duplicate-last-padding. Root wrapper commits count. Merkle path có
left/right sibling32hex và verified index/count, không chấp nhận path dài/saishape/
extra leaf. Intent signs cả root/count, command body digest, scope/binding/epoch và
expected versions. Một signature không cấp quyền append event ngoài tree đó.

Per-effect payloadDigest hash canonical private event body đã preview, gồm concrete
planned businessData/resource IDs, actor/key references, stable predecessorRef và
versions; không signatures/dataHash hoặc derived intra-command previous hash.
Command body digest khác per-effect payload digest khi handler tạo nhiều events;
private API/Worker phải recompute cả hai và so exact immutable prepared plan. Không
cho relayer ký command rồi gán private businessData khác mà chỉ giữ public tuple.

`predecessorRef` là `{kind:"EXTERNAL_HASH",dataHash:<hash-or-null>}` hoặc
`{kind:"EFFECT_INDEX",index:<earlier-index>}`. Chỉ earlier index của cùng entity
stream/destination hợp lệ. Leaf không chứa dataHash của effect trước cùng command:
C hash bao assertionSetDigest, đưa derived previousHash vào signed tree sẽ tạo
vòng root→signature→hash→root. Sau signatures, derive event hashes theo topo order;
public event.previousEventHash resolve external hash hoặc committed hash của prior
effect. API kiểm current external head dưới aggregate/stream lock trước commit;
chaincode kiểm immutable prior effect receipt/root/index cùng stream trước append.

`signedEventCommitment` gồm envelope5/schema4/RFC8785, commandId, eventId/nonce==
eventId, chainRef, bindingDigest, effectRoot/count/index/leafDigest, payloadDigest,
resolved previousEventHash và assertionSetDigest. Raw public entity tuple lưu trong
envelope phải khớp supplied leaf (JCS→leafDigest→path→root) ở validator; không lấy
metadata chưa được kiểm ngoài commitment. Assertion set references gồm intentId,
handoverRole và assertionDigest; sort/unique theo party/intent, không order tùy ý.
Transport `deliveryContext.generation`/credential/txId ngoài signed event commitment
như B: cert rotation giữ actor signature/event/hash/nonce/destination.

Single command C1 chỉ một chain/binding; multi-ledger domain command không trong
scope. DB effects atomic; Fabric relay nhiều events không được giả atomic xuyên
transactions: command proof status PARTIAL/PENDING đến khi mọi expected leaf VALID,
không báo toàn command CONFIRMED từ effect đầu. Ledger command-root/effect receipts
chặn duplicate index/root/nonce/cardinality mismatch, giữ history/old hashes.
Intent nonce consume lần đầu pin commandRoot; các leaf còn lại cùng root/count
được tiếp tục, không consume nonce như một command mới mỗi event. Same nonce với
root/command khác bị chặn, repeated leaf index dùng exact duplicate reconciliation.

## 5. Golden vector thiết kế C1

Dùng `u(n)=00000000-0000-4000-8000-` + n đủ12digits, thời gian
`2026-10-13T00:00:00.000Z`, binding digest từ B vector
`f34a78fd87c5dd0ef133144774c919732c8c81095903d4e2f352a3b0756a4ce0`.
Normalized body vector (không phải DTO hiện tại của start/arrive A):

```json
{"shipmentId":"00000000-0000-4000-8000-000000000002","version":"0","lotVersion":"3","quantity":"1.000","unit":"kg","handoverStage":"PICKUP","eventTime":"2026-10-13T00:00:00.000Z"}
```

Leaf0: event u(1), SHIPMENT/u(2), cycle u(3), lot u(4), SHIPMENT_STARTED, chainRef
u(5), binding đã nêu, payloadDigest ở bảng dưới, expectedVersions
`{shipment:"0",lot:"3"}`, predecessorRef EXTERNAL_HASH `11` lặp32, permissions
`[{permissionRef:u(6),epoch:"2",ordinal:"7"}]`, eventTime trên. Root count1.

Intent: protocol agritrace-signing-intent/1, intent/nonce u(7), command u(8),
operation C_CONFIRM_HANDOVER, requestKeyDigest của bytes `synthetic-c-command-1`
với domain agritrace:request-key:c1, chain u(5), binding đã nêu, actor u(9),
organization u(10), actorRole TRANSPORTER, handoverRole TO, keyRef u(11), keyEpoch1,
payloadDigest/effectRoot từ bảng, effectCount1, versions/permissions như leaf,
issuedAt trên, expiresAt `2026-10-13T00:10:00.000Z`, policyVersion c-required/1.
Assertion protocol agritrace-actor-assertion/1, algorithm Ed25519, key u(11)/epoch1,
unsignedIntentDigest và signature bên dưới. Assertion references
`[{intentId:u(7),handoverRole:"TO",assertionDigest}]`. Signed event commitment là
đúng fields mục4 với versions5/4, index0/count1, hashes này, previous hash `11` lặp32.

| Vector | Golden lowercase SHA-256 |
| --- | --- |
| Command payloadDigest | `10034912fbd913fcc4b6dec2e145743230665be376f46391dbdfefa3b2e0f631` |
| Effect leafDigest | `7d86c982d7d6e22fc9daf15b1f3fce21f4f6677b507d3b62d4763553dc518156` |
| EffectRoot count1 | `192ac89c452ffdad337db5bfef588cafae4da8a69b98ee6a750aacbe4c4bae81` |
| Request key digest | `ac85eb492c8d04a84e1b01a8309699367f9c8c86cf8bbe66b9d69d561c5e5b1d` |
| Unsigned intent digest | `e743a1788271ae9a26b40785d33c91a1fbf9ccc0c899a57384ab45c3c5a1337f` |
| Public SPKI fingerprint | `339e2ff917630507b6a423b5ce084e285d1fa65d93b3e27a6195d3bbebc9ae23` |
| Assertion digest | `b09ffd0e542fbc167f9d2b064721ae3edd490039baf6408a258331061e922c84` |
| Assertion set digest | `43b52c14417dad8b41c1385052a4d4ccaea6c2d08cfa6d612a71a87489363346` |
| Event dataHash | `e957595886839b6461e1c9a51fe1f00c828d66f50f2e24b39b727b9d078ba2c2` |
| Intent chainRef chỉ đổi thành u(12) | `3acb1d5ab15636f74b517693a3d8bea1613c9f039792e7d76738b544f3401d4b` |

Public SPKI base64url:
`MCowBQYDK2VwAyEAO2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik`.
Signature base64url:
`foVagA_72Bipay1lvF4IDDTBlIe7wupfYT7RyW2xdiUQPGWQIlD_BB-UoXD7bN8jJrh7cN5ObpOBgWearm4bAQ`.

Node crypto/json-canonicalize verified signature này và rejected altered-chain
unsigned digest; key là synthetic test authority, private material không xuất/tài
liệu hóa. Đây là **cryptographic design vector**, không có active registry/grant,
không là hợp lệ dual handover chỉ với một TO signature, không validator/Fabric/
enterprise authority acceptance. Golden multi-leaf3/5 paths, Unicode/decimal,
namespace/operation/key swap và encoder độc lập phải được thêm tại C0 trước schema.

Multi-leaf shape vector: leaf1 copy leaf0, đổi index1/eventId u(13), predecessorRef
`{kind:"EFFECT_INDEX",index:"0"}`, permission ordinal8; leaf2 copy leaf0, đổi
index2/eventId u(14), predecessorRef index1, ordinal9. Các fields khác giữ nguyên.
Leaf1 digest `d4de3d8690f4f35d69527eaa770032d8d07211f25f201054dbbc539f15f2f151`,
leaf2 digest `194afec70e52c8f067bb6349c50678ba2dfaf39393674713f46b63c67092f7f9`.
Parent(0,1) `f2f7a330f104e332d61b27984b4b7f85a5aba326743c14689d5d42c2a7185e1c`;
treeRoot3 `70957861a2e48077c3db9e16f8a05b1577714018d8a964cd8aaaa449888f3b63`;
effectRoot3 `8c076f59edc9970d87e41dc9165dc3dd60580753843dae8b3e245f2371d3060f`.
Index2 path chỉ LEFT parent(0,1); không duplicate last leaf. Đây là shape vector
synthetic, không command SHIPMENT_STARTED thực có ba business transitions.

## 6. Schema, ledger registry và transactions

B/C shared canonical interfaces chốt trước parallel implementation; schema dưới
là đề xuất, không tồn tại trong current Prisma/catalog:

| Nhóm | Rows/FKs tối thiểu | Guard |
| --- | --- | --- |
| Actor key | `actor_key_definition(key_ref,epoch PK,org_ref,public_spki,fingerprint,scope_policy,approval_digest)`; `actor_key_state(key_ref PK,current_epoch,state,version,last_receipt)` | Immutable definitions, composite epoch FK, typed algorithm/SPKI; scope mapping private grant/device refs, key ACTIVE only confirmed B control receipt; state changes audit append-only. |
| Intent | `signing_intent(intent_id PK,command_id,requester,operation,original_body_digest,request_key_digest,unsigned_body,digest,effect_root,count,expiry,state,version)`; `signing_intent_effect(intent_id,index PK,event_id UNIQUE,leaf,payload_digest,predecessor_ref)` | Body/effect plan immutable; DB unique requester/operation/preparation key, nonce single consume; count/bounds/typed versions. State terminal no rewrite/signature replacement. |
| Ordinals | `intent_permission_reservation(intent_id,permission_ref PK,epoch_digest,ordinal,state,disposition_receipt)` | B epoch FK, ordinal unique; prepare/enqueue/revoke same locks, exactly one CONSUMED event or explicit terminal no-domain disposition; UNKNOWN holds. |
| Assertions | `actor_assertion(digest PK,intent_id,key_ref,key_epoch,algorithm,signature,verified_digest)`; `intent_assertion_party(intent_id,party PK,assertion_digest,actor_snapshot)` | Signature/refs immutable/canonical + key epoch FK; party allowlist distinct; snapshot user/org/grant/key authority true, không HTTP client override. Signature package private ACL/bounded storage; never private key. |
| Event | `event_signed_commitment(event_id PK,command_id,effect_index,leaf_digest,effect_root,private_body_digest,assertion_set_digest)`; `event_assertion_reference(event_id,party PK,intent_id,assertion_digest)` | FK TraceEvent/route/binding/permission/effect IDs, schema4 must context before commit; direct SQL delete/update/context mismatch denied. Legacy rows no synthetic C context. |
| Handover | `handover(id PK,shipment_id,stage,revision,payload_digest,effect_root,expected_shipment_version,expected_lot_version,from_org,to_org,quantity,unit,expiry,state,version)`; `handover_confirmation(handover_id,revision,party PK,intent_id,assertion_digest,grant_snapshot)` | Immutable offer revision/terms and confirmations; partial unique open(stage,shipment), state machine/CAS version, FK same subject/chain/binding; no custody transition without two valid parties/current grants. |

Journal/outbox/domain tables giữ nguyên semantics; C schema chỉ append. Preparation/
offer/reject/cancel command journals khác physical-event execute journal. Không chỉ
save signature rồi domain mutate transaction khác mà thiếu atomic consume/effect
check. Current lock order: idempotency record → org/user/session → sorted chain/
permission/key refs → intent/handover → aggregate/stream → outbox. No signer/Fabric
call trong transaction; positive journal ưu tiên response cache khi lost response.

Chaincode namespaces C `c1.key`, `c1.intentConsumed`, `c1.commandRoot`,
`c1.commandEffect`, `c1.event/proof/head/history`; B binding/permission/governance/
deliveryFence vẫn được đọc. `RecordSignedEvent` nhận public commitment + leaf/path
và assertions/unsigned intents qua bounded transient package khi privacy policy
chọn; private businessData không lên Fabric. Registry/key/domain operations không
được gọi bằng business relayer tùy ý; B admin approvals/bootstrap/SBE bảo vệ create
key, stream head, effect/root/nonce keys ngay lần ghi đầu.

Validator kiểm key mapping/status/epoch/algorithm và Ed25519 signature; các intent
cùng commandRoot phải đúng operation/required party/chain/binding/policy/body/root/
count; leaf path + expected versions/public context + permission snapshots; current
ledger registry + MVCC không stale-key/permission race; nonce/root/index/predreceipt
không reuse/collision. Recompute assertion digests/set + dataHash; không verify một
signature digest rồi accept dataHash bất kỳ do relayer đưa. Missing assertion package
không là signature VERIFIED dù proof hash đúng. Transient package integrity được
commit bằng digest; có private authorized export để auditor verify lại sau restore.

C_REQUIRED stream registry phải reject B/V3/unsigned entrypoints cho genesis và
mọi transition; strict protocol dispatcher đọc origin profile từ ledger, không
client legacy mode. A/B streams vẫn theo version cũ và readers; checkpoint chuyển
profile là task riêng. Multi-event partial Fabric receipts giữ command PENDING và
B holds; không rollback DB/physical history hoặc giả complete để retire key.

## 7. Handover state machine và đúng custody

Ma trận pin từ plan chính:

| Stage | FROM → TO | State trước | Transition sau đủ confirmations |
| --- | --- | --- | --- |
| PICKUP | Farm → Transporter | Shipment CREATED, Lot HARVESTED, custodian Farm | START_SHIPMENT → IN_TRANSIT/IN_TRANSPORT, pickupTime; custody Transporter. |
| ARRIVAL | Transporter → Retailer | Shipment IN_TRANSIT, Lot IN_TRANSPORT, custodian Transporter | ARRIVE_SHIPMENT → ARRIVED/ARRIVED, arrivalTime; custody Retailer. |
| QUALITY_RECEIPT | Retailer nghiệm thu sau custody arrival | Shipment ARRIVED, Lot ARRIVED | Existing RECEIVE_SHIPMENT/DAMAGE/REJECT quantity conservation; chữ ký C riêng theo policy, không thay arrival confirmation. |

Handover state: OFFERED → CONFIRMED / REJECTED / EXPIRED / CANCELLED, immutable
revision/party confirmations. Offer signer FROM có current role/capability/grant/
assignment/custody, expected versions+available quantity/unit/timing và peer TO đã
định trong immutable Shipment. Offer không đổi Shipment/Lot/custody, không set
pickup/arrivalTime, không reserve stock. TO ký cùng handover/revision/common
planned effectRoot/quantity/versions, không gõ target org tùy ý. FROM/TO intents có
role/party/nonce/key scope riêng; không reuse một signature hai parties.

TO confirm transaction kiểm cả current signer account/org/grants/key epochs và
signature snapshots; FROM grant bị revoke/regrant không hồi sinh offer. Expiry,
recall/damage, lot/shipment version drift, changed custody, held permission hoặc
missing second party reject trước domain transition. Đúng hai bên thì confirmation
+handover terminal + Shipment/Lot versions/state/time + signed trace/outbox/journal
commit atomic; injected trace failure rollback toàn transition/confirmation. Race
confirm vs reject/expire/recall/damage/revoke dùng same lot aggregate lock + expected
versions, chỉ một hợp lệ; expiry/rejection không tự return Farm.

Same organization vẫn hai stage intents/confirmations/current role grants, có thể
same user/key khi thật sự được cấp cả hai roles và scope policy cho phép; UI/proof
nhãn INTERNAL, không enterprise bilateral claim. Managed/delegated approvals có
nhãn/scope riêng, không auto-sign party còn thiếu. Direct `/shipments/:id/start` và
`/arrive` A/B phải deny trên C stream ở service+command authorization+SQL protections,
không chỉ ẩn Web button. Các disposition FAILED giữ custodian đã establish bởi
state/time/signed evidence như current custody resolver, không infer solely org
khi same-org nhiều stages. Không đổi hosting/profile giữa open handover.

## 8. API/Web và original-key reconciliation

Endpoints đề xuất: POST `/signing-intents/prepare`, GET `/:id`, POST `/:id/execute`,
POST `/:id/cancel`, GET `/:id/status`; handover POST `/shipments/:id/handovers/offer`,
POST `/handovers/:id/confirm|reject|cancel`, GET `/handovers/:id`. Key register/probe/
activate/revoke theo operator/org governance contract riêng. Bounded typed DTO/
Swagger-generated types, current scope projection, no arbitrary signer URL/key path.

Prepare original business body + operation + execution-key reference; response có
canonical bytes/digest/summary/expected versions/effect plan/expiry/key scope,
nhưng không raw credentials. Web kiểm current chain/account/accessRevision trước
sign/submit; chain/name/body/quantity/parties/expiry và delegation label được nhìn
rõ. External signing invocation do user xác nhận; account/scope đổi trong lúc ký
bỏ stale promise/signature, không submit bằng account mới. Không fallback fingerprint
hoặc tự generate key/signature khi signer outage.

Saved pending execute request gồm exact wrapper/body/key/signature refs, serialized
bounded như current recovery ledger; không private key/token. Named locks per user/
org và intent/command slot bảo vệ hai tabs; server nonce unique/positive journal
vẫn quyết định. Terminal bỏ stored body/result; no offline private proof/intent
cache sau account/grant change. Reload/remount/status query không re-sign hoặc
phát nonce/key mới. Browser chỉ lưu public signature cần retry khi pending, không
coi signature secrecy thay current API authorization.

CommandRequestStatus cần explicit C operation allowlist và versioned bridge cho
original signed wrapper: COMMITTED từ positive journal cùng intent/effect/resource,
known REJECTED cho intentional new prepare/nonce/key sau terminal, PROCESSING/
expired UNKNOWN không execute lại hoặc thay key. Current session/grant/private
scope kiểm trước terminal replay như A; historical key material/accepted snapshot
được verify riêng, không yêu cầu cert cũ ACTIVE để hiểu positive committed history.
Normal key rotation không xóa positive journal. Regrant/new body không hồi sinh old
consent/scope. Missing encrypted assertion package tạo verification warning/hold,
không fabricate signature từ journal hoặc coi protocol label là bằng chứng.

Public QR tách business state, ledger/hash integrity và actor signature statuses:
LEGACY_FINGERPRINT, SIGNATURE_VERIFIED, DELEGATED, INTERNAL, UNAVAILABLE,
AUTHORITY_REVIEW_REQUIRED; labels không lộ actor IDs/public key mappings/private
payload. Private authorized verification package mới chứa unsigned intent, effect
path, signature và key/permission historical receipt. Key-ref lookup current user
không bypass scope vào organization/key có thể dò; signatures không là quyền đọc
raw business records của platform admin hoặc observer.

## 9. Phases, ownership và acceptance

| Phase | Tasks / files sau dependencies | Gate trước bước tiếp |
| --- | --- | --- |
| C0 / HYB-08+12 | Freeze unsigned/leaf/Merkle/assertion/key/intent/handover protocol + actual command-effect inventory; independent canonical encoders/golden negatives. | Byte/digest/signature/path vectors reviewed, dependency no circularity, privacy/authority/expiry semantics explicit; B/A receipts giữ riêng. |
| C1 | Append key/intent/reservation/assertion/event/handover schema + guards/versioned readers trong API; no runtime activation. | Fresh A+B catalog/copy/zero Prisma diff; FK/immutable/direct SQL bypass negatives; existing journal/hash/route/QR unchanged. |
| C2 | Key registry PoP/admin/governance + B control receipts; pure API/Worker/Gateway/chaincode C verifier. | Only confirmed authority opens key; wrong MSP/key scope/algorithm/nonce/epoch/metadata reject; API signer mount negative; real Fabric MVCC/key revoke controls. |
| C3 | Prepare/sign/execute atomic domain paths, ordinal reservations, exact wrapper journal/recovery; signer adapters outside API transaction. | Signer outage/expiry/stale/current revoke creates no domain/outbox; response loss/duplicate/tabs keep key/body/intent/effects one commit. |
| C4 | Handover dual confirmation/quantity/state/version + SQL/domain blocks A/B bypass on C streams. | Race matrices/no custody without both signatures; INTERNAL/delegated labels; receive quality semantics retained; failure injection atomic rollback. |
| C5 | Web summary/signing service integration/recovery/reload/tab/mobile/private verification package + public QR statuses. | Actual API+DB browser, independent test signer boundary, scope/logout/device drift; no rawkey/token/PII leaks; real Safari/iOS remains separate topology gate. |
| C6 | Full A/B/C exact-SHA CI/Fabric, key/pins/DB/ledger encrypted restore, compatible app/chaincode rollback, production cutover/canary/observation. | Accepted floors/protocols/old hashes, expiry/rotation/unknown hold truthful; real partner authority only if evidenced, no synthetic substitution. |

Parallel ownership sau protocol freeze: owner1 schema/API current auth+intent/journal;
owner2 commitment/Gateway/chaincode key/permission verifier; owner3 Web/signing/
handover UX+fixtures. C handover domain/custody central owner tránh shipment code
conflict; shared canonical protocol/schema changes root serializes. Heavy DB/browser/
Fabric suites chạy tuần tự với quota/labels/cleanup, không tranh same resources.
Không triển khai C vào main/runtime khi A/B/schema/protocol gates còn thiếu.

| Acceptance | Positive + negative tests |
| --- | --- |
| HYB-AC-14 | Valid actor-intent executes once; wrong actor/org/key/role/operation/payload/chain/binding/nonce/versions/expiry/replay denied; signer unavailable no domain/outbox. Delayed relay/key rotation vs normal drain/emergency hold tested. |
| HYB-AC-15 | Pickup/arrival actual FROM+TO confirmation đúng parties/quantity/version; same-org INTERNAL/delegated semantics; receive-quality separate. |
| HYB-AC-21 | Swap signature/unsigned digest/dataHash/effect index/root/path/leaf/predecessor/context fails; private event→digest→root→signature→commitment encoders match; old 64hex evidence/readers unchanged. |
| HYB-AC-23 | Missing/reject/timeout/cancel/recall/damage/revoke races never transfer custody implicitly; no profile switch midhandover; direct A/B start/arrive denied C at API/domain/DB/ledger. |
| HYB-AC-22 | Old sidecar/route/import trust unchanged; backdated eventTime cannot bypass key/permission revoke; crypto valid historical signature distinguished current access/incident review. |
| HYB-AC-19/20 regression | Actor-key normal rotation + transport cert rotate separate; ordinal reservation barrier/cancellation/unknown; grant unconfirmed blocked, ledger MVCC/revoke ordering, no retry from singlepeer NOT_FOUND. |
| HYB-AC-16 + A/B | Fresh/copy/restore/compatible rollback, hashes/journals/proofs/QR/key authority, partial multi-event honest Pending; scoped canary/5login budget/current auth originalbody recovery; no skip as pass. |

Specific crypto/parser negatives: base64 padding/noncanonical bytes, signature not64,
wrong SPKI/OID/algorithm, extra/missing/null fields, duplicates/unsorted assertion set,
leading-zero/overflow epoch/index/count/quantity, Unicode canonical mismatch, path
wrong direction/length/count/treeshape, cross-domain substitution, external/intra
predecessor spoof, same intentNonce across different command root, header key digest
mismatch, wrong originalBody with existing execution key. Verify proof does not
claim signatures from `authProofType=DIGITAL_SIGNATURE` string alone.

Key lifecycle tests: malicious OrgAdmin register anotherorg key, no PoP/admin receipt,
stale key epoch/permitted roles, rotate response loss/registry pending, normal revoke
with signed-but-unexecuted reservations and acceptedPending outbox, emergency key
compromise before/after first effect VALID, lost encrypted assertion package restore,
delegationwithdrawal/accountdisable/regrant. Current grant controls disclosure; current
revoked key cannot make mathematically valid old signature a fresh execute authority.

Multi-effect tests: same-entity3/5 effects explicit earlier-index predecessors,
separateentity heads, one planned event missing/extra, one outbox lease stale, replay
same root/index, mixed wrong binding, last event ledger failure leaves command
PARTIAL, no false finalized ledger assertion. C DB commits all effects or none;
network signer/Fabric zero calls inside transaction verified at boundary.

Evidence giữ exact SHA, protocol/lockfile/migration/key/pin digests, actual tests,
real/synthetic/mock flag, public-key+signature vector results, Fabric tx/block/VALID
codes, browser scope, resource ownership/quota/cleanup. Raw private key/credential/
body/signature packages không vào public artifacts. Thiết kế/compile/one vector/mock
không là C acceptance; whole-project review → plan → fix → verify tiếp tục sau toàn
A/B/C và mọi gates. Shutdown local chỉ sau completed handoff/cleanup, noforce loss.
