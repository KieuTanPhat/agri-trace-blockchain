# Agri Trace API

Xem [phục hồi yêu cầu thu hoạch](../../docs/harvest-recovery.md) cho API đối soát
journal và cách retry sau khi mất phản hồi.

NestJS API sử dụng PostgreSQL và Prisma. API mặc định chạy tại
`http://localhost:8080/api`.

Command journal, reviewer scope và harvest sensor window tuân theo
[quy tắc nghiệp vụ](../../docs/core-business-rules.md). Cài mới Hybrid theo
[kế hoạch hiện hành](../../docs/plans/fresh-install-cleanup-2026-10-13.md) và
[runbook production](../../docs/production-runbook.md).
Các migration mới cần review SQL/rehearsal có kiểm soát trước triển khai. Sau
migrate, dùng `npm run db:provision-compliance-role --workspace apps/api` để thêm
role reviewer còn thiếu; không dùng demo seed trên dữ liệu dùng chung.

## Chạy local

Từ thư mục gốc repository:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
npm run dev:api
```

Khởi tạo schema khi dùng PostgreSQL local:

```bash
npm exec --workspace apps/api -- prisma generate
npm exec --workspace apps/api -- prisma migrate deploy
```

Schema hiện dùng mô hình `ProductionCycle -> HarvestEvent -> Lot -> Shipment`,
không còn bảng `Batch`. Database đích lấy từ `DATABASE_URL`; production cài mới
dùng `agri_trace_prod`. Source of truth là `apps/api/prisma/schema.prisma`.
Migration baseline cũng bao gồm telemetry vận chuyển, check constraint, trigger,
view truy xuất và năm role mặc định của hệ thống.

Chạy migration và seed:

```bash
npm run db:migrate --workspace apps/api
npm run db:seed --workspace apps/api
```

Swagger chạy tại `http://localhost:8080/api/docs`. Mọi command thay đổi nghiệp
vụ yêu cầu `Idempotency-Key`; frontend không có endpoint cập nhật trực tiếp
trạng thái. Collection tham khảo nằm tại
`postman/Agri-Trace-v2.postman_collection.json`; Swagger và OpenAPI sinh từ code
là contract hiện tại, bao gồm các endpoint mới.

Trace event được ghi cùng transaction với outbox `PENDING` và command journal.
Proof chỉ được xác nhận sau khi Worker đối chiếu receipt đã commit trên ledger. Khi
`FABRIC_ENABLED=true`, worker gửi hash RFC 8785 và metadata tối thiểu sang
Fabric, retry theo exponential backoff rồi ghi proof `CONFIRMED` với `txId` và
`channelId`, hoặc giữ trạng thái `RETRY`/`DEAD_LETTER` trong outbox. Production mới
chỉ bật Fabric ở Worker; API không nhận signing identity. Dữ liệu test cũ được
lưu mã hóa và kiểm chứng khôi phục, không nhập history/account/QR vào DB mới.

OpenAPI và kiểu Web sinh từ metadata NestJS đã compile bằng
`npm run api-contract:generate` ở root (cần Prisma client và Gateway build).
`npm run api-contract:check` chặn file sinh bị lệch; exporter không khởi động
server, Worker hoặc kết nối DB/Fabric. Thứ tự triển khai và recovery nằm trong
[runbook production](../../docs/production-runbook.md).

Các endpoint hiện có:

- `GET /api` và `GET /api/health`
- `POST /api/auth/login` trả access JWT, `sessionId`, `tokenType` và user;
  refresh secret không có trong JSON. Đăng nhập thành công cũng thu hồi nhóm
  phiên đang được trình duyệt chọn trước đó.
- `POST /api/auth/refresh` và `POST /api/auth/logout` dùng refresh cookie
  `HttpOnly` (`Secure` khi `NODE_ENV=production`), không nhận refresh token
  trong JSON. Login đặt cookie chọn phiên `agritrace_session` và cookie bí mật
  `agritrace_refresh_<sessionId>`, cùng path `/api/auth`, `SameSite=Lax`.
  Client phải giữ cả hai cookie. Chỉ login đổi cookie chọn phiên; refresh/logout
  chỉ sửa cookie của nhóm phiên đang xử lý. Response cũ của A không thể thay
  hoặc xóa cookie của B. Các request web phải gửi credentials; `CORS_ORIGIN`
  phải liệt kê đúng origin của web. Không hỗ trợ web/API ở hai site khác nhau.
- Access JWT chứa `sid` (mã nhóm phiên). Guard kiểm trạng thái user, tổ chức và
  nhóm phiên trong PostgreSQL ở mỗi request; logout thu hồi cả nhóm phiên nên
  JWT cũ bị 401 ngay. Khóa user hoặc tắt tổ chức thu hồi toàn bộ phiên của họ.
  Login giữ shared locks của organization/user; refresh/logout giữ exclusive
  account lock. Các thao tác đọc lại trạng thái trong transaction. Update status
  khóa cùng hàng trước khi thu hồi, nên không bỏ sót phiên mới khi chạy đồng thời.
  Thời hạn nhóm phiên tính
  từ login (`JWT_REFRESH_EXPIRES_DAYS`, mặc định 30 ngày); rotation không gia hạn.
- Refresh rotation chỉ cho một request dùng token cũ thành công. Request đồng
  thời trong 5 giây trả 409 nhưng không hủy phiên vừa được cấp; dùng lại token
  cũ sau cửa sổ này trả 401 và thu hồi nhóm phiên vì nghi token bị lộ.
- Mọi refresh session thuộc một family (`family_id` bắt buộc). Migration
  `20261213000004_require_session_family` ghi rõ family của phiên cũ bằng chính ID
  của nó rồi đặt `NOT NULL`; API cũ tạo phiên không có family không còn chạy được. JWT cũ không có `sid` bị 401; người dùng
  web cũ cần đăng nhập lại. Khi triển khai bản cookie mới, thu hồi các refresh
  session cũ từng lưu trong `localStorage` theo kế hoạch rollout.
- Web giữ access JWT trong bộ nhớ. Login/logout/refresh dùng chung Web Lock
  giữa các tab trên HTTPS và hàng đợi trong mỗi tab. Storage event, focus,
  pageshow và visibility change đồng bộ đổi tài khoản; metadata đồng bộ không
  chứa token. Tab cũ bỏ request/data, xóa cache IoT theo authorization scope và
  khôi phục phiên mới qua cookie. Refresh 409 được retry có backoff; phục hồi
  lúc mở trang giữ trạng thái loading khi phiên đang được xoay vòng.
- `GET /api/auth/me` với header `Authorization: Bearer <token>`
- Login nhận mật khẩu tối đa 72 byte UTF-8; tạo user cần ít nhất 12 ký tự và
  tối đa 72 byte UTF-8. Vượt giới hạn trả 400 trước khi tra user/bcrypt/tạo phiên.
  Không trim/cắt mật khẩu và không thay hash của tài khoản đã tồn tại.
- `POST /api/auth/register` là đăng ký doanh nghiệp tự phục vụ, có gate admission:
  - `ENTERPRISE_ONBOARDING_ENABLED` khác `true` (mặc định): trả `503`, không ghi gì.
  - Khi bật: kiểm origin tin cậy, giới hạn 5 request/phút, trả `201` kèm receipt
    hồ sơ chờ duyệt (không phải phiên đăng nhập). Email hoặc mã doanh nghiệp đã
    đăng ký trả `409`.
  - Client tạo `requestId` (UUID) một lần và gửi lại đúng `requestId` cùng nội dung
    form gốc khi retry; không tạo `requestId` mới khi chưa rõ kết quả.
  - Quản trị duyệt tại `/admin/enterprises`. Xem
    [kế hoạch onboarding](../../docs/plans/enterprise-onboarding.md) và
    [hướng dẫn kết nối](../../docs/hybrid-fabric-runbook.md#12-đăng-ký-và-kết-nối-doanh-nghiệp-v1).
    Việc gate đang bật trên production phải xác nhận theo runbook, không suy ra từ mã.

## Hybrid A/B/C

Ba migration append-only: `20261014000000_hybrid_chain_scope` (A: phân quyền theo
chuỗi, backfill một chuỗi legacy cho mỗi org sản xuất, route lịch sử bất biến),
`20261015000000_hybrid_fabric_binding` (B: binding Fabric, quyền ledger, delivery) và
`20261016000000_hybrid_signed_handover` (C: khóa ký tổ chức, bàn giao hai bên). Chúng
tạo kiểu, hàm và trigger nên phải có root-owned review pin đúng checksum/protocol;
không bỏ parser hoặc sửa migration đã phát hành để qua CD. Migration
`20261017000000_hybrid_fresh_install` chỉ cleanup DB chưa có business history;
production mới dùng đủ 20 migration trong manifest. New cycle cần ACTIVE binding,
không tạo legacy fallback. Xem [ADR-004](../../docs/adr-004-hybrid-binding-and-signatures.md),
[runbook production](../../docs/production-runbook.md) và
[cổng nghiệm thu](../../docs/plans/hybrid-production-readiness-2026-10-13.md).
Kết quả từng lần chạy nằm trong PR/Issue hoặc artifact, không là một báo cáo
Markdown cố định trong repository.

Công cụ vận hành (không có endpoint HTTP quản trị; API không giữ khóa Fabric hay khóa ký):

```bash
node dist/operator/ledger-operator.js <register-binding|onboard|register-signing-key|set-handover-mode|activate|pause|resume|resolve-hold|status>
node dist/operator/org-signer.js <keygen|register|sign>
DATABASE_URL=<bản-sao-cách-ly> node dist/operator/verify-evidence.js
```

Test: `test/hybrid-binding-db.e2e-spec.ts` (guard SQL của B), `test/hybrid-handover.e2e-spec.ts`
(API + SQL guard của bàn giao có chữ ký), `test/hybrid-migration.e2e-spec.ts` (diễn tập
backfill) chạy trong `test:e2e` với PostgreSQL thường. `test/hybrid-fabric.e2e-spec.ts`
chạy API → Worker → Fabric thật khi `HYBRID_FABRIC_E2E=1` với mạng test cách ly.
Job `Hybrid A B C real Fabric and browser` trong Blockchain CI bật suite này và
kiểm trình duyệt desktop/mobile với API/DB/Worker thật. Không tính lượt skip trong
suite thông thường là nghiệm thu Fabric. PostgreSQL nên dùng múi giờ UTC.

## Kiểm tra

```bash
npm run check --workspace apps/api
```

Đặt `TEST_DATABASE_URL` trỏ tới PostgreSQL test riêng đã chạy migration trước
khi chạy `check`/`test:e2e`. Suite auth-security dùng HTTP, JWT, bcrypt và
ValidationPipe thật với persistence giả; suite auth-session-concurrency, database
constraints và workflow ghi vào database test thật. Không dùng database production.
Xem [ngữ cảnh hiện hành](../../docs/PROJECT_CONTEXT.md) và
[chính sách CI](../../docs/ci.md); bằng chứng regression thuộc đúng revision trong
PR/Issue và artifact CI.
