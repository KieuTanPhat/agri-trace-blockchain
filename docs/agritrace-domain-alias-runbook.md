# Tên miền HTTPS song song với nongtrace.site

Ngày chuẩn bị: 10/10/2026. Giữ `https://nongtrace.site` làm public origin chuẩn,
thêm `https://agritrace.dev` và `https://www.agritrace.dev` vào cùng ứng dụng.
Hai miền dùng chung dữ liệu; không tạo database, API, Worker hoặc Fabric khác.
Đăng nhập và dữ liệu PWA trên trình duyệt vẫn được lưu riêng theo origin.

## Điều kiện và ranh giới

- A/CNAME của hai hostname mới phải phân giải duy nhất về IPv4 VPS hiện hành;
  không thêm AAAA khi chưa kiểm IPv6. `.dev` yêu cầu HTTPS.
- Release hiện tại đã verified, dùng HTTPS và không có recovery journal.
- Chạy bằng SSH quản trị, từ source đã review, dùng `--expected-current` vừa
  đọc từ CD status. Khóa quản trị hiện có không đưa vào GitHub hoặc repository.
- `aliases.py` dùng cùng `delivery.lock` với CD, kiểm hai Compose models chỉ
  khác CORS của API và hostname của Caddy. Caddy validate trước khi apply.
- Backup mode 600 nằm trong `cd/domain-aliases/<backupId>`; không in env,
  credentials hoặc private keys. Không thay bốn installed helper của CD.
- Chỉ `compose up --no-deps --no-build --pull never` cho API và proxy.
  Giữ image, named volumes và container ID của các dịch vụ còn lại.
- Giữ `PUBLIC_ORIGIN`, repo/environment `UAT_PUBLIC_ORIGIN`, public QR base,
  trạng thái current/previous, database schema và chaincode sequence.

## Preview và áp dụng

Trên VPS, dùng release ID đã đọc từ CD status thay cho `<current-release>`:

```bash
sudo python3 deploy/cd/aliases.py --expected-current '<current-release>' \
  --alias https://agritrace.dev --alias https://www.agritrace.dev
```

Preview không đổi shared env, release overlay hoặc container đang chạy.
Script kiểm DNS, Compose model và Caddy syntax rồi in summary không chứa secrets.
Sau khi preview đạt, áp dụng cùng lệnh với `--apply`:

```bash
sudo python3 deploy/cd/aliases.py --expected-current '<current-release>' \
  --alias https://agritrace.dev --alias https://www.agritrace.dev --apply
```

Lệnh lưu backup trước khi thay shared env và release CORS overlay. API sẵn sàng
trước khi proxy được recreate; có thể gián đoạn ngắn. Caddy dùng volume hiện có
để giữ chứng chỉ cũ và cấp/gia hạn chứng chỉ mới. Không sửa bản ghi DNS cũ.

Sau apply, kiểm TLS hợp lệ và HTTP 200 tại `/login`, `/api/health` trên cả bốn
hostname; `/api/docs` tiếp tục 404. Kiểm CORS cho origin cũ/mới và từ chối origin
ngoài danh sách. Giữ mọi fingerprint sự kiện, proof và QR cũ. Installed verifier
kiểm năm role, refresh/logout, public QR và direct ledger theo auth contract
của release thực tế. Không tạo business canary trong thao tác thêm domain.

## Rollback

Nếu rollout hoặc verify lỗi, script tự restore hai file cấu hình và chạy lại
API/proxy theo image cũ. Nếu cần hoàn tác một apply đã thành công, dùng backup ID
trả về từ thao tác đó:

```bash
sudo python3 deploy/cd/aliases.py --expected-current '<current-release>' \
  --rollback '<backupId>'
sudo python3 deploy/cd/aliases.py --expected-current '<current-release>' \
  --rollback '<backupId>' --apply
```

Rollback bị chặn nếu release hoặc shared env đã đổi sau thao tác, để không ghi
đè secret rotation hay cấu hình mới. Đọc status và đối soát trước khi xử lý.
Không restore database/ledger hoặc xóa certificate volumes để rollback hostname.

## Web và các lần phát hành sau

Web UAT bật `NEXT_PUBLIC_API_SAME_ORIGIN=true` tại build (Compose và CD) để browser
gọi API qua `/api` của miền đang mở. Dockerfile mặc định `false`, nên development
và Docker local giữ API URL cấu hình riêng. SSR vẫn dùng
`http://api:8080/api`; build metadata và QR vẫn giữ origin chuẩn. Cookie auth
`SameSite=Lax` cùng kiểm tra `Sec-Fetch-Site` cần API cùng origin: CORS đơn thuần
không làm cookie dùng được giữa `agritrace.dev` và `nongtrace.site`.
Tích hợp patch API routing trong nhánh alias trước khi phát hành bản cookie auth.
Runtime 8bbf009 còn dùng refresh token trong body, nên thêm alias không yêu cầu
rebuild hoặc phát hành code ứng dụng mới trong bước vận hành hiện tại.

Shared env lưu `PUBLIC_ALIAS_ORIGINS` cùng Caddy/CORS. CD HTTPS dùng lại cấu hình
này; không đổi `UAT_PUBLIC_ORIGIN`. `deploy/config.mjs` kiểm aliases trong manual
preflight, installer giữ aliases khi update HTTPS origin. Rollback về release
HTTP đời cũ không phải cơ chế phục vụ các alias HTTPS.

Kiểm tra regression:

```bash
python3 -m unittest discover -s deploy/cd -p 'test_*.py' -v
node --test deploy/config.test.mjs
npm test --workspace apps/web -- src/lib/api-client.spec.ts
```

Test khóa Linux cần chạy trên Linux; các test này dùng thư mục tạm và mock,
không kết nối database hay Docker đang chạy.
