# Kế hoạch triển khai Hybrid Fabric AgriTrace — bản thực thi

| Trường | Giá trị |
| --- | --- |
| Ngày lập | 13/10/2026 (giờ Việt Nam), áp dụng từ 14/10/2026 |
| Nhánh | `feature/hybrid-fabric-delivery`, worktree `.claude/worktrees/hybrid-fabric` |
| Base | Checkpoint Codex `b3d37080` (bỏ WIP `85b50cf`) + merge `origin/main` `a450ca2` |
| Kế hoạch gốc | [hybrid-fabric-chain-owner-plan-2026-10-11.md](hybrid-fabric-chain-owner-plan-2026-10-11.md) — vẫn là nguồn yêu cầu A/B/C và HYB-AC |
| Phát hành | Một PR duy nhất vào `main` khi cả A/B/C đạt gate; `main` tự deploy production nên không merge trước khi người dùng duyệt |

## 1. Vì sao lập lại kế hoạch

Nhánh Codex `feature/hybrid-chain-business-scope` (79 commit, +44k dòng) đã
có code domain của bản A, nhưng chưa phát hành được. B và C chỉ có thiết kế.
Phân bổ khối lượng so với `origin/main`:

| Nhóm | Dòng thêm | Nhận xét |
| --- | ---: | --- |
| Domain A (API/Web/schema) | ~10.700 | Giữ lại; unit/E2E chạy được |
| Legacy-scope manifest/consent/pins/supersession, route import, restore canonicalizer, scoped verifier, harness | ~10.200 | Không tương xứng với dữ liệu production (~60 ledger event, 8 QR, 209 identity); là nguyên nhân kẹt |
| Tài liệu/evidence | ~11.000 | Giữ trong lịch sử git; không mang tiếp vào nhánh mới |

Quyết định người dùng ngày 13/10/2026:

1. Giữ domain A, cắt ceremony.
2. Dữ liệu legacy được backfill tự động vào chuỗi legacy bằng migration xác
   định; hash/proof/QR cũ giữ nguyên.
3. Fabric B/C dùng mạng local 3 Org cách ly. Authority của doanh nghiệp đối
   tác thật ghi **NotEvaluated**.
4. Chỉ mở một PR khi xong A/B/C.

## 2. Baseline đo được (13/10/2026, PostgreSQL 18 native, Node 24)

| Bộ test | Kết quả |
| --- | --- |
| API unit (`vitest run`) | 147/147 đạt (cần build `blockchain/gateway` trước) |
| API E2E (`vitest.config.e2e.ts`) | 112/112 đạt |
| Web (`vitest run`) | 207/207 đạt |
| `*.hybrid-db-spec.ts` | Lỗi: phụ thuộc fixture của harness legacy — sẽ thay bằng test mới |

DB test: `agritrace_hybrid_test` trên PG18 local, `TEST_DATABASE_URL` trong
`apps/api/.env` (không commit).

## 3. Nguyên tắc giữ nguyên

- Không sửa migration đã apply trên production (14 migration đến
  `20261010140000_lot_origin_evidence`). Ba migration hybrid chưa lên production
  nên được gộp lại.
- Không rehash, không sửa `trace_event`, `blockchain_proof`, QR hoặc txId cũ.
  Envelope 3.0.0 / private hash 2.0.0 tiếp tục đọc và ghi cho route legacy.
- Mọi command ghi giữ `Idempotency-Key`, optimistic version, kiểm quyền dưới
  khóa transaction và trước replay.
- API không giữ Fabric signing key; Worker là nơi duy nhất ký giao dịch Fabric.
  Khóa chữ ký actor (bản C) không bao giờ nằm ở API/Worker.
- Swagger sinh từ NestJS là API contract; Web types sinh lại, không sửa tay.

## 4. Các giai đoạn

### P1 — Làm gọn bản A

| Việc | Chi tiết |
| --- | --- |
| Xóa | `legacy-scope*`, `legacy-command-bridge`, `legacy-replay-authority`, `legacy-creation-replay`, `legacy-cutover-policy`, `ledger-route-import*`, scripts `check-hybrid-*`/`hybrid-legacy-inventory`/route operator, Web `supply-chains/legacy`, `legacy-scope-panel`, harness `scripts/ci/hybrid-*`, `deploy/hybrid-*`, các test tương ứng |
| Trả về `origin/main` | `.github/`, `deploy/`, `docker-compose*`, `.env*.example`, `scripts/ci` (giữ thay đổi cần thiết của worker-contract) |
| Một chế độ phân quyền | Sau migration mọi org có capability + business scope, mọi cycle có `chainId` (NOT NULL). Bỏ nhánh "subject legacy dùng global role" cho command nghiệp vụ |
| Migration gộp | `20261014000000_hybrid_chain_scope`: schema A (capability, chain, membership, grant, assignment, ShipmentPlan, event chain context, ledger route) + backfill xác định |
| Backfill | Capability từ `organization.type`; mỗi org FARM có cycle → một "Chuỗi legacy" do chính org đó làm chủ; membership ACTIVE cho org FARM và các org vận chuyển/bán lẻ/kiểm định đã tham gia; grant org-scope + chain-scope suy từ role cũ; assignment ACCEPTED cho cycle/shipment hiện có; context/route cho event cũ trỏ định nghĩa route legacy |

Gate P1: migrate DB trống và DB có dữ liệu seed cũ; hash/proof/QR không đổi;
API unit/E2E và Web xanh sau khi cập nhật test sang mô hình chuỗi.

### P2 — Hoàn tất bản A

- Test DB/HTTP cho HYB-AC-01..08, 17, 18, 22, 24 (dataset ở mục 8 kế hoạch gốc).
- Sinh lại OpenAPI + `apps/web/src/lib/generated/api.d.ts`.
- Web: chọn chuỗi, lời mời, work queue, ShipmentPlan, org admin; kiểm hủy
  request khi đổi chuỗi/tài khoản.
- Playwright e2e gọn cho luồng chủ chuỗi → đối tác → QR công khai.

### P3 — Bản B: nền dữ liệu và router

- Schema: `fabric_network_binding`, `fabric_binding_revision`,
  `fabric_credential_revision`, `chain_ledger_profile`, `cycle_ledger_context`,
  `event_binding_context`, `ledger_permission_epoch/sync`, `delivery_attempt`
  (+ outcome), `delivery_hold` (+ resolution). Append-only, không private key.
- Envelope 4.0.0, trace hash schema 3.0.0, route protocol
  `agritrace-ledger-route/2`; commitment B khớp 5 vector trong thiết kế B.
- Worker: pool adapter theo binding/revision, chia lượt round-robin, health
  theo binding; flow `newProposal → txId lưu PREPARED → endorse → submit →
  status`, reconcile UNKNOWN trước khi gửi lại.
- Proof query theo route của event, không fallback channel.
- Permission sync: grant chưa xác nhận trên ledger không mở ghi; revoke
  thường có barrier/drain; emergency hold.

### P4 — Bản B: Fabric thật, 3 Org local

| Org | Vai trò | Cách ly |
| --- | --- | --- |
| AgriTraceMSP | Orderer Raft + peer + relayer SERVICE | Compose project `agritrace` |
| OwnerMSP (MANAGED_ORG) | Peer hosted cho chủ chuỗi | CA/MSP/volume riêng, cùng host |
| SelfMSP (SELF_MANAGED_ORG) | Peer tự quản | Compose project, CA, thư mục key riêng; không mount vào API/Worker |

- Channel mới `hybrid-b`, không chứa history legacy. Chaincode thêm registry
  binding/writer credential/permission epoch/delivery fence, endorsement
  `AND(AgriTraceMSP.peer, OwnerMSP.peer)`, chặn `RecordTraceEvent` V3 trên channel strict.
- Script join, rotate cert, revoke, backup/restore peer.
- Gate: HYB-AC-09..13, 19, 20 chạy trên Fabric thật; mock chỉ dùng cho unit.

### P5 — Bản C: chữ ký độc lập và bàn giao hai bên

- Ed25519 (SPKI DER, chữ ký 64 byte base64url), đăng ký khóa có
  proof-of-possession, registry trên ledger.
- Signing intent (command/event ID, chain, entity, operation, expected version,
  payload digest, nonce, expiry, policy version); verify trước commit.
- Envelope 5.0.0 / private hash 4.0.0; chaincode verify chữ ký ràng vào
  commitment, không nhận dataHash khác.
- Handover state machine `OFFERED/CONFIRMED/REJECTED/EXPIRED/CANCELLED`;
  START/ARRIVE chỉ thực hiện khi đủ hai xác nhận; endpoint A/B bị chặn trên stream C.
- Web signer: WebCrypto Ed25519 khóa non-extractable trong IndexedDB; CLI
  remote-signer mẫu. Gate: HYB-AC-14, 15, 21, 23.

### P6 — Hồi quy và phát hành

- Chạy lại toàn bộ A/B/C, `npm run check`, worker-contract, chaincode standalone.
- Diễn tập backup/restore DB + ledger trên môi trường cách ly; kiểm hash/QR.
- Cập nhật README, PROJECT_CONTEXT, ADR, runbook mạng 3 Org.
- Thêm checksum migration mới vào allowlist `deploy/cd/policy.py` theo quy trình review.
- Mở một PR vào `main`; người dùng duyệt trước khi merge/deploy.

## 5. Ghi nhận giới hạn

- Org tự quản chạy trên cùng máy chỉ chứng minh cách ly logic; host khác và
  doanh nghiệp giữ khóa thật là **NotEvaluated**.
- Chữ ký C chứng minh ý định của chủ khóa, không chứng minh chất lượng hàng.
- AgriTrace vẫn vận hành ordering service trong pilot.

## 6. Tiến độ

| Giai đoạn | Trạng thái |
| --- | --- |
| P0 Chuẩn bị | Xong 13/10/2026: nhánh, merge main, DB test, baseline |
| P1 | Đang làm |
| P2–P6 | Chưa bắt đầu |
