# Agri Trace API

Xem [phục hồi yêu cầu thu hoạch](../../docs/harvest-recovery.md) cho API đối soát
journal và cách retry sau khi mất phản hồi.

NestJS API sử dụng PostgreSQL và Prisma. API mặc định chạy tại
`http://localhost:8080/api`.

Các thay đổi command journal, reviewer scope, harvest sensor window và cutover
Fabric v3 được ghi trong [implementation record](../../docs/core-implementation-2026-10-10.md).
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
không còn bảng `Batch`. Prisma schema map trực tiếp database PostgreSQL
`agri_traceDB`; source of truth trong repository là `apps/api/prisma/schema.prisma`.
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
`channelId`, hoặc giữ trạng thái `RETRY`/`DEAD_LETTER` trong outbox. Hướng dẫn chuyển dữ liệu cũ nằm trong
`docs/database-migration-runbook.md`.

OpenAPI và kiểu Web sinh từ metadata NestJS đã compile bằng
`npm run api-contract:generate` ở root (cần Prisma client và Gateway build).
`npm run api-contract:check` chặn file sinh bị lệch; exporter không khởi động
server, Worker hoặc kết nối DB/Fabric. Các API mới và thứ tự cutover có kiểm soát
nằm trong [implementation record](../../docs/core-implementation-2026-10-10.md).

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
  Login/refresh/logout khóa organization rồi user trong transaction và đọc lại
  trạng thái trước khi tạo phiên. Update status khóa cùng hàng trước khi thu
  hồi, nên không bỏ sót phiên mới khi chạy đồng thời. Thời hạn nhóm phiên tính
  từ login (`JWT_REFRESH_EXPIRES_DAYS`, mặc định 30 ngày); rotation không gia hạn.
- Refresh rotation chỉ cho một request dùng token cũ thành công. Request đồng
  thời trong 5 giây trả 409 nhưng không hủy phiên vừa được cấp; dùng lại token
  cũ sau cửa sổ này trả 401 và thu hồi nhóm phiên vì nghi token bị lộ.
- Migration `20261009103000_refresh_session_family` phải chạy trước khi bật
  phiên bản API này. Migration chỉ thêm `family_id` nullable và index, phù hợp
  policy auto-CD; không backfill hoặc đổi constraint. API mới dùng ID của hàng
  làm family khi field này NULL. API cũ vẫn có thể insert/rotate session mà
  không truyền field này sau rollback. JWT cũ không có `sid` bị 401; người dùng
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
- `POST /api/auth/register` đang chủ động trả `501`; tài khoản phải do quản trị viên cấp

## Hybrid scope và route import

Source Hybrid A dùng hai migration append-only:
[business/legacy scope](prisma/migrations/20261013010000_hybrid_business_scope/migration.sql)
và [immutable ledger routes](prisma/migrations/20261013011000_immutable_ledger_routes/migration.sql).
Hai migration mới chưa được phép triển khai production. Xem
[review/checksum/gates](../../docs/hybrid-migration-review-2026-10-13.md) và
[migration/release plan](../../docs/plans/hybrid-migration-and-release-2026-10-13.md).
Không chạy `db:migrate` của nhánh feature lên DB dùng chung khi gates còn thiếu.

Harness chuẩn bị DB cách ly, chạy từ root sau khi source đã commit:

```bash
node scripts/ci/hybrid-db-prepare.mjs legacy
node scripts/ci/hybrid-policy-run.mjs
```

Preparer cần `NODE_ENV=test`, `HYBRID_DRAFT_TESTS=1`, `HYBRID_CI_TESTS=1`,
`FABRIC_ENABLED=false`, `HYBRID_CI_SHA` đúng `git rev-parse HEAD`, và
`DATABASE_URL` bằng `TEST_DATABASE_URL`. Mode `legacy` chỉ nhận DB test loopback
`127.0.0.1:25488/scope_test`; `HYBRID_CI_CONTROL` phải là thư mục output tuyệt đối
chưa tồn tại bên dưới `.codex/evidence`, với parent đã có sẵn. Không đưa URL hoặc
credentials vào command line/log. Preparer áp catalog đến trước route migration,
ghi 28 synthetic events rồi áp migration cuối để kiểm sealed legacy inventory.
Trước policy runner, đặt `HYBRID_CI_PREPARATION` trỏ tới `preparation.json` đã
sinh và đổi `HYBRID_CI_CONTROL` sang output path mới. Runner kiểm alignment/
[31 SQL scenarios](../../docs/sql/hybrid-business-scope.test.sql), rồi gọi
`node --import tsx scripts/ci/hybrid-orm-check.mjs`, policy/HTTP và legacy E2E.
Không gọi ORM checker ngay sau preparer vì nó cần baseline từ SQL scenarios.

Mode `browser` dùng DB riêng `127.0.0.1:25489/browser_test`, áp toàn bộ catalog
rồi đăng ký route tổng hợp và xuất pins metadata. Nó không tạo legacy fixture.
Sau khi build API và Web thật với `NEXT_PUBLIC_API_SAME_ORIGIN=true`,
`NEXT_PUBLIC_MOCK_API=false`, chạy `npm run test:hybrid:browser` tại root. Browser
runner còn yêu cầu `HYBRID_BROWSER_TESTS=1`, `HYBRID_BROWSER_SHA` đúng HEAD và
`HYBRID_BROWSER_CONTROL` là output path tuyệt đối mới. Receipt giữ SHA, actual
counts, checksums, synthetic flag và cleanup; không thay Fabric acceptance.

Route operator dùng API đã build, không có HTTP endpoint quản trị import:

```bash
node apps/api/scripts/ledger-route-operator.mjs inventory /absolute/input.json /absolute/inventory.json
node apps/api/scripts/ledger-route-operator.mjs register /absolute/definition.json
node apps/api/scripts/ledger-route-operator.mjs apply /absolute/import.json
```

Đây là lệnh vận hành cần artifact/pins được review và writer pause theo plan;
không chạy chúng trên production từ ví dụ. Operator cần explicit environment và
release SHA; apply không tự chọn active route thay evidence lịch sử. Unknown hoặc
expired PROCESSING giữ hold, không đổi lease/key hoặc execute lại. Definition,
import artifact và paused-writer evidence có pins độc lập với DB. API không nhận
signer; Worker mới được cấp credential của logical authority đã review.

## Kiểm tra

```bash
npm run check --workspace apps/api
```

Đặt `TEST_DATABASE_URL` trỏ tới PostgreSQL test riêng đã chạy migration trước
khi chạy `check`/`test:e2e`. Suite auth-security dùng HTTP, JWT, bcrypt và
ValidationPipe thật với persistence giả; suite auth-session-concurrency, database
constraints và workflow ghi vào database test thật. Không dùng database production.
Chi tiết regression và bằng chứng: [auth session review](../../docs/auth-session-review-2026-10-10.md).
