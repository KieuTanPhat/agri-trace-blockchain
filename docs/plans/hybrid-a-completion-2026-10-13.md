# Hoàn tất các gate A còn lại — 13/10/2026

Chỉ đạo production-only ngày 12/10 thay mọi bước dev deployment/observation
trong các kế hoạch cũ. Dev đã retirement; production cleanup release 8ae đã
pass hậu kiểm, receipt riêng. Hybrid vẫn là candidate, không deploy draft.

## Thứ tự thực hiện

1. Giữ checkpoint 0158efd: 135 API unit, 31 SQL, diff zero + sáu guards,
   ORM, 89 policy/DB và 112 legacy E2E. Web 73777ac đạt 206 tests, 84 lint
   contract, bốn optimizer, type/lint/build. Không suy browser hoặc rollout pass.
2. Bridge: chụp reviewer grant + farm assignment hiện hành khi apply; replay
   phải giữ đúng grant/revision/assignment và kiểm independence hiện hành.
   Chụp registered devices + tracking binding, thêm authority revision chỉ tăng
   khi device identity/status/scope đổi; lastSeenAt không đổi authority. Replay
   gateway giữ đúng requester/device/binding/revision và positive journal.
   Creation root chỉ lấy từ journal khớp original key/body; device không có root
   hoặc command chưa được hỗ trợ giữ fail closed. Giữ journal/digest cũ.
3. Logical route: pin destination/protocol/writer authority cho event mới trong
   transaction; legacy backfill có inventory/proof/descriptor đối chiếu. Proof
   không fallback destination từ env mới. Worker từ chối route/config mismatch
   trước claim, không tiêu retry budget khi binding thiếu hoặc incompatible.
4. Browser desktop/mobile với app + PostgreSQL cách ly: lost response sau
   commit, remount/reload, hai tab cùng original key, account/revoke/stale result,
   activation và consent. Có receipt/cleanup; DOM tests không thay browser gate.
5. Promote candidate thành migration append-only sau review dependencies;
   checksum allowlist chỉ thêm migration mới. Fresh DB và sanitized legacy copy,
   inventory/hash/history/QR/journal trước/sau, restore và compatible app rollback.
   Rollback dùng image hiểu scope/pin, không mở lại quyền legacy.
6. Exact SHA CI, production backup/canary/rollback/observation; push trực tiếp
   main theo ủy quyền. B/C triển khai tiếp theo dependencies đã review, không
   dùng technical relayer hoặc peer cách ly để tuyên bố authority doanh nghiệp.

## Nguyên tắc kiểm chứng

Test DB local/runner có label/quota/port riêng; giữ WSL PostgreSQL 16 của người
dùng. Mọi failure gắn SHA và phân loại source/fixture/harness/resources trước
sửa. Không giảm assertion hoặc đổi hash/key để xanh. Candidate SQL chỉ chạy
DB cách ly; alignment diff chỉ đọc. Giữ nguyên applied migrations và hai docs
dirty có sẵn của người dùng. Bỏ file/function thừa khi đã xác nhận không có caller
và không phục vụ history/rehearsal/compatibility.

Bridge candidate đã bổ sung protocol 2 cho reviewer/device, giữ protocol 1 của
business actor. Snapshot chỉ ghi identifiers/revisions; journal và hash cũ giữ
nguyên. Chặn dùng journal scoped mới như legacy khi profile đổi revision. Sáu
DB regressions mới còn phải chạy: reviewer regrant/assignment, sensor/telemetry
epoch/binding, cycle-bound device creation/unknown outcome và scoped journal.
Local typed check gồm mọi hybrid spec, lint và Swagger generate 96 operations
đạt; chưa gọi các regression mới là pass. Manifest mới chỉ production/isolated;
runtime production từ chối isolated pins, môi trường dev đã bỏ.
