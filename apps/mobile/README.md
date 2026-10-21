# ACheck — ứng dụng người tiêu dùng AgriTrace

Package Expo độc lập, **không thuộc root npm workspaces**. Bản đầu này gồm khung
5 tab, quét QR/nhập mã, đọc API truy xuất công khai và lịch sử cục bộ. Không có
API ghi nghiệp vụ, signer hoặc dữ liệu lô mẫu trong bản phát hành.
Demo tài khoản chỉ có ở dev/test khi bật rõ cờ, xem phần xác thực bên dưới.
Tab Sản phẩm/Doanh nghiệp đọc danh mục công khai từ API; Tài khoản là chế độ khách.

## Công cụ và chạy local

Node theo engine repo (22.22.3+, 24.15+ hoặc 26); npm 12.1.0. SDK cố định Expo
57.0.30, React Native 0.86.3, React 19.2.3, Router 57.0.28. Native modules được
kiểm bằng `expo install --check`; không dùng `--force` hoặc `--legacy-peer-deps`.

Từ thư mục root:

```bash
cd apps/mobile
npm ci
cp .env.example .env
npm start
```

Sửa `.env` trước khi quét:

- `EXPO_PUBLIC_API_BASE_URL`: địa chỉ API **kết thúc bằng `/api`**. Android emulator
  thường dùng `http://10.0.2.2:8080/api`; thiết bị thật dùng IP LAN của máy chạy API
  hoặc API HTTPS được phép. `localhost` trên điện thoại không phải máy tính.
- `EXPO_PUBLIC_TRACE_ORIGIN`: origin website QR được phép, ví dụ
  `https://agritrace.dev`. URL QR ngoài origin bị từ chối, không mở trình duyệt.
- Các biến `EXPO_PUBLIC_*` được đóng vào bundle, tuyệt đối không đặt secret.
  Không có API mặc định; thiếu cấu hình thì màn truy xuất báo lỗi, không gọi production.
  HTTP chỉ cho bản phát triển; release bắt buộc HTTPS. Khởi động lại Expo khi đổi env.

Sau khi thêm Firebase native, dùng development build riêng, không dùng Expo Go.
`npm run android` cần Android SDK/JDK và emulator/thiết bị; có thể dùng EAS Build
theo `eas.json` rồi cài APK. `npm run ios` cần Xcode đầy đủ và cấu hình Firebase iOS
riêng; hiện chưa tích hợp/nghiệm thu iOS. Không đổi SDK để ép tương thích Expo Go.

## Firebase Phone Auth — thử nghiệm Android với API thật

Hai gói `@react-native-firebase/app` và `auth` được pin cùng `26.0.0`.
Bản 27 dùng Firebase Android BoM35/Auth25, đã gặp Kotlin metadata2.4 so với
compiler2.1 trong EAS SDK57; không nâng Kotlin, không bỏ kiểm metadata.
`app.config.ts` đọc `google-services.json` đúng package `dev.agritrace.consumer`.
Thêm SHA-1/SHA-256 đúng chứng chỉ ký APK vào Firebase; giữ keystore hiện có.
Blaze/Phone provider/region Vietnam và cơ chế chống lạm dụng Firebase phải được
owner cấu hình; không tắt app verification hoặc dùng số test để tuyên bố SMS thật.

API local (`apps/api/.env`, không commit):

```dotenv
NODE_ENV=development
CONSUMER_AUTH_ENABLED=true
CONSUMER_DEV_REGISTRATION_ENABLED=true
FIREBASE_PROJECT_ID=your-firebase-project-id
```

Rà `DATABASE_URL` trỏ DB dev riêng, rồi từ root chạy
`npm run prisma:generate --workspace apps/api` và
`npm run db:migrate --workspace apps/api` (append migration
`20261023000000_consumer_phone_auth`, không reset).
Không áp migration hay bật cờ trên production trong task này.

Mobile `.env`:

```dotenv
EXPO_PUBLIC_AUTH_DEMO=false
EXPO_PUBLIC_CONSUMER_AUTH=true
```

Giữ `EXPO_PUBLIC_API_BASE_URL` trỏ API dev của bạn. Khởi động lại API và Metro;
trong `apps/mobile` chạy `npx expo start --dev-client --clear`, mở ACheck APK,
không mở Expo Go. Metro và API phải dùng hai cổng khác nhau.
Thay Firebase native config/dependency cần build lại APK; sửa JS/TS thường chỉ
cần Metro reload. EAS cloud là thao tác owner thực hiện, không chạy tự động ở đây.

Luồng thật chỉ bật khi **Android + __DEV__ + cờ EXPO_PUBLIC_CONSUMER_AUTH=true**.
Khi chọn thật nhưng thiếu module/config, không fallback sang mock. Bản release
chưa mở auth cho tới khi văn bản/chính sách và nghiệm thu được duyệt.
Nếu khởi tạo thất bại, trang Tài khoản hiển thị mã `[AUTH-…]` cố định để phân
biệt cấu hình API, nạp module native, khởi tạo phiên và Firebase. Chụp mã này;
không gửi token/OTP/mật khẩu. Mã khởi tạo không chứng minh API đã kết nối được.
Android tạm tắt native-stack animation riêng cho login/register/forgot-password
và đóng bàn phím trước login để giảm xung đột mount khi phiên đổi cùng lúc
replace màn hình. Cần kiểm login/logout/đổi tài khoản trên APK để xác nhận;
unit test/bundle không chứng minh đã hết native `addViewAt` crash. Tắt animation
đơn lẻ chưa hết crash trên BlueStacks. Bản thử tiếp theo tách key card khách/hồ sơ
theo user ID, giữ native children của card auth và pin các slot nút bằng key cùng
`collapsable={false}` để tránh reparent do flatten/unflatten lúc loading đổi.
Kiểm tra source chỉ chống mất cấu hình workaround, không mô phỏng native renderer.
Giữ key/native boundary đơn lẻ vẫn chưa hết crash trên BlueStacks; nút hiện giữ
cố định bốn slot nền/leading/label/trailing, chỉ đổi opacity và animating khi busy.

**Trạng thái bàn giao review 2026-10-21: native crash chưa được giải quyết.**
Tester vẫn gặp `SurfaceMountingManager.addViewAt` / `The specified child already
has a parent` sau đăng nhập và khi đăng xuất trên BlueStacks Air 3, kể cả sau các
workaround trên. Sau reload có thể khôi phục phiên đã lưu; điều đó không chứng
minh chuyển trạng thái UI thành công. Các native tag thay đổi giữa lần chạy,
không đủ để xác định component gây lỗi. Cần kiểm cây native quanh thời điểm
`publish("authenticated")` → `router.replace("/account")`, cập nhật card tài
khoản còn mounted phía sau login và việc tab bar mount/unmount khi bàn phím đổi
trạng thái. Đây là các hướng cô lập, **chưa phải nguyên nhân đã xác nhận**.
ADB/DevTools chưa thu được log native bổ sung; chưa đối chiếu độc lập phiên bản
native trong APK đang cài với dependency JS. Test source/unit không thay thế
nghiệm thu login → logout → cold relaunch trên Android. Không nâng dependency,
tắt kiểm tra xác thực hay xóa dữ liệu app để che crash.

Logout ghi đồng bộ dấu không nhạy cảm `agritrace.consumer.logout-intent.v1` vào
SecureStore trước lần thông báo UI đầu tiên (không yêu cầu biometrics). Khi mở
lại, dấu này ép credential còn lại thành `logoutPending`, không refresh để tự
đăng nhập. Marker độc lập cũng chặn một active write đến muộn; chỉ xóa marker sau
khi credential đã bị xóa. Đây là chặn khôi phục trên thiết bị, không thay thế
revoke tại API: offline/crash vẫn phải thử thu hồi lại. Nếu ghi SecureStore lỗi,
không được coi logout đã hoàn tất. Test mô phỏng crash tại notification không
thay cho nghiệm thu thao tác logout/crash/relaunch trên APK thực.
UI dev có thông báo xử lý dữ liệu và consent `DEV-CONSUMER-TEST-20261020`, không
phải chính sách pháp lý chính thức; chỉ dùng số thuộc tester và hồ sơ thử nghiệm.

- Đăng ký: hai bước hồ sơ → Firebase gửi SMS → xác nhận → ID token ở RAM → API
  kiểm bằng chứng → một transaction tạo user/profile/proof/session. Không tạo
  account trước OTP. Phone chuẩn hóa +84, email liên hệ không dùng đăng nhập.
- Backend xác minh RS256 bằng cert HTTPS cố định của Google, đúng issuer/audience,
  provider=phone, phone_number, exp/iat/auth_time mới <=5 phút. Theo contract
  [third-party verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library),
  không cần service-account private key. Đây không phải kiểm Firebase account
  revocation; account/session của app kiểm DB. Không hỗ trợ Firebase Auth emulator
  unsigned token. Replay chặn cả hash token và UID/auth_time của cùng lần xác minh.
- SDK sign-out sau lấy token; không lưu Firebase ID token/OTP/password vào
  SecureStore/AsyncStorage. Login dùng SĐT + mật khẩu qua API, không gửi SMS.
- Native API không đọc/ghi cookie Web. Access/profile ở RAM, refresh credential
  ở SecureStore; restore/rotation/logoutPending tái dùng coordinator đã có.
- Reset qua OTP đổi hash mật khẩu và thu hồi tất cả family trong transaction,
  không cấp session. Đăng nhập lại sau reset. Role CONSUMER không có tổ chức và
  chỉ được đọc `/consumer/me`; API nghiệp vụ bị chặn ngay trong JWT guard.
- OTP resend chờ60 giây và không tự retry. Firebase vẫn quyết định quota/anti-abuse;
  cooldown client không phải kiểm soát ngân sách SMS. API giới hạn theo IP và
  HMAC số điện thoại (10 lần/15 phút/op, DB dùng chung instances).
- Unknown register/login/refresh outcome không tự retry; đăng ký có thể đã commit,
  hướng dẫn đăng nhập. Unknown token/session không bảo đảm thu hồi được nếu mất
  hoàn toàn credential response. Không tự xóa lịch sử hay tạo token mới để che lỗi.

Kiểm crypto ở `firebase-phone-verifier.spec.ts`; PostgreSQL/HTTP ở
`test/mobile-auth.e2e-spec.ts` (Firebase verifier là fixture; không phải SMS thật).
Test duyệt mọi route private trong Swagger bằng token CONSUMER, kiểm domain/
outbox không đổi; IP throttle có suite riêng. SMS thật, native UI/keyboard,
Firebase app-verification/BlueStacks và thiết bị Android vật lý vẫn cần kiểm.

## Giao diện và chuyển tab

Thanh điều hướng có 5 tab, QR ở giữa; nền/icon/vạch chọn biểu thị tab hiện hành.
Nhấn lại tab không push thêm route, vẫn phát tabPress để navigator xử lý. Back
Android theo lịch sử tab. Thanh tab ẩn khi bàn phím native mở, chừa safe area;
nhãn được xuống dòng và giữ chỗ cho indicator để tránh nhảy chiều cao.

Đổi tab dùng fade nhẹ; tùy chọn giảm chuyển động của hệ điều hành tắt animation,
kể cả khi đổi tùy chọn lúc app đang mở. Không animate form đang nhập hoặc cảnh báo.
Trang chủ dùng lối vào nhanh sản phẩm/doanh nghiệp/bảng tin/thông báo; không thêm
số liệu, huy hiệu xác minh hay nội dung giả. Màn hẹp/chữ lớn chuyển lối vào nhanh
về một cột; card/nút giữ font Be Vietnam Pro, màu và khoảng cách hiện có.

Giao diện tham khảo HTML được dựng lại bằng native components/SVG: nền xanh
chuyển sắc, ba thẻ hướng dẫn màu nhẹ, nút có phản hồi khi nhấn, vòng sáng QR
chạy tối đa 3 lượt mỗi lần kích hoạt. Vệt quét chỉ được mount khi camera thật
đã được người dùng bật; không mô phỏng quét thành công. Hiệu ứng dừng khi rời
màn/chuyển nền hoặc bật giảm chuyển động; không thêm CDN script/font hay dữ liệu
“an toàn/đạt chuẩn” từ bản HTML vào app.

Đăng nhập/đăng ký/quên mật khẩu dùng chung `auth-scaffold.tsx`: branding, hero,
card form và chỉ báo bước. `AuthField` có icon, trạng thái focus/lỗi và nút mắt
trong ô mật khẩu; giữ nguyên autocomplete, OTP, mật khẩu không trim/truncate và
các validation. Đăng ký vẫn hai bước hồ sơ rồi OTP; reset vẫn xác nhận số rồi
đặt mật khẩu, không cấp phiên thật. Chuyển bước về đầu form nhưng giữ draft trong
component cha; không animate form đang nhập. Bản release vẫn không mở auth thật
hoặc chứa mock, chỉ có màn giới thiệu tính năng sắp ra mắt cùng phong cách.

Test layout/navigation logic không thay kiểm hình ảnh, bàn phím/Back/camera trên
thiết bị thật. Sau sửa giao diện, mở lại Expo Go và kiểm đủ 5 tab, chữ lớn và màn hẹp.

## Luồng và dữ liệu

`Trang chủ → Quét QR/nhập mã → GET /api/public/trace/:token → Kết quả → Lịch sử`.
QR hợp lệ chỉ tạo route nội bộ. API công khai không gửi Authorization/Cookie và không
follow redirect. Mất mạng/404/429/timeout có thông báo và nút thử lại; không bịa dữ liệu
offline hoặc coi lỗi API là kết quả xác minh thành công.

Camera chỉ xin quyền sau khi bấm nút, tắt khi rời tab/chuyển app; không lưu/tải ảnh.
Từ chối camera vẫn nhập mã được. Lịch sử tối đa 50 mục, chỉ lưu token truy xuất,
tên sản phẩm và ngày xem trong AsyncStorage trên thiết bị; có xác nhận xóa. Mở lại
lịch sử luôn đọc API mới, không cache toàn bộ phản hồi, token đăng nhập hay PII.
Đây là mô tả kỹ thuật hiện tại, **không phải chính sách pháp lý cuối cùng** cho các
chức năng tài khoản/SMS sẽ bổ sung sau.

Thu hồi/hết hạn/đối soát/thiếu cảm biến hiển thị độc lập với proof. Không có badge
“đạt chất lượng”/“blockchain verified” hay chi tiết Fabric trên mobile. Chứng nhận
là thông tin công khai do API cấp, không phải xác nhận chất lượng do ACheck tự cấp.

## Danh mục sản phẩm và doanh nghiệp

Không yêu cầu đăng nhập. Bốn endpoint chỉ đọc của module `public-directory`:

- `GET /api/public/products`: tìm theo tên/giống (`q`), phân trang `cursor`/`limit`.
- `GET /api/public/products/:id`: thông tin sản phẩm, đơn vị liên quan và liên kết
  truy xuất lô; phân trang riêng bằng `enterpriseCursor` và `lotCursor`.
- `GET /api/public/enterprises`: tìm theo tên, lọc `type`, phân trang `cursor`/`limit`.
- `GET /api/public/enterprises/:id`: sản phẩm liên quan và chứng nhận công khai;
  phân trang riêng bằng `productCursor` và `certificateCursor`.

API giới hạn 50 mục/trang, từ khóa 100 ký tự, 60 request/phút/IP trên mỗi endpoint.
Cursor là UUID cuối trang, sắp xếp theo ID. Mobile tải 20 mục/lần, gộp theo ID,
hủy request cũ khi đổi bộ lọc/rời màn hình. Dữ liệu danh mục không lưu offline.
Danh sách có trạng thái đang tải, rỗng, lỗi, thử lại và tải thêm.

Chỉ sản phẩm ACTIVE có lô QR và nông trại/tổ chức ACTIVE mới xuất hiện. Doanh nghiệp
phải liên quan trực tiếp đến lô đó (Farm hoặc đơn vị giao nhận), không lấy mọi
thành viên trong chuỗi. Lô hết hạn/thu hồi vẫn được tìm thấy để người dùng xem cảnh
báo qua màn truy xuất, không bị trình bày là lô an toàn.

Chứng nhận phải công khai, APPROVED, đến ngày hiệu lực, chưa hết hạn theo ngày
Việt Nam và chưa bị bản APPROVED thay thế; thuộc lô/vụ liên quan, không được diễn
giải thành chứng nhận cho chính doanh nghiệp. Không trả email, điện thoại, địa chỉ
nội bộ, documentRef, thông tin tài khoản, key hoặc cấu hình Fabric.

Các phần chính: `src/api/directory.ts` kiểm tra phản hồi API; `src/directory/`
chứa màn danh sách/chi tiết và quản lý phân trang; `app/products/[id].tsx` và
`app/enterprises/[id].tsx` khai báo route. Nhấn lô mở màn `trace/[token]` hiện có.
Không thêm schema/migration hoặc thay đổi giao dịch nghiệp vụ.

## Bảng tin và thông báo hệ thống

Từ Trang chủ chọn ô “Bảng tin” hoặc “Thông báo” (hoặc biểu tượng chuông). Không cần đăng nhập.
Màn danh sách có tìm kiếm bài viết, phân trang, tải/rỗng/lỗi/thử lại; chi tiết bài
hiển thị văn bản thuần, không render HTML/Markdown, không mở URL trong nội dung.
Không tự chèn tin mẫu hay lấy nội dung từ website khác. Ảnh bìa đi qua API kiểm
tra nguồn/kích thước, không giao URL ngoài cho trình tải ảnh native (chi tiết dưới).

- `GET /api/public/news?q=&cursor=&limit=`: chỉ `isPublished=true`,
  `publishedAt <= now`, danh sách không trả body hoặc thông tin biên tập.
- `GET /api/public/news/:id`: cùng điều kiện công khai, có body tối đa 50.000 ký tự.
- `GET /api/public/announcements?cursor=&limit=`: chỉ `isActive=true`,
  `startsAt <= now < endsAt` (hoặc không có endsAt).

Sắp xếp thời điểm giảm dần và UUID giảm dần khi trùng thời điểm; cursor opaque
riêng mỗi endpoint. Mỗi trang tối đa 50, từ khóa tối đa 100, throttle 60/phút/IP,
`Cache-Control: no-store`. API không có endpoint ghi công khai.

Migration append `20261022000000_public_consumer_content` chỉ tạo bảng
`consumer_news` và `consumer_announcement` + indexes/checks; không đổi tài khoản,
domain, event hoặc outbox. Trước khi chạy API local, rà DATABASE_URL rồi áp các
migration đã được review bằng `npm run db:migrate --workspace apps/api` từ root.
Không reset DB. Không tự áp lên production hoặc bật Production CD.

Nội dung do chủ dự án cung cấp, vận hành nhập bằng SQL đã review: news gồm title,
summary, body, is_published, published_at (tùy chọn cover_url); announcement gồm
title, body, severity INFO/WARNING/CRITICAL, is_active, starts_at, ends_at tùy chọn.
Mặc định bài là nháp và thông báo không active. Không đưa PII/tài liệu nội bộ vào
các bảng công khai này. Thông báo mới quan trọng nên có ID mới, vì đã đọc bám theo ID.

`PUBLIC_NEWS_IMAGE_HOSTS` ở API là danh sách hostname chính xác, phân tách dấu phẩy.
Không cấu hình thì coverUrl trả null; chỉ chấp nhận HTTPS, không user/password,
port tùy chỉnh hoặc fragment. Chưa có host được duyệt mặc định; mobile hiện không
tự liên hệ CDN kể cả API trả URL. Mobile chỉ gọi
`GET /api/public/news/:id/cover` theo UUID. API kiểm bài còn công khai và host vẫn
được phép trên mỗi lần gọi, kể cả khi có cache; rồi trả envelope chứa
`mimeType`, `dataBase64`, `width`, `height`, không chuyển hướng trình tải ảnh native.

Ảnh tối đa 384 KiB, PNG/JPEG/WebP tĩnh, mỗi chiều tối đa 2048 px và tối đa 4 triệu
pixel. API kiểm MIME + header/kích thước; không hỗ trợ SVG, GIF, APNG, WebP động,
nén HTTP hoặc redirect. Nguồn ảnh cần DNS IPv4 công khai; private, loopback,
metadata/link-local và các dải reserved bị chặn. DNS được pin vào TLS connection,
không nhận URL từ query, không chuyển cookie/header người dùng tới nguồn ảnh.
Timeout tổng 5 giây; tối đa 3 download khác nhau cùng lúc; cache RAM 8 ảnh/60 giây,
không phải cache chia sẻ giữa API instances. Endpoint throttle 30/phút/IP và
no-store phía client. Nguồn ảnh phải được chủ dự án duyệt quyền sử dụng trước bật.

Danh sách chỉ tải ảnh khi bấm để tránh tự tải mọi trang; chi tiết tự tải khi mở.
Khung 16:9 co theo màn hình, hiển thị contain không làm méo/cắt ảnh; có nhãn đọc
màn hình, trạng thái tải, fallback và nút thử lại. Rời màn hủy request; ảnh lỗi
không chặn nội dung. Không ghi ảnh/response vào AsyncStorage. Decoder thiết bị
vẫn có thể từ chối file hỏng dù header qua kiểm tra, UI phải giữ fallback.
Sản phẩm/doanh nghiệp hiện **không có trường ảnh công khai** trong contract nên
tiếp tục dùng icon trung tính, không gán ảnh/nhãn hiệu mẫu cho dữ liệu thật.

“Đã đọc” chỉ lưu danh sách tối đa 500 UUID tại
`agritrace:public-announcement-read:v1` trong AsyncStorage. Không lưu body, PII,
credential hay lịch sử đọc trên server. Có đặt lại với xác nhận; lỗi bộ nhớ hiển thị
rõ và không đánh dấu thành công giả. Đây là trạng thái chung cho thiết bị, không
phải thông báo nội bộ của Farm hay dữ liệu theo tài khoản.

Test `apps/api/test/public-content.e2e-spec.ts` cần DB test cách ly đã migrate.
Không dùng fixture bài viết để nghiệm thu nội dung thật hoặc production.

## Thời tiết theo tỉnh/thành

Khối thời tiết ở Trang chủ: tự chọn tỉnh trong danh sách trắng, không xin GPS,
không đoán nơi ở, không lưu lựa chọn vào hồ sơ/AsyncStorage. Mobile chỉ gọi
`GET /api/public/weather?province=01` qua API đã cấu hình, không gọi upstream.
Lỗi thời tiết không khóa QR, tin tức hoặc phần khác.

Hiển thị ước tính hiện tại theo mô hình (°C, %, km/h, mã WMO), dự báo 3 ngày theo
lịch Việt Nam, thời điểm mô hình/lấy dữ liệu và tên điểm đại diện. Đây không phải
cảm biến tại thiết bị, số đo đồng nhất cả tỉnh hoặc cảnh báo thiên tai. Null hiển
thị “Chưa có dữ liệu”, không đổi thành 0. Đổi tỉnh hủy/bỏ kết quả cũ; mở lại màn
hoặc hết TTL sẽ lấy lại qua API.

### Bật thử local, không dùng production

Nhà cung cấp và điều khoản chưa được chủ dự án chốt; API **mặc định tắt**. Adapter
Open-Meteo được chuẩn bị để thử local. Từ `apps/api`:

```bash
NODE_ENV=development WEATHER_PROVIDER=OPEN_METEO WEATHER_LICENSE_MODE=DEV_NONCOMMERCIAL PORT=8082 npm run start:dev
```

Mode DEV_NONCOMMERCIAL không cần API key nhưng chỉ dùng cho thử nghiệm phi thương
mại phù hợp điều khoản, bị chặn trên production. Chủ dự án phải chọn/duyệt nguồn,
điều khoản và quota trước phát hành. Mode COMMERCIAL chỉ mở khi
`WEATHER_PROVIDER_APPROVED=true` và có `WEATHER_API_KEY` trong môi trường server,
gọi endpoint customer cố định. Không đưa key vào mobile/Git/log. Restart API sau
khi đổi config; không coi adapter là phê duyệt pháp lý hay bằng chứng đã có thuê bao.

Nguồn: [Forecast API](https://open-meteo.com/en/docs),
[Terms](https://open-meteo.com/en/terms), [Licence](https://open-meteo.com/en/licence).
Free API giới hạn cho phi thương mại. UI có attribution Open-Meteo/GeoNames.

Cache ở bộ nhớ mỗi API instance: tối đa 34 tỉnh, TTL 10 phút hoặc đến nửa đêm
Việt Nam; cùng tỉnh dùng một request đang chờ, tối đa 3 request khác tỉnh đồng
thời. Timeout 5 giây, JSON tối đa 64 KiB, không redirect, không gửi cookie/header
người dùng. Provider lỗi trả 502 chung, nghỉ 30 giây cho tỉnh lỗi (503), không
trả cache hết hạn như dữ liệu mới và không retry tự động. Query không nhận host,
URL hay tọa độ tùy ý. Quota/cache không chia sẻ giữa nhiều instance; cần tính quota
tổng hoặc cache/rate limiter chung khi scale.

`apps/api/src/common/locations/weather-points.json` lưu 34 điểm dân cư đại diện,
GeoNames ID/source/admin1, query, ngày lấy và hash. Không phải GPS người dùng hay
tuyên bố về trung tâm hành chính; admin1 nguồn có thể mang tên cũ.
[Geocoding API](https://open-meteo.com/en/docs/geocoding-api) dùng dữ liệu GeoNames;
giữ attribution và review mapping trước production. Ninh Bình dùng Tam Điệp để
tránh địa danh trùng tên ở tỉnh khác.

Từ root, `node scripts/generate-weather-points.mjs --check` kiểm coverage/hash/tỉnh.
Sinh lại bằng script (có mạng, `--refresh` bỏ snapshot đang có), review diff thay
vì sửa tay tọa độ. Không có migration; không ghi database/event/outbox. Test HTTP
fixture không thay kiểm nhà cung cấp thật hoặc nghiệm thu UI Android.

## Chế độ mô phỏng giai đoạn A (tách khỏi pilot Firebase thật)

Đã có đăng nhập; đăng ký hai bước (mật khẩu → hồ sơ/địa giới/đồng ý văn bản → OTP);
quên mật khẩu (SĐT → OTP → mật khẩu mới); hồ sơ và đăng xuất/đổi tài khoản demo.
Muốn thử, thêm vào `.env` rồi khởi động
lại Expo:

```env
EXPO_PUBLIC_AUTH_DEMO=true
```

Chỉ dev/test có nút “Mở đăng nhập thử nghiệm” ở tab Tài khoản. Dùng số giả
`0900000000`, mật khẩu `Demo-only-1234`; không nhập dữ liệu thật. Mock không gửi
SMS, không gọi API auth và không tạo user/role/session trong PostgreSQL. Hồ sơ
chỉ ở bộ nhớ, reload/đóng app sẽ mất; đây **không phải** refresh/secure storage.
Đổi tài khoản/đăng xuất hoặc rời form vô hiệu hóa response đăng nhập đến muộn.

OTP thử là `123456`, hết hạn sau 5 phút, gửi lại sau 30 giây và chặn sau 5 lần sai.
Chỉ bấm Đăng ký ở bước 2 mới gửi mã. Đổi tỉnh xóa phường, quay lại bước 1 giữ form;
thoát luồng xóa form khỏi bộ nhớ. Không có request auth ra mạng.
Đăng ký chỉ tạo hồ sơ demo trong bộ nhớ, không tạo tài khoản để đăng nhập lại.
Đặt lại mật khẩu chỉ mô phỏng màn hình thành công; mật khẩu demo cố định không đổi.
Đây là giới hạn có chủ ý của mock, không phải nghiệm thu backend xác thực.

`AuthService`/`PhoneVerifier` là ranh giới adapter với pilot giai đoạn B ở trên.
Chưa có điều khoản được duyệt và nghiệm thu UI thiết bị đầy đủ.
Màn pháp lý chỉ là bản giữ chỗ dev, không phải tư vấn pháp lý hay văn bản hiệu lực.
Mock không dùng Firebase project/SMS hay backend thật.

Release luôn tắt mock, kể cả biến demo là `true`; mở `/login` trực tiếp chỉ báo
sắp ra mắt. `npm run test:auth-release` export bundle production với cờ demo bật
và kiểm không chứa module/dữ liệu nhận diện mock. Không dùng kết quả demo làm
bằng chứng nghiệm thu xác thực thật. Web auth/cookie transport giữ nguyên contract.

### Nền tảng phiên native — nối pilot Android, không thay phiên demo

`src/auth/native-session.ts` là coordinator riêng cho giai đoạn B, không thay
`DemoSessionStore`. `mobile-auth-api.ts` cung cấp adapter native với timeout hữu hạn,
kiểm response và phân biệt lỗi: `offline` chỉ khi chắc chắn chưa gửi request;
timeout/mất response sau gửi phải là `uncertain`, không tự retry login/rotation.
Instance runtime chỉ khởi tạo khi bật pilot Android, không khởi tạo trên Web/release.

`credential-storage.ts` kiểm shape chính xác, `secure-credential-storage.ts` nối
Expo SecureStore 57.0.4 theo bundledNativeModules của Expo 57. Chỉ lưu sessionId,
refreshToken, refreshExpiresAt và state; access token/profile chỉ ở bộ nhớ. Không
fallback sang localStorage/AsyncStorage khi Web preview hoặc kho bảo mật lỗi.
Plugin loại credential khỏi Android Auto Backup; iOS dùng
WHEN_UNLOCKED_THIS_DEVICE_ONLY. Không bật sinh trắc học/FaceID.

Khôi phục: đọc → refresh single-flight → lưu rotation → xác nhận `me` → mở profile.
401 GET riêng tư refresh/retry tối đa một lần, 403 không retry. 409 chỉ thử một lần
với credential thắng đã được lưu thuộc đúng family; không có thì thoát/thu hồi.
Đổi account/logout xóa private UI ngay, generation bỏ response cũ; các thao tác
storage/API tuần tự. GET chỉ trả dữ liệu nếu generation vẫn còn hiện hành.

Logout ghi `logoutPending` trước revoke. Offline giữ tombstone, cold start không
refresh nó; lifecycle giai đoạn B phải gọi `logout()` để retry khi có mạng.
Tạm chặn login mới nếu chưa thu hồi được phiên cũ, không ghi đè pending credential.
Kho bảo mật ghi lỗi thì không mở tài khoản và cố revoke token vừa cấp trong RAM.
Nếu cả ghi storage và revoke đều lỗi, không bảo đảm giữ được tombstone qua tắt app;
UI báo rõ máy chủ có thể còn phiên. Mất hẳn response login/rotation có thể khiến
không có credential mới để thu hồi; client không tuyên bố rollback máy chủ.

Test coordinator/serializer dùng storage/API giả cách ly; kiểm được sequencing,
single-flight, timeout, 401/403/409, late response, offline pending và lỗi storage.
Chạy riêng bằng `npm run test:session` tại `apps/mobile`, hoặc `npm run check`
để kiểm toàn bộ mobile.
Chưa chứng minh Keychain/Keystore thật, reinstall/backup hoặc API auth production.
Trên iOS credential có thể tồn tại sau reinstall: chỉ refresh + `me` mới được mở
tài khoản, không tin profile cache. Giai đoạn B cần nghiệm thu trên thiết bị thật.

### Nguồn địa giới hành chính

Dữ liệu tĩnh từ [thanglequoc/vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database),
MIT, copyright Thang Le Quoc; kèm giấy phép tại `src/locations/LICENSE-vietnam-data.txt`.
Ghim revision `8b78ba5118715e1fa81769286724db79346abf52`, bản nguồn v5.2.0,
ngày hiệu lực nguồn ghi 20/09/2026, truy xuất 19/10/2026: 34 tỉnh/thành, 3321 xã/phường.
Đây là snapshot từ dự án cộng đồng, không phải tuyên bố app đã được cơ quan nhà nước
xác nhận hay dữ liệu tự cập nhật. Chủ dự án cần rà nguồn trước phát hành.

Từ root, `node scripts/generate-consumer-locations.mjs` sinh hai bản API/mobile từ
nguồn có SHA-256 cố định; không chỉnh tay JSON. `--check` kiểm parity/hash/thứ tự
mà không cần mạng. Test mobile cũng kiểm hai bản trùng nhau. Sắp xếp tiếng Việt
khi sinh, app chỉ lọc danh sách đã sắp xếp; không phụ thuộc `Intl` trên thiết bị.
Endpoint đăng ký consumer kiểm mã tỉnh/phường bằng cùng snapshot phía API.

## Contract và assets

TypeScript sinh từ metadata NestJS vào `src/api/generated/api.d.ts`. Không sửa tay
hoặc chép type Web. Từ root sau khi cài dependency:

```bash
npm run prisma:generate --workspace apps/api
npm run build --workspace blockchain/gateway
npm run api-contract:generate
npm run api-contract:check
```

Không cần DB/Fabric cho exporter. Danh mục dùng module API chỉ đọc mới; không đổi
source Web hoặc các command nghiệp vụ để làm app.
Icon launcher dùng `assets/brand/appDaiDien.png`; bên trong app dùng logo AgriTrace
riêng. Font Be Vietnam Pro đóng gói local cùng giấy phép OFL, không tải font ngoài.

## Kiểm tra

Trong `apps/mobile`:

```bash
npm run check
npm run export:android
npm run export:ios
```

`check` chạy lint không warning, strict typecheck, test QR/API/history/warnings/directory và
kiểm tương thích Expo. Export chỉ kiểm bundle/assets, **không phải APK/IPA**.

Bài UI dùng public fixture cách ly, không truy cập production. Cài dependency root
và Chromium của Playwright trước; từ `apps/mobile` chạy `npm run test:ui`.
Trên máy có Chrome có thể đặt `MOBILE_BROWSER_CHANNEL=chrome`. Harness tự export
Web với host giả được chặn và thay phản hồi bằng fixture, kiểm 320/390/768px,
QR sai origin, cảnh báo, lịch sử sau reload/xóa, 404 và offline. Ảnh nằm ở
`.ui-artifacts/` (Git bỏ qua). Đây không phải nghiệm thu camera hoặc API/DB thật.

Audit độc lập từ root:

```bash
node scripts/ci/audit-mobile.mjs
```

Script lưu full/production audit, peer graph và metadata SHA/Node/npm/checksum
lockfile ở `.audit/` (Git bỏ qua), chặn moderate trở lên. **Chưa có ngoại lệ được
duyệt.** SDK57 hiện còn advisory transitives ở toolchain và Router (braces,
node-forge, decode-uri-component, uuid); audit thất bại là blocker trước merge,
không được đổi `--audit-level` hay dùng `--force`. Cần bản vá tương thích hoặc chủ
dự án duyệt từng ngoại lệ có lý do và hạn tối đa 30 ngày theo quy trình task.

## Giới hạn bàn giao bản đầu

Test `apps/api/test/public-directory.e2e-spec.ts` kiểm API danh mục qua HTTP và
PostgreSQL cách ly đã migrate, gồm phân trang, phạm vi dữ liệu và chứng nhận.
Chạy bằng `TEST_DATABASE_URL` trỏ đến database test riêng; không dùng database
nghiệp vụ hay production. Không coi kết quả này là nghiệm thu Fabric/native.

Chưa có nghiệm thu native APK/camera thật, iOS simulator/device và release. Không
dùng bundle export hoặc fixture làm bằng chứng cho các mục này. SMS thật và
điều khoản/chính sách chính thức vẫn cần nghiệm thu. Thời tiết đã có proxy/UI
nhưng chờ duyệt nhà cung cấp production và kiểm thiết bị. Bảng tin/thông
báo đã có API và UI chữ; nội dung thật, ảnh bìa và kiểm UI thiết bị còn chờ nghiệm thu.
