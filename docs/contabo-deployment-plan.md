# Kế hoạch UAT Contabo

Cập nhật 07/10/2026 theo quyết định của Phát. Phạm vi là demo/UAT trên một VPS.

| Nội dung | Đã chốt |
| --- | --- |
| Source | Nền main tại c1a69edbf95daf28ed441e05337d6b50ec0e9553; thay đổi UAT chờ review |
| VPS | Ubuntu 24.04 LTS mới, user deploy, Europe |
| Tài nguyên | 4 vCPU, 8 GB RAM, 100 GB SSD; cần đối chiếu inventory thực tế |
| Truy cập | http://13.140.170.166; chưa cần domain để chạy UAT |
| Dữ liệu | Bản sao DB local + tài khoản/dữ liệu UAT bổ sung; giữ nguyên DB nguồn |
| DB UAT | PostgreSQL 18, khớp DB nguồn 18.6; Compose local/CI hiện tại giữ PG16 |
| Vai trò | SYSTEM_ADMIN, FARM_STAFF, TRANSPORTER, RETAILER, AUDITOR; Consumer không đăng nhập |
| Trình tự | Kiểm repo → Phát review → kiểm/cấu hình VPS → deploy A → tích hợp Fabric B |

Prompt ràng buộc: [deployment-execution-prompt.md](deployment-execution-prompt.md).
Lệnh vận hành: [contabo-uat-runbook.md](contabo-uat-runbook.md).
Bằng chứng: [contabo-uat-review.md](contabo-uat-review.md).

## Thiết kế

Compose UAT độc lập chạy PostgreSQL, API, Worker, Web và Caddy. Chỉ proxy
publish HTTP. Migration và bootstrap là job riêng chạy trước API. API không
mount signing identity. Giai đoạn A tắt Fabric, proof mới phải là Pending.

Overlay Fabric bật Worker sau khi test-network/chaincode đã được kiểm.
Worker chỉ đọc relayer MSP và peer TLS CA certificate. Script fabric-ports
kiểm revision upstream và giới hạn cả 13 host bindings của CA/peer/orderer về
127.0.0.1 trước startup. Kiểm lại bindings thực tế và truy cập từ bên ngoài.

Giới hạn RAM thường trực của app services tổng 3.125 GiB: PG 1, API 0.75,
Worker 0.5, Web 0.75, proxy 0.125. Đây là cấu hình, chưa phải số đo. Phần còn
lại dành cho Fabric/OS/cache. Build trước khi bật Fabric; đo RAM/restarts/disk
và độ trễ từ Việt Nam với 5–10 người dùng trước khi tăng tải.

Test-network hai org trên cùng VPS dùng cho tích hợp UAT. Không lấy kết quả
đó để kết luận HA hoặc các tổ chức vận hành độc lập. Xem
[Fabric test-network](https://hyperledger-fabric.readthedocs.io/en/release-2.5/test_network.html).

Caddy giữ prefix /api, chặn Swagger public và ghi đè forwarded client IP.
API chỉ trust một proxy khi UAT bật TRUST_PROXY_HOPS=1. Kiểm Docker bindings
trực tiếp vì publish port có thể đi qua quy tắc UFW; xem
[Docker packet filtering](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## Dữ liệu

Snapshot nguồn: 5 users, 10 organizations, 3 farms/products/cycles/harvests/
lots, 0 shipments, 2 trace events/outbox, 0 proofs. Dump dùng read-only snapshot
để counts/hash nhất quán. Archive, env và credentials nằm trong .uat/, được
Git và Docker build context loại trừ.

Restore chỉ vào DB rỗng khi writers đã dừng; verify archive SHA-256, major
version, counts và digest hash lịch sử trước migration. Bootstrap thêm 5
users với mật khẩu riêng và org/farm/plot/product UAT trong một transaction;
chạy lại không đổi user/password. Cycle/harvest/shipment mới tạo qua API để
có trace/outbox thật; không tự tạo receipt hoặc đổi trạng thái proof.

Nếu dump khác có proof CONFIRMED từ ledger cũ, cần reconcile ledger gốc trước
khi Worker chạy với network mới. Dump này có 0 proof; vẫn phải kiểm payload/
hash của outbox copy khi bật Fabric.

Đã phát hiện cả 2 trace events cũ sai local hash và actorAuthProof không hợp
lệ với chaincode. Đang chờ chọn danh mục cũ + lịch sử UAT mới, hoặc xử lý
tương thích lịch sử cũ trước khi bật Fabric; không tự sửa event/hash/proof.

## Nghiệm thu

A: DB thật, Web build đúng IPv4 URL, đủ vai trò, negative RBAC theo source,
replay idempotency, cycle → hai harvests/lots → shipment → nhận/từ chối,
QR public, refresh/logout, Pending khi Fabric tắt; kiểm restart/ports trên VPS.

B: Worker enabled/running không lỗi; outbox được xử lý; Fabric commit/query
đúng event/hash/txId và proof được xác minh; outage/recovery giữ nguyên event/
idempotency key. Worker health HTTP 200 không đủ làm bằng chứng Fabric.

HTTP IPv4 cho phép UAT ngay. Browser camera/PWA phụ thuộc secure context;
nhập mã/mở link từ camera điện thoại vẫn cần kiểm. Thêm domain/DNS/HTTPS sau
khi UAT ổn định. Xem [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Backup trước release và sau UAT: stop writers, archive + manifest, rehearse
restore vào DB khác; backup riêng ledger/MSP/CA/version. Rollback ưu tiên
image trước còn tương thích schema. Schema không tương thích cần fix-forward
hoặc phục hồi đã diễn tập. DB/ledger khác thời điểm thì giữ Worker dừng để
reconcile; không reset lịch sử.

## Trạng thái chuẩn bị

Lint/typecheck/unit/E2E và build toàn repo đã đạt trên DB test riêng.
Bootstrap transaction/replay, restore bản copy và smoke qua API/Web build
thật với Caddy/PG18 riêng đạt. Audit workspace không có advisory.

Compose A validate offline và Caddy config hợp lệ. Docker Desktop local không
khởi động do socket runtime không truy cập được; container UAT, Fabric với
thay đổi mới, Docker backup/restore và VPS chưa được nghiệm thu. CI đã bổ sung
các bước này trên Linux; cần chạy đúng candidate trước khi kết luận gate đạt.

Các gap nghiệp vụ trong [PROJECT_CONTEXT](PROJECT_CONTEXT.md), đặc biệt quyền
ghi Admin/Auditor, on-chain allowlist và bước bán lẻ, giữ theo Issue. AGT-005
#17, AGT-029 #41, AGT-030 #42 và AGT-031 #43 còn cần evidence/review riêng.
Phát review phần chuẩn bị trước khi chuyển sang VPS theo yêu cầu đã chốt.
