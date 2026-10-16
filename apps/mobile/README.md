# Ứng dụng AgriTrace (Android/iOS)

Ứng dụng Android/iOS của AgriTrace cho mọi loại nông sản (trái cây, rau củ, lúa gạo,
cà phê, hồ tiêu, chè…), viết bằng Expo SDK 57 + React Native 0.86 + TypeScript.

Bản hiện tại là nền móng: theme ba chế độ lấy từ token thiết kế, client API dùng
generated types, và luồng công khai tra mã lô → kết quả xác minh. Quét camera,
đăng nhập, hàng đợi ngoại tuyến và ký bàn giao là các bước tiếp theo.

## Vì sao là project độc lập

`apps/mobile` có `package-lock.json` riêng và **không** thuộc npm workspace gốc
(root liệt kê `apps/api`, `apps/web` thay vì `apps/*`). Lý do:

- Dockerfile production của API/Web chạy `npm ci` trên lockfile gốc; cây React
  Native (~1.500 gói) không được vào image production. `.dockerignore` cũng loại
  thư mục này.
- React Native cần đúng phiên bản `react` mà renderer của nó đi kèm (19.2.3), còn
  Web dùng bản khác; tách lockfile tránh hai bản React lẫn nhau khi hoisting.

## Chạy

```bash
cd apps/mobile
npm ci
cp .env.example .env
npm start
```

`EXPO_PUBLIC_API_BASE_URL` trỏ tới API (gồm tiền tố `/api`). Trên điện thoại thật,
dùng IP LAN của máy chạy API thay cho `localhost`. `npm run web` mở bản xem trước
trên trình duyệt; đây chỉ là công cụ dev, không phải sản phẩm phát hành.

Thư mục `ios/` và `android/` được sinh bằng `npx expo prebuild` (Continuous
Native Generation) và không commit.

## Tải APK để cài thử

Workflow `Mobile APK` (`.github/workflows/mobile-apk.yml`) build APK trên runner
GitHub mỗi khi PR đổi `apps/mobile/**`, hoặc chạy tay bằng `workflow_dispatch` khi
workflow đã có trên `main`. APK gọi `https://agritrace.dev/api`, gồm ABI
`arm64-v8a` và `armeabi-v7a`, nằm trong artifact `agritrace-android-<SHA>` của
lần chạy (kèm `SHA256SUMS`) và được giữ 14 ngày.

APK ký bằng khóa debug do `expo prebuild` sinh: cài trực tiếp được (bật "Cài
ứng dụng không rõ nguồn"), nhưng không đưa lên Google Play được. Phát hành thật
cần khóa upload riêng lưu trong GitHub secrets hoặc EAS.

## Kiểm tra

```bash
npm run check
```

Lệnh chạy `tsc`, ESLint (chặn cả warning), Jest và `expo export` cho Android + iOS
để chắc Metro đóng gói được. CI chạy job `Mobile` khi `apps/mobile/**` hoặc
contract API đổi. Audit lockfile chạy từ thư mục gốc:

```bash
npm run audit:mobile
```

Advisory từ mức moderate làm audit thất bại, trừ GHSA ghi trong
[`audit-exceptions.json`](audit-exceptions.json). Mỗi mục có lý do và `reviewBy`;
quá hạn hoặc không còn xuất hiện thì audit lại thất bại.

## Cấu trúc

```text
app/                 Màn hình (expo-router): tra mã, kết quả xác minh
src/api/             Client API công khai + generated/api.d.ts (sinh từ Swagger NestJS)
src/components/      Button, StateBadge, ProofSeal, Notice, Icon, AppText
src/theme/           Token → palette Sáng/Tối/Ngoài trời, test độ tương phản WCAG
src/trace/           Đọc mã lô / đường dẫn QR (chỉ giữ token, không mở host lạ)
src/labels.ts        Nhãn trạng thái và cảnh báo, cùng câu chữ với Web
design/tokens.json   Token thiết kế (nguồn: Design System)
```

`src/api/generated/api.d.ts` do `npm run api-contract:generate` ở thư mục gốc sinh
cùng bản của Web; `api-contract:check` báo lỗi khi hai bản lệch Swagger.

## Nguồn thiết kế

- Design System: <https://claude.ai/artifact/HHJFMjNf2ZCNs7TDfj42pZ> — brand book,
  phân tích sản phẩm (gồm hồ sơ theo từng loại nông sản), kiến trúc thông tin,
  component và màn hình mẫu. Link đang riêng tư; chia sẻ từ menu Share của trang.
- [`design/tokens.json`](design/tokens.json) kế thừa `apps/web/src/styles/tokens.css`.
  Đổi token trên Design System rồi chép lại file này; `src/theme/tokens.test.ts`
  chặn mọi cặp chữ/nền dưới 4.5:1 (viền, focus dưới 3:1) ở cả ba theme.

## Ràng buộc khi phát triển tiếp

- Dùng contract từ Swagger NestJS; không tự định nghĩa lại DTO.
- Ứng dụng chỉ ẩn/hiện thao tác theo vai trò; quyền thật do API quyết định.
- Khóa ký bàn giao Ed25519 (như Web signer, ADR-004) không bao giờ gửi lên API.
  Secure Enclave của iOS chỉ hỗ trợ P-256, nên khóa Ed25519 được lưu mã hóa bằng
  Keychain/Android Keystore (`expo-secure-store`) chứ không sinh bên trong chip bảo
  mật; mô tả mức bảo vệ trong UI phải đúng như vậy.
- Lệnh ngoại tuyến giữ idempotency key sinh trên máy; kết quả chưa rõ chỉ gửi lại
  bằng đúng key cũ.
- `VERIFIED` ("Đã khớp bằng chứng") mô tả bằng chứng, không phải chất lượng sản phẩm.
