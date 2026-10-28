# Seed đầy đủ trên database hiện tại

## Quyết định và phạm vi

Người dùng yêu cầu lập kế hoạch và thực hiện sau khi Claude hoàn tất; cho phép
thay thế dữ liệu hiện tại, không tạo database cách ly. Claude kết luận hoàn tất
ở phiên `f56ff1d8-bc5e-45a8-a866-b7202e99c2ff`, 21:47 ngày 20/10/2026.
Checkout `feature/admin-console-processor`, HEAD `c408cb6d4990560f56e960c9dd6455794d677bb0`
cùng các thay đổi chưa commit của Claude là nguồn triển khai. Giữ nguyên diff đó.

Target đã đối chiếu bằng metadata container và cấu hình kết nối runtime:

- Web `http://localhost:3000`, API `http://localhost:8080/api`.
- Compose project `agri-trace-demo-local`; PostgreSQL `agri-trace-demo-local-postgres-1`.
- Database `agri_trace`, cổng host 5433; volume `agri-trace-demo-local_postgres-data`.
- API/Worker dùng cùng DB; `FABRIC_ENABLED=false`. Đây là stack local chạy image
  có `NODE_ENV=production`, không phải deployment production trên VPS.
- Trước seed: 7 users, 0 cycles/lots/proofs/bindings. Không sửa volume hay Fabric.

Seed là công cụ local có kiểm tra target rõ ràng, không bỏ guard production của
seed cũ. Không tạo DB mới, không sửa migration đã áp, không commit/push/deploy.
Giữ catalog hệ thống do migration cung cấp; thay toàn bộ dữ liệu tài khoản và
nghiệp vụ. Ảnh/chứng cứ hiện tại nằm trong DB, được bao gồm trong backup.

## Ma trận quyền và tài khoản

Địa chỉ tài khoản dùng `example.test`; credential ngẫu nhiên nằm trong artifact
local bị Git ignore, không trong source/plan/log. Mỗi user có tên, điện thoại,
chức danh và thông tin liên hệ demo. Không dùng danh tính doanh nghiệp thật.

| Role đăng nhập | Tổ chức | Quyền và dữ liệu |
| --- | --- | --- |
| SYSTEM_ADMIN | Không thuộc doanh nghiệp | Hai quản trị viên; onboarding, audit, hỗ trợ và quản trị |
| PLATFORM_OPERATOR | Không thuộc doanh nghiệp | Dashboard vận hành chỉ đọc |
| PLATFORM_CASE_MANAGER | Không thuộc doanh nghiệp | Sự cố và hỗ trợ theo quyền thực |
| PLATFORM_PRIVACY_OFFICER | Không thuộc doanh nghiệp | Hồ sơ dữ liệu cá nhân theo API thực |
| AUDITOR | AUDITOR độc lập | Xem trace/audit, không ghi nghiệp vụ |
| COMPLIANCE_REVIEWER | AUDITOR độc lập | Grant và phân công đúng farm; kiểm định và xét duyệt độc lập |
| FARM_STAFF | FARM | Chủ doanh nghiệp cấp 1, quản lý cấp 2, nhân viên cấp 3; 3 vùng cây trồng |
| TRANSPORTER | TRANSPORTER | Chủ và nhân viên; phương tiện, các chặng giao nhận |
| DISTRIBUTOR | DISTRIBUTOR | Chủ và nhân viên; cơ sở, tồn kho và phân phối |
| RETAILER | RETAILER | Chủ và nhân viên; nhận hàng, bán hàng và cảnh báo |
| PROCESSOR | PROCESSOR | Chủ và nhân viên; cơ sở, sản phẩm, nguyên liệu và lệnh chế biến |

ORG_ADMIN/CREATE_CHAIN/CHAIN_MANAGER là grant theo phạm vi. COMPLIANCE_REVIEWER
đồng thời là role đăng nhập được source hỗ trợ; seed cũ chưa tạo nó.
IOT_DEVICE/SYSTEM_ACTOR là actor kỹ thuật, không
tạo tài khoản người dùng có thể đăng nhập cho chúng. Có thêm account đổi mật khẩu
lần đầu, bị khóa/vô hiệu hóa và doanh nghiệp onboarding chờ duyệt/từ chối.

## Dataset và thứ tự

1. Preflight xác minh target, migration state, Claude không tiếp tục ghi; tải và
   xác minh hash/MIME ảnh trước reset. Lưu manifest nguồn/tác giả/giấy phép.
2. Dừng Web/API/Worker; backup PostgreSQL định dạng custom ra artifact local,
   kiểm TOC, checksum và lệnh restore. Giữ nguyên tên database/volume.
3. Dựng lại schema trong chính DB hiện tại từ snapshot pre-data/post-data, khôi
   phục `_prisma_migrations`, role và catalog hệ thống. Không disable trigger
   hoặc sửa event/hash. TRUNCATE không phải đường reset vì audit có guard chặn.
4. Bootstrap tài khoản, tổ chức, profile, năng lực, subscription và grants demo.
   Phân cấp/scopes giữ nguyên authorization thực. Không tạo proof/binding giả.
5. Khởi động API, giữ Web/Worker dừng trong khi tạo dataset. Dùng API thật cho
   domain command, idempotency, trace/outbox, quantity/custody và chữ ký giao nhận.
6. Tạo cơ sở/phương tiện, giống/vật tư, 3 vùng và thửa, sản phẩm với ít nhất ba
   ảnh phù hợp, 4 loại chuỗi (ba loại ngoài CROP chỉ phân loại theo source).
   Vụ có planned/planted/growing/completed/cancelled; nhiều lần thu hoạch, lô,
   ảnh chăm sóc/thu hoạch, sensor data và NO_DATA, QR, cảnh báo.
7. Tạo các trạng thái giao nhận, tồn cơ sở, bán/hao hụt, kiểm định độc lập, hỗ trợ
   có hội thoại, thông báo, onboarding/service và hồ sơ quản trị phù hợp source.
   Hoàn tất chế biến khi có nguyên liệu tại cơ sở và mass balance hợp lệ.
8. Kiểm toàn vẹn và coverage, khởi động lại Web/Worker, kiểm API/browser. Lỗi seed
   phải giữ checkpoint và khôi phục snapshot trước reset nếu không hoàn tất được.

Quy mô mục tiêu: ít nhất 11 role người dùng, đủ 6 loại tổ chức, 30 tài khoản, 3 farms,
6 plots, 9 sản phẩm, 8 vật tư, 10 sites, 3 vehicles, 4 chains, 10 cycles,
12 source lots; các bảng còn lại theo luồng thực và khả năng source hiện tại.
Số thực tế, coverage và checkpoint nằm trong artifact JSON local; không tạo báo
cáo Markdown cho mỗi lần chạy. Khi source giới hạn một trạng thái, báo riêng;
không cập nhật trạng thái/hash trực tiếp để đạt số lượng.

## Ảnh và tài liệu

Ảnh nông trại/nông sản lấy từ ảnh chụp miễn phí trên Unsplash, lưu file và SHA-256
cùng nguồn trong `scripts/demo/assets/manifest.json`. Giấy phép:
<https://unsplash.com/license>. Không hotlink, không dùng ảnh AI/placeholder.
Ảnh stock là minh họa cho dataset demo, không phải bằng chứng chứng nhận hay
chụp tại các doanh nghiệp giả lập. Không dùng ảnh con người làm avatar giả.
Tài liệu pháp lý/chất lượng tạo riêng có nhãn DEMO, không có giá trị pháp lý;
chứng nhận công khai không được mô tả như kiểm định thật.

## Acceptance

- Đúng DB/container/volume cũ; không có database mới; backup đọc được và có hash.
- Mọi role có account, đăng nhập được qua `/auth/login`; quyền nghiệp vụ không
  cấp cho admin/auditor. Kiểm quyền khác tổ chức và tier 3.
- Profile/danh mục có trường bắt buộc, media thật tải được và đúng hash; kiểm
  trực quan ảnh crop, trang enterprise, cycles/lots và public trace.
- Các domain command có journal + trace + outbox tương ứng; sensor windows và
  lịch sử quantity/custody không bị sửa; lượng tồn đối soát được.
- Public trace không lộ credential/email/private profile; warning độc lập proof.
- Không có blockchain proof giả. Fabric tắt được báo rõ; không tuyên bố nghiệm
  thu mạng thật hoặc production. Không sửa cấu hình để giả Fabric thành công.
- Script an toàn khi chạy lại: preflight, backup/target guard, credential local,
  checkpoint và idempotency; không tự reset dataset đã hoàn tất ở mỗi heartbeat.
- Chạy static checks phù hợp; không chạy test suite tạo DB cách ly hoặc phá hủy
  dataset. Báo kết quả thật, phần chưa kiểm và lý do.

## Khôi phục và hoàn tất

Backup custom và manifest runtime lưu tại `.codex/backups/`, credential/receipt
tại `.codex/seed-current/`; cả hai phải Git ignore và chỉ local user được đọc.
Restore dùng `pg_restore --clean --if-exists --no-owner --single-transaction`
vào chính `agri_trace` sau khi dừng writer; không tạo database khác. Do baseline
không có proof/binding, không có commit ledger cần rollback cùng database.
Sau kiểm tra, khởi động lại service và tạm dừng heartbeat để không seed lặp.

## Các quyết định triển khai bổ sung

- Ảnh hero QR lấy từ endpoint chứng cứ LOT công khai, loại JPEG/PNG/WebP. Không
  dùng ảnh rau cố định cho mọi nông sản; sự cố ảnh không che cảnh báo hoặc trace.
- Khóa mã hóa quyền riêng tư local được tạo vào file riêng bị ignore; Compose
  override pin API image hiện hữu, không đổi source/image API hay môi trường khác.
- Gói của doanh nghiệp SINGLE dùng TRACE_20. Snapshot khởi tạo nhầm CHAIN_PRO
  được hủy có lý do và audit trước khi tạo snapshot phù hợp; không sửa lịch sử
  hợp đồng hay ghi thanh toán thật để sửa dataset.
- Worker vẫn chạy các bước mail/expiry. Readiness báo `LEDGER_PROCESSING_DISABLED`
  khi có outbox chờ vì Fabric tắt; giữ đúng cảnh báo, không xóa outbox hoặc giả proof.
- Kiểm tra dùng Node 24.19, npm 12.1 và dependency đúng lock; không thay lock
  hoặc đổi cấu hình kiểm thử để thích nghi với dependency cài lệch phiên bản.
