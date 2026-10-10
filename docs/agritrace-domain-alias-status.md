# agritrace.dev song song với nongtrace.site — 10/10/2026

Đã thêm `https://agritrace.dev` và `https://www.agritrace.dev` vào cùng UAT.
Hai hostname mới giữ nguyên trên thanh địa chỉ, không chuyển hướng sang miền cũ.
`https://nongtrace.site` và `https://www.nongtrace.site` tiếp tục hoạt động.

## Phạm vi đã áp dụng

- DNS A `agritrace.dev` và CNAME `www.agritrace.dev` đã trỏ đúng IPv4
  `13.140.170.166`; không cần thay DNS trong thao tác này.
- Shared env thêm `PUBLIC_ALIAS_ORIGINS` cho hai HTTPS origin mới, thêm host
  vào Caddy và origin vào CORS. Release CORS overlay được cập nhật tương ứng.
- Giữ `PUBLIC_ORIGIN=https://nongtrace.site`, origin build/QR, repo/environment
  variables, mọi image và release CD hiện hành
  `uat-8bbf009c0cd43514ba07a5daa6407d697d537f9a`.
- Chỉ recreate API và proxy, với `--no-deps --no-build --pull never`.
  Container IDs của Web, Worker, PostgreSQL và Fabric giữ nguyên.
- Không migrate, seed, tạo business canary, restore dữ liệu hoặc thay chaincode.
  Không thay bốn installed helper/hashes của CD.
- Khóa `delivery.lock` chặn deploy đồng thời. Backup cấu hình và fingerprint
  trước thay đổi nằm trong thư mục private, mode 600 trên VPS.

## Kiểm chứng

Preview trên máy chủ xác nhận toàn bộ Compose model chỉ khác API CORS và
Caddy hostname. Caddy validate thành công trước khi thay cấu hình đang phục vụ.

Sau apply, TLS xác thực bình thường và `/login`, `/api/health` trả HTTP 200 trên
cả bốn hostname. `/api/docs` vẫn 404. Kiểm tra từ máy bên ngoài cũng trả 200 trên
cả bốn trang login và giữ URL của từng hostname; không tắt xác thực chứng chỉ.

Installed verifier đạt: năm roles, refresh/logout, CORS cho cả miền mới/cũ,
origin ngoài danh sách bị từ chối, PWA assets, sáu public QR và direct ledger.
Fingerprint của **49 TraceEvent, 49 BlockchainProof và sáu QR cũ** giữ nguyên.
CD current/previous/state không thay đổi. API/proxy giữ image IDs; các dịch vụ
còn lại giữ cả image và container IDs.

Backup ID: `20261010T080948Z-bf234e9e`. Preview rollback tới cấu hình cũ đã đạt;
không áp dụng rollback lên dịch vụ đang chạy. Hướng dẫn lệnh và guard chống
ghi đè cấu hình mới nằm trong [runbook alias](agritrace-domain-alias-runbook.md).
Evidence chứa env/accounts/fingerprints chi tiết chỉ lưu private trên VPS.

## Source và task chạy song song

Thực hiện trong worktree `agritrace-domain-alias`, branch
`codex/agritrace-domain-alias`, từ main `9e228b7`.
Không sửa checkout chính hoặc worktree `core-completion` của task đang code.

Patch trong nhánh alias bổ sung script quản trị/rollback, kiểm cấu hình, tests
và runbook. Web UAT bật build flag để chọn `/api` cùng origin;
SSR giữ internal API, development và Docker local giữ URL cấu hình. Patch này chuẩn bị cho
cookie auth đã có trên main `9e228b7`, cần tích hợp trước khi phát hành cookie
auth trên các alias. Không merge hoặc phát hành code nghiệp vụ của task kia.

Runtime đang chạy bản `8bbf009` dùng refresh token trong body. Thao tác vận hành
trên không rebuild/redeploy Web và không thay contract đăng nhập của runtime.
Đăng nhập/PWA được lưu riêng ở từng origin; hai miền cùng xem và ghi một bộ dữ liệu.

Linux: 38 tests policy/controller/installer/alias đạt, không skip. Thử rollout
lỗi trong test xác nhận phục hồi hai file cấu hình và chỉ chạy lại API/proxy.
Node config alias: hai tests đạt. Bộ test CI/gate/send/config có 27 test đạt,
ba test SSH transport skip theo nền tảng Windows, không có test lỗi.

Web kiểm bằng Node 24.19.0 và npm 12.1.0: typecheck, 107 unit tests,
84 lint-contract tests, bốn image-optimizer tests, ESLint/Oxlint và production
build đều đạt với `NEXT_PUBLIC_API_SAME_ORIGIN=true`. Dependency tree hợp lệ;
không thay package hoặc lockfile. `git diff --check` đạt.
