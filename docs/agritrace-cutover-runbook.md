# agritrace.dev và Datadog UAT

Origin hiện hành là `https://agritrace.dev`; `www.agritrace.dev` cũng được phục vụ.
Miền cũ được gỡ khỏi Caddy, CORS, Web build, API QR base và cấu hình GitHub CD.
DNS miền cũ được chủ tài khoản gỡ tại TENTEN sau khi ứng dụng chuyển thành công.

## Cutover quản trị

`deploy/cd/cutover.py` chạy bằng root, dùng cùng `delivery.lock` với CD và từ chối
recovery journal. Archive source đã review vào `releases/uat-<source-sha>`;
build Web với public API/QR origin mới và `NEXT_PUBLIC_API_SAME_ORIGIN=true`.
Image phải có labels revision đúng source SHA và `agritrace.public-origin`.
API/Worker giữ image đang chạy, nên không đổi auth contract hoặc nghiệp vụ.

```bash
sudo python3 deploy/cd/cutover.py --expected-current '<current-release>' \
  --source-sha '<reviewed-source-sha>' --web-image '<built-web-image>' \
  --origin https://agritrace.dev
# Sau preview đạt, chạy lại cùng tham số với --apply.
```

Preview kiểm DNS, provenance, Compose model và Caddy. Apply lưu private backup,
chỉ recreate API/Web/proxy, cập nhật `trace_qr.trace_url` theo token hiện có;
giữ id/token/createdAt, mọi sự kiện và proof. Không migrate/seed hoặc tạo canary.
Kiểm HTTPS apex/www, auth năm role, QR/direct ledger và dịch vụ được bảo vệ.
Nếu lỗi, phục hồi cấu hình, URL QR và các container bằng image trước cutover.
Release quản trị được ghi rõ nguồn API gốc và nguồn Web; không giả mạo CI/main.
Source nghiệp vụ phải trùng byte với bản đang chạy; riêng `migration_lock.toml`
cho phép khác CRLF/LF do checkout Windows và Git archive, giữ nguyên nội dung.

QR đã in chứa địa chỉ cũ cần được in lại từ liên kết mới. Token và dữ liệu QR
được giữ, nhưng việc gỡ miền cũ khiến đường dẫn đã in trên giấy không còn mở được.
Các bản ghi triển khai/backup lịch sử được giữ private để đối soát và khôi phục.

## Datadog

Chạy project `agritrace-observability` riêng tại `/opt/agri-trace/observability`.
Không thêm Agent vào Compose/CD của ứng dụng. Pin digest từ registry Datadog;
API key hiện có chỉ lưu trong `.datadog.env` mode 600, thư mục mode 700.
File đó chứa `DD_API_KEY` và `DATADOG_IMAGE`, tuyệt đối không commit hoặc in ra.

Copy `docker-compose.datadog.yml` và `datadog.yaml` vào thư mục vận hành
(config đặt tại `config/datadog.yaml`), rồi dùng:

```bash
docker compose --project-name agritrace-observability --env-file .datadog.env \
  -f docker-compose.datadog.yml up -d --no-build --pull never --wait
docker exec agritrace-datadog-agent agent health
```

Chỉ thu log/metrics API, Worker, Web và proxy. Lọc healthcheck, che credential,
JWT và email tại Agent trước khi gửi sang Datadog US5. Không thu log PostgreSQL,
Fabric hoặc Portainer. Giới hạn Agent 768 MiB/1 CPU; không publish port;
APM/process tracing/security/remote configuration không được bật trong bước này.

Xem Logs Explorer với `env:uat service:agritrace`, hoặc lọc theo `container_name`.
Kiểm Agent healthy, số log gửi tăng và log đã xuất hiện trên tài khoản Datadog.
Giữ nguyên container IDs của ứng dụng trong khi cài Agent. Cần theo dõi usage
log ingestion/index và thời hạn credit của gói đang dùng; không tự đổi gói.

Rollback Agent: `docker compose ... stop agent`; giữ volume offset để tiếp tục
thu log sau này. Không dùng `down -v` hoặc thay cấu hình database/Fabric.
