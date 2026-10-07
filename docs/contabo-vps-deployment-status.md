# Kết quả deploy Demo/UAT Contabo — 07/10/2026

Đã triển khai Web/API/PostgreSQL/Worker/Fabric trên VPS và hoàn thành các kiểm tra bàn giao.

- Web: <http://13.140.170.166/login>
- API health: <http://13.140.170.166/api/health>
- QR mẫu: <http://13.140.170.166/trace/ndfD7br-dL_jbYkEYpMzdWh7-i-8Wk9K>
- SSH: `ssh deploy@13.140.170.166`, dùng khóa id_ed25519 hiện có trên máy Phát.
- Release đang chạy: /opt/agri-trace/current.

## Source và runtime

Release: `uat-20261007-c1a69ed-893ca0d7e1d1`.
Base main SHA: `c1a69edbf95daf28ed441e05337d6b50ec0e9553`.
Overlay fingerprint: `893ca0d7e1d1a3b160992a4a13eea40a11b126dd8351da8011abdebfbbd2021a`.
Archive SHA-256: `5f4a63bcf2830c3f3ae72481ffce23f419c3e8800e9ed7dfe6723fffc8ee2959`.

Archive local: .uat/releases/uat-20261007-c1a69ed-893ca0d7e1d1.tar.gz.
Source gồm Git main và 26 file overlay đã đối chiếu checksum; không đóng gói working tree lẫn thay đổi riêng của Phát. Archive không chứa credentials, env thật, dump, node_modules hoặc Fabric private identities.

Host thực tế: Ubuntu 24.04.5 LTS, 4 vCPU, RAM khoảng 8 GB (7941 MiB theo free -m), root disk 96 GB. Ban đầu chưa có Docker/app/database hoặc deploy. Đã tạo deploy UID/GID 1001, cài Docker Engine 29.8.2/Compose 5.6.0 qua apt repo chính thức, Node 22.22.3 từ tar checksum đạt/npm 12.1.0 và swap 2 GB. Docker có log rotation 10 MB × 3. API/Web images build trực tiếp trên VPS; PostgreSQL 18 và Caddy pin digest.

Fabric 2.5.16/CA 1.5.22 dùng samples commit `5789681b4f4d24e58fa40f19a69f5496892374b6`.

Đã kiểm khóa SSH cho root/deploy ở phiên mới trước khi tắt password auth; root vẫn cho phép khóa. UFW allow SSH22/HTTP80 cho IPv4/IPv6. Chỉ proxy publish HTTP80; DB/API/Web/Worker không publish cổng host. Cả 13 runtime bindings Fabric là 127.0.0.1; từ máy ngoài không kết nối được cổng nội bộ. Worker chạy UID/GID 1001, signer/MSP và TLS CA readonly; API/Web không nhận key.

Lần kiểm tra cuối: RAM dùng khoảng 1.2 GB, swap chưa dùng, đĩa còn 82 GB.
Có thêm Portainer image pin digest, tạo lúc 13:33 UTC, bind duy nhất
127.0.0.1:19443; dịch vụ này chạy riêng và không thuộc candidate/backup của lượt deploy này.

## Dữ liệu

Theo lựa chọn đã đề xuất và thông báo trước khi nhập, kết hợp catalog hiện có với lịch sử UAT mới qua API. Full backup nguồn vẫn được bảo toàn; không sửa database máy Phát. Không nhập hai events cũ sai hash/fingerprint hoặc copy users/password/refresh sessions cũ.

Catalog copy: organization 10/product 3/farm 3/plot 2. Bốn COPY blocks được whitelist từ archive PG18, đối chiếu checksum nguồn và ID checksums; nhập sau migration vào catalog rỗng/writers dừng trong một transaction. Replay bị từ chối, counts/hash không đổi. Bootstrap tạo 5 tài khoản; lần hai báo 0 created/5 existing.

Dataset cuối: users 5, organizations 14, farms 4, plots 3, products 4, cycles 4, lots 6, shipments 6, TraceEvents 40. Vai trò SYSTEM_ADMIN/FARM_STAFF/TRANSPORTER/RETAILER/AUDITOR; public consumer truy cập QR không cần tài khoản.

## Kiểm thử thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Archive + 26 overlay checksums | Đạt trước build |
| API/Web container builds + 8 migrations | Đạt trên VPS |
| Bootstrap replay | 5 created lần đầu; 0 created/5 existing lần hai |
| Smoke giai đoạn A | 5 roles, RBAC403, idempotency, 2 harvests, shipments receive/reject, QR PENDING, refresh/logout |
| Event preflight trước Fabric | 13 events; hash/schema/validator đạt; writes 0 |
| Chaincode/Gateway smoke | Real submit/query/hash/proof/history/head đạt |
| Smoke giai đoạn B và sau reboot | VERIFIED; đủ 5 roles và các flows trên |
| Direct ledger cuối | 40 events khớp DB/API/ledger về ID/hash/predecessor/txId; 19 entity histories/heads khớp |
| Public QR cuối | 6 QR VERIFIED, toàn bộ timeline VERIFIED |
| Worker cuối | enabled/running; pending 0/retry 0/deadLetter 0; lastError null |
| Peer outage/recovery | API vẫn commit; Worker RETRY rồi tự CONFIRMED ở attempt 2; không sửa DB/outbox/proof |
| Reboot VPS | Boot ID đổi; Docker/SSH active và dịch vụ tự khởi động; smoke/ledger đạt sau reboot |
| Backup/restore DB cuối | Restore vào project riêng; 40 events/outbox/proofs; counts/traceHashDigest khớp; không có migration pending |
| HTTP từ máy ngoài | login/health/QR200; Swagger404; DB/API/Web/Worker/Fabric không public |

## Bàn giao và backup

Tài khoản ngoài repo: `C:\Users\kieup\.agri-trace-uat\uat-20261007-c1a69ed-893ca0d7e1d1\accounts.json`.
Folder ACL chỉ cho Windows user hiện tại và SYSTEM; không đưa password/token vào báo cáo hoặc logs công khai.

Snapshot cuối VPS: `/opt/agri-trace/backups/snapshot-20261007-final`.
Copy local ngoài VPS: `C:\Users\kieup\.agri-trace-uat\uat-20261007-c1a69ed-893ca0d7e1d1\snapshot-20261007-final`.
Ba archive đã đối chiếu SHA-256 sau copy: database dump, ba Fabric ledger volumes, và CA/MSP/signer/cấu hình riêng. Giữ thêm snapshot trước reboot. Restore chỉ chạy trên DB/project riêng; hai volumes kiểm thử được giữ và containers đã dừng. Không xóa/reset database hay volumes UAT.

Evidence VPS: `/opt/agri-trace/evidence/`, gồm smoke-stage-a/b, smoke-after-reboot, ledger-verification, event-preflight, fabric-bindings, peer-recovery, restore-check-final. Image IDs/restart policies nằm trong container-versions.txt của snapshot. Ảnh QR local: `.uat/evidence/vps-public-qr.png`.
Helper triển khai/backup/verify nằm trong `/opt/agri-trace/shared/` và `.git/safety/uat-tests/` local, không nằm trong image ứng dụng.

## Sửa lỗi vận hành trong lần triển khai

1. Npm global cài với umask077 khiến deploy không đọc/chạy được npm. Đã sửa quyền runtime công khai và owner root; npm12.1.0 dưới deploy đạt.
2. Gateway workspace npm ci thu gọn dependencies host; đã cài lại graph từ root bằng npm ci --workspaces --include-workspace-root và cập nhật runbook.
3. Script backup ban đầu start chaincode theo name cũ sau peer shutdown, trong khi peer tự xóa/tạo lại chúng. Đã sửa resume chỉ start sáu dịch vụ Fabric và API/Worker; snapshot cuối bằng script sửa đạt, kiểm direct ledger/restore 40 events đạt. Dữ liệu không bị mất hay sửa.

## Phạm vi và giới hạn

HTTP/IPv4 theo yêu cầu chưa mua domain. DNS/HTTPS và camera/PWA trên secure context thực hiện khi có domain. Đây là demo/UAT; khoảng cách nghiệp vụ ghi trong PROJECT_CONTEXT/contabo-uat-review giữ nguyên phạm vi.
Đã thử restore PostgreSQL; Fabric archives đã lưu/checksum và qua reboot/persistence checks, chưa restore vật lý sang mạng Fabric thứ hai.

Repo vẫn ở main; thay đổi riêng của Phát, backup Git và stash được giữ. Bộ thay đổi deploy/documentation chưa commit/push; release là snapshot có manifest, không coi CI của base SHA là CI của overlay. Docs cập nhật sau thực thi; code/images đang chạy giữ nguyên candidate đã build/test.
