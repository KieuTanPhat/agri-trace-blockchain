# Bằng chứng nghiệm thu Hybrid A/B/C — 13/10/2026

Bản ghi trung thực những gì **đã chạy**, lệnh, kết quả và những gì **chưa**. Mạng
Fabric là pilot 3 Org cách ly trên một máy (WSL2/Docker); quyền của doanh nghiệp
đối tác thật là **NotEvaluated**. Chưa có exact-SHA CI trên GitHub cho nhánh này
và chưa mở PR; evidence dưới đây là chạy cục bộ.

## Phiên bản được kiểm

| Mục | Giá trị |
| --- | --- |
| Nhánh | `feature/hybrid-fabric-delivery` (so với `origin/main`; commit cuối trước tài liệu này `13af001` + thay đổi kiểu giao diện/tài liệu cùng checkpoint) |
| Migration A | `20261014000000_hybrid_chain_scope` sha256 `7a408b2ea9b23583ca314be781a726e6ff8b8e51fecd0c87216554909b02fd18` |
| Migration B | `20261015000000_hybrid_fabric_binding` sha256 `6a8061b1dad4cb427b447dc94c29599825a504cae6f9d1fd3c771432fe3b52a1` |
| Migration C | `20261016000000_hybrid_signed_handover` sha256 `fe251584833a7395dacaa7aaf9d49d4797d5349c75f41e8f6277a3f438fb2eb6` |
| Chaincode | `agritrace` 2.1, sequence 2, image `agritrace-cc:2.1` (`0d5f98b24070`) trên `hybrid-b` và `hybrid-self` |
| Governance digest | `f696418c8265ec4c179550a456188df773890af542a27352ae2876c933c94e83` |
| Fabric | peer 2.5.16 (`09ee75042de9`), orderer 2.5.16 (`e322c57331d3`), CA 1.5.22 (`a70b6ba64a08`); một orderer Raft |
| Giao thức | A: envelope 3.0.0/hash 2.0.0 · B: 4.0.0/3.0.0 · C: 5.0.0/4.0.0 |
| Công cụ | Node v24.14.1, npm 11.11.0, PostgreSQL 18 (Windows), Docker trong WSL2 |

## Lệnh đã chạy và kết quả

| Lệnh | Kết quả |
| --- | --- |
| `npm run check` (gốc) | Không có lỗi: API 143 unit + 199 E2E (11 Fabric thật bị bỏ qua vì không bật), Web 223, chaincode 105 test (coverage câu lệnh 91,72%), gateway 33, `test:ci` |
| `npm run test:worker-contract` | pass |
| `npm run check:chaincode:standalone` | PASS |
| `npm run api-contract:check` | khớp, 103 operation |
| `npm run audit:dependencies` | audit đầy đủ và production: 0 lỗ hổng; **`installed-tree` FAIL cục bộ** do cây `node_modules` của worktree có gói extraneous/invalid; manifest và lockfile **giống `origin/main`**, cần xác nhận bằng `npm ci` trên CI |
| `HYBRID_FABRIC_E2E=1 … hybrid-fabric.e2e-spec.ts` (API → Worker → Fabric thật) | 11/11 pass, chạy 3 lần (gồm sau khi nâng chaincode) |
| `ledger-acceptance.mts` (30 kiểm tra trên ledger thật) | 30/30, cả trước và **sau khi khôi phục peer Org2 từ backup cũ** |
| Diễn tập khôi phục DB (pg_dump → DB riêng → `verify-evidence.ts`) | cùng số bản ghi (31 sự kiện, 30 proof, 5 chữ ký, 3 bàn giao, 17 migration); 31/31 sự kiện xác minh; `migrate status` up to date |
| Diễn tập khôi phục peer (`restore-peer org2`) | khôi phục từ khối 632, bắt kịp 725 |

## Ma trận HYB-AC (A đã chạy ở phiên trước; B, C ở phiên này)

| AC | Trạng thái | Bằng chứng |
| --- | --- | --- |
| 01–08, 17, 18, 22 (A), 24 | Passed (A) | Policy/DB/migration E2E: `business-policy`, `hybrid-migration`, `traceability-workflow` |
| 09 Route/channel đúng binding | Passed | Ledger acceptance AC-09 (4), E2E thật |
| 10 Cô lập outage giữa binding | Passed | E2E thật: tắt một binding, binding khác vẫn xác nhận; restart, lease cũ, commit không rõ |
| 11 Peer tự quản, endorsement | Passed (pilot cùng máy) | AC-11 (6): thiếu endorse Org2/Org3 → `ENDORSEMENT_POLICY_FAILURE`; peer Org3 truy vấn đúng. Host khác: **NotEvaluated** |
| 12 Không lộ dữ liệu/lịch sử | Passed | AC-12: Org3 không có hybrid-b, Org2 không có hybrid-self; proof công khai chỉ trường đã duyệt |
| 13 Rotate/revoke/approval/relocation/backup | Passed (pilot) | AC-13; xoay chứng thư relayer; `backup`/`restore-peer` 632→725 |
| 14 Chữ ký sai actor/payload/chain/nonce/version/expiry/replay | Passed | API E2E (12) + chaincode (14) + ledger AC-14 (6); signer lỗi không tạo write |
| 15 Bàn giao ràng số lượng/version; thiếu xác nhận không hoàn tất | Passed một phần | E2E bàn giao. Nhãn cùng tổ chức: kiểm ở constraint DB và dịch vụ, **chưa có kịch bản E2E cùng tổ chức**; ủy quyền ký qua AgriTrace: **Deferred** |
| 16 Restore/canary/rollback, QR/warnings | Một phần | Restore DB + ledger đã diễn tập; canary/rollback ảnh và tải/backlog: **NotEvaluated** |
| 19 Rotate/expiry cert khi Pending | Passed | AC-19 (3) + E2E thật mất response/fence/đối soát |
| 20 Grant ledger chưa xác nhận không mở ghi; revoke có barrier | Passed | AC-20 (4) + E2E thật revoke/regrant/emergency hold; trigger DB |
| 21 Hoán đổi chữ ký/digest/dataHash/context bị chặn; vector khớp | Passed | Vector chung chaincode ↔ API ↔ Web; AC-21 (2); `trace-evidence.spec` |
| 22 (phần chữ ký) backdated không vượt revoke | Passed | AC-22: sự kiện khai `eventTime` 2020 bị từ chối sau thu hồi khóa |
| 23 Custody chỉ đổi sau xác nhận hai bên; A/B không bypass | Passed | E2E bàn giao: từ chối/hủy/hết hạn/version cũ không đổi custody; `start`/`arrive` 409; trigger DB chặn UPDATE trực tiếp |

## Chưa làm / chưa chứng minh

- **Kiểm tra giao diện thật trên trình duyệt chưa hoàn tất.** Đã xác nhận trong trình
  duyệt thật: tạo khóa Ed25519 không trích xuất, đăng ký với bằng chứng sở hữu (API chấp
  nhận) cho ba tổ chức demo và hiển thị trạng thái "Chờ kích hoạt". **Chưa** chạy luồng
  ký đề nghị/xác nhận bàn giao trong giao diện (đã có test component và E2E API); dừng
  ở checkpoint theo yêu cầu.
- Chưa có exact-SHA CI, chưa mở PR, chưa kiểm cổng CD (cổng sẽ chặn migration không
  "chỉ thêm" — xem runbook mục 10).
- `installed-tree` của audit phụ thuộc môi trường cục bộ (xem bảng trên).
- Không có bộ test trình duyệt tự động cho Hybrid (các script Playwright cũ đã bị
  bỏ cùng cơ chế legacy; dependency Playwright đã được gỡ khỏi manifest).
- Real doanh nghiệp: khóa/peer ở host khác, availability khi mất orderer, ủy quyền ký,
  timestamp authority, chữ ký cho sự kiện ngoài bàn giao: **NotEvaluated/Deferred**.
- Tác vụ quét định kỳ đánh dấu đề nghị hết hạn và cảnh báo dead letter tự động chưa có.
