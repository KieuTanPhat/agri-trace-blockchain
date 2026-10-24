# Gỡ luồng ghi bản A, c1 và legacy nghiệp vụ

Lập ngày 24/10/2026. Nhánh `chore/remove-legacy-ledger-writer`, tách từ
`feature/public-site-redesign` (`4a2a5e2`), worktree riêng.

## Quyết định của chủ dự án

- Dữ liệu cũ, kể cả trên production, không có giá trị. Chủ dự án tự làm sạch
  production sau khi code sạch. Code không giữ tương thích đọc dữ liệu cũ.
- Gỡ hẳn luồng ghi bản A (route chung, envelope 3.0.0 / hash 2.0.0) và giao thức
  chữ ký c1, gồm cả bộ đọc/xác minh lịch sử. Không còn cờ `FABRIC_LEGACY_WRITER`.
- Xóa `docker-compose.app-fabric.yml` và `blockchain/network/network.ps1`
  (thay quyết định giữ trong [kế hoạch gỡ UAT](remove-uat-runtime-2026-10-14.md)).
- Môi trường không có Fabric (local, test e2e, CI rehearsal) dùng **binding giả lập**
  trong database (hướng P), không giữ đường ghi riêng. Fabric thật chỉ ở job
  `hybrid-fabric`.
- Giữ Shipment: nó mang bàn giao ký bản C, IoT khi vận chuyển và kế hoạch vận chuyển
  mà phiếu phân phối chưa có. Chuyển các tính năng này sang phân phối là việc riêng.
- Gỡ legacy nghiệp vụ: digest cảm biến theo vụ, đối soát mốc và `LEGACY_UNVERIFIED`;
  hồ sơ doanh nghiệp không cần kích hoạt (`ACTIVE_LEGACY`); custody chỉ ghi tên tổ chức;
  consent kế hoạch vận chuyển thiếu snapshot.
- Tổ chức do nền tảng cấp (không có hồ sơ đăng ký) vẫn hoạt động, trạng thái
  `OPERATOR_PROVISIONED`; đây là luồng cấp hiện hành, không phải hồ sơ cũ.
- Giữ dọn token `agritrace-auth` cũ trong trình duyệt vì là biện pháp an toàn.
- Bỏ field gói cước cũ (`products/setup/annual`) và bảng giá tĩnh; danh mục gói chỉ trả
  `version` (phí, kỳ hạn, hạn mức). Báo giá đã lưu giữ nguyên các khóa của nó.
- `family_id` của refresh session bắt buộc; không còn tương thích rollback về API cũ.

## Thay đổi

| Vùng | Nội dung |
| --- | --- |
| API/Worker | Bỏ writer A, `FabricAdapterProvider`, route env; mọi event cần binding `ACTIVE`; profile `UNBOUND`; chỉ verify B/c2 |
| Chaincode | Bỏ `RecordTraceEvent`, reader A, `validation.ts`; bootstrap bắt buộc `allowLegacyV3Writes=false`; signing chỉ c2 (giữ domain PoP `:c1`) |
| Gateway | Bỏ `FabricBlockchainAdapter`, `loadConfig`, smoke |
| CI | Bỏ `fabric-smoke`, `worker-contract`, `docker-compose.ci.yml`, `fabric-ports.mjs`, output `fabric`; rehearsal dùng `simulated-ledger` và kiểm B/C bằng chaincode |
| Deploy | Controller không còn `FABRIC_LEGACY_WRITER`, manifest chỉ bắt buộc `docker-compose.app.yml` |
| Local | Service `ledger-simulator` trong `docker-compose.yml` |
| Database | Migration `20261213000000`..`04`: từ chối dữ liệu cũ, rồi thêm ràng buộc/bỏ cột và bảng; refresh session bắt buộc có family |

## Acceptance

- Typecheck, lint và unit test API, Web, chaincode, Gateway đạt; e2e API đạt trên
  PostgreSQL cách ly đã migrate từ đầu.
- Migration mới từ chối database còn dữ liệu A (đã thấy khi áp lên DB test cũ).
- Vector c2 dùng chung giữa API và chaincode khớp.
- Chưa nghiệm thu: Fabric thật (`hybrid-fabric`, AC-11 kiểm hàm A không tồn tại),
  rehearsal production trên Linux, cập nhật controller VPS, lifecycle chaincode hosted
  và làm sạch database production.
