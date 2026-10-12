# Audit, cleanup và tiếp tục A — 12/10/2026

Người dùng yêu cầu tiếp tục phần chưa xong, kiểm cả fixture/test và xử lý code/file
thừa liên quan đến kế hoạch. Đây là bổ sung cho kế hoạch A → B → C, chưa là
nghiệm thu hay cho phép thay lịch sử/migration đã áp dụng.

## Phạm vi và quyết định

Kiểm các file policy, legacy apply/bridge, Web reconciliation, SQL draft và
test harness đã thay đổi. Xác nhận đường gọi, DB trigger/FK, contract Swagger và
failure log trước khi xóa. File chỉ chưa dùng ở runtime hiện tại nhưng cần cho
CLI, rehearsal, compatibility, generated contract hoặc evidence được giữ.

Không viết lại toàn bộ: các lỗi đã tái hiện có vị trí cụ thể, domain/history và
bộ regression vẫn kiểm được với quota hiện có. Áp dụng refactor trước official
migration vì candidate draft chưa chạy trên database dùng chung.

| Phát hiện | Tác động | Quyết định và kiểm chứng |
| --- | --- | --- |
| Web sensor reconciliation gửi `cycleId`, controller dùng `id` | Đối soát sai hash/payload | Sửa normalization; test controller payload contract |
| Recovery button nằm ngoài modal ActionPanel | Browser modal khiến nút không bấm được | Chuyển vào dialog; DOM test giữ original request và đóng sau outcome |
| Test DataForm thiếu cleanup; browser fixture thiếu named Web Locks | False failures/DOM leak; không phải lỗi tài nguyên | Cleanup mỗi test, mock khóa theo tên, giữ assertions nghiệp vụ |
| Local npm 11 đọc overrides của repo yêu cầu npm 12 không đúng | Dependency graph báo invalid dù versions khớp | Chạy npm 12.1.0 với Node 24.19.0 cách ly trong .codex; không đổi lockfile/versions/test |
| SQL rename `fn_hybrid_cycle_scope_before_legacy` nhưng không có caller/trigger | Tạo function dư trong candidate DB | Dùng CREATE OR REPLACE giữ guard hiệu lực; bỏ function bản sao không dùng |
| Nullable final mapping dùng cả cho UNRESOLVED | Checkpoint immutable khóa root vĩnh viễn, không thể resolve sau review mới | Tách checkpoint quyết định bất biến khỏi final mapping MAP duy nhất |
| Activation yêu cầu từng manifest cũ phải tự có mapping | Re-review sau stale consent/history drift không thể kích hoạt | Supersession theo root, append-only, digest độc lập và replacement cùng target |
| Create-chain service chưa tạo business profile; chưa có activation command | Chuỗi mới cần thao tác DB thủ công để chạy nghiệp vụ | Bổ sung PREPARING bootstrap và activation được gate/pin/current owner review sau regression checkpoint |

## Thứ tự triển khai và gate

1. Hoàn tất Web recovery: lưu original body/key trước write, named lock theo
   principal, inspect quyền hiện hành trước retry/replay. UNKNOWN không đổi key;
   known rejection mới cho restart. Terminal metadata không cache body/result.
   Chạy Web typecheck, unit/DOM, lint contract, image optimizer và production build.
2. Tách checkpoint `(manifestId, cycleId)` và mapping cuối `cycleId → chainId`.
   Mapping MAP tham chiếu checkpoint; UNRESOLVED chỉ checkpoint + cutover marker.
   Root đã MAP không remap; checkpoint/journal cũ không sửa/xóa hoặc rehash.
3. Manifest protocol 2 ghi rõ supersedes với digest của manifest trước theo
   từng root. Register kiểm pin cũ/mới, history snapshot và root còn unmapped.
   MAP replacement phải cùng chain; thiếu positive journal của old apply đang
   PROCESSING/COMPLETED chặn supersession. Serialize register/apply; old fresh
   apply bị chặn, original positive journal vẫn reconcile bằng quyền hiện hành.
4. Activation bỏ nghĩa vụ cũ chỉ qua supersession hợp lệ; nghĩa vụ MAP mới vẫn
   đòi final mapping. Active unresolved participant vẫn chặn. Kiểm partial apply,
   stale consent/regrant, history drift, unknown outcome và concurrent replacement.
5. Prisma validate/generate + API unit/lint/type/build + generated contract.
   Commit đúng file, archive exact SHA; PostgreSQL 18 cách ly chạy alignment
   read-only, SQL guards, HTTP/DB và legacy E2E. Không execute SQL diff.
6. Tiếp tục các gate A còn thiếu (activation inventory coverage, compliance/device
   bridge, logical historical route, browser/mobile, official migration/checksum,
   fresh/sanitized-copy restore/compatible rollback, CI/canary/observation), rồi B/C.

## Bằng chứng baseline đã kiểm lại

HEAD `0ac761a8b8524c0a1a1eb547e1130793a8236f47`: remote job bắt đầu
13:09:08 UTC, terminal passed 13:21:46 UTC ngày 12/10. 130 API unit, 30 SQL
assertions, full schema diff zero + 6 unique guards, ORM, 80 policy/HTTP/DB
(23 nhóm HTTP), 112 legacy E2E. Container/network/process test đã dọn.

Evidence root-private:
`/opt/agri-trace-admin/hybrid-scope-draft/90656209fc3c2be3-1791810548683870925`.
Job control:
`/opt/agri-trace-admin/hybrid-policy-jobs/agritrace-hybrid-policy-0ac761a8-1791810548172204106`.
Proof fixture là synthetic preservation rows, không phải Fabric commit.

Các kết quả này không áp dụng cho sửa Web/schema tiếp theo. Không có candidate
deployment hoặc official migration. Giữ failed logs và observation gaps. Quota
CPU/RAM làm suite chạy chậm hơn; các failure gần nhất có nguyên nhân logic hoặc
fixture cụ thể, không có evidence OOM/resource exhaustion là nguyên nhân chính.

Web recovery đã đạt kiểm local: 198 unit/DOM tests, 84 lint contract, 4 image
optimizer, lint không warning, typecheck và production build. Runtime đúng Node
24.19.0/npm 12.1.0; giữ failures của fixture/biến thừa/npm 11. Chưa tính đây là
browser/mobile trên app + DB thật hoặc evidence PostgreSQL cho schema tiếp theo.

Refactor checkpoint/supersession đã viết trong candidate, chưa nghiệm thu DB.
Local Prisma validate/generate, API typecheck/lint/build, 135 unit và OpenAPI
contract check 94 operations đạt. Thêm 6 scenario DB cho UNRESOLVED → MAP,
partial re-review/regrant, history drift, expired unknown/no-journal và known
rejection; suite policy dự kiến 86 tests/23 HTTP groups. Số dự kiến là đối chiếu
suite, không phải assertion đã chạy hoặc kết quả pass. Gate PostgreSQL, schema
diff zero, concurrency replacement và browser còn phải thực hiện trên exact SHA.
