# Runbook Hybrid Fabric (bản B và C) — mạng pilot 3 Org local

Tài liệu vận hành cho nền tảng **bản B**: mỗi chuỗi cung ứng có thể gắn với một
*binding* Fabric riêng (channel, chaincode, writer authority, governance).
Bản B chạy trên mạng pilot cách ly trong WSL2. Đây **không** phải runbook
production; authority thật của doanh nghiệp đối tác vẫn là **NotEvaluated**.

## 1. Thành phần

| Thành phần | Vai trò |
| --- | --- |
| `blockchain/network/hybrid/hybrid-network.sh` | Dựng/dừng mạng 3 Org bằng `docker run` (không cần compose plugin) |
| `blockchain/chaincode` | Registry binding, governance, `RecordBindingEvent`, quyền theo epoch |
| `blockchain/gateway` | Client Fabric Gateway (`BindingLedgerClient`, `RegistryOperator`) |
| `apps/api/src/modules/ledger` | Binding, đồng bộ quyền ledger, delivery theo binding, control worker |
| `apps/api/scripts/ledger-operator.ts` | CLI vận hành (không phải HTTP) |
| `GET /api/supply-chains/:chainId/ledger-status` | Trạng thái ledger cho người dùng nghiệp vụ (chỉ đọc) |

Mạng pilot:

| Org | MSP | Vai trò |
| --- | --- | --- |
| Org1 | `Org1MSP` | AgriTrace: orderer Raft, peer, relayer/controller/admin kỹ thuật |
| Org2 | `Org2MSP` | Chủ chuỗi do AgriTrace vận hành hộ (`MANAGED_ORG`) |
| Org3 | `Org3MSP` | Chủ chuỗi tự quản (`SELF_MANAGED_ORG`): CA, peer, thư mục khóa riêng |

| Channel | Thành viên | Endorsement |
| --- | --- | --- |
| `hybrid-b` | Org1 + Org2 | `AND(Org1 peer, Org2 peer)` |
| `hybrid-self` | Org1 + Org3 | `AND(Org1 peer, Org3 peer)` |

Mỗi nhóm cộng tác có channel riêng nên lịch sử không liên quan không bao giờ
chia sẻ. Channel pilot **không** chứa lịch sử legacy; chuỗi legacy tiếp tục dùng
route bản A.

## 2. Dựng mạng

Chạy trong WSL2/Linux có Docker. Dữ liệu nằm ở `~/agritrace-fabric`
(`AGRI_FABRIC_ROOT` để đổi).

```bash
bash blockchain/network/hybrid/hybrid-network.sh up       # CA, MSP, genesis, orderer, peer, channel
bash blockchain/network/hybrid/hybrid-network.sh deploy   # package, approve, commit chaincode (CCaaS)
bash blockchain/network/hybrid/hybrid-network.sh status
bash blockchain/network/hybrid/hybrid-network.sh export   # chỉ tạo material kết nối của AgriTrace
```

`export` ghi vào `blockchain/.fabric/runtime` (đã gitignore). Material của
Org3 **không bao giờ** được export vào API/Worker; harness test chỉ đọc nó để
đóng vai operator của chủ chuỗi.

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

API vẫn chạy được không có Fabric. Worker chỉ nối tới binding khi được cấu hình:

| Biến | Ý nghĩa |
| --- | --- |
| `FABRIC_BINDINGS_CONFIG` | Đường dẫn file JSON `version: 1` liệt kê kết nối theo `bindingDigest` |
| `FABRIC_LEGACY_WRITER` | `false` để Worker không chạy writer legacy bản A |

File cấu hình chỉ chứa **chi tiết kết nối** (peer, TLS, đường dẫn cert/khóa
của relayer/controller/admin). Channel, chaincode, contract, writer MSP lấy từ
dòng binding bất biến nên file này không thể chuyển hướng sang ledger khác.
Không đưa khóa riêng, mật khẩu hay token vào tài liệu hay ví dụ.

```json
{
  "version": 1,
  "bindings": [
    {
      "bindingDigest": "<64 hex>",
      "peerEndpoint": "localhost:7051",
      "peerHostAlias": "peer0.org1.example.com",
      "tlsCertPath": "<path>/org1-peer-ca.crt",
      "mspId": "Org1MSP",
      "relayer": { "certPath": "<path>", "keyDir": "<path>" },
      "controller": { "certPath": "<path>", "keyDir": "<path>" }
    }
  ]
}
```

Worker chạy các bước theo thứ tự: writer legacy (nếu bật) → `ledger-control`
(job quyền) → `binding-delivery` (gửi event) → `enterprise-connections` khi bật
admission. Mỗi binding có circuit breaker
riêng: một binding lỗi không chặn binding khác (HYB-AC-10).

## 4. Đưa một chuỗi lên binding

Do platform operator thực hiện bằng CLI (không qua HTTP, người dùng nghiệp vụ
không chọn channel/MSP):

```bash
cd apps/api
npx tsx scripts/ledger-operator.ts register-binding --chain <uuid> --network <name> \
  --channel hybrid-b --writer-authority agritrace-relayer-b --writer-msp Org1MSP \
  --governance-digest <sha256> --profile MANAGED_ORG
npx tsx scripts/ledger-operator.ts onboard --binding <digest> --config operator.json
npx tsx scripts/ledger-operator.ts activate --binding <digest>
npx tsx scripts/ledger-operator.ts status --chain <uuid>
```

`onboard` thực hiện đề xuất → phê duyệt của **mọi MSP governance yêu cầu** →
thực thi trên registry, rồi ghi fingerprint chứng thư relayer vào allowlist
(ledger và DB). Kết quả là một binding `PENDING`; `activate` chỉ thành công
khi registry trên ledger đã xác nhận. Các lệnh còn lại:

| Lệnh | Tác dụng |
| --- | --- |
| `pause` / `resume` | Tạm dừng/tiếp tục gửi event của binding |
| `resolve-hold --hold <uuid> --resolution "<text>"` | Đóng một delivery hold sau khi rà soát |
| `status [--chain <uuid>]` | Quyền, outbox, hold, control job theo binding |

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

# Nghiệm thu mức ledger trên Fabric thật (30 kiểm tra, gồm 9 kiểm tra chữ ký bản C)
FABRIC_ROOT='\\wsl.localhost\Ubuntu\home\<user>\agritrace-fabric' \
  npx tsx blockchain/network/hybrid/acceptance/ledger-acceptance.mts

# API → Worker → Fabric thật (11 kịch bản, gồm 2 kịch bản bản C)
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
| Kích hoạt trên ledger | Vận hành viên | `ledger-operator.ts register-signing-key --key <keyRef> --config operator.json`: đề xuất, **admin của writer MSP và owner MSP cùng duyệt**, thực thi, đọc lại ledger rồi mới đặt `ACTIVE` trong DB |
| Thu hồi | ORG_ADMIN | `POST .../signing-keys/:keyRef/revoke`. DB thu hồi **ngay** (không chuẩn bị/ký thêm được); Worker tạo job `SIGNING_KEY_REVOKE` để rút khỏi registry ledger |
| Xoay khóa | ORG_ADMIN | Đăng ký khóa mới (`keyRef` mới) rồi thu hồi khóa cũ. Khóa đã thu hồi không bao giờ kích hoạt lại |

Khóa riêng không bao giờ vào DB, API hay Worker. Nếu tổ chức có nhiều khóa
hoạt động, request chuẩn bị ký phải chọn `keyRef`.

### 8.2. Bật chế độ bàn giao có chữ ký

```bash
cd apps/api
npx tsx scripts/ledger-operator.ts set-handover-mode --chain <uuid> --mode DUAL_SIGNED
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
npx tsx scripts/org-signer.ts keygen --out org-key.pem
npx tsx scripts/org-signer.ts register --key org-key.pem --binding <digest> --org <orgId> --label "Dịch vụ ký"
npx tsx scripts/org-signer.ts sign --key org-key.pem --intent intent.json   # in ra {"signature": "..."}
```

`sign` cũng tính lại mọi digest và từ chối nếu không khớp hoặc đã hết hạn.

### 8.5. Giao thức (tham chiếu nhanh)

- Envelope `5.0.0`, hash riêng tư `4.0.0`; commitment
  `SHA256("agritrace:binding-event:c1" 0x00 JCS(thân công khai + chữ ký))`.
- Thông điệp khóa ký:
  `"agritrace:intent-signature:c1" 0x00 JCS({intentDigest, chainRef, eventId, entityType, entityId, eventType, bindingDigest, keyRef})`
  nên chữ ký không thể chuyển sang sự kiện, thực thể, chuỗi, binding hay khóa khác.
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
bash blockchain/network/hybrid/hybrid-network.sh restore-peer org2 ~/agritrace-backup

# CSDL: sao lưu, khôi phục vào DB riêng, kiểm toàn bộ bằng chứng từ DB đã khôi phục
pg_dump --format=custom --file restore.dump "$DATABASE_URL"
createdb restore_check && pg_restore --no-owner --dbname restore_check restore.dump
cd apps/api && DATABASE_URL=<restore_check> npx tsx scripts/verify-evidence.ts   # thoát 1 nếu có sự kiện hỏng
```

`verify-evidence.ts` kiểm route đã ghim, proof lưu, hash riêng tư theo phiên bản
(A/B/C, gồm chữ ký tổ chức) và bằng chứng cảm biến — chỉ đọc DB. Material của
Org3 (tự quản) do chủ của nó sao lưu; archive của AgriTrace không bao giờ có nó.

Đã diễn tập ngày 13/10/2026: khôi phục peer Org2 từ bản sao ở khối 632 trong khi
ledger đã tới 725, peer bắt kịp 725 và nghiệm thu ledger 30/30 sau đó (owner
endorse đúng); khôi phục DB sang DB riêng cho cùng số bản ghi (31 sự kiện, 30
proof, 5 chữ ký, 3 bàn giao, 17 migration) và `verify-evidence` 31/31.

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

- Org tự quản chạy cùng máy chỉ chứng minh **cách ly logic**; peer ở host khác
  và doanh nghiệp giữ khóa thật là **NotEvaluated**. Khóa ký trong pilot do test
  sinh trên cùng máy, chưa phải khóa của doanh nghiệp thật.
- AgriTrace vẫn vận hành ordering service (một orderer Raft) trong pilot; chưa
  kiểm availability khi mất orderer.
- Binding không có `channelPolicy` giữ hành vi channel kiểu legacy (ghi nhận
  là lệch có chủ đích khỏi mô hình strict; channel strict chặn writer V3).
- Chưa có: ủy quyền ký qua dịch vụ AgriTrace, bằng chứng thời điểm ký độc lập
  (timestamp authority), chữ ký cho các sự kiện ngoài bàn giao (care, thu hoạch…),
  cảnh báo/health tự động cho dead letter (hiện chỉ hiện ở panel Ledger và CLI `status`).
- Hết hạn đề nghị chỉ được đánh dấu khi có truy cập liên quan (xem, chuẩn bị,
  nộp); chưa có tác vụ quét định kỳ trong Worker.

## 12. Đăng ký và kết nối doanh nghiệp v1

Đây là ứng viên demo có bước vận hành, chưa phải provisioning đa tổ chức tự động
hoặc nghiệm thu VPS thật. Mặc định API/Worker đóng admission. Chỉ bật
`ENTERPRISE_ONBOARDING_ENABLED=true` trên stack cách ly đã migrate khi thử.
Production cần review migration/lifecycle, backup/restore và nghiệm thu riêng;
không chạy `up`, `deploy`, `down` của pilot vào stack production.

Doanh nghiệp mở `/register`, chọn hoạt động chính và chế độ peer. Đăng ký tạo
account, tổ chức và receipt atomically, chưa cấp quyền nghiệp vụ. Đại diện đăng
nhập vào `/enterprise`; SYSTEM_ADMIN xét duyệt ở `/admin/enterprises`. Duyệt hồ
sơ cấp capability hoạt động, ORG_ADMIN và CREATE_CHAIN; các write vẫn cần quyền
đúng scope. Đại diện tạo chuỗi rồi gửi yêu cầu kết nối. Chế độ managed không nhận
cấu hình peer từ doanh nghiệp. Chế độ self chỉ nhận endpoint, tên TLS, MSP và CA
công khai. Không gửi SSH credentials, CA/admin/signing private key lên web.

Duyệt yêu cầu kết nối chỉ đưa vào hàng chờ. Operator chuẩn bị binding, lifecycle,
credential và permission như phần 4; đăng ký từ web không tự sửa channel trust.
Pilot pin Org1/2/3 và hai channel: **mỗi cặp network/MSP chỉ thuộc một doanh
nghiệp**, kể cả khi có nhiều chuỗi. Thêm doanh nghiệp cần network độc lập hoặc
quy trình mở rộng governance/channel được review. Không gán chung Org3MSP của
cùng mạng cho nhiều doanh nghiệp để vượt giới hạn.

Worker đọc hai inventory ngoài Git, chỉ mount readonly vào Worker:

- `FABRIC_BINDINGS_CONFIG`: kết nối writer như phần 3, có relayer/controller và
  admin của platform. Có thể thay file atomically để thêm binding khi đang chạy.
- `ENTERPRISE_CONNECTIONS_CONFIG`: danh sách đích đã được vận hành xác minh.
  API không đọc file này và không dial địa chỉ browser nhập.

Ví dụ inventory kết nối (UUID/digest/path phải thay bằng giá trị đã review):

```json
{
  "version": 1,
  "targets": [{
    "connectionId": "<UUID yêu cầu đã duyệt>",
    "organizationId": "<UUID doanh nghiệp>",
    "chainId": "<UUID chuỗi>",
    "bindingDigest": "<64 hex>",
    "ownerMspId": "Org3MSP",
    "peerEndpoint": "<VPN IP hoặc DNS>:11051",
    "peerHostAlias": "peer0.org3.example.com",
    "tlsCertPath": "/private/operator/public/enterprise-peer-ca.crt"
  }]
}
```

Worker kiểm đúng doanh nghiệp, owner chuỗi, profile, active binding và CA/endpoint
đã duyệt trước khi nối. Probe dùng writer technical identity, yêu cầu endorsement
của writer và owner; lưu txId trước traffic, đọc proof từ cả hai peer và kiểm
validation code VALID. Khi đó UI mới báo CONNECTED kèm thời điểm kiểm tra.
Không có probe hợp lệ thì health OK hoặc admin bấm duyệt đều không đủ.
UNKNOWN chỉ đọc đối soát txId/challenge cũ; không tự đổi key để gửi lại. FAILED
trước broadcast hoặc INVALID cho phép tạo yêu cầu mới sau xử lý. Inventory ghi
sai scope/MSP không được phép trỏ sang một doanh nghiệp khác.

### Demo peer tự quản trên máy doanh nghiệp

Cần Linux, Docker Engine, Node/npm theo README, `fabric-ca-client` và `peer` đúng
phiên bản pilot. Không cần Docker Compose. Hai host cần tuyến VPN/private IP hai
chiều; chỉ mở peer/orderer trên tuyến đã review. Tên TLS/discovery của platform
phải phân giải về platform trên máy và container doanh nghiệp. Đánh giá dung
lượng, port đang dùng và quota trước khi khởi động. Giới hạn container peer
512 MiB, chaincode 256 MiB, CA 256 MiB là quota demo, chưa phải cấu hình VPS tối
thiểu đã được đo.

1. Doanh nghiệp sao chép `blockchain/network/enterprise/spec.example.json` ra
   thư mục riêng, thay instance, VPN host, chaincode version/image digest,
   orderer và host aliases. Giữ Org3MSP/domain/channel theo governance pilot.
   Private root phải là thư mục mới; script từ chối ghi đè identity/tài nguyên
   Docker không thuộc installation đó. Khởi tạo CA local, cấp admin có
   `app.role=admin`, peer identity và TLS; private key ở nguyên máy doanh nghiệp:

   ```bash
   node blockchain/network/enterprise/peer.mjs init spec.json /srv/agritrace/demo-owner
   ```

2. Chỉ chuyển `public/msp` và `public/connection.json` cho operator. Doanh nghiệp
   nhập nội dung connection công khai lên web. Platform nhận public MSP ở một
   thư mục riêng rồi đặt biến cho **mạng demo mới**, port offset 0:

   ```bash
   export AGRI_FABRIC_ROOT=/srv/agritrace/demo-platform
   export AGRI_FABRIC_INSTANCE=agri-enterprise-platform-demo
   export AGRI_FABRIC_BIND_ADDRESS=<platform-VPN-IP>
   export AGRI_FABRIC_PORT_OFFSET=0
   export AGRI_SELF_PUBLIC_MSP=/private/operator/public/owner-msp
   export AGRI_SELF_PEER_ENDPOINT=<enterprise-VPN-IP>:11051
   # Chuẩn bị fabric-samples/bin và config theo mục 2 trước khi chạy.
   bash blockchain/network/hybrid/hybrid-network.sh up
   bash blockchain/network/hybrid/hybrid-network.sh deploy
   ```

   Chế độ này không tạo CA/admin/peer Org3 ở platform. `deploy` dừng sau bước
   platform approve và xuất `remote-bundle` chỉ có channel block, CaaS package,
   orderer TLS CA và chaincode image. Kiểm image ID được in ra, chuyển bundle
   cho doanh nghiệp; bản spec phải pin chính image ID/digest đó trước `init`.
   Image có thể build/pin trước `up`, hoặc dùng image đã review trên registry.

3. Doanh nghiệp kiểm nội dung/digest, đặt ba file công khai vào `private-root/public`,
   `docker image load -i chaincode-image.tar` nếu dùng image local, rồi tự chạy:

   ```bash
   node blockchain/network/enterprise/peer.mjs start spec.json /srv/agritrace/demo-owner
   node blockchain/network/enterprise/peer.mjs join spec.json /srv/agritrace/demo-owner
   node blockchain/network/enterprise/peer.mjs install spec.json /srv/agritrace/demo-owner
   node blockchain/network/enterprise/peer.mjs approve spec.json /srv/agritrace/demo-owner
   ```

   Platform chạy `hybrid-network.sh commit-remote`. Mỗi bên dùng admin ở host của
   mình. `join` giữ hash block gốc; `install` giữ package ID. Chạy lại `approve`
   chỉ thành công khi kiểm chứng đúng definition/policy và package đã được duyệt;
   lỗi không rõ kết quả không được xử lý bằng đổi spec hoặc tạo identity mới.
   Không chuyển thư mục `ca`, `crypto`, credentials hoặc keystore sang bên kia.
   Script không tự xóa dữ liệu khi lỗi. Backup/restore của split-host cần procedure
   riêng cho mỗi bên; lệnh backup/restore local pilot sẽ từ chối chế độ này.

4. Sau lifecycle, platform dùng CLI `register-binding`, rồi `onboard` với
   `--external-owner true`. File operator chỉ khai admin Org1, không chứa admin
   Org3. CLI trả exit code 2 và JSON `AWAITING_OWNER_APPROVAL` khi cần chủ mạng
   duyệt. Chuyển nguyên JSON công khai thành `review.json` cho doanh nghiệp.
   Sau `npm ci` và build gateway, doanh nghiệp kiểm đề xuất đang nằm trên ledger,
   đối chiếu nội dung rồi duyệt SHA-256 đã kiểm tại host mình:

   ```bash
   node blockchain/network/enterprise/approve-registry.mjs inspect spec.json /srv/agritrace/demo-owner review.json
   node blockchain/network/enterprise/approve-registry.mjs approve spec.json /srv/agritrace/demo-owner review.json <reviewed-sha256>
   ```

   Platform chạy lại cùng lệnh `onboard`; nonce ổn định giữ nguyên proposal. Lặp
   cho channel bootstrap, binding và writer credential, rồi `activate`. Đăng ký
   organization signing key cũng hỗ trợ `register-signing-key --external-owner true`;
   không bật DUAL_SIGNED trước khi registry key thật sự ACTIVE. CLI trên máy
   doanh nghiệp không dùng database URL của platform.

5. Cấu hình inventory cho Worker, bật feature trên API/Worker, quan sát
   `/enterprise`, đối chiếu txId/VALID trên hai peer. Nghiệm thu thêm outage,
   restart, lost-response và tài nguyên tại tải demo trước khi kết luận về VPS.
   Kiểm thử Docker cùng máy không thay thế mục nghiệm thu qua hai VPS thật.

`npm run test:hybrid:browser` kiểm thêm luồng Web đăng ký → duyệt doanh nghiệp →
tạo chuỗi → yêu cầu peer → duyệt → Worker probe trên Fabric thật, cho cả managed
và self-managed, tại chiều rộng desktop/mobile. Đăng ký mất phản hồi phải retry
đúng nội dung/UUID, không lưu mật khẩu vào browser storage; admin duyệt chưa đủ
để báo CONNECTED. Có thể kiểm riêng luồng này bằng
`node scripts/ci/hybrid-browser.mjs --enterprise-only`; receipt ghi suite riêng,
không thay acceptance bàn giao hoặc nghiệm thu hai VPS.

CI chạy `node scripts/ci/enterprise-peer.mjs` sau `hybrid-fabric.mjs` (hoặc
`npm run test:enterprise:peer` khi đã có image/tooling của cùng SHA). Bài kiểm tra
dùng hai Docker network, relay chỉ bind trên Docker host bridge và các root,
CA, identity, volume riêng; platform không tạo private Org3 material. Nó thử
join/install/approve lặp lại, doanh nghiệp inspect/approve registry tại root
của mình, rồi kiểm probe VALID và cùng proof trên hai peer. Receipt chỉ chứa
SHA, txId, quota và snapshot tài nguyên; không có khóa riêng. Đây vẫn là kiểm
tra cùng host, không đóng acceptance TLS/WAN hoặc cấu hình VPS tối thiểu.

Tài liệu Fabric gốc: [Fabric CA identity attributes](https://hyperledger-fabric-ca.readthedocs.io/en/latest/users-guide.html#attribute-based-access-control)
và [chaincode as an external service](https://hyperledger-fabric.readthedocs.io/en/release-2.5/cc_service.html).
