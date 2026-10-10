# Triển khai core — 10/10/2026

Nhánh: `codex/core-completion`, worktree riêng. Baseline:
`9e228b7c236d9527727b496849d07ca2d160d04f` (đã có PR #71 về auth session).
Đây là bản ghi thay đổi source, chưa phải nghiệm thu hay phê duyệt phát hành.
Bản làm việc có thay đổi của người dùng ở Desktop được giữ nguyên.

## 1. Phần đã có trong code

| Nhóm | Thay đổi | Giới hạn bằng chứng |
| --- | --- | --- |
| Giao dịch | Kiểm tài khoản/session/role/org trước khi start và replay; kiểm lại dưới khóa organization → user trong transaction. CommandCommit bất biến ghi response/resource IDs cùng domain writes. | Chưa chạy fault injection hoặc concurrency trên DB thật. |
| Lượng hàng | Prisma.Decimal tối đa 3 số lẻ; đối soát chuỗi movement; cycle dùng một khóa aggregate, Lot/Shipment dùng một khóa Lot; mismatch chặn ghi lượng và hiện cảnh báo. | Chưa có kết quả E2E/recovery cho candidate này. |
| Sản xuất | Care đầu chuyển PLANTED → GROWING. Multi-harvest dùng tổng sản lượng gộp; mỗi harvest có Lot, QR, window, movement, trace và outbox cùng transaction. Chặn đơn vị khác lịch sử. | Chưa apply migration. |
| Cảm biến | Window đầu [plantedAt, cutoff], các window sau (cutoff trước, cutoff mới]; membership duy nhất và seal. NO_DATA có count=0/hash=null. Reading đến muộn giữ riêng. | Legacy thiếu mốc/cutoff cần Admin append reconciliation; không rehash lịch sử. |
| Fabric | Envelope 3.0.0, nonce=eventId, allowlist public; private hash 2.0.0/RFC8785 giữ nguyên thuật toán. Chaincode đọc v2/v3, chỉ ghi v3. | Chưa nâng chaincode hoặc gửi transaction Fabric thật. |
| Worker/proof | Health capability trước claim; kiểm private evidence, snapshot/window và tuple của sensor/harvest; receipt query phải khớp đầy đủ event/channel/hash/txId/thời gian trước CONFIRMED. | Chưa diễn tập duplicate/outage/restart trên mạng thật. |
| Compliance | Reviewer thuộc AUDITOR org active, chỉ Farm được phân công. Farm nộp PENDING, Reviewer quyết định một lần với version; chặn self-review cả chuỗi bản thay thế. Inspection/certificate correction append record/event mới, giữ subject và lý do. | Chưa provision role, phân công hay kiểm quyền trên UAT. |
| Bán/thu hồi/hết hạn | Farm damage trước Shipment; markForSale/markSold của Retailer; sale xuất toàn bộ tồn; recall sau SOLD không tạo movement 0; expire thủ công theo ngày Việt Nam. Shipment mở chuyển FAILED cùng transaction khi recall/expire. | Chưa nghiệm thu state/quantity/custody matrix. |
| Public/Web | Warnings riêng với proofStatus; chỉ chứng nhận APPROVED/public/còn hiệu lực/chưa có bản thay thế APPROVED. Loại field auth/private. FE dùng kiểu Swagger sinh; có UI compliance/assignment và các command mới. | Chưa kiểm UI/mobile thực tế. |
| QR/PWA | Camera chỉ bật sau thao tác người dùng; decode trên thiết bị, điều hướng về route trace nội bộ, dừng stream khi rời trang. Offline chỉ có trang giải thích tĩnh; API/private/trace không cache. Production build chặn mock. | Camera/permission/install/offline cần kiểm trên thiết bị thật qua HTTPS. |

## 2. Quy tắc cụ thể

- Farm chỉ damage khi HARVESTED và chưa có Shipment. CREATED khóa shippedQuantity;
  Transporter damage ở IN_TRANSIT, Retailer damage ở ARRIVED.
- Receive: received > 0, received + damage mới = available ngay trước nhận.
  Reject giữ tồn vật lý, ghi rejectedQuantity, không trừ lần hai.
- Các command chuyển Shipment kiểm cả version Shipment và Lot. Các command Lot
  yêu cầu shipmentVersion khi có Shipment, kể cả DELIVERED.
- Recall cho HARVESTED/IN_TRANSPORT/ARRIVED/RETAIL_RECEIVED/FOR_SALE và SOLD;
  các trạng thái terminal khác bị chặn. FAILED không suy ra custody về Farm:
  lấy từ bàn giao thực tế và terminal event, thiếu/mâu thuẫn thì chặn command.
- Ngày lịch dùng Asia/Ho_Chi_Minh. Hết hạn từ ngày kế tiếp, server chặn bán ngay
  cả khi chưa ghi command expire. Thiếu expiryDate không tự suy diễn.
- Timestamp nghiệp vụ cần ISO datetime có múi giờ, tối đa mili giây; reject ngày
  sai hoặc thời gian tương lai. Mốc nhận/đến/hư hỏng không trước lần bàn giao
  liên quan. Thời gian ghi Shipment và TraceEvent dùng cùng một instant.
- Binding thiết bị mới lưu `boundAt` tới mili giây, cùng mốc với trace; tránh
  DB giữ microsecond nhưng JSON trả mốc sớm hơn, khiến telemetry ở đúng mốc bị từ chối.
- Dữ liệu gốc Lot/Harvest/Care/QR, route/assignment/quantity Shipment, raw sensor,
  window/membership, movement, correction và journal có bảo vệ tại DB.
- Cùng Idempotency-Key giữ cùng payload khi retry. PROCESSING chỉ replay nếu
  journal chứng minh commit. Key legacy/khác scope/journal thiếu trả 409 cần
  đối soát; TTL không cho phép tự chạy lại. Không tự sửa tồn, hash hay lịch sử.
- VERIFIED chỉ xác nhận bằng chứng toàn vẹn. Recall/expiry/NO_DATA/late readings
  vẫn hiện riêng. Harvest legacy hoặc window không khớp gây INTEGRITY_WARNING.

## 3. API/contract và giao diện

Swagger sinh từ NestJS là source of truth. Các đường dẫn dưới đây có prefix `/api`:

- `GET/POST /compliance/assignments`; `POST /compliance/assignments/:id/revoke`.
- `POST /production-cycles/:id/sensor-reconciliations`: Admin, version,
  plantedAt, latest legacy throughHarvestId nếu có và lý do; chỉ trước window mới.
- `POST /inspections`; `POST /certificates`; `PATCH /certificates/:id/review`.
  Correction có supersedesId + correctionReason. Review có version + status.
- `POST /lots/:lotId/damage`, `/mark-for-sale`, `/mark-sold`, `/recall`, `/expire`.
- Command business dùng Idempotency-Key. PATCH quản trị user/org giữ cơ chế
  revoke session của PR #71, không đổi sang cơ chế command business.
- Web: `/compliance`, `/admin/compliance-assignments`, cổng thao tác Lot,
  thu hoạch/ngày hết hạn và `/scan` có camera; trang trace hiển thị cảnh báo.

Từ root, sau `npm ci` với Node/npm theo engines:

```bash
npm run prisma:generate --workspace apps/api
npm run build --workspace blockchain/gateway
npm run api-contract:generate
npm run api-contract:check
```

Prisma generate cần DATABASE_URL để đọc cấu hình nhưng không truy cập DB.
Exporter có cấu hình riêng, không đọc .env triển khai, không mở listener/Worker
hoặc kết nối DB/Fabric. Commit `docs/openapi/openapi.json`, `openapi.sha256` cùng
thư mục và `apps/web/src/lib/generated/api.d.ts`. Checksum dùng JSON có newline LF.
Sửa DTO/decorator rồi sinh lại; cập nhật
response DTO nếu projection/schema thay đổi. CI kiểm response envelope, reference,
Idempotency-Key và danh sách field cấm trong public projection, sau đó kiểm drift.

## 4. Cutover có kiểm soát — chưa thực hiện

Migration mới có trigger, deferred constraint, FK và partial unique index;
`deploy/cd/policy.py` phải tiếp tục chặn auto rollout khi còn migration chưa được
review riêng. Không sửa applied migration/checksum, nới allowlist hoặc seed DB chung.

Thứ tự cần duyệt và diễn tập trên DB riêng trước khi dùng UAT:

1. Review SQL cụ thể và generated contract; kiểm schema/migration từ DB trống
   và bản sao đã loại thông tin nhạy cảm. Ghi checksum/SHA/người review/kết quả.
2. Bật maintenance, dừng API, Worker, device ingestion và mọi writer/bootstrap.
   Chụp snapshot nhất quán DB + ledger/config/MSP/CA, mã hóa backup và diễn tập restore.
3. Nâng chaincode lên sequence cao hơn; kiểm commit/capability trên các peer.
   Giữ writers dừng nếu chaincode hoặc migration chưa đạt.
4. Apply các migration đã review. Provision role bằng
   `npm run db:provision-compliance-role --workspace apps/api`; script chỉ thêm
   role thiếu, không tạo tài khoản hay thay mật khẩu.
5. Đưa API/Worker/Web tương thích lên, cấp Reviewer/assignment qua Admin, canary
   và đối soát queue, proof, state, quantity trước khi mở writes.
6. Ghi evidence trên đúng candidate SHA; UAT/RC và production có gate riêng.

Image cũ ghi envelope v2 hoặc thiếu windows/journals không là rollback candidate.
Giữ DB/outbox/ledger nguyên trạng; pause writes và fix forward nếu không có image
rollback tương thích. Không xóa PROCESSING/dead-letter hoặc phát key mới để né lỗi.

## 5. Bằng chứng và việc tiếp theo

Đã cài dependency trong worktree bằng Node 24.15.0/npm 12.1.0; lần cài gần nhất
báo 0 vulnerabilities ở dependency graph root. OpenAPI đã xuất và kiểm cấu trúc
67 operations, bao gồm public projection. Kết quả kiểm tra source/biên dịch:

| Kiểm tra đã chạy | Kết quả |
| --- | --- |
| `npm run lint` | Đạt các workspace có script lint; API/Web không warning. |
| `npm run typecheck` | Đạt API, Web, chaincode và Gateway, gồm type của fixture hiện có. |
| `npm run api-contract:check` | Build API đạt; 67 operations, public projection, JSON/checksum/kiểu Web đồng bộ. |
| `npm run build --workspace apps/web` | Production build đạt; gồm lint và kiểm kiểu của Next.js. |
| Gateway build và Prisma generate | Đạt; generate dùng URL giả, không kết nối hay thay DB. |
| `git diff --cached --check`, syntax check các script JS đã sửa | Đạt. |

Các lệnh npm ở trên dùng Node 24.15.0/npm 12.1.0. Rà soát tĩnh 108 file stage
không thấy mẫu private-key block hoặc token GitHub/OpenAI đã liệt kê trong lượt rà.
Đây là kiểm tra tĩnh/biên dịch, không thay thế kiểm thử nghiệp vụ.

Tại hai commit triển khai ban đầu (`f5210e7`, `4203d93`), chưa chạy application
test suites, migration/provision role, Fabric transaction, deployment,
mobile/browser UAT hoặc cập nhật acceptance trên GitHub. Fixture cũ
đã được đổi theo contract mới: certificate nộp/duyệt qua API với Reviewer được
phân công, cutoff harvest tăng, receipt đủ tuple và timestamp không ở tương lai.
Theo yêu cầu tạo PR và kiểm tra trước merge, các suite và migrations đã được
chạy trên DB test có trigger thật; sửa regression và bổ sung ca cho phần mới.
Xem [bằng chứng PR #75](core-pr75-verification-2026-10-10.md) và checks/SHA cuối
trong PR. Provision role, cutover và nghiệm thu UAT vẫn chưa thực hiện.

Thứ tự còn lại:

1. Hoàn tất regression/unit/E2E và concurrency/fault-injection trên DB test riêng;
   tất cả migration và fixture phải tương thích, không tắt audit protections.
2. CI/container/Fabric cùng SHA; recovery/outage/restart/reconciliation/restore
   theo ma trận AC, thu evidence thực tế.
3. HTTPS mobile: camera, quyền bị từ chối, offline/install và đổi tài khoản nhiều tab.
4. Owner review, UAT/RC, DOCX/Sheet bàn giao, signoff từng AGT với SHA/ngày/reviewer.
   Chỉ thực hiện production sau phê duyệt release riêng.

Chưa có cơ sở xác nhận ổn định vận hành >99% hoặc toàn bộ dự án hoàn thành.
Xem [kế hoạch đầy đủ](plans/core-completion-plan-2026-10-10.md).
