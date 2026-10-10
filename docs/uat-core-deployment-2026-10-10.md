# UAT core đã triển khai — 10/10/2026

Hoàn tất lúc **20:42:59 ICT (13:42:59 UTC)** tại
[agritrace.dev](https://agritrace.dev), theo yêu cầu người dùng lập kế hoạch,
review và thực hiện triển khai. Đây là bằng chứng triển khai/canary của coding
assistant; chưa thay owner signoff hoặc nghiệm thu nghiệp vụ/mobile đầy đủ.

## Phiên bản đang chạy

- Release: `uat-53bec18898482f74f613f021873ecf45b71c5c9c`.
- Source: [PR #79](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/79),
  merge `53bec18898482f74f613f021873ecf45b71c5c9c`; bao gồm các fix #77/#78.
- API/Worker:
  `ghcr.io/kieutanphat/agri-trace-blockchain/api@sha256:4263acf16f52e0d9afd51663d57718084420189301c876aa3b240ed990428a57`.
- Web:
  `ghcr.io/kieutanphat/agri-trace-blockchain/web@sha256:8e06ffacb3af66a9ae4e3e8ceba3dadf40e180ff917eb943e67bfa6239da9b86`.
- Fabric sequence **3**, version `cd-53bec1889848`; cả Org1/Org2 cùng package
  `agritrace-53bec18898482f74f613f021873ecf45b71c5c9c:a3a35cb0b3400edd2a36699721bbcbdef71045f27e190c91023ea2ab1838c09a`.
- Chaincode fingerprint:
  `97378cf8bc9b6f2d036c23e6a8d8f5ff06ad06369eb8cafb77dbf0334831abe3`.
- Đủ **14 migration** hoàn tất; đã provision `COMPLIANCE_REVIEWER` bằng image
  production. Năm tài khoản cũ, mật khẩu, tổ chức và assignment không bị thay.
- API, Worker, Web và PostgreSQL healthy; proxy phục vụ HTTPS. Journal đã đóng
  sau khi ghi kết quả bền vững và kiểm tra từ ngoài VPS.

## Kế hoạch, review và sửa điểm chặn

[Kế hoạch đã review](plans/uat-core-cutover-2026-10-10.md) ghi baseline,
checksum sáu migration, diễn tập, thứ tự maintenance/backup/upgrade/migrate và
phục hồi bằng fix forward. Không nới policy migration hoặc sửa applied checksum.

PR #79 sửa hai lỗi phát hiện khi chuẩn bị triển khai:

1. Sáu Lot cũ thiếu sensor window phải báo `LEGACY_UNVERIFIED`, khiến verifier
   cũ từ chối cutover dù event/proof còn nguyên. Verifier mới dùng catalog sáu
   Lot đã ghi riêng trong metadata root-owned; không cho release thường mở rộng
   danh sách. Mỗi QR legacy vẫn phải đối soát được state/quantity, sensor rỗng,
   từng timeline proof VERIFIED và tất cả hash/receipt/ledger khớp.
2. Lệnh provision role dùng `tsx` và source Prisma client không có trong image
   production. Lệnh mới chạy Node với client đã compile; CI và bản sao UAT chạy
   lệnh thật hai lần, `created=1` rồi `created=0`.

Tự review diff, regression trước/sau sửa, checks, review comments và mergeability
trước merge. Không có review độc lập của owner trong lượt này.

## CI và artifact đúng SHA

- **65/65 Python CD tests**, **24/24 Node CD tests** trên Linux đạt, gồm 7 test
  verifier. Windows `test:ci` đạt 34 test + 7 verifier; 3 bài SSH chỉ chạy Linux.
- Head PR #79 `a01cba9679fc725514adbc4c318ba9d2e422a82c` đạt **23/23 checks**,
  gồm container production, provision role, backup/restore PostgreSQL và Fabric thật.
- Main `53bec18898482f74f613f021873ecf45b71c5c9c` đạt cả ba workflow push:
  [Application CI](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38055412656),
  [Blockchain CI](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38055412587),
  [Dependency Audit](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38055412558).
- [UAT CD / artifact](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38055412577)
  xuất bundle ID `11671695556`; ZIP SHA-256
  `b0c143afecc02f7bf732f3319d2d75d0c2be4d7a0d3f543d5e1883838fde7514`;
  tar SHA-256 `fab93f1adcf81e49482f3f3ee4ee866568f155686ec05665d07aadfc2a2bd733`.
  Kiểm checksum manifest, Git bytes của năm helper, image labels/revision,
  signer mounts và Compose preflight trước khi thay ứng dụng.

CD tự động lần đầu dừng với `Unsupported migration SQL syntax` trước stop/backup,
vì SQL core có trigger/constraint ngoài allowlist. Cutover được thực hiện riêng
bằng quyền quản trị, giữ nguyên policy. Không sửa gate để làm delivery xanh.
Sau cutover, retry các job thất bại của cùng run **đạt toàn bộ**: delivery xác
nhận `unchanged` đúng release, sequence 3 và `recoveryRequired=false` lúc
13:44 UTC. Artifact backup mã hóa ID `11671631720` đã được upload ngoài VPS.

## Diễn tập và backup

1. Dump dữ liệu hiện hữu, restore vào DB riêng, apply đủ 14 migration. Cả 13 bảng
   nghiệp vụ được kiểm đều giữ nguyên số lượng và hash của từng dữ liệu gốc.
2. Candidate image cuối chạy migration/provision và API trên bản sao trong
   Docker network, không public port, không Worker ký vào ledger live. Năm role,
   49 API proof và sáu QR legacy đều đạt; quantity/state đối soát được.
3. Bật maintenance, kiểm từ ngoài apex/www trả 503; dừng API/Worker, xác nhận
   không còn outbox chưa hoàn tất. Chụp PostgreSQL + ledger Fabric + CA/MSP/config
   nhất quán, mã hóa CMS AES-256-GCM và copy ngoài VPS.
4. Giải mã bản copy bằng khóa riêng được giữ ngoài VPS; kiểm đủ năm checksum.
   Restore PostgreSQL snapshot vào DB riêng thứ hai, đối chiếu đủ 13 bảng và
   49 event/proof gốc. Không restore hoặc reset DB/ledger live.

Maintenance được bật lúc 13:33:14 UTC và mở proxy lúc 13:40:50 UTC theo log
controller, khoảng 7 phút 36 giây. Kiểm tra ngoài VPS hoàn tất lúc 13:42:26 UTC;
journal đóng lúc 13:42:59 UTC.

Snapshot trước cutover:
`cd-53bec18898482f74f613f021873ecf45b71c5c9c-20261010T133335497348Z`.
SHA-256 của `snapshot.cms`:
`10a4612453ae8502ae9c373b27af02abab0d29dedb0984b8fa8a816d0796046d`.
Evidence riêng nằm trong thư mục thao tác root-private trên VPS và thư mục
backup có ACL riêng trên máy quản trị. Không đưa credential hoặc nội dung
identity/backup giải mã vào Git. Lượt này restore thử PostgreSQL; không tuyên bố
đã dựng lại một mạng Fabric riêng từ ledger snapshot.

## Kiểm chứng sau cutover

| Gate | Kết quả thực tế |
| --- | --- |
| Chaincode | Sequence 3 trên hai peer, HealthCheck ghi v3/đọc v2 và v3. |
| Auth | Năm role, `/auth/me`, quyền Auditor, refresh/rotation/logout, JWT bị revoke, CORS đạt. |
| Canary core | 7 event v3 xác nhận, 5 CommandCommit; care chuyển GROWING, hai harvest tổng 0,002 kg. |
| Idempotency/lượng | Replay harvest giữ cùng ID, không ghi trùng; harvest vượt kế hoạch trả 422. |
| Sensor | Hai window NO_DATA có cutoff liên tiếp, includeStart đúng, count=0/hash=null; không bịa dữ liệu cảm biến. |
| Lịch sử | 49 event/proof cũ cùng hash/receipt giữ nguyên; row fingerprints của 13 bảng gốc không đổi. |
| DB/Fabric/outbox | 57 event, 57 proof, 57/57 outbox COMPLETED; toàn bộ direct ledger, entity history và API proof đạt. |
| QR | 6 QR cũ giữ LEGACY_UNVERIFIED/INTEGRITY_WARNING, mọi event proof VERIFIED; 2 QR mới VERIFIED với cảnh báo NO_DATA riêng. |
| Truy cập ngoài | 62 request đạt trên apex/www/HTTP IP cũ: login, health, private API 401, docs 404, 8 QR API + SSR, manifest và service worker. |
| Phục hồi | State/current/last-result bền vững; không còn journal; kiểm policy chặn target trước core. |

Hai Lot canary dùng mã `CORE-53bec1889848-1` và `CORE-53bec1889848-2`, nằm trong
fixture UAT; không tạo Shipment hoặc thay dữ liệu gốc. Chu kỳ CD bổ sung dùng
prefix `CD-53bec18898482f74f613`. Không xóa canary/trace/outbox để làm sạch số liệu.

## Giới hạn và vận hành tiếp

- Giữ rollback floor ở core: image cũ ghi v2 hoặc thiếu windows/journal không
  tương thích schema hiện tại. Nếu lỗi, pause writes, giữ journal và fix forward;
  không tự restore DB/ledger hoặc sửa hash/checksum lịch sử.
- Role đã provision; chưa tạo tài khoản Reviewer mới hay cấp assignment thay
  owner. Cần Admin/owner thực hiện phân công và nghiệm thu compliance thực tế.
- Phiên legacy trước cutover cần đăng nhập lại để nhận session family cookie;
  không xóa lịch sử session hoặc thay mật khẩu để chuyển contract.
- Chưa nghiệm thu đầy đủ state/custody matrix, late telemetry, concurrency/fault
  injection, outage/restart trên UAT và camera/offline/install trên điện thoại.
- Không đánh dấu Issue AGT Accepted, không triển khai production hoặc tuyên bố
  mức ổn định >99%. Thay đổi local tại checkout Desktop được giữ nguyên.
