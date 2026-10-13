# Runbook Hybrid Fabric (bản B) — mạng pilot 3 Org local

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
(job quyền) → `binding-delivery` (gửi event). Mỗi binding có circuit breaker
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

# Nghiệm thu mức ledger trên Fabric thật (21 kiểm tra)
FABRIC_ROOT='\\wsl.localhost\Ubuntu\home\<user>\agritrace-fabric' \
  npx tsx blockchain/network/hybrid/acceptance/ledger-acceptance.mts

# API → Worker → Fabric thật (9 kịch bản)
cd apps/api
HYBRID_FABRIC_E2E=1 TEST_DATABASE_URL=<db test đã migrate> \
  npx vitest run --config vitest.config.e2e.ts test/hybrid-fabric.e2e-spec.ts
```

Các kịch bản E2E thật: luồng đầy đủ, revoke/regrant, cô lập outage giữa hai
binding, mất response + đối soát, fence, emergency hold. Test SQL guard chạy
với DB thường (`hybrid-binding-db.e2e-spec.ts`).

## 8. Giới hạn đã biết

- Org tự quản chạy cùng máy chỉ chứng minh **cách ly logic**; peer ở host khác
  và doanh nghiệp giữ khóa thật là **NotEvaluated**.
- AgriTrace vẫn vận hành ordering service (một orderer Raft) trong pilot; chưa
  kiểm availability khi mất orderer.
- Binding không có `channelPolicy` giữ hành vi channel kiểu legacy (ghi nhận
  là lệch có chủ đích khỏi mô hình strict; channel strict chặn writer V3).
- Chưa diễn tập backup/restore peer và chuyển peer sang host khác (xem tiến độ
  trong `docs/plans/hybrid-delivery-plan-2026-10-14.md`).
