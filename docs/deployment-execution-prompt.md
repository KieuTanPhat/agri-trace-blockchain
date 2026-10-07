# Prompt thực hiện deploy UAT Agri Trace

Đã chốt với Phát ngày 07/10/2026, múi giờ Asia/Saigon.

> Chuẩn bị, kiểm chứng và triển khai UAT Agri Trace theo đúng các quy tắc dưới
> đây. Làm từng bước, lưu bằng chứng thực tế và dừng bước phụ thuộc khi gate
> chưa đạt. Không cam kết hệ thống tuyệt đối không có lỗi.

## Bối cảnh và mục tiêu

- Source nền là `main`, hiện ở `c1a69edbf95daf28ed441e05337d6b50ec0e9553`.
- VPS mới: Ubuntu 24.04 LTS, user `deploy`, IPv4 `13.140.170.166`, Europe;
  4 vCPU, 8 GB RAM, 100 GB SSD, chưa có website/database cần giữ trên VPS.
- Chưa có domain. UAT dùng `http://13.140.170.166`; việc chưa có domain không
  chặn chuẩn bị hoặc deploy. Domain/DNS/HTTPS là bước sau.
- Chuẩn bị và kiểm tra repo trước. Chỉ cấu hình/cài đặt VPS và deploy sau khi
  Phát review kết quả cụ thể và cho phép chuyển sang bước đó.
- Người thực hiện xử lý toàn bộ công việc trong phạm vi được duyệt; không
  yêu cầu Phát tự chạy lệnh kỹ thuật nếu không cần thiết.
- Cần đủ tài khoản SYSTEM_ADMIN, FARM_STAFF, TRANSPORTER, RETAILER, AUDITOR;
  Consumer tra cứu QR không đăng nhập. Mật khẩu các tài khoản UAT khác nhau,
  sinh ngẫu nhiên và không dùng lại mật khẩu SSH.
- Giữ nguyên DB local. Dữ liệu UAT kết hợp bản copy database hiện tại với tài
  khoản/dataset thử nghiệm bổ sung. Không reset hoặc seed ghi đè DB nguồn.
  Proof đã xác nhận chỉ được coi là hợp lệ nếu còn đối chiếu được ledger gốc;
  kiểm Fabric mới dùng dataset mới, không tự giả định ledger đã có lịch sử cũ.
  Đã phát hiện 2 event cũ sai hash/fingerprint; kiểm read-only và chốt cách
  nhập dữ liệu trước khi bật Worker. Không tự sửa hash/proof hoặc bỏ gate.

## Quy tắc bắt buộc

1. Đọc AGENTS.md, README, PROJECT_CONTEXT; dùng Swagger/current source/schema
   và Issue AGT làm bằng chứng. Chỉ dùng CodeGraph nếu có `.codegraph/`.
2. Giữ các thay đổi local của người dùng. Không `reset --hard`, `clean`,
   force push, xóa volume/ledger, đổi nhánh hay commit thêm tài liệu người dùng
   ngoài phạm vi. Backup trước thao tác có khả năng làm mất dữ liệu.
3. Phạm vi code: Compose UAT, proxy HTTP, cấu hình/secret, bootstrap tài khoản,
   preflight/smoke/backup và tài liệu. Giữ API contract, RBAC và state machine
   hiện tại; ghi riêng các gap nghiệp vụ, không tự mở rộng phạm vi để làm test
   xanh. Không thêm Kubernetes, Redis hoặc dịch vụ không cần thiết.
4. Không in, commit, chèn vào prompt/runbook, Docker image/build context hay
   báo cáo password SSH, token, JWT secret, IoT key, database URL có password,
   Fabric private key hoặc file credentials. Không đưa secret vào tham số
   shell/process nếu có thể cấp qua file/stdin được kiểm soát quyền.
5. Dùng phiên bản Node/npm thỏa engines và lockfile; không nâng major, sửa
   lockfile hoặc tắt gate chỉ để né lỗi. Không thay runtime hệ thống trên máy
   người dùng khi có thể dùng runtime riêng cho kiểm tra.
6. Compose UAT độc lập với Compose local: chỉ proxy publish HTTP; DB/API/Web,
   Worker và Fabric không public port theo mặc định. API không nhận signing
   identity. Worker chỉ đọc relayer MSP và TLS trust certificate cần thiết.
7. Migration là job một lần chạy trước API/Worker. Bootstrap là job riêng,
   có explicit UAT guard, transactional và chạy lại không đổi password/user
   đang có. Không dùng demo seed với NODE_ENV giả để vượt chặn production.
8. Web build dùng URL IPv4 công khai đúng; prefix `/api` được giữ nguyên qua
   proxy. Không để browser gọi hostname Docker hoặc localhost của client.
9. Giai đoạn A: Web/API/PostgreSQL hoạt động thật, Fabric tắt, trace là Pending.
   Giai đoạn B: Fabric thử nghiệm, relayer, Worker; phải có submit/commit/query,
   receipt/hash đúng trước khi kết luận proof được xác nhận.
10. Test-network trên một VPS là UAT; không gọi đó là topology Fabric production
    hoặc HA. Không để CA/peer/orderer mở ra Internet. Không dùng `smoke` có
    deploy chaincode như probe health định kỳ.
11. HTTP IPv4 phục vụ UAT với tài khoản thử nghiệm. Ghi rõ camera/PWA cần
    secure context; mở link QR/nhập mã vẫn phải hoạt động. Không giả chứng chỉ
    HTTPS hoặc yêu cầu người dùng bỏ qua cảnh báo chứng chỉ.
12. Kiểm tra đúng SHA/cấu hình cuối: lint/typecheck/unit/E2E DB test riêng,
    build, bootstrap lặp lại/rollback, Compose/proxy và container smoke. Kiểm
    tra cần Docker/Fabric mà chưa chạy được phải ghi là chưa kiểm, không thay
    bằng mock rồi gọi là đã đạt.
13. Kiểm tra repo và self-review trước bàn giao. Chỉ các lỗi trong phạm vi được
    sửa; lỗi ngoài phạm vi có source/reproduction/ảnh hưởng và đề xuất riêng.
14. Sau review, kiểm VPS thực tế trước cài đặt: OS, CPU/RAM/disk, dịch vụ/cổng,
    Docker hiện có, sudo và đường SSH. Không reinstall OS. Không đổi firewall
    hoặc tắt password/root SSH trước khi đường truy cập thay thế được thử.
15. Backup trước migration/import/update, kể cả dữ liệu UAT ít. Rollback giữ DB,
    trace/outbox/proof/ledger. Khi ledger và DB khác thời điểm phải reconcile
    event/hash trước retry; không đổi idempotency key khi kết quả chưa rõ.
16. Ghi expected/actual, test chạy/skip, SHA/config checksum, version, digest và
    giới hạn. Không báo “deploy xong”, “VERIFIED” hoặc “không có lỗi” khi thiếu
    bằng chứng tương ứng. Cập nhật tiến độ ngắn gọn trong lúc làm.

## Các gate

**Gate repo:** file thay đổi có thể review; cấu hình không lộ secret/port;
bootstrap đủ vai trò và idempotent; checks đúng source đạt; mọi kiểm tra chưa
chạy hoặc gap được nêu rõ; Phát review và cho phép chuyển sang VPS.

**Gate UAT ứng dụng:** login/refresh/logout, quản trị/catalog, cycle → hai
harvest/Lot → Shipment → nhận/từ chối → QR/public projection; negative RBAC
theo hợp đồng hiện có; Pending khi Worker/Fabric tắt. Luồng chưa được code
không được đánh dấu nghiệm thu chỉ vì UI hoặc schema có field.

**Gate Fabric:** giao dịch thật commit/query đúng event/hash/txId; Worker drain
Pending; duplicate/conflict/unauthorized được xử lý đúng; outage/recovery
không làm mất/trùng sự kiện. Có bằng chứng của môi trường VPS sau deploy.

**Gate vận hành:** reboot/restart, disk/log rotation, backup/restore/rollback,
chỉ cổng đã duyệt truy cập từ ngoài. Bắt đầu kiểm UAT ở 5–10 người dùng thử;
đo độ trễ từ Việt Nam và tài nguyên trước khi cam kết tải.

Acceptance/release cuối tiếp tục theo AGT-005, AGT-029, AGT-030, AGT-031.
Người thực hiện: Phát; review Backend/DB: Tuấn, Web/QR: Phi theo Issue.
