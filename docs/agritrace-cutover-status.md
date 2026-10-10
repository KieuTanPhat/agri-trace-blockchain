# Chuyển hoàn toàn sang agritrace.dev và Datadog — 10/10/2026

UAT hiện phục vụ `https://agritrace.dev` và `https://www.agritrace.dev`.
Miền cũ đã bị loại khỏi Caddy, CORS, public API/QR origin và Web build.
Kiểm tra bên ngoài: login apex/www và API health trả 200 với TLS hợp lệ;
hostname cũ không còn bắt tay HTTPS được, CORS không trả allow-origin cho miền cũ.
Swagger vẫn bị chặn công khai. HTTP IPv4 được giữ cho truy cập legacy.

## Bản đang chạy và ranh giới thay đổi

- Release quản trị: `uat-e786ef52538bff6eb49d09cb238aca0d1183102d`.
- Source Web/cutover: `e786ef52538bff6eb49d09cb238aca0d1183102d`, archive từ Git.
- API/Worker vẫn là bản nghiệp vụ `8bbf009c0cd43514ba07a5daa6407d697d537f9a`,
  image `sha256:5bc281a965c4d0499de2a4a831a2cca81806814484b0a033d356088cd6d596de`.
- Chỉ recreate API/Web/proxy; không migrate, seed, bootstrap hoặc canary ghi dữ liệu.
  Database, Worker, Fabric giữ nguyên runtime. Helper CD đang cài không bị thay.
- Web mới build API cùng origin (`/api`) và QR base `https://agritrace.dev/trace`.
- GitHub repository variable và environment `uat` variable `UAT_PUBLIC_ORIGIN`
  đều đã đọc lại và xác nhận là `https://agritrace.dev`.

Cutover ghi rõ `applicationBaseSha` và `webSourceSha`, giữ release trước đó để
rollback. Không gán nhãn đây là release main/CI mới của toàn bộ ứng dụng.
Source cấu hình được tích hợp riêng trong PR #74; PR cần merge trước lần CD
main tiếp theo để workflow nhận origin mới. Checkout chính và worktree của
chat đang code nghiệp vụ không được chỉnh sửa bởi tác vụ chuyển miền này.

## Kiểm chứng dữ liệu và ứng dụng

Verifier đang cài kiểm đăng nhập/refresh/logout 5 vai trò, 6 QR và direct ledger.
Sau cutover vẫn có nguyên 49 `trace_event`, 49 `blockchain_proof`, 6 `trace_qr`.
Đối chiếu hash từng row giữ nguyên sự kiện/proof và mọi trường QR ngoài `trace_url`;
QR id, token và thời điểm tạo không đổi. URL của cả 6 QR đã chuyển sang miền mới.
QR giấy chứa miền cũ cần in lại từ liên kết mới.

Web source đang chạy: typecheck, lint, production build và 102 test đạt.
Source PR dựa trên main: typecheck và 107 Web test đạt; Node config/CI gate đạt
27 test, 3 SSH test bỏ qua theo nền tảng Windows. Bộ CD trên Linux đạt 42 test.
Guard cho phép CRLF/LF chỉ ở Prisma lock metadata và Caddyfile, từ chối thay đổi
nội dung nghiệp vụ hoặc chính sách proxy.

Evidence private trên VPS:

- `/opt/agri-trace/cd/origin-cutovers/uat-e786ef52538bff6eb49d09cb238aca0d1183102d/result.json`
- `verification.json` và bản sao env/config/state/QR trong cùng thư mục root-only.
- `/opt/agri-trace/cd/agritrace-cutover-review/post-result.json` chứa tóm tắt kiểm tra
  công khai; không chứa key, mật khẩu hoặc payload đăng nhập.

## Datadog đã nhận log

Agent chạy riêng trong project `agritrace-observability`, hostname `agritrace-uat`,
site US5. Image được pin từ registry chính thức:
`registry.datadoghq.com/agent@sha256:779986aa446bb10cbc9db7d1352f0c648943a3d7082d350eadc18ba931eefa21`.
Cài Agent giữ nguyên cả 14 container ứng dụng/hạ tầng đang có, không restart chúng.

Agent healthy, giới hạn 768 MiB và 1 CPU, không publish port. Thu log/metrics của
API, Worker, Web và proxy; PostgreSQL, Fabric, Portainer được loại khỏi danh sách.
Lọc healthcheck và che credential/JWT/email trước khi gửi. APM/process tracing,
security và remote configuration không bật. Key hiện có nằm trong file private
mode 600 trên VPS, không commit và không ghi vào báo cáo.

Đã xác nhận trên Logs Explorer trong tài khoản US5: bộ lọc `host:agritrace-uat`
hiển thị 208 log trong 15 phút, gồm API 177, Caddy 26, Web 5 tại thời điểm kiểm tra.
Agent status sau cutover có 710 log đã gửi, không lỗi/cảnh báo gửi và không retry.
Số liệu này là snapshot, sẽ thay đổi khi có request mới.

Mở [Logs Explorer](https://us5.datadoghq.com/logs?query=host%3Aagritrace-uat)
để xem log. Worker dùng cùng image API nên service mặc định có thể là `api`;
lọc `container_name:agri-trace-uat-worker-1` khi cần tách Worker.

## DNS còn do chủ tài khoản xử lý

Chủ tài khoản chọn tự gỡ DNS miền cũ tại TENTEN sau khi ứng dụng chuyển xong.
Ứng dụng đã sẵn sàng cho bước đó. Gỡ bản ghi A/CNAME apex/www và các bản ghi
khác trỏ miền cũ về VPS nếu còn; không thay bản ghi DNS agritrace.dev.
Bản sao triển khai và tài liệu lịch sử vẫn được giữ để đối soát/khôi phục,
không được dùng làm cấu hình đang hoạt động.

Quy trình vận hành: [agritrace-cutover-runbook.md](agritrace-cutover-runbook.md).
