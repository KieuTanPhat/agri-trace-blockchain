# Runbook Fabric nền tảng — hai MSP và channel chung

Tài liệu vận hành cho nền tảng **bản B**: mỗi chuỗi cung ứng có thể gắn với một
*binding* Fabric riêng (channel, chaincode, writer authority, governance).
Bản B chạy trên mạng pilot cách ly trong WSL2. Đây **không** phải runbook
production; authority thật của doanh nghiệp đối tác vẫn là **NotEvaluated**.

## 1. Thành phần

| Thành phần | Vai trò |
| --- | --- |
| `blockchain/network/hybrid/hybrid-network.sh` | Dựng/dừng mạng hai MSP bằng `docker run` (không cần compose plugin) |
| `blockchain/chaincode` | Registry binding, governance, `RecordBindingEvent`, quyền theo epoch |
| `blockchain/gateway` | Client Fabric Gateway (`BindingLedgerClient`, `RegistryOperator`) |
| `apps/api/src/modules/ledger` | Binding, đồng bộ quyền ledger, delivery theo binding, control worker |
| `apps/api/scripts/ledger-operator.ts` | CLI vận hành (không phải HTTP) |
| `GET /api/supply-chains/:chainId/ledger-status` | Trạng thái ledger cho người dùng nghiệp vụ (chỉ đọc) |

Topology source hiện hành:

| MSP | Danh tính và trách nhiệm |
| --- | --- |
| `AgritraceMSP` | Peer, technical relayer/controller và registry admin của AgriTrace |
| `OrdererMSP` | Orderer của AgriTrace |

Channel `agritrace` dùng endorsement `OR('AgritraceMSP.peer')`. Tất cả doanh nghiệp
chia sẻ hạ tầng; mỗi chuỗi có `chainRef`, binding `SERVICE`, permission epoch và
khóa ký doanh nghiệp riêng. Không có peer/MSP riêng cho doanh nghiệp. API kiểm
quyền read/list/count/export/proof; peer nền tảng giữ toàn bộ metadata công khai
của channel. Không coi chữ ký peer là chữ ký chấp thuận nghiệp vụ của doanh nghiệp.

Topology mới yêu cầu database và mạng mới, không chuyển đổi lịch sử/hash/proof cũ.
Source không chứng minh đã triển khai hoặc nghiệm thu VPS. Lịch sử thiết kế ở Git.

## 2. Dựng mạng

Chạy trong WSL2/Linux có Docker. Dữ liệu nằm ở `~/agritrace-fabric`
(`AGRI_FABRIC_ROOT` để đổi). Script bắt buộc `AGRI_FABRIC_INSTANCE` (tiền tố tài
nguyên cách ly, `^[a-z][a-z0-9-]{3,48}$`) và dừng ngay nếu thiếu. Khai báo instance
và root riêng trước mọi lệnh bên dưới; không dùng chung root với stack khác:

```bash
export AGRI_FABRIC_INSTANCE=agri-pilot-local
export AGRI_FABRIC_ROOT="$HOME/agritrace-fabric/$AGRI_FABRIC_INSTANCE"
```

```bash
bash blockchain/network/hybrid/hybrid-network.sh up       # CA, MSP, genesis, orderer, peer, channel
bash blockchain/network/hybrid/hybrid-network.sh deploy   # package, approve, commit chaincode (CCaaS)
bash blockchain/network/hybrid/hybrid-network.sh status
bash blockchain/network/hybrid/hybrid-network.sh export   # chỉ tạo material kết nối của AgriTrace
```

`export [dir]` ghi vào `blockchain/.fabric/runtime` (đã gitignore) hoặc thư mục chỉ
định. Acceptance AC-13 tự export vào một thư mục tạm dưới root của instance, kiểm
đúng danh sách identity được phép và xóa sau khi kiểm; thiếu export là FAIL. Worker chỉ nhận technical identities của AgritraceMSP; export không chứa CA/orderer private keys hoặc khóa ký nghiệp vụ doanh nghiệp.

Sau khi WSL/Docker khởi động lại (container có `--restart unless-stopped`
nhưng WSL tự tắt khi idle):

```bash
bash blockchain/network/hybrid/hybrid-network.sh start
```

Giữ WSL sống khi chạy test: `wsl -d Ubuntu -- sleep infinity` ở một tiến trình
nền. Dừng và xóa volume: `down`; xóa cả material sinh ra: `clean`.

Xoay chứng thư relayer (cùng authority, khóa mới) để diễn tập HYB-AC-19:

```bash
bash blockchain/network/hybrid/hybrid-network.sh rotate-relayer r2
```

## 3. Cấu hình API/Worker

API vẫn chạy được không có Fabric, nhưng mọi vụ sản xuất mới cần chuỗi có binding
`ACTIVE`. Local, test và CI rehearsal không chạy Fabric dùng binding giả lập:
`LEDGER_SIMULATION=1 node apps/api/dist/operator/simulated-ledger.js [--watch <ms>]`
(service `ledger-simulator` trong `docker-compose.yml`). Công cụ gắn binding
`simulated-ledger` cho chuỗi chưa có binding, xác nhận quyền đã yêu cầu và từ chối
database có binding thật; sự kiện đứng `PENDING`. Không bao giờ chạy trên production.

Worker dùng `FABRIC_BINDINGS_CONFIG` trỏ tới file operator sở hữu. Cấu hình
production không chứa private-key bytes; chỉ có đường dẫn identity mount riêng.
File mẫu sau cần thay network, governance digest và đường dẫn bằng dữ liệu đã review:

```json
{
  "version": 1,
  "bindings": [],
  "platform": {
    "network": "<reviewed-network>",
    "channelId": "agritrace",
    "chaincodeName": "agritrace",
    "contractName": "AgriTraceContract",
    "writerAuthority": "agritrace-relayer-b",
    "governanceDigest": "<64 hex from deployed chaincode>",
    "node": {
      "peerEndpoint": "peer0.org1.example.com:7051",
      "peerHostAlias": "peer0.org1.example.com",
      "tlsCertPath": "/hosted-identities/tls/org1.crt",
      "mspId": "AgritraceMSP",
      "relayer": {"certPath": "/hosted-identities/relayer/signcerts/cert.pem", "keyDir": "/hosted-identities/relayer/keystore"},
      "controller": {"certPath": "/hosted-identities/controller/signcerts/cert.pem", "keyDir": "/hosted-identities/controller/keystore"},
      "admin": {"certPath": "/hosted-identities/admin/signcerts/cert.pem", "keyDir": "/hosted-identities/admin/keystore"}
    }
  }
}
```

Production provisioner xuất `worker-config/bindings.json` và `worker-identities`
với ba technical identities trên. Mount config readonly ở `/hosted-config` và
identity readonly ở `/hosted-identities`. API không được mount các identity này.
Registry admin là quyền kỹ thuật nhạy cảm, không phải khóa Ed25519 doanh nghiệp.

Template chỉ khớp binding có cùng network/channel/chaincode/contract/writer
MSP/authority/governance; thay cấu hình sang mạng khác không chuyển hướng backlog.
`bindings` cụ thể vẫn phục vụ harness/operator kiểm chứng, production dùng mảng rỗng
và template `platform`. Không cần sửa inventory mỗi lần thêm doanh nghiệp hoặc chuỗi.

Worker xử lý chuẩn bị nền tảng, ledger control, delivery, handover expiry và mail.
Lỗi một binding có circuit breaker riêng; sự cố của mạng/channel chung có thể ảnh
hưởng mọi doanh nghiệp. Không tuyên bố HA từ một peer/orderer trên một VPS.

## 4. Tự chuẩn bị binding cho chuỗi

Kích hoạt doanh nghiệp sản xuất tạo chuỗi riêng như nghiệp vụ hiện hành; chuỗi tạo
thêm đi qua cùng cơ chế. Trigger sau INSERT chuỗi tạo `ledger_provisioning_job`
trong chính transaction, rollback chuỗi cũng rollback job. Registration/activation
không tự xác nhận kết nối Fabric thành công.

Worker claim bằng lease, pin binding trước network traffic và dùng proposal nonce
ổn định. Nó bootstrap registry channel một lần, đăng ký binding/credential, đọc lại
credential ACTIVE rồi kích hoạt binding và xếp permission grants. Chỉ quyền đã
confirmed trên ledger mới mở ghi nghiệp vụ. Retry/restart giữ binding/proposal cũ;
không dùng idempotency key mới để né kết quả chưa rõ. Job hoàn tất bất biến.

Trang ledger của chuỗi hiển thị `PREPARING`, `READY` hoặc `NEEDS_ATTENTION`.
READY không thay thế kiểm capability/membership/assignment và allowedCommands.
Không còn form nhập peer/MSP/CA, yêu cầu kết nối hoặc duyệt peer từ phía doanh nghiệp.

Operator có thể đọc trạng thái và xử lý hold bằng CLI hiện có:

```bash
cd apps/api
node dist/operator/ledger-operator.js status --chain <uuid>
node dist/operator/ledger-operator.js pause --binding <digest>
node dist/operator/ledger-operator.js resume --binding <digest>
node dist/operator/ledger-operator.js resolve-hold --hold <uuid> --resolution "<reviewed reason>"
```

Register/onboard/activate là công cụ phục hồi kỹ thuật, không phải bước đăng ký
thường xuyên. Target phải là `agritrace`/`AgritraceMSP` và profile `SERVICE`.
Không đổi binding đã ghim, sửa hash/proof hoặc xóa attempt để vượt lỗi.

## 5. Vòng đời quyền ledger

Quyền ghi của từng thành viên được đồng bộ lên ledger, không chỉ nằm trong DB:

```
REQUESTED → PENDING_LEDGER → ACTIVE
REVOKE_REQUESTED → DRAINING → PENDING_REVOKE_LEDGER → REVOKED
EMERGENCY_HOLD → PENDING_EMERGENCY_REVOKE → REVOKED_REVIEW_REQUIRED
```

- Grant chưa `ACTIVE` trên ledger **không** mở quyền ghi event (trigger DB chặn).
- Thu hồi thường: chặn event mới, **drain** các event đã chụp ordinal ≤ barrier
  (phải có proof `CONFIRMED`) rồi mới revoke trên ledger.
- Khẩn cấp (lộ khóa): hold ngay, revoke ngay; event chưa có proof không được
  báo là đã xác minh và cần rà soát (`resolve-hold`).
- Cấp lại sau revoke tăng epoch; mỗi epoch tiêu hai revision registry
  (`grant = 2(e-1)`, `revoke = 2(e-1)+1`).

## 6. Delivery và xử lý kết quả không rõ

- Mỗi lần gửi tạo `delivery attempt` (txId) **trước** khi có traffic mạng.
- Kết quả không rõ (mất response, timeout) → `UNKNOWN`: đối soát bằng proof
  trên ledger/`qscc`; nếu chưa chắc thì gửi lệnh `FENCE_DELIVERY` rồi mới gửi
  lại. Không bao giờ gửi lại mù (tránh trùng event).
- Lỗi chaincode phân loại `WAIT` (thử lại) và `PERMANENT` (dead letter).
- Chứng thư relayer đổi/hết hạn khi event còn Pending: dùng credential hợp lệ
  của cùng authority; route, hash, nonce cũ được giữ.

## 7. Kiểm chứng

```bash
# Chaincode + gateway (không cần mạng)
npm test --workspace blockchain/chaincode
npm test --workspace blockchain/gateway

# Nghiệm thu mức ledger trên Fabric thật; số case theo harness hiện hành
FABRIC_ROOT='\\wsl.localhost\Ubuntu\home\<user>\agritrace-fabric' \
  npx tsx blockchain/network/hybrid/acceptance/ledger-acceptance.mts

# API → Worker → Fabric thật
cd apps/api
HYBRID_FABRIC_E2E=1 TEST_DATABASE_URL=<db test đã migrate> \
  npx vitest run --config vitest.config.e2e.ts test/hybrid-fabric.e2e-spec.ts
```

Các kịch bản E2E thật: luồng đầy đủ, revoke/regrant, cô lập outage giữa hai
binding, mất response + đối soát, fence, emergency hold. Test SQL guard chạy
với DB thường (`hybrid-binding-db.e2e-spec.ts`) và bàn giao có chữ ký (`hybrid-handover.e2e-spec.ts`).

## 8. Bản C — chữ ký độc lập và bàn giao hai bên

Bản C thêm **chữ ký của tổ chức** (khóa Ed25519 do tổ chức giữ) cho các bước
chuyển quyền giữ hàng. Chữ ký này tách khỏi chữ ký giao dịch của relayer và
endorsement của peer: nó chứng minh *ý định* của tổ chức, không chứng minh
chất lượng hàng.

### 8.1. Khóa ký

| Bước | Ai làm | Cách làm |
| --- | --- | --- |
| Tạo khóa | Tổ chức (ORG_ADMIN) | Web: panel "Khóa ký của tổ chức" tạo khóa **không trích xuất** trong trình duyệt; hoặc `scripts/org-signer.ts keygen` cho dịch vụ ký ngoài |
| Đăng ký | ORG_ADMIN | `POST /api/supply-chains/:chainId/signing-keys` với `keyRef`, khóa công khai và **bằng chứng sở hữu** (khóa ký lên binding + keyRef + org). Khóa ở trạng thái `PENDING_LEDGER`, chưa dùng được |
| Kích hoạt trên ledger | Worker | Tự đề xuất, registry admin `AgritraceMSP` duyệt, thực thi và đọc lại public key/orgRef/status trước khi đặt `ACTIVE` trong DB. Bằng chứng sở hữu khóa doanh nghiệp vẫn bắt buộc |
| Thu hồi | ORG_ADMIN | `POST .../signing-keys/:keyRef/revoke`. DB thu hồi **ngay** (không chuẩn bị/ký thêm được); Worker tạo job `SIGNING_KEY_REVOKE` để rút khỏi registry ledger |
| Xoay khóa | ORG_ADMIN | Đăng ký khóa mới (`keyRef` mới) rồi thu hồi khóa cũ. Khóa đã thu hồi không bao giờ kích hoạt lại |

Khóa riêng không bao giờ vào DB, API hay Worker. Nếu tổ chức có nhiều khóa
hoạt động, request chuẩn bị ký phải chọn `keyRef`.

### 8.2. Bật chế độ bàn giao có chữ ký

```bash
cd apps/api
node dist/operator/ledger-operator.js set-handover-mode --chain <uuid> --mode DUAL_SIGNED
```

- Chỉ đổi được khi chuỗi có binding hoạt động, có ít nhất một khóa `ACTIVE`, và
  **không có đề nghị bàn giao đang mở** (DB từ chối trong các trường hợp khác).
- Chế độ **ghim theo chuyến hàng lúc tạo**, chỉ cho vụ trồng đã sinh trên binding
  hiện hoạt. Chuyến cũ vẫn dùng `start`/`arrive`; chuyến `DUAL_SIGNED` bị DB
  chặn mọi cách đổi trạng thái giao nhận nếu thiếu bàn giao đã xác nhận.

### 8.3. Luồng bàn giao

```
bên giao: chuẩn bị đề nghị → xem lại → ký (khóa tổ chức) → gửi        => OFFERED
bên nhận: chuẩn bị xác nhận → xem lại → ký (khóa tổ chức) → gửi       => CONFIRMED
          (cùng giao dịch: shipment/lot đổi trạng thái, START hoặc ARRIVE)
```

| Bàn giao | Bên giao | Bên nhận | Khi xác nhận |
| --- | --- | --- | --- |
| `PICKUP` | Nông trại (chuyến `CREATED`) | Vận chuyển | `SHIPMENT_STARTED`, lô `IN_TRANSPORT` |
| `ARRIVAL` | Vận chuyển (chuyến `IN_TRANSIT`) | Bán lẻ | `SHIPMENT_ARRIVED`, lô `ARRIVED` |

Quy tắc:

- Chữ ký ràng vào **số lượng, phiên bản shipment/lot** và nội dung đề nghị. Nếu
  chuyến hoặc lô đổi sau khi đề nghị (hư hỏng, thu hồi…), xác nhận bị từ chối
  và phải hủy rồi tạo đề nghị mới.
- Từ chối (bên nhận), hủy (bên giao) và hết hạn **không đổi quyền giữ hàng**.
  Hết hạn chỉ ghi trạng thái `EXPIRED` (không có sự kiện ledger vì không ai hành động).
- `receive` vẫn là bước nghiệm thu lượng/chất lượng **sau** khi bên bán lẻ giữ hàng.
- Bàn giao cùng tổ chức mang nhãn `INTERNAL_SAME_ORG`; ủy quyền ký qua dịch vụ
  của AgriTrace **chưa hỗ trợ** (Deferred).
- Yêu cầu ký (`signing intent`) hết hạn mặc định sau 15 phút, dùng một lần,
  chỉ người đã chuẩn bị mới nộp được.

### 8.4. Bên ký

- **Web**: `SigningKeysPanel` và `HandoverPanel`. Trước khi ký, thiết bị **tự
  tính lại** payload/intent/thông điệp ký từ nội dung hiển thị và từ chối nếu
  máy chủ gửi nội dung khác (`apps/web/src/lib/signing`). Cần trình duyệt có
  WebCrypto Ed25519 (Chrome/Edge mới, Firefox 129+, Safari 17+).
- **Dịch vụ ký ngoài** (mẫu): `apps/api/scripts/org-signer.ts`

```bash
node dist/operator/org-signer.js keygen --out org-key.pem
node dist/operator/org-signer.js register --key org-key.pem --binding <digest> --org <orgId> --label "Dịch vụ ký"
node dist/operator/org-signer.js sign --key org-key.pem --intent intent.json   # in ra {"signature": "..."}
```

`sign` cũng tính lại mọi digest và từ chối nếu không khớp hoặc đã hết hạn.

### 8.5. Giao thức (tham chiếu nhanh)

- Ghi mới (c2): envelope `6.0.0`, schema `5.0.0`
  (`C_ENVELOPE_VERSION`/`C_SCHEMA_VERSION` trong `blockchain/chaincode/src/signing.ts`);
  commitment `SHA256("agritrace:binding-event:c2" 0x00 JCS(thân công khai + chữ ký))`,
  chữ ký gồm `keyRef`, `intentDigest`, `assertionDigest`, `payloadDigest`,
  `metadataDigest`; thân riêng tư dùng domain `agritrace:private-body:c2`.
- Thông điệp khóa ký c2:
  `"agritrace:intent-signature:c2" 0x00 JCS({intentDigest, chainRef, eventId, entityType, entityId, eventType, bindingDigest, keyRef, payloadDigest})`;
  assertion dùng `agritrace:signature-assertion:c2`. Chữ ký không thể chuyển sang
  sự kiện, thực thể, chuỗi, binding, khóa hoặc payload khác.
- Giao thức c1 (envelope `5.0.0`, hash `4.0.0`, không có `payloadDigest`) đã gỡ:
  API và chaincode không đọc hay ghi c1; parser từ chối thông điệp c1
  (`INVALID_INPUT`) và database từ chối `commitment_version = 'c1'`. Chỉ domain
  proof-of-possession của khóa vẫn là `agritrace:signing-key-pop:c1` vì c2 dùng chung.
- Chaincode kiểm: khóa `ACTIVE` trong registry, chữ ký Ed25519, assertion khớp
  commitment, intent chỉ dùng một lần, hash chain, quyền, fence. Sự kiện
  `HANDOVER_OFFERED/CONFIRMED` **không thể** ghi bằng đường không chữ ký.
- Chaincode không dùng đồng hồ: `eventTime` do actor khai **không** chứng minh
  chữ ký có trước khi thu hồi. Sự kiện đã ký nhưng chuyển sau khi khóa bị thu
  hồi bị ledger từ chối (`SIGNING_KEY_INACTIVE`) và thành dead letter cần rà soát;
  bàn giao trong DB vẫn ở trạng thái đã xác nhận nhưng sự kiện **không** được báo
  là đã xác minh.

## 9. Sao lưu, khôi phục và diễn tập

```bash
# Ledger pilot (dừng ngắn peer/orderer để chép nhất quán; archive chứa khóa CA, giữ riêng tư)
bash blockchain/network/hybrid/hybrid-network.sh backup ~/agritrace-backup
# Khôi phục (hoặc chuyển sang host khác với cùng MSP/TLS) một peer, rồi chờ bắt kịp
bash blockchain/network/hybrid/hybrid-network.sh restore-peer org1 ~/agritrace-backup

# CSDL: sao lưu, khôi phục vào DB riêng, kiểm toàn bộ bằng chứng từ DB đã khôi phục
pg_dump --format=custom --file restore.dump "$DATABASE_URL"
createdb restore_check && pg_restore --no-owner --dbname restore_check restore.dump
cd apps/api && DATABASE_URL=<restore_check> npx tsx scripts/verify-evidence.ts   # thoát 1 nếu có sự kiện hỏng
```

`verify-evidence.ts` kiểm route đã ghim, proof lưu, hash riêng tư theo phiên bản
(B/c2, gồm chữ ký tổ chức) và bằng chứng cảm biến — chỉ đọc DB. Backup vận hành chứa CA/MSP/ledger của nền tảng và phải giữ riêng tư; khóa Ed25519 doanh nghiệp được bên ký bảo vệ riêng.

Kết quả diễn tập từng lần tra ở PR/Issue hoặc artifact gắn SHA; không dùng số
block/test của một lượt pilot cũ làm nghiệm thu restore candidate hiện tại.

## 10. Lưu ý vận hành

- **Múi giờ PostgreSQL**: driver ghi timestamp không kèm offset, nên session
  PostgreSQL nên là `UTC` (mặc định của image Docker). Các ràng buộc mới
  **không** so sánh timestamp ứng dụng với `now()` của DB; hết hạn do API kiểm bằng
  đồng hồ của nó. Máy dev Windows múi giờ khác UTC vẫn chạy được nhưng truy vấn
  SQL tay với `now()` sẽ lệch.
- **Migration không "chỉ thêm"**: ba migration (`20261014…`, `20261015…`, `20261016…`)
  tạo kiểu, hàm và trigger nên cổng CD tự động (`deploy/cd/policy.py`) sẽ chặn với
  thông báo cần review tương thích. Triển khai production phải theo quy trình
  review/cutover thủ công; không nới lỏng cổng.
- Job điều khiển ledger chỉ được Worker nhận nếu Worker có identity
  controller và admin cho binding đó, để binding cấu hình thiếu không làm đói binding khác.

## 11. Giới hạn đã biết

- AgriTrace giữ mọi quyền vận hành Fabric. Không có xác nhận độc lập từ peer doanh nghiệp; chữ ký nghiệp vụ chỉ độc lập khi doanh nghiệp tự kiểm soát khóa. Pilot dùng khóa thử nghiệm không chứng minh việc giữ khóa của đối tác thật.
- AgriTrace vẫn vận hành ordering service (một orderer Raft) trong pilot; chưa
  kiểm availability khi mất orderer.
- Channel ghi B/c2 cần policy strict đã bootstrap; không dùng thiếu policy hoặc
  writer V3 làm đường tương thích. A/c1 đã gỡ cả đọc và ghi.
- Chưa có: ủy quyền ký qua dịch vụ AgriTrace, bằng chứng thời điểm ký độc lập
  (timestamp authority), chữ ký cho các sự kiện ngoài bàn giao (care, thu hoạch…),
  cảnh báo/health tự động cho dead letter (hiện chỉ hiện ở panel Ledger và CLI `status`).
- Hết hạn đề nghị được đánh dấu khi có truy cập liên quan (xem, chuẩn bị, nộp)
  và bởi bước `handover-expiry` của Worker trong mỗi vòng lặp
  (`HANDOVER_EXPIRY_ENABLED`, mặc định bật; đặt `false` để tắt;
  `HANDOVER_EXPIRY_BATCH_SIZE`, mặc định 100). Bước này chạy cả khi Fabric tắt.

## 12. Đăng ký doanh nghiệp và chuẩn bị dịch vụ

`ENTERPRISE_ONBOARDING_ENABLED` đóng/mở admission, không chứng minh ledger đã sẵn
sàng. Đăng ký năm bước và OTP tạo account, organization, capability requests và
receipt atomically; chưa cấp quyền nghiệp vụ. Admin xét hồ sơ và từng capability,
rồi kích hoạt dịch vụ bằng command riêng. Khi hoãn thu tiền, không tạo paid order,
invoice hoặc subscription giả. Thanh toán mô phỏng chỉ mở khi operator bật các
flag hiện hành và không phải thu tiền thật.

Không có lựa chọn managed/self-managed. AgriTrace vận hành toàn bộ Fabric; doanh
nghiệp tự giữ khóa ký nghiệp vụ. Quyền sở hữu chuỗi trong ứng dụng vẫn độc lập với
MSP của hạ tầng. Một trăm chủ chuỗi không cần một trăm Fabric MSP.

Browser harness kiểm hai doanh nghiệp, chuỗi riêng lúc activation và chuỗi tạo
thêm đều được Worker chuẩn bị tự động, không sửa inventory thủ công:
`node scripts/ci/hybrid-browser.mjs --enterprise-only`. Kết quả cần evidence đúng
SHA trên môi trường cách ly; source/fixture không thay nghiệm thu Fabric thật.

Chạy riêng giao nhận ký và command recovery trên desktop/mobile viewport bằng
`node scripts/ci/hybrid-browser.mjs --handover-only`. Không truyền cờ để chạy cả
hai nhóm. Khóa ký được Worker tự đồng bộ rồi kiểm tra lại trên registry; fixture
không kích hoạt khóa thay Worker. Kiểm offer hết hạn chờ đủ 15 phút thật, không
đổi timestamp trong database. Viewport mobile không thay kiểm tra thiết bị thật.

## Hạn chứng thư và rủi ro thu hồi nhầm (chỉ đọc trên bảng vận hành)

Trang `/admin/operations`, tab "Chứng thư & khóa ký", chỉ cảnh báo; không có nút thu
hồi hay thay chứng thư. Quy trình xử lý thuộc operator:

- Cảnh báo ≤ 30/14/7 ngày dựa trên lần kiểm tra gần nhất của Worker; một kết nối
  Worker không kiểm tra được (`stale`/`unknownExpiry`) cần kiểm tra thủ công, đừng
  suy ra là còn hạn.
- **Không thu hồi chứng thư admin của kênh (channel/MSP admin) theo cảnh báo hạn.**
  Thu hồi nhầm có thể khóa mọi thay đổi cấu hình kênh và cần khôi phục ngoài hệ
  thống. Trước khi thu hồi hoặc thay: xác định rõ định danh (Worker relayer hay admin
  kênh), có chứng thư thay thế đã được duyệt và kiểm chứng trên kênh cách ly, rồi
  mới thu hồi bản cũ; giữ nguyên lịch sử thu hồi.
- Thu hồi khóa ký (`SIGNING_KEY_REVOKE`) đi qua job điều khiển sổ cái; theo dõi job
  lỗi ở tab "Tác vụ điều khiển sổ cái" và không tạo yêu cầu mới thay cho kết quả
  chưa rõ.
