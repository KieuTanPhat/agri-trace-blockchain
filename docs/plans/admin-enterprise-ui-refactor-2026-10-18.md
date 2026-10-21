# Refactor giao diện quản trị nền tảng và quản lý doanh nghiệp

Ngày lập: 18/10/2026. Trạng thái: **đã triển khai trên nhánh `chore/revert-mobile-app-foundation` (chưa commit)**, xem mục 8.
Phạm vi: `apps/web` — khu `/admin/**`, `/enterprise/**`, `/account/**` và khung
điều hướng `components/app-frame.tsx`. Không đổi API, DTO, Swagger hay
`src/lib/generated/api.d.ts`.

## 1. Hiện trạng (đối chiếu source tại checkout chính, nhánh `chore/revert-mobile-app-foundation`)

| Vấn đề | Bằng chứng |
| --- | --- |
| Cây làm việc chưa commit lớn | 216 file thay đổi/chưa track (B01–B17 của Codex + P0 quản trị nền tảng), phần lớn là chính các trang cần refactor |
| Điều hướng một danh sách phẳng cho mọi vai trò | `navigationGroups` trong `app-frame.tsx`: nhóm "Hệ thống" trộn route admin (`/admin/*`) với route chủ doanh nghiệp (`/enterprise/onboarding`, `/service`, `/signing`, `/connections`), IoT và quét QR; nhóm "Truy xuất" có 14 mục |
| Quy tắc truy cập tách rời khỏi cấu hình menu | `lib/permissions.ts` (`canAccessManagementRoute`, regex UUID) và `lib/enterprise-access.ts` (`canUseEnterpriseRoute`) liệt kê lại cùng các route; thêm trang mới phải sửa 3 nơi |
| Hai bộ UI song song | `workspace/admin-ui.tsx` (`AdminHeader`, `AdminStatus`, `AdminEmpty`, lớp `admin-*` — 153 selector trong `manager.css`) và `workspace/ui.tsx` (`WorkspaceHeading`, `WorkspaceStatus`, `WorkspaceEmpty`, lớp `workspace-*` trong `workspace.css`); bảng nhãn trạng thái bị lặp |
| Bảng/lọc/phân trang tự viết từng trang | 21 trang có `<table>` riêng; lọc client-side lặp lại (vd. `admin-organizations.tsx`) |
| Dữ liệu không có kiểu | 25 file dùng `Row = Record<string, unknown>` + `textValue()` thay vì schema sinh từ OpenAPI |
| File quá lớn | `registration-form-page.tsx` 1326, `app-frame.tsx` 729, `admin/operations/page.tsx` 689, `profile-amendments.tsx` 614, `privacy-workspace.tsx` 560, `chains.tsx` 557 dòng |
| Bottom nav mobile lấy 4 mục đầu | `allowed.slice(0, 4)` — admin và doanh nghiệp nhận mục không chủ đích |

Điểm cần giữ: `useWorkspaceData` (xóa dữ liệu khi đổi scope, tải lại theo
`PERMISSION_SYNC_EVENT`), `useWorkspaceCommand` (giữ body/key khi kết quả chưa rõ),
`CommandState`, token trong `tokens.css`.

## 2. Mục tiêu

1. Hai khu tách bạch: **Quản trị nền tảng** (SYSTEM_ADMIN và các vai trò
   PLATFORM_*, AUDITOR chỉ đọc) và **Doanh nghiệp** (thành viên tổ chức theo
   permission/capability). Mỗi khu có menu nhóm theo công việc.
2. Một **route registry** là nguồn duy nhất cho menu, breadcrumb và guard điều
   hướng phía client.
3. Một bộ component quản lý chung (header, trạng thái, bảng, lọc, phân trang,
   chi tiết, xác nhận) và một bộ lớp CSS.
4. Dữ liệu màn hình dùng kiểu sinh từ OpenAPI.
5. Không thay đổi hành vi: ma trận vai trò × route, quyền ghi, recovery command
   giữ nguyên trừ khi được liệt kê và duyệt riêng.

## 3. Kiến trúc thông tin đề xuất

**Quản trị nền tảng**

| Nhóm | Mục |
| --- | --- |
| Tổng quan | `/admin` |
| Doanh nghiệp & tổ chức | Xét duyệt doanh nghiệp, Điều chỉnh hồ sơ, Tổ chức, Sản phẩm dùng chung, Kiểm định viên, Phân công kiểm định |
| Tài khoản & phê duyệt | Tài khoản hệ thống, Phê duyệt hai bước |
| Giám sát & tuân thủ | Vận hành hệ thống, Nhật ký kiểm toán, Sự cố & khiếu nại, Diễn tập thu hồi, Bảo vệ dữ liệu cá nhân |

**Doanh nghiệp**

| Nhóm | Mục |
| --- | --- |
| Công việc | Tổng quan, Hộp công việc, Hướng dẫn |
| Sản xuất | Vụ trồng, Vùng sản xuất, Giống & vật tư, Lô nông sản, Cảm biến IoT |
| Sản phẩm & tem | Sản phẩm, Tem truy xuất QR |
| Phân phối & kho | Phân phối & giao nhận, Tồn & cách ly, Ghi bán & hao hụt, Cơ sở, Phương tiện, Thiết bị ký bàn giao |
| Chất lượng & báo cáo | Cảnh báo & thu hồi, Kiểm định & chứng nhận, Báo cáo & đối soát |
| Tổ chức | Hồ sơ doanh nghiệp, Thành viên, Nhóm quyền, Doanh nghiệp liên kết, Chuỗi truy xuất, Kết nối peer |
| Dịch vụ (chủ quản) | Hồ sơ xét duyệt, Dịch vụ & hợp đồng |

**Menu tài khoản** (góc trên, mọi vai trò): Đổi mật khẩu, Bảo mật tài khoản/MFA,
Quyền dữ liệu cá nhân, Đăng xuất. "Quét mã QR" thành nút nhanh trên topbar.

Bottom nav mobile: mỗi khu khai báo 4 mục ưu tiên trong registry.

## 4. Các pha

Mỗi pha một PR nhỏ từ nhánh `refactor/admin-enterprise-ui-*`, dừng chờ duyệt
sau P1 và P2 (định hình nền móng), các lô di chuyển trang về sau có thể nối tiếp.

### P0 — Điều kiện tiên quyết (không code refactor)

- Đưa 216 file đang dở vào PR riêng và merge (hoặc chủ dự án chỉ định base khác).
  Refactor trên cây bẩn sẽ trộn hai loại thay đổi và không review được.
- Tạo nhánh từ `main` sau merge; xác nhận không còn writer nào khác trên checkout
  (Codex) — dùng worktree riêng.
- Chụp ảnh baseline mọi route admin/doanh nghiệp ở 390 và 1440 px với fixture cách
  ly (vai trò: SYSTEM_ADMIN, AUDITOR, PLATFORM_OPERATOR, chủ doanh nghiệp FARM,
  thành viên cấp 3 TRANSPORTER).
- Viết **test ma trận vai trò × route** (snapshot kết quả của
  `canAccessManagementRoute` + `canUseEnterpriseRoute` cho mọi route và bộ access
  mẫu). Đây là lưới an toàn cho P1.

### P1 — Route registry và khung điều hướng

- Tạo `lib/management-routes.ts`: mỗi route `{ href, label, icon, area, group,
  mobilePriority?, guard }`; `guard` gọi lại logic hiện có, không viết lại quy tắc.
- `canAccessManagementRoute`/`canUseEnterpriseRoute` giữ chữ ký, đọc từ registry;
  bỏ regex lặp khi registry có pattern `[id]`.
- Tách `app-frame.tsx` thành `Sidebar`, `Topbar` (tìm lô, quét QR, menu tài
  khoản), `MobileNav`, `BottomNav`; chọn khu theo pathname + vai trò.
- Acceptance: test ma trận P0 không đổi; `app-frame.spec.tsx` xanh; menu hiển thị
  đúng nhóm mục §3 cho 5 vai trò mẫu.

### P2 — Bộ component và CSS quản lý thống nhất

- Thư mục `components/manage/`: `PageHeader` (gộp `AdminHeader` + `WorkspaceHeading`,
  có breadcrumb từ registry), `StatusBadge` (một bảng nhãn + tone trong
  `display-labels.ts`), `EmptyState`, `LoadState`, `DataTable` (khai báo cột, chế
  độ thẻ trên < 600 px, sort tùy chọn), `FilterBar`, `Pagination`, `DetailList`,
  `ConfirmDialog` (hành động nguy hiểm). `CommandState` chuyển nguyên trạng.
- Gộp `admin-*` và `workspace-*` thành một bộ lớp trong `manager.css`; chỉ dùng
  token `tokens.css`; giữ `prefers-reduced-motion`, focus-visible.
- Giữ export cũ làm adapter mỏng trỏ sang component mới để di chuyển dần, xóa ở P5.
- Acceptance: test component (render, keyboard, aria), không trang nào đổi hành vi.

### P3 — Di chuyển trang quản trị nền tảng

Theo lô, mỗi lô một PR:

1. Danh sách: organizations, users, enterprises, amendments, approvals, inspectors,
   compliance-assignments, products.
2. Chi tiết/form: `[id]`, `new` của các mục trên.
3. Trang phức tạp: `operations` (tách thẻ cảnh báo/bảng theo nguồn), `audit-log`,
   `cases`, `recall`, `privacy-workspace`, `security`.

Mỗi trang: dùng component P2, thay `Row` bằng kiểu từ `api.d.ts`, không đổi
endpoint/query. AUDITOR/PLATFORM_* vẫn chỉ thấy hành động server cho phép.

### P4 — Di chuyển trang doanh nghiệp

1. Danh sách: members, roles, partners, sites, vehicles, products, materials, areas.
2. Chi tiết/form và `members/invitations`, `ownership`, `products/import`.
3. Trang lớn: `chains.tsx`, `profile-amendments.tsx`, `resources.tsx`,
   `production.tsx`, `registration-form-page.tsx` (tách theo 5 bước, giữ nguyên
   quy tắc draft/OTP/file trong `docs/frontend.md`).

### P5 — Dọn dẹp và tài liệu

- Xóa adapter, `admin-ui.tsx`, `workspace/ui.tsx` và CSS thừa (hỏi chủ dự án trước
  khi xóa file).
- Cập nhật `docs/frontend.md` (cấu trúc khu, registry, component quản lý).

## 5. Bất biến

- Không đổi API/DTO/Swagger/generated types; nếu thiếu field, dừng và tách task API.
- Ẩn UI không thay authorization; server `allowedCommands` vẫn quyết định nút ghi.
- Admin/Auditor không có quyền ghi nghiệp vụ; Auditor chỉ đọc.
- Giữ nguyên body/requestId/Idempotency-Key khi kết quả chưa rõ; không lưu nội dung
  hồ sơ hay credentials vào storage.
- Đổi scope/tài khoản xóa dữ liệu đang hiển thị; guard đóng khi chưa tải được
  `/enterprise-access`.
- PWA không cache account/API.

## 6. Kiểm tra mỗi PR

- `npm run check --workspace apps/web` (lint, typecheck, test, build).
- Test ma trận vai trò × route và spec component liên quan.
- Browser fixture cách ly ở 320/390/768/1440 px, so với ảnh baseline; keyboard,
  focus, reduced motion. Không dùng tài khoản production.
- Giới hạn: fixture không chứng minh nghiệp vụ production hay Fabric thật.

## 7. Câu hỏi chờ chủ dự án

1. Xử lý 216 file chưa commit thế nào trước khi bắt đầu (đề xuất: PR riêng, merge trước)?
2. Tách hai khu điều hướng như §3 hay giữ một sidebar chung chỉ sắp lại nhóm?
3. Gộp `/dashboard` và `/enterprise` (hiện có hai "Tổng quan") hay giữ cả hai?
4. Phạm vi trực quan: chỉ chuẩn hóa cấu trúc/component (giữ phong cách PR #102)
   hay kèm đổi bố cục/thiết kế?
5. Với refactor này có chạy bộ test có sẵn trong `src` không (đề xuất: có, vì đây là
   lưới an toàn chính)?

## 8. Kết quả triển khai (18/10/2026)

Chủ dự án chọn làm ngay trên nhánh hiện tại, không tách PR trước; câu hỏi 2–5 dùng
mặc định đề xuất: tách hai khu điều hướng, giữ cả `/dashboard` và `/enterprise`,
chỉ chuẩn hóa cấu trúc/component (giữ phong cách PR #102), có chạy test sẵn có.

- P0: `lib/route-access-matrix.spec.ts` chụp ma trận vai trò × route và quyền
  doanh nghiệp; snapshot không đổi sau refactor.
- P1: `lib/management-routes.ts` (nhóm theo §3, `hidden` cho breadcrumb, lối tắt
  mobile), `components/shell/*` (hook dữ liệu khung, tìm lô, menu tài khoản, nhóm
  menu); `app-frame.tsx` từ 729 còn khoảng 450 dòng. Topbar có breadcrumb, nút quét QR
  và menu tài khoản. Guard vẫn nằm trong `permissions.ts`/`enterprise-access.ts`,
  chưa gộp vào registry để không đổi logic quyền.
- P2: `components/manage/*`; lớp `admin-*` đổi thành `manage-*`; bỏ CSS
  `workspace-page/heading/back/table/empty`; nhãn trạng thái chuyển sang
  `lib/status-labels.ts`. Quy tắc in tem trỏ đúng lớp `.sidebar/.topbar/.bottom-nav`.
- P3: các danh sách tổ chức, tài khoản, hồ sơ doanh nghiệp, điều chỉnh, phê duyệt,
  sự cố, phân công dùng `DataTable`/`FilterBar`/`SearchField`; tiêu đề lấy nhóm từ
  registry thay cho chuỗi "Quản trị nền tảng / …" viết tay.
- P4: trang doanh nghiệp dùng `PageHeader`/`LoadState`/`StatusBadge` qua codemod;
  bảng viết tay được gắn `data-label` để thành thẻ dưới 600 px.
- P5: `docs/frontend.md` cập nhật. `components/workspace/ui.tsx` và
  `components/workspace/admin-ui.tsx` đã xóa sau khi chủ dự án đồng ý.

Kiểm tra: typecheck và lint sạch; vitest 301/305, 4 lỗi còn lại giống hệt baseline
trước refactor (`onboarding.spec`, `case-requests.spec`). Vitest local cần cấu hình
JSX tạm vì `node_modules` lệch lockfile (vite 8). Chưa chạy `next build` vì một
`next dev` của phiên khác đang dùng chung `.next`. Đã xem trên trình duyệt (DB cách
ly :3005, tài khoản chủ doanh nghiệp) ở 1440 và 390 px; giao diện admin chỉ được kiểm
qua `app-frame.spec`.

Còn lại: API `enterprise-workspace` trả `Record<string, never>` nên trang doanh
nghiệp vẫn dùng `Row`; muốn có kiểu cần bổ sung DTO phía NestJS (task API riêng).
Các trang phức tạp (`operations`, `audit-log`, `recall`, `privacy-workspace`,
`chains`, `registration-form-page`) mới đổi component dùng chung, chưa tách nhỏ.
