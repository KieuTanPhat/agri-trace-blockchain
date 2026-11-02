# Giao diện AgriTrace

Web dùng Next.js 16.4.2, React 19.3.0 và Tailwind 4. Chạy bằng Node 24.22.1,
npm 12.1.0 theo README. `scripts/run-next.mjs` chạy Next native SWC/Turbopack;
production build và start từ chối các cờ mock. API client không có fallback dữ liệu mẫu.

Khi mở Next dev qua IP LAN, truyền `NEXT_DEV_ALLOWED_HOSTS=<IP-Mac>` (hostname/IP,
không có protocol/port) cùng lệnh `npm run dev --workspace apps/web -- --hostname
0.0.0.0`. Next chỉ cho phép các host dev được chỉ định và loopback; không dùng
wildcard toàn mạng. Thay IP cần khởi động lại dev server. Lỗi `/_next/hmr` trả
`Unauthorized`/invalid HTTP response là cổng HMR; trang/API/dữ liệu phải kiểm riêng.

Route `/enterprise/areas/plots/new` mở form thêm lô đất riêng, đóng panel chi
tiết vùng trong lúc nhập để tránh hai Radix dialog cùng mount và panel che form.
Hủy/quay lại về chi tiết vùng; giữ nguyên schema, quyền và command tạo lô đất.
Test React kiểm một dialog, không còn sheet, nhập/focus và điều hướng Hủy;
`tests/ledger/areas-plot.spec.ts` bổ sung browser regression ở 1440/390 px.

## Nguồn giao diện và cấu trúc

### Mobile nhân viên: nhật ký và thu hoạch

Form nhật ký/thu hoạch tách theo session và ID vụ: đổi tài khoản hoặc đổi vụ sẽ
xóa bản nháp/ảnh của form trước. Chỉ mở ghi khi API trả `canWriteProduction=true`
và vụ đang PLANTED/GROWING; API vẫn là nơi kiểm quyền và version cuối cùng.
Lỗi tải vụ có thông báo và nút thử lại, không quay tải vô hạn. Khóa gửi đặt trước
khi tải ảnh để chặn bấm liên tiếp; đã gửi hoặc đưa vào hàng đợi thì form không tạo
lệnh mới. Nếu form bị tháo khi tải ảnh, không phát lệnh nghiệp vụ tiếp theo;
ảnh đã upload không bị xóa để che lịch sử. Lệnh đã phát vẫn giữ cơ chế đối soát
bằng body/key gốc trong hàng đợi.

Kiểm tra React: `npm test --workspace apps/web -- src/lib/mobile-submission.spec.tsx
src/lib/mobile-load.spec.tsx`. Camera, chọn ảnh, thu hồi quyền khi đang mở màn hình
và toàn vòng trên APK vẫn cần nghiệm thu thiết bị; test hook không thay bước đó.

Bản APK `staff` đăng nhập email/API, không dùng Firebase Phone Auth.
`apps/mobile/react-native.config.js` loại RN Firebase app/auth khỏi autolinking
Android/iOS chỉ khi `EXPO_PUBLIC_APP_VARIANT=staff`. Tắt config plugin không đủ
để loại module RN đã cài. Đã kiểm tra kết quả Expo autolinking Android: staff
không link hai module, consumer vẫn link. Log EAS trước sửa có firebase-auth
25.0.0 Kotlin metadata 2.4 nhưng compiler đọc 2.2; loại module không dùng giải
quyết đường build staff, chưa chứng minh build consumer tương thích Kotlin.
Sau thay đổi cần build APK staff mới; lint/typecheck không thay compile Gradle.

### Mobile nhân viên: giao nhận

Danh sách dùng đúng lifecycle API PROPOSED/READY/IN_TRANSIT/DELIVERED/CANCELLED,
hiển thị số dòng hàng thay vì cộng kg, lít hoặc đơn vị khác thành một tổng.
`/staff/transfer/[id]` tải record riêng qua API có kiểm quyền, xem từng lô nguồn,
nơi giao/nhận và đơn vị tham gia. Danh sách/chi tiết tải lại khi quay về màn hình;
lỗi đọc có thử lại. Chỉ chữ ký cùng `attestationEpoch` hiện hành được hiển thị,
không suy ra đủ chữ ký từ trạng thái DELIVERED và không coi metadata API là proof
Fabric. Ký thật vẫn thực hiện trên Web với khóa tổ chức; mobile không tạo chữ ký
giả hoặc hạ cấp bàn giao. Test presentation và Web recovery:
`npm test --workspace apps/web -- src/lib/mobile-transfers.spec.ts
src/features/ledger/workspace/distribution-signing.spec.tsx`.

### ACheck: xác minh điện thoại trên bản development

UI đăng ký/quên mật khẩu dùng Firebase native để nhận token xác minh và gửi
`firebaseIdToken` tới API; không có mã OTP giả hoặc SMS tự gửi khi mở màn hình.
Tạo tài khoản xong giữ phiên bằng SecureStore; đổi mật khẩu xong yêu cầu đăng nhập
lại. Mất phản hồi sau khi gửi yêu cầu thì thử đăng nhập, không tự gửi lại command.
Cooldown tồn tại khi quay lại bước trước; lỗi giới hạn Firebase không được né
bằng đổi IP. Refresh trả chậm sau đăng xuất không được khôi phục phiên cũ.
Các lần tải dữ liệu được gắn audience/session ID và tham số trang. Đổi phiên hoặc
đổi ID ẩn dữ liệu cũ ngay; phản hồi và callback cập nhật của phiên cũ bị loại bỏ.
Fetch dùng `no-store`; tải lại chỉ công bố kết quả của request mới nhất. Ảnh tin,
tab chi tiết và phân trang khởi tạo lại theo ID, không đồng bộ lại state bằng
effect sau khi đã vẽ nội dung trước đó. Đây là kiểm tra ở mức React/HTTP, không
thay cho nghiệm thu trên điện thoại. Test hồi quy: `npm test --workspace apps/web
-- src/lib/mobile-load.spec.tsx`.

Để bật SMS Android, đăng ký app `vn.agritrace.consumer` trong Firebase, cung cấp
SHA-1/SHA-256 của APK và tải file cấu hình đúng package. File cũ có package
`dev.agritrace.consumer` không dùng cho app trên main. Đặt file local
`apps/mobile/google-services.json` (Git ignore) hoặc `GOOGLE_SERVICES_JSON`, bật
`EXPO_PUBLIC_CONSUMER_PHONE_AUTH_ENABLED=true` và build lại development APK.
Build config từ chối file lệch package. Expo Go/Web chỉ hiện hướng dẫn, không
giả vờ xác minh. Thiết lập native iOS và nghiệm thu thiết bị thật là bước riêng.
Xem [React Native Firebase Phone Auth](https://rnfirebase.io/auth/phone-auth).

API local cần `CONSUMER_AUTH_ENABLED=true`, đúng `FIREBASE_PROJECT_ID` và
`CONSUMER_DEV_REGISTRATION_ENABLED=true`. Consent thử nghiệm là
`DEV-CONSUMER-TEST-20261020`; đăng ký production vẫn đóng khi chính sách chưa duyệt.
Thông tin gửi Google và khả năng phát sinh phí SMS được hiển thị trước thao tác.
Test tự động dùng provider fixture, không gửi SMS thật. Chạy
`npm run test:mobile:auth` ở root và `npm run check` trong `apps/mobile`.

Danh mục mobile ở `apps/mobile/src/app/consumer` dùng ảnh, giá tham khảo theo đơn
vị, liên hệ doanh nghiệp và lô QR từ API công khai. Hai danh sách có tìm kiếm
tiếng Việt, lọc theo vùng/danh mục/loại hình và sắp xếp giá; trang chi tiết cho
phép mở rộng giới thiệu, xem doanh nghiệp và chọn đúng lô trên tem để truy xuất.
Nhãn có mã truy xuất không thay thế chứng nhận chất lượng hay proof Fabric.
Giá, liên hệ và logo chỉ được chiếu từ bản xuất bản riêng trong
`public_directory_publication`; không đọc ra hồ sơ pháp lý riêng tư. Endpoint
ảnh kiểm lại khả năng hiển thị công khai và trả JPEG/PNG với `no-store`.

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
dialog, invalidate query hoặc hoàn thành prepare. Khi nhận 400/409/422 có yêu cầu
đã lưu, form tự đọc journal bằng key/body gốc, không tự gửi lại command. Journal
`REJECTED` mới mở lại form; `COMMITTED` dùng kết quả đã lưu để hoàn tất;
`NOT_FOUND` (trừ validation đã bị từ chối), `PROCESSING`, kết quả chưa rõ hoặc lỗi
đối soát vẫn khóa form và giữ nút đối soát thủ công. 409/422 giữ dữ liệu nhập; không tự
đổi version/key để vượt từ chối. Mật khẩu/OTP/nội dung riêng/phản ánh người tiêu dùng
chỉ giữ trong bộ nhớ khi luồng yêu cầu như vậy.

## Các luồng chính

`/register` xác thực OTP trước hồ sơ, giữ sáu vai trò và giấy tờ theo loại tổ chức.
`/join-organization` dùng token mời. Hồ sơ chờ duyệt xem `/enterprise/onboarding`.
Mặc định hoãn thanh toán: admin xét từng năng lực rồi kích hoạt dùng tạm; trang
`/enterprise/service` hiển thị tiến độ, không bắt mua gói hoặc tạo hóa đơn giả.
Hợp đồng/thanh toán mô phỏng local chỉ mở khi operator bật
`ENTERPRISE_PAYMENTS_ENABLED=true`. Kết nối peer tại `/enterprise/connections`
vẫn có điều kiện riêng. Peer tự quản chỉ nhập endpoint/MSP/TLS/chứng thư công khai;
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

Trang khách hàng nằm trong nhóm route `app/(site)`; `layout.tsx` của nhóm dựng
`LedgerPublicShell` một lần để header/footer không dựng lại khi chuyển trang. `/` có ô tra cứu
mã, vai trò trong chuỗi, quy trình truy xuất và liên hệ từ `lib/site-contact.ts`. `/about`,
`/solutions` (gồm bảng giá `#bang-gia` và link đăng ký sang domain doanh nghiệp) và `/contact`
là trang tĩnh, nội dung và ảnh (Unsplash, nguồn trong `PHOTO_CREDITS`) ở
`features/ledger/public/content.ts`; chỉ mô tả năng lực đã có, không đặt số liệu, khách hàng hay
giá chưa xác nhận. Trang chủ chưa có khối số liệu vì API chưa có endpoint thống kê công khai.
Header công khai không có nút đăng nhập/đăng ký; đăng ký nằm trong menu Giải pháp.
Trang công khai và `/login` chỉ có nền sáng: token riêng trong
`components/ledger/shell/public-site.css` (lớp `.pub-site`, tông xanh lá và cam nhấn) và
`useForceLight()` tạm gỡ `.dark` của khu quản lý. Hiệu ứng hiện dần khi cuộn (`Reveal`) tắt
khi người dùng chọn giảm chuyển động. Bản tiếng Anh nằm trong `lib/ledger/public-i18n-en.ts`,
đọc qua `pt()`; chuỗi thiếu rơi về `t()` rồi về tiếng Việt. `/privacy`, `/terms`
giữ nội dung pháp lý/version hiện có. `/scan` giải mã QR trên thiết bị từ camera/ảnh/mã/URL.
Chỉ bật camera sau đồng ý; tắt khi ẩn/rời trang, kể cả stream đến trễ. URL trace ngoài được
lấy token, chuẩn hóa `/trace/<token>` cùng origin; scheme nguy hiểm và URL quản trị bị từ chối.
Param `lotId` là trace token, không suy ra UUID riêng tư.

Mobile chỉ nhận URL QR có origin khớp `EXPO_PUBLIC_TRACE_ORIGIN`. Khi test Web
ở `http://localhost:3000`, cấu hình mobile cũng đặt origin này; camera lấy token
và gọi `EXPO_PUBLIC_API_BASE_URL` bằng IP LAN, không truy cập localhost của điện
thoại. Nếu Web mở bằng IP LAN thì origin QR và cấu hình này phải cùng địa chỉ,
kể cả cổng. Cấu hình base URL có đuôi `/trace` từ Docker được chuẩn hóa về origin;
cấu hình không hợp lệ không nhận URL QR. Release dùng customer origin HTTPS. Sau khi đổi `.env`, khởi động
lại Metro rồi reload app; không đổi token, dữ liệu lô hoặc nới bộ quét cho mọi domain.

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
doanh nghiệp vào `/login`; `/scan`, `/trace/...` và các trang thông tin trong
`CUSTOMER_PAGES` (`lib/site-origins.ts`) quay về domain khách hàng.
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

### Bản tin và hành trình người tiêu dùng

- Admin mở `/admin/news` để tạo bản nháp, tải ảnh bìa, xem trước, sửa, đăng,
  ẩn hoặc lưu trữ bản tin. Chỉ `SYSTEM_ADMIN` có quyền quản lý. Nội dung là
  plain text; ảnh JPG/PNG/WebP tối đa 384 KB, mỗi chiều tối đa 2048 px.
  Mọi thay đổi dùng version, idempotency và platform audit.
- Logo và ảnh sản phẩm dùng tham số `v` theo evidence công khai hiện hành;
  endpoint vẫn kiểm quyền công khai/thu hồi trên mọi request, kể cả URL phiên bản cũ.
  Mobile lưu URL ảnh công khai cùng lịch sử xem, tải lại danh mục khi quay về màn
  hình và chỉ tự thử lại ảnh lỗi một lần; lỗi kéo dài có nút tải lại thủ công.
- Mobile đọc cùng nguồn `/public/news`; bản nháp, tin đã ẩn/lưu trữ và tin hẹn
  giờ chưa đến hạn không được trả về. Danh sách cập nhật khi trở lại màn hình;
  người dùng cũng có thể kéo để tải lại bảng tin.
- Web và mobile nhóm hành trình theo từng địa điểm, thiếu địa điểm thì nhóm
  theo doanh nghiệp. Mở từng nhóm để xem nhật ký, ảnh, liên hệ và chứng nhận
  công khai còn hiệu lực. Các sự kiện đính kèm kỹ thuật được thay bằng thư viện ảnh.
- Nút doanh nghiệp trên trang truy xuất mobile mở hồ sơ bằng organization ID,
  không tìm theo tên vùng trồng hoặc nhãn riêng tư. Từ khóa tìm kiếm của danh
  sách phải hiển thị rõ; xóa bộ lọc cũng xóa tham số URL để tải lại không lọc ngầm.
- `PublicDirectoryPublication` là snapshot công khai tách khỏi hồ sơ pháp lý.
  `publicDirectory.traceSites`, `traceMedia` (ràng buộc `lotId`, `evidenceId`,
  `groupKey`, caption) và `traceDetailsPublished` cho phép công khai tường minh.
  Endpoint ảnh kiểm lại snapshot mới nhất, chủ sở hữu, phạm vi lô/vụ/địa điểm,
  thu hồi ảnh và supersession trên mỗi request. Giấy đất/đăng ký pháp lý không
  được suy ra là ảnh công khai. Nhóm vùng trồng riêng tư giữ ẩn vị trí và ảnh.
- Với bộ trái cây local đã được chủ dữ liệu cho phép, chạy
  `node scripts/demo/publish-fruit-presentation.mjs` sau khi chuẩn bị asset và
  nạp dữ liệu; script lấy logo từ `Data/logoDoanhNghiep`, upload qua API và
  tạo snapshot. `node scripts/demo/publish-fruit-news.mjs` thêm ảnh bìa bằng
  API admin. Cả hai kiểm đúng container/DB local trước khi ghi.

`npm run check --workspace apps/web` gồm typecheck, Vitest, lint-contract, image-optimizer
và production build; build đã chạy ESLint/Oxlint. Browser contract suite từ gốc repo:

```powershell
npm exec --workspace apps/web -- playwright test --config playwright.ledger.config.ts --project=contract --reporter=dot
```

Mobile staff ghi chăm sóc tự gửi `SERVER_RECEIVED` (giờ máy chủ xử lý lần đầu),
không yêu cầu người dùng chọn nguồn giờ hoặc nhập ngày giờ. Form chỉ gồm công
việc, ghi chú và ảnh. Giờ điện thoại gốc được chụp trước upload để đối chiếu;
hàng đợi giữ nguyên source/body/key. Nếu lệnh nhận muộn, nhật ký ghi giờ nhận,
không suy ra đây là thời điểm thực hiện ngoại tuyến. API vẫn giữ DEVICE cho
consumer nhập thời điểm công việc rõ ràng như form Web hiện hành; mobile không
mở tính năng ghi bù. Ghi ảnh ngoại tuyến hoàn toàn chưa được triển khai.
422 có xác nhận REJECTED hiển thị nguyên nhân và cho bỏ lệnh; không mô tả là
mất mạng. Nếu chưa đối soát được thì giữ unknown. Nút đối soát chỉ gửi lại khi
API trả NOT_FOUND; PROCESSING/RECONCILIATION_REQUIRED không thực thi lại.
Care và thời điểm nhận được ghi cùng trace/outbox/journal, không sửa lịch sử cũ.

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

### Ảnh nhật ký/thu hoạch trên Expo 58

Expo 58 mặc định cài `expo/fetch` vào global fetch. Multipart của nó nhận
Blob hoặc đối tượng có `bytes()`, không nhận object React Native cũ chỉ có
`uri/name/type`. `uploadCycleImage` dùng adapter theo platform: native tạo
`expo-file-system.File` từ URI của picker, Web giữ File gốc của browser.
Không tự đặt Content-Type multipart hoặc boundary. File mất/quá 5 MB/sai loại
JPG/PNG có lỗi rõ trước transport; không đổi đuôi để giả định dạng.
Test `mobile-photo.spec.ts` dùng chính converter của SDK để tái hiện lỗi cũ và
kiểm payload mới, với lớp đọc file native được mock; vẫn cần thử trên điện thoại.
File-system đã là dependency native của Expo, nay khai báo trực tiếp để import
rõ ràng. Không đổi key/body hay retry command khi kết quả chưa rõ.
