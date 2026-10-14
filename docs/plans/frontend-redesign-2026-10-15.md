# Xây lại giao diện Web theo nhận diện mới (logo A-sao, phong cách AGRIVI)

Lập ngày 15/10/2026 (bản 2, thay bản "refactor từng bước"). Kiểm kê dựa trên
`origin/main` tại `09fd53b` (sau PR #99). Checkout local `main` chậm 133 commit và
`apps/web` ở đó thiếu các trang mới (chuỗi cung ứng, bàn giao, khóa ký, lệnh đang
chờ); khi thực hiện, tạo branch từ `origin/main` và mang file này theo.

Trạng thái: **đã thực hiện trong một PR** (nhánh `refactor/web-rebuild`), chủ dự án cho phép merge và triển khai không cần duyệt. Chi tiết kết quả kiểm tra nằm trong PR; hướng dẫn vận hành giao diện ở [frontend.md](../frontend.md).

Quyết định khi thực hiện (thay cho mục 2 bên dưới khi khác nhau):

- D1: dùng CSS toàn cục chia theo vùng trong `src/styles` (tokens, base, motion, app, site), lớp landing có tiền tố `lp-`, **không** dùng CSS Modules; lý do: giữ bộ lớp thành phần dùng chung cho mọi trang quản lý mà không viết lại logic nghiệp vụ.
- D2: logo gửi kèm đã có nền trong suốt, nên không cần cắt nền; sinh `agritrace-logo.png`, `agritrace-mark.png` và biểu tượng PWA/favicon từ file đó.
- Route `/components` (thư viện giao diện) **bị gỡ**: không có liên kết tới, chỉ kéo dữ liệu mẫu vào bundle production.
- Chủ dự án yêu cầu xóa code/asset cũ không còn dùng: ba file CSS cũ, `landing-navigation`, `components/icons.tsx` (alias của lucide), logo SVG cũ, `design-tokens.json`, `icon.svg`, `public/logo.png` (smoke ảnh trong CI chuyển sang logo mới).
- Dashboard bỏ hero; "Việc cần làm" lấy từ cảnh báo và `allowedCommands` của lô nổi bật mà API trả về, không thêm endpoint.
- Chưa làm trong đợt này: các trang quản lý không đổi bố cục JSX (chỉ đổi toàn bộ lớp trình bày), thay ảnh stock bằng ảnh thật, Lighthouse trên thiết bị thật.

## 1. Chủ dự án đã quyết định

- Không vá giao diện cũ. **Bỏ tầng giao diện hiện tại và xây lại** (`src/app/**`,
  `src/components/**`, ba file CSS), giữ logic nghiệp vụ ở `src/lib/**`.
- Nhận diện mới: logo chữ **A có ngôi sao**, xanh lục + cam/vàng, khẩu hiệu
  "Truy xuất nguồn gốc nông sản Việt". Liên hệ: **contact@agritrace.dev**,
  **Zalo +84 377 599 221**.
- Phong cách tham chiếu: trang
  [AGRIVI Traceability & Compliance](https://www.agrivi.com/products/farm-management-software/traceability-and-compliance),
  thêm **animation nhẹ, mượt**. Áp dụng cho mọi trang hiện có.
- Chỉ lấy **phong cách và bố cục**. Không sao chép chữ, ảnh, logo khách hàng hay
  số liệu của AGRIVI; mọi nội dung/ảnh là của AgriTrace.

## 2. Quyết định còn cần chốt (mặc định đề xuất)

| # | Câu hỏi | Mặc định |
| --- | --- | --- |
| D1 | Cách dựng | **CSS Modules + token CSS + primitive tự viết**, animation bằng CSS + một hook `IntersectionObserver`; **không thêm thư viện** (không Tailwind/Framer Motion). Lý do: không thêm phụ thuộc phải rà soát, nhẹ cho PWA. |
| D2 | Logo | Bản gửi là ảnh raster 1672×941, nền trắng, hiệu ứng 3D bóng. Cần **bản vector/PNG nền trong suốt** (ngang + biểu tượng "A-sao" riêng cho favicon/PWA). Nếu chưa có, Pha 1 cắt nền từ ảnh này làm bản tạm. |
| D3 | Phần quản lý sau đăng nhập | Dùng **cùng token/primitive/animation tiết chế** (không hero, không hiệu ứng khi nhập liệu). Trang công khai mới dùng phong cách AGRIVI đầy đủ. |
| D4 | Ảnh | Cần ảnh thật (nông trại, thu hoạch, đóng gói, điện thoại quét QR). Ảnh `farm-greens.png`/`farm-landscape.png` dùng tạm. Mockup điện thoại dựng bằng HTML/CSS, không dùng ảnh chụp màn hình. |
| D5 | Khách hàng/đối tác/số liệu | **Không dựng** logo khách hàng, case study, số liệu hiệu quả khi chưa có thật. Chỉ dùng đối tượng/công nghệ thật (Hyperledger Fabric, chữ ký số, một lô một QR). |
| D6 | Mockup trên landing | `docs/frontend.md` hiện quy định landing không có QR/lô mẫu. Mặc định: mockup **minh họa trừu tượng**, không mã lô, không QR thật, gắn nhãn "Minh họa". Nếu muốn mockup có dữ liệu mẫu, sửa quy định này trước. |
| D7 | Nút liên hệ nổi Zalo | Mặc định **có** trên trang công khai (không có ở khu quản lý). |

## 3. Phân tích phong cách AGRIVI (đã xem trang thật, 1440 px)

| Yếu tố | Quan sát | Áp dụng cho AgriTrace |
| --- | --- | --- |
| Nền & chữ | Nền trắng/kem, chữ xám đậm `#343434`, DM Sans 700 cỡ ~51 px cho H1 | Nền trắng/kem ấm; chữ xanh than `#0F2A1D`; giữ **Be Vietnam Pro** (đã tự phục vụ, đủ dấu tiếng Việt) |
| Tiêu đề | Một cụm trong H1 tô màu nhấn ("*you can prove*") | Cụm nhấn tô xanh lục, gạch chân bằng vệt vàng cam gợi swoosh của logo |
| Eyebrow | Nhãn viên thuốc nhỏ in hoa trên H1, màu nhấn | Giữ; dùng cho mọi section |
| Hero | Chữ trái, ảnh lớn bên phải có điện thoại mockup, mép ảnh tan vào nền trắng; 2 nút (đặc + viền) | Giống bố cục; ảnh + mockup trang truy xuất; nút chính "Quét mã QR", phụ "Liên hệ tư vấn" |
| Nút | Nền đặc, bo 6 px, padding 12×28 | Bo 8 px, nền xanh lục; nút phụ viền; CTA nhấn mạnh dùng cam |
| Dải tin cậy | Marquee logo khách hàng | Marquee **công nghệ/tiêu chuẩn thật** (D5) |
| Khối 4 giá trị | 4 thẻ: Origin, Production proof, Compliance, Consumer trust | 4 thẻ: Nguồn gốc, Bằng chứng sản xuất, Tuân thủ, Niềm tin người tiêu dùng |
| Hàng tính năng | Xen kẽ trái/phải: tiêu đề, mô tả, 3 dòng tick xanh + ảnh bo góc | Giữ, 3 hàng: Truy xuất sản xuất, Kiểm định & chứng nhận, Trang người tiêu dùng |
| Stepper | 6 bước, vòng tròn đánh số nối bằng cung nét đứt | 6 bước theo mô hình thật (mục 4.1) |
| Sơ đồ kiến trúc | Hai khối nối bằng API | Sơ đồ "nghiệp vụ → chữ ký → sổ cái Fabric" |
| Hoạt hình | ~60 phần tử có reveal/fade, ~160 phần tử có transition | Mục 5 |
| Chân trang | Cookie banner, nhiều cột liên kết | Chân trang gọn: liên hệ (email, Zalo), điều hướng, quét QR |

## 4. Thiết kế mục tiêu

### 4.1. Landing `/` (nội dung tổng quát, không link đăng nhập)

1. **Header** dính: logo, "Giải pháp", "Cách hoạt động", "Quét QR", "Liên hệ"; nút
   "Liên hệ tư vấn". Thu nhỏ nhẹ khi cuộn.
2. **Hero:** eyebrow "TRUY XUẤT NGUỒN GỐC NÔNG SẢN VIỆT"; H1 "Biến dữ liệu nông
   trại thành truy xuất nguồn gốc *có thể chứng minh*."; mô tả 2 dòng; dòng
   in hoa "DỮ LIỆU NÔNG TRẠI · BẰNG CHỨNG SẢN XUẤT · NIỀM TIN NGƯỜI TIÊU DÙNG";
   2 nút; ảnh + mockup điện thoại (D6).
3. **Dải công nghệ** (marquee chậm): Hyperledger Fabric · Chữ ký số · Một lô một mã QR · Lịch sử không thể sửa.
4. **Bốn giá trị** (thẻ).
5. **Ba hàng tính năng** xen kẽ có danh sách tick.
6. **Hành trình 6 bước:** Đăng ký nguồn (trang trại, vụ) → Ghi nhận sản xuất →
   Kiểm định & chứng nhận → Thu hoạch, tạo lô và QR → Vận chuyển & bàn giao →
   Công khai truy xuất. Khớp `ProductionCycle → HarvestEvent → Lot → Shipment`.
7. **Chuỗi cung ứng:** Trang trại → Vận chuyển → Điểm bán → Người tiêu dùng.
8. **Toàn vẹn dữ liệu:** sơ đồ hai tầng (hệ nghiệp vụ → chữ ký → sổ cái); chỉ mô
   tả điều đã triển khai (kiểm `docs/PROJECT_CONTEXT.md`, không hứa hơn mã).
9. **FAQ** (accordion `<details>` có animation).
10. **Dải liên hệ:** "Cần triển khai truy xuất cho nông sản của bạn?" — nút email
    `mailto:contact@agritrace.dev`, nút Zalo `https://zalo.me/84377599221`.
11. **Chân trang** + nút Zalo nổi (D7).

### 4.2. Các trang công khai khác

- `/scan`: cùng header/footer; thẻ "Quét bằng camera / Tải ảnh / Nhập mã" bo góc,
  trạng thái camera có chuyển cảnh mượt; **không** tự bật camera.
- `/trace/[lotId]` (trang quan trọng nhất, mobile-first): banner thu hồi/hết hạn/
  cảnh báo toàn vẹn **trên cùng, không animation**; rồi hero sản phẩm; stepper
  hành trình dọc (reveal từng chặng); thẻ chứng nhận; phần "Chi tiết kỹ thuật" gập
  chứa mã băm và bằng chứng; chân trang liên hệ.
- `/login`: bố cục chia đôi (form + hình/logo), nhận diện mới, không hiệu ứng
  trên form; tiếp tục không được link từ landing.
- `not-found`, `error`, `offline.html`: logo mới, cùng token.

### 4.3. Khu quản lý (sau đăng nhập)

- Khung: sidebar nhóm **Vận hành** (Tổng quan, Vụ trồng, Lô, Chuỗi và đối tác),
  **Tuân thủ** (Kiểm định, chứng nhận), **Hệ thống** (Quản trị, Cảm biến IoT); chỉ
  hiện mục vai trò được phép (`canAccessManagementRoute`); mỗi mục một icon;
  mobile: thanh dưới + ngăn kéo, giữ quản lý focus/Escape.
- Mẫu trang: `PageHeader` (eyebrow, tiêu đề, hành động chính) → lọc → `DataTable`/
  thẻ → trạng thái rỗng/lỗi/đang tải thống nhất.
- **Dashboard bỏ hero.** Hàng số liệu → "Việc cần làm" (theo `allowedCommands`,
  cảnh báo toàn vẹn, lệnh chờ) → hoạt động gần đây.
- Hành động nguy hiểm tách riêng, có xác nhận.

### 4.4. Bản đồ đổi cho từng trang hiện có

| Route | Hiện nay | Sau khi xây lại |
| --- | --- | --- |
| `/` | Landing 642 dòng + `landing.css` 1.572 dòng | Landing mục 4.1, tách thành section component |
| `/login` | Form một thẻ | Chia đôi, nhận diện mới |
| `/scan` | Camera/ảnh/mã | Giữ hành vi, đổi giao diện + chuyển cảnh |
| `/trace/[lotId]` | Trang truy xuất | Mobile-first kể chuyện, banner cảnh báo trên cùng |
| `/dashboard` | Hero + thẻ + lô nổi bật | Việc cần làm + số liệu + hoạt động |
| `/lots`, `/lots/[lotId]` | Bảng + chi tiết, `action-panel` 473 dòng | `DataTable`; chi tiết có tab (Tổng quan, Hành trình, Bằng chứng, Thao tác) |
| `/production-cycles` | 406 dòng, `harvest-dialog` | Danh sách + chi tiết có stepper trạng thái; giữ khôi phục thu hoạch |
| `/supply-chains` | 475 dòng; `handover-panel` 612; `signing-keys-panel` 342 | Tách panel; luồng bàn giao theo bước; **không đổi** thứ tự ký/gửi lệnh |
| `/compliance`, `/admin`, `/admin/compliance-assignments` | Form/bảng riêng từng trang | `DataTable` + `Dialog` + `Notice` chung |
| `/iot-simulator` | 322 dòng | Giữ chức năng, đổi giao diện |
| `/components` | Trưng 3 thành phần | Style guide thật cho mọi primitive và animation |
| `error`, `not-found`, `offline.html`, manifest, `themeColor` | Nhận diện cũ | Logo/màu mới |

## 5. Animation: nguyên tắc và danh mục

**Nguyên tắc:** chỉ animate `transform`/`opacity`; 200–600 ms; easing
`cubic-bezier(0.22, 1, 0.36, 1)`; không gây dịch chuyển bố cục (CLS = 0);
`prefers-reduced-motion: reduce` tắt mọi chuyển động trừ đổi màu; không animate
cảnh báo thu hồi/hết hạn/toàn vẹn và không animate khi người dùng đang nhập liệu
hoặc ký lệnh.

| Hiệu ứng | Nơi dùng | Chi tiết |
| --- | --- | --- |
| Reveal khi cuộn | Landing, trace | fade + trượt lên 16 px, 500 ms, so le 60 ms trong nhóm; chạy một lần (`IntersectionObserver`) |
| Hero vào trang | Landing | chữ trượt lên lần lượt; mockup trượt từ phải, rồi **nổi nhẹ** ±6 px chu kỳ 6 s |
| Vẽ nét stepper | Hành trình 6 bước, timeline trace | cung/đường nối vẽ dần bằng `stroke-dashoffset`; vòng số bật nhẹ |
| Đếm số | Chỉ khi có số liệu thật | tăng dần 800 ms |
| Hover thẻ/nút | Mọi nơi | thẻ nâng 2 px + đổ bóng; nút đổi sáng, mũi tên dịch 3 px |
| Marquee | Dải công nghệ | cuộn chậm, dừng khi hover/focus; tĩnh nếu reduced-motion |
| Header | Công khai | thu nhỏ + bóng nhẹ khi cuộn |
| Accordion FAQ | Landing | mở/đóng bằng `grid-template-rows` |
| Chuyển trang | Toàn app | fade 150 ms (View Transitions nếu trình duyệt hỗ trợ, nếu không thì bỏ) |
| Skeleton | Khu quản lý | shimmer nhẹ thay chữ "Đang tải…" |
| Dialog/ngăn kéo | Mọi nơi | trượt + mờ 200 ms, giữ focus trap và Escape |

## 6. Hệ thống thiết kế

- **Token** một nguồn `src/styles/tokens.css`; xóa/sinh lại
  `public/agritrace/design-tokens.json` (hiện `#84CC16` mâu thuẫn CSS `#00875A`).
- **Màu** (lấy xấp xỉ từ logo, chốt bằng bản vector ở Pha 1): xanh lục chính
  ≈ `#0B8A4A`, xanh rừng đậm (chữ/khẩu hiệu) ≈ `#014527`, vàng ≈ `#FFB800`,
  cam ≈ `#F58A00`; trung tính ấm. Cam/vàng chỉ làm nhấn (CTA, vệt swoosh, số bước),
  không dùng cho trạng thái lỗi. Trạng thái: thành công/cảnh báo/lỗi/thông tin tách
  khỏi màu thương hiệu; tương phản WCAG AA.
- **Chữ:** Be Vietnam Pro; H1 40–56 px (mobile 32), đậm 700; thang 6 cấp.
- **Hình khối:** nút bo 8 px, thẻ bo 16 px, bóng mềm 2 mức.
- **Breakpoint** duy nhất: 600, 900, 1200 px.
- **Icon:** chỉ `lucide-react`; xóa `components/icons.tsx` khi hết dùng.
- **Primitive** (`src/components/ui/`): Button, Field/Input/Select/Textarea, Badge/
  StatusPill, Card, PageHeader, StatTile, DataTable, Dialog, Notice, EmptyState,
  Skeleton, Tabs, Stepper, Timeline, CopyableHash, Reveal, Marquee, Accordion.
- **Logo & icon:** `public/agritrace/brand/` (ngang, biểu tượng A-sao, mono),
  `public/icons/` cho PWA/favicon; cập nhật `manifest.webmanifest`, `themeColor`,
  ảnh chia sẻ (Open Graph).
- **Thông tin liên hệ** đặt ở **một module hằng số**
  (`src/lib/site-contact.ts`): email, Zalo, liên kết `mailto:`/`zalo.me`; dùng ở
  landing, footer, trace, offline, trang lỗi. Không rải chuỗi trong component.

## 7. Bất biến — không đổi

- Không đổi API, DTO, Swagger, `src/lib/generated/api.d.ts`, phân quyền, ký lệnh,
  command recovery, journal, idempotency, `harvest-recovery`.
- Nút ghi theo `allowedCommands` của server; Admin/Auditor không được cấp quyền ghi
  để giao diện tiện hơn (`docs/core-business-rules.md`).
- Trạng thái thu hồi/hết hạn/cảnh báo toàn vẹn hiển thị **trước** phần bằng chứng.
- Service worker chỉ lưu trang offline giải thích, không lưu trang nghiệp vụ.
- Không bật camera tự động; scanner chỉ điều hướng tới `/trace/<token>` cùng origin.
- Không tải font/script/ảnh từ domain ngoài khi mở trang (kể cả marquee, mockup).
- Không giảm kiểm thử để qua CI: `npm run check --workspace apps/web` phải xanh.

## 8. Các pha thực hiện

Mỗi pha một PR, nhánh `refactor/web-<tên>` (kebab-case, không dùng `codex/…`).
Pha 3–6 có thể làm trên nhánh tích hợp `refactor/web-rebuild` rồi merge một lần để
giao diện cũ/mới không trộn trên `main`. Triển khai production theo
`docs/production-runbook.md`.

### Pha 0 — Đường cơ sở và công cụ xem
- Chụp ảnh **trước** ở 320/390/768/1440 px cho mọi route, kể cả lỗi/rỗng/tải (lưu
  ngoài repo).
- Thêm phiên giả lập chỉ khi `NODE_ENV !== "production"` và
  `NEXT_PUBLIC_MOCK_API=true`, để mở trang quản lý theo vai trò bằng fixture. Có test
  chứng minh không có trong build production. Hiện mock không có đăng nhập.
- Kê spec phụ thuộc DOM/class sẽ phải sửa.
- **AC:** ảnh baseline đủ; mock phiên chạy đủ vai trò; `check` xanh.

### Pha 1 — Nhận diện và nền tảng
- Nhận/chuẩn bị logo (D2), chốt bảng màu từ logo, `tokens.css`, `base.css`, breakpoint,
  `site-contact.ts`, favicon/manifest/`themeColor`/Open Graph.
- Cấu hình CSS Modules; lint/test chặn hex viết cứng và `style={{}}` mới.
- **AC:** một khai báo cho mỗi token; không còn `design-tokens.json` mâu thuẫn; logo
  hiển thị đúng ở header, trang lỗi, offline, PWA.

### Pha 2 — Primitive và animation
- Viết primitive mục 6 + `Reveal`/`Marquee`/`Stepper`/`Accordion`, hook
  `useReveal`/`useReducedMotion`; spec ARIA, bàn phím, reduced-motion. `/components`
  thành style guide có demo từng animation.
- **AC:** mỗi primitive có spec; `jsx-a11y` không cảnh báo; reduced-motion tắt hiệu ứng
  (có test).

### Pha 3 — Landing mới
- Dựng landing mục 4.1 từ primitive; xóa `landing.css` và `landing-navigation` cũ khi
  thay xong.
- **AC:** Lighthouse mobile: Performance ≥ 85, Accessibility ≥ 95, CLS ≈ 0; không có
  link đăng nhập; nội dung không vượt quá mã đã triển khai; email/Zalo mở đúng.

### Pha 4 — Trang công khai còn lại
- `/scan`, `/trace/[lotId]`, `/login`, `not-found`, `error`, `offline.html`.
- **AC:** scanner/PWA hành xử như cũ (spec hiện có xanh); banner cảnh báo trace trên
  cùng và không animation; kiểm 320 px không cuộn ngang.

### Pha 5 — Khung quản lý
- Làm lại `AppFrame` theo 4.3 (tách sidebar, topbar, nav mobile, tìm kiếm).
- **AC:** mỗi vai trò chỉ thấy mục được phép; focus/Escape đúng; `app-frame.spec` xanh.

### Pha 6 — Trang quản lý (PR theo nhóm)
1. Dashboard + Lô; 2. Vụ trồng + thu hoạch; 3. Chuỗi, bàn giao, khóa ký, lệnh chờ;
4. Kiểm định, Quản trị, phân công; 5. IoT.
- **AC chung:** hành vi/dữ liệu giữ nguyên; bảng/thẻ dùng chung lọc và phân trang;
  tên dài/mã băm không tràn; auditor chỉ đọc.

### Pha 7 — Dọn dẹp và tài liệu
- Xóa CSS cũ, `components/icons.tsx`, ảnh/asset không dùng (**hỏi chủ dự án trước
  khi xóa từng file**).
- Cập nhật `docs/frontend.md` (nhận diện, token, animation, quy định landing/D6) và
  `apps/web/README.md`. Ghi nghiệm thu thiết bị thật vào AGT-028/PR, không tạo báo
  cáo Markdown mới.
- **AC:** không còn selector/token trùng; `check` xanh; docs khớp mã.

## 9. Kiểm tra mỗi PR

- `npm run check --workspace apps/web`.
- Duyệt mắt ở 320, 390, 768, 1440 px mọi route trong 4.4 + trạng thái lỗi/rỗng/tải;
  thêm tên dài, mã băm, đổi trang khi có lọc, bàn phím/Escape, camera bị từ chối, ảnh
  QR sai, bật `prefers-reduced-motion`.
- Fixture không phải bằng chứng nghiệm thu nghiệp vụ; camera thật và PWA trên HTTPS
  vẫn theo AGT-028.

## 10. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| Trông giống AGRIVI quá mức | Chỉ mượn bố cục/tiết tấu; nội dung, ảnh, màu, logo hoàn toàn của AgriTrace. |
| Logo 3D bóng, nền trắng không hợp nền màu/nhỏ | Cần bản vector (D2); thêm biến thể phẳng/mono cho favicon và nền tối. |
| Hứa hơn mã (marketing) | Mọi câu về chuỗi khối/chứng nhận đối chiếu `docs/PROJECT_CONTEXT.md`; D5 cấm số liệu/khách hàng bịa. |
| Animation làm chậm hoặc khó dùng | Ngân sách Lighthouse; chỉ transform/opacity; reduced-motion; tắt ở khu nhập liệu/ký. |
| Xây lại lớn làm vỡ nghiệp vụ | Giữ `src/lib/**` và spec hành vi; chia pha; nhánh tích hợp; không đổi hợp đồng API. |
| Spec cũ bám DOM/class | Pha 0 kê danh sách; spec mới truy vấn theo role/label. |

## 11. Ngoài phạm vi

Đổi API/schema, chế độ tối, đa ngôn ngữ ngoài tiếng Việt, CMS cho landing, form liên
hệ có backend (hiện dùng `mailto:`/Zalo), thay đổi hạ tầng/triển khai.
