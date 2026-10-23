# Giao diện AgriTrace

Web dùng Next.js 16.4.2, React 19.3.0 và Tailwind 4. Chạy bằng Node 24.22.1,
npm 12.1.0 theo README. `scripts/run-next.mjs` chạy Next native SWC/Turbopack;
production build và start từ chối các cờ mock. API client không có fallback dữ liệu mẫu.

## Nguồn giao diện và cấu trúc

Ledger UI theo snapshot preview đã duyệt trong
[inventory](superpowers/specs/2026-10-22-ledger-ui-migration.inventory.json).
[Spec](superpowers/specs/2026-10-22-ledger-ui-migration-design.md) và
[plan](superpowers/plans/2026-10-22-ledger-ui-migration.md) ghi quyết định và acceptance.
Baseline nghiệp vụ được pin trong inventory; không dùng presentation của baseline làm mẫu hoặc fallback.

| Vị trí trong `apps/web` | Trách nhiệm |
| --- | --- |
| `src/app/**/page.tsx` | Wrapper giữ 143 URL; await params/searchParams qua `resolveLedgerRouteInput` |
| `src/features/ledger/screens` | Screen tương ứng từng URL, chọn composition và shell |
| `src/features/ledger/workspace` | Doanh nghiệp, sản xuất, phân phối và chế biến |
| `src/features/ledger/public` | Landing, legal, scanner, trace và phản ánh công khai |
| `src/components/ledger/ui`, `kit`, `shell`, `workspace` | Primitives, biểu mẫu, bảng, dialog, navigation, evidence |
| `src/lib/ledger` | Typed API adapters, quyền, scope query, labels, i18n và hook không giao diện |
| `src/app/globals.css` | Tailwind và token Ledger từ preview |
| `ledger-migration.matrix.json` | URL/action, implementation và phương pháp kiểm tra |

Không dùng CSS/component/navigation của giao diện cũ. Auth, permission, command journal,
signer, QR/parser, evidence và service worker không có giao diện giữ contract hiện hành.
`register-service-worker.tsx` chỉ đăng ký worker và trả `null`.

Shell hỗ trợ desktop/mobile, sáng/tối và tiếng Việt/Anh. Theme lưu trên thiết bị tại
`agt-admin.theme`; locale tại `agt-admin.locale`. Tùy chọn bảng màu/typography/chiều rộng
của UI cũ không được nạp. Dialog dùng Radix với keyboard, focus trap/restore và Escape
phù hợp trạng thái yêu cầu. Chuyển động tôn trọng `prefers-reduced-motion`.

## Phiên, quyền và command

`LedgerProviders` giữ auth/cache theo authorization scope. Trong lúc kiểm tra lại quyền,
nội dung riêng bị chặn; đổi subject/organization/revision loại dữ liệu cũ. Navigation
lọc theo quyền/capability thực; API quyết định quyền cuối cùng. Tài khoản mật khẩu tạm
hoặc quá hạn vào `/account/password`; không gọi enterprise API để vượt gate.

Dialog/sheet/select/menu riêng tư dùng portal trong cùng vùng `hidden/inert` của
trang đã được xác minh. Kiểm tra lại quyền cùng tài khoản giữ form trong bộ nhớ;
chỉ cho tương tác lại sau khi xác minh. Lỗi kiểm tra quyền vẫn có nút thử lại, không
tự hủy bản nháp. Quyền hiển thị lấy từ cache đúng scope để giữ cây giao diện ẩn;
query và command vẫn dùng gate/transport/API hiện hành. Auditor và Compliance Reviewer
đọc vụ/nhật ký/thu hoạch theo projection của API sản xuất, không gọi enterprise-access
để cấp quyền doanh nghiệp hoặc hiện lệnh ghi.

API client dùng API thật. `NEXT_PUBLIC_API_BASE_URL` là địa chỉ public;
`NEXT_PUBLIC_API_SAME_ORIGIN=true` dùng `/api` trong browser. Reverse proxy môi trường
phải chuyển `/api` tới NestJS và phần còn lại tới web; standalone Next không tự cung cấp
NestJS. `API_INTERNAL_BASE_URL` dành cho request phía server khi cần. Cookie/refresh,
CSRF và session coordination giữ baseline.

`CommandForm`/`CommandDialog` dùng command journal hiện có. Giữ body/version/idempotency
key gốc khi phản hồi chưa rõ; đối soát trước yêu cầu mới. Không hiện thành công do đóng
dialog, invalidate query hoặc hoàn thành prepare. 409/422 giữ dữ liệu nhập; không tự
đổi version/key để vượt từ chối. Mật khẩu/OTP/nội dung riêng/phản ánh người tiêu dùng
chỉ giữ trong bộ nhớ khi luồng yêu cầu như vậy.

## Các luồng chính

`/register` xác thực OTP trước hồ sơ, giữ sáu vai trò và giấy tờ theo loại tổ chức.
`/join-organization` dùng token mời. Hồ sơ chờ duyệt xem `/enterprise/onboarding`;
dịch vụ/hợp đồng/thanh toán mô phỏng local ở `/enterprise/service`, sau đó yêu cầu kết nối
`/enterprise/connections`. Peer tự quản chỉ nhập endpoint/MSP/TLS/chứng thư công khai;
không nhận khóa riêng/SSH. Duyệt hồ sơ không có nghĩa Fabric đã kiểm chứng.

Admin giữ hồ sơ/capability/điều chỉnh/kết nối, người dùng/phân công, maker/checker, MFA,
cases/support/privacy/notices, billing và vận hành. `/admin/products` và trang theo
organization chỉ đọc. Không cấp Admin/Auditor quyền ghi nghiệp vụ để làm hiện nút.
Audit CSV, recall JSON và báo cáo giữ projection/limit/quyền baseline; decimal string
không được làm tròn qua Number.

Doanh nghiệp giữ member/role/ownership, profile amendment, sites/vehicles/materials/areas,
catalog/revision/import, evidence, đối tác/inbox/support và dịch vụ. File riêng được xin
quyền khi tải/xem, Blob URL được thu hồi; hash evidence vẫn được kiểm. 403 không biến
thành ảnh public dự phòng.

Mô hình nghiệp vụ là `ProductionCycle → HarvestEvent → Lot → Shipment`. Sản xuất giữ
assignment/evidence/version/harvest recovery. Lot giữ `allowedCommands`, quantity/custody
và cảnh báo recall/expiry/integrity độc lập proof. Phân phối cũ và distribution C2 có
contract riêng; prepare/review/Ed25519 trên thiết bị/signed submit không gộp thành fake
success. Khóa riêng không extractable, lưu IndexedDB, không gửi API. Kế hoạch giao nhận
giữ revision/payload digest và đồng thuận từng bên. Phiếu chuyển kho giữ người nhận
dự kiến, ghi chú khi tạo/nhận và chứng cứ SITE_TRANSFER; phiếu cách ly giữ chứng cứ
QUARANTINE. Đọc/quản lý chứng cứ giữ quyền evidence.read/evidence.manage hiện hành.

Chế biến giữ input/output decimal, packaging, conversions bất biến và version complete/cancel.
Cân bằng UI chỉ là ước tính; API quyết định base quantity/tồn kho/output lot. Không hiện
output thành công trước response. IoT dùng journal `INGEST_SENSOR_READING`, chặn bản đo
mới cùng thiết bị khi yêu cầu cũ chưa rõ; đối soát đúng body/key gốc. Đổi loại cảm biến
đồng bộ đơn vị °C/%; JSON yêu cầu/phản hồi và nút sao chép chỉ giữ snapshot bản ghi
trong bộ nhớ trang, không thay body/key của yêu cầu đang chờ.

## Công khai, camera và PWA

`/` có đăng ký/đăng nhập/quét QR và liên hệ từ `lib/site-contact.ts`. `/privacy`, `/terms`
giữ nội dung pháp lý/version hiện có. `/scan` giải mã QR trên thiết bị từ camera/ảnh/mã/URL.
Chỉ bật camera sau đồng ý; tắt khi ẩn/rời trang, kể cả stream đến trễ. URL trace ngoài được
lấy token, chuẩn hóa `/trace/<token>` cùng origin; scheme nguy hiểm và URL quản trị bị từ chối.
Param `lotId` là trace token, không suy ra UUID riêng tư.

Trace gọi public API/photo evidence, không tải private lot. VERIFIED vẫn đi cùng cảnh báo
recall/expiry khi API trả như vậy, không chứng minh chất lượng/an toàn thực phẩm. Phản ánh
giữ request ID/body khi thử lại kết quả chưa rõ, chỉ gửi contact khi consent, không lưu
payload riêng vào localStorage. Service worker chỉ lưu trang giải thích offline, không
cache trang nghiệp vụ/tài khoản/API. Camera thật/PWA cần thiết bị và HTTPS theo AGT-028.

## Tách domain khách hàng và doanh nghiệp

Build web với `NEXT_PUBLIC_BUSINESS_ORIGIN=https://nongtrace.site` và
`NEXT_PUBLIC_CUSTOMER_ORIGIN=https://agritrace.dev`. Hai biến phải cùng có giá trị,
là origin HTTPS khác nhau, không chứa path/query/credentials. Để trống cả hai
giữ chế độ một hostname cho development/rehearsal. Dockerfile nhận hai build arg
cùng tên; publisher production truyền hai origin này, chưa có thao tác deploy.

`src/proxy.ts` chuyển GET/HEAD của login/register/join-organization và các trang
quản lý trên domain khách hàng sang domain doanh nghiệp, giữ path/query. Root
doanh nghiệp vào `/login`; `/scan` và `/trace/...` quay về domain khách hàng.
API, assets và trang pháp lý giữ origin hiện tại. API browser dùng `/api` khi
tách domain; cookie/token không chuyển giữa hai domain. Host lạ không được dùng
để tạo đích redirect. `next` sau đăng nhập vẫn qua kiểm quyền và chống open redirect.

Nút đăng nhập/đăng ký ở trang khách hàng đi thẳng sang doanh nghiệp; link quay
về trang khách hàng và QR tạo từ màn lô/in tem dùng customer origin. Giữ
`PUBLIC_TRACE_BASE_URL=https://agritrace.dev/trace` của API để QR/API đã phát hành
và QR mới cùng dùng domain khách hàng. Không đổi token hoặc dữ liệu lô.

Kiểm local hai hostname bằng cặp `http://nongtrace.localhost:<port>` và
`http://agritrace.localhost:<port>`, reverse proxy cả hai tới cùng web candidate
và `/api` tới API local có `CORS_ORIGIN` chứa đủ hai origin. Không dùng tài khoản
production; không cần sửa hosts/DNS thật.

Trước cutover production, hoàn tất các command đang chưa rõ kết quả trên origin
cũ bằng body/key gốc. Session, bản nháp/recovery và khóa ký IndexedDB là dữ liệu
theo origin, không tự chuyển sang domain mới. Khóa riêng không extractable không
được xuất/chuyển qua URL; người ký cần đăng ký khóa thiết bị trên origin mới theo
quyền hiện hành trước khi sử dụng. Domain mới yêu cầu đăng nhập lại.

## Kiểm tra

`npm run check --workspace apps/web` gồm typecheck, Vitest, lint-contract, image-optimizer
và production build; build đã chạy ESLint/Oxlint. Browser contract suite từ gốc repo:

```powershell
npm exec --workspace apps/web -- playwright test --config playwright.ledger.config.ts --project=contract --reporter=dot
```

Fixture chỉ ở test, không import vào runtime. Gate trong plan kiểm baseline scope,
provenance, 143 wrapper/screen và evidence action; source-review khác browser/live acceptance.
Kiểm ảnh đại diện 1440/390, spot-check 320/768, sáng-VI/tối-EN và một flow keyboard/focus/
Escape/reduced-motion. Thay đổi nhỏ chạy subset bị ảnh hưởng.

Dockerfile tạo `.next/standalone`, user `node`. Smoke dùng image/container cách ly và
config API thật, kiểm startup/login/public trace/assets/image và reverse proxy `/api`;
không thay container triển khai. Fixture xanh không chứng minh API/DB/Worker/Fabric
production hoặc camera phần cứng đã nghiệm thu.

Khi smoke dùng cổng riêng, origin của browser (ví dụ `http://localhost:3190`)
phải có trong `CORS_ORIGIN` của API dùng cho smoke. Auth kiểm tra origin ở các
POST login/refresh; health HTTP 200 chưa chứng minh đăng nhập đã hoạt động.
Có thể chạy API cách ly từ image và cấu hình local hiện có, bổ sung origin smoke,
không chạy lại migration/seed hay Worker. Proxy `/api` tới API cách ly và các đường
còn lại tới web candidate; kiểm đăng nhập bằng tài khoản local và public trace
có dữ liệu thật. Giữ log/ảnh/receipt trong artifact local được ignore; dọn các
container và network smoke sau kiểm tra, giữ nguyên ứng dụng local đang chạy.
