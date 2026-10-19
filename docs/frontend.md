# Giao diện AgriTrace

Nhận diện: logo chữ A có ngôi sao (xanh lục + cam/vàng), khẩu hiệu "Truy xuất nguồn gốc nông sản Việt". Liên hệ công khai: contact@agritrace.dev và Zalo +84 377 599 221; hai giá trị này chỉ khai báo trong `apps/web/src/lib/site-contact.ts`.

Trang tên miền gốc `/` là trang thông tin tiếng Việt: hero, dải công nghệ, bốn giá trị, ba hàng tính năng, hành trình sáu bước, vai trò trong chuỗi, toàn vẹn dữ liệu, FAQ và dải liên hệ (email, Zalo). Font Be Vietnam Pro được phục vụ tại `/fonts` kèm giấy phép OFL. Không tải font, script hoặc ảnh từ domain ngoài khi mở trang.

Người tiêu dùng mở `/scan` từ nút Quét QR, dùng camera, ảnh QR hoặc mã/đường dẫn truy xuất. Ảnh được giải mã trên thiết bị; chỉ token hợp lệ được điều hướng tới `/trace/<token>` cùng origin. URL QR cũ được lấy token, không điều hướng sang website ngoài. Không bật camera tự động. HTTPS và quyền camera cần thiết khi chạy ngoài localhost; camera tắt khi rời trang hoặc chuyển ứng dụng.

Trang giới thiệu chỉ có nội dung tổng quát, không có QR/lô mẫu và không dẫn tới đăng nhập. Mockup điện thoại ở hero là hình minh họa trừu tượng, không có mã lô hay QR thật. Nhập trực tiếp `/login` để vào hệ thống quản lý; đích mặc định sau đăng nhập là `/dashboard`. Các đường dẫn được bảo vệ vẫn yêu cầu phiên đăng nhập và phân quyền hiện có. Việc không đặt link login trên landing không thay thế kiểm soát truy cập.

## Hệ thống thiết kế

Đăng ký doanh nghiệp dùng `/register`, xác thực OTP rồi chờ admin duyệt.
`/enterprise/onboarding` hiển thị phản hồi xét duyệt. Sau duyệt, doanh nghiệp
chọn AgriTrace quản lý peer hoặc peer tự quản ở `/enterprise/service`, xem trước
hợp đồng và hoàn tất thanh toán mô phỏng local, rồi vào `/enterprise/connections`
gửi cấu hình/yêu cầu kết nối. `/enterprise` là tổng quan nghiệp vụ đã kích hoạt.
`/admin/enterprises` dành cho SYSTEM_ADMIN, chi tiết hồ sơ ở route con theo UUID.
Yêu cầu kết nối peer có trang xét duyệt riêng trong hồ sơ doanh nghiệp; quyết
định phê duyệt/từ chối cần xác nhận trước khi gửi, và khi chưa rõ kết quả giữ
nguyên request key để đối soát.
Không gian admin dùng hàng chờ hồ sơ, danh sách tìm kiếm/lọc và thao tác theo từng
bản ghi. Trang `/admin/users` chỉ quản lý tài khoản quản trị và người kiểm định;
`/admin/organizations/new` chỉ tạo tổ chức kiểm định. Form tạo tài khoản và cấp
phân công có trang riêng. Admin không có trang tạo sản phẩm, nông trại, thửa đất;
API cũng chặn các lệnh ghi đó. `/admin/products` là trang chỉ xem, tổng hợp số
sản phẩm theo từng doanh nghiệp và cho tìm theo tên doanh nghiệp hoặc sản phẩm;
`/admin/products/<organizationId>` (hoặc `shared` cho danh mục dùng chung) là danh
sách sản phẩm của một doanh nghiệp, cũng có liên kết từ hồ sơ đã duyệt. Không có
route tạo/sửa/xóa.
Quản trị nền tảng có thêm: `/admin/audit-log` (nhật ký kiểm toán chỉ đọc, SYSTEM_ADMIN
và AUDITOR; lọc, phân trang cursor, kiểm tra toàn vẹn chuỗi băm, xuất CSV có giới
hạn), `/admin/approvals` (+ `/new`, `/<id>`; đề xuất và phê duyệt hai bước),
`/admin/security` (MFA TOTP) và `/account/password` (đổi mật khẩu; tài khoản đang
dùng mật khẩu tạm bị chuyển thẳng tới đây). Màn hình khóa/mở khóa/đặt lại mật khẩu
ở `/admin/users/<id>` luôn đòi lý do; form giữ nguyên body và Idempotency-Key khi
chưa rõ kết quả. Ẩn nút trên UI không thay cho kiểm tra quyền ở API.
Danh mục truy xuất do doanh nghiệp có quyền
`catalog.manage` nhập trong không gian doanh nghiệp.
Mật khẩu đăng ký chỉ ở bộ nhớ trang; khi mất phản hồi, nút thử lại giữ nguyên UUID
và nội dung. Các lệnh xét duyệt/kết nối cũng giữ nguyên idempotency key. Peer tự
quản chỉ nhập endpoint, tên TLS, MSP và chứng thư CA công khai; không nhận khóa
riêng hoặc tài khoản SSH. “Đã duyệt” vẫn chờ vận hành, “Đã kiểm chứng kết nối” là
kết quả giao dịch Fabric tại thời điểm kiểm tra. Admission API mặc định đóng;
mở demo theo [runbook](hybrid-fabric-runbook.md#12-đăng-ký-và-kết-nối-doanh-nghiệp-v1).

Mã nằm ở `apps/web/src/styles`, nạp theo thứ tự trong `app/layout.tsx`:

| File         | Nội dung                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.css` | Nguồn token duy nhất: màu (xanh lục, amber, trung tính, trạng thái), chữ, khoảng cách theo thang 4 px, bo góc, bóng, easing/thời lượng, kích thước khung |
| `base.css`   | Reset, kiểu chữ, focus, `.sr-only`, `.skip-link`, eyebrow, cụm nhấn trong tiêu đề                                                                        |
| `motion.css` | Keyframes và lớp chuyển động; tắt toàn bộ khi `prefers-reduced-motion: reduce`                                                                           |
| `app.css`    | Thành phần dùng chung: panel, nút, form, notice, badge, bảng/thẻ dữ liệu, timeline, hộp thoại, khung quản lý, dashboard, trace, scanner                  |
| `site.css`   | Header/footer công khai, landing (`lp-*`), đăng nhập                                                                                                     |

Cam/vàng chỉ làm điểm nhấn (CTA, vệt gạch chân, số bước, trạng thái đang chọn). Trạng thái lỗi/cảnh báo/thành công dùng màu trạng thái riêng, không dùng màu thương hiệu. Trang công khai (giới thiệu, truy xuất QR, đăng nhập, đăng ký) dùng icon `lucide-react`; khu quản trị và doanh nghiệp không dùng icon, chỉ dùng chữ. Logo và biểu tượng PWA nằm ở `public/agritrace/brand` và `public/icons`; favicon/apple icon ở `src/app/icon.png`, `src/app/apple-icon.png`.

Breakpoint dùng thống nhất: 600 px (điện thoại), 900 px (máy tính bảng, sidebar chuyển thành ngăn kéo và thanh điều hướng dưới), 1200 px (rộng). Khi thêm style, dùng token thay vì mã màu hoặc cỡ chữ viết cứng.

## Chuyển động

Chuyển động nhẹ, chỉ dùng `transform` và `opacity`, 200–600 ms, easing `cubic-bezier(0.22, 1, 0.36, 1)`. Gồm: hero vào trang theo lớp `.enter`, mockup nổi nhẹ, `Reveal` (`components/ui/reveal.tsx`) làm nội dung dưới màn hình hiện dần khi cuộn, vẽ cung và bật số trong hành trình sáu bước, marquee công nghệ (dừng khi hover), nâng thẻ khi hover, accordion FAQ, header thu nhỏ khi cuộn, fade nhẹ khi chuyển trang quản lý và skeleton khi đang tải.

`Reveal` chỉ ẩn nội dung nằm dưới màn hình sau khi JavaScript chạy; không có JavaScript hoặc không có `IntersectionObserver` thì nội dung luôn hiển thị. Không đặt chuyển động lên cảnh báo thu hồi/hết hạn/toàn vẹn và không gắn vào biểu mẫu đang nhập liệu hoặc ký lệnh.

## Desktop và mobile

Form đăng nhập giữ input và nút submit ở trạng thái disabled trong HTML ban đầu,
cho đến khi React đã gắn handler và hoàn tất khôi phục phiên. Bài trình duyệt chờ
nút sẵn sàng, kiểm POST login trả 201 rồi mới kiểm điều hướng; lỗi giữ response
status/timing, console, ảnh đã che input và trace đã loại credential trong artifact.

Khung quản lý dùng sidebar nhóm theo công việc (Vận hành, Tuân thủ, Hệ thống; chỉ hiện mục vai trò được truy cập) trên desktop. Từ 900 px trở xuống là thanh điều hướng dưới với bốn mục đầu và nút "Thêm" mở ngăn kéo dạng hộp thoại có quản lý focus và Escape. Bảng lô, vụ trồng, danh mục quản trị và lịch sử số lượng dùng cùng dữ liệu cho bảng desktop và thẻ mobile ở 600 px trở xuống. Bộ lọc và phân trang áp dụng cho cả hai. Biểu mẫu chuyển về một cột, input 16 px, thao tác tối thiểu 44 px, hộp thoại có chiều cao theo viewport và cuộn nội dung.

Dashboard mở bằng số liệu và "Việc cần làm" (cảnh báo và thao tác khả dụng của lô nổi bật), không có banner giới thiệu.

Trang truy xuất công khai ưu tiên điện thoại: cảnh báo thu hồi/hết hạn/toàn vẹn ở trên cùng, rồi tên lô và trạng thái, thông tin lô, chứng nhận, lịch sử và bằng chứng chuỗi khối. Tên dài và mã băm tự xuống dòng.

Các trạng thái thu hồi/hết hạn vẫn hiển thị trước phần bằng chứng. Thao tác ghi dữ liệu theo `allowedCommands` từ API; kiểm toán viên chỉ đọc theo hợp đồng hiện hành. Service worker vẫn chỉ lưu trang giải thích offline, không lưu trang nghiệp vụ, tài khoản hoặc phản hồi API.

Giả lập IoT gửi `/iot/readings` qua cùng sổ command recovery với các lệnh nghiệp vụ
(`INGEST_SENSOR_READING`, một yêu cầu chờ cho mỗi thiết bị). Mất phản hồi, phản
hồi không đọc được hoặc lỗi 5xx hiện "Chưa rõ kết quả"; "Gửi lại" chỉ gửi/đối
soát đúng body và key gốc, kể cả sau khi sửa form. Sau khi tải lại trang, yêu cầu
gốc nằm trong mục yêu cầu đang chờ; bản đo khác cho cùng thiết bị bị chặn tới khi
đối soát xong. Chỉ phản hồi từ chối 4xx của máy chủ mới là kết quả cuối.

## Kiểm tra

Chạy `npm run check --workspace apps/web` trên Node/npm được ghi trong README. Kiểm tra trình duyệt ở 320, 390, 768 và 1440 px: landing, scan, login, dashboard, lô/chi tiết, vụ trồng/chi tiết, chuỗi và đối tác, admin/phân công, kiểm định, giả lập IoT và các trạng thái lỗi. Kiểm thêm tên dài, mã băm, bộ lọc đổi trang, bàn phím/Escape, camera bị từ chối, ảnh QR sai và `prefers-reduced-motion`.

Dữ liệu fixture khi kiểm tra local không phải bằng chứng nghiệm thu nghiệp vụ trên production. AGT-028 vẫn cần nghiệm thu theo issue, gồm thiết bị camera thật và người được phân công.

### Giới hạn nghiệm thu

Kiểm camera thật, cài PWA và permission/offline trên thiết bị HTTPS theo AGT-028;
fixtures không thay cho camera phần cứng hoặc UAT nghiệp vụ. Scanner camera,
upload và nhập mã dùng cùng route trace local đã validation; không điều hướng
ra URL ngoài hoặc bật camera tự động. Giữ warning priority, auditor read-only,
server allowedCommands và service worker network-only cho dữ liệu nghiệp vụ.
Thay đổi chỉ về giao diện phải giữ API/schema/business policy.

## Không gian doanh nghiệp và phân phối

`/register` gồm năm bước: Doanh nghiệp, Đại diện & tài khoản, Hoạt động,
Dịch vụ sử dụng, Kiểm tra & xác minh. Form desktop dùng khổ ngang rộng, trường ngắn xếp hai cột;
địa chỉ, tài liệu và nội dung dài chiếm cả hàng. Trên điện thoại dùng một cột.
Tỉnh/thành và xã/phường chọn từ danh mục hai cấp; đổi
tỉnh phải chọn lại xã. Kiểm định dạng mã số thuế, số điện thoại, URL, xác nhận mật
khẩu và giới hạn 72 byte trước khi gửi. Bản nháp không lưu mật khẩu, OTP, proof
xác thực hoặc xác nhận thay
người dùng. Yêu cầu đã gửi mà chưa rõ kết quả giữ nguyên body/requestId trong
trang; không phát sinh requestId khác để thử lại.

Lỗi nhập liệu hiện ngay dưới từng trường bằng `aria-invalid`/`aria-describedby`;
không tự cuộn lên tiêu đề khi validation thất bại. Email đăng nhập được kiểm tra
sau khi nhập và trước khi qua bước Đại diện & tài khoản bằng
`POST /auth/registration-email-availability`. API trả duy nhất `available`, không
cache và có giới hạn tần suất. Email trùng hoặc chưa kiểm tra được sẽ chặn chuyển
bước; đăng ký cuối vẫn kiểm uniqueness trong transaction. Email liên hệ không
phải định danh đăng nhập duy nhất. Kết quả trả chậm của email cũ không ghi đè lỗi
của email đang nhập.

Doanh nghiệp/HTX/hộ kinh doanh phải có mã số thuế, số đăng ký và giấy đăng ký;
hộ nông dân/cá nhân sản xuất có nhánh riêng, không bắt buộc mã số thuế hoặc giấy
đăng ký doanh nghiệp. Không thu CCCD. Sản xuất hiện chỉ hỗ trợ trồng trọt; phần
sản xuất chỉ hiện khi chọn Nhà sản xuất. Giấy ủy quyền bắt buộc khi người đăng ký
là người được ủy quyền; công bố chứng nhận phải có tài liệu chứng nhận.

Tài liệu được chọn trên máy và tải thật sau khi xác thực email quản trị viên;
chỉ nhận PDF/JPG/PNG tối đa 5 MB, logo JPG/PNG/WebP tối đa 2 MB, tối đa 8 file.
API kiểm nội dung định dạng, giới hạn kích thước và proof gắn với hồ sơ. File
được lưu riêng tư; chủ hồ sơ và SYSTEM_ADMIN tải qua API có xác thực. Bản nháp
không lưu file. Dịch vụ/gói ở bước đăng ký chỉ ghi nguyện vọng, không tạo đơn,
hợp đồng, thanh toán hoặc cấp quyền. Sản phẩm, hành trình và QR được cấu hình sau.
Truy xuất nguồn gốc là dịch vụ bắt buộc; chỉ có thể chọn thêm Tem QR theo lô.
API không nhận lựa chọn Quản lý sản xuất/Phân phối trong hồ sơ đăng ký mới;
nhãn của hồ sơ lịch sử được giữ nguyên khi đọc.

Bước cuối có xác nhận tính chính xác, đồng ý điều khoản và xác nhận đã đọc chính
sách quyền riêng tư riêng biệt; nhận tiếp thị là tùy chọn mặc định tắt. `/terms`
và `/privacy` công khai bản nội dung để chủ dự án review; hồ sơ ghi phiên bản và
thời điểm xác nhận từ server. Hồ sơ đã gửi chưa có luồng sửa/gửi lại. Hồ sơ lịch
sử thiếu dữ liệu v2 tiếp tục được đánh dấu cho người xét duyệt.
Bản rà soát trình bày các mục đầy đủ theo cặp nhãn/giá trị và danh sách tài liệu.
Bỏ logo phụ lặp lại, khối giới thiệu xác thực email và dòng hướng dẫn giới hạn
OTP. Nút bắt đầu là “Xác thực tài khoản”; thời hạn, giới hạn lần thử và cooldown
vẫn được backend thực thi.

Các chức năng có URL riêng:

| Chức năng                      | Route                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tổng quan / hồ sơ              | `/enterprise`, `/enterprise/profile`                                                                                                               |
| Xét duyệt / kết nối            | `/admin/enterprises`, `/enterprise/connections`                                                                                                    |
| Theo dõi hồ sơ / dịch vụ       | `/enterprise/onboarding`, `/enterprise/service`                                                                                                    |
| Hợp đồng / thanh toán mô phỏng | `/enterprise/service/contract`, `/enterprise/service/payment`                                                                                      |
| Quản trị nền tảng              | `/admin/organizations` (tra cứu tổ chức, tạo đơn vị kiểm định), `/admin/users` (quản trị viên và người kiểm định), `/admin/compliance-assignments` |
| Thành viên / nhóm quyền        | `/enterprise/members`, `/enterprise/roles` và trang `new`/chi tiết riêng                                                                           |
| Liên kết / danh mục            | `/enterprise/partners`, `/enterprise/products`, `/enterprise/areas`                                                                                |
| Cơ sở / phương tiện            | `/enterprise/sites`, `/enterprise/vehicles`                                                                                                        |
| Vụ / nhật ký / thu hoạch       | `/production-cycles`, `/production-cycles/:id/journal`, `/production-cycles/:id/harvest` và trang nhập riêng                                       |
| Giao nhận / nhật ký chặng      | `/distribution`, `/distribution/:id`, `/distribution/:id/journal`                                                                                  |
| Khóa ký bàn giao               | `/enterprise/signing`                                                                                                                              |
| Tem / cảnh báo / đối soát      | `/enterprise/qr`, `/enterprise/notices`, `/enterprise/reports`                                                                                     |
| Ghi lượng bán/hao hụt          | `/enterprise/reports/adjust`                                                                                                                       |
| Quản lý chuỗi                  | `/supply-chains/:id/members`, `roles`, `business`, `ledger`, `signing`, `plans`                                                                    |

Khu quản lý dùng chung một bộ component trong `components/manage`
(`PageHeader`, `StatusBadge`, `LoadState`, `EmptyState`, `ReloadButton`,
`CommandState`, `DataTable`, `Section`, `FilterBar`, `SearchField`,
`DetailList`) và một bộ lớp `manage-*` trong `manager.css`, cho cả trang quản
trị nền tảng lẫn trang doanh nghiệp. `DataTable` gắn `data-label` theo tiêu đề cột
để dưới 600 px mỗi dòng thành thẻ; bảng viết tay cần tự gắn `data-label`.
Component nghiệp vụ riêng vẫn nằm trong `components/workspace`, style trong
`workspace.css`. `manager.css` chỉ áp dụng cho khu vực đã đăng nhập; không đổi
giao diện tra cứu công khai.

Menu, breadcrumb trên topbar, nhóm tiêu đề trang và lối tắt mobile lấy từ
`lib/management-routes.ts`. Mỗi mục thuộc khu `platform` hoặc `enterprise`; tài
khoản nền tảng thấy khu nền tảng trước, thành viên doanh nghiệp chỉ thấy mục mà
`canAccessManagementRoute` và `canUseEnterpriseRoute` cho phép. Mục `hidden` chỉ
dùng cho breadcrumb. Trang cá nhân (đổi mật khẩu, bảo mật, quyền dữ liệu cá nhân)
nằm trong menu tài khoản. Thêm route mới thì khai báo trong registry, cập nhật
quy tắc quyền và snapshot `route-access-matrix.spec.ts` khi quyền thực sự đổi.
Điều hướng và route guard dựa vào `/enterprise-access` mới tải theo phiên,
quyền và capability; khi chưa kiểm tra được thì đóng truy cập. Trang danh sách
không chứa toàn bộ các form nghiệp vụ.
API kiểm quyền độc lập với điều hướng. Thay đổi tài khoản/phạm vi xóa dữ liệu
đang hiển thị; command không chứa credentials dùng cơ chế recovery hiện có.
Khóa ký phân phối dùng WebCrypto Ed25519 không extractable và IndexedDB; không
gửi khóa riêng vào API. Khóa này không thay khóa hoặc signing intent Fabric c2.

Kiểm tra local tại 320/390/768/1440 px và lưu ảnh browser thực tế vào
`screenshots/DD-MM-YYYY/` theo giờ Việt Nam. Ảnh, credentials và cấu hình review
được giữ local, ngoài phần source Git. PWA tiếp tục chỉ cache trang offline
tĩnh, không cache account/API hay dữ liệu truy xuất.

`/admin/operations` (SYSTEM_ADMIN, AUDITOR và PLATFORM_OPERATOR, chỉ đọc) tổng hợp hàng đợi ghi sổ cái,
hold giao nhận, tác vụ điều khiển sổ cái, sức khỏe kết nối Fabric, hàng đợi thư và
phiên/tài khoản bị khóa; lọc theo chuỗi và tổ chức, có thẻ cảnh báo, bảng chi tiết
phân trang và ghi rõ thẻ nào không lọc được theo bộ lọc đang chọn. Trang không có
nút thử lại/sửa/xóa.

`/admin/cases` (+ `/new`, `/<id>`) là nơi nền tảng tiếp nhận, phân loại, giao, leo
thang và đóng hồ sơ sự cố; AUDITOR chỉ xem. Phía doanh nghiệp, hồ sơ được giao hiện ở
đầu `/enterprise/notices` ("Yêu cầu từ nền tảng") để xác nhận và phản hồi; phần
phát cảnh báo/thu hồi lô bên dưới vẫn độc lập.
Các form hồ sơ nền tảng giữ nguyên body/key trong bộ nhớ khi kết quả chưa rõ,
kể cả khi phiên bản hiển thị vừa được tải lại; người dùng chỉ thử lại yêu cầu
ban đầu để đối soát. Nội dung hồ sơ không được lưu vào local storage recovery.

`/admin/recall` tạo bản diễn tập chỉ đọc và tải snapshot JSON; luôn hiển thị
giới hạn/trạng thái thiếu dữ liệu. `/admin/privacy` là hộp thư riêng tư cho
SYSTEM_ADMIN/PLATFORM_PRIVACY_OFFICER; `/account/privacy` dành cho chủ thể gửi và
xem phản hồi của mình. Nội dung không được lưu vào local storage phục hồi command.
Khi mất phản hồi, giữ tab và thử lại body/key đang có; không tạo yêu cầu mới.

Sidebar có mục `/admin/inspectors` gồm tổ chức, tài khoản kiểm định viên và phân
công/lịch sử; danh sách hai tab đầu chỉ lọc dữ liệu kiểm định. Chi tiết doanh
nghiệp `/admin/enterprises/:id` có tab Sản phẩm chỉ xem. Các đường dẫn quản trị
cũ được giữ để liên kết đã lưu vẫn dùng được. Tổng quan `/admin` lấy các bộ đếm
phê duyệt, sự cố, quyền riêng tư và báo cáo quá hạn từ API, không suy tổng số từ
một trang danh sách. Vai quản trị hẹp được chuyển về đúng trang chức năng sau
đăng nhập; route guard và API đều kiểm quyền riêng.

### Biểu mẫu sản xuất và phân phối bổ sung (19/10/2026)

Giao diện `/admin` và `/enterprise` dùng cùng khung quản lý: sidebar tối, vùng
nội dung sáng, điểm nhấn xanh, tìm kiếm và thẻ số liệu lấy từ API. Menu vẫn lọc
theo quyền. Các trang doanh nghiệp giữ form và bảng nghiệp vụ theo route hiện có.

Tạo vụ ở `/production-cycles/new` lưu nháp; danh sách nháp có nút liên kết chuỗi.
Chỉ sau khi liên kết mới có nút gieo trồng, nhật ký và thu hoạch. Form có giống,
người phụ trách và phương pháp canh tác tùy chọn. Tại chi tiết vụ, tải ảnh theo
nhóm trước khi chọn ảnh minh chứng trong form nhật ký/thu hoạch. Thu hoạch cần
ảnh thu hoạch và ảnh lô, tên lô, người đại diện, version hiện tại; nếu chọn cơ sở
ban đầu thì báo cáo tồn cơ sở phản ánh ngay lượng lô mới.

Trang thành viên cho nhập chức danh, số điện thoại, cơ sở làm việc, vùng phụ
trách, địa chỉ và ghi chú. Hồ sơ đã kích hoạt có thể tải ảnh đại diện và giấy tờ
chuyên môn riêng tư. Trang tạo giao nhận yêu cầu giờ dự kiến lấy, cho phép giờ
giao và ghi chú; trang chi tiết hiển thị các giá trị này trước khi ký.

### Quy ước khu quản trị và doanh nghiệp (19/10/2026)

- Font chính là Inter, tải qua `next/font/google` lúc build và phục vụ từ cùng origin (`--font-inter`); Be Vietnam Pro là font dự phòng.
- Sidebar dùng `agritrace-logo-on-dark.png` (bản của logo gốc, nền trong suốt, dòng chữ phụ đổi sang màu sáng để đọc được trên nền tối). Menu hiện đủ các nhóm, không thu gọn, theo thứ tự Công việc → Quản trị → Tổ chức → Sản xuất → Phân phối & kho → Chất lượng & báo cáo → Dịch vụ & cài đặt; mỗi nhóm có tiêu đề sáng và đường phân cách; trỏ chuột hoặc focus bàn phím gạch chân tên mục. "Cài đặt" (`/enterprise/settings`) hiện chỉ là trang chờ.
- Góc trên bên phải có chuông (icon duy nhất trong shell) với số đỏ luôn hiển thị, kể cả 0: tổng thông báo nội bộ chưa đọc và việc đang chờ từ `/distribution/tasks`.
- "Quản lý thông báo" (`/enterprise/messages`) là hộp thư nội bộ: người có `members.manage` gửi thông báo cho tất cả hoặc từng thành viên đang hoạt động; người tham gia trả lời như chat; tin đã gửi không sửa/xóa. API `/enterprise-messages` dùng command journal (`EW_MESSAGE_SEND`, `EW_MESSAGE_REPLY`, `EW_MESSAGE_READ`) và không ghi trace/Fabric.
- Lựa chọn Riêng tư/Công khai dùng hai ô tick (radio, chọn một trong hai) thay cho danh sách thả xuống. Trang Tổng quan chỉ giữ số liệu, dòng thời gian và lối tắt.
- Không dùng icon trong shell, menu, tiêu đề trang và nút; nút chỉ có icon trước đây nay có chữ (Quét QR, Trang chủ, Menu, Đóng).
- Form (`DataForm`, `.workspace-form`, `.enterprise-fields`) rộng theo vùng nội dung (tối đa 1680 px) và chia cột theo bề rộng đó (container query `manage`): một cột khi hẹp, hai cột từ 700 px, nhãn bên trái và ô nhập 60% bên phải từ 1000 px. Ô nhiều dòng, chọn nhiều (bắt đầu thẳng hàng với cột ô nhập bên trái), tiêu đề nhóm `.form-section-title`, thông báo và nút chiếm cả hàng. Trường bắt buộc tự có dấu `*` đỏ theo thuộc tính `required`.
- `LoadState` hiển thị vòng xoay và khung xương khi chờ tải; tắt chuyển động khi `prefers-reduced-motion`.
- `ConfirmProvider` (`lib/confirm.tsx`) hỏi xác nhận trước các lệnh làm thay đổi quyền, chữ ký, số lượng hoặc trạng thái (`importantAction`), áp dụng chung trong `DataForm` và `useWorkspaceCommand`. Gửi lại yêu cầu chưa rõ kết quả dùng key cũ và không hỏi lại.

### Khu quản trị 9 nhóm, chế biến và gói dịch vụ (19/10/2026)

- Menu admin trong `lib/management-routes.ts`: Tổng quan (Dashboard, Hồ sơ chờ xử
  lý, Thông báo), Doanh nghiệp, Tài khoản & phân quyền, Truy xuất nguồn gốc,
  Blockchain, Dịch vụ & thanh toán, Kiểm duyệt & hỗ trợ, Báo cáo & giám sát, Cấu
  hình hệ thống. Quyền xem route ở `lib/permissions.ts`; API vẫn tự phân quyền.
- Widget chung `components/manage/admin-widgets.tsx`: `Metrics`, `BarList`,
  `ReasonAction` (bắt nhập lý do ≥ 10 ký tự trước thao tác có audit), `Tabs`. Nhãn
  và định dạng ở `lib/platform-admin.ts`. `useWorkspaceCommand().run` nhận thêm
  method `PATCH` (đổi trạng thái tổ chức).
- Hồ sơ đăng ký có khối "Duyệt từng năng lực" (`components/workspace/capability-review.tsx`).
- Form đăng ký: chọn mô hình tham gia trước khi chọn hoạt động; mô hình một vai
  trò chỉ giữ một hoạt động; hoạt động Nhà chế biến bắt buộc loại hình chế biến,
  giấy chứng nhận ATTP còn hạn và file chứng nhận. Gói quan tâm thay đổi theo mô
  hình; tổ chức tham gia miễn phí không chọn gói.
- Doanh nghiệp: `/enterprise/processing` (nguyên liệu đang giữ, lệnh, lập lệnh
  với kiểm cân bằng trực tiếp, hoàn tất/hủy), `/enterprise/billing` (gói, hạn mức,
  hóa đơn, gia hạn), `/enterprise/support` (yêu cầu hỗ trợ).
- Trang QR công khai có mục "Sản phẩm được chế biến từ" và form phản ánh
  (`components/site/consumer-report-form.tsx`). Banner thông báo hệ thống ở
  `components/shell/system-notices.tsx`, ẩn trong phiên trình duyệt.
