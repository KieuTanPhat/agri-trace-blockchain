# Chuyển sang một môi trường production — 12/10/2026

Chỉ đạo mới của người dùng: bỏ môi trường dev, domain `nongtrace.site` và toàn
bộ CI/CD dành cho dev; triển khai từ `main` vào `agritrace.dev`. Chỉ đạo này thay
thế kế hoạch hai môi trường và yêu cầu production chỉ đọc trước đây.

## Quyết định triển khai

1. Production là target duy nhất. CI kiểm source cho main/PR vào main; không có
   dev delivery, light profile, dev ingress hoặc cơ chế resume/seed dev trên VPS.
   Các lệnh phát triển local không là một môi trường triển khai thứ hai.
2. Gỡ cấu hình/workflow/installer/controller/Edge dành riêng cho dev. Giữ gates
   kiểm đúng SHA, migrations/checksum, backup, hash/proof, rollback/recovery và
   signer separation của production. Giữ compatibility của release UAT đang
   được production adopt; không tạo hai controller cùng quản lý production.
3. Dừng job kiểm thử cách ly đang chạy trên VPS và xác nhận cleanup. Các kiểm
   tiếp theo chuyển sang local/GitHub runner hoặc tài nguyên test tạm thời ngoài
   VPS production; không dựng lại môi trường dev thường trực.
4. Trước gỡ runtime dev: khóa delivery, kiểm journal, snapshot PostgreSQL,
   ledger/identity/key/config và checksums. Giữ archive đã mã hóa/off-VPS và
   failure receipts. Sau đó revoke dev delivery, bỏ Edge route, dừng/gỡ đúng
   dev containers/networks. Không prune toàn Docker host hoặc xóa dữ liệu prod.
5. Kiểm sau retire: không còn dev/test process/container đang dùng CPU/RAM;
   production health, release, hashes/proofs/keys và dữ liệu giữ nguyên. Ghi
   tài nguyên giải phóng thực đo; không suy rằng toàn bộ RAM host là RAM ứng dụng.
6. Đưa thay đổi gỡ dev lên main trước bằng commit đã kiểm, push fast-forward.
   Checkout Desktop/main và các file dirty của người dùng giữ nguyên. Tích hợp
   Hybrid thành các commit đã đủ migration/compatibility/test; không đưa schema
   draft thiếu migration vào runtime production. Không force push hoặc bỏ remote
   changes để đạt mục tiêu trực tiếp main.

## File/config cần xử lý

- `.github/workflows/dev-cd.yml`, development target descriptor, dev Fabric
  provision/toggle/resume helpers và tests chỉ kiểm lifecycle đã bỏ: xóa.
- Reusable CD, publisher/sender, target policy, controller/admin, Edge Compose/
  Caddy và CI branch filters: chuyển production-only, giữ các guard cần thiết.
- Development GitHub environment/workflow/key, root dev config/helpers, dev
  runtime/ingress/Fabric resources: retire sau snapshot và đối chiếu ownership.
- README/runbook hiện hành: chỉ dẫn production. Tài liệu/evidence hai môi trường
  được giữ như lịch sử có dấu superseded, không dùng làm hướng dẫn hiện tại.
- Heartbeat hiện có đã chuyển sang production-only, tiếp tục Hybrid trong chat
  này; không monitor/resume dev theo prompt cũ, không tạo lịch hoặc agent mới.

## Checkpoint trước chuyển

Remote main `298758e02e252a2f2c2739685e489d5d099ccf46`; remote dev
`2d08e8ec003157de45a53ddd9b9df537e589acd5`. Worktree Hybrid HEAD
`bd7222e77d82f58ac148b1ae11fa796e10344e10`, còn activation source/SQL/OpenAPI
96 ops chưa commit. A/B/C chưa được nghiệm thu, khoảng 40% tổng.

Web `5bbab2c` đã đạt 198 tests, 84 lint contract, 4 image optimizer, lint/type/
production build. API/DB `0ac761a8` đã đạt 130 unit, 30 SQL, diff zero + 6 unique
guards, ORM, 80 policy/DB và 112 legacy E2E. `bd7222e` có 135 unit/local checks;
job đầu timeout ở copy dependency 300 giây trước DB tests, không phải test fail.
Job retry đã được dừng lúc 15:29:27 UTC theo chỉ đạo production-only, có
`cancellation.json`; unit inactive. Không dùng kết quả các
SHA cũ làm bằng chứng cho activation hoặc production-only source mới.

## Tiếp tục Hybrid

Sau chuyển: hoàn tất A scope/current authority/replay/consent/checkpoint/
supersession/activation/privacy/concurrency/browser, logical historical route
và bridge compliance/device; official migration, checksum, fresh/sanitized-copy
restore và app rollback tương thích. CI exact SHA, production canary/observation
vẫn là release gate. B/C tiếp tục theo dependency trong kế hoạch Hybrid đã review.

Fabric production hiện có và technical signer không tự trở thành authority của
doanh nghiệp thật. Không rehash/reset lịch sử, ledger hoặc identity để vượt gate.
Kết quả retire/deploy sẽ được bổ sung sau khi thao tác thực tế được xác minh.

## Retirement đã xác minh — 16:00:53 UTC, 12/10/2026

- GitHub dev delivery và server dev delivery disabled lúc 15:43:24 UTC, không
  có journal/runtime toggle mở hoặc CD đang chạy. Workflow Dev CD/UAT CD đã
  bị disable; environment `development` đã xóa sau khi backup/retire hoàn tất.
- Snapshot dev giữ 13 direct ledger events, Pending 0. Writers/Fabric dừng khi
  chụp PostgreSQL, ledger, identities/config; archive CMS 163,093,199 bytes,
  SHA-256 `e3afca6152f7a774851439502a3434b23c1fb988e6e474b08fb9859758c49273`.
  Archive receipts/config CMS 625,354 bytes, SHA-256
  `c60401c8658ee1fda4b7a4d350777bf00815bc22812688e8d26ad7765e09ad86`.
  Hai archive đã tải ra khỏi VPS, kiểm giải mã và checksums; plaintext đã gỡ.
  Thư mục backup private ngoài repo: `~/.ssh/agritrace_retirement_20261012`.
- Gỡ 16 container có ownership dev đã review, gồm app/Fabric, hai chaincode
  và bốn stopped chaincode-build containers. Gỡ ba network dev và disconnect
  Edge khỏi dev ingress. Caddy production route đã validate/reload và hai
  production health endpoints đạt 200. Edge không restart.
- Thu hồi authorized deploy key/sudoers/entry dev; chuyển root config/helper
  vào archive quản trị và workspace cũ sang
  `/opt/agri-trace-retired-dev-20261012`. Cold volumes/archives còn được giữ
  làm backup, không có container/process dùng CPU/RAM; xóa data disk phải chờ
  restore rehearsal riêng. Không reset hoặc xóa lịch sử migration/domain.
- Production giữ `uat-fd425e9f0047a70a91d1b5bb21198ebc9363e900`, 118 fingerprints,
  209 identity files và ID/start/restart/state của 15 container ngoài dev.
  MemAvailable sau retire 6,214 MiB; đây là số đo tức thời có page cache,
  không phải cam kết ứng dụng nhận toàn bộ RAM host.
- Observation dev được đóng với lý do retire, `windowComplete=false`; các gap/
  failure trước đó giữ nguyên, không được đổi thành gate 24h đã đạt.

Evidence private: `/opt/agri-trace-admin/production-only-transition-20261012/`
(`quiesce.json`, `baseline.json`, `backup.json`, `retirement.json`) và các
receipt `.codex/production-only-*` trong worktree. Chỉ public metadata ở tài
liệu này; secrets/keys/payload không đưa vào Git.

Local working-tree kiểm deployment: 74 Python cases, 49 passed/25 Linux-only
skipped; 34 Node cases, 29 passed/5 transport Linux-only skipped. Linux CI vẫn
là gate bắt buộc. Test packaging giữ nguyên assertion exact committed bytes;
fixture thêm LF attributes để không lệ thuộc global Windows `core.autocrlf`.
Main publication và production release chưa được ghi là pass tại checkpoint này.

Production full verification lúc 16:04:16 UTC đạt 59 direct ledger events,
37 entity histories, Pending 0, 2 QR verified/6 QR legacy đúng catalog và Fabric
sequence 3; health/roles/session refresh/logout/proof/hash/QR đều đạt. Container
PostgreSQL của job bị hủy đã gỡ sau kiểm đúng label; không có dev/test runtime
đang chạy trên VPS. CI source-only trên nhánh dev cũng cần được bỏ trigger tại
đầu nhánh dev, vì file workflow lịch sử trên nhánh đó có thể tự chạy khi push;
commit cleanup dev giữ nguyên app/schema và history, không deploy từ dev.
